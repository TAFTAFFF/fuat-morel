/* FUAT MOREL — render-chars.js
   7 klan karakterinin (TAFTAF, Caner, LUL, ertan, Kral, Nuss, baso) yüksek kaliteli çizgi film çizimi.

   TEKNİK
   - Her karakter "kesik animasyon" (cutout) parçalarından oluşur: kafa (ifade varyantlarıyla), gövde,
     ön/arka kol, ön/arka bacak, Nuss için açık kanat. Her parça BİR KEZ offscreen tuvale cel-shading ile
     (koyu hilal gölge + açık hilal ışık + parlak nokta) çizilir; parçanın siluetinden kalın koyu dış hat
     üretilir (siluet 'source-in' ile boyanır, 16-24 yöne kaydırılıp arkasına basılır). Sonuç FM.gfx.sprite
     ile önbelleklenir; her karede yalnızca dönüşüm + drawImage yapılır (4 yarışçı × ~10 drawImage).
   - Pelerin, atkı uçları, maske kurdeleleri ve kuyruklar dalgalanmaları için her karede eğrilerle çizilir.
   - Pozlar yarışçı alanlarından türetilir (koşu döngüsü, havada açık/toplanmış, çift zıplamada ters takla,
     kayma, tırmanma, uçma, sersemleme, kürsüde sevinç/üzüntü) + esneme/ezilme (r.land, r.jumpT).
   - Durum katmanları: kalkan, balon, sersem yıldızları, buz bloğu, elektrik ağı, yavaşlama notaları,
     mıknatıs halkası, hız alevi/ped parlaması, gölge atılımı hayaletleri, kızak buz serpintisi.
   - Kozmetik (Mağaza 2.0): 16 skin — 5 elle ayarlı (klasik, altin, gece, neon, buz) + 11 rampa/desen tabanlı (gumus, okyanus, seker,
     kamuflaj, zebra, benek, piksel, lav, robot, galaksi, gokkusagi). Desenler (çizgi, benek, kamuflaj, yıldız tozu, piksel, çatlak…)
     parça sprite'ı üretilirken yalnızca karakterin "gövde" renkli şekillerinin içine (cel() klibi) bir kez çizilir: gözler/aksesuarlar
     temiz kalır, her karede ek maliyet yok. Şapkalar/aksesuarlar (FM.COSMETICS.hats) karakter başına kafa/yüz/boyun çapasına oturur,
     dış hatlı sprite olarak önbellekte. İsim plakaları (FM.COSMETICS.plates) oyuncunun TAKMA ADIYLA çizilir (15 stil).

   API
   FM.R.drawRacers(ctx)                                   dünya koordinatında tüm yarışçılar (r.skin, r.hat, r.plate, r.win kullanılır)
   FM.R.drawCharacter(ctx, id, x, y, scale, pose, opts)    x,y = ayak noktası; pose {st, ph, t, vy, sled, expr}; opts {skin, hat, outline, face}
                                                          st ∈ idle run air slide climb fly cheer sad stun dance flex flip (son üçü zafer kutlaması pozları)
   FM.R.portrait(id, size, opts) -> HTMLCanvasElement     size×size piksel, önbellekli; opts {skin, hat, bg, expr, ring}
   FM.R.portraitURL(id, size, opts) -> dataURL            (aynı portrenin önbellekli PNG adresi; DOM'da <img> için)
   FM.R.charHeadPos(r) -> {x,y}                           (yarışçının kafa merkezi, dünya koordinatı; diğer modüller için)
   FM.R.cosmeticIcon(type, id, size, opts) -> canvas      mağaza kartı ikonu (hats/trails/plates/wins/deaths/skins), önbellekli; opts {nick, char}
   FM.R.drawPlate(ctx, style, name, x, y, scale, big)     isim plakasını (oyuncunun takma adıyla) ekrana çizer (mağaza canlı önizleme)
   FM.R.racerHat(r) / FM.R.racerWinPose(r)                yarışçının geçerli şapkası / kutlama pozu (yerel oyuncuda kuşanılan)
   FM.R.SKIN_IDS / FM.R.HAT_IDS / FM.R.PLATE_IDS          renderer'ın çizebildiği id listeleri
*/
'use strict';
(function (FM) {
  const R = FM.R = FM.R || {};
  R.updaters = R.updaters || [];
  const TAU = Math.PI * 2, PI = Math.PI;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const SC = 1.0;                       // yarışçı çizim ölçeği (karakter ~56 birim boyunda: çarpışma kutusunun ~1.3 katı)
  /* Rampa tabanlı skin'ler: ramp (koyu→açık 7 renk), lo (gövde renklerinin rampadaki başlangıcı 0..1), th (bu parlaklığın altındaki
     aksesuar renkleri koyu bölgede kalır: güneş gözlüğü siyah kalsın), line (dış hat), eye (göz rengi; yoksa karakterinki),
     pat (desen türü), glow ('ember' | 'cosmic': dış hat ışıması rengi col), fx (twinkle rengi) */
  const SKIN_DEF = {
    gumus:     { ramp: ['#1e2028', '#3c404c', '#6a7080', '#9aa2b4', '#c4ccda', '#e4e9f2', '#ffffff'], lo: 0.42, th: 0.2, line: '#171a22', fx: '#ffffff' },
    okyanus:   { ramp: ['#062238', '#0b3d5c', '#0f5f85', '#1a86ad', '#2fb3cf', '#7fdce8', '#d8f8ff'], lo: 0.3, th: 0.2, line: '#062238', eye: '#ffd23f', pat: 'wave' },
    seker:     { ramp: ['#6b2a4a', '#a0406e', '#d06a98', '#f08cb8', '#ffb0d0', '#ffd3e6', '#fff4f9'], lo: 0.5, th: 0.2, line: '#5a1e3e', eye: '#4fb3ff', pat: 'sprinkle' },
    kamuflaj:  { ramp: ['#161f0e', '#2a3a18', '#405a22', '#5c7a2e', '#7a9440', '#a3b468', '#d4dcb0'], lo: 0.38, th: 0.2, line: '#121a0a', pat: 'camo' },
    zebra:     { ramp: ['#1c1c22', '#3a3a44', '#78788a', '#b4b4c0', '#dcdce4', '#f2f2f6', '#ffffff'], lo: 0.6, th: 0.2, line: '#14141a', pat: 'stripes' },
    benek:     { ramp: ['#2a1708', '#5a3410', '#8c5418', '#c47a26', '#e0a040', '#f0c878', '#fff0d0'], lo: 0.45, th: 0.2, line: '#2a1408', eye: '#3ddc84', pat: 'spots' },
    piksel:    { posterize: true, line: '#101020', pat: 'pixel' },
    lav:       { ramp: ['#0d0608', '#2a0d0e', '#4a1612', '#6e2114', '#9a3414', '#c8501a', '#f0a040'], lo: 0.22, th: 0.2, line: '#1a0604', eye: '#ffe14d', pat: 'cracks', glow: 'ember', glowCol: '#ff8a1a' },
    robot:     { ramp: ['#1c1f26', '#343945', '#555c6c', '#7d8597', '#a6afc0', '#ccd4e0', '#eef2f8'], lo: 0.4, th: 0.2, line: '#141820', eye: '#7df9ff', pat: 'panel' },
    galaksi:   { ramp: ['#05031a', '#120b3a', '#1e1660', '#2d2384', '#4a35a8', '#7b5fd0', '#b9a8f0'], lo: 0.2, th: 0.2, line: '#05030f', eye: '#7df9ff', pat: 'stars', glow: 'cosmic', glowCol: '#9a7bff', fx: '#d8ccff' },
    gokkusagi: { ramp: ['#2a2230', '#5a4a5a', '#9a8a9a', '#cfc2cf', '#ece4ec', '#faf6fa', '#ffffff'], lo: 0.58, th: 0.2, line: '#2a1a34', pat: 'rainbow', fx: '#ffffff' }
  };
  const SKINS = { klasik: 1, altin: 1, gece: 1, neon: 1, buz: 1 };
  for (const k in SKIN_DEF) SKINS[k] = 1;
  // Her karakterin "gövde" renk anahtarları (rampa tabanlı skin'lerde gövde bölgesine eşlenir) ve desenin çizileceği alt küme
  const BODY_KEYS = {
    TAFTAF: ['fur', 'furD', 'belly', 'stripe'], Caner: ['fur', 'furL', 'belly', 'sheen'], LUL: ['fur', 'furL'],
    ertan: ['fur', 'furL', 'jacket', 'jacketL', 'jacketD'], Kral: ['fur', 'furL', 'mane', 'mane2', 'maneL'], Nuss: ['fur', 'furL', 'shade'], baso: ['fur', 'furL', 'hood', 'hoodL', 'hoodD']
  };
  const PAT_KEYS = { TAFTAF: ['fur', 'belly'], Caner: ['fur', 'belly'], LUL: ['fur'], ertan: ['fur', 'jacket'], Kral: ['fur', 'mane', 'mane2'], Nuss: ['fur'], baso: ['fur', 'hood'] };
  const KEEP_KEYS = { sclera: 1, blush: 1 };   // her skin'de özgün kalan anahtarlar (göz akı, allık)

  /* =====================================================================
     RENK YARDIMCILARI
     ===================================================================== */
  const rgbC = new Map();
  function rgb(c) {
    let v = rgbC.get(c);
    if (!v) {
      let h = String(c || '#000000');
      if (h.charAt(0) === '#') h = h.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h.slice(0, 6), 16) || 0;
      v = [n >> 16 & 255, n >> 8 & 255, n & 255];
      rgbC.set(c, v);
    }
    return v;
  }
  function hex(r, g, b) {
    return '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1);
  }
  const shC = new Map();
  function sh(c, f) {
    const k = c + '|' + f; let v = shC.get(k); if (v) return v;
    const [r, g, b] = rgb(c);
    v = f >= 0 ? hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f) : hex(r * (1 + f), g * (1 + f), b * (1 + f));
    shC.set(k, v); return v;
  }
  const mixC = new Map();
  function mix(a, b, t) {
    const k = a + b + t; let v = mixC.get(k); if (v) return v;
    const x = rgb(a), y = rgb(b);
    v = hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
    mixC.set(k, v); return v;
  }
  function rgba(c, a) { const [r, g, b] = rgb(c); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }
  function lum(c) { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  const SHADOW_HUE = '#2a1446', LIGHT_HUE = '#fff8e8';

  /* =====================================================================
     PALETLER (klasik) — FM.CH[id].look açıklamalarına göre
     ===================================================================== */
  const PAL = {
    TAFTAF: {
      fur: '#efe0c0', furD: '#c9a978', belly: '#fffaf0', stripe: '#d6b37c',
      mask: '#5b2a86', maskL: '#8f58cc', maskD: '#3a1658',
      cap: '#d62828', capL: '#ff6450', capD: '#a01616',
      earIn: '#ff9eb5', eye: '#2f8fff', nose: '#ff6f91', blush: '#ff8fa8', bell: '#ffc93a', line: '#2a1430'
    },
    Caner: {
      fur: '#272736', furL: '#5d6eb4', belly: '#3a3a56', sheen: '#8a9ce0',
      scarf: '#c0182e', scarfL: '#ff4a5e', scarfD: '#7c0a1a',
      beak: '#f2b134', beakD: '#c27412', eye: '#ff2b3b', sclera: '#fff1ee', leg: '#3b3545', moon: '#ff2b45', moonL: '#ff8a96',
      line: '#0b0a12'
    },
    LUL: {
      fur: '#2f4f9a', furL: '#6890e0', skin: '#8fa8dd', skinL: '#c6d6f7', skinD: '#5f78b8',
      glass: '#0d0d12', glassHi: '#7ab6ff', mouth: '#2a0e1e', chain: '#ffd23f', line: '#121838'
    },
    ertan: {
      fur: '#34305e', furL: '#625ca8', face: '#f6f7ff', belly: '#f4f6ff',
      jacket: '#8fd3ff', jacketL: '#c9ecff', jacketD: '#4f9fd8',
      glass: '#3ec1c9', beak: '#ff9a1f', beakD: '#d0650a', shoe: '#ffffff', shoeAcc: '#3ec1c9', sole: '#c9d3e8',
      eye: '#2a2050', blush: '#ff9ab8', line: '#16132e'
    },
    Kral: {
      fur: '#d89a45', furL: '#f6c87e', muzzle: '#f8e4bc', mane: '#9c4f1c', mane2: '#c46e2c', maneL: '#e08d40',
      crown: '#ffd23f', crownL: '#fff2a0', crownD: '#c9850c', gemR: '#e0243a', gemB: '#2f7fff',
      cape: '#c81e2e', capeL: '#ff5262', capeD: '#7e0c18', ermine: '#ffffff', spot: '#1b1b22',
      nose: '#5a2a14', eye: '#e08a12', line: '#3a1806'
    },
    Nuss: {
      fur: '#eef2ff', furL: '#ffffff', shade: '#a9b5d6', disk: '#ffffff', speck: '#7f8cae',
      feather: '#7be3ff', featherL: '#c8f5ff', featherD: '#2a9fd6',
      eye: '#ffd23f', beak: '#2b2b36', talon: '#3d3d48', wingTip: '#b9c3db', line: '#26304e'
    },
    baso: {
      fur: '#8b5a33', furL: '#b98250', muzzle: '#ddb98e', hood: '#3cb371', hoodL: '#7be0a4', hoodD: '#227a48',
      phone: '#e63946', phoneL: '#ff7a84', band: '#1d1d24', cushion: '#2c2c36', nose: '#2a1810', eye: '#2a1810',
      string: '#ffffff', line: '#26140a'
    }
  };

  /* ---------- skin renk eşleme ----------
     Genel kural: rengin parlaklığı skin rampasına eşlenir; ardından her karakter için ELLE seçilmiş ana renkler
     (SKIN_OV) uygulanır — böylece her skin her karakterde dengeli ve okunaklı görünür. */
  const RAMP = {
    altin: ['#3a2000', '#6e4204', '#a8700c', '#dca21e', '#f7cb45', '#ffe58a', '#fff6d2'],
    gece:  ['#05041a', '#100d33', '#1e1852', '#2f2775', '#463a9a', '#6f5fc4', '#a99cf0'],
    buz:   ['#123a5e', '#22618f', '#3f8fc0', '#6fbde6', '#a6e0fb', '#d8f3ff', '#ffffff'],
    neonP: ['#14051f', '#2c0a45', '#58107a', '#a015b8', '#ff2bd6', '#ff8ae9', '#ffe3fb'],
    neonC: ['#03121c', '#062c40', '#0a5873', '#0f97b8', '#1fe3ff', '#8ef6ff', '#e6fdff']
  };
  function ramp(rp, l) { const n = rp.length - 1, f = clamp(l, 0, 1) * n, i = min(n - 1, f | 0); return mix(rp[i], rp[i + 1], f - i); }
  /** Retro piksel: kanal başına 4 seviye (0, 85, 170, 255) + hafif doygunluk artışı */
  function posterize(c) {
    const [r, g, b] = rgb(c), m = (r + g + b) / 3, q = v => clamp(Math.round(v / 85) * 85, 0, 255);
    return hex(q(m + (r - m) * 1.35), q(m + (g - m) * 1.35), q(m + (b - m) * 1.35));
  }
  /** c rengini skin'e eşler. body=true: gövde anahtarı (rampanın ana bölgesine), değilse aksesuar (koyu renkler koyu kalır). */
  function skinColor(c, skin, body) {
    const l = lum(c);
    if (skin === 'altin') return ramp(RAMP.altin, Math.pow(l, .8));
    if (skin === 'gece') return ramp(RAMP.gece, .1 + l * .8);
    if (skin === 'buz') return ramp(RAMP.buz, .3 + l * .7);
    if (skin === 'neon') { const [r, g, b] = rgb(c); const cool = b > r + 12 || g > r + 30; return ramp(cool ? RAMP.neonC : RAMP.neonP, .08 + l * .62); }
    const sd = SKIN_DEF[skin];
    if (!sd) return c;
    if (sd.posterize) return posterize(c);
    if (body) return ramp(sd.ramp, sd.lo + l * (1 - sd.lo));
    const th = sd.th || 0.2;
    if (l < th) return ramp(sd.ramp, l / th * 0.22);                         // koyu aksesuar (gözlük, bant) koyu kalır
    return ramp(sd.ramp, sd.lo + (l - th) / (1 - th) * (1 - sd.lo));
  }
  const SKIN_LINE = { altin: '#4a2800', gece: '#05040e', neon: '#12041f', buz: '#123a5e' };
  const SKIN_OV = {
    TAFTAF: {
      altin: { fur: '#f2c64a', furD: '#b07a12', belly: '#fff0b0', stripe: '#d99a1e', mask: '#8a5200', maskL: '#c88a14', maskD: '#5a3200', cap: '#ffdc5a', capL: '#fff2a8', capD: '#c8860e', eye: '#b8560a', earIn: '#ffb04a' },
      gece:  { fur: '#3b3570', furD: '#24204a', belly: '#5b52a0', stripe: '#2c2758', mask: '#0e0a24', maskL: '#2e2660', maskD: '#05030f', cap: '#6a2bb0', capL: '#9a5ae0', capD: '#3e1270', eye: '#7df9ff', earIn: '#a066ff', nose: '#c08aff' },
      neon:  { fur: '#2a0b47', furD: '#170428', belly: '#4a1680', stripe: '#ff2bd6', mask: '#0fd0ef', maskL: '#8ef6ff', maskD: '#06566a', cap: '#ff2bd6', capL: '#ff9cf0', capD: '#a0108a', eye: '#1fe3ff', earIn: '#ff2bd6', nose: '#ff2bd6', bell: '#1fe3ff' },
      buz:   { fur: '#d9f2ff', furD: '#7fb8dc', belly: '#ffffff', stripe: '#a6d8f4', mask: '#2f7fbf', maskL: '#62b0e8', maskD: '#174d7c', cap: '#8fd8ff', capL: '#d8f4ff', capD: '#3f8fc0', eye: '#1a6fd0', earIn: '#b6e6ff', nose: '#7cc6ec' }
    },
    Caner: {
      altin: { fur: '#c98a12', furL: '#ffe07a', belly: '#e0a62a', sheen: '#fff0a8', scarf: '#ffdf6a', scarfL: '#fff4c0', scarfD: '#a86c06', beak: '#fff0b0', beakD: '#d8a030', eye: '#ff3b2b', leg: '#8a5a08', moon: '#fff6d2', moonL: '#ffffff' },
      gece:  { fur: '#0c0b1c', furL: '#3a3478', belly: '#1a1736', sheen: '#6a5cc8', scarf: '#5a1aa8', scarfL: '#9a5ae0', scarfD: '#2a0a58', beak: '#8a7ce0', beakD: '#4a3d9a', eye: '#ff3b5c', leg: '#1e1852', moon: '#ff3b5c', moonL: '#ff9aae' },
      neon:  { fur: '#1a0630', furL: '#7a1aa8', belly: '#2c0a45', sheen: '#ff8ae9', scarf: '#ff2bd6', scarfL: '#ffb0f2', scarfD: '#90107a', beak: '#1fe3ff', beakD: '#0a8fb0', eye: '#ff2b6a', leg: '#3a0d5a', moon: '#1fe3ff', moonL: '#c8fbff' },
      buz:   { fur: '#2f6f9f', furL: '#a6e0fb', belly: '#5aa6d6', sheen: '#e2f6ff', scarf: '#e6f8ff', scarfL: '#ffffff', scarfD: '#8fc6e8', beak: '#bfeaff', beakD: '#6fb0dc', eye: '#1fb6ff', leg: '#1f5f8f', moon: '#ffffff', moonL: '#ffffff' }
    },
    LUL: {
      altin: { fur: '#d99a1e', furL: '#ffe07a', skin: '#fff0b0', skinL: '#fffbe6', skinD: '#c89a3a', glass: '#3a2000', glassHi: '#ffe58a', mouth: '#5a3000' },
      gece:  { fur: '#16133a', furL: '#3e3490', skin: '#4a3d9a', skinL: '#7a6cc9', skinD: '#2a2268', glass: '#05040e', glassHi: '#7df9ff', mouth: '#05040e' },
      neon:  { fur: '#0a2c48', furL: '#1fa8d8', skin: '#ff2bd6', skinL: '#ffa2f0', skinD: '#a0108a', glass: '#08020f', glassHi: '#1fe3ff', mouth: '#2c0a45' },
      buz:   { fur: '#6fbde6', furL: '#d8f3ff', skin: '#e6f8ff', skinL: '#ffffff', skinD: '#8fc6e8', glass: '#123a5e', glassHi: '#e6f8ff', mouth: '#123a5e' }
    },
    ertan: {
      altin: { fur: '#a8700c', furL: '#e0a62a', face: '#fff6d2', belly: '#fff6d2', jacket: '#ffd95a', jacketL: '#fff4c0', jacketD: '#c8860e', glass: '#ffe58a', beak: '#ffb020', beakD: '#c27412', shoe: '#fff8e0', shoeAcc: '#e0a020', sole: '#e8c870', eye: '#3a2000' },
      gece:  { fur: '#0c0b22', furL: '#2e2775', face: '#6f5fc4', belly: '#6f5fc4', jacket: '#2f2775', jacketL: '#5446ad', jacketD: '#1a1550', glass: '#7df9ff', beak: '#ff9a1f', beakD: '#b85a0a', shoe: '#463a9a', shoeAcc: '#7df9ff', sole: '#2f2775', eye: '#7df9ff' },
      neon:  { fur: '#14051f', furL: '#58107a', face: '#ff8ae9', belly: '#2c0a45', jacket: '#1fe3ff', jacketL: '#b8faff', jacketD: '#0a8fb0', glass: '#ff2bd6', beak: '#ff2bd6', beakD: '#a0108a', shoe: '#ffffff', shoeAcc: '#ff2bd6', sole: '#1fe3ff', eye: '#1fe3ff' },
      buz:   { fur: '#22618f', furL: '#5fa8d8', face: '#ffffff', belly: '#ffffff', jacket: '#d8f3ff', jacketL: '#ffffff', jacketD: '#8fc6e8', glass: '#6fbde6', beak: '#a6e0fb', beakD: '#4f9fd0', shoe: '#ffffff', shoeAcc: '#3f8fc0', sole: '#b6e0f6', eye: '#123a5e' }
    },
    Kral: {
      altin: { fur: '#f2c64a', furL: '#fff0a8', muzzle: '#fff6d2', mane: '#b87a0a', mane2: '#e0a020', maneL: '#ffd95a', crown: '#fff3b0', crownL: '#ffffff', crownD: '#d8a030', cape: '#e0a020', capeL: '#ffe58a', capeD: '#8a5200', nose: '#6e4204', eye: '#b8560a' },
      gece:  { fur: '#3a3270', furL: '#5a4ea8', muzzle: '#6f5fc4', mane: '#0f0c2c', mane2: '#211b56', maneL: '#3a2f80', crown: '#c0c8ff', crownL: '#ffffff', crownD: '#6a70c0', gemR: '#ff3b8a', gemB: '#7df9ff', cape: '#2a0e5a', capeL: '#5a2aa8', capeD: '#12052e', ermine: '#c8c0ff', eye: '#7df9ff', nose: '#0c0a24' },
      neon:  { fur: '#2c0a45', furL: '#6a1a9a', muzzle: '#5a12a0', mane: '#ff2bd6', mane2: '#ff7ae6', maneL: '#ffc4f6', crown: '#1fe3ff', crownL: '#d0fdff', crownD: '#0a8fb0', cape: '#1fe3ff', capeL: '#b0faff', capeD: '#066080', ermine: '#ffe3fb', eye: '#1fe3ff', nose: '#ff2bd6' },
      buz:   { fur: '#cdefff', furL: '#ffffff', muzzle: '#ffffff', mane: '#3f8fc0', mane2: '#6fbde6', maneL: '#a6e0fb', crown: '#e6f8ff', crownL: '#ffffff', crownD: '#7cc6ec', cape: '#5fb0e6', capeL: '#b6e6ff', capeD: '#22618f', eye: '#1f78c8', nose: '#22618f' }
    },
    Nuss: {
      altin: { fur: '#ffd95a', furL: '#fff6d2', shade: '#c8860e', disk: '#fff0b0', speck: '#a8700c', feather: '#ff9d00', featherL: '#ffd95a', featherD: '#8a5200', eye: '#ff7a00', wingTip: '#e0a020', beak: '#5a3200', talon: '#6e4204' },
      gece:  { fur: '#2f2775', furL: '#4a3d9a', shade: '#1a1550', disk: '#463a9a', speck: '#10102e', feather: '#7df9ff', featherL: '#d8feff', featherD: '#1fa8d8', eye: '#ffe14d', wingTip: '#1e1852', beak: '#0c0a24', talon: '#0c0a24' },
      neon:  { fur: '#1a0630', furL: '#3a0d5a', shade: '#0e0220', disk: '#2c0a45', speck: '#ff2bd6', feather: '#1fe3ff', featherL: '#c8fbff', featherD: '#0a8fb0', eye: '#ffe14d', wingTip: '#ff2bd6', beak: '#ff2bd6', talon: '#1fe3ff' },
      buz:   { fur: '#e2f6ff', furL: '#ffffff', shade: '#7cb8e0', disk: '#ffffff', speck: '#5fa0d0', feather: '#3f8fc0', featherL: '#a6e0fb', featherD: '#1f5f8f', eye: '#7cd8ff', wingTip: '#a6d8f4', beak: '#22618f', talon: '#22618f' }
    },
    baso: {
      altin: { fur: '#d99a1e', furL: '#ffd95a', muzzle: '#fff0b0', hood: '#ffd23f', hoodL: '#fff2a8', hoodD: '#b87a0a', phone: '#fff6d2', phoneL: '#ffffff', band: '#6e4204', cushion: '#8a5200', nose: '#3a2000', eye: '#3a2000' },
      gece:  { fur: '#2f2775', furL: '#4a3d9a', muzzle: '#6f5fc4', hood: '#141238', hoodL: '#2f2775', hoodD: '#07061a', phone: '#ff3b8a', phoneL: '#ff9ac4', band: '#05040e', cushion: '#100d33', nose: '#05040e', eye: '#7df9ff' },
      neon:  { fur: '#2c0a45', furL: '#58107a', muzzle: '#a015b8', hood: '#1fe3ff', hoodL: '#b8faff', hoodD: '#0a7090', phone: '#ff2bd6', phoneL: '#ffb0f2', band: '#14051f', cushion: '#2c0a45', nose: '#ff2bd6', eye: '#1fe3ff' },
      buz:   { fur: '#a6e0fb', furL: '#e2f6ff', muzzle: '#ffffff', hood: '#3f8fc0', hoodL: '#8fd0f0', hoodD: '#1f5f8f', phone: '#e6f8ff', phoneL: '#ffffff', band: '#123a5e', cushion: '#22618f', nose: '#123a5e', eye: '#123a5e' }
    }
  };
  const PALC = new Map();
  /** Karakter + skin paleti (back=true: arka uzuvlar için koyulaştırılmış) */
  function pal(id, skin, back) {
    const key = id + '|' + skin + '|' + (back ? 1 : 0);
    let P = PALC.get(key); if (P) return P;
    P = {};
    if (back) {
      const f = pal(id, skin, false);
      for (const k in f) P[k] = (typeof f[k] === 'string' && f[k].charAt(0) === '#' && k !== 'line') ? mix(f[k], '#24123a', 0.2) : f[k];
    } else {
      const base = PAL[id] || PAL.TAFTAF, sd = SKIN_DEF[skin], bk = BODY_KEYS[id] || BODY_KEYS.TAFTAF;
      for (const k in base) P[k] = (skin === 'klasik' || k === 'line' || (sd && KEEP_KEYS[k])) ? base[k] : skinColor(base[k], skin, bk.indexOf(k) >= 0);
      const ov = SKIN_OV[id] && SKIN_OV[id][skin];
      if (ov) Object.assign(P, ov);
      if (sd) {
        if (sd.eye) P.eye = sd.eye;
        if (sd.line) P.line = sd.line;
        if (id === 'Nuss' && !sd.eye) P.eye = base.eye;                           // baykuşun iri sarı gözü her skin'de okunur kalsın
        if (sd.pat) { P.pattern = sd.pat; P.patKeys = PAT_KEYS[id] || PAT_KEYS.TAFTAF; }
      } else if (skin !== 'klasik' && !(ov && ov.line)) P.line = SKIN_LINE[skin] || P.line;
      P.glowEye = skin === 'gece' || skin === 'neon' || id === 'Caner' || !!(sd && (sd.glow || sd.eye === '#7df9ff'));
      P.neonGlow = skin === 'neon' || !!(sd && sd.glow);
      if (skin === 'neon') P.neonCol = (id === 'LUL' || id === 'ertan' || id === 'baso') ? '#26f0ff' : '#ff4fe0';
      else if (sd && sd.glow) { P.neonCol = sd.glowCol; P.glowSoft = sd.glow === 'cosmic'; }
      P.skinId = skin;
    }
    PALC.set(key, P);
    return P;
  }

  /* =====================================================================
     YOL / ŞEKİL YARDIMCILARI
     ===================================================================== */
  let LN = '#1b1024';   // parça çizilirken geçerli çizgi rengi
  let PAT = null;       // parça çizilirken geçerli skin deseni: { fn, cols:Set(gövde renkleri), seed } (yalnızca outlined() içinde)

  /* =====================================================================
     SKİN DESENLERİ — parça yerel koordinatında, cel() klibinin içine (yalnızca gövde renkli şekillere) bir kez çizilir.
     Deterministik (FM.hash + parça tohumu): aynı parça her üretimde aynı görünür.
     ===================================================================== */
  const H = (s, i) => FM.hash(s * 131 + i * 7919);
  const PATTERNS = {
    stripes(g, s) {   // zebra: dalgalı siyah şeritler
      g.strokeStyle = 'rgba(23,23,30,0.94)'; g.lineCap = 'round';
      for (let i = -7; i <= 7; i++) {
        const x = i * 8.6 + H(s, i) * 3, w = 2.4 + H(s, i + 40) * 1.8, k = H(s, i + 80) * 6;
        g.lineWidth = w; g.beginPath(); g.moveTo(x - 12, -60);
        g.bezierCurveTo(x - 4 + sin(k) * 5, -30, x + 6 + cos(k) * 5, -10, x - 2 + sin(k * 1.7) * 4, 20);
        g.quadraticCurveTo(x - 6, 40, x + 2, 60); g.stroke();
      }
    },
    spots(g, s) {     // leopar rozetleri: koyu kesik halka + açık merkez
      for (let i = 0; i < 16; i++) {
        const x = -44 + H(s, i) * 88, y = -52 + H(s, i + 50) * 92, r = 2.3 + H(s, i + 100) * 1.6, a0 = H(s, i + 150) * TAU;
        g.fillStyle = 'rgba(42,23,8,0.92)';
        g.beginPath(); g.arc(x, y, r, a0, a0 + 2.1); g.lineTo(x + cos(a0 + 2.1) * r * 0.45, y + sin(a0 + 2.1) * r * 0.45); g.arc(x, y, r * 0.45, a0 + 2.1, a0, true); g.closePath(); g.fill();
        g.beginPath(); g.arc(x, y, r, a0 + 2.9, a0 + 5.2); g.lineTo(x + cos(a0 + 5.2) * r * 0.45, y + sin(a0 + 5.2) * r * 0.45); g.arc(x, y, r * 0.45, a0 + 5.2, a0 + 2.9, true); g.closePath(); g.fill();
        g.fillStyle = 'rgba(196,122,38,0.55)'; g.beginPath(); g.arc(x, y, r * 0.42, 0, TAU); g.fill();
      }
    },
    camo(g, s) {      // kamuflaj lekeleri (koyu yeşil, kum, kahve)
      const cols = ['rgba(38,54,24,0.95)', 'rgba(138,122,69,0.9)', 'rgba(78,60,34,0.85)', 'rgba(60,88,34,0.9)'];
      for (let i = 0; i < 14; i++) {
        const x = -44 + H(s, i) * 88, y = -52 + H(s, i + 60) * 92, rx = 4 + H(s, i + 120) * 6, ry = 3 + H(s, i + 180) * 4;
        g.fillStyle = cols[i % cols.length]; g.beginPath();
        blob(g, [x - rx, y, x - rx * 0.4, y - ry, x + rx * 0.5, y - ry * 0.8, x + rx, y + ry * 0.2, x + rx * 0.3, y + ry, x - rx * 0.5, y + ry * 0.7], 1); g.fill();
      }
    },
    sprinkle(g, s) {  // şeker serpmesi: renkli kapsüller + beyaz noktalar
      const cols = ['#ff5a7a', '#ffe14d', '#3ddc84', '#4fb3ff', '#ffffff', '#c084fc'];
      g.lineCap = 'round'; g.lineWidth = 2;
      for (let i = 0; i < 22; i++) {
        const x = -44 + H(s, i) * 88, y = -52 + H(s, i + 70) * 92, a = H(s, i + 140) * PI, L = 2.2 + H(s, i + 210) * 1.4;
        g.strokeStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(x - cos(a) * L, y - sin(a) * L); g.lineTo(x + cos(a) * L, y + sin(a) * L); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(-40 + H(s, i + 300) * 80, -48 + H(s, i + 330) * 84, 0.9, 0, TAU); g.fill(); }
    },
    wave(g, s) {      // okyanus: açık dalga çizgileri + küçük baloncuklar
      g.strokeStyle = 'rgba(200,245,255,0.55)'; g.lineWidth = 1.5; g.lineCap = 'round';
      for (let j = -7; j <= 7; j++) {
        const y0 = j * 7.5 + H(s, j) * 2, ph = H(s, j + 30) * TAU;
        g.beginPath();
        for (let x = -50; x <= 50; x += 4) { const y = y0 + sin(x * 0.28 + ph) * 1.8; if (x === -50) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.9;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-40 + H(s, i + 90) * 80, -46 + H(s, i + 120) * 84, 1.2 + H(s, i + 150), 0, TAU); g.stroke(); }
    },
    pixel(g, s) {     // retro piksel: 3 birimlik kareler, değişen parlaklık
      const c = 3.2;
      for (let i = -16; i < 16; i++) for (let j = -18; j < 12; j++) {
        const v = H(s, i * 37 + j * 101 + 5000);
        if (v < 0.55) continue;
        g.fillStyle = v < 0.8 ? 'rgba(255,255,255,' + ((v - 0.55) * 0.9).toFixed(2) + ')' : 'rgba(0,0,30,' + ((v - 0.8) * 1.3).toFixed(2) + ')';
        g.fillRect(i * c, j * c, c, c);
      }
    },
    cracks(g, s) {    // lav çatlakları: geniş turuncu ışıma + ince sarı damar
      const paths = [];
      for (let i = 0; i < 7; i++) {
        const pts = []; let x = -40 + H(s, i) * 80, y = -50 + H(s, i + 20) * 90;
        pts.push(x, y);
        for (let k = 0; k < 4; k++) { x += (H(s, i * 10 + k) - 0.5) * 18; y += 5 + H(s, i * 10 + k + 300) * 9; pts.push(x, y); }
        paths.push(pts);
      }
      const stroke = (w, col) => {
        g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const p of paths) { g.beginPath(); g.moveTo(p[0], p[1]); for (let k = 2; k < p.length; k += 2) g.lineTo(p[k], p[k + 1]); g.stroke(); }
      };
      stroke(4.2, 'rgba(255,120,30,0.35)'); stroke(2, '#ff8a1e'); stroke(0.9, '#ffe680');
    },
    panel(g, s) {     // robot: panel ek yerleri + perçinler + küçük mavi LED
      g.strokeStyle = 'rgba(28,32,42,0.75)'; g.lineWidth = 1.1; g.lineCap = 'round';
      const yA = -36 + H(s, 1) * 20, yB = yA + 16 + H(s, 2) * 14, xA = -20 + H(s, 3) * 16;
      g.beginPath(); g.moveTo(-50, yA); g.lineTo(50, yA); g.moveTo(-50, yB); g.lineTo(xA, yB); g.lineTo(xA, yB + 40); g.moveTo(xA + 14, yB); g.lineTo(50, yB); g.stroke();
      for (let i = 0; i < 9; i++) {
        const x = -44 + H(s, i + 40) * 88, y = (i % 2 ? yA : yB) + (H(s, i + 60) - 0.5) * 2;
        g.fillStyle = 'rgba(20,24,32,0.8)'; g.beginPath(); g.arc(x, y, 1.5, 0, TAU); g.fill();
        g.fillStyle = 'rgba(240,244,250,0.9)'; g.beginPath(); g.arc(x - 0.3, y - 0.35, 0.85, 0, TAU); g.fill();
      }
      const lx = -10 + H(s, 9) * 18, ly = yA + 7;
      g.fillStyle = '#0a3a4a'; g.beginPath(); g.arc(lx, ly, 2.2, 0, TAU); g.fill();
      g.fillStyle = '#7df9ff'; g.beginPath(); g.arc(lx, ly, 1.3, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(lx - 0.4, ly - 0.4, 0.5, 0, TAU); g.fill();
    },
    stars(g, s) {     // galaksi: bulutsu lekeleri + yıldız tozu + parıltılar
      const neb = [['rgba(255,90,200,', -14, -20], ['rgba(60,220,255,', 16, 4], ['rgba(170,110,255,', -6, 18]];
      for (let i = 0; i < 3; i++) {
        const n = neb[i], x = n[1] + (H(s, i) - 0.5) * 20, y = n[2] + (H(s, i + 9) - 0.5) * 20;
        const gr = g.createRadialGradient(x, y, 0, x, y, 16); gr.addColorStop(0, n[0] + '0.32)'); gr.addColorStop(1, n[0] + '0)');
        g.fillStyle = gr; g.fillRect(x - 16, y - 16, 32, 32);
      }
      for (let i = 0; i < 46; i++) {
        const x = -46 + H(s, i + 100) * 92, y = -54 + H(s, i + 200) * 94, a = 0.35 + H(s, i + 300) * 0.65, r = 0.45 + H(s, i + 400) * 0.7;
        g.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      const sc = ['#ffffff', '#7df9ff', '#ff9ae0'];
      for (let i = 0; i < 5; i++) {
        const x = -40 + H(s, i + 500) * 80, y = -48 + H(s, i + 600) * 86, r = 1.8 + H(s, i + 700) * 1.6;
        g.fillStyle = sc[i % 3]; g.beginPath(); sparklePath(g, x, y, r); g.fill();
      }
    },
    rainbow(g, s) {   // gökkuşağı: çapraz renk bantları (gölgelendirme altından görünsün diye yarı saydam)
      const cols = ['#ff3b3b', '#ff8a1a', '#ffe14d', '#3ddc84', '#3b82f6', '#7b3fe0', '#ff5aa0'];
      g.save(); g.rotate(-0.6); g.globalAlpha = 0.8;
      const w = 7.2, off = H(s, 1) * w * 7;
      for (let i = -12; i <= 12; i++) { g.fillStyle = cols[((i % 7) + 7) % 7]; g.fillRect(-80, i * w + off - 40, 160, w + 0.4); }
      g.restore();
    }
  };
  /** outlined() için desen bağlamı: P.pattern varsa { fn, cols (gövde renkleri kümesi), seed } */
  function patCtx(P, key) {
    if (!P || !P.pattern || !PATTERNS[P.pattern]) return null;
    const cols = new Set();
    for (const k of P.patKeys || []) if (P[k]) cols.add(P[k]);
    if (P.mane) cols.add(sh(P.mane, -0.08));
    let seed = 7; for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 100000;
    return { fn: PATTERNS[P.pattern], cols, seed };
  }

  /** Noktalardan geçen kapalı yumuşak eğri (Catmull-Rom → kübik Bezier). beginPath ÇAĞIRMAZ. */
  function blob(g, p, t) {
    const n = p.length >> 1; t = t == null ? 1 : t;
    g.moveTo(p[0], p[1]);
    for (let i = 0; i < n; i++) {
      const i0 = ((i - 1 + n) % n) * 2, i1 = i * 2, i2 = ((i + 1) % n) * 2, i3 = ((i + 2) % n) * 2;
      g.bezierCurveTo(
        p[i1] + (p[i2] - p[i0]) / 6 * t, p[i1 + 1] + (p[i2 + 1] - p[i0 + 1]) / 6 * t,
        p[i2] - (p[i3] - p[i1]) / 6 * t, p[i2 + 1] - (p[i3 + 1] - p[i1 + 1]) / 6 * t,
        p[i2], p[i2 + 1]);
    }
    g.closePath();
  }
  function ell(g, x, y, rx, ry, rot) {
    rot = rot || 0;
    g.moveTo(x + cos(rot) * abs(rx), y + sin(rot) * abs(rx));
    g.ellipse(x, y, abs(rx), abs(ry), rot, 0, TAU);
    g.closePath();
  }
  const B = (pts, t) => g => blob(g, pts, t);
  const EL = (x, y, rx, ry, rot) => g => ell(g, x, y, rx, ry, rot);
  function rrect(g, x, y, w, h, r) {
    r = min(r, w / 2, h / 2);
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function lines(g, segs, col, lw) {
    g.beginPath();
    for (const s of segs) {
      g.moveTo(s[0], s[1]);
      if (s.length === 4) g.lineTo(s[2], s[3]);
      else if (s.length === 6) g.quadraticCurveTo(s[2], s[3], s[4], s[5]);
    }
    g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.stroke();
  }
  function fillP(g, path, col) { g.beginPath(); path(g); g.fillStyle = col; g.fill(); }
  function spadePath(g, x, y, s) {
    g.moveTo(x, y - s);
    g.bezierCurveTo(x + s * 0.35, y - s * 0.55, x + s, y - s * 0.25, x + s * 0.92, y + s * 0.2);
    g.bezierCurveTo(x + s * 0.85, y + s * 0.62, x + s * 0.35, y + s * 0.66, x + s * 0.1, y + s * 0.38);
    g.quadraticCurveTo(x + s * 0.16, y + s * 0.82, x + s * 0.45, y + s);
    g.lineTo(x - s * 0.45, y + s);
    g.quadraticCurveTo(x - s * 0.16, y + s * 0.82, x - s * 0.1, y + s * 0.38);
    g.bezierCurveTo(x - s * 0.35, y + s * 0.66, x - s * 0.85, y + s * 0.62, x - s * 0.92, y + s * 0.2);
    g.bezierCurveTo(x - s, y - s * 0.25, x - s * 0.35, y - s * 0.55, x, y - s);
    g.closePath();
  }
  function starPath(g, x, y, ro, ri, n, rot) {
    n = n || 5; rot = rot || -PI / 2;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? ri : ro, a = rot + i * PI / n;
      if (i === 0) g.moveTo(x + cos(a) * r, y + sin(a) * r); else g.lineTo(x + cos(a) * r, y + sin(a) * r);
    }
    g.closePath();
  }
  function sparklePath(g, x, y, r) {
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
    g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
    g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
    g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
    g.closePath();
  }

  /** Cel-shading dolgu: taban renk + sol-üstte açık hilal + sağ-altta koyu hilal + parlak nokta + ince iç çizgi.
      o: {lt, dk, ltA, dkA, ld:[dx,dy], dd:[dx,dy], hl:[x,y,rx,ry,rot,a], lw, line, light:false, dark:false, fn(g) (klip içinde ek doku), ltAlpha} */
  function cel(g, path, base, o) {
    o = o || {};
    const dk = o.dk || mix(base, SHADOW_HUE, o.dkA != null ? o.dkA : 0.3);
    const lt = o.lt || mix(base, LIGHT_HUE, o.ltA != null ? o.ltA : 0.4);
    const dd = o.dd || [1.4, 3.2], ld = o.ld || [2, 2.4];
    g.beginPath(); path(g); g.fillStyle = base; g.fill();
    g.save(); g.clip();
    if (o.light !== false) {
      g.beginPath(); g.rect(-500, -500, 1000, 1000);
      g.save(); g.translate(ld[0], ld[1]); path(g); g.restore();
      g.globalAlpha = o.ltAlpha != null ? o.ltAlpha : 0.9; g.fillStyle = lt; g.fill('evenodd'); g.globalAlpha = 1;
    }
    if (o.dark !== false) {
      g.beginPath(); g.rect(-500, -500, 1000, 1000);
      g.save(); g.translate(-dd[0], -dd[1]); path(g); g.restore();
      g.fillStyle = dk; g.fill('evenodd');
    }
    if (o.fn) o.fn(g);
    // skin deseni: yalnızca gövde renkli şekillerin içine (klip etkin), parça üretiminde bir kez
    if (PAT && PAT.cols.has(base)) { g.save(); try { PAT.fn(g, PAT.seed); } catch (e) { /* desen çizilemedi */ } g.restore(); }
    if (o.hl) { const h = o.hl; g.beginPath(); ell(g, h[0], h[1], h[2], h[3], h[4] || 0); g.fillStyle = 'rgba(255,255,255,' + (h[5] != null ? h[5] : 0.55) + ')'; g.fill(); }
    g.restore();
    if (o.lw !== 0) { g.beginPath(); path(g); g.lineWidth = o.lw || 1.2; g.strokeStyle = o.line || LN; g.lineJoin = 'round'; g.stroke(); }
  }

  /** Göz. o: {ex, iris, inner(-1: burun solda / +1: burun sağda), style:'n'|'owl'|'bead', lidCol, lidN, look, sclera, spin} */
  function eye(g, x, y, rx, ry, o) {
    const ex = o.ex || 'n', ln = LN, style = o.style || 'n';
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (ex === 'b' && o.lidCol) {
      // kapalı göz kapağı: göz yerini kapak rengiyle doldur + kirpik çizgisi
      g.beginPath(); ell(g, x, y, rx * 1.02, ry * 1.02); g.fillStyle = o.lidCol; g.fill();
      g.beginPath(); g.moveTo(x - rx * 1.02, y + ry * 0.05); g.quadraticCurveTo(x, y + ry * 0.7, x + rx * 1.02, y + ry * 0.05);
      g.lineWidth = max(1.3, min(rx, ry) * 0.34); g.strokeStyle = ln; g.stroke();
      const d = o.inner === 1 ? -1 : 1;
      g.beginPath(); g.moveTo(x + d * rx * 0.98, y + ry * 0.08); g.lineTo(x + d * rx * 1.3, y - ry * 0.14); g.lineWidth = 1; g.stroke();
      return;
    }
    if (ex === 'b' || ex === 'h') {
      g.beginPath();
      if (ex === 'b') { g.moveTo(x - rx * 1.05, y + ry * 0.1); g.quadraticCurveTo(x, y + ry * 0.66, x + rx * 1.05, y + ry * 0.1); }
      else { g.moveTo(x - rx * 0.98, y + ry * 0.36); g.quadraticCurveTo(x, y - ry * 0.95, x + rx * 0.98, y + ry * 0.36); }
      g.lineWidth = max(1.5, min(rx, ry) * 0.46); g.strokeStyle = ln; g.stroke();
      if (ex === 'b') { // kirpik
        const d = o.inner === 1 ? -1 : 1;
        g.beginPath(); g.moveTo(x + d * rx * 1.02, y + ry * 0.1); g.lineTo(x + d * rx * 1.35, y - ry * 0.16); g.lineWidth = 1; g.stroke();
      }
      return;
    }
    g.save();
    g.beginPath(); ell(g, x, y, rx, ry);
    if (style === 'bead') {
      const gr = g.createLinearGradient(x, y - ry, x, y + ry);
      gr.addColorStop(0, sh(o.iris, -0.35)); gr.addColorStop(1, sh(o.iris, 0.25));
      g.fillStyle = gr;
    } else if (style === 'owl') {
      g.fillStyle = o.iris;
    } else {
      const gr = g.createLinearGradient(x, y - ry, x, y + ry * 0.4);
      gr.addColorStop(0, o.sclera ? sh(o.sclera, -0.14) : '#cfd5ec'); gr.addColorStop(0.55, o.sclera || '#ffffff');
      g.fillStyle = gr;
    }
    g.fill();
    g.save(); g.clip();
    if (ex === 'x') {
      if (style === 'bead') { g.beginPath(); ell(g, x, y, rx, ry); g.fillStyle = '#ffffff'; g.fill(); }
      g.beginPath();
      const rr = min(rx, ry) * 0.95, sp = o.spin || 0;
      for (let i = 0; i <= 36; i++) {
        const a = sp + i / 36 * TAU * 2.25, d = (i / 36) * rr;
        const px = x + cos(a) * d * (rx / min(rx, ry)), py = y + sin(a) * d * (ry / min(rx, ry));
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.lineWidth = max(1, rx * 0.22); g.strokeStyle = style === 'owl' ? '#1a1020' : ln; g.stroke();
    } else {
      const look = o.look != null ? o.look : rx * 0.16;
      let ir, ix, iy;
      if (style === 'owl') { ir = min(rx, ry) * 0.98; ix = x + look * 0.3; iy = y; }
      else if (style === 'bead') { ir = min(rx, ry) * 0.9; ix = x + look * 0.25; iy = y + ry * 0.05; }
      else { ir = min(rx, ry) * (ex === 'o' ? 0.58 : 0.8); ix = x + look; iy = y + (ex === 's' ? ry * 0.24 : ry * 0.07); }
      if (style === 'owl') {
        const gr = g.createRadialGradient(ix, iy + ir * 0.3, ir * 0.1, ix, iy, ir * 1.05);
        gr.addColorStop(0, sh(o.iris, 0.5)); gr.addColorStop(0.55, o.iris); gr.addColorStop(1, sh(o.iris, -0.32));
        g.beginPath(); ell(g, ix, iy, ir, ir * 1.02); g.fillStyle = gr; g.fill();
      } else if (style !== 'bead') {
        const gr = g.createLinearGradient(ix, iy - ir, ix, iy + ir);
        gr.addColorStop(0, sh(o.iris, -0.45)); gr.addColorStop(0.55, o.iris); gr.addColorStop(1, sh(o.iris, 0.5));
        g.beginPath(); ell(g, ix, iy, ir, ir * 1.05); g.fillStyle = gr; g.fill();
        g.lineWidth = 0.7; g.strokeStyle = rgba(sh(o.iris, -0.6), 0.85); g.stroke();
      }
      const pr = ir * (style === 'owl' ? (ex === 'o' ? 0.36 : 0.56) : style === 'bead' ? 0.62 : ex === 'o' ? 0.4 : 0.52);
      if (style !== 'bead') { g.beginPath(); ell(g, ix + look * 0.12, iy + ir * 0.04, pr, pr * 1.05); g.fillStyle = '#120a1a'; g.fill(); }
      g.fillStyle = '#ffffff';
      g.beginPath(); ell(g, ix - ir * 0.34, iy - ir * 0.4, ir * 0.36, ir * 0.3, -0.5); g.fill();
      g.beginPath(); ell(g, ix + ir * 0.36, iy + ir * 0.36, ir * 0.16, ir * 0.14); g.fill();
    }
    // göz kapakları (kararlı / üzgün / karakterin varsayılan bakışı)
    const lid = ex === 'f' ? 0.4 : ex === 's' ? 0.34 : (ex === 'n' ? (o.lidN || 0) : 0);
    if (lid > 0 && o.lidCol) {
      const inner = o.inner || -1, top = y - ry - 2;
      let yIn, yOut;
      if (ex === 's') { yIn = y - ry + 2 * ry * lid * 0.25; yOut = y - ry + 2 * ry * lid * 1.25; }
      else { yIn = y - ry + 2 * ry * lid * 1.3; yOut = y - ry + 2 * ry * lid * 0.3; }
      const yL = inner < 0 ? yIn : yOut, yR = inner < 0 ? yOut : yIn;
      g.beginPath(); g.moveTo(x - rx - 2, top); g.lineTo(x + rx + 2, top); g.lineTo(x + rx + 2, yR); g.lineTo(x - rx - 2, yL); g.closePath();
      g.fillStyle = o.lidCol; g.fill();
      g.beginPath(); g.moveTo(x - rx - 2, yL); g.lineTo(x + rx + 2, yR); g.lineWidth = 1.7; g.strokeStyle = ln; g.stroke();
    }
    g.restore();
    g.beginPath(); ell(g, x, y, rx, ry); g.lineWidth = style === 'owl' ? 1.8 : 1.2; g.strokeStyle = ln; g.stroke();
    if (style === 'n') { g.beginPath(); g.ellipse(x, y, rx, ry, 0, PI * 1.1, PI * 1.9); g.lineWidth = 2; g.stroke(); }
    g.restore();
  }

  /** Ağız (namlu/surat tipi karakterler). o: {cat, dark} */
  function mouth(g, x, y, w, ex, o) {
    o = o || {};
    const ln = LN, dark = o.dark || '#4a1426';
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (ex === 'h' || ex === 'o') {
      g.beginPath();
      if (ex === 'h') { g.moveTo(x - w, y - 0.4); g.quadraticCurveTo(x, y + w * 1.6, x + w, y - 0.4); g.quadraticCurveTo(x, y + w * 0.3, x - w, y - 0.4); }
      else ell(g, x, y + w * 0.45, w * 0.46, w * 0.6);
      g.closePath(); g.fillStyle = dark; g.fill();
      g.save(); g.clip();
      g.beginPath(); ell(g, x + w * 0.1, y + w * (ex === 'h' ? 1.05 : 1.0), w * 0.6, w * 0.42); g.fillStyle = '#ff7a8e'; g.fill();
      g.restore();
      g.lineWidth = 1.1; g.strokeStyle = ln; g.stroke();
      return;
    }
    g.beginPath();
    if (ex === 's') { g.moveTo(x - w * 0.7, y + w * 0.6); g.quadraticCurveTo(x, y - w * 0.05, x + w * 0.7, y + w * 0.6); }
    else if (ex === 'x') {
      g.moveTo(x - w * 0.85, y + w * 0.35);
      for (let i = 1; i <= 4; i++) g.quadraticCurveTo(x - w * 0.85 + (i - 0.5) * w * 0.425, y + w * (i % 2 ? 0 : 0.7), x - w * 0.85 + i * w * 0.425, y + w * 0.35);
    } else if (ex === 'f') {
      g.moveTo(x - w * 0.9, y + 0.2); g.quadraticCurveTo(x, y + w * 1.1, x + w * 0.9, y - 0.2); g.quadraticCurveTo(x, y + w * 0.3, x - w * 0.9, y + 0.2);
      g.closePath(); g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 1.1; g.strokeStyle = ln; g.stroke();
      g.beginPath(); g.moveTo(x - w * 0.2, y + w * 0.2); g.lineTo(x - w * 0.2, y + w * 0.62); g.moveTo(x + w * 0.3, y + w * 0.15); g.lineTo(x + w * 0.3, y + w * 0.58);
      g.lineWidth = 0.7; g.stroke();
      return;
    } else if (o.cat) {
      g.moveTo(x, y - 0.9); g.lineTo(x, y + 0.3);
      g.moveTo(x - w * 0.9, y - 0.1); g.quadraticCurveTo(x - w * 0.45, y + w * 0.75, x, y + 0.2); g.quadraticCurveTo(x + w * 0.45, y + w * 0.75, x + w * 0.9, y - 0.1);
    } else {
      g.moveTo(x - w * 0.8, y); g.quadraticCurveTo(x, y + w * 0.8, x + w * 0.8, y - 0.2);
    }
    g.lineWidth = 1.2; g.strokeStyle = ln; g.stroke();
  }

  /* =====================================================================
     SPRITE ÖNBELLEĞİ — siluetten kalın dış hat
     ===================================================================== */
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = max(1, w | 0); c.height = max(1, h | 0); return c; }
  /** Geçici tuvalin bellek deposunu hemen bırak (iOS Safari tuval belleğini çöp toplayıcıyı beklemeden geri alır). */
  function freeCanvas(c) { try { if (c) { c.width = 0; c.height = 0; } } catch (e) { /* yok say */ } }
  /** Özel (FM.gfx önbelleğine girmeyen) sprite: { c, w, h, ox, oy, k, b (bayt), u (son kullanım) }.
      Parça sprite'ları bayt bütçeli LRU önbellekte (PC) tutulur; gfx önbelleği yalnızca resize'da temizlendiği için
      botların her maçta değişen rastgele skin'leri ve kürsü/menü çözünürlükleri orada sınırsız birikiyordu. */
  function privSprite(w, h, ox, oy, fn) {
    const k = FM.gfx.rs();
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
    const g = c.getContext('2d');
    g.scale(k, k); g.translate(ox, oy);
    try { fn(g); } catch (e) { console.error('[render-chars sprite]', e); }
    return { c, w, h, ox, oy, k, b: c.width * c.height * 4, u: 0 };
  }
  /** Parçayı offscreen çizip siluetinden dış hat basar. box=[x0,y0,x1,y1] parça birimi, m = çözünürlük çarpanı. */
  function outlined(key, box, m, thick, P, draw, post) {
    const w = box[2] - box[0], h = box[3] - box[1], ox = -box[0], oy = -box[1];
    return privSprite(w * m, h * m, ox * m, oy * m, g => {
      const k = FM.gfx.rs(), W = g.canvas.width, H = g.canvas.height;
      const a = mkCanvas(W, H), t = a.getContext('2d');
      t.setTransform(k * m, 0, 0, k * m, ox * m * k, oy * m * k);
      t.lineJoin = 'round'; t.lineCap = 'round';
      const old = LN, oldPat = PAT; LN = P.line; PAT = patCtx(P, key);
      let b = null, nb = null;
      try {
        draw(t, P);
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
        if (thick > 0) {
          b = mkCanvas(W, H); const s = b.getContext('2d');
          s.drawImage(a, 0, 0); s.globalCompositeOperation = 'source-in'; s.fillStyle = P.line; s.fillRect(0, 0, W, H);
          const px = thick * k * m;
          if (P.neonGlow) {
            // neon / kor / kozmik: koyu dış hattın dışında parlak ince bir kenar + hafif ışıma (glowSoft: yalnızca yumuşak ışıma)
            nb = mkCanvas(W, H); const ns = nb.getContext('2d');
            ns.drawImage(a, 0, 0); ns.globalCompositeOperation = 'source-in'; ns.fillStyle = P.neonCol || '#ff4fe0'; ns.fillRect(0, 0, W, H);
            g.globalAlpha = P.glowSoft ? 0.09 : 0.07;
            for (let i = 0; i < 16; i++) { const an = i / 16 * TAU; g.drawImage(nb, cos(an) * px * 2.3, sin(an) * px * 2.3); }
            g.globalAlpha = P.glowSoft ? 0.5 : 1;
            for (let i = 0; i < 20; i++) { const an = i / 20 * TAU; g.drawImage(nb, cos(an) * px * 1.55, sin(an) * px * 1.55); }
            g.globalAlpha = 1;
          }
          const N = px > 7 ? 28 : px > 3.5 ? 20 : 16;
          for (let i = 0; i < N; i++) { const an = i / N * TAU; g.drawImage(b, cos(an) * px, sin(an) * px); }
          for (let i = 0; i < 8; i++) { const an = (i + 0.5) / 8 * TAU; g.drawImage(b, cos(an) * px * 0.55, sin(an) * px * 0.55); }
        }
        g.drawImage(a, 0, 0);
        g.restore();
        if (post) { g.save(); g.setTransform(k * m, 0, 0, k * m, ox * m * k, oy * m * k); g.lineJoin = 'round'; g.lineCap = 'round'; post(g, P); g.restore(); }
      } finally { LN = old; PAT = oldPat; freeCanvas(a); freeCanvas(b); freeCanvas(nb); }
    });
  }

  const PART_BOX = { head: [-38, -46, 40, 30], body: [-28, -36, 28, 14], arm: [-12, -10, 14, 28], leg: [-11, -7, 16, 18], wing: [-15, -10, 17, 42] };
  const RIM_W = 2.6;   // yerel oyuncu kenar ışığının dış hattan taşma payı (parça birimi; kamera yakınlaşınca birlikte büyür)
  /* ---------- parça önbelleği: bayt bütçeli LRU ----------
     Anahtar: karakter × skin × parça × ifade × dış hat × çözünürlük (m). Son ~1.5 sn'de kullanılan parçalar asla atılmaz
     (çalışma kümesi bütçeyi aşsa bile yeniden üretim döngüsü/takılma olmaz); bütçe aşılınca en eski kullanılanlar atılır
     ve tuvalleri hemen serbest bırakılır. Bütçe sprite çözünürlüğüyle ölçeklenir (telefon ~21 MB, 4K en çok 64 MB). */
  const PC = new Map();
  let pcBytes = 0, NOW = 0, portBuild = false;
  const KEEP_MS = 1500;
  function stampNow() { NOW = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function pcBudget() { const k = FM.gfx.rs(); return clamp(k * k * 7e6, 16e6, 64e6); }
  function pcDrop(key, s) {
    PC.delete(key); pcBytes -= s.b || 0;
    if (pcBytes < 0) pcBytes = 0;
    freeCanvas(s.c);
  }
  /** mode 'stale': yalnızca eski çözünürlüklüleri at; aksi halde bütçenin %80'ine inene dek en eski kullanılanları at.
      keep: az önce üretilip döndürülecek olan parçanın anahtarı (asla atılmaz). */
  function pcTrim(mode, keep) {
    const bud = pcBudget();
    if (!mode && pcBytes <= bud) return;
    const goal = mode ? 0 : bud * 0.8, cut = NOW - KEEP_MS, rs = FM.gfx.rs();
    const old = [];
    for (const [key, s] of PC) if (key !== keep && (mode === 'stale' ? s.k !== rs : s.u < cut)) old.push([key, s]);
    old.sort((p, q) => p[1].u - q[1].u);
    for (const [key, s] of old) { if (pcBytes <= goal) break; pcDrop(key, s); }
  }
  function part(id, skin, name, v, m, ol) {
    const key = 'fmc|' + id + '|' + skin + '|' + name + '|' + v + '|' + ol + '@' + m;
    const k = FM.gfx.rs();
    let s = PC.get(key);
    if (s && s.k === k) { if (!portBuild) s.u = NOW; return s; }
    if (s) pcDrop(key, s);   // eski çözünürlük (o karede elde tutulan referans yok: part() sonucu hemen çizilir)
    const D = DEF[id];
    const typ = (name === 'armF' || name === 'armB') ? 'arm' : (name === 'legF' || name === 'legB') ? 'leg' : (name === 'wingF' || name === 'wingB') ? 'wing' : name;
    const back = name === 'armB' || name === 'legB' || name === 'wingB';
    const box = (D.box && D.box[typ]) || PART_BOX[typ];
    let P = pal(id, skin, back);
    let th = ol ? (D.thick || 2.5) * (typ === 'head' ? 1.08 : typ === 'body' ? 1 : 0.9) : 0;
    // kenar ışığı geçişi (ol = 'rim:#renk'): aynı parça, oyuncu renginde ve daha kalın dış hatla — normal figürün ALTINA
    // çizilir, yalnızca silüetin dışına taşan renkli halka görünür (yerel oyuncu işareti; neon parlaması kapalı)
    if (typeof ol === 'string' && ol.indexOf('rim:') === 0) { P = Object.assign({}, P, { line: ol.slice(4), neonGlow: false }); th += RIM_W; }
    const fn = typ === 'head' ? (g, PP) => D.head(g, PP, v || 'n')
      : typ === 'body' ? (g, PP) => D.body(g, PP)
      : (g, PP) => D[typ](g, PP, back);
    const post = typ === 'head' && D.headPost ? (g, PP) => D.headPost(g, PP, v || 'n') : null;
    s = outlined('fmc|' + id + '|' + skin + '|' + name + '|' + v + '|' + ol, box, m, th, P, fn, post);
    stampNow();
    s.u = portBuild ? NOW - KEEP_MS - 1 : NOW;
    PC.set(key, s); pcBytes += s.b;
    if (pcBytes > pcBudget()) pcTrim(null, key);
    return s;
  }
  function blit(ctx, s, m) { ctx.drawImage(s.c, -s.ox / m, -s.oy / m, s.w / m, s.h / m); }
  function limb(ctx, s, x, y, a, ls, m) {
    ctx.save(); ctx.translate(x, y);
    if (a) ctx.rotate(-a);
    if (ls !== 1) ctx.scale(1, ls);
    ctx.drawImage(s.c, -s.ox / m, -s.oy / m, s.w / m, s.h / m);
    ctx.restore();
  }

  /* =====================================================================
     HER KAREDE ÇİZİLEN ESNEK PARÇALAR (kurdele, kuyruk, pelerin)
     ===================================================================== */
  const RIB_L = new Float32Array(20), RIB_R = new Float32Array(20);
  /** Dalgalanan kurdele/atkı ucu. ang: akış yönü (rad), ph: dalga fazı. Önce kalın dış hat, sonra dolgu. */
  function ribbon(ctx, x, y, ang, len, w0, w1, ph, amp, col, colL, line) {
    const N = 6;
    let px = x, py = y, a = ang;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      a = ang + sin(ph - s * 3.4) * amp * s;
      if (i > 0) { px += cos(a) * len / N; py += sin(a) * len / N; }
      const w = (w0 + (w1 - w0) * s) * 0.5, nx = -sin(a) * w, ny = cos(a) * w;
      RIB_L[i * 2] = px + nx; RIB_L[i * 2 + 1] = py + ny; RIB_R[i * 2] = px - nx; RIB_R[i * 2 + 1] = py - ny;
    }
    const tx = px - cos(a) * w1 * 0.75, ty = py - sin(a) * w1 * 0.75;
    ctx.beginPath(); ctx.moveTo(RIB_L[0], RIB_L[1]);
    for (let i = 1; i < N; i++) ctx.quadraticCurveTo(RIB_L[i * 2], RIB_L[i * 2 + 1], (RIB_L[i * 2] + RIB_L[i * 2 + 2]) / 2, (RIB_L[i * 2 + 1] + RIB_L[i * 2 + 3]) / 2);
    ctx.lineTo(RIB_L[N * 2], RIB_L[N * 2 + 1]);
    ctx.lineTo(tx, ty);
    ctx.lineTo(RIB_R[N * 2], RIB_R[N * 2 + 1]);
    for (let i = N - 1; i > 0; i--) ctx.quadraticCurveTo(RIB_R[i * 2], RIB_R[i * 2 + 1], (RIB_R[i * 2] + RIB_R[i * 2 - 2]) / 2, (RIB_R[i * 2 + 1] + RIB_R[i * 2 - 1]) / 2);
    ctx.lineTo(RIB_R[0], RIB_R[1]);
    ctx.closePath();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 4.2; ctx.strokeStyle = line; ctx.stroke();
    ctx.fillStyle = col; ctx.fill();
    // üst kenarda ışık şeridi
    ctx.beginPath(); ctx.moveTo(RIB_L[0], RIB_L[1]);
    for (let i = 1; i <= N - 1; i++) ctx.lineTo(RIB_L[i * 2] * 0.7 + RIB_R[i * 2] * 0.3, RIB_L[i * 2 + 1] * 0.7 + RIB_R[i * 2 + 1] * 0.3);
    ctx.lineWidth = 1; ctx.strokeStyle = colL; ctx.globalAlpha *= 0.85; ctx.stroke(); ctx.globalAlpha /= 0.85;
  }
  /** Kıvrık kedi kuyruğu (çizgili). */
  function tailCurl(ctx, P, p, x0, y0) {
    if (p.backRot) { ctx.save(); ctx.translate(x0, y0); ctx.rotate(p.backRot); ctx.translate(-x0, -y0); tailCurl(ctx, P, Object.assign({}, p, { backRot: 0 }), x0, y0); ctx.restore(); return; }
    const fl = clamp(p.flow, 0, 1.2), w = p.tw;
    const a = sin(w) * 2.2, b = cos(w * 1.3) * 2;
    const x1 = x0 - 8 - fl * 4, y1 = y0 + 2 + fl * 2 + a;
    const x2 = x0 - 17 - fl * 6, y2 = y0 - 6 - (1 - fl) * 3 + b;
    const x3 = x0 - 11 - fl * 8 + a, y3 = y0 - 16 + fl * 6 + b * 0.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    ctx.strokeStyle = P.line; ctx.lineWidth = 4.4 + 4.6; ctx.stroke();
    ctx.strokeStyle = P.fur; ctx.lineWidth = 4.4; ctx.stroke();
    ctx.setLineDash([2.4, 3.2]); ctx.lineDashOffset = -1;
    ctx.strokeStyle = P.stripe; ctx.lineWidth = 4.4; ctx.lineCap = 'butt'; ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0 - 1, y0 - 1.2); ctx.bezierCurveTo(x1 - 0.6, y1 - 1.4, x2 + 0.6, y2 - 1.2, x3 + 0.8, y3 - 0.4);
    ctx.strokeStyle = rgba(mix(P.fur, '#ffffff', 0.6), 0.7); ctx.lineWidth = 1.1; ctx.stroke();
  }
  /** İnce aslan kuyruğu + püskül. */
  function tailTuft(ctx, P, p, x0, y0) {
    if (p.backRot) { ctx.save(); ctx.translate(x0, y0); ctx.rotate(p.backRot); ctx.translate(-x0, -y0); tailTuft(ctx, P, Object.assign({}, p, { backRot: 0 }), x0, y0); ctx.restore(); return; }
    const fl = clamp(p.flow, 0, 1.2), w = p.tw;
    const a = sin(w) * 2.4, b = cos(w * 1.2) * 2.2;
    const x1 = x0 - 6 - fl * 3, y1 = y0 + 9 - fl * 2 + a * 0.5;
    const x2 = x0 - 15 - fl * 5, y2 = y0 + 9 - fl * 5 + b;
    const x3 = x0 - 21 - fl * 6 + a, y3 = y0 + 0.5 - fl * 4 + b * 0.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    ctx.strokeStyle = P.line; ctx.lineWidth = 2.6 + 4.4; ctx.stroke();
    ctx.strokeStyle = P.fur; ctx.lineWidth = 2.6; ctx.stroke();
    const ang = Math.atan2(y3 - y2, x3 - x2);
    ctx.save(); ctx.translate(x3, y3); ctx.rotate(ang);
    ctx.beginPath(); blob(ctx, [-2, -3.2, 2.6, -4, 6.6, -2.2, 8, 0.6, 5, 3.8, 0, 3.6, -2.4, 1]);
    ctx.lineWidth = 4.2; ctx.strokeStyle = P.line; ctx.stroke();
    ctx.fillStyle = P.mane; ctx.fill();
    ctx.beginPath(); blob(ctx, [0, -2.2, 3, -2.8, 5.6, -1.2, 3.6, 0.2, 0.4, 0.2]); ctx.fillStyle = P.maneL; ctx.fill();
    ctx.restore();
  }
  /** Kralın pelerini (gövde-eğim uzayında, omuzlardan sarkar, koşu hızıyla geriye savrulur). */
  function capeDraw(ctx, P, p) {
    const fl = clamp(p.flow, 0, 1.2), tw = p.tw;
    const ax = -9.6, ay = -18, bx = 3.6, by = -18.2, L = 26 + fl * 4;
    const ang = (p.capeAng != null ? p.capeAng : 0.34 + fl * 0.56) + sin(tw * 0.8) * 0.05 * (0.4 + fl);
    // yelpaze: alt (sırt) kenar daha sarkık, üst (boyun) kenar daha yatay savrulur → kumaş açılır, yelenin altından görünür
    const angA = ang * (p.capeAng != null ? 1 : 0.74), angB = ang * (p.capeAng != null ? 1 : 1.3);
    const dx = -sin(ang), dy = cos(ang);
    const blx = ax - sin(angA) * L - 4 - fl * 1.5, bly = ay + cos(angA) * L + 1;
    const brx = bx - sin(angB) * (L - 2), bry = by + cos(angB) * (L - 2);
    const wv = sin(tw * 1.4) * (0.6 + fl * 1.6);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(ax + dx * L * 0.5 - 7 - fl * 3 + wv * 0.6, ay + dy * L * 0.5 - fl * 1.5, blx, bly);
    // dalgalı etek
    const n = 3;
    let lx = blx, ly = bly;
    for (let i = 1; i <= n; i++) {
      const t = i / n, ex = lerp(blx, brx, t), ey = lerp(bly, bry, t);
      const mx = (lx + ex) / 2 + dy * (i % 2 ? 1 : -1) * (1.6 + abs(wv)), my = (ly + ey) / 2 - dx * (i % 2 ? 1 : -1) * (1.6 + abs(wv)) * 0.4 + 1.2;
      ctx.quadraticCurveTo(mx, my, ex, ey);
      lx = ex; ly = ey;
    }
    ctx.quadraticCurveTo(bx + dx * L * 0.45 + 1.5, by + dy * L * 0.45, bx, by);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4.8; ctx.strokeStyle = P.line; ctx.stroke();
    const gr = ctx.createLinearGradient(0, ay, dx * L * 0.6, ay + dy * L);
    gr.addColorStop(0, P.capeL); gr.addColorStop(0.35, P.cape); gr.addColorStop(1, P.capeD);
    ctx.fillStyle = gr; ctx.fill();
    // kıvrım çizgileri
    ctx.beginPath();
    ctx.moveTo(ax + 3, ay + 2); ctx.quadraticCurveTo(ax + dx * L * 0.5 - 1, ay + dy * L * 0.5, lerp(blx, brx, 0.33) + 0.5, lerp(bly, bry, 0.33) - 1);
    ctx.moveTo(ax + 7, ay + 2); ctx.quadraticCurveTo(ax + dx * L * 0.5 + 3.5, ay + dy * L * 0.5, lerp(blx, brx, 0.66), lerp(bly, bry, 0.66) - 1);
    ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(P.capeD, 0.75); ctx.stroke();
    // kürk etek şeridi
    ctx.beginPath(); ctx.moveTo(blx, bly);
    lx = blx; ly = bly;
    for (let i = 1; i <= n; i++) {
      const t = i / n, ex = lerp(blx, brx, t), ey = lerp(bly, bry, t);
      const mx = (lx + ex) / 2 + dy * (i % 2 ? 1 : -1) * (1.6 + abs(wv)), my = (ly + ey) / 2 - dx * (i % 2 ? 1 : -1) * (1.6 + abs(wv)) * 0.4 + 1.2;
      ctx.quadraticCurveTo(mx, my, ex, ey); lx = ex; ly = ey;
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4 + 3.6; ctx.strokeStyle = P.line; ctx.stroke();
    ctx.lineWidth = 3.4; ctx.strokeStyle = P.ermine; ctx.stroke();
    ctx.fillStyle = P.spot;
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3, sx = lerp(blx, brx, t), sy = lerp(bly, bry, t) + 0.8;
      ctx.beginPath(); ell(ctx, sx, sy, 0.7, 1.3, ang); ctx.fill();
    }
  }

  /* =====================================================================
     KARAKTER TANIMLARI
     rig: hipY (kalça yüksekliği), legF/legB (kalçaya göre bacak), shF/shB (gövde uzayında omuz),
          neck (gövde uzayında kafa pivotu), head (pivot→kafa merkezi), top (kafa merkezinden en tepe), scale
     ===================================================================== */
  const DEF = {};

  /* ----------------------------- TAFTAF — maskeli kedi ----------------------------- */
  DEF.TAFTAF = {
    rig: { hipY: 12, legF: [3, 0], legB: [-3.5, 0], shF: [3, -13], shB: [-4.2, -13], neck: [1.5, -16.5], head: [1.5, -11.5], top: 26, scale: 1, bw: 11 },
    eyes: [[9.6, -1.4, 4.4], [-2.6, -1.4, 3.8]],
    head(g, P, ex) {
      // arka kulak
      cel(g, B([-15.5, -4, -18.5, -14.5, -15, -25.5, -8.5, -17.5, -4, -10.5]), P.fur, { dd: [1, 2.2] });
      cel(g, B([-14, -8.6, -15.6, -15.8, -14.2, -21.6, -10.6, -16.2, -8.2, -11.6]), P.earIn, { lw: 0.8, dd: [0.7, 1.3], ld: [0.8, 0.9], ltA: 0.45 });
      // ön kulak
      cel(g, B([2.5, -10.5, 6.5, -20.5, 10.5, -26, 14.8, -19, 16.6, -8.6, 9, -7.5]), P.fur, { dd: [1, 2.2] });
      cel(g, B([6.4, -11.6, 8.8, -19.4, 10.8, -22.4, 13.2, -18, 13.8, -11.4]), P.earIn, { lw: 0.8, dd: [0.7, 1.3], ld: [0.8, 0.9], ltA: 0.45 });
      // kafa
      const hd = B([0, -14.5, 9, -13.6, 15, -8.6, 18.2, -1.6, 19.6, 4.6, 16.2, 8.2, 12.6, 11.6, 5, 13.6, -4, 13.4, -11, 11, -15.6, 7.6, -19.6, 6, -17, 2, -18.6, -2.6, -15.6, -7, -9, -12.6]);
      cel(g, hd, P.fur, { hl: [-8, -6.5, 3.2, 1.8, -0.5, 0.3] });
      lines(g, [[-16.6, 4.6, -14.6, 5.6, -12.8, 5.2], [-16.2, 0.2, -14.2, 1.2, -12.6, 0.8], [15.6, 9.2, 14.2, 8.6]], rgba(P.furD, 0.9), 0.9);
      // maske bandı (kafaya kırpılmış)
      g.save(); g.beginPath(); hd(g); g.clip();
      cel(g, B([-21, -6.6, -8, -7.6, 3, -6.4, 13, -7.6, 23, -6.6, 23, 3.4, 14, 4.2, 4, 2.4, -3, 4.2, -10, 3.6, -21, 3]), P.mask,
        { lt: P.maskL, dk: P.maskD, dd: [0.5, 1.6], ld: [0.6, 1.4], lw: 1.1 });
      g.restore();
      // maske düğümü
      cel(g, B([-22, -3.4, -18.6, -4.8, -15.6, -2.6, -15.8, 1.2, -18.8, 2.4, -21.6, 0.8]), P.mask, { lt: P.maskL, dk: P.maskD, dd: [0.6, 1.2], ld: [0.6, 1] });
      lines(g, [[-18.8, -3.8, -17.4, -1.2, -18.6, 1.6]], P.maskD, 0.8);
      // gözler
      eye(g, 9.6, -1.4, 4.4, 5.3, { ex, iris: P.eye, inner: -1, lidCol: P.mask });
      eye(g, -2.6, -1.4, 3.8, 4.9, { ex, iris: P.eye, inner: 1, lidCol: P.mask, look: 0.9 });
      // allık
      g.fillStyle = rgba(P.blush, 0.5); g.beginPath(); ell(g, 14.4, 6.8, 2.5, 1.4); ell(g, -7.6, 6.6, 2.2, 1.3); g.fill();
      // ağız çevresi
      cel(g, B([-0.6, 4.2, 2.6, 3, 4.8, 3.8, 7, 3, 10.4, 4.2, 11, 7.4, 7.8, 9.8, 4.8, 9, 1.8, 9.8, -1.2, 7.6]), P.belly, { lw: 0.9, dd: [0.4, 1.3], ld: [0.6, 0.8], dkA: 0.16 });
      mouth(g, 4.8, 5.9, 2.4, ex, { cat: true });
      cel(g, B([2.6, 2.4, 7, 2.4, 4.8, 5.2]), P.nose, { lw: 1, dd: [0.3, 0.8], ld: [0.4, 0.5], hl: [4.2, 3, 0.9, 0.55, 0, 0.85] });
      // kep
      const capP = B([-16.4, -4.6, -16.2, -12.2, -9.6, -18.8, 0, -20.8, 9.2, -17.8, 14.4, -11.6, 15.6, -8.2, 6, -8.6, -5, -6.6]);
      cel(g, capP, P.cap, { lt: P.capL, dk: P.capD, hl: [-6, -15.2, 3.4, 1.5, -0.45, 0.45] });
      lines(g, [[0.4, -20.4, 4.6, -14.6, 4.8, -8.4], [0, -20.4, -6.6, -14, -9.6, -5.8]], rgba(P.capD, 0.9), 0.9);
      g.beginPath(); spadePath(g, 7.6, -13, 2.7); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 0.8; g.strokeStyle = LN; g.stroke();
      cel(g, EL(0.3, -20.6, 1.9, 1.25), P.capD, { lw: 0.9, light: false, dd: [0.3, 0.6] });
      cel(g, B([5.6, -11, 14, -11.6, 21.8, -10, 25.6, -7.6, 22.4, -5.6, 13.4, -6.2, 5.8, -7.6]), P.capD,
        { lt: P.cap, dk: sh(P.capD, -0.25), dd: [0.4, 1.2], ld: [0.8, 1.4] });
    },
    headPost(g, P) {
      g.globalAlpha = 0.6;
      lines(g, [[11.4, 5.6, 16, 4.6, 21, 4.2], [11.4, 7.2, 16, 7.4, 20.6, 8.6], [-1.4, 5.8, -5.4, 5, -9.6, 4.6], [-1.2, 7.4, -5.2, 7.6, -9.2, 8.4]], P.line, 0.75);
      g.globalAlpha = 1;
    },
    body(g, P) {
      const tor = B([-9, 2.6, -11, -4.6, -9.6, -12, -5, -16.6, 3.6, -17, 9, -12.6, 11, -4.6, 9.6, 2.6, 0, 4.2]);
      cel(g, tor, P.fur, { hl: [-5.6, -11, 2.4, 1.3, -0.6, 0.3] });
      cel(g, B([-1.6, -12.6, 4, -13.6, 8.6, -8, 8.6, -1, 4.6, 2.6, -1.4, 2, -3.4, -4]), P.belly, { lw: 0.9, dd: [0.6, 1.6], ld: [0.8, 1], dkA: 0.16 });
      lines(g, [[0.6, -10.8, 1.8, -9.2], [2.6, -11, 3.6, -9.2], [4.6, -11, 5.6, -9.4]], rgba(P.furD, 0.8), 0.8);
      lines(g, [[-9.4, -5, -7.4, -4.4], [-9.6, -2, -7.6, -1.6]], rgba(P.stripe, 0.95), 1.4);
      cel(g, B([-8.2, -17.6, 0, -16, 8.4, -17.8, 9, -14, 0, -12.4, -8.6, -14]), P.mask, { lt: P.maskL, dk: P.maskD, dd: [0.4, 1.2], ld: [0.6, 1] });
      cel(g, EL(3.6, -11.4, 2.6, 2.5), P.bell, { lw: 1, hl: [2.7, -12.4, 0.9, 0.6, 0, 0.9], dd: [0.6, 1.2], ld: [0.6, 0.6] });
      lines(g, [[1.3, -11.1, 5.9, -11.1], [3.6, -11.1, 3.6, -9.4]], LN, 0.7);
    },
    arm(g, P) {
      cel(g, B([-3.2, -1.6, 3.2, -1.6, 3.5, 5.4, 4.5, 9.2, 2.8, 12.6, -1.6, 12.9, -3.9, 9.8, -3.5, 4.6]), P.fur, {
        dd: [1, 2], ld: [1.2, 1.2],
        fn: g2 => lines(g2, [[-4, 2.6, 0, 3.8, 4, 2.4], [-4, 5.6, 0, 6.8, 4, 5.4]], P.stripe, 1.5)
      });
      lines(g, [[-0.6, 12.4, -0.4, 11], [1.6, 12.2, 1.6, 10.8]], rgba(P.line, 0.7), 0.7);
    },
    leg(g, P) {
      cel(g, B([-3.8, -1.6, 3.8, -1.6, 4, 5, 6.8, 6.8, 8.8, 9.6, 7.4, 12.4, 0.5, 12.6, -3.6, 11.4, -4, 5]), P.fur, {
        dd: [1, 2], ld: [1.2, 1.2],
        fn: g2 => lines(g2, [[-4.4, 2.4, 0, 3.4, 4.4, 2.2]], P.stripe, 1.6)
      });
      lines(g, [[5.2, 12.4, 5.4, 10.6], [7.4, 12.2, 7.6, 10.6]], rgba(P.line, 0.7), 0.7);
    },
    back(ctx, P, p) { tailCurl(ctx, P, p, -8.6, -3.4); },
    headBack(ctx, P, p) {
      const fl = clamp(p.flow, 0, 1.1), base = lerp(PI * 0.8, PI * 1.04, fl);
      ribbon(ctx, -20.6, -2.2, base - 0.12, 12 + fl * 4, 4, 2.8, p.tw * 1.3, 0.3 + fl * 0.25, P.mask, P.maskL, P.line);
      ribbon(ctx, -20.4, 0.2, base + 0.3, 10 + fl * 3, 3.6, 2.5, p.tw * 1.3 + 1.4, 0.3 + fl * 0.25, P.maskD, P.mask, P.line);
    }
  };

  /* ----------------------------- Caner — kızıl ayın kargası (lider) ----------------------------- */
  DEF.Caner = {
    rig: { hipY: 12, legF: [3, 0], legB: [-3, 0], shF: [-2.2, -12.6], shB: [-6, -12.6], neck: [2, -16.6], head: [1.5, -11], top: 29, scale: 1, idle: [-0.18, -0.32], bw: 11.6 },
    eyes: [[8.4, -1.6, 4.2], [-3, -1.6, 3.6]],
    head(g, P, ex) {
      // tüy tepeliği
      cel(g, B([-6.5, -10.5, -12.5, -18, -18, -25.5, -10.5, -20.5, -2.5, -13]), P.fur, { lt: P.furL, ltAlpha: 0.7, dd: [0.8, 1.8] });
      cel(g, B([-2.5, -13, -5.5, -22.5, -7.5, -30.5, 0, -22.5, 3.5, -13]), P.fur, {
        lt: P.furL, ltAlpha: 0.7, dd: [0.8, 1.8],
        fn: g2 => { g2.beginPath(); ell(g2, -6.8, -28.6, 3.2, 4.6, -0.3); g2.fillStyle = P.scarf; g2.fill(); }
      });
      cel(g, B([2, -13, 4.5, -21.5, 8.5, -26.5, 8.8, -18.5, 7.5, -11.5]), P.fur, { lt: P.furL, ltAlpha: 0.7, dd: [0.8, 1.8] });
      // kafa
      const hd = B([0, -14.6, 9, -13, 14.6, -7.6, 16.6, 0, 14, 7.6, 6, 12, -4, 12.6, -12, 8.6, -16.6, 1, -15, -7, -8.6, -13]);
      cel(g, hd, P.fur, {
        lt: P.furL, ltAlpha: 0.75, dk: sh(P.fur, -0.45), hl: [-7, -8, 3.4, 1.6, -0.5, 0.25],
        fn: g2 => lines(g2, [[-12, -2, -9.6, 0.6], [-11, 3, -8.6, 5.4], [-6, 8, -3.6, 9.6]], rgba(P.sheen, 0.5), 0.9)
      });
      // gözler (kızıl, parlayan)
      eye(g, 8.4, -1.6, 4.2, 4.6, { ex, iris: P.eye, sclera: P.sclera, inner: -1, lidCol: P.fur, lidN: 0.22 });
      eye(g, -3, -1.6, 3.6, 4.2, { ex, iris: P.eye, sclera: P.sclera, inner: 1, lidCol: P.fur, lidN: 0.22, look: 0.8 });
      // kaşlar (lider bakışı)
      let bIn = 0, bOut = 0;
      if (ex === 's') { bIn = -2; bOut = 1.2; } else if (ex === 'h') { bIn = -1.4; bOut = -1.4; } else if (ex === 'o' || ex === 'x') { bIn = -2.2; bOut = -1.4; } else if (ex === 'f') { bIn = 0.8; }
      cel(g, B([3.2, -6.6 + bIn, 13.2, -9.4 + bOut, 13.8, -7.2 + bOut, 3.6, -4.4 + bIn]), sh(P.fur, 0.12), { lt: P.sheen, ltAlpha: 0.6, ld: [0.4, 0.8], dd: [0.3, 0.6] });
      cel(g, B([-7.8, -7.6 + bOut, 0.6, -5.6 + bIn, 0.4, -3.8 + bIn, -8, -5.8 + bOut]), sh(P.fur, 0.12), { lt: P.sheen, ltAlpha: 0.6, ld: [0.4, 0.8], dd: [0.3, 0.6] });
      // gaga
      const open = ex === 'h' ? 0.32 : ex === 'o' ? 0.5 : ex === 'x' ? 0.18 : 0;
      if (open > 0) {
        g.beginPath(); g.moveTo(11, 4.2); g.lineTo(22, 4.6); g.lineTo(18, 9 + open * 6); g.lineTo(11.5, 8); g.closePath(); g.fillStyle = '#5a0e1a'; g.fill();
      }
      g.save(); g.translate(11.5, 5); g.rotate(open); g.translate(-11.5, -5);
      cel(g, g2 => { g2.moveTo(11, 4.8); g2.quadraticCurveTo(18.6, 4.2, 24.4, 4.8); g2.quadraticCurveTo(19, 8.6, 12, 7.8); g2.closePath(); }, P.beakD, { lt: P.beak, ld: [0.6, 0.8], dd: [0.4, 0.8] });
      g.restore();
      cel(g, g2 => { g2.moveTo(9.4, 0.4); g2.bezierCurveTo(12, -3.2, 19.4, -2.6, 27.6, 3.2); g2.quadraticCurveTo(20, 4.6, 11.4, 5.4); g2.quadraticCurveTo(9.4, 3.2, 9.4, 0.4); g2.closePath(); }, P.beak,
        { lt: mix(P.beak, '#ffffff', 0.45), dk: P.beakD, ld: [0.8, 1.2], dd: [0.4, 1.4], hl: [15, -0.6, 3, 0.8, 0.12, 0.6] });
      g.beginPath(); ell(g, 16, 0.6, 1.1, 0.55, 0.15); g.fillStyle = sh(P.beakD, -0.4); g.fill();
    },
    body(g, P) {
      // kuyruk tüyleri
      cel(g, B([-7, -4, -16, -1.6, -22, 2.6, -15.6, 3.4, -7, 1]), P.fur, { lt: P.furL, ltAlpha: 0.6, dd: [0.6, 1.4] });
      cel(g, B([-7, -0.6, -15, 3, -19.6, 8, -13, 6.8, -6, 2.6]), P.fur, { lt: P.furL, ltAlpha: 0.6, dd: [0.6, 1.4] });
      const tor = B([-9, 2.6, -11.6, -5, -10, -12.6, -5, -17, 4, -17, 9.4, -12, 10.8, -4.6, 8.6, 2.6, 0, 4]);
      cel(g, tor, P.fur, { lt: P.furL, ltAlpha: 0.85, dk: sh(P.fur, -0.45), hl: [-5.6, -6, 2.2, 1.2, -0.6, 0.25],
        fn: g2 => lines(g2, [[-9, -4, -7, -2.6], [-9.4, 0, -7.4, 1.2]], rgba(P.sheen, 0.5), 0.9) });
      cel(g, B([-1, -11, 5, -11.6, 9, -6, 8.6, -0.6, 4, 2.6, -2, 1.6, -3.4, -4.6]), P.belly, {
        lt: P.furL, ltAlpha: 0.6, lw: 0.9, dd: [0.6, 1.4],
        fn: g2 => lines(g2, [[-1.6, -0.6, 0.4, 0.6, 2.4, -0.6], [5, 0.4, 6.8, 1.4, 8.4, 0.2]], rgba(P.sheen, 0.55), 0.8)
      });
      // kızıl ay amblemi
      const cx = 5.8, cy = -4, r = 3.4;
      g.beginPath(); g.arc(cx, cy, r + 1.6, 0, TAU); g.fillStyle = rgba(P.moon, 0.25); g.fill();
      const moonP = g2 => { g2.arc(cx, cy, r, PI * 0.36, PI * 1.64, false); g2.arc(cx + r * 0.5, cy - r * 0.08, r * 0.8, PI * 1.56, PI * 0.44, true); g2.closePath(); };
      cel(g, moonP, P.moon, { lt: P.moonL, ld: [0.6, 0.8], dd: [0.3, 0.8], lw: 0.9 });
      // atkı (boyunda, kafanın altında görünür)
      cel(g, B([-9.6, -16.4, 0, -14.6, 9.6, -16.6, 10.8, -10.6, 0, -8.4, -10.2, -10.4]), P.scarf, {
        lt: P.scarfL, dk: P.scarfD, dd: [0.4, 1.6], ld: [0.6, 1.2], hl: [-5, -13.4, 2.4, 0.9, -0.1, 0.4],
        fn: g2 => lines(g2, [[-10, -13, 0, -11, 10.6, -13.2]], rgba(P.scarfD, 0.8), 1)
      });
      cel(g, B([-12.6, -14, -9, -15.4, -6.6, -12.4, -7.8, -8.6, -11.6, -8.8]), P.scarf, { lt: P.scarfL, dk: P.scarfD, dd: [0.4, 1], ld: [0.5, 0.8] });
      lines(g, [[-10.6, -13.6, -9.4, -11.6, -10.4, -9.6]], rgba(P.scarfD, 0.9), 0.8);
    },
    arm(g, P) {
      cel(g, B([-3.4, -1.6, 3.2, -1.6, 4.2, 5, 4.8, 10, 3.6, 14.6, 1.8, 12.4, 0.4, 15.4, -1.2, 12.6, -3.2, 14, -4.2, 9, -4, 4]), P.fur, {
        lt: P.furL, ltAlpha: 0.7, dk: sh(P.fur, -0.45), dd: [1, 2], ld: [1.2, 1.2],
        fn: g2 => lines(g2, [[0, 6, 0.4, 12.6], [-2, 7, -2.6, 12], [2.2, 7, 2.8, 12.4]], rgba(P.sheen, 0.55), 0.8)
      });
    },
    leg(g, P) {
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(0.4, 10.6); g.lineTo(6.4, 11.8); g.moveTo(0.4, 10.8); g.lineTo(4.4, 12.8); g.moveTo(-0.4, 10.8); g.lineTo(-3.8, 11.8);
      g.strokeStyle = P.leg; g.lineWidth = 2.3; g.stroke();
      g.fillStyle = mix(P.leg, '#ffffff', 0.5); g.beginPath(); ell(g, 6.6, 11.8, 0.7, 0.6); ell(g, 4.6, 12.8, 0.6, 0.5); g.fill();
      cel(g, B([-1.4, 3, 1.4, 3, 1.5, 11, -1.5, 11]), P.leg, { dd: [0.4, 0.6], ld: [0.4, 0.6], lw: 0.8 });
      cel(g, B([-4.3, -1.6, 4.3, -1.6, 4.6, 3.6, 1.2, 6.2, -3.8, 4.8]), P.fur, { lt: P.furL, ltAlpha: 0.7, dk: sh(P.fur, -0.45), dd: [0.8, 1.6], ld: [1, 1] });
    },
    back(ctx, P, p) {
      const fl = clamp(p.flow, 0, 1.1), base = lerp(PI * 0.66, PI * 1.03, fl) + (p.backRot || 0);
      ribbon(ctx, -10.6, -12.6, base - 0.06, 15 + fl * 5, 5.2, 3.8, p.tw * 1.2, 0.28 + fl * 0.24, P.scarf, P.scarfL, P.line);
      ribbon(ctx, -10.2, -10.4, base + 0.26, 12 + fl * 4, 4.6, 3.4, p.tw * 1.2 + 1.3, 0.28 + fl * 0.24, P.scarfD, P.scarf, P.line);
    }
  };

  /* ----------------------------- LUL — mavi goril, güneş gözlüklü ----------------------------- */
  DEF.LUL = {
    rig: { hipY: 10, legF: [4, 0], legB: [-4.6, 0], shF: [4, -16.6], shB: [-7.4, -17], neck: [2, -21], head: [2.4, -10.6], top: 23, scale: 1.06, hs: 1.12, idle: [0.5, -0.12], bw: 14.6 },
    box: { arm: [-14, -12, 17, 31], body: [-28, -36, 28, 14] },
    eyes: [[11, -3, 5], [-2.6, -3, 4.4]],
    head(g, P, ex) {
      // kulak (yakın taraf)
      const hd = B([-1, -15.6, 8, -14.6, 13.6, -10, 15.6, -3, 16, 5, 12, 11.6, 3, 14, -7, 13, -13.6, 8.6, -15.6, 0, -13.6, -8.6, -8, -13.6]);
      cel(g, B([-5.4, -13.6, -3.6, -19.4, -0.6, -15.4, 1.6, -19.8, 4, -14.6]), P.fur, { lt: P.furL, dd: [0.6, 1.2], ld: [0.6, 0.8] });
      cel(g, hd, P.fur, { lt: P.furL, ltAlpha: 0.8, hl: [-8, -8, 3, 1.6, -0.5, 0.25],
        fn: g2 => lines(g2, [[-13.6, 2, -11.4, 4], [-12.6, 6, -10.6, 7.8], [-11, -5, -8.6, -3.6]], rgba(P.furL, 0.7), 0.9) });
      cel(g, EL(-15.4, 1.4, 4, 4.8), P.fur, { lt: P.furL, dd: [0.6, 1.2], ld: [0.8, 0.8] });
      cel(g, EL(-15, 1.8, 2.2, 2.8), P.skinD, { light: false, lw: 0.8, dd: [0.4, 0.8] });
      // yüz maskesi
      cel(g, B([-6, -6.6, 0, -8.6, 6.6, -7, 12, -8.6, 17, -5, 18.6, 2, 17.6, 8, 13, 12.6, 5, 13.6, -2, 11.6, -6.6, 6.6, -8, 0]), P.skin, { lt: P.skinL, dk: P.skinD, ld: [1.4, 1.6], dd: [1, 2.4] });
      // ağız çıkıntısı
      cel(g, EL(10.4, 6.2, 8.2, 5.8), P.skinL, { lt: '#ffffff', ltA: 0.5, dk: P.skin, dd: [0.8, 1.6], ld: [1, 1], lw: 1 });
      g.fillStyle = P.mouth;
      g.beginPath(); ell(g, 8.4, 3.4, 1.4, 0.95, -0.3); ell(g, 13.2, 3.2, 1.4, 0.95, 0.3); g.fill();
      // ağız
      if (ex === 'h') {
        g.beginPath(); g.moveTo(4, 7.8); g.quadraticCurveTo(10.4, 16.4, 16.8, 7.4); g.quadraticCurveTo(10.4, 9.6, 4, 7.8); g.closePath();
        g.fillStyle = P.mouth; g.fill();
        g.save(); g.clip(); g.fillStyle = '#ffffff'; g.fillRect(3, 6.6, 15, 2.6); g.beginPath(); ell(g, 10.6, 13.4, 3.4, 2); g.fillStyle = '#ff7a8e'; g.fill(); g.restore();
        g.lineWidth = 1.1; g.strokeStyle = LN; g.stroke();
      } else if (ex === 'f') {
        g.beginPath(); rrect(g, 4.8, 7.4, 11.4, 3.6, 1.6); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 1.1; g.strokeStyle = LN; g.stroke();
        lines(g, [[4.8, 9.2, 16.2, 9.2], [8, 7.4, 8, 11], [11, 7.4, 11, 11], [14, 7.6, 14, 10.8]], LN, 0.6);
      } else if (ex === 'o') {
        g.beginPath(); ell(g, 10.6, 9.6, 2.4, 2.8); g.fillStyle = P.mouth; g.fill(); g.lineWidth = 1; g.strokeStyle = LN; g.stroke();
      } else if (ex === 's') {
        lines(g, [[5.4, 10.6, 10.4, 7.6, 15.6, 10.2]], LN, 1.3);
      } else if (ex === 'x') {
        mouth(g, 10.4, 8.8, 4.6, 'x');
      } else {
        lines(g, [[4.6, 8.4, 10.6, 11.4, 16.4, 7.6], [16.4, 7.6, 17.2, 7]], LN, 1.3);
      }
      // kaş kemeri
      let bIn = 0; if (ex === 'f') bIn = 1.4; else if (ex === 's') bIn = -1.6; else if (ex === 'o' || ex === 'x') bIn = -1.2;
      cel(g, B([-7.6, -7.6, 1, -10.4 + bIn * 0.5, 4.6, -9 + bIn, 10, -9.6 + bIn, 18.4, -10.4, 19, -6.6, 10, -5.2 + bIn * 0.5, 2, -5.4 + bIn * 0.5, -7.2, -4.4]), sh(P.fur, -0.1),
        { lt: P.furL, ltAlpha: 0.7, dd: [0.4, 1], ld: [0.6, 1] });
      // güneş gözlüğü
      const dy = ex === 's' ? 1 : 0;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(-6.6, -3.6 + dy); g.lineTo(-14.6, -2.2); g.strokeStyle = P.glass; g.lineWidth = 2.2; g.stroke();
      g.beginPath(); g.moveTo(2.4, -5 + dy); g.quadraticCurveTo(3.8, -6, 5.2, -5 + dy); g.lineWidth = 2; g.stroke();
      const lens = (pts) => {
        const path = B(pts);
        g.beginPath(); path(g);
        const gr = g.createLinearGradient(0, -8 + dy, 0, 2 + dy);
        gr.addColorStop(0, mix(P.glass, '#3a3a52', 0.7)); gr.addColorStop(0.5, P.glass); gr.addColorStop(1, mix(P.glass, P.glassHi, 0.35));
        g.fillStyle = gr; g.fill();
        g.save(); g.clip();
        if (ex === 'x') {
          let cx = 0, cy = 0; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; } cx /= pts.length / 2; cy /= pts.length / 2;
          g.beginPath();
          for (let i = 0; i <= 30; i++) { const a = i / 30 * TAU * 2, d = i / 30 * 3.8; const px = cx + cos(a) * d * 1.3, py = cy + sin(a) * d; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
          g.strokeStyle = '#ffffff'; g.lineWidth = 0.9; g.stroke();
        } else {
          g.beginPath(); g.moveTo(-8, -1 + dy); g.lineTo(-2, -9 + dy); g.lineTo(1.6, -9 + dy); g.lineTo(-4.4, -1 + dy); g.closePath();
          g.moveTo(5, 0 + dy); g.lineTo(12, -9 + dy); g.lineTo(16, -9 + dy); g.lineTo(9, 0 + dy); g.closePath();
          g.fillStyle = 'rgba(255,255,255,0.32)'; g.fill();
          g.beginPath(); g.moveTo(14.6, -1.2 + dy); g.lineTo(18.6, -6.6 + dy); g.lineTo(19.6, -6.6 + dy); g.lineTo(15.6, -1.2 + dy); g.closePath();
          g.fillStyle = 'rgba(255,255,255,0.22)'; g.fill();
        }
        g.beginPath(); path(g); g.lineWidth = 1.4; g.strokeStyle = rgba(P.glassHi, 0.6); g.stroke();
        g.restore();
        g.beginPath(); path(g); g.lineWidth = 1.3; g.strokeStyle = LN; g.stroke();
      };
      lens([-7.4, -6.2 + dy, 1.4, -6.8 + dy, 3, -3.2 + dy, 0.6, 1 + dy, -5.4, 0.8 + dy, -7.8, -2.6 + dy]);
      lens([4.6, -7 + dy, 16.6, -7.6 + dy, 19, -3.6 + dy, 16.4, 1.6 + dy, 7.6, 1.8 + dy, 4.2, -2.4 + dy]);
    },
    body(g, P) {
      // geniş omuzlu V gövde
      const tor = B([-11.6, 3, -13.6, -5, -14.6, -14, -10.6, -21, 0, -23.8, 10, -21.4, 15.4, -13.6, 14.4, -3.6, 9.4, 3.4, -1.6, 4.6]);
      cel(g, tor, P.fur, { lt: P.furL, ltAlpha: 0.85, hl: [-8.6, -16, 3.4, 1.6, -0.6, 0.22],
        fn: g2 => lines(g2, [[-12.6, -4, -10.6, -2.4], [-12, 0, -10, 1.4], [-11.6, -10, -9.6, -8.4], [-9, -18, -7, -16.6]], rgba(P.furL, 0.75), 0.9) });
      // göğüs kasları
      cel(g, B([-3.6, -19, 4.6, -20.4, 12.4, -17.4, 13, -9.4, 7, -7, 1, -8, -4.4, -12]), P.skin, { lt: P.skinL, dk: P.skinD, ld: [1, 1.2], dd: [0.8, 1.8], hl: [6.6, -17.4, 2.6, 1.2, -0.2, 0.45] });
      lines(g, [[4.6, -19.4, 4.2, -13.4, 5, -7.6], [-1.6, -11.6, 2, -10.6, 4.6, -12]], rgba(P.skinD, 0.95), 1);
      // karın
      cel(g, B([-0.6, -5.2, 5.4, -6.2, 10.6, -3.4, 10.2, 1.4, 4.4, 3.6, -1.2, 2]), mix(P.skin, P.fur, 0.3), { lt: P.skin, dk: P.skinD, ld: [0.8, 1], dd: [0.6, 1.2], lw: 0.9 });
    },
    arm(g, P) {
      // pazı + kalın ön kol + kocaman yumruk
      cel(g, B([-5.6, -3.4, 4.8, -3.8, 7, 2, 6, 7.4, 8, 11.6, 8.6, 16.6, 3, 21.6, -4.8, 20.6, -7, 15.4, -5.4, 9.4, -6.8, 3.6]), P.fur, {
        lt: P.furL, ltAlpha: 0.85, dd: [1.2, 2.2], ld: [1.4, 1.4], hl: [-2.6, 0, 1.6, 2.6, 0.2, 0.25],
        fn: g2 => lines(g2, [[-5, 3.6, -3.4, 5.6], [-5.4, 9.6, -3.6, 11.4], [3.6, 2, 4.6, 4.4], [-5.6, 6.6, 0, 8.6, 5.8, 6.6]], rgba(P.furL, 0.75), 0.9)
      });
      cel(g, B([-5.6, 14.4, 2.6, 12.8, 8.6, 14.6, 9, 20, 3.4, 23.4, -4.6, 22.4, -6.6, 18]), P.skin, { lt: P.skinL, dk: P.skinD, dd: [0.8, 1.8], ld: [1, 1], hl: [-1, 15.4, 2.4, 0.9, -0.1, 0.5] });
      lines(g, [[-3, 15.2, -2.2, 17.2], [0.4, 14.4, 1.2, 16.6], [3.8, 14.4, 4.4, 16.8], [6.8, 15.2, 7.2, 17.4]], rgba(P.skinD, 0.95), 0.9);
    },
    leg(g, P) {
      cel(g, B([-5.2, -2, 5.2, -2, 5.6, 4.4, 8.4, 6, 9.6, 8.6, 8, 10.6, -4, 10.6, -5.6, 7.4]), P.fur, { lt: P.furL, ltAlpha: 0.8, dd: [1, 1.8], ld: [1.2, 1.2] });
      cel(g, B([-4.4, 8.2, 8.4, 7.8, 9.8, 9, 8.2, 10.8, -4.2, 10.8]), P.skin, { lt: P.skinL, dk: P.skinD, light: false, dd: [0.3, 0.6], lw: 0.9 });
      lines(g, [[5.6, 7, 6, 9], [7.6, 7.4, 8, 9.2]], rgba(P.line, 0.6), 0.7);
    }
  };

  /* ----------------------------- ertan — gözlüklü penguen, mavi ceket, beyaz spor ayakkabı ----------------------------- */
  DEF.ertan = {
    rig: { hipY: 10.4, legF: [3.6, 0], legB: [-4.2, 0], shF: [3, -12], shB: [-4.6, -12], neck: [1.5, -16], head: [1.5, -11.2], top: 21, scale: 1, bw: 12.6, bf: 11.6 },
    eyes: [[9.2, -1.6, 3.4], [0.2, -1.6, 3]],
    head(g, P, ex) {
      cel(g, B([-3, -12.6, -5.4, -19, -1.2, -15.6, 0.4, -20.6, 2.6, -15.4, 6, -18.6, 5, -12.4]), P.fur, { lt: P.furL, dd: [0.6, 1.2], ld: [0.6, 0.8] });
      const hd = B([0, -14.6, 9, -13, 14.6, -7.6, 16, 0, 13.6, 7.6, 6, 12.6, -4, 12.6, -12, 8.6, -15.6, 0.6, -13.6, -7.6, -8, -12.6]);
      cel(g, hd, P.fur, { lt: P.furL, ltAlpha: 0.85, hl: [-7.6, -8, 3, 1.6, -0.5, 0.28] });
      cel(g, B([-4.6, -6.6, 1, -9.6, 7.6, -8.6, 12, -9.6, 16, -5.6, 16.8, 1.6, 14.6, 8, 8, 11, 2, 9.6, -3, 6, -6, 0.6]), P.face, { dk: mix(P.face, '#8a93c8', 0.35), ld: [1, 1.2], dd: [1, 2] });
      g.fillStyle = rgba(P.blush, 0.55); g.beginPath(); ell(g, 14.4, 5.4, 2.2, 1.3); ell(g, -2.6, 4.8, 2, 1.2); g.fill();
      eye(g, 9.2, -1.6, 3.3, 4, { ex, iris: P.eye, inner: -1, lidCol: P.face });
      eye(g, 0.2, -1.6, 3, 3.7, { ex, iris: P.eye, inner: 1, lidCol: P.face, look: 0.7 });
      // yuvarlak turkuaz gözlük
      const lensR = [[9.4, -1.6, 5.3], [-0.4, -1.6, 4.5]];
      g.beginPath(); g.moveTo(-4.9, -2); g.lineTo(-14, -3); g.strokeStyle = P.glass; g.lineWidth = 1.6; g.lineCap = 'round'; g.stroke();
      for (const L of lensR) {
        g.beginPath(); ell(g, L[0], L[1], L[2], L[2]);
        g.fillStyle = rgba(P.glass, 0.26); g.fill();
        g.save(); g.clip();
        g.beginPath(); g.moveTo(L[0] - L[2], L[1] + 1); g.lineTo(L[0] + 1, L[1] - L[2] - 1); g.lineTo(L[0] + 3.4, L[1] - L[2] - 1); g.lineTo(L[0] - L[2] + 1.6, L[1] + 3.2); g.closePath();
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
        g.beginPath(); ell(g, L[0] + L[2] * 0.45, L[1] + L[2] * 0.45, L[2] * 0.22, L[2] * 0.14, -0.7); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill();
        g.restore();
        g.beginPath(); ell(g, L[0], L[1], L[2], L[2]);
        g.lineWidth = 2.6; g.strokeStyle = LN; g.stroke();
        g.lineWidth = 1.5; g.strokeStyle = P.glass; g.stroke();
      }
      g.beginPath(); g.moveTo(4.1, -2.6); g.quadraticCurveTo(4.1, -4.2, 4.1, -2.6); g.lineWidth = 1.6; g.strokeStyle = P.glass; g.stroke();
      // gaga
      const open = ex === 'h' ? 0.34 : ex === 'o' ? 0.5 : ex === 'x' ? 0.15 : 0;
      if (open > 0) { g.beginPath(); g.moveTo(12.6, 5.4); g.lineTo(20.4, 5.6); g.lineTo(16.6, 9.4 + open * 5); g.lineTo(12.8, 8.4); g.closePath(); g.fillStyle = '#7a1a2a'; g.fill(); }
      g.save(); g.translate(12.6, 5.8); g.rotate(open); g.translate(-12.6, -5.8);
      cel(g, g2 => { g2.moveTo(12.6, 5.6); g2.quadraticCurveTo(17.6, 5.4, 21.4, 5.6); g2.quadraticCurveTo(17.4, 8.6, 13, 8); g2.closePath(); }, P.beakD, { lt: P.beak, ld: [0.6, 0.8], dd: [0.4, 0.8] });
      g.restore();
      cel(g, g2 => { g2.moveTo(11.6, 2.6); g2.bezierCurveTo(14.6, 0.8, 20, 1.8, 23.6, 4.6); g2.quadraticCurveTo(18, 6.4, 12.4, 6.2); g2.quadraticCurveTo(11, 4.4, 11.6, 2.6); g2.closePath(); }, P.beak,
        { lt: mix(P.beak, '#ffffff', 0.45), dk: P.beakD, ld: [0.6, 1], dd: [0.4, 1.2], hl: [16, 2.6, 2.4, 0.7, 0.15, 0.6] });
    },
    body(g, P) {
      cel(g, B([-9.6, -0.4, -15, 3.2, -9.6, 4.4]), P.fur, { lt: P.furL, dd: [0.6, 1], ld: [0.6, 0.8] });
      const tor = B([-10.6, 3, -12.6, -4.6, -11, -12, -6, -16.6, 3.6, -17, 9.6, -12.6, 11.6, -4.6, 10, 3, 0, 4.8]);
      cel(g, tor, P.jacket, { lt: P.jacketL, dk: P.jacketD, hl: [-6.6, -10, 2.4, 1.4, -0.6, 0.35] });
      cel(g, B([-1, -15, 5, -15.6, 9.2, -10, 9.4, -2, 6, 3.4, 0, 3.6, -2.6, -4]), P.belly, { dk: mix(P.belly, '#8a93c8', 0.35), ld: [0.8, 1], dd: [0.8, 1.6] });
      // fermuar kenarı
      g.beginPath(); g.moveTo(-1, -15); g.bezierCurveTo(-3, -9, -3.2, -2, 0, 3.6);
      g.lineWidth = 1.6; g.strokeStyle = P.jacketD; g.stroke(); g.lineWidth = 0.8; g.strokeStyle = LN; g.stroke();
      g.fillStyle = mix(P.jacketD, '#ffffff', 0.4);
      for (let i = 0; i < 6; i++) { const t = i / 5, y = -14 + t * 16, x = -1.6 - sin(t * PI) * 1.4; g.fillRect(x - 0.5, y, 1.1, 0.7); }
      // yaka
      cel(g, B([-8, -17.4, -2, -15.2, -0.6, -11.8, -6.4, -12.6]), P.jacketL, { lt: '#ffffff', ltA: 0.5, dk: P.jacket, dd: [0.4, 1], ld: [0.4, 0.6], lw: 1 });
      cel(g, B([4, -16.2, 9.8, -16.8, 8.8, -12, 4.4, -13]), P.jacketL, { lt: '#ffffff', ltA: 0.5, dk: P.jacket, dd: [0.4, 1], ld: [0.4, 0.6], lw: 1 });
      lines(g, [[-8.4, -3.6, -4.2, -3.2]], rgba(P.jacketD, 0.95), 1.1);
      g.beginPath(); ell(g, -6.4, -8.8, 1.6, 1.6); g.fillStyle = P.shoeAcc; g.fill(); g.lineWidth = 0.7; g.strokeStyle = LN; g.stroke();
    },
    arm(g, P) {
      cel(g, B([-3.4, -1.6, 3.4, -1.6, 3.6, 6, 2.8, 8.6, -2.8, 8.6, -3.6, 6]), P.jacket, { lt: P.jacketL, dk: P.jacketD, dd: [1, 1.8], ld: [1, 1] });
      cel(g, B([-2.6, 8.4, 2.8, 8.4, 3.4, 12.6, 1.4, 15.8, -1, 15.4, -2.8, 12.2]), P.fur, { lt: P.furL, dd: [0.8, 1.4], ld: [0.8, 0.8] });
      cel(g, B([-3.4, 6.6, 3.4, 6.6, 3.6, 9.4, -3.6, 9.4]), P.jacketD, { lt: P.jacket, light: true, ld: [0.4, 0.6], dd: [0.3, 0.6], lw: 0.9 });
    },
    leg(g, P) {
      cel(g, B([-2.4, -1.6, 2.4, -1.6, 2.6, 3.4, -2.6, 3.4]), P.fur, { dd: [0.5, 0.8], ld: [0.5, 0.6] });
      const shoe = B([-5.2, 2.2, 2.8, 1.6, 6.4, 3.2, 10.2, 5.4, 11.6, 8, 10.4, 10.6, -4.6, 10.6, -6, 7.2]);
      cel(g, shoe, P.shoe, { dk: mix(P.shoe, '#8a93c8', 0.4), ld: [0.8, 0.8], dd: [0.6, 1.2], hl: [7.6, 4.8, 1.6, 0.8, 0.5, 0.9],
        fn: g2 => {
          g2.fillStyle = P.sole; g2.fillRect(-8, 8.8, 22, 3);
          lines(g2, [[-7, 8.8, 13, 8.8]], rgba(P.line, 0.6), 0.7);
          lines(g2, [[-3.8, 7, 2.4, 6.6, 7.8, 4.6]], P.shoeAcc, 1.9);
          g2.beginPath(); ell(g2, 10.2, 7.8, 1.6, 2.2, 0.4); g2.fillStyle = rgba(P.shoeAcc, 0.35); g2.fill();
        } });
      lines(g, [[0.2, 2.6, 1.8, 3.8], [2, 2.4, 3.4, 3.6], [3.6, 2.6, 4.8, 3.8]], rgba(P.line, 0.75), 0.8);
    }
  };

  /* ----------------------------- Kral — taçlı aslan, kırmızı pelerin ----------------------------- */
  /** Yele tutamları: merkez etrafında dışa doğru kıvrılan damla biçimli tutamlar (katmanlı, gür görünüm). */
  function manePetals(g, cx, cy, n, r0, r1, w, cols, off, swirl, sy, line) {
    for (let i = 0; i < n; i++) {
      const a = off + i / n * TAU, ta = a + swirl;
      const bx = cx + cos(a) * r0, by = cy + sin(a) * r0 * sy;
      const tx = cx + cos(ta) * r1, ty = cy + sin(ta) * r1 * sy;
      const nx = -sin(a) * w, ny = cos(a) * w * sy;
      const mx = bx + (tx - bx) * 0.55, my = by + (ty - by) * 0.55;
      const path = g2 => {
        g2.moveTo(bx + nx, by + ny);
        g2.quadraticCurveTo(mx + nx * 1.25, my + ny * 1.25, tx, ty);
        g2.quadraticCurveTo(mx - nx * 0.9, my - ny * 0.9, bx - nx, by - ny);
        g2.closePath();
      };
      cel(g, path, cols[i % cols.length], { ld: [0.8, 1], dd: [0.6, 1.4], lw: 0.9, line, ltAlpha: 0.75 });
    }
  }
  DEF.Kral = {
    rig: { hipY: 12, legF: [3, 0], legB: [-3.5, 0], shF: [3, -13], shB: [-4.6, -13], neck: [1.5, -16.5], head: [1.5, -11.2], top: 29, scale: 1, bw: 11 },
    eyes: [[8.6, -3.2, 3.4], [-0.8, -3.2, 3]],
    head(g, P, ex) {
      // gür yele: taban + iki kat kıvrımlı tutam
      cel(g, EL(-1.4, 1, 19, 18.6), P.mane, { light: false, lw: 0, dd: [1, 2] });
      manePetals(g, -1.4, 1, 14, 12.5, 24.5, 5.6, [P.mane, sh(P.mane, -0.08)], -PI / 2 + 0.1, 0.32, 0.97, LN);
      manePetals(g, -0.6, 1.4, 12, 9, 19.6, 4.8, [P.mane2, P.maneL], -PI / 2 + 0.36, 0.3, 0.97, LN);
      // kulaklar
      cel(g, EL(-8.6, -12.4, 3.8, 3.6), P.fur, { dd: [0.6, 1.2], ld: [0.6, 0.8] });
      cel(g, EL(-8.4, -12, 1.8, 1.7), P.mane, { light: false, lw: 0.7, dd: [0.3, 0.6] });
      cel(g, EL(8.4, -12.8, 3.8, 3.6), P.fur, { dd: [0.6, 1.2], ld: [0.6, 0.8] });
      cel(g, EL(8.6, -12.4, 1.8, 1.7), P.mane, { light: false, lw: 0.7, dd: [0.3, 0.6] });
      // yüz
      cel(g, B([1.6, -12.6, 9.6, -11.6, 14.2, -6, 15, 1, 12.6, 7.6, 5.6, 11, -2.6, 10.8, -8.6, 7, -10.6, 0, -9.4, -7, -4.4, -11.6]), P.fur, { lt: P.furL, hl: [-4.6, -7.6, 2.6, 1.4, -0.5, 0.3] });
      // namlu
      cel(g, B([3, 2, 6.8, 0.6, 9.4, 1.6, 12, 0.6, 15.8, 2.4, 15.8, 6.6, 12.2, 9.2, 9.4, 8.6, 6.6, 9.2, 2.8, 6.6]), P.muzzle, { lw: 0.9, ld: [0.6, 0.8], dd: [0.4, 1.4], dkA: 0.18 });
      g.fillStyle = rgba(P.nose, 0.55);
      for (const d of [[5.4, 4.6], [6.6, 6.2], [5.2, 6.8], [13.4, 4.4], [14.2, 6], [12.8, 6.6]]) { g.beginPath(); ell(g, d[0], d[1], 0.45, 0.45); g.fill(); }
      // gözler
      eye(g, 8.6, -3.2, 3.4, 4.1, { ex, iris: P.eye, inner: -1, lidCol: P.fur, lidN: 0.08 });
      eye(g, -0.8, -3.2, 3, 3.8, { ex, iris: P.eye, inner: 1, lidCol: P.fur, lidN: 0.08, look: 0.7 });
      let bIn = 0, bOut = 0; if (ex === 's') { bIn = -1.6; bOut = 0.8; } else if (ex === 'f') bIn = 0.8; else if (ex === 'h' || ex === 'o') { bIn = -1; bOut = -1; }
      cel(g, B([4.6, -8.8 + bIn, 11.6, -9.8 + bOut, 12, -8 + bOut, 5, -7.2 + bIn]), P.mane2, { light: false, dd: [0.3, 0.6], lw: 0.9 });
      cel(g, B([-4.4, -8.6 + bOut, 1.4, -8.8 + bIn, 1.4, -7.2 + bIn, -4.4, -7.2 + bOut]), P.mane2, { light: false, dd: [0.3, 0.6], lw: 0.9 });
      // burun + ağız
      cel(g, B([6.8, 0.8, 11.8, 0.6, 10.4, 3.4, 9.3, 4.2, 8.2, 3.4]), P.nose, { lw: 0.9, ld: [0.4, 0.5], dd: [0.3, 0.6], hl: [8.4, 1.4, 1.1, 0.6, 0, 0.7] });
      if (ex === 'n' || ex === 'b') {
        lines(g, [[9.3, 4.2, 9.3, 5.6], [6.8, 6.6, 8.2, 7.4, 9.3, 5.6], [9.3, 5.6, 10.6, 7.4, 12, 6.4]], LN, 1.1);
      } else mouth(g, 9.3, 6, 2.8, ex);
      // taç
      g.save(); g.translate(0, -16); g.rotate(-0.06);
      const crown = g2 => {
        g2.moveTo(-10.6, 3); g2.lineTo(-11.2, -7.2); g2.quadraticCurveTo(-8, -3, -5.6, -3.4); g2.lineTo(-1, -11.4);
        g2.lineTo(3.6, -3.6); g2.quadraticCurveTo(6.4, -3.4, 9.4, -8); g2.lineTo(10.2, 2.6); g2.quadraticCurveTo(0, 0.8, -10.6, 3); g2.closePath();
      };
      cel(g, crown, P.crown, { lt: P.crownL, dk: P.crownD, ld: [1, 1.2], dd: [0.8, 1.8], hl: [-6, -2, 1.4, 2.4, 0.3, 0.6] });
      for (const b of [[-11.2, -7.6], [-1, -12], [9.4, -8.4]]) cel(g, EL(b[0], b[1], 1.7, 1.7), P.crown, { lt: P.crownL, dk: P.crownD, ld: [0.4, 0.5], dd: [0.3, 0.6], lw: 0.9, hl: [b[0] - 0.5, b[1] - 0.6, 0.6, 0.45, 0, 0.9] });
      cel(g, B([-11, -0.4, 0, -2, 10.4, -0.6, 10.4, 2.8, 0, 1, -11, 3.2]), P.crownD, { lt: P.crown, ld: [0.4, 0.8], dd: [0.3, 0.6], lw: 0.9 });
      cel(g, EL(-0.6, -3.8, 2.1, 2.5), P.gemR, { ld: [0.4, 0.6], dd: [0.4, 0.8], lw: 0.9, hl: [-1.2, -4.8, 0.7, 0.9, 0, 0.9] });
      cel(g, EL(-6.6, -2.2, 1.5, 1.6), P.gemB, { ld: [0.3, 0.4], dd: [0.3, 0.5], lw: 0.8, hl: [-7, -2.8, 0.5, 0.5, 0, 0.9] });
      cel(g, EL(5.6, -2.6, 1.5, 1.6), P.gemB, { ld: [0.3, 0.4], dd: [0.3, 0.5], lw: 0.8, hl: [5.2, -3.2, 0.5, 0.5, 0, 0.9] });
      g.fillStyle = '#ffffff'; for (const x of [-8.6, -3.6, 2.6, 7.6]) { g.beginPath(); ell(g, x, 1.1 - (x + 10) * 0.02, 0.6, 0.6); g.fill(); }
      g.restore();
    },
    body(g, P) {
      const tor = B([-9, 2.6, -11, -4.6, -9.6, -12, -5, -16.6, 3.6, -17, 9, -12.6, 11, -4.6, 9.6, 2.6, 0, 4.2]);
      cel(g, tor, P.fur, { lt: P.furL, hl: [-5.6, -9, 2.2, 1.2, -0.6, 0.25] });
      cel(g, B([-1.6, -12, 4, -13, 8.6, -8, 8.6, -1, 4.6, 2.6, -1.4, 2, -3.4, -4]), P.muzzle, { lw: 0.9, dd: [0.6, 1.6], ld: [0.8, 1], dkA: 0.16 });
      // kürk yaka
      cel(g, B([-10, -18.4, -2, -16, 6, -16.6, 10.4, -18.6, 11, -13.4, 4, -11.4, -3, -11.8, -10.6, -13.4]), P.ermine, { dk: mix(P.ermine, '#8a93c8', 0.35), ld: [0.6, 0.8], dd: [0.6, 1.6] });
      g.fillStyle = P.spot;
      for (const s of [[-7, -14.6], [-1.6, -13.4], [5.6, -14.2], [9, -15.6]]) { g.beginPath(); ell(g, s[0], s[1], 0.75, 1.5); g.fill(); g.beginPath(); g.moveTo(s[0] - 1.2, s[1] - 1); g.lineTo(s[0], s[1] - 1.8); g.lineTo(s[0] + 1.2, s[1] - 1); g.closePath(); g.fill(); }
      cel(g, EL(1.6, -12, 2, 2), P.crown, { lt: P.crownL, dk: P.crownD, ld: [0.4, 0.5], dd: [0.3, 0.6], lw: 0.9 });
      g.beginPath(); ell(g, 1.6, -12, 0.8, 0.8); g.fillStyle = P.gemR; g.fill();
    },
    arm(g, P) {
      cel(g, B([-3.2, -1.6, 3.2, -1.6, 3.5, 5.4, 4.5, 9.2, 2.8, 12.6, -1.6, 12.9, -3.9, 9.8, -3.5, 4.6]), P.fur, {
        lt: P.furL, dd: [1, 2], ld: [1.2, 1.2],
        fn: g2 => { g2.beginPath(); ell(g2, 0.4, 11.2, 4.4, 3); g2.fillStyle = rgba(P.muzzle, 0.85); g2.fill(); }
      });
      lines(g, [[-0.6, 12.4, -0.4, 11], [1.6, 12.2, 1.6, 10.8]], rgba(P.line, 0.6), 0.7);
    },
    leg(g, P) {
      cel(g, B([-3.8, -1.6, 3.8, -1.6, 4, 5, 6.8, 6.8, 8.8, 9.6, 7.4, 12.4, 0.5, 12.6, -3.6, 11.4, -4, 5]), P.fur, {
        lt: P.furL, dd: [1, 2], ld: [1.2, 1.2],
        fn: g2 => { g2.beginPath(); ell(g2, 3, 10.6, 6.4, 2.6); g2.fillStyle = rgba(P.muzzle, 0.75); g2.fill(); }
      });
      lines(g, [[5.2, 12.4, 5.4, 10.6], [7.4, 12.2, 7.6, 10.6]], rgba(P.line, 0.6), 0.7);
    },
    back(ctx, P, p) { tailTuft(ctx, P, p, -8.4, -2.6); capeDraw(ctx, P, p); }
  };

  /* ----------------------------- Nuss — kar baykuşu, mavi tüy ----------------------------- */
  DEF.Nuss = {
    rig: { hipY: 8, legF: [3.6, 0], legB: [-3.6, 0], shF: [5.6, -11], shB: [-6.6, -11], neck: [1, -16.6], head: [1.6, -12.4], top: 30, scale: 1, bw: 13.6 },
    eyes: [[8.2, -0.4, 5.2], [-3.6, -0.4, 4.6]],
    head(g, P, ex) {
      // mavi tüyler
      const fth = (x0, y0, x1, y1, w, bend) => {
        const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
        const mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
        const path = g2 => {
          g2.moveTo(x0 + nx * w * 0.22, y0 + ny * w * 0.22);
          g2.quadraticCurveTo(mx + nx * w * 1.15, my + ny * w * 1.15, x1, y1);
          g2.quadraticCurveTo(mx - nx * w * 0.85, my - ny * w * 0.85, x0 - nx * w * 0.22, y0 - ny * w * 0.22);
          g2.closePath();
        };
        cel(g, path, P.feather, { lt: P.featherL, dk: P.featherD, ld: [0.8, 1], dd: [0.6, 1.2], lw: 1,
          fn: g2 => {
            g2.strokeStyle = rgba(P.featherL, 0.8); g2.lineWidth = 0.7; g2.beginPath();
            for (let i = 1; i <= 4; i++) {
              const t = i / 5, qx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1, qy = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1;
              g2.moveTo(qx, qy); g2.lineTo(qx + nx * w * 0.7 + dx / L * 1.4, qy + ny * w * 0.7 + dy / L * 1.4);
              g2.moveTo(qx, qy); g2.lineTo(qx - nx * w * 0.6 + dx / L * 1.4, qy - ny * w * 0.6 + dy / L * 1.4);
            }
            g2.stroke();
          } });
        g.beginPath(); g.moveTo(x0, y0 + 1); g.quadraticCurveTo(mx, my, x1, y1); g.lineWidth = 0.9; g.strokeStyle = P.featherD; g.stroke();
      };
      fth(0.6, -12, -10.6, -30.6, 5.4, 3.4);
      fth(3.6, -12.6, 9.6, -25.6, 3.8, -2.6);
      // kulak püskülleri
      cel(g, B([-13.6, -6.6, -17.4, -15, -15.2, -20, -9.6, -12.4]), P.fur, { dk: mix(P.fur, P.shade, 0.6), ld: [0.6, 0.8], dd: [0.6, 1.4] });
      cel(g, B([6.4, -12.4, 10.4, -19.6, 13, -16.4, 13.4, -9]), P.fur, { dk: mix(P.fur, P.shade, 0.6), ld: [0.6, 0.8], dd: [0.6, 1.4] });
      const hd = B([0, -14.6, 9, -13, 15, -7.6, 17, 0.6, 14.6, 8, 7, 12.6, -2.6, 13, -11, 9.6, -16, 2, -15.6, -6, -10.6, -12]);
      cel(g, hd, P.fur, { dk: mix(P.fur, P.shade, 0.55), dd: [1.4, 3],
        fn: g2 => {
          g2.strokeStyle = P.speck; g2.lineWidth = 0.9;
          for (const s of [[-10, -6.6], [-6.4, -10.4], [-12.6, 1.6], [12.4, -9.4], [-1, -11.6], [4.4, -11.4], [-9.4, 6.4]]) {
            g2.beginPath(); g2.moveTo(s[0] - 1.2, s[1] - 0.6); g2.lineTo(s[0], s[1] + 0.6); g2.lineTo(s[0] + 1.2, s[1] - 0.6); g2.stroke();
          }
        } });
      // yüz diskleri
      g.beginPath(); ell(g, 8.2, 0, 7.6, 7.4); ell(g, -3.6, 0, 6.6, 7); g.fillStyle = P.disk; g.fill();
      g.beginPath(); g.arc(8.2, 0, 7.6, PI * 0.1, PI * 0.85); g.moveTo(-3.6 + 6.6 * cos(PI * 0.2), 7 * sin(PI * 0.2)); g.arc(-3.6, 0, 6.6, PI * 0.2, PI * 0.95);
      g.lineWidth = 0.9; g.strokeStyle = rgba(P.speck, 0.7); g.stroke();
      eye(g, 8.2, -0.4, 5.2, 5.4, { ex, iris: P.eye, style: 'owl', inner: -1, lidCol: P.disk });
      eye(g, -3.6, -0.4, 4.6, 5, { ex, iris: P.eye, style: 'owl', inner: 1, lidCol: P.disk, look: 0.8 });
      // gaga
      if (ex === 'h' || ex === 'o') { g.beginPath(); ell(g, 2.6, 9.4, ex === 'o' ? 1.6 : 2.2, ex === 'o' ? 1.8 : 1.2); g.fillStyle = '#5a1a2a'; g.fill(); g.lineWidth = 0.8; g.strokeStyle = LN; g.stroke(); }
      cel(g, g2 => { g2.moveTo(0.6, 3.4); g2.quadraticCurveTo(2.6, 2.2, 4.8, 3.4); g2.quadraticCurveTo(4.6, 7.4, 2.6, 9); g2.quadraticCurveTo(1, 7, 0.6, 3.4); g2.closePath(); }, P.beak,
        { lt: mix(P.beak, '#ffffff', 0.35), ld: [0.4, 0.6], dd: [0.3, 0.8], lw: 1, hl: [2, 4, 0.6, 1, 0.2, 0.5] });
    },
    body(g, P) {
      cel(g, B([-9, -2.6, -15.6, -0.4, -17.4, 4, -13, 5.6, -8, 3]), P.fur, { dk: mix(P.fur, P.shade, 0.6), dd: [0.6, 1.2], ld: [0.6, 0.8],
        fn: g2 => lines(g2, [[-16, 1.6, -11, 1.4], [-15, 4, -10.6, 3.6]], rgba(P.speck, 0.8), 0.9) });
      const tor = B([-11, 3, -13.6, -5, -11, -13.6, -4.6, -17.6, 5, -17.6, 11, -12.6, 13, -4.6, 11, 3, 0, 5]);
      cel(g, tor, P.fur, { dk: mix(P.fur, P.shade, 0.55), hl: [-6, -11, 2.6, 1.4, -0.6, 0.5],
        fn: g2 => {
          g2.strokeStyle = rgba(P.speck, 0.55); g2.lineWidth = 0.8;
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const x = -1 + c * 3.6 + (r % 2) * 1.8, y = -11 + r * 4; g2.beginPath(); g2.arc(x, y, 1.6, PI * 0.15, PI * 0.85); g2.stroke(); }
          g2.strokeStyle = P.speck; g2.lineWidth = 0.9;
          for (const s of [[-8, -6], [-9.4, -1], [-5.6, 1.6], [9.6, -2], [-7, -10.6]]) { g2.beginPath(); g2.moveTo(s[0] - 1.1, s[1] - 0.5); g2.lineTo(s[0], s[1] + 0.6); g2.lineTo(s[0] + 1.1, s[1] - 0.5); g2.stroke(); }
        } });
    },
    arm(g, P) {
      const w = B([-4, -2, 3.8, -2, 5, 5, 4.4, 11, 2, 16.2, 0.4, 13.2, -1.6, 15.4, -3, 12, -4.6, 6]);
      cel(g, w, P.fur, { dk: mix(P.fur, P.shade, 0.6), dd: [1, 2], ld: [1, 1],
        fn: g2 => {
          g2.fillStyle = P.wingTip; g2.beginPath(); g2.moveTo(-6, 10.6); g2.quadraticCurveTo(0, 12.4, 6, 9.6); g2.lineTo(6, 20); g2.lineTo(-6, 20); g2.closePath(); g2.fill();
          lines(g2, [[0.4, 7, 0.6, 13.4], [-2, 7.4, -2.4, 12.4], [2.6, 7, 3, 12.4]], rgba(P.speck, 0.8), 0.8);
          g2.strokeStyle = P.speck; g2.lineWidth = 0.8;
          for (const s of [[-1.6, 2], [2, 3.6], [-0.4, 5.4]]) { g2.beginPath(); g2.moveTo(s[0] - 1, s[1] - 0.4); g2.lineTo(s[0], s[1] + 0.5); g2.lineTo(s[0] + 1, s[1] - 0.4); g2.stroke(); }
        } });
    },
    wing(g, P) {
      const w = B([-5, -2, 5, -2, 7.4, 6, 8.4, 14, 8, 22, 5.6, 30, 3.2, 25.6, 1, 31.4, -1.4, 26, -3.6, 30, -4.8, 23, -6.4, 14, -6.6, 5.6]);
      cel(g, w, P.fur, { dk: mix(P.fur, P.shade, 0.6), dd: [1.2, 2.4], ld: [1.2, 1.2],
        fn: g2 => {
          g2.fillStyle = P.wingTip; g2.beginPath(); g2.moveTo(-8, 21); g2.quadraticCurveTo(0, 23.6, 9, 20); g2.lineTo(9, 34); g2.lineTo(-8, 34); g2.closePath(); g2.fill();
          lines(g2, [[-3, 12, -3.6, 28], [0, 13, 0.4, 29], [3.2, 12, 4.4, 27], [-6, 10, 7.6, 9.6, 8.4, 9]], rgba(P.speck, 0.8), 0.85);
          g2.strokeStyle = rgba(P.speck, 0.6); g2.lineWidth = 0.8;
          for (let i = 0; i < 4; i++) { g2.beginPath(); g2.arc(-3 + i * 2.6, 4 + (i % 2) * 1.6, 1.6, PI * 0.15, PI * 0.85); g2.stroke(); }
        } });
    },
    leg(g, P) {
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(1, 5.4); g.quadraticCurveTo(3, 6, 3.4, 8.4); g.moveTo(-0.6, 5.6); g.quadraticCurveTo(0.6, 7, 0.6, 8.8); g.moveTo(-2.2, 5.4); g.quadraticCurveTo(-2.6, 7, -1.8, 8.6);
      g.strokeStyle = P.talon; g.lineWidth = 1.8; g.stroke();
      cel(g, B([-4.6, -1.6, 4.6, -1.6, 5, 3.6, 2.2, 6.2, -2.8, 6.2, -5, 3.6]), P.fur, { dk: mix(P.fur, P.shade, 0.6), dd: [0.8, 1.6], ld: [1, 1],
        fn: g2 => lines(g2, [[-3, 3.4, -1.6, 5], [0, 3.6, 1, 5.4], [2.6, 3.2, 3.4, 4.8]], rgba(P.speck, 0.6), 0.8) });
    }
  };

  /* ----------------------------- baso — kahverengi ayı, yeşil kapüşonlu, kırmızı kulaklık ----------------------------- */
  DEF.baso = {
    rig: { hipY: 11.6, legF: [3.6, 0], legB: [-4, 0], shF: [3.6, -13], shB: [-5, -13], neck: [1.5, -17], head: [1.5, -11], top: 20, scale: 1, bw: 12 },
    eyes: [[9.4, -3.6, 3], [-0.6, -3.6, 2.7]],
    head(g, P, ex) {
      // uzak kulaklık kabı (kafanın arkasında)
      cel(g, B([13.6, -7.6, 17.6, -6.6, 18.4, 3.6, 14.6, 5]), P.phone, { lt: P.phoneL, dd: [0.6, 1.2], ld: [0.6, 0.8] });
      // kulaklar
      cel(g, EL(-10.6, -13.4, 5.6, 5.4), P.fur, { lt: P.furL, dd: [0.8, 1.6], ld: [1, 1] });
      cel(g, EL(-10.4, -13.4, 3, 2.9), P.muzzle, { light: false, lw: 0.8, dd: [0.4, 0.8] });
      cel(g, EL(8.8, -14.6, 5.4, 5.2), P.fur, { lt: P.furL, dd: [0.8, 1.6], ld: [1, 1] });
      cel(g, EL(9, -14.6, 2.9, 2.8), P.muzzle, { light: false, lw: 0.8, dd: [0.4, 0.8] });
      const hd = B([0, -14.6, 9, -13, 15, -7, 16.6, 1, 13.6, 8.6, 5.6, 12.6, -5, 12.6, -12.6, 9, -16.6, 1, -14.6, -7, -8.6, -12.6]);
      cel(g, hd, P.fur, { lt: P.furL, hl: [-7.6, -7.6, 3, 1.6, -0.5, 0.25],
        fn: g2 => lines(g2, [[-14, 3, -12, 4.4], [-13.4, 7, -11.4, 7.6], [3.6, -13, 4.6, -11.4, 3.6, -10], [6, -13, 7, -11.6]], rgba(sh(P.fur, -0.3), 0.8), 0.9) });
      // namlu
      cel(g, B([1.6, 2, 6, -0.6, 11, -0.4, 15.6, 2.2, 16, 6.8, 12, 10, 6, 10.2, 2, 7.4]), P.muzzle, { lw: 0.9, ld: [0.8, 1], dd: [0.6, 1.6], dkA: 0.2 });
      eye(g, 9.4, -3.6, 3, 3.6, { ex, iris: P.eye, style: 'bead', inner: -1, lidCol: P.fur });
      eye(g, -0.6, -3.6, 2.7, 3.3, { ex, iris: P.eye, style: 'bead', inner: 1, lidCol: P.fur });
      let bIn = 0, bOut = 0; if (ex === 's') { bIn = -1.4; bOut = 0.8; } else if (ex === 'f') bIn = 1; else if (ex === 'h' || ex === 'o') { bIn = -0.8; bOut = -0.8; }
      lines(g, [[6.6, -8.4 + bIn, 9.6, -9.4, 12.2, -8.6 + bOut], [-3, -8.2 + bOut, -0.6, -8.8, 1.6, -8.2 + bIn]], sh(P.fur, -0.35), 1.3);
      cel(g, B([7.6, 0.4, 12.6, 0.2, 11.6, 2.8, 10, 3.8, 8.4, 2.8]), P.nose, { lw: 0.9, ld: [0.4, 0.5], dd: [0.3, 0.6], hl: [9.2, 1, 1.2, 0.6, 0, 0.7] });
      if (ex === 'n' || ex === 'b') lines(g, [[10, 3.8, 10, 5.4], [7.6, 6.4, 8.8, 7.4, 10, 5.4], [10, 5.4, 11.2, 7.4, 12.6, 6.4]], LN, 1.1);
      else mouth(g, 10, 6, 2.8, ex);
      // kafa bandı
      g.beginPath(); g.moveTo(-15.4, 0); g.bezierCurveTo(-16.4, -12, -7.6, -18.2, -1, -17.6); g.bezierCurveTo(6.6, -17, 13.4, -11.4, 15.6, -3);
      g.lineCap = 'round'; g.lineWidth = 3.8; g.strokeStyle = P.band; g.stroke();
      g.beginPath(); g.moveTo(-14.6, -3); g.bezierCurveTo(-15, -11.6, -7.6, -16.8, -1, -16.4);
      g.lineWidth = 1; g.strokeStyle = rgba(mix(P.band, '#ffffff', 0.5), 0.8); g.stroke();
      // yakın kulaklık kabı
      cel(g, B([-13.6, -6.6, -11.2, -6, -10.8, 5.2, -13.4, 6]), P.cushion, { light: false, dd: [0.4, 0.8], lw: 0.9 });
      cel(g, B([-20.4, -5.6, -14.6, -7.2, -12.8, -1, -13.6, 6.4, -19.6, 6.4, -21.4, 0.6]), P.phone, { lt: P.phoneL, dd: [0.8, 1.6], ld: [1, 1.2], hl: [-18.4, -3, 1, 1.8, 0.2, 0.6] });
      g.beginPath(); ell(g, -17.6, 2.4, 1.7, 1.7); g.fillStyle = sh(P.phone, -0.3); g.fill();
      g.beginPath(); ell(g, -17.6, 2.4, 0.7, 0.7); g.fillStyle = '#ffffff'; g.fill();
    },
    body(g, P) {
      cel(g, B([-12.6, -13.6, -10.6, -20.4, -3.6, -21.4, 1.4, -17.6, -3, -12.6]), P.hood, { lt: P.hoodL, dk: P.hoodD, dd: [0.6, 1.4], ld: [0.8, 1] });
      const tor = B([-10, 3, -12, -5, -10.6, -13, -5.6, -17.6, 4, -17.6, 9.6, -13, 11.6, -4.6, 10, 3, 0, 4.6]);
      cel(g, tor, P.hood, { lt: P.hoodL, ltAlpha: 0.7, dk: P.hoodD, hl: [-6, -11, 2.4, 1.3, -0.6, 0.3],
        fn: g2 => {
          g2.fillStyle = P.hoodD; g2.fillRect(-14, 0.6, 28, 6);
          lines(g2, [[-8, 0.8, -8, 4], [-4, 0.8, -4, 4.4], [0, 0.8, 0, 4.6], [4, 0.8, 4, 4.4], [8, 0.8, 8, 4]], rgba(sh(P.hoodD, -0.3), 0.7), 0.7);
        } });
      cel(g, B([-1.6, -7, 9, -7.4, 10.6, -1.4, 7.6, 0.2, 0, 0.2, -2.4, -1]), mix(P.hood, P.hoodD, 0.35), { lt: P.hood, dk: P.hoodD, ld: [0.6, 0.8], dd: [0.4, 1], lw: 0.9 });
      g.setLineDash([1, 1.2]); lines(g, [[-0.6, -6, 9, -6.4]], rgba(P.hoodL, 0.9), 0.6); g.setLineDash([]);
      lines(g, [[2.2, -15.6, 1.6, -12.6, 2.2, -10.2], [6, -15.6, 6.8, -12.6, 6.2, -9.8]], P.string, 1.1);
      g.fillStyle = P.band; g.fillRect(1.4, -10.4, 1.6, 1.8); g.fillRect(5.4, -10, 1.6, 1.8);
      // ♪ logo
      g.beginPath(); ell(g, -5.6, -7.4, 1.4, 1.05, -0.4); g.fillStyle = '#ffffff'; g.fill();
      lines(g, [[-4.4, -7.6, -4.4, -11.8], [-4.4, -11.8, -2.8, -10.6, -3, -9.4]], '#ffffff', 0.9);
    },
    arm(g, P) {
      cel(g, B([-3.6, -1.6, 3.6, -1.6, 3.8, 7, 3.2, 9.2, -3.2, 9.2, -3.8, 7]), P.hood, { lt: P.hoodL, ltAlpha: 0.7, dk: P.hoodD, dd: [1, 1.8], ld: [1, 1] });
      cel(g, EL(0.2, 11.6, 3.7, 3.4), P.fur, { lt: P.furL, dd: [0.8, 1.4], ld: [0.8, 0.8] });
      cel(g, B([-3.4, 7.4, 3.4, 7.4, 3.6, 9.8, -3.6, 9.8]), P.hoodD, { lt: P.hood, ld: [0.3, 0.5], dd: [0.3, 0.5], lw: 0.9 });
    },
    leg(g, P) {
      cel(g, B([-3.8, -1.6, 3.8, -1.6, 4, 5, 7, 6.4, 9, 9, 7.6, 11.6, 0, 11.6, -3.6, 10.6, -4, 5]), P.fur, { lt: P.furL, dd: [1, 2], ld: [1.2, 1.2] });
      lines(g, [[5.2, 11.4, 5.4, 9.8], [7.4, 11.2, 7.6, 9.8]], rgba(P.line, 0.6), 0.7);
    }
  };

  /* =====================================================================
     POZLAR
     p alanları: bx,bob (kalça ofseti), lean (gövde eğimi), sx,sy (ayak merkezli esneme), rot/pv (pv yüksekliğinde dönüş),
     hrot (kalça merkezli dönüş — kayma), legF/legB + legFs/legBs (açı, boy ölçeği), armF/armB (+s),
     head (kafa eğimi), hx,hy, shY (omuz düşüşü), expr, flow (pelerin/kurdele savrulma), tw (dalga fazı), wing/wingF/wingB
     Açı kuralı: uzuv açısı a>0 ileri (+x) savurur; a=π yukarı.
     ===================================================================== */
  function basePose(st, t) {
    return { st, bx: 0, bob: 0, lean: 0, sx: 1, sy: 1, rot: 0, pv: 0, hrot: 0, legF: 0, legB: 0, legFs: 1, legBs: 1, armF: 0, armB: 0, armFs: 1, armBs: 1, head: 0, hx: 0, hy: 0, shY: 0, expr: 'n', flow: 0, tw: t * 5, wing: false, wingF: 0, wingB: 0, backRot: 0, capeAng: null };
  }
  function makePose(id, st, ph, t, vy, o) {
    o = o || {};
    const D = DEF[id] || DEF.TAFTAF, rg = D.rig;
    if (st === 'fly' && id !== 'Nuss') st = 'air';
    if (st === 'slide' && o.sled) st = 'sled';
    const p = basePose(st, t);
    switch (st) {
      case 'idle': {
        const b = sin(t * 2.6);
        p.sy = 1 + b * 0.022; p.sx = 1 - b * 0.012;
        const ia = rg.idle || [0.22, -0.16];
        p.armF = ia[0] + b * 0.05; p.armB = ia[1] - b * 0.05; p.legF = 0.07; p.legB = -0.07;
        p.head = sin(t * 1.3) * 0.045; p.flow = 0.08; p.tw = t * 2.2;
        break;
      }
      case 'frozen': {
        p.armF = 0.9; p.armB = 1.15; p.legF = 0.15; p.legB = -0.2; p.head = -0.05; p.expr = 'o'; p.tw = 1; p.flow = 0.1;
        break;
      }
      case 'run': case 'pulled': {
        const s = sin(ph), c = cos(ph), sp = clamp(o.speed != null ? o.speed : 1, 0, 2);
        const amp = 0.55 + min(1.2, sp) * 0.45;
        p.legF = s * amp; p.legB = -s * amp;
        p.legFs = 1 - max(0, c) * 0.32; p.legBs = 1 - max(0, -c) * 0.32;
        p.armF = -s * (0.65 + amp * 0.55) + 0.35; p.armB = s * (0.65 + amp * 0.55) + 0.35;
        p.bob = -abs(s) * 2.6 * min(1, sp + 0.2);
        p.lean = 0.12 + min(1.4, sp) * 0.12;
        p.head = -p.lean * 0.55 + cos(ph * 2) * 0.03;
        p.sy = 1 + cos(ph * 2) * 0.025; p.sx = 1 - cos(ph * 2) * 0.015;
        p.flow = clamp(sp, 0, 1.2); p.tw = ph * 0.9 + t * 3;
        if (st === 'pulled') {
          p.lean = -0.28; p.head = 0.12; p.expr = 'o';
          p.armF = 2.1 + sin(t * 15) * 0.45; p.armB = 2.5 - sin(t * 15) * 0.45; p.flow = 0.2;
        }
        break;
      }
      case 'dash': {
        const s = sin(ph * 1.3);
        p.legF = 1.05 + s * 0.12; p.legB = -1.15 - s * 0.12; p.legFs = 0.88; p.legBs = 0.95;
        p.armF = -1.35; p.armB = -1.6; p.lean = 0.5; p.head = -0.38; p.bob = -1;
        p.expr = 'f'; p.flow = 1.2; p.tw = t * 9;
        break;
      }
      case 'air': {
        const k = clamp((vy + 220) / 720, 0, 1), fl = sin(t * 17) * 0.25 * k;
        p.legF = lerp(0.85, 0.5, k); p.legFs = lerp(0.72, 0.78, k);
        p.legB = lerp(-0.5, 0.18, k); p.legBs = lerp(1, 0.76, k);
        p.armF = lerp(2.55, 1.55, k) + fl; p.armB = lerp(2.85, 1.9, k) - fl;
        p.lean = lerp(0.06, -0.06, k); p.head = lerp(-0.08, 0.06, k);
        p.flow = lerp(0.55, 0.95, k); p.tw = t * 6;
        if (vy > 760) p.expr = 'o';
        if (o.flip > 0) {
          const f = clamp(o.flip, 0, 1), e = 1 - (1 - f) * (1 - f) * (1 - f);
          p.rot = -TAU * e; p.pv = rg.hipY + 12;
          const tuck = sin(f * PI);
          p.legF = lerp(p.legF, 1.2, tuck); p.legB = lerp(p.legB, 0.9, tuck);
          p.legFs = lerp(p.legFs, 0.62, tuck); p.legBs = lerp(p.legBs, 0.62, tuck);
          p.armF = lerp(p.armF, 1.1, tuck); p.armB = lerp(p.armB, 1.4, tuck);
          p.lean = lerp(p.lean, 0.3, tuck); p.head = lerp(p.head, 0.2, tuck); p.expr = 'h';
        }
        break;
      }
      case 'slide': {
        p.hrot = -1.42; p.bx = 13; p.bob = rg.hipY - 1.2 - (rg.bw || 11) * 0.97;
        p.legF = -0.1; p.legB = 0.55; p.legBs = 0.78;
        p.armF = 2.5 + sin(t * 9) * 0.08; p.armB = 2.9; p.head = 0.62; p.lean = 0.04;
        p.expr = 'f'; p.flow = 0.9; p.tw = t * 8; p.backRot = 1.3; p.capeAng = 2.55;
        break;
      }
      case 'sled': {
        p.hrot = 1.42; p.bx = -15; p.bob = rg.hipY - 1 - (rg.bf || rg.bw || 11) * 0.97;
        p.legF = 0.05; p.legB = -0.12; p.legFs = 0.9; p.legBs = 0.9;
        p.armF = -0.5 + sin(t * 10) * 0.08; p.armB = -0.3; p.head = -1.0; p.lean = 0;
        p.expr = 'h'; p.flow = 1; p.tw = t * 8; p.backRot = -1.3;
        break;
      }
      case 'climb': {
        const s = sin(ph * 1.2);
        p.lean = 0.2; p.bx = 2;
        p.armF = PI - 0.4 + s * 0.45; p.armB = PI - 0.4 - s * 0.45;
        p.legF = 0.6 + s * 0.4; p.legB = 0.6 - s * 0.4; p.legFs = 0.8 + s * 0.12; p.legBs = 0.8 - s * 0.12;
        p.bob = -abs(s) * 1.2; p.head = -0.3; p.expr = 'f'; p.flow = 0.3; p.tw = t * 4;
        break;
      }
      case 'fly': {
        const f = sin(o.wph != null ? o.wph : t * 14);
        p.wing = true;
        p.wingF = lerp(-2.65, -0.85, (f + 1) / 2); p.wingB = p.wingF + 0.3;
        p.lean = 0.3; p.legF = -0.55; p.legB = -0.8; p.legFs = 0.8; p.legBs = 0.8;
        p.head = -0.3; p.bob = -f * 1.6; p.flow = 0.8; p.tw = t * 6;
        break;
      }
      case 'stun': {
        const w = sin(t * 6);
        p.lean = w * 0.14; p.head = sin(t * 6 + 1) * 0.2; p.armF = 0.4 + w * 0.25; p.armB = 0.55 - w * 0.25;
        p.legF = 0.18; p.legB = -0.18; p.sx = 1 + w * 0.03; p.expr = 'x'; p.flow = 0.15; p.tw = t * 3;
        break;
      }
      case 'cheer': {
        const j = abs(sin(t * 5.5)), land = 1 - j;
        p.bob = -j * 10;
        p.sy = 1 - land * land * land * 0.12 + j * 0.04; p.sx = 1 + land * land * land * 0.09;
        p.armF = PI - 0.45 + sin(t * 11) * 0.3; p.armB = PI - 0.15 - sin(t * 11) * 0.3;
        p.legF = j * 0.55; p.legB = -j * 0.3; p.legFs = 1 - j * 0.25; p.legBs = 1 - j * 0.2;
        p.head = sin(t * 5.5) * 0.08; p.expr = 'h'; p.flow = 0.2 + j * 0.4; p.tw = t * 4;
        break;
      }
      case 'sad': {
        p.lean = 0.16; p.head = 0.32; p.hy = 1.4; p.shY = 1.6;
        p.armF = 0.06 + sin(t * 1.4) * 0.04; p.armB = -0.03;
        p.legF = 0.05; p.legB = -0.05; p.sy = 0.97; p.sx = 1.02;
        p.expr = 's'; p.flow = 0.04; p.tw = t * 1.4;
        break;
      }
      default: break;
    }
    if (o.expr) p.expr = o.expr;
    return p;
  }

  /* =====================================================================
     KARAKTER BİRLEŞTİRME (her kare)
     ===================================================================== */
  function eyeGlow(ctx, D, P, ex) {
    if (ex === 'b' || ex === 'h' || !D.eyes) return;
    const col = P.skinId === 'neon' ? 'rgba(255,90,230,0.85)' : (ex === 'x' ? 'rgba(255,255,255,0.4)' : rgba(P.eye, 0.85));
    const gs = FM.gfx.glowSprite(col, 16);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= 0.75;
    for (const e of D.eyes) { const r = e[2] * 2.3; ctx.drawImage(gs.c, e[0] - r, e[1] - r, r * 2, r * 2); }
    ctx.globalAlpha /= 0.75;
    ctx.globalCompositeOperation = 'source-over';
  }
  /** Bir karakteri (yerel ayak koordinatında, sağa bakan) çizer. */
  function drawFig(ctx, id, skin, m, p, t, ol) {
    const D = DEF[id], rg = D.rig, P = pal(id, skin, false);
    const rim = typeof ol === 'string';          // kenar ışığı geçişi: yalnızca dış hatlı parçalar (pelerin/göz parlaması yok)
    ol = ol === false ? 0 : rim ? ol : 1;
    ctx.save();
    const s = rg.scale || 1;
    ctx.scale(s * p.sx, s * p.sy);
    if (p.rot) { ctx.translate(0, -p.pv); ctx.rotate(p.rot); ctx.translate(0, p.pv); }
    ctx.translate(p.bx, -rg.hipY + p.bob);
    if (p.hrot) ctx.rotate(p.hrot);
    if (D.back && !rim) { ctx.save(); ctx.rotate(p.lean); D.back(ctx, P, p, t); ctx.restore(); }
    const wing = p.wing && D.wing;
    ctx.save(); ctx.rotate(p.lean);
    limb(ctx, part(id, skin, wing ? 'wingB' : 'armB', '', m, ol), rg.shB[0], rg.shB[1] + p.shY, wing ? p.wingB : p.armB, p.armBs, m);
    ctx.restore();
    limb(ctx, part(id, skin, 'legB', '', m, ol), rg.legB[0], rg.legB[1], p.legB, p.legBs, m);
    limb(ctx, part(id, skin, 'legF', '', m, ol), rg.legF[0], rg.legF[1], p.legF, p.legFs, m);
    ctx.save(); ctx.rotate(p.lean);
    blit(ctx, part(id, skin, 'body', '', m, ol), m);
    // ön kol: yukarı kalktığında yüzü kapatmasın diye kafanın ARKASINDA, aşağıdayken önde
    const fa = wing ? p.wingF : p.armF, armUp = !wing && fa > 1.15 && fa < 5;
    if (armUp) limb(ctx, part(id, skin, 'armF', '', m, ol), rg.shF[0], rg.shF[1] + p.shY, fa, p.armFs, m);
    ctx.save();
    ctx.translate(rg.neck[0] + p.hx, rg.neck[1] + p.hy);
    if (p.head) ctx.rotate(p.head);
    ctx.translate(rg.head[0], rg.head[1]);
    if (rg.hs) ctx.scale(rg.hs, rg.hs);
    if (D.headBack && !rim) D.headBack(ctx, P, p, t);
    blit(ctx, part(id, skin, 'head', p.expr, m, ol), m);
    if (P.glowEye && !rim) eyeGlow(ctx, D, P, p.expr);
    ctx.restore();
    if (!armUp) limb(ctx, part(id, skin, wing ? 'wingF' : 'armF', '', m, ol), rg.shF[0], rg.shF[1] + p.shY, fa, p.armFs, m);
    ctx.restore();
    ctx.restore();
  }
  /** Kafa merkezinin yerel (ayak) koordinatı — durum efektleri ve plaka için. */
  function headLocal(id, p) {
    const rg = DEF[id].rig;
    let x = rg.head[0], y = rg.head[1], c = cos(p.head), s = sin(p.head);
    let X = x * c - y * s + rg.neck[0] + p.hx, Y = x * s + y * c + rg.neck[1] + p.hy;
    c = cos(p.lean); s = sin(p.lean); x = X * c - Y * s; y = X * s + Y * c;
    if (p.hrot) { c = cos(p.hrot); s = sin(p.hrot); X = x * c - y * s; Y = x * s + y * c; x = X; y = Y; }
    x += p.bx; y += -rg.hipY + p.bob;
    if (p.rot) { c = cos(p.rot); s = sin(p.rot); const yy = y + p.pv; X = x * c - yy * s; Y = x * s + yy * c - p.pv; x = X; y = Y; }
    const sc = rg.scale || 1;
    return [x * p.sx * sc, y * p.sy * sc];
  }

  /* =====================================================================
     YARIŞÇI ANİMASYON DURUMU (göz kırpma, takla, kanat çırpma, serpinti)
     ===================================================================== */
  const AS = new WeakMap();
  function anim(r) {
    let a = AS.get(r);
    if (!a) {
      a = { t: Math.random() * 10, blinkIn: 1 + Math.random() * 3, blinkT: 0, flip: 0, pj: 0, wph: Math.random() * 6, pvy: 0, flapT: 0, spray: 0, plY: null, plX: 0, hx: 0, hy: 0, prevDead: 0, spin: Math.random() * 6 };
      AS.set(r, a);
    }
    return a;
  }
  R.updaters.push(function (dt) {
    const S = FM.S;
    if (!S || !S.racers) return;
    for (const r of S.racers) {
      if (!r) continue;
      const a = anim(r);
      a.t += dt; a.spin += dt * 9;
      a.blinkIn -= dt;
      if (a.blinkIn <= 0) { a.blinkT = 0.12; a.blinkIn = Math.random() < 0.22 ? 0.22 : 2 + Math.random() * 3.4; }
      a.blinkT = max(0, a.blinkT - dt);
      // çift zıplama → ters takla
      if (r.jumps === 2 && a.pj !== 2 && !r.onGround && r.dead <= 0 && !(r.fly > 0)) a.flip = 0.0001;
      a.pj = r.jumps;
      if (a.flip > 0) { a.flip += dt / 0.44; if (a.flip >= 1 || r.onGround || r.climb || r.dead > 0 || r.fly > 0 || r.dash > 0 || r.stun > 0 || r.frozen > 0) a.flip = 0; }
      // Nuss kanat çırpma
      if (r.fly > 0 && r.vy < -380 && a.pvy > -300) a.flapT = 0.3;
      a.flapT = max(0, a.flapT - dt);
      a.wph += dt * (13 + a.flapT * 45);
      a.pvy = r.vy;
      // ertan kızak buz serpintisi
      if (r.sled > 0 && r.slide && r.onGround && r.dead <= 0 && FM.fx && nearCam(r)) {
        a.spray += dt * 42;
        while (a.spray >= 1) {
          a.spray -= 1;
          FM.fx.p({ k: Math.random() < 0.6 ? 'ice' : 'dot', x: r.x + 4 + Math.random() * 10, y: r.y + r.h - 1, vx: -60 - Math.random() * 160, vy: -60 - Math.random() * 170, life: 0.3 + Math.random() * 0.3, c: Math.random() < 0.5 ? '#e6f8ff' : '#9fe0ff', s: 1.8 + Math.random() * 2.2, g: 600, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, drag: 1 });
        }
      } else a.spray = 0;
    }
  });
  function nearCam(r) {
    const S = FM.S, V = FM.view, cam = S.cam || { x: 0, y: 0 };
    return r.x > cam.x - 150 && r.x < cam.x + (V.VW || 1000) + 150 && r.y > cam.y - 200 && r.y < cam.y + (V.VH || 540) + 200;
  }

  /** Yarışçının alanlarından poz. */
  function racerPose(r, a, id) {
    const spd = abs(r.vx || 0) / ((FM.C && FM.C.RUN) || 330);
    let st, o = { speed: spd };
    if (r.netted > 0) st = 'stun';
    else if (r.frozen > 0) st = 'frozen';
    else if (r.stun > 0) st = 'stun';
    else if (r.dash > 0) st = 'dash';
    else if (r.fly > 0 && id === 'Nuss') { st = 'fly'; o.wph = a.wph; }
    else if (r.slide) st = r.sled > 0 ? 'sled' : 'slide';
    else if (r.climb) st = 'climb';
    else if (!r.onGround) { st = 'air'; o.flip = a.flip; }
    else if (r.pull > 0 && (r.vx || 0) < -20) st = 'pulled';
    else if (r.finished && abs(r.vx || 0) < 40) st = 'cheer';
    else if (abs(r.vx || 0) > 22) st = 'run';
    else st = 'idle';
    const p = makePose(id, st, r.ph || 0, a.t, r.vy || 0, o);
    if (st === 'stun' || st === 'frozen') { /* ifade sabit */ }
    else if (r.boost > 0 || r.padT > 0) { if (p.expr === 'n') p.expr = 'f'; }
    else if (r.inv > 0.9 && r.inv < 100 && p.expr === 'n') p.expr = 'o';                     // yeniden doğuşun ilk anı (inv 1.6 sn): şaşkın yüz
    else if (r.finished && r.place === 1 && p.expr === 'n') p.expr = 'h';                     // birinci: mutlu
    if (p.expr === 'n' && a.blinkT > 0) p.expr = 'b';
    // esneme / ezilme
    if (r.land > 0 && r.onGround && st !== 'slide' && st !== 'sled') { const l = min(1, r.land); p.sy *= 1 - l * 0.2; p.sx *= 1 + l * 0.15; }
    if (r.jumpT > 0 && !(a.flip > 0) && !r.onGround) { const j = min(1, r.jumpT); p.sy *= 1 + j * 0.16; p.sx *= 1 - j * 0.1; }
    return p;
  }

  /* =====================================================================
     ÖNBELLEKLİ EFEKT SPRITE'LARI
     ===================================================================== */
  function shadowSprite() {
    return FM.gfx.sprite('fmc|shadow', 48, 16, 24, 8, g => {
      g.save(); g.scale(1, 0.3);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 22);
      gr.addColorStop(0, 'rgba(12,6,26,0.55)'); gr.addColorStop(0.55, 'rgba(12,6,26,0.36)'); gr.addColorStop(1, 'rgba(12,6,26,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.fill();
      g.restore();
    });
  }
  function bubbleSprite() {
    return FM.gfx.sprite('fmc|bubble', 88, 88, 44, 44, g => {
      const r = 36;
      const gr = g.createRadialGradient(-9, -11, 3, 0, 0, r);
      gr.addColorStop(0, 'rgba(220,250,255,0.08)'); gr.addColorStop(0.68, 'rgba(120,215,255,0.14)');
      gr.addColorStop(0.92, 'rgba(90,200,255,0.42)'); gr.addColorStop(1, 'rgba(190,245,255,0.8)');
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = gr; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = 'rgba(230,252,255,0.95)'; g.stroke();
      g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, r - 6, PI * 1.08, PI * 1.42); g.lineWidth = 4.2; g.strokeStyle = 'rgba(255,255,255,0.78)'; g.stroke();
      g.beginPath(); g.arc(0, 0, r - 6, PI * 1.5, PI * 1.56); g.stroke();
      g.beginPath(); g.arc(0, 0, r - 5, PI * 0.14, PI * 0.46); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.4)'; g.stroke();
      g.beginPath(); g.arc(-15, -23, 2.4, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    });
  }
  function balloonSprite() {
    return FM.gfx.sprite('fmc|balloon', 34, 46, 17, 40, g => {
      const path = B([0, -34, 7.6, -31, 10.6, -22, 8.6, -12, 2.4, -4.4, 0, -3.6, -2.4, -4.4, -8.6, -12, -10.6, -22, -7.6, -31]);
      g.beginPath(); path(g); g.lineWidth = 4.2; g.strokeStyle = '#5a0822'; g.lineJoin = 'round'; g.stroke();
      const gr = g.createRadialGradient(-3.6, -25, 1, 0, -18, 16);
      gr.addColorStop(0, '#ffd6e2'); gr.addColorStop(0.35, '#ff6f96'); gr.addColorStop(0.8, '#e2265a'); gr.addColorStop(1, '#b0123e');
      g.fillStyle = gr; g.fill();
      g.beginPath(); ell(g, -4.4, -25, 2.4, 4.6, 0.35); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
      g.beginPath(); ell(g, -6.4, -17.4, 0.9, 1.4, 0.3); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
      g.beginPath(); g.moveTo(0, -4); g.lineTo(-2.6, -0.4); g.lineTo(2.6, -0.4); g.closePath(); g.fillStyle = '#c4184a'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#5a0822'; g.stroke();
    });
  }
  function starSprite() {
    return FM.gfx.sprite('fmc|star', 16, 16, 8, 8, g => {
      g.beginPath(); starPath(g, 0, 0, 6, 2.8, 5); g.lineJoin = 'round';
      g.lineWidth = 2.6; g.strokeStyle = '#5a3a00'; g.stroke();
      const gr = g.createLinearGradient(0, -6, 0, 6); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#f0a020');
      g.fillStyle = gr; g.fill();
      g.beginPath(); ell(g, -1.2, -1.6, 1.2, 0.8, -0.5); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
    });
  }
  function noteSprite(col) {
    return FM.gfx.sprite('fmc|note|' + col, 18, 20, 7, 14, g => {
      const d = sh(col, -0.6);
      g.lineCap = 'round'; g.lineJoin = 'round';
      const shape = (lw, c) => {
        g.beginPath(); g.moveTo(1.6, 1.6); g.lineTo(1.6, -10); g.quadraticCurveTo(6, -8, 7.4, -4.6); g.strokeStyle = c; g.lineWidth = lw; g.stroke();
        g.beginPath(); ell(g, -1.2, 2, 3.2, 2.4, -0.45); if (lw > 2) { g.lineWidth = lw - 1.6; g.stroke(); } else { g.fillStyle = c; g.fill(); }
      };
      shape(4.4, d);
      shape(1.8, col);
      g.beginPath(); ell(g, -1.2, 2, 3.2, 2.4, -0.45); g.fillStyle = col; g.fill();
      g.beginPath(); ell(g, -2.2, 1.2, 1, 0.6, -0.45); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    });
  }
  function iceSprite() {
    return FM.gfx.sprite('fmc|ice', 60, 80, 30, 74, g => {
      const x0 = -25, y0 = -70, w = 50, h = 69;
      g.beginPath(); rrect(g, x0, y0, w, h, 7);
      g.lineWidth = 3; g.strokeStyle = '#2f7fb8'; g.stroke();
      const gr = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
      gr.addColorStop(0, 'rgba(225,250,255,0.66)'); gr.addColorStop(0.5, 'rgba(150,220,252,0.48)'); gr.addColorStop(1, 'rgba(90,175,240,0.6)');
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 22, y0); g.lineTo(x0, y0 + 30); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x0 + w, y0 + 18); g.lineTo(x0 + w, y0 + h); g.lineTo(x0 + 26, y0 + h); g.closePath(); g.fillStyle = 'rgba(40,120,200,0.16)'; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0 + 6, y0 + 18); g.lineTo(x0 + 17, y0 + 7); g.moveTo(x0 + 6, y0 + 26); g.lineTo(x0 + 11, y0 + 21); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(x0 + 34, y0 + 40); g.lineTo(x0 + 39, y0 + 46); g.lineTo(x0 + 37, y0 + 53); g.moveTo(x0 + 39, y0 + 46); g.lineTo(x0 + 45, y0 + 48); g.stroke();
      g.restore();
      g.beginPath(); rrect(g, x0 + 1.6, y0 + 1.6, w - 3.2, h - 3.2, 6); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
      // kar örtüsü
      const snow = B([x0 - 1, y0 + 4, x0 + 6, y0 - 2.6, x0 + 16, y0 - 1.4, x0 + 26, y0 - 3.2, x0 + 37, y0 - 1.6, x0 + w + 1, y0 + 3, x0 + w - 2, y0 + 7, x0 + 40, y0 + 5, x0 + 34, y0 + 8.4, x0 + 26, y0 + 5.6, x0 + 16, y0 + 8, x0 + 8, y0 + 5.4, x0 + 2, y0 + 8]);
      g.beginPath(); snow(g); g.lineWidth = 2.6; g.strokeStyle = '#4a8fc0'; g.stroke(); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); ell(g, x0 + 30, y0 + 2.4, 6, 1.4); g.fillStyle = '#e2f2ff'; g.fill();
    });
  }
  function flameSprite(i) {
    return FM.gfx.sprite('fmc|flame|' + i, 34, 18, 30, 9, g => {
      const L = 26 + i * 2, w = 6.4 - i * 0.6, b = i === 1 ? -1.6 : i === 2 ? 1.4 : 0;
      const path = g2 => { g2.moveTo(2, -w); g2.bezierCurveTo(-L * 0.35, -w * 1.1 + b, -L * 0.7, -w * 0.3 + b, -L, b * 1.6); g2.bezierCurveTo(-L * 0.7, w * 0.4 + b, -L * 0.35, w * 1.05 + b, 2, w); g2.closePath(); };
      const gr = g.createLinearGradient(2, 0, -L, 0);
      gr.addColorStop(0, 'rgba(255,250,200,0.95)'); gr.addColorStop(0.25, 'rgba(255,200,40,0.95)'); gr.addColorStop(0.6, 'rgba(255,90,20,0.8)'); gr.addColorStop(1, 'rgba(200,20,0,0)');
      g.beginPath(); path(g); g.fillStyle = gr; g.fill();
      g.save(); g.scale(0.55, 0.5);
      g.beginPath(); path(g); g.fillStyle = 'rgba(255,255,230,0.9)'; g.fill();
      g.restore();
    });
  }
  function twinkleSprite(col) {
    return FM.gfx.sprite('fmc|tw|' + col, 20, 20, 10, 10, g => {
      const gs = g.createRadialGradient(0, 0, 0, 0, 0, 9); gs.addColorStop(0, rgba(col, 0.55)); gs.addColorStop(1, rgba(col, 0));
      g.fillStyle = gs; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
      g.beginPath(); sparklePath(g, 0, 0, 7.4); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); sparklePath(g, 0, 0, 4.4); g.fillStyle = col; g.globalAlpha = 0.45; g.fill(); g.globalAlpha = 1;
    });
  }
  function arrowSprite() {
    return FM.gfx.sprite('fmc|arrow', 24, 22, 12, 19, g => {
      const path = g2 => { g2.moveTo(-8.4, -14); g2.quadraticCurveTo(0, -16, 8.4, -14); g2.quadraticCurveTo(9.6, -13, 8.6, -11.6); g2.lineTo(1.6, -1.4); g2.quadraticCurveTo(0, 0.6, -1.6, -1.4); g2.lineTo(-8.6, -11.6); g2.quadraticCurveTo(-9.6, -13, -8.4, -14); g2.closePath(); };
      g.beginPath(); path(g); g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#4a2600'; g.stroke();
      const gr = g.createLinearGradient(0, -15, 0, 0); gr.addColorStop(0, '#fff6b8'); gr.addColorStop(0.4, '#ffd23f'); gr.addColorStop(1, '#e08a0a');
      g.fillStyle = gr; g.fill();
      g.beginPath(); g.moveTo(-6, -12.6); g.quadraticCurveTo(0, -14, 6, -12.6); g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke();
    });
  }

  /* =====================================================================
     İSİM PLAKASI
     ===================================================================== */
  let plateVer = 0;
  try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { plateVer++; }); } catch (e) { /* yok say */ }
  let measureCtx = null;
  const TWC = new Map();   // ad genişliği önbelleği (her karede yazı ölçümü yapılmasın)
  function plateSprite(name, style, big, col) {
    const fs = big ? 12.5 : 10.5;
    col = col || '';
    const key = 'fmplate|' + name + '|' + style + '|' + (big ? 1 : 0) + '|' + plateVer + '|' + col;
    let tw = TWC.get(key);
    if (tw == null) {
      if (!measureCtx) measureCtx = mkCanvas(4, 4).getContext('2d');
      measureCtx.font = fs + 'px ' + FM.FONT_H;
      tw = Math.ceil(measureCtx.measureText(name).width);
      if (TWC.size > 200) TWC.clear();
      TWC.set(key, tw);
    }
    const icon = style === 'clan' ? fs * 0.95 : 0;
    const dot = col ? fs * 0.78 + 3 : 0;          // oyuncu rengi noktası (sol uçta)
    const ph = fs + 7, pw = tw + 15 + icon + dot;
    const pad = 7, top = style === 'fire' ? 7 : 0;
    const W = pw + pad * 2, H = ph + pad * 2 + top;
    const spr = FM.gfx.sprite(key, W, H, W / 2, H - pad, g => {
      const x = -pw / 2, y = -ph, r = ph / 2;
      const pill = () => { g.beginPath(); rrect(g, x, y, pw, ph, r); };
      let tcol = '#ffffff', tstroke = 'rgba(0,0,0,0.35)', tlw = 2.2;
      if (style === 'gold') {
        pill(); g.lineWidth = 3.2; g.strokeStyle = '#5a3200'; g.stroke();
        const gr = g.createLinearGradient(0, y, 0, 0); gr.addColorStop(0, '#fff6c4'); gr.addColorStop(0.45, '#ffd23f'); gr.addColorStop(0.55, '#f0b020'); gr.addColorStop(1, '#b06a08');
        g.fillStyle = gr; g.fill();
        g.save(); pill(); g.clip(); g.beginPath(); ell(g, 0, y + ph * 0.18, pw * 0.48, ph * 0.32); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fill(); g.restore();
        tstroke = '#6b3a00'; tlw = 2.8;
      } else if (style === 'clan') {
        pill(); g.lineWidth = 3.4; g.strokeStyle = '#000000'; g.stroke();
        const gr = g.createLinearGradient(0, y, 0, 0); gr.addColorStop(0, '#34343c'); gr.addColorStop(1, '#09090b');
        g.fillStyle = gr; g.fill();
        g.lineWidth = 1.4; g.strokeStyle = '#c0182e'; g.stroke();
        g.beginPath(); rrect(g, x + 2, y + 2, pw - 4, ph - 4, r - 2); g.lineWidth = 0.6; g.strokeStyle = 'rgba(255,90,100,0.4)'; g.stroke();
        g.beginPath(); spadePath(g, x + 7.5 + dot + icon * 0.3, y + ph / 2 - 0.4, icon * 0.42); g.fillStyle = '#e0243a'; g.fill();
        tstroke = '#000000'; tlw = 2.4;
      } else if (style === 'neon') {
        pill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,59,212,0.28)'; g.stroke();
        g.fillStyle = 'rgba(14,2,30,0.82)'; g.fill();
        g.lineWidth = 1.7; g.strokeStyle = '#ff3bd4'; g.stroke();
        g.beginPath(); rrect(g, x + 2, y + 2, pw - 4, ph - 4, r - 2); g.lineWidth = 0.8; g.strokeStyle = 'rgba(38,240,255,0.9)'; g.stroke();
        tstroke = 'rgba(255,59,212,0.95)'; tlw = 2.6;
      } else if (style === 'fire') {
        // alev dilleri
        g.beginPath();
        const n = Math.max(4, Math.round(pw / 11));
        g.moveTo(x + r * 0.6, y + 2);
        for (let i = 0; i < n; i++) {
          const fx0 = x + r * 0.6 + (pw - r * 1.2) * i / n, fx1 = x + r * 0.6 + (pw - r * 1.2) * (i + 1) / n, hh = 4.5 + (i % 2) * 2.5;
          g.quadraticCurveTo(fx0 + (fx1 - fx0) * 0.2, y - hh * 0.5, (fx0 + fx1) / 2 + 1, y - hh);
          g.quadraticCurveTo(fx0 + (fx1 - fx0) * 0.6, y - hh * 0.3, fx1, y + 2);
        }
        g.closePath();
        g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = '#5a0a00'; g.stroke();
        const fg = g.createLinearGradient(0, y - 8, 0, y + 2); fg.addColorStop(0, '#ffe14d'); fg.addColorStop(1, '#ff6a1a');
        g.fillStyle = fg; g.fill();
        pill(); g.lineWidth = 3.2; g.strokeStyle = '#5a0a00'; g.stroke();
        const gr = g.createLinearGradient(0, y, 0, 0); gr.addColorStop(0, '#ffd84a'); gr.addColorStop(0.45, '#ff8a1a'); gr.addColorStop(1, '#c8201a');
        g.fillStyle = gr; g.fill();
        g.save(); pill(); g.clip(); g.beginPath(); ell(g, 0, y + ph * 0.16, pw * 0.46, ph * 0.28); g.fillStyle = 'rgba(255,255,255,0.32)'; g.fill(); g.restore();
        tstroke = '#5a0a00'; tlw = 2.8;
      } else {
        pill(); g.fillStyle = big ? 'rgba(20,10,40,0.74)' : 'rgba(16,8,32,0.64)'; g.fill();
        if (col && !big) { g.lineWidth = 1.5; g.strokeStyle = rgba(col, 0.85); g.stroke(); }
        else { g.lineWidth = 1; g.strokeStyle = big ? 'rgba(255,225,120,0.7)' : 'rgba(255,255,255,0.22)'; g.stroke(); }
      }
      if (col) {
        // oyuncu rengi: koyu halkalı parlak nokta (aynı karakteri seçen oyuncular ayırt edilsin; ayak halkasıyla aynı renk)
        const dr = fs * 0.39, dx = x + ph / 2 + 0.5, dy = y + ph / 2;
        g.beginPath(); g.arc(dx, dy, dr, 0, TAU); g.lineWidth = 2.2; g.strokeStyle = 'rgba(10,4,22,0.9)'; g.stroke();
        const gr = g.createRadialGradient(dx - dr * 0.35, dy - dr * 0.4, 0.3, dx, dy, dr);
        gr.addColorStop(0, mix(col, '#ffffff', 0.55)); gr.addColorStop(0.6, col); gr.addColorStop(1, mix(col, '#000000', 0.25));
        g.fillStyle = gr; g.fill();
      }
      g.font = fs + 'px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const tx = icon * 0.5 + dot * 0.5 + 0.2, ty = y + ph / 2 + 0.6;
      g.lineWidth = tlw; g.strokeStyle = tstroke; g.strokeText(name, tx, ty);
      g.fillStyle = tcol; g.fillText(name, tx, ty);
    });
    spr.ph = ph + top;
    return spr;
  }

  /* =====================================================================
     DURUM KATMANLARI
     ===================================================================== */
  function drawShadow(ctx, r, isPlayer) {
    if (!FM.game || typeof FM.game.groundY !== 'function' || !FM.S.L || !FM.S.L.solids) return;
    const cx = r.x + r.w / 2, feet = r.y + r.h;
    let gy = null;
    try { gy = FM.game.groundY(cx, feet); } catch (e) { gy = null; }
    if (gy == null) return;
    const h = gy - feet;
    if (h < -12 || h > 420) return;
    const k = clamp(1 - h / 260, 0.25, 1);
    const s = shadowSprite();
    const ws = (r.slide ? 1.45 : 1) * (0.55 + 0.45 * k) * (r.id === 'LUL' ? 1.12 : 1), hs = 0.6 + 0.4 * k;
    ctx.globalAlpha = (0.2 + 0.8 * k) * (r.stale ? 0.5 : 1);
    ctx.drawImage(s.c, cx - s.ox * ws, gy - s.oy * hs, s.w * ws, s.h * hs);
    ctx.globalAlpha = 1;
    // ayak halkası: renk etiketleri açıkken herkese; yerel oyuncuya HER ZAMAN (biraz büyük, nabızlı, işaret renginde)
    if (h < 160) {
      if (isPlayer) drawFootRing(ctx, r, gy, clamp(1 - h / 160, 0, 1), focusCol(r), true);
      else if (TAGS) drawFootRing(ctx, r, gy, clamp(1 - h / 160, 0, 1));
    }
  }
  function drawSpeedFx(ctx, r, a, fx, fy, onBack) {
    const t = a.t;
    if (r.boost > 0) {
      const gs = FM.gfx.glowSprite('rgba(255,140,30,0.75)', 22);
      ctx.globalCompositeOperation = 'lighter';
      const fade = min(1, r.boost * 2);
      ctx.globalAlpha = 0.55 * fade;
      ctx.drawImage(gs.c, fx - 30, fy - 18, 44, 30);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = fade;
      const y0 = onBack ? fy - 9 : fy - 6;
      for (let i = 0; i < 4; i++) {
        const fs = flameSprite((((t * 18) | 0) + i) % 3);
        const sc = (i === 0 ? 1.15 : 0.95 - i * 0.1) + 0.15 * sin(t * 30 + i * 2.1), yy = y0 - 16 + i * 6.5;
        ctx.drawImage(fs.c, fx - 8 - fs.ox * sc, yy - fs.oy * sc, fs.w * sc, fs.h * sc);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (r.padT > 0) {
      const fade = min(1, r.padT * 2);
      ctx.globalCompositeOperation = 'lighter';
      const gs = FM.gfx.glowSprite('rgba(60,220,255,0.8)', 22);
      ctx.globalAlpha = 0.5 * fade; ctx.drawImage(gs.c, fx - 28, fy - 14, 40, 24);
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const ph = (t * 3.2 + i * 0.27) % 1, yy = fy - 6 - i * 9 + (i % 2) * 2, len = 18 + (i % 3) * 7;
        const x1 = fx - 16 - ph * 26;
        ctx.globalAlpha = fade * (1 - ph) * 0.85;
        ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x1 - len, yy);
        ctx.strokeStyle = i % 2 ? '#7be3ff' : '#ffffff'; ctx.lineWidth = i % 2 ? 2.2 : 1.4; ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  let ghostBuf = null;
  function drawGhosts(ctx, r, a, fx, fy, id, skin, p, sc, face) {
    const S = FM.view.S || 1;
    const bw = Math.ceil(120 * S), bh = Math.ceil(104 * S);
    if (!ghostBuf) ghostBuf = mkCanvas(bw, bh);
    if (ghostBuf.width < bw || ghostBuf.height < bh) { ghostBuf.width = max(ghostBuf.width, bw); ghostBuf.height = max(ghostBuf.height, bh); }
    const g = ghostBuf.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, ghostBuf.width, ghostBuf.height);
    const ox = bw * 0.55, oy = bh * 0.84;
    g.setTransform(S * sc * face, 0, 0, S * sc, ox, oy);
    drawFig(g, id, skin, 1, p, a.t, true);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(150,80,235,0.88)'; g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = 'source-over';
    const fade = min(1, r.dash * 4);
    for (let i = 4; i >= 1; i--) {
      ctx.globalAlpha = (0.5 - i * 0.1) * fade;
      ctx.drawImage(ghostBuf, 0, 0, bw, bh, fx - i * 15 * face - ox / S, fy - oy / S + sin(a.t * 20 + i) * 0.6, bw / S, bh / S);
    }
    ctx.globalAlpha = 1;
    // mor parlama
    const gs = FM.gfx.glowSprite('rgba(170,90,255,0.7)', 24);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * fade;
    ctx.drawImage(gs.c, fx - 30 - 20 * face, fy - 50, 60, 50);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function drawBalloon(ctx, r, a, fx, fy, hx, hy) {
    const t = a.t, face = r.face || 1;
    const bx = hx - 15 * face + sin(t * 2.1) * 2.4 - clamp((r.vx || 0) / 330, -1, 2) * 5 * face, by = hy - 26 + sin(t * 2.7) * 2.2 + clamp((r.vy || 0) / 900, -1, 1) * 4;
    const ax = fx - 5 * face, ay = fy - 26;
    ctx.beginPath(); ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax - 6 * face, ay - 8, bx + sin(t * 3) * 4, by + 12, bx, by);
    ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(60,20,40,0.55)'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    const s = balloonSprite();
    ctx.save(); ctx.translate(bx, by); ctx.rotate(sin(t * 2.1) * 0.12 - clamp((r.vx || 0) / 330, -1, 2) * 0.1);
    ctx.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
    ctx.restore();
  }
  function drawShield(ctx, r, a, cx, cy) {
    const t = a.t, s = bubbleSprite();
    const flick = r.shield < 1 ? (((t * 14) | 0) % 2 ? 0.35 : 1) : 1;
    const sc = (r.slide ? 0.9 : 1.14) * (1 + sin(t * 6) * 0.03);
    ctx.globalAlpha = flick;
    ctx.drawImage(s.c, cx - s.ox * sc, cy - s.oy * sc, s.w * sc, s.h * sc);
    const Rr = 34 * sc;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = t * 2.8 + i * TAU / 3;
      ctx.beginPath(); ctx.arc(cx, cy, Rr, a0, a0 + 0.85);
      ctx.strokeStyle = 'rgba(90,210,255,0.55)'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = 'rgba(235,252,255,0.95)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  function drawStunStars(ctx, a, hx, hy, rad) {
    const s = starSprite(), t = a.t;
    for (let i = 0; i < 3; i++) {
      const an = t * 5 + i * TAU / 3, d = sin(an);
      const x = hx + cos(an) * rad, y = hy + d * rad * 0.32;
      const sc = 0.8 + d * 0.25;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 4 + i);
      ctx.globalAlpha = 0.75 + d * 0.25;
      ctx.drawImage(s.c, -s.ox * sc, -s.oy * sc, s.w * sc, s.h * sc);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawIce(ctx, r, a, fx, fy) {
    const s = iceSprite(), t = a.t;
    const sx = r.slide ? 1.3 : 1, sy = r.slide ? 0.6 : 1;
    ctx.drawImage(s.c, fx - s.ox * sx, fy + 2 - s.oy * sy, s.w * sx, s.h * sy);
    const tw = twinkleSprite('#bfefff');
    for (let i = 0; i < 2; i++) {
      const ph = (t * 1.3 + i * 0.5) % 1, k = sin(ph * PI);
      const x = fx + (i ? 14 : -15) * sx, y = fy - (i ? 44 : 22) * sy;
      const sc = k * 0.9;
      if (sc > 0.05) ctx.drawImage(tw.c, x - tw.ox * sc, y - tw.oy * sc, tw.w * sc, tw.h * sc);
    }
  }
  function drawNet(ctx, r, a, fx, fy) {
    const x0 = r.x - 9, x1 = r.x + r.w + 9, y0 = fy - (r.slide ? 34 : 64), y1 = fy + 2;
    const w = x1 - x0, h = y1 - y0, j = () => (Math.random() - 0.5) * 1.8;
    ctx.save();
    ctx.beginPath(); rrect(ctx, x0, y0, w, h, 8);
    ctx.fillStyle = 'rgba(90,200,255,0.12)'; ctx.fill();
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    const step = 13;
    for (let d = -h; d < w + h; d += step) {
      // "\" çizgileri
      let px = x0 + d, py = y0; ctx.moveTo(px, py);
      for (let k = 1; k <= 5; k++) { const tt = k / 5; ctx.lineTo(x0 + d + h * tt + j(), y0 + h * tt + j()); }
      // "/" çizgileri
      px = x0 + d; ctx.moveTo(px, y1);
      for (let k = 1; k <= 5; k++) { const tt = k / 5; ctx.lineTo(x0 + d + h * tt + j(), y1 - h * tt + j()); }
    }
    ctx.strokeStyle = 'rgba(70,180,255,0.32)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(210,248,255,0.7)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath(); rrect(ctx, x0, y0, w, h, 8);
    ctx.strokeStyle = 'rgba(80,200,255,0.6)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = '#e8fdff'; ctx.lineWidth = 1.5; ctx.stroke();
    // kıvılcımlar
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      let px = x0 + Math.random() * w, py = y0 + Math.random() * h; ctx.moveTo(px, py);
      for (let k = 0; k < 3; k++) { px += (Math.random() - 0.5) * 10; py += (Math.random() - 0.5) * 10; ctx.lineTo(px, py); }
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }
  function drawNotes(ctx, a, hx, hy) {
    const t = a.t;
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.85 + i / 3) % 1;
      const s = noteSprite(i % 2 ? '#c084fc' : '#a855f7');
      const side = i === 1 ? 1 : -1;
      const x = hx + side * (15 + ph * 7) + sin(ph * 7 + i * 2) * 2.5, y = hy - 4 - ph * 24;
      const sc = 0.95 + ph * 0.35;
      ctx.globalAlpha = sin(ph * PI) * 0.95;
      ctx.save(); ctx.translate(x, y); ctx.rotate(sin(t * 4 + i) * 0.25);
      ctx.drawImage(s.c, -s.ox * sc, -s.oy * sc, s.w * sc, s.h * sc);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawMagnet(ctx, r, a, cx, cy) {
    const t = a.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const ph = (t * 1.5 + i / 3) % 1, k = 1.5 - ph * 0.75;
      const al = sin(ph * PI) * 0.8;
      ctx.beginPath(); ctx.ellipse(cx, cy, 24 * k, 30 * k, 0, 0, TAU);
      ctx.strokeStyle = 'rgba(192,132,252,' + (al * 0.55).toFixed(3) + ')'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = 'rgba(240,215,255,' + al.toFixed(3) + ')'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.setLineDash([5, 7]); ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.ellipse(cx, cy, 27, 33, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(200,150,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawSkinFx(ctx, skin, a, fx, fy, sc) {
    if (skin === 'altin' || skin === 'buz') {
      const col = skin === 'altin' ? '#ffe680' : '#bfefff';
      const s = twinkleSprite(col);
      for (let i = 0; i < 2; i++) {
        const cyc = a.t * 0.9 + i * 0.5, n = Math.floor(cyc), ph = cyc - n;
        const hh = FM.hash(n * 7 + i * 131 + 17), hv = FM.hash(n * 13 + i * 71 + 5);
        const k = sin(ph * PI);
        const x = fx + (hh - 0.5) * 30 * sc, y = fy - (8 + hv * 44) * sc;
        const z = k * 0.75;
        if (z > 0.05) ctx.drawImage(s.c, x - s.ox * z, y - s.oy * z, s.w * z, s.h * z);
      }
    }
  }

  /* =====================================================================
     YARIŞÇI ÇİZİMİ
     ===================================================================== */
  let racerM = 1, racerDarkBg = false;
  function drawRacer(ctx, r, isPlayer) {
    const a = anim(r);
    const id = DEF[r.id] ? r.id : 'TAFTAF';
    const skin = SKINS[r.skin] ? r.skin : 'klasik';
    const D = DEF[id];
    const face = r.face === -1 ? -1 : 1;
    const fx = r.x + r.w / 2, fy = r.y + r.h;
    const p = racerPose(r, a, id);
    const hl = headLocal(id, p);
    const hx = fx + hl[0] * SC * face, hy = fy + hl[1] * SC;
    a.hx = hx; a.hy = hy;
    const topY = hy - (D.rig.top + 9) * SC * (D.rig.scale || 1);
    a.plX = hx; a.plY = a.plY == null ? topY : lerp(a.plY, topY, 0.5);
    const blinkHide = r.inv > 0 && r.inv < 100 && ((a.t * 16) | 0) % 2 === 0;
    const shake = r.netted > 0 ? (Math.random() - 0.5) * 2.4 : (r.frozen > 0 ? (Math.random() - 0.5) * 0.6 : 0);
    // arkadaki efektler
    if (r.boost > 0 || r.padT > 0) drawSpeedFx(ctx, r, a, fx, fy, p.st === 'slide' || p.st === 'sled');
    if (r.dash > 0) { try { drawGhosts(ctx, r, a, fx, fy, id, skin, p, SC, face); } catch (e) { /* hayalet çizilemedi */ } }
    if (r.balloon) drawBalloon(ctx, r, a, fx, fy, hx, hy);
    if (skin === 'neon' || skin === 'gece') {
      const gs = FM.gfx.glowSprite(skin === 'neon' ? 'rgba(255,60,220,0.6)' : 'rgba(110,90,255,0.45)', 32);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = blinkHide ? 0.08 : (skin === 'neon' ? 0.2 : 0.3) + sin(a.t * 3) * 0.06;
      ctx.drawImage(gs.c, fx - 34, fy - 62, 68, 64);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (racerDarkBg) {
      // koyu temada koyu karakterin arkasına sıcak, yumuşak arka ışık: siluet fondan ayrılsın (önbellekli, 1 drawImage)
      const dk = darkness(id, skin);
      if (dk > 0.02) {
        const gs = FM.gfx.glowSprite('rgba(255,214,176,0.75)', 36);
        const cy = fy - (p.st === 'slide' || p.st === 'sled' ? 14 : 27) * SC * (D.rig.scale || 1);
        ctx.globalAlpha = (blinkHide ? 0.14 : 0.5) * dk;
        ctx.drawImage(gs.c, fx - 44, cy - 46, 88, 92);
        ctx.globalAlpha = 1;
      }
    }
    // YEREL OYUNCU: yumuşak renkli hale (arkada, lighter) + kenar ışığı (figürün altına oyuncu renginde kalın dış hatlı kopya;
    // yalnızca silüetten taşan halka görünür). Parçalar önbellekli: karede +~8 drawImage, yalnızca 1 yarışçı için.
    const fcol = isPlayer ? focusCol(r) : null;
    if (fcol) {
      const gs = FM.gfx.glowSprite(rgba(fcol, 0.7), 34);
      const cy = fy - (p.st === 'slide' || p.st === 'sled' ? 13 : 26) * SC * (D.rig.scale || 1);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (blinkHide ? 0.08 : 0.2) + sin(a.t * 3.4) * 0.05;
      ctx.drawImage(gs.c, fx - 46, cy - 48, 92, 96);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // karakter
    ctx.save();
    if (blinkHide || r.stale) ctx.globalAlpha = (blinkHide ? 0.32 : 1) * (r.stale ? 0.45 : 1);
    ctx.translate(fx + shake, fy);
    ctx.scale(face * SC, SC);
    if (fcol) {
      ctx.save(); ctx.globalAlpha *= 0.82 + 0.18 * sin(a.t * 4);
      try { drawFig(ctx, id, skin, racerM, p, a.t, 'rim:' + fcol); } catch (e) { /* kenar ışığı çizilemedi */ }
      ctx.restore();
    }
    drawFig(ctx, id, skin, racerM, p, a.t, true);
    ctx.restore();
    // öndeki efektler
    if (!blinkHide) drawSkinFx(ctx, skin, a, fx, fy, SC);
    if (r.frozen > 0) drawIce(ctx, r, a, fx, fy);
    if (r.netted > 0) drawNet(ctx, r, a, fx, fy);
    if (r.shield > 0) drawShield(ctx, r, a, fx, r.slide ? fy - 15 : fy - 31 * SC * (D.rig.scale || 1));
    if (r.stun > 0 && !(r.netted > 0)) drawStunStars(ctx, a, hx, hy - 15, 15);
    if (r.slowT > 0) drawNotes(ctx, a, hx, hy);
    if (r.pull > 0) drawMagnet(ctx, r, a, fx, fy - 26);
  }
  /** Öne çıkarılan yarışçının işaret rengi: izleyici kamerası camgöbeği (göz oku ile aynı), ağ/kalabalıkta oyuncu rengi,
      klasik 4 kişilik görünümde altın (okun rengi) */
  function focusCol(r) {
    if (FOCUS_SPEC) return '#3fe0f0';
    return TAGS ? racerColor(r) : '#ffd23f';
  }
  const PLATE_STYLES = { basic: 1, gold: 1, clan: 1, neon: 1, fire: 1 };
  function racerPlate(r, isPlayer) {
    return plateSprite(String(r.nick || r.name || r.id || '').slice(0, 18), PLATE_STYLES[r.plate] ? r.plate : 'basic', isPlayer, TAGS ? racerColor(r) : '');
  }

  /* =====================================================================
     ÇOK OYUNCULU İŞARETLERİ — oyuncu rengi (plaka noktası + ayak halkası), emoji balonu,
     zayıf bağlantı simgesi, izleyici oku
     ===================================================================== */
  /** 10 ayrık oyuncu rengi (ilk 6'sı render-hud RCOL ile aynı sırada; r.idx sırasıyla; ağda idx herkeste aynı → herkes aynı rengi görür). HUD da kullanabilir. */
  const PCOLS = ['#ffd23f', '#ff5a6e', '#4fb3ff', '#5ee07a', '#c084fc', '#ff9f43', '#22d3e6', '#ff6ec7', '#a3e635', '#f2f2f7'];
  function racerColor(r) {
    let i = r && typeof r.idx === 'number' && isFinite(r.idx) ? r.idx | 0 : -1;
    if (i < 0 && FM.S && FM.S.racers) i = FM.S.racers.indexOf(r);
    return PCOLS[max(0, i) % PCOLS.length];
  }
  R.PLAYER_COLORS = PCOLS;
  R.racerColor = racerColor;
  /** Renk etiketleri: ağ yarışında ya da 4'ten fazla yarışçıda (aynı karakter tekrar edebilir). 4 kişilik tek oyunculu görünüm aynen kalır. */
  let TAGS = false;
  function tagsOn() { const S = FM.S; return !!(S && S.mode !== 'demo' && (S.netRole || (S.racers && S.racers.length > 4))); }
  function footRingSprite(col) {
    return FM.gfx.sprite('fmc|fring|' + col, 64, 26, 32, 13, g => {
      g.save(); g.scale(1, 0.34);
      g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.lineWidth = 7; g.strokeStyle = 'rgba(8,4,20,0.55)'; g.stroke();
      const gr = g.createRadialGradient(0, 0, 10, 0, 0, 27); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.75, rgba(col, 0.22)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fill();
      g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.lineWidth = 3.6; g.strokeStyle = col; g.stroke();
      g.beginPath(); g.arc(0, 0, 25, PI * 1.1, PI * 1.9); g.lineWidth = 1.4; g.strokeStyle = mix(col, '#ffffff', 0.6); g.stroke();
      g.restore();
    });
  }
  function drawFootRing(ctx, r, gy, k, col, big) {
    const s = footRingSprite(col || racerColor(r)), cx = r.x + r.w / 2;
    const ws = (0.75 + 0.25 * k) * (r.slide ? 1.25 : 1) * (big ? 1.12 : 1);
    ctx.globalAlpha = (0.35 + 0.6 * k) * (r.stale ? 0.5 : 1) * (big ? 0.85 + 0.15 * sin(anim(r).t * 4) : 1);
    ctx.drawImage(s.c, cx - s.ox * ws, gy - s.oy * ws, s.w * ws, s.h * ws);
    ctx.globalAlpha = 1;
  }
  /* Emoji balonu: kendi küçük LRU önbelleği (ağdan keyfi kısa metin gelebilir; gfx.sprite önbelleği sınırsız) */
  const EMO = new Map();
  const EMO_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
  function emoSprite(str) {
    const k = FM.gfx.rs(), key = str + '|' + k + '|' + plateVer;
    let s = EMO.get(key);
    if (s) { EMO.delete(key); EMO.set(key, s); return s; }
    const txt = /^[\x20-\x7e]+$/.test(str);                 // "GG" gibi düz yazı → başlık yazı tipi
    if (!measureCtx) measureCtx = mkCanvas(4, 4).getContext('2d');
    const fsz = txt ? 17 : 21;
    measureCtx.font = fsz + 'px ' + (txt ? FM.FONT_H : EMO_FONT);
    const tw = Math.ceil(measureCtx.measureText(str).width);
    const bw = max(38, tw + 18), bh = 34, tail = 8, pad = 4;
    const W = bw + pad * 2, H = bh + tail + pad * 2;
    const c = mkCanvas(W * k, H * k), g = c.getContext('2d');
    g.scale(k, k); g.translate(W / 2, H - pad);              // orijin: kuyruğun ucu
    const x = -bw / 2, y = -tail - bh;
    const path = () => {
      g.beginPath();
      const rr = 13;
      g.moveTo(x + rr, y); g.lineTo(x + bw - rr, y); g.quadraticCurveTo(x + bw, y, x + bw, y + rr);
      g.lineTo(x + bw, y + bh - rr); g.quadraticCurveTo(x + bw, y + bh, x + bw - rr, y + bh);
      g.lineTo(5, y + bh); g.quadraticCurveTo(1, -tail * 0.4, -1, 0); g.quadraticCurveTo(-3, y + bh + tail * 0.35, -7, y + bh);
      g.lineTo(x + rr, y + bh); g.quadraticCurveTo(x, y + bh, x, y + bh - rr);
      g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y); g.closePath();
    };
    path(); g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#1a0d2a'; g.stroke();
    const gr = g.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#e4ddf2');
    g.fillStyle = gr; g.fill();
    g.save(); path(); g.clip(); g.beginPath(); ell(g, 0, y + 5, bw * 0.42, 5); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill(); g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const ty = y + bh / 2 + 1;
    if (txt) {
      g.font = fsz + 'px ' + FM.FONT_H; g.lineJoin = 'round';
      g.lineWidth = 4; g.strokeStyle = '#5a2a00'; g.strokeText(str, 0, ty + 0.5);
      const tg = g.createLinearGradient(0, ty - 9, 0, ty + 9); tg.addColorStop(0, '#fff3a0'); tg.addColorStop(0.5, '#ffc21f'); tg.addColorStop(1, '#ff7a12');
      g.fillStyle = tg; g.fillText(str, 0, ty + 0.5);
    } else {
      g.font = fsz + 'px ' + EMO_FONT; g.fillStyle = '#1a0d2a'; g.fillText(str, 0, ty + 1);
    }
    s = { c, w: W, h: H, ox: W / 2, oy: H - pad, bh: bh + tail };
    EMO.set(key, s);
    if (EMO.size > 40) { const old = EMO.keys().next().value; freeCanvas(EMO.get(old).c); EMO.delete(old); }
    return s;
  }
  /** Zayıf bağlantı (r.stale): kırmızı çizgili wifi simgesi */
  function weakSprite() {
    return FM.gfx.sprite('fmc|weak', 22, 20, 11, 10, g => {
      g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fillStyle = 'rgba(20,10,40,0.82)'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.stroke();
      g.lineCap = 'round'; g.strokeStyle = '#e8e4f2';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 4.2, 2.2 + i * 2.6, -PI * 0.78, -PI * 0.22); g.lineWidth = 1.6; g.stroke(); }
      g.beginPath(); g.arc(0, 4.2, 1.1, 0, TAU); g.fillStyle = '#e8e4f2'; g.fill();
      g.beginPath(); g.moveTo(-5.5, -5.5); g.lineTo(5.5, 5.5); g.lineWidth = 2.4; g.strokeStyle = '#ff4d5e'; g.stroke();
    });
  }
  /** İzleyici oku (camgöbeği, göz simgeli): elenmiş/geç katılan oyuncunun kamerasının izlediği yarışçı */
  function specArrowSprite() {
    return FM.gfx.sprite('fmc|sparrow', 24, 22, 12, 19, g => {
      const path = g2 => { g2.moveTo(-8.4, -14); g2.quadraticCurveTo(0, -16, 8.4, -14); g2.quadraticCurveTo(9.6, -13, 8.6, -11.6); g2.lineTo(1.6, -1.4); g2.quadraticCurveTo(0, 0.6, -1.6, -1.4); g2.lineTo(-8.6, -11.6); g2.quadraticCurveTo(-9.6, -13, -8.4, -14); g2.closePath(); };
      g.beginPath(); path(g); g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = '#06303a'; g.stroke();
      const gr = g.createLinearGradient(0, -15, 0, 0); gr.addColorStop(0, '#d8fbff'); gr.addColorStop(0.45, '#3fe0f0'); gr.addColorStop(1, '#0f8fb0');
      g.fillStyle = gr; g.fill();
      g.beginPath(); ell(g, 0, -10.6, 4.2, 2.4); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.arc(0, -10.6, 1.4, 0, TAU); g.fillStyle = '#06303a'; g.fill();
    });
  }
  /** Plakalar çakışınca kısaltılan bot plakasının yerine çizilen küçük renkli işaret (karakterin ana rengi). */
  const MARK_COL = { TAFTAF: '#b46cff', Caner: '#ff3b4e', LUL: '#4f8dff', ertan: '#36d0e0', Kral: '#ffc93a', Nuss: '#eef3ff', baso: '#3cc878' };
  function markSprite(col) {
    return FM.gfx.sprite('fmc|mark2|' + col, 12, 12, 6, 6, g => {
      // küçük renkli nokta: koyu dış hat + gradyan dolgu + parlak nokta (balon/iğne ile karışmasın diye sivri ucu yok)
      g.beginPath(); g.arc(0, 0, 3.7, 0, TAU); g.lineWidth = 2.4; g.strokeStyle = '#1a0d2a'; g.stroke();
      const gr = g.createRadialGradient(-1.2, -1.4, 0.3, 0, 0, 3.9); gr.addColorStop(0, mix(col, '#ffffff', 0.55)); gr.addColorStop(0.6, col); gr.addColorStop(1, mix(col, '#000000', 0.28));
      g.fillStyle = gr; g.fill();
      g.beginPath(); g.arc(-1.2, -1.4, 1.05, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
    });
  }
  /** Telefonda plakaları okunaklı kalacak kadar büyüt. FM.view.S cihaz pikselini içerir; CSS ölçeği = S / dpr
      (telefon ~0.89 css px/birim → bot plakası ~11.5-12 css px). Masaüstünde (CSS ölçeği ≥1) büyütme yok. */
  function plateScale() {
    const V = FM.view, css = (V.S || 1) / (V.dpr || 1);
    return clamp(0.95 / css * ((FM.isTouch || V.mobile) ? 1.18 : 1), 1, 1.45);
  }
  /* Plaka yerleşimi (ekranda dörtlü "kule" oluşmasın):
     - Oyuncunun plakası + oku (zıplama payıyla) hep kafasının üstünde, ilk yerleşir.
     - Bot plakası çakışırsa en fazla BİR plaka yüksekliği yukarı kayabilir; yine sığmazsa adı gizlenir ve yerine
       kafasının üstünde karakter renginde küçük bir işaret çizilir (yumuşak geçişli; titremesin diye histerezisli).
     Böylece en kötü durumda yığın 2 plaka yüksekliğini geçmez; başlangıçta (4 yarışçı üst üste) yalnızca oyuncunun adı kalır. */
  const PLACED = [];
  function plHit(x, y, w, h) {
    for (const q of PLACED) if (abs(q.x - x) < (q.w + w) / 2 && y - h < q.y - 0.5 && q.y - q.h < y - 0.5) return true;
    return false;
  }
  function layoutPlates(list, pl) {
    PLACED.length = 0;
    const ps = plateScale();
    for (let i = list.length - 1; i >= 0; i--) {   // oyuncu listenin sonunda: ilk o yerleşir
      const r = list[i], a = anim(r);
      if (a.plY == null) continue;
      const isP = r === pl;
      const s = racerPlate(r, isP);
      const w = (s.w - 12) * ps, h = (s.ph || 18) * ps + 1;
      let y = a.plY, cmp = 0;
      if (isP) {
        PLACED.push({ x: a.plX, y, w, h, pl: true });
        PLACED.push({ x: a.plX, y: y - h, w: 18 * ps, h: 22 * ps + 5, arrow: true, pl: true });   // ok + zıplama payı (dar)
      } else {
        // histerezis: kısaltılmış plaka geri açılmak için biraz daha geniş boşluk ister
        const wt = (a.plC || 0) > 0.5 ? w + 10 * ps : w;
        if (plHit(a.plX, y, wt, h)) {
          let best = null;
          for (const q of PLACED) {
            const yc = q.y - q.h - 1;
            const lim = (q.arrow ? h : max(h, q.h)) + 2;   // en fazla bir plaka yüksekliği
            if (yc < a.plY && a.plY - yc <= lim && (best === null || yc > best) && !plHit(a.plX, yc, wt, h)) best = yc;
          }
          if (best === null) cmp = 1; else y = best;
        }
        if (!cmp) PLACED.push({ x: a.plX, y, w, h });
      }
      const target = cmp ? 0 : y - a.plY, snap = !!(FM.S && FM.S.paused);   // duraklatılmış kare: geçişi bekletme
      a.plO = a.plO == null || snap ? target : lerp(a.plO, target, 0.22);
      a.plC = a.plC == null || snap ? cmp : lerp(a.plC, cmp, 0.2);
      if (abs(a.plC - cmp) < 0.01) a.plC = cmp;
    }
  }
  /** pass 0: kısaltılmış botların işaretleri (en altta), pass 1: plakalar ve oyuncu oku */
  function drawPlate(ctx, r, isPlayer, pass) {
    const a = anim(r);
    if (a.plY == null) return;
    const ps = plateScale();
    const blink = r.inv > 0 && r.inv < 100 && ((a.t * 16) | 0) % 2 === 0;
    let al = blink ? 0.6 : 1;
    if (!isPlayer && FM.S && FM.S.mode === 'count') al *= 0.6;   // geri sayımda bot adları geri planda kalsın
    const c = isPlayer ? 0 : (a.plC || 0);
    const x = a.plX;
    if (pass === 0) {
      if (c <= 0.01) return;
      const ms = markSprite(TAGS ? racerColor(r) : (MARK_COL[r.id] || '#ffffff')), z = ps * (0.75 + 0.25 * c);
      ctx.globalAlpha = al * c;
      ctx.drawImage(ms.c, x - ms.ox * z, a.plY - 1 - ms.oy * z, ms.w * z, ms.h * z);
      ctx.globalAlpha = 1;
      return;
    }
    if (c >= 0.99) return;
    const s = racerPlate(r, isPlayer);
    const y = a.plY + (a.plO || 0);
    const z = ps * (1 - 0.2 * c);
    ctx.globalAlpha = al * (1 - c);
    ctx.drawImage(s.c, x - s.ox * z, y - s.oy * z, s.w * z, s.h * z);
    if (isPlayer) {
      const ar = FOCUS_SPEC ? specArrowSprite() : arrowSprite(), b = abs(sin(a.t * 4.2)) * 4;
      const tipY = y - ((s.ph || 20) + 2) * ps - b;
      ctx.drawImage(ar.c, x - ar.ox * ps, tipY - ar.oy * ps, ar.w * ps, ar.h * ps);
    }
    if (r.stale && c < 0.5) {
      const ws = weakSprite(), wz = ps * 0.95;
      ctx.globalAlpha = 0.65 + 0.35 * sin(a.t * 6);
      ctx.drawImage(ws.c, x + (s.w / 2 - 6) * z + 2 * ps - ws.ox * wz, y - (s.ph || 18) * z * 0.5 - ws.oy * wz, ws.w * wz, ws.h * wz);
    }
    ctx.globalAlpha = 1;
  }
  /** Emoji balonu (pass 2): plakanın (oyuncuda okun) üstünde; t 3 → 0 (açılışta zıplar, sonda solar) */
  function drawEmote(ctx, r, isPlayer) {
    const e = r.emote, a = anim(r);
    if (!e || typeof e.id !== 'string' || !e.id || a.plY == null) return;
    const t = typeof e.t === 'number' && isFinite(e.t) ? e.t : 0;
    if (t <= 0) return;
    const ps = plateScale(), c = isPlayer ? 0 : (a.plC || 0);
    const s = racerPlate(r, isPlayer);
    let y = a.plY + (a.plO || 0) * (1 - c) - ((s.ph || 18) * ps) * (1 - c) - 2;
    if (isPlayer) y -= 22 * ps + 7;               // okun üstü
    const age = max(0, 3 - t), pop = age < 0.28 ? easeBack(age / 0.28) : 1;
    const es = emoSprite(e.id.slice(0, 8)), z0 = ps * (isPlayer ? 0.95 : 0.85), z = z0 * max(0.05, pop);
    // kalabalıkta balonlar üst üste binmesin: oyuncu önce yerleşir; diğerleri yana/yukarı kayar (yumuşak geçişli)
    const bw = (es.w - 8) * z0, bh = es.bh * z0;
    let ox = 0, oy = 0, hit = true;
    for (let j = 0; j < EM_TRY.length && hit; j++) {
      ox = EM_TRY[j][0] * bw; oy = EM_TRY[j][1] * bh;
      hit = false;
      const cx = a.plX + ox, by = y + oy;
      for (const q of EMP) if (abs(q.x - cx) < (q.w + bw) / 2 && by - bh < q.y && q.y - q.h < by) { hit = true; break; }
    }
    if (hit && !isPlayer) return;                 // aşırı kalabalık: yer yoksa bu karede çizme (oyuncunun plakası örtülmesin)
    if (hit) { ox = 0; oy = 0; }
    EMP.push({ x: a.plX + ox, y: y + oy, w: bw, h: bh });
    const snap = a.emT == null || a.emT !== e;
    a.emT = e;
    a.emX = snap ? ox : lerp(a.emX || 0, ox, 0.25); a.emY = snap ? oy : lerp(a.emY || 0, oy, 0.25);
    const by = y + a.emY + sin(a.t * 3.2) * 1.5;
    ctx.globalAlpha = clamp(t / 0.35, 0, 1) * (r.stale ? 0.6 : 1) * (hit ? 0.8 : 1);
    ctx.drawImage(es.c, a.plX + a.emX - es.ox * z, by - es.oy * z, es.w * z, es.h * z);
    ctx.globalAlpha = 1;
  }
  const EMP = [];
  const EM_TRY = [[0, 0], [0.92, 0], [-0.92, 0], [0, -0.95], [0.92, -0.95], [-0.92, -0.95], [1.84, 0], [-1.84, 0], [1.84, -0.95], [-1.84, -0.95], [0, -1.9], [0.92, -1.9], [-0.92, -1.9]];
  function easeBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  /** Koyu temada (kale) koyu renkli karakterlerin siluet kaybını önleyen sıcak arka ışık gücü (0..1).
      Klasik görünümde elle ayarlı (koyu gövde + koyu dış hat: Caner, ertan, LUL); diğer skin'lerde gövde parlaklığından. */
  const DARK_K = new Map(), DARK_KLASIK = { Caner: 1, ertan: 0.85, LUL: 0.8, baso: 0.4 };
  function darkness(id, skin) {
    const key = id + '|' + skin; let v = DARK_K.get(key);
    if (v == null) {
      const P = pal(id, skin, false);
      v = clamp((0.5 - lum(P.fur || '#808080')) / 0.25, 0, 1);
      if (skin === 'klasik') v = DARK_KLASIK[id] || 0;
      DARK_K.set(key, v);
    }
    return v;
  }
  function darkTheme() { const L = FM.S && FM.S.L; return !!(L && L.theme && L.theme.id === 'castle'); }

  const LIST = [];
  let errCount = 0;
  R.drawRacers = function (ctx) {
    const S = FM.S;
    if (!S || !S.racers || !S.racers.length) return;
    const V = FM.view, cam = S.cam || { x: 0, y: 0 };
    const x0 = cam.x - 140, x1 = cam.x + (V.VW || 1000) + 140, y0 = cam.y - 200, y1 = cam.y + (V.VH || 540) + 200;
    stampNow();
    const list = LIST; list.length = 0;
    platesDue = false;
    let pl = null;
    const showPlayer = !!S.player && S.mode !== 'demo';
    // izleyici kamerası (elenmiş / geç katılan): izlenen yarışçı oyuncu gibi öne alınır, camgöbeği "göz" oku alır
    const P = S.player, watch = showPlayer && P && (P.ghost || P.out) && S.spec && S.spec !== P && !S.spec.out ? S.spec : null;
    FOCUS_SPEC = !!watch;
    TAGS = tagsOn();
    for (const r of S.racers) {
      if (!r || r.dead > 0 || r.off) continue;
      if (r.x + r.w < x0 || r.x > x1 || r.y + r.h < y0 || r.y > y1) continue;
      if ((showPlayer && r === P) || r === watch) pl = r; else list.push(r);
    }
    if (pl) list.push(pl);
    if (!list.length) return;
    // çözünürlük çarpanı (4K'da keskin)
    const k = FM.gfx.rs(), dev = (V.S || 1) * SC;
    racerM = clamp(Math.ceil(dev / k - 0.15), 1, 3);
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    racerDarkBg = darkTheme();
    for (const r of list) drawShadow(ctx, r, r === pl);
    for (const r of list) {
      try { drawRacer(ctx, r, r === pl); }
      catch (e) { if (errCount++ < 5) console.error('[render-chars]', e); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    try { layoutPlates(list, pl); } catch (e) { /* yerleşim hatası plakaları engellemesin */ }
    platePl = pl;
    // plakalar füze/uyarı/parçacıkların ÜSTÜNDE kalsın: render-fx (R.platesLate) drawParticles sonunda R.drawPlates'i çağırır
    if (R.platesLate) platesDue = true; else drawPlateLayers(ctx);
    ctx.globalAlpha = 1;
    ctx.restore();
  };
  let platesDue = false, platePl = null, FOCUS_SPEC = false;
  function drawPlateLayers(ctx) {
    const list = LIST, pl = platePl;
    for (let pass = 0; pass < 2; pass++) {
      for (const r of list) {
        try { drawPlate(ctx, r, r === pl, pass); }
        catch (e) { if (errCount++ < 5) console.error('[render-chars plate]', e); }
      }
    }
    EMP.length = 0;
    for (const q of PLACED) if (q.pl) EMP.push(q);     // oyuncunun plakası ve oku balonların altında kalmasın
    for (let i = list.length - 1; i >= 0; i--) {     // oyuncu (listenin sonunda) önce yerleşir
      const r = list[i];
      if (!r.emote) continue;
      try { drawEmote(ctx, r, r === pl); } catch (e) { if (errCount++ < 5) console.error('[render-chars emote]', e); }
    }
    ctx.globalAlpha = 1;
  }
  /** Yarışçı plakaları + emoji balonları (dünya koordinatı). drawRacers'tan sonra bir kez; render-fx parçacıklardan sonra çağırır. */
  R.drawPlates = function (ctx) {
    if (!platesDue) return;
    platesDue = false;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    try { drawPlateLayers(ctx); } finally { ctx.restore(); }
  };

  /* =====================================================================
     KÜRSÜ / MENÜ ÇİZİMİ
     ===================================================================== */
  function resMul(ctx, scale) {
    let a = FM.view.S || 1;
    try { if (ctx.getTransform) { const t = ctx.getTransform(); a = Math.hypot(t.a, t.b) || a; } } catch (e) { /* eski tarayıcı */ }
    const k = FM.gfx.rs();
    return clamp(Math.ceil(a * abs(scale) / k - 0.15), 1, 4);
  }
  R.drawCharacter = function (ctx, id, x, y, scale, pose, opts) {
    if (!ctx) return;
    stampNow();
    if (!DEF[id]) id = 'TAFTAF';
    pose = pose || {}; opts = opts || {};
    scale = scale || 1;
    const skin = SKINS[opts.skin] ? opts.skin : 'klasik';
    const t = pose.t != null ? pose.t : (FM.S && FM.S.T) || 0;
    const p = makePose(id, pose.st || 'idle', pose.ph || 0, t, pose.vy || 0, { sled: pose.sled, expr: pose.expr, flip: pose.flip, speed: pose.speed, wph: pose.wph });
    if (p.expr === 'n' && opts.blink !== false) { const c = (t + id.length * 0.37) % 3.3; if (c < 0.12) p.expr = 'b'; }
    const m = resMul(ctx, scale);
    const face = opts.face === -1 ? -1 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    if (skin === 'neon' || skin === 'gece') {
      const gs = FM.gfx.glowSprite(skin === 'neon' ? 'rgba(255,60,220,0.6)' : 'rgba(110,90,255,0.45)', 32);
      const ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * (skin === 'neon' ? 0.2 : 0.3);
      ctx.drawImage(gs.c, x - 34 * scale, y - 62 * scale, 68 * scale, 64 * scale);
      ctx.globalAlpha = ga; ctx.globalCompositeOperation = 'source-over';
    }
    ctx.translate(x, y);
    ctx.scale(face * scale, scale);
    drawFig(ctx, id, skin, m, p, t, opts.outline !== false);
    ctx.restore();
    if (skin === 'altin' || skin === 'buz') {
      ctx.save(); drawSkinFx(ctx, skin, { t }, x, y, scale); ctx.restore();
    }
  };

  /* =====================================================================
     PORTRE (önbellekli tuval)
     ===================================================================== */
  const PORT = new Map(), PORT_URL = new Map();
  const PORT_ADJ = { TAFTAF: [-1, 0, 1], Caner: [-3, 0, 0.97], LUL: [-1.5, 0, 1], ertan: [-2, 0, 1], Kral: [0.5, 0, 1], Nuss: [-0.5, 0, 1], baso: [0, 0, 1] };
  R.portrait = function (id, size, opts) {
    if (!DEF[id]) id = 'TAFTAF';
    opts = opts || {};
    size = clamp(Math.round(size || 96), 8, 1024);
    const skin = SKINS[opts.skin] ? opts.skin : 'klasik', bg = opts.bg || '', ex = opts.expr || 'n';
    const key = id + '|' + size + '|' + skin + '|' + bg + '|' + ex + '|' + (opts.ring === false ? 0 : 1);
    let c = PORT.get(key);
    if (c) { PORT.delete(key); PORT.set(key, c); return c; }   // LRU: en son kullanılan sona
    stampNow();
    c = mkCanvas(size, size);
    const g = c.getContext('2d');
    try {
      const adj = PORT_ADJ[id] || [0, 0, 1];
      const D = DEF[id], p0 = makePose(id, 'idle', 0, 0.3, 0, {});
      const hl = headLocal(id, p0), rs0 = D.rig.scale || 1;
      const topY = hl[1] - D.rig.top * rs0, botY = hl[1] + 21 * rs0;      // kafa tepesi → omuzlar
      const sc = size * 0.9 / (botY - topY) * adj[2];
      const cx = size / 2, cyc = size / 2, rad = size * 0.47;
      if (bg) {
        const base = String(bg).charAt(0) === '#' ? bg : '#5b2a86';
        const gr = g.createRadialGradient(cx - rad * 0.3, cyc - rad * 0.4, rad * 0.1, cx, cyc, rad);
        gr.addColorStop(0, mix(base, '#ffffff', 0.35)); gr.addColorStop(0.6, base); gr.addColorStop(1, mix(base, '#000000', 0.35));
        g.beginPath(); g.arc(cx, cyc, rad, 0, TAU); g.fillStyle = gr; g.fill();
        // ışık halkaları
        g.save(); g.beginPath(); g.arc(cx, cyc, rad, 0, TAU); g.clip();
        g.globalAlpha = 0.14; g.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) { const a0 = i / 8 * TAU; g.beginPath(); g.moveTo(cx, cyc); g.arc(cx, cyc, rad, a0, a0 + TAU / 16); g.closePath(); g.fill(); }
        g.restore();
      }
      const p = makePose(id, 'idle', 0, 0.3, 0, { expr: ex });
      p.armF = 0.25; p.armB = -0.1;
      const k = FM.gfx.rs();
      const m = clamp(Math.ceil(sc / k - 0.15), 1, 4);
      const feetX = cx - hl[0] * sc + adj[0] * sc, feetY = size * 0.05 - topY * sc + adj[1] * sc;
      g.save();
      if (bg) { // dairenin altına kırp, üstte kafa taşabilir
        g.beginPath(); g.arc(cx, cyc, rad, 0, PI); g.lineTo(cx - rad, -size); g.lineTo(cx + rad, -size); g.closePath();
        g.rect(0, 0, size, cyc); g.clip();
      }
      g.translate(feetX, feetY); g.scale(sc, sc);
      // portre bir kez üretilip kendi önbelleğinde tutulur: yalnızca onun için üretilen büyük parçalar önbellekte
      // "eski" işaretlenir ki bütçe dolunca ilk onlar atılsın (yarışçıların her karede kullandıkları korunur)
      portBuild = true;
      try { drawFig(g, id, skin, m, p, 0.3, true); } finally { portBuild = false; }
      g.restore();
      if (bg && opts.ring !== false) {
        g.beginPath(); g.arc(cx, cyc, rad, 0.06 * PI, 0.94 * PI);
        g.lineWidth = max(1.5, size * 0.035); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineCap = 'round'; g.stroke();
      }
    } catch (e) { console.error('[portrait]', e); }
    PORT.set(key, c);
    portTrim();
    return c;
  };
  /** Portre önbelleği sınırı: en çok 72 tuval / ~20 MB; en eski kullanılanlar atılır (çağıranlar portreyi hemen çizer
      ya da kendi kopyasını tutar, bu yüzden tuval sıfırlanmaz — yalnızca önbellekten çıkarılır). */
  function portTrim() {
    let bytes = 0; for (const c of PORT.values()) bytes += c.width * c.height * 4;
    for (const [k, c] of PORT) {
      if (PORT.size <= 72 && bytes <= 20e6) break;
      if (PORT.size <= 8) break;
      PORT.delete(k); bytes -= c.width * c.height * 4;
    }
  }
  R.portraitURL = function (id, size, opts) {
    const key = id + '|' + size + '|' + JSON.stringify(opts || {});
    let u = PORT_URL.get(key);
    if (u) { PORT_URL.delete(key); PORT_URL.set(key, u); return u; }
    const c = R.portrait(id, size, opts);
    try { u = c.toDataURL('image/png'); } catch (e) { u = ''; }
    PORT_URL.set(key, u);
    if (PORT_URL.size > 96) { const k0 = PORT_URL.keys().next().value; PORT_URL.delete(k0); }
    return u;
  };
  R.charHeadPos = function (r) { const a = r && AS.get(r); return a ? { x: a.hx, y: a.hy } : null; };
  R.charPalette = function (id, skin) { return pal(DEF[id] ? id : 'TAFTAF', SKINS[skin] ? skin : 'klasik', false); };

  /* =====================================================================
     ÖN ISITMA — yarış başında parçaları birkaç kareye yayarak önceden üret
     ===================================================================== */
  const WARM = [];
  function queueWarm() {
    WARM.length = 0;
    const S = FM.S; if (!S || !S.racers) return;
    for (const r of S.racers) {
      if (!r || !DEF[r.id]) continue;
      const skin = SKINS[r.skin] ? r.skin : 'klasik';
      for (const nm of ['body', 'armF', 'armB', 'legF', 'legB']) WARM.push([r.id, skin, nm, '']);
      for (const ex of ['n', 'b', 'f', 'h', 'o', 'x']) WARM.push([r.id, skin, 'head', ex]);
      if (r.id === 'Nuss') { WARM.push([r.id, skin, 'wingF', '']); WARM.push([r.id, skin, 'wingB', '']); }
    }
  }
  FM.on('race:start', queueWarm);
  FM.on('match:start', queueWarm);
  // çözünürlük değişmediyse parçalar korunur (takılma yok); değiştiyse eski çözünürlüklüler hemen bırakılır
  FM.on('resize', () => { pcTrim('stale'); queueWarm(); });
  /** Geliştirici/test: parça ve portre önbelleklerinin boyutu */
  R.charCacheStats = function () {
    let pb = 0; for (const c of PORT.values()) pb += c.width * c.height * 4;
    return { parts: PC.size, partBytes: pcBytes, budget: pcBudget(), portraits: PORT.size, portraitBytes: pb, portraitURLs: PORT_URL.size };
  };
  R.updaters.push(function () {
    if (!WARM.length) return;
    stampNow();
    let n = 0;
    while (WARM.length && n < 3) {
      const w = WARM.shift();
      try { part(w[0], w[1], w[2], w[3], racerM, 1); } catch (e) { /* yok say */ }
      n++;
    }
  });

  R.CHAR_DEF = DEF;   // geliştirici/test için
})(window.FM);

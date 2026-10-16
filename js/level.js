/* FUAT MOREL — level.js : harita üretimi (yalnızca veri). */
'use strict';
(function (FM) {
  const { clamp } = FM;

  /* Seviye veri yapısı (renderer'lar bunu okur). Harita YALNIZCA (seed, tema, mod, len) ile belirlenir (deterministik:
     aynı girdi → her cihazda aynı harita; ağda yarış bu sayede eşitlenir). Yarışçı sayısına bağlı değildir.
     theme     : FM.THEMES öğesi                mode : 'classic'|'elim'|'coins'|'pure'|'chaos'
     solids    : [{x,y,w,h,float?,bridge?}]  zemin blokları (y = üst yüzey). float=true -> havada platform (h=22)
                                           bridge=true -> tropik sallanan köprünün yürünen tabanı (L.bridges ile aynı yer)
     spikes    : [{x,y,w,h}]              yer dikenleri (her 36 px bir diken), y = diken tepesi
     crush     : [{x,y,w,h}]              tavandan sarkan ezici. ÖLDÜREN bölge {x,y,w,h}; alt kenarı (y+h) zeminin 26 px üstü
     saws      : [{cx,cy,off,r,amp,sp,ph,px,py}] testere makinesi (KAYMA engeli): bıçak merkezi py = cy + off + sin·amp
                                           (zeminden ~58 px yukarıda dar bantta titrer); ray cx'te yukarı uzanır (o da keser). px,py anlık merkez
     boxes     : [{x,y,w,h,cd:[10]}]       eşya kutuları (her yarışçı için ayrı bekleme süresi cd[idx])
     pads      : [{x,y,w}]                 hız pedi (y = zemin üstü)
     mush      : [{x,y,w,sq}]              zıplatan mantar (y = zemin üstü, sq>0 iken ezilme animasyonu)
     belts     : [{x,y,w}]                 ileri iten yürüyen bant
     mud       : [{x,y,w}]                 yavaşlatan çamur
     coins     : [{x,y,got}]               altın (merkez x,y). got = bit maskesi: (got & (1<<racer.idx)) ise o yarışçı almış.
                                           Ekranda yalnızca OYUNCUNUN almadıkları çizilir.
                                           Altın Avı'nda ölümde düşen altınlar da buraya eklenir: {x,y,got,drop:true,v,id,t,vx,vy}
                                           (v = değeri, t = kalan ömür sn; biri alınca got = FM.ALLBITS → kimseye çizilmez)
     decor     : [{x,y,type,layer:'back'|'front',s,flip,seed}]  süs (çarpışmasız). y = zemin üstü (taban noktası)
     liq       : eski sıvı yüzeyi y'si. ARTIK ÇUKUR/SIVI YOK: 1400 (zemin bloklarının içinde, hiç görünmez, kimseyi öldürmez);
                                           yalnızca dünyanın altına düşme güvenlik sınırı (düşen ölmeden son güvenli noktaya taşınır).
     start     : başlangıç çizgisi x, startY: başlangıç zemini y
     end       : bitiş çizgisi x, finY: bitiş zemini y
     len       : toplam genişlik
     --- yeni öğeler (hepsi her zaman dizi; yoksa boş) ---
     ice       : [{x,y,w}]                 kaygan buz zemin (kar). y = zemin üstü
     quicksand : [{x,y,w}]                 bataklık kum (çöl; çamurdan daha yavaşlatır, zıplama zayıflar). y = zemin üstü
     boulders  : [{x0,x1,y,r,sp,warn,per,ph, bx,by,st,k,rot}] yuvarlanan kaya (çöl). Kaya x1'deki tapınak kapısından çıkıp
                                           sola (koşuculara doğru) x0'a kadar yuvarlanır ve orada parçalanır. y = zemin üstü.
                                           Anlık: bx,by = merkez; st: 0 içeride (yok), 1 uyarı (kapı sarsılıyor, k = 0..1 ilerleme,
                                           kaya kapıda yarı görünür ve ZARARSIZ), 2 yuvarlanıyor (ÖLDÜRÜR; k = yol ilerlemesi 0..1); rot = dönüş açısı
     vents     : [{x,y,w,h,kind,per,on,ph, act,k}] yukarı iten akım. Bölge x..x+w, (y-h)..y; y = ağız (zemin üstü).
                                           kind 'lift' = rüzgâr bacası (şehir; hep açık, sürekli kaldırır);
                                           kind 'burst' = gayzer (tropik; per sn'lik döngünün ilk 'on' sn'si fışkırır, fırlatır).
                                           Anlık: act = şu an etkin mi, k = 0..1 (gayzerde fışkırma öncesi 0.6 sn'lik uyarı ilerlemesi; etkinken 1)
     portals   : [{ax,ay,bx,by,r,h}]       ışınlanma kapısı (uzay). A merkezi (ax,ay) havada (zıplayarak girilir), yarıçap r × yarı yükseklik h;
                                           B çıkışı yerde: (bx, by) = çıkış zemini noktası (kapı görseli by-40 civarı)
     lowg      : [{x,w}]                   düşük yerçekimi bölgesi (uzay; yerçekimi ×0.55), tüm yükseklik
     tramp     : [{x,y,w,sq}]              trambolin (şehir çatıları; mantar gibi ama daha güçlü). sq>0 iken esneme animasyonu
     bridges   : [{x,y,w}]                 sallanan halat köprü (tropik) — yürünen taban solids'te {float,bridge}
     gates     : [{x,y,n, off,pass,done}]  eleme kapısı (yalnız 'elim'). y = zemin üstü. Yarışta: off = bu yarışçı sayısında
                                           kullanılmıyor (soluk çiz), pass = geçenlerin sayısı, done = kapı kapandı (eleme yapıldı)
  */
  /* YOKUŞLAR — veri sözleşmesi (render-world bunu çizer):
       Zemin bloğu {x, y, w, h, y2?}: y2 VARSA üst kenar (x, y) → (x + w, y2) düz çizgisidir (eğimli yüzey), alt kenar y + h
       (zemin bloklarında y + h = 1500). y2 yoksa düz (y2 = y). Yüzen platformlar (float) ve köprüler hep düzdür.
       Çizim: dörtgen (x, y) → (x + w, y2) → (x + w, y + h) → (x, y + h); çim/kar/şeker şeridi eğik üst kenar boyunca.
       Komşu bloklar kesintisiz birleşir (bir yokuşun y2'si sonraki bloğun y'sine eşittir; dik basamak/duvar yine olabilir).
       Yardımcılar: FM.level.topAt(s, x) → x'teki yüzey y'si, FM.level.slopeOf(s) → dy/dx (+ aşağı iniş), FM.game.groundY(x, y).
     ÇUKUR YOK (5. tur sonrası): her boşluğun bir tabanı var (vadi/hendek); düşen ölmez, tırmanıp/yokuştan çıkıp biraz zaman kaybeder.
     Hiçbir temada/modda sıvı (su, lav, çikolata, buzlu su, plazma, neon) yok ve öldürmez: liq = 1400 yalnızca güvenlik sınırı.
     Vadi/hendek tabanları ≤ 560. */
  const BASE = ['flat', 'pad', 'dip', 'ditch', 'step', 'wall', 'drop', 'spikes', 'spikes', 'crush', 'crush', 'belt', 'route', 'route', 'plat', 'saw',
    'hill', 'hill', 'ramp', 'ramp', 'roll', 'roll'];
  const TECH = ['flat', 'dip', 'ditch', 'step', 'wall', 'wall', 'drop', 'spikes', 'spikes', 'crush', 'crush', 'route', 'plat', 'plat', 'saw', 'saw',
    'hill', 'ramp', 'roll'];
  // bu bölümlerden sonra iniş noktası belirsiz: hemen ardından tehlike gelmesin
  const LANDY = { route: 1, drop: 1, plat: 1, wall: 1, step: 1, dip: 1, ditch: 1, lowg: 1, portal: 1, roof: 1, chimney: 1, geyser: 1, bridge: 1, stairs: 1, boulder: 1 };
  const HAZ = { spikes: 1, crush: 1, saw: 1, boulder: 1, portal: 1 };
  /* Isınma: başlangıçtan WARM_X'e kadar başlayan bölümler tehlikesiz ve düz (koşu mesafesiyle ~3 sn): start kalabalığı
     ilk saniyelerde dikene/vadiye yığılmasın. Yalnızca bunlar seçilebilir; diğerleri düz zemine döner. */
  const WARM_X = 1060, WARM_OK = { flat: 1, pad: 1, belt: 1 };
  const FLOOR_MAX = 560;           // vadi/hendek tabanı en derin (kamera ve okunurluk için; sıvı yok)
  const TOP_MIN = 220, TOP_MAX = 520;
  function poolFor(themeId, mode) {
    let p = (mode === 'pure' ? TECH : BASE).slice();
    switch (themeId) {
      case 'desert': p = p.map(t => t === 'crush' ? 'boulder' : t).concat(['sandpit', 'sandpit']); break;
      case 'space': p = p.concat(['lowg', 'lowg', 'portal', 'portal']); break;
      case 'city': p = p.concat(['roof', 'roof', 'roof', 'chimney', 'chimney']); break;
      case 'tropic': p = p.concat(['geyser', 'geyser', 'bridge', 'bridge']); break;
    }
    if (mode === 'coins') p = p.concat(['stairs', 'stairs', 'plat', 'route']);
    return p;
  }
  FM.ALLBITS = (1 << FM.MAXR) - 1;
  // eğimli zemin yardımcıları (game.js ve çiziciler kullanır)
  FM.level = {
    topAt(s, px) { if (s.y2 == null) return s.y; const k = (px - s.x) / s.w; return s.y + (s.y2 - s.y) * (k < 0 ? 0 : k > 1 ? 1 : k); },
    slopeOf(s) { return s.y2 == null ? 0 : (s.y2 - s.y) / s.w; },
    topMin(s) { return s.y2 == null ? s.y : Math.min(s.y, s.y2); }
  };

  FM.genLevel = function (rd, opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : ((Math.random() * 1e9) | 0);
    const rnd = FM.mulberry32(seed);
    const rndB = FM.mulberry32((seed ^ 0x5bd1e995) | 0);   // ek süsler (buz vb.): ana dizi değişmesin
    const R = (a, b) => a + rnd() * (b - a), I = (a, b) => Math.floor(R(a, b + 1));
    const RB = (a, b) => a + rndB() * (b - a);
    // tema: indeks (sayı ya da sayı metni) veya id ('desert'); verilmezse tur + S.themeOff ile dönüşümlü
    let ti = -1;
    if (opts.theme != null) ti = FM.themeIndex(typeof opts.theme === 'string' && !isFinite(+opts.theme) ? opts.theme : +opts.theme);
    const theme = ti >= 0 ? FM.THEMES[ti] : FM.THEMES[(rd - 1 + FM.S.themeOff) % FM.THEMES.length];
    const mode = FM.modeById(opts.mode) ? opts.mode : 'classic';
    const tid = theme.id;
    const L = {
      theme, seed, mode, solids: [], spikes: [], crush: [], saws: [], boxes: [], pads: [], mush: [], belts: [], mud: [], coins: [], decor: [],
      ice: [], quicksand: [], boulders: [], vents: [], portals: [], lowg: [], tramp: [], bridges: [], gates: [],
      liq: 1400, start: 60, startY: 460, end: 0, finY: 460, len: 0
    };
    let x = 0, gy = 460, prev = '';
    const noBox = mode === 'pure';
    const coinsM = mode === 'coins';
    // kutular arası en az mesafe: yarışçı başına yarışta ~5-6 eşya (çok sık olunca yarış kaosa dönüyor). Kaos: çok daha sık
    const BOX_GAP = mode === 'chaos' ? 1300 : 2400;
    let lastBox = 1200 - BOX_GAP;   // ilk kutu ~1200. px'ten sonra (başlangıç eşyası kilidi bittikten sonra)
    const ground = w => { L.solids.push({ x, y: gy, w, h: 1500 - gy }); const s = x; x += w; return s; };
    // eğimli zemin: (x, gy) → (x + w, gy + dy); en dik ~37° (|dy|/w ≤ .75)
    const slope = (w, dy) => {
      dy = Math.round(dy); if (!dy) return ground(w);
      w = Math.max(w, Math.abs(dy) / .75);
      L.solids.push({ x, y: gy, w, h: 1500 - gy, y2: gy + dy }); const s = x; x += w; gy += dy; return s;
    };
    // vadi/hendek tabanı (x'ten itibaren w genişlikte, y'de; düz)
    const floor = (x0, w, y) => L.solids.push({ x: x0, y, w, h: 1500 - y });
    const box = (bx, by) => { if (noBox) return; L.boxes.push({ x: bx - 16, y: by - 16, w: 32, h: 32, cd: new Array(FM.MAXR).fill(0) }); lastBox = bx; };
    const coinRow = (x0, y0, n, dx) => { if (coinsM) { n += 2; x0 -= dx; } for (let i = 0; i < n; i++) L.coins.push({ x: x0 + i * dx, y: y0, got: 0 }); };
    const coinArc = (x0, x1, y0, h, n) => { if (coinsM) n += 2; for (let i = 0; i < n; i++) { const t = n === 1 ? .5 : i / (n - 1); L.coins.push({ x: x0 + (x1 - x0) * t, y: y0 - Math.sin(t * Math.PI) * h, got: 0 }); } };
    // yokuş boyunca altın sırası (yüzeyin 36 px üstü)
    const coinSlope = (x0, y0, x1, y1, n) => { if (coinsM) n += 2; for (let i = 0; i < n; i++) { const t = (i + .5) / n; L.coins.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t - 36, got: 0 }); } };
    // Altın Avı: zıplama yüksekliğinde altın kümesi (2 sıra)
    const cluster = (cx, gyy) => { for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) L.coins.push({ x: cx - 45 + i * 30, y: gyy - 95 - r * 32, got: 0 }); };
    // yüzey sınırları içinde rastgele yükseklik değişimi
    const dyIn = (a, b, sign) => { const d = R(a, b) * sign; return clamp(gy + d, TOP_MIN, TOP_MAX) - gy; };
    ground(700);
    const len = opts.len || (coinsM ? 21000 : 15500);
    const pool = poolFor(tid, mode);
    // eleme kapıları: parkurun %24/44/64/84'ünde düz bir bölüm
    const gateAt = mode === 'elim' ? [.24, .44, .64, .84].map(f => f * len) : [];
    while (x < len) {
      if (gateAt.length && x >= gateAt[0]) {
        gateAt.shift();
        const w = R(380, 460), s = ground(w);
        L.gates.push({ x: s + w / 2, y: gy, n: L.gates.length, off: false, pass: 0, done: false });
        prev = 'flat';
        continue;
      }
      let t = pool[I(0, pool.length - 1)];
      const afterRoute = prev === 'route', afterBoulder = prev === 'boulder';
      if (t === prev && t !== 'roll') t = 'flat';
      if (LANDY[prev] && HAZ[t]) t = 'flat';
      // route'un yüksek platformundan inen yarışçı doğrudan vadiye/basamağa düşmesin: route'tan sonra hep geniş düz zemin
      if (afterRoute) t = 'flat';
      // kaya kapısı bölümün sonunda: hemen ardından hendek/duvar gelirse kaya, zıplayan/tırmanan koşucuyu kapıda ezer
      if (afterBoulder) t = 'flat';
      if (t === 'wall' && gy < 300) t = 'drop';
      if (t === 'chimney' && gy < 330) t = 'drop';
      if (t === 'drop' && gy > 420) t = 'step';
      if (t === 'hill' && gy < 300) t = 'dip';
      if (x < WARM_X && !WARM_OK[t]) t = 'flat';
      prev = t;
      // kutu merkezi zeminden 50 px yukarıda: koşarken başa değer (zıplayınca üstünden aşılmaz); kutular seyrek
      if (!noBox && x - lastBox > BOX_GAP && t !== 'route') { const w = afterRoute ? R(380, 460) : R(260, 340), s = ground(w); box(s + w / 2, gy - 50); continue; }
      switch (t) {
        case 'flat': {
          const w = afterRoute ? R(380, 460) : R(260, 420), s = ground(w);
          if (rnd() < .45) coinRow(s + w / 2 - 60, gy - 36, 5, 30);
          else if (coinsM) cluster(s + w / 2, gy);
          break;
        }
        case 'pad': { const w = R(420, 560), s = ground(w); L.pads.push({ x: s + w * .35, y: gy, w: 120 }); coinRow(s + w * .35 + 150, gy - 36, 4, 32); break; }
        /* ---------- YOKUŞLAR (Fun Run 4 gibi inişli çıkışlı) ---------- */
        case 'hill': {
          // tepe: çıkış yokuşu → düzlük → iniş yokuşu
          const up = dyIn(50, 120, -1), s1 = x, y1 = gy;
          slope(R(150, 260), up);
          const e1 = x, ph = gy, wp = R(110, 240), sp = ground(wp);
          if (rnd() < .5) coinRow(sp + 20, ph - 36, Math.max(2, Math.floor(wp / 34)), 30); else coinSlope(s1, y1, e1, ph, 4);
          slope(R(150, 260), dyIn(Math.abs(up) * .7, Math.abs(up) * 1.15, 1));
          if (coinsM) cluster(sp + wp / 2, ph);
          break;
        }
        case 'ramp': {
          // uzun yokuş: seviyeyi değiştirir (iniş ya da çıkış); sonunda kısa düzlük
          const dir = gy > 430 ? -1 : gy < 290 ? 1 : (rnd() < .5 ? -1 : 1);
          const dy = dyIn(50, 150, dir), w = Math.max(R(260, 480), Math.abs(dy) / .55), s0 = x, y0 = gy;
          slope(w, dy);
          coinSlope(s0, y0, x, gy, 5);
          ground(R(100, 200));
          break;
        }
        case 'roll': {
          // inişli çıkışlı arazi: 3-4 yumuşak dalga (toplam seviye aşağı yukarı aynı)
          const n = I(3, 4), y0 = gy;
          for (let i = 0; i < n; i++) {
            const w = R(120, 210), last = i === n - 1;
            const dy = last ? clamp(y0 + R(-20, 20), TOP_MIN, TOP_MAX) - gy : dyIn(18, 48, (i % 2 ? 1 : -1) * (rnd() < .2 ? -1 : 1));
            const s0 = x, ya = gy;
            slope(w, dy);
            if (i === 1 && rnd() < .6) coinSlope(s0, ya, x, gy, 3);
          }
          break;
        }
        /* ---------- VADİLER (eski çukurlar: artık tabanlı, düşen ölmez) ---------- */
        case 'dip': {
          // yokuşlu vadi: inip çıkılır (biraz zaman kaybı); dar olanların üstünden zıplanır
          const d = Math.min(I(70, 150), FLOOR_MAX - gy), s1 = R(.5, .75), s2 = R(.5, .75), gx = x, y0 = gy;
          slope(d / s1, d);
          const wf = R(40, 140); ground(wf);
          slope(d / s2, -d);
          coinArc(gx - 20, x + 20, y0 - 50, 70, 6);
          break;
        }
        case 'ditch': {
          // hendek (eski çukur): dik duvarlı, tabanlı; üstünden zıplanır, düşen tırmanarak çıkar (≤ 150 px duvar)
          const gw = R(100, 170), gx = x, dep = Math.min(I(90, 150), FLOOR_MAX - gy);
          floor(gx, gw, gy + dep); x += gw;
          coinArc(gx - 30, gx + gw + 30, gy - 60, 70, 5);
          ground(R(260, 380));
          break;
        }
        case 'step': {
          const o = [-40, -90, -120, 60, 110].filter(d => gy + d >= TOP_MIN && gy + d <= TOP_MAX);
          const d = o.length ? o[I(0, o.length - 1)] : clamp(gy + 110, TOP_MIN, TOP_MAX) - gy;
          // yarısı yokuş olarak (Fun Run 4: rampalar), yarısı basamak
          if (rnd() < .5 && Math.abs(d) >= 60) slope(Math.abs(d) / R(.45, .7), d); else gy += d;
          const w = R(300, 420), s = ground(w);
          if (coinsM) cluster(s + w / 2, gy);
          break;
        }
        case 'wall': { gy -= I(160, 220); ground(R(380, 520)); break; }
        case 'drop': {
          const d = Math.min(TOP_MAX, gy + I(110, 200)) - gy;
          if (rnd() < .5) slope(d / R(.5, .75), d); else gy += d;
          const w = R(300, 420), s = ground(w); if (coinsM) cluster(s + w / 2, gy);
          break;
        }
        case 'spikes': {
          const w = R(500, 640), s = ground(w);
          const x1 = s + w * .3, w1 = 36 * I(1, 3);
          L.spikes.push({ x: x1, y: gy - 26, w: w1, h: 26 });
          if (rnd() < .5) {
            // ikinci diken birincinin SONUNA göre: arada iki ayrı zıplamaya yetecek 170-240 px boşluk
            const w2 = 36 * I(1, 2);
            let x2 = x1 + w1 + R(170, 240);
            if (x2 + w2 > s + w - 80) x2 = s + w - 80 - w2;
            if (x2 - (x1 + w1) >= 165) L.spikes.push({ x: x2, y: gy - 26, w: w2, h: 26 });
          }
          break;
        }
        case 'crush': {
          const w = R(520, 660), s = ground(w), n = I(1, 2);
          for (let i = 0; i < n; i++) { const cw = R(50, 90); L.crush.push({ x: s + w * (n === 1 ? .45 : .3 + i * .38), y: gy - 300, w: cw, h: 300 - 26 }); }
          break;
        }
        case 'belt': { const w = R(560, 760), s = ground(w); L.belts.push({ x: s + 60, y: gy, w: w - 120 }); break; }
        case 'route': {
          const w = R(820, 980), s = ground(w);
          L.mush.push({ x: s + 60, y: gy, w: 54, sq: 0 });
          // çölde çamur yerine bataklık kum
          (tid === 'desert' ? L.quicksand : L.mud).push({ x: s + 180, y: gy, w: w - 260 });
          const py = gy - 190;
          L.solids.push({ x: s + 200, y: py, w: 300, h: 22, float: true });
          L.solids.push({ x: s + 560, y: py - 30, w: w - 620, h: 22, float: true });
          L.pads.push({ x: s + 260, y: py, w: 120 });
          if (s + 620 - lastBox > BOX_GAP * .6) box(s + 620, py - 80);   // ikinci platformun (py-30) 50 px üstü: koşarken alınır
          coinRow(s + 400, py - 36, 3, 30); coinRow(s + 680, py - 66, 5, 30);
          break;
        }
        case 'plat': {
          // yüzen platformlar; altında tabanlı vadi (düşen ölmez, sondaki duvardan tırmanır ya da yokuştan çıkar)
          let py = gy; const n = I(2, 3), x0 = x, y0 = gy, dep = Math.min(I(110, 160), FLOOR_MAX - gy);
          for (let i = 0; i < n; i++) {
            x += R(90, 130);
            const ny = clamp(py + R(-50, 45), 200, gy + 10), pw = R(100, 140);
            L.solids.push({ x, y: ny, w: pw, h: 22, float: true });
            coinRow(x + pw / 2 - 30, ny - 36, 3, 30);
            x += pw; py = ny;
          }
          x += R(90, 120);
          floor(x0, x - x0, y0 + dep);
          ground(R(280, 380)); break;
        }
        case 'saw': {
          const w = R(560, 680), s = ground(w);
          // KAYMA engeli: bıçak merkezi zeminden 58±3 px yukarıda dar bir bantta titrer (off 22, amp 3) → ayakta koşan HER evrede
          // ölür, kayan HER evrede geçer ve bıçak kayanın başının ÜSTÜNDE görünür. Bıçağın üstündeki ray da keser (game.js).
          // cy = zemin − 80 ilişkisi korunur (render-world tabanı cy + 80'e çizer).
          L.saws.push({ cx: s + w / 2, cy: gy - 80, off: 22, r: 28, amp: 3, sp: R(1.6, 2.2), ph: rnd() * 6.28, px: s + w / 2, py: gy - 58 });
          break;
        }
        /* ---------- ÇÖL ---------- */
        case 'sandpit': {
          // zeminde bataklık kum: üstünden zıplanırsa hız kaybı yok, içinden geçen çok yavaşlar
          const w = R(520, 640), s = ground(w), qx = s + w * .42, qw = R(130, 200);
          L.quicksand.push({ x: qx, y: gy, w: qw });
          coinArc(qx - 20, qx + qw + 20, gy - 52, 66, 5);
          break;
        }
        case 'boulder': {
          // kaya x1'deki kapıdan çıkar, sola yuvarlanır (koşuculara doğru), x0'da parçalanır. Zıplayarak aşılır
          // (kapanma hızı ~590 px/sn; zıplama penceresi geniş). Çıkmadan önce 0.8 sn kapı sarsılır (uyarı). Düz zeminde.
          const w = R(820, 960), s = ground(w);
          const r = 30, x0 = s + 110, x1 = s + w - 60, sp = R(245, 285), warn = .8;
          const per = warn + (x1 - x0) / sp + R(.9, 1.7);
          L.boulders.push({ x0, x1, y: gy, r, sp, warn, per, ph: rnd() * per, bx: x1, by: gy - r, st: 0, k: 0, rot: 0 });
          if (coinsM) cluster(s + w * .5, gy);
          break;
        }
        /* ---------- UZAY ---------- */
        case 'lowg': {
          // geniş vadi + düşük yerçekimi (×0.55): uzun süzülen zıplayışlar; ortada basamak platformu, tabanı yokuşlu (ölüm yok)
          const w1 = R(200, 280); const s1 = ground(w1);
          const gw = R(400, 520), gx = x, y0 = gy, dep = Math.min(I(100, 140), FLOOR_MAX - gy);
          const pw = R(100, 130), py = gy - R(30, 80);
          slope(dep / .6, dep); ground(Math.max(40, gw - 2 * dep / .6)); slope(dep / .6, -dep);
          L.solids.push({ x: gx + (x - gx) / 2 - pw / 2, y: py, w: pw, h: 22, float: true });
          coinArc(gx + 10, x - 10, y0 - 150, 120, 7);
          L.lowg.push({ x: s1 + w1 - 140, w: (x - gx) + 300 });
          ground(R(320, 420));
          break;
        }
        case 'portal': {
          // A havada (zıplayarak girilir) → B yerde, dikenlerin ötesinde (kestirme). Altından koşan dikenleri aşar.
          const w = R(980, 1120), s = ground(w);
          const ax = s + 230, ay = gy - 112;
          const w1 = 36 * I(1, 2), sx1 = s + 420;
          L.spikes.push({ x: sx1, y: gy - 26, w: w1, h: 26 });
          const w2 = 36 * I(1, 2), sx2 = sx1 + w1 + R(185, 230);
          L.spikes.push({ x: sx2, y: gy - 26, w: w2, h: 26 });
          const bx = Math.max(sx2 + w2 + 150, s + 800);
          L.portals.push({ ax, ay, bx, by: gy, r: 22, h: 38 });
          coinArc(ax - 30, ax + 30, ay - 40, 20, 3);
          coinRow(bx + 50, gy - 36, 3, 30);
          break;
        }
        /* ---------- ŞEHİR ---------- */
        case 'roof': {
          // çatı kenarında trambolin → çatılar arası ara sokak (tabanlı: düşen duvardan tırmanır; trambolin otomatik fırlatır)
          const w = R(360, 460), s = ground(w);
          L.tramp.push({ x: s + w - 84, y: gy, w: 60, sq: 0 });
          const gw = R(180, 250), gx = x, fy = Math.min(gy + 170, FLOOR_MAX);
          floor(gx, gw, fy); x += gw;
          gy = clamp(gy + [-30, 0, 30, 60][I(0, 3)], 240, TOP_MAX);
          coinArc(gx - 60, gx + gw + 60, gy - 150, 150, 6);
          ground(R(340, 440));
          break;
        }
        case 'chimney': {
          // yüksek duvarın dibinde rüzgâr bacası: içine giren yukarı taşınır (tırmanmaktan hızlı)
          const w = R(300, 380), s = ground(w);
          const wh = I(200, 250);
          L.vents.push({ x: s + w - 100, y: gy, w: 100, h: wh + 90, kind: 'lift', per: 0, on: 0, ph: 0, act: true, k: 1 });
          gy -= wh;
          ground(R(380, 500));
          break;
        }
        /* ---------- TROPİK ---------- */
        case 'geyser': {
          // periyodik gayzer: fışkırırken üstünden geçeni yukarıdaki altınlı platforma fırlatır (isteğe bağlı yol)
          const w = R(640, 760), s = ground(w);
          const per = R(2.6, 3.2);
          L.vents.push({ x: s + 150, y: gy, w: 64, h: 300, kind: 'burst', per, on: 1.1, ph: rnd() * per, act: false, k: 0 });
          const py = gy - 250;
          L.solids.push({ x: s + 250, y: py, w: 300, h: 22, float: true });
          coinRow(s + 290, py - 36, 6, 34);
          if (s + 450 - lastBox > BOX_GAP * .5) box(s + 470, py - 50);
          break;
        }
        case 'bridge': {
          // sallanan köprü; altında tabanlı dere yatağı (düşen ölmez, kenardan tırmanır)
          const gw = R(280, 400), gx = x;
          floor(gx, gw, Math.min(gy + 140, FLOOR_MAX)); x += gw;
          L.solids.push({ x: gx - 10, y: gy, w: gw + 20, h: 22, float: true, bridge: true });
          L.bridges.push({ x: gx, y: gy, w: gw });
          coinRow(gx + gw / 2 - 45, gy - 36, 4, 30);
          ground(R(300, 400));
          break;
        }
        /* ---------- ALTIN AVI: yüksek yol ---------- */
        case 'stairs': {
          const w = R(700, 820), s = ground(w);
          let py = gy;
          for (let i = 0; i < 3; i++) { py -= R(80, 96); const px = s + 100 + i * 190; L.solids.push({ x: px, y: py, w: 130, h: 22, float: true }); coinRow(px + 20, py - 36, 4, 30); }
          break;
        }
      }
    }
    const s = ground(1400);
    L.end = s + 560; L.finY = gy; L.len = x;
    // güvenlik ağı: sayısal olarak bozuk bir harita (NaN/sonsuz) asla oyuna gitmesin
    const okNum = o => isFinite(o.x) && isFinite(o.y) && isFinite(o.w);
    if (!L.solids.every(okNum) || !isFinite(L.end) || !isFinite(L.finY)) {
      if (!opts._retry || opts._retry < 5) return FM.genLevel(rd, Object.assign({}, opts, { seed: (seed + 7919) | 0, _retry: (opts._retry || 0) + 1 }));
    }

    /* ---- kar: buzlu zemin parçaları (tehlikelerden uzak düz kısımlarda) ---- */
    if (tid === 'snow') {
      const keep = [];
      for (const o of L.spikes) keep.push([o.x - 170, o.x + o.w + 40]);
      for (const o of L.crush) keep.push([o.x - 170, o.x + o.w + 40]);
      for (const o of L.saws) keep.push([o.cx - 200, o.cx + 70]);
      for (const o of L.pads) keep.push([o.x - 20, o.x + o.w + 20]);
      for (const o of L.belts) keep.push([o.x - 20, o.x + o.w + 20]);
      for (const o of L.mud) keep.push([o.x - 20, o.x + o.w + 20]);
      for (const o of L.mush) keep.push([o.x - 30, o.x + o.w + 30]);
      for (const o of L.boxes) keep.push([o.x - 40, o.x + o.w + 40]);
      for (const o of L.gates) keep.push([o.x - 60, o.x + 60]);
      for (const sd of L.solids) {
        if (sd.float || sd.y2 != null || sd.w < 300 || sd.x < 900 || sd.x + sd.w > L.end - 300) continue;
        if (rndB() > .5) continue;
        // katının içinde engelsiz en uzun aralık
        let a = sd.x + 50; const b = sd.x + sd.w - 50;
        const cuts = keep.filter(k => k[1] > a && k[0] < b).sort((p, q) => p[0] - q[0]);
        let best = null;
        for (const k of cuts) { if (k[0] - a > (best ? best[1] - best[0] : 0)) best = [a, k[0]]; a = Math.max(a, k[1]); }
        if (b - a > (best ? best[1] - best[0] : 0)) best = [a, b];
        if (best && best[1] - best[0] >= 170) {
          const w = Math.min(best[1] - best[0], RB(220, 460));
          const x0 = best[0] + RB(0, best[1] - best[0] - w);
          L.ice.push({ x: x0, y: sd.y, w });
        }
      }
    }

    /* ---- dekor üretimi ---- */
    const set = FM.DECOR[tid] || FM.DECOR.forest;
    const busy = [];
    const mark = (a, b) => busy.push([a, b]);
    for (const o of L.spikes) mark(o.x - 50, o.x + o.w + 50);
    for (const o of L.crush) mark(o.x - 60, o.x + o.w + 60);
    for (const o of L.saws) mark(o.cx - 90, o.cx + 90);
    for (const o of L.pads) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.mush) mark(o.x - 40, o.x + o.w + 40);
    for (const o of L.belts) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.mud) mark(o.x - 20, o.x + o.w + 20);
    for (const o of L.boxes) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.quicksand) mark(o.x - 20, o.x + o.w + 20);
    for (const o of L.boulders) mark(o.x0 - 40, o.x1 + 70);
    for (const o of L.vents) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.portals) { mark(o.ax - 50, o.ax + 50); mark(o.bx - 50, o.bx + 50); }
    for (const o of L.tramp) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.gates) mark(o.x - 70, o.x + 70);
    mark(L.start - 80, L.start + 160); mark(L.end - 120, L.end + 200);
    const free = (a, b) => !busy.some(([p, q]) => a < q && b > p);
    let ds = 1;
    for (const sd of L.solids) {
      if (sd.float) continue;
      const steep = Math.abs(FM.level.slopeOf(sd)) > .3;   // dik yokuşta dekor yok (eğik zeminde havada durmasın)
      let px = sd.x + R(30, 90);
      while (px < sd.x + sd.w - 40) {
        const backTurn = rnd() < .38;
        const type = backTurn ? set.back[I(0, set.back.length - 1)] : set.front[I(0, set.front.length - 1)];
        const half = backTurn ? 46 : 18;
        if (!steep && px - half > sd.x + 6 && px + half < sd.x + sd.w - 6 && (backTurn || free(px - half, px + half))) {
          // arka dekor (ağaç vb.) yarışçının arkasında kalır; ön dekor küçük süs. Eğimli zeminde yüzeyin en alçak noktasına
          // (dekorun tabanı gömülü kalsın, havada durmasın)
          const dy = sd.y2 == null ? sd.y : Math.max(FM.level.topAt(sd, px - half * .6), FM.level.topAt(sd, px + half * .6));
          L.decor.push({ x: px, y: dy, type, layer: backTurn ? 'back' : 'front', s: backTurn ? R(.85, 1.25) : R(.8, 1.2), flip: rnd() < .5, seed: (seed + ds++ * 7919) | 0 });
        }
        px += backTurn ? R(150, 320) : R(60, 170);
      }
    }
    return L;
  };
})(window.FM);

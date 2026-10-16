/* FUAT MOREL — core.js
   Ortak isim alanı, sabitler, veri tabloları, yardımcılar, olay sistemi, efekt (veri) üreticileri, kayıt sistemi.
   Bu dosya HİÇBİR ŞEY çizmez. Tüm diğer dosyalar bundan sonra yüklenir. */
'use strict';
window.FM = window.FM || {};
(function (FM) {

  /* ---------------- sabitler ---------------- */
  const C = FM.C = {
    G: 2400, JUMP: 830, DJ: 760, RUN: 330, ACC: 1100, AIRACC: 650, CLIMB: 420, SLAM: 1400, MUSH: 1250,
    RW: 28, RH: 42, SH: 22,      // yarışçı çarpışma kutusu (ayakta / kayarken)
    KILLY: 1400,                 // varlıklar (mermi vb.) için alt sınır
    VH: 540,                     // mantıksal ekran yüksekliği (görünen dünya yüksekliği)
    STEP: 1 / 120                // sabit fizik adımı
  };
  /* Puan / kupa tabloları 10 kişilik (FM.MAXR). n kişilik yarışta FM.ptsFor(n) / FM.trophyFor(n) kullan:
     tablo n sıraya eşit aralıklarla örneklenir (4 kişide puan 15/8/4/1, kupa 30/12/-5/-15 — eski 4 kişilik kupa aynen).
     Kupa: ilk yarı +, son yarı −; tek sayıda yarışçıda ortadaki 0. */
  FM.MAXR = 10;
  FM.PTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1];
  FM.TROPHY = [30, 24, 18, 12, 6, -2, -5, -8, -12, -15];
  function sampleTable(tab, n) {
    n = Math.max(1, Math.min(tab.length, n | 0));
    const out = [];
    for (let i = 0; i < n; i++) out.push(tab[n === 1 ? 0 : Math.round(i * (tab.length - 1) / (n - 1))]);
    return out;
  }
  FM.ptsFor = n => sampleTable(FM.PTS, n);
  FM.trophyFor = function (n) {
    const t = sampleTable(FM.TROPHY, n);
    if (t.length > 2 && t.length % 2 === 1) t[(t.length - 1) / 2] = 0;
    return t;
  };

  /* ---------------- oyun modları (S.gameMode) ---------------- */
  FM.MODES = [
    { id: 'classic', n: 'Klasik Yarış', ic: '🏁', d: 'Bitişe ilk varan kazanır.' },
    { id: 'elim',    n: 'Eleme',        ic: '🚪', d: 'Eleme kapılarından en son geçen elenir. Son kalan ya da bitişe ilk varan kazanır.' },
    { id: 'coins',   n: 'Altın Avı',    ic: '🪙', d: '75 saniyede en çok altını topla! Ölünce altınının %20\'sini düşürürsün; bitişe varan +15 altın alır.' },
    { id: 'pure',    n: 'Saf Parkur',   ic: '🧗', d: 'Eşya kutusu yok, yalnızca özel güç. Daha teknik bir harita.' },
    { id: 'chaos',   n: 'Kaos',         ic: '☄️', d: 'Kutular hemen yenilenir, güç iki kat hızlı dolar, gökten meteor yağar!' }
  ];
  FM.modeById = id => FM.MODES.find(m => m.id === id) || null;
  FM.COINS_TIME = 75;      // Altın Avı süresi (sn)
  FM.COINS_FINISH = 15;    // Altın Avı'nda bitişe varana bonus altın

  /* ---------------- eşyalar ---------------- */
  // col: eşyanın tema rengi (HUD/çizim için)
  FM.ITEMS = {
    saw:     { ic: '🪚', n: 'Testere',       col: '#c7ccd6', d: 'Yerde yuvarlanır, duvardan seker. Değdiği herkesi öldürür — geri sekerse seni de!' },
    dyn:     { ic: '🧨', n: 'Dinamit',       col: '#e23b3b', d: 'İleri fırlatılır, 1 sn sonra patlar. Yakındaysan sen de gidersin.' },
    trap:    { ic: '🪤', n: 'Ayı Tuzağı',    col: '#9aa3b2', d: 'Arkana bırakılır. Basan ölür (sen dahil).' },
    mis:     { ic: '🚀', n: 'Güdümlü Füze',  col: '#ff6b3d', d: 'Lideri (lider sensen ikinciyi) kovalar ve patlar.' },
    bolt:    { ic: '🌩️', n: 'Yıldırım',      col: '#ffe14d', d: 'Önündeki rakiplerin (en yakın 4 kişi) üstünde bulut belirir, 1.8 sn sonra çakar. Kalkan ve balon korur.' },
    ice:     { ic: '❄️', n: 'Kar Fırtınası', col: '#9be7ff', d: 'Diğer herkesi 2.2 sn dondurur, buzda kayarlar.' },
    mag:     { ic: '🧲', n: 'Mıknatıs',      col: '#c084fc', d: 'Öndekileri sana doğru geri çeker.' },
    net:     { ic: '🕸️', n: 'Elektrik Ağı',  col: '#7be3ff', d: 'Havaya kurulur, yakalananı 1.5 sn tutar.' },
    ink:     { ic: '🦑', n: 'Mürekkep',      col: '#3b3b55', d: 'Öndekilerin ekranını 3.5 sn karartır.' },
    speed:   { ic: '👟', n: 'Hız',           col: '#ffb020', d: '3.2 sn çok hızlı koşarsın. Kalkanı iptal eder.' },
    shield:  { ic: '🛡️', n: 'Kalkan',        col: '#5ad1ff', d: '4 sn her şeye karşı korur. Hızı iptal eder.' },
    balloon: { ic: '🎈', n: 'Balon',         col: '#ff5a7a', d: 'Bir saldırıyı emer ve patlar.' }
  };

  /* ---------------- karakterler ---------------- */
  // Görünüş bilgisi (render-chars.js bunları kullanır). Tüm karakterlerin hız/zıplama/dolum değerleri AYNIDIR.
  FM.CH = {
    TAFTAF: { role: 'Üye Alım Görevlisi', tr: 2555, species: 'Kedi',     ab: 'Gölge Atılımı',      col: '#efe0c0', col2: '#5b2a86', acc: '#d62828',
      d: 'Maskeli kedi 0.55 sn boyunca ışık gibi ileri atılır. Atılım sırasında hiçbir şey ona zarar veremez, boşlukların üstünden geçer.',
      look: 'Krem kedi, mor göz maskesi, kırmızı kep, pembe kulak içi, kıvrık kuyruk' },
    Caner:  { role: 'Lider',              tr: 1999, species: 'Karga',    ab: 'Kızıl Ay Kargaları', col: '#1d1d26', col2: '#c0182e', acc: '#f2b134',
      d: 'Kızıl ayın kargalarını çağırır: kargalar en yakın öndeki rakibe uçar ve onu 2 sn sersemletir. Önde kimse yoksa kargalar Caner\'i hızlandırır.',
      look: 'Kara karga, parlayan kırmızı gözler, kızıl atkı, turuncu gaga, tüy tepeliği, kızıl ay simgesi' },
    LUL:    { role: 'Görevli',            tr: 872,  species: 'Goril',    ab: 'Goril Yumruğu',      col: '#2f4f9a', col2: '#8fa8dd', acc: '#0d0d12',
      d: 'Yere öyle bir vurur ki 340 px çevresindeki yerdeki herkes 1.7 sn sersemler (öndeki de arkadaki de).',
      look: 'Mavi goril, açık mavi yüz/göğüs, siyah güneş gözlüğü, iri kollar' },
    ertan:  { role: 'Üye',                tr: 588,  species: 'Penguen',  ab: 'Buz Kızağı',         col: '#34305e', col2: '#8fd3ff', acc: '#3ec1c9',
      d: 'Göbeğinin üstünde 1.25 sn hızla kayar. Kayarken diken, tuzak, ağ ve ezicilerden etkilenmez.',
      look: 'Koyu mor penguen, beyaz göğüs, yuvarlak turkuaz gözlük, açık mavi ceket, beyaz spor ayakkabı' },
    Kral:   { role: 'Üye',                tr: 1188, species: 'Aslan',    ab: 'Kral Kükremesi',     col: '#d89a45', col2: '#9c4f1c', acc: '#ffd23f',
      d: 'Kükreyerek öndeki yakın rakipleri geri savurur ve çevresindeki tüm tuzakları, testereleri, füzeleri yok eder.',
      look: 'Aslan, gür kahverengi yele, altın taç (kırmızı/mavi taşlı), kırmızı pelerin (beyaz kürk kenarlı)' },
    Nuss:   { role: 'Üye',                tr: 1131, species: 'Baykuş',   ab: 'Tüy Süzülüşü',       col: '#f0f4ff', col2: '#7be3ff', acc: '#ffd23f',
      d: 'Baykuş kanatlarını açar: 2.4 sn süzülür, havadayken zıplama tuşuyla kanat çırpar. Boşluklar ve tuzaklar onu durduramaz.',
      look: 'Beyaz kar baykuşu, iri sarı gözler, kulak tüyleri, gri benekler, başında mavi tüy' },
    baso:   { role: 'Üye',                tr: 668,  species: 'Ayı',      ab: 'Bas Dalgası',        col: '#8b5a33', col2: '#3cb371', acc: '#e63946',
      d: 'Kulaklıktaki bası sonuna kadar açar: ileri giden ses dalgası çarptığı herkesi 3.2 sn yarı hıza düşürür.',
      look: 'Kahverengi ayı, yeşil kapüşonlu, siyah kafa bantlı kırmızı kulaklık' }
  };
  FM.ORDER = ['TAFTAF', 'Caner', 'LUL', 'ertan', 'Kral', 'Nuss', 'baso'];

  /* ---------------- temalar ---------------- */
  // Renderer'lar ek alanları kendi içinde id'ye göre tanımlayabilir; burada çekirdek palet var.
  // Dizinin SIRASI kalıcıdır (ağda tema indeksle gider): yeni tema yalnızca SONA eklenir.
  // base: yeni temalar için en yakın eski tema (render-world henüz bilmediği temayı geçici olarak bununla çizebilir).
  // mech: haritanın özel mekaniği (arayüzde harita seçiminde gösterilebilir).
  FM.THEMES = [
    { id: 'forest', n: 'Çılgın Orman',      liquid: 'water',     sky: ['#3d9cf5', '#8fd0ff', '#e3f6ff'], mech: 'Mantarlar, yürüyen bantlar, testereler' },
    { id: 'candy',  n: 'Şeker Diyarı',      liquid: 'chocolate', sky: ['#ff8fc8', '#ffc0e3', '#fff1fa'], mech: 'Çikolata çukurları, zıplatan mantarlar' },
    { id: 'snow',   n: 'Karlı Zirve',       liquid: 'icewater',  sky: ['#5b93dc', '#a9cdf3', '#eef6ff'], mech: 'Buzlu zemin: kaygan ve hızlı' },
    { id: 'castle', n: 'Gün Batımı Kalesi', liquid: 'lava',      sky: ['#2b1a4a', '#ff6f61', '#ffc778'], mech: 'Lav çukurları, eziciler' },
    { id: 'desert', n: 'Çöl Tapınağı',      liquid: 'quicksand', sky: ['#f08a3c', '#ffc27a', '#fff0c8'], base: 'castle', mech: 'Yuvarlanan kayalar, bataklık kum' },
    { id: 'space',  n: 'Uzay İstasyonu',    liquid: 'plasma',    sky: ['#0b0a2a', '#2a1a6a', '#5a3aa0'], base: 'castle', mech: 'Düşük yerçekimi, ışınlanma kapıları' },
    { id: 'city',   n: 'Gece Şehri',        liquid: 'neon',      sky: ['#0d1033', '#3a1f6e', '#ff5fa2'], base: 'castle', mech: 'Çatı trambolinleri, rüzgâr bacaları' },
    { id: 'tropic', n: 'Tropik Ada',        liquid: 'water',     sky: ['#1fb5e8', '#7fe0f5', '#e8fbff'], base: 'forest', mech: 'Gayzerler, sallanan köprüler' }
  ];
  FM.themeIndex = function (v) {
    if (typeof v === 'number' && isFinite(v)) return ((v | 0) % FM.THEMES.length + FM.THEMES.length) % FM.THEMES.length;
    const i = FM.THEMES.findIndex(t => t.id === v);
    return i >= 0 ? i : -1;
  };
  // Her temada üretilecek dekor tipleri (render-world.js hepsini çizmek ZORUNDA; bilinmeyen tip çizilmeden atlanır)
  FM.DECOR = {
    forest: { back: ['tree', 'tree2', 'bush', 'rock_big'],          front: ['flower', 'grass', 'mushroom_s', 'rock', 'sign'] },
    candy:  { back: ['lollipop', 'candycane', 'cupcake', 'gumtree'], front: ['gumdrop', 'sprinkle', 'candy', 'donut'] },
    snow:   { back: ['pine', 'pine_big', 'snowman', 'iceblock'],     front: ['snowtuft', 'crystal', 'rock_snow', 'lantern'] },
    castle: { back: ['banner', 'torch', 'pillar', 'statue'],         front: ['barrel', 'crate', 'skull', 'weed'] },
    // yeni temalar (adlar render-world ile sözleşme: docs/MULTIPLAYER.md "Uygulama Notları")
    desert: { back: ['obelisk', 'temple_pillar', 'cactus_big', 'sphinx'],     front: ['cactus_s', 'urn', 'bones', 'dry_bush'] },
    space:  { back: ['antenna', 'fuel_tank', 'sat_dish', 'reactor'],         front: ['sci_crate', 'cables', 'floor_lamp', 'canister'] },
    city:   { back: ['streetlamp', 'neon_sign', 'water_tower', 'crane'],      front: ['trash_can', 'hydrant', 'traffic_cone', 'ac_unit'] },
    tropic: { back: ['palm', 'palm_big', 'tiki', 'beach_hut'],               front: ['shell', 'starfish', 'beach_grass', 'coconut'] }
  };

  /* ---------------- kozmetik (görsel, güç vermez) ---------------- */
  // price: fiyat; cur: para birimi ('coins' varsayılan | 'gems'). Satın alma/gösterim FM.meta.currency()/cosmetics() ile.
  FM.COSMETICS = {
    skins: [ // her karakter için aynı id seti; render-chars renk dönüşümünü uygular
      { id: 'klasik', n: 'Klasik', price: 0 },
      { id: 'altin',  n: 'Altın',  price: 25, cur: 'gems' },   // elmasla alınır (cur yoksa 'coins')
      { id: 'gece',   n: 'Gece',   price: 800 },
      { id: 'neon',   n: 'Neon',   price: 1200 },
      { id: 'buz',    n: 'Buz',    price: 1000 }
    ],
    trails: [
      { id: 'none',     n: 'Yok',          price: 0,    colors: [] },
      { id: 'dust',     n: 'Toz',          price: 0,    colors: ['#ffffff', '#e8dcc8'] },
      { id: 'fire',     n: 'Ateş',         price: 600,  colors: ['#ff4d1a', '#ffb020', '#ffe14d'] },
      { id: 'rainbow',  n: 'Gökkuşağı',    price: 900,  colors: ['#ff3b3b', '#ffb020', '#ffe14d', '#3ddc84', '#3b82f6', '#a855f7'] },
      { id: 'stars',    n: 'Yıldızlar',    price: 700,  colors: ['#fff6b0', '#ffd23f'] },
      { id: 'spades',   n: 'Maça (Klan)',  price: 20, cur: 'gems', colors: ['#111111', '#c0182e', '#ffffff'] },
      { id: 'hearts',   n: 'Kalpler',      price: 500,  colors: ['#ff5a7a', '#ff9eb5'] }
    ],
    plates: [
      { id: 'basic', n: 'Sade',     price: 0 },
      { id: 'gold',  n: 'Altın',    price: 800 },
      { id: 'clan',  n: 'Klan ♠',   price: 500 },
      { id: 'neon',  n: 'Neon',     price: 700 },
      { id: 'fire',  n: 'Alev',     price: 900 }
    ]
  };

  /* ---------------- yardımcılar ---------------- */
  FM.mulberry32 = function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  FM.hash = function (n) { n = (n | 0) * 374761393 + 668265263; n = (n ^ (n >>> 13)) * 1274126177; n = n ^ (n >>> 16); return (n >>> 0) / 4294967296; };
  FM.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  FM.lerp = (a, b, t) => a + (b - a) * t;
  FM.ov = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  FM.esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FM.cx = r => r.x + r.w / 2;
  FM.cy = r => r.y + r.h / 2;

  /* ---------------- olay sistemi ---------------- */
  const handlers = {};
  FM.on = function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); };
  FM.off = function (evt, fn) { const h = handlers[evt]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } };
  FM.emit = function (evt, data) {
    const h = handlers[evt]; if (!h) return;
    for (const fn of h.slice()) { try { fn(data || {}); } catch (e) { console.error('[FM event ' + evt + ']', e); } }
  };

  /* ---------------- oyun durumu (tek nesne) ---------------- */
  FM.S = {
    mode: 'boot',          // boot | demo | count | race | end | podium | menu
    L: null, racers: [], player: null, ents: [], parts: [], rings: [], toasts: [], feed: [],
    T: 0, raceT: 0, countT: 0, endTimer: null, finishedN: 0,
    round: 1, ROUNDS: 3, themeOff: 0,
    cam: { x: 0, y: 0, zoom: 1 }, shake: 0, flash: { a: 0, col: '#fff' },
    paused: false, lastResult: null
  };
  FM.view = { S: 1, VW: 1000, VH: C.VH, dpr: 1, W: 1000, H: 540 };

  /* ---------------- efekt verisi üreticileri (çizim render-fx.js'te) ---------------- */
  // Parçacık: {k, x, y, vx, vy, life, max, c, s, g, rot, vr, drag, add}
  // k: 'dot' | 'puff' | 'spark' | 'conf' | 'glow' | 'star' | 'note' | 'heart' | 'spade' | 'ice' | 'leaf'
  FM.fx = {
    p(o) { const S = FM.S; if (S.parts.length > 900) S.parts.splice(0, S.parts.length - 900); o.max = o.max || o.life; S.parts.push(o); return o; },
    burst(x, y, cols, n, sp = 220, grav = 500, k = 'dot', size = 4) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, v = Math.random() * sp;
        this.p({ k, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: .45 + Math.random() * .45, c: cols[i % cols.length], s: size * (.6 + Math.random() * .8), g: grav, rot: Math.random() * 6, vr: (Math.random() - .5) * 12 });
      }
    },
    puff(x, y, n = 6, col = 'rgba(255,255,255,0.8)', size = 10, sp = 60) {
      for (let i = 0; i < n; i++) this.p({ k: 'puff', x: x + (Math.random() - .5) * 10, y: y + (Math.random() - .5) * 6, vx: (Math.random() - .5) * sp * 2, vy: -Math.random() * sp * .6, life: .35 + Math.random() * .3, c: col, s: size * (.6 + Math.random() * .7), g: -20, drag: 3 });
    },
    sparks(x, y, n = 10, col = '#ffd23f', sp = 400) {
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (.4 + Math.random() * .6); this.p({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .2 + Math.random() * .25, c: col, s: 2, g: 600, add: true }); }
    },
    confetti(x, y, n = 40, sp = 420) {
      const cols = ['#ff3b3b', '#ffd23f', '#3ddc84', '#3b82f6', '#a855f7', '#ff8fc8', '#ffffff'];
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * 1.6, v = sp * (.5 + Math.random() * .7); this.p({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.6 + Math.random(), c: cols[i % cols.length], s: 5 + Math.random() * 4, g: 380, rot: Math.random() * 6, vr: (Math.random() - .5) * 16, drag: 1.2 }); }
    },
    glow(x, y, r, col, life = .3) { this.p({ k: 'glow', x, y, vx: 0, vy: 0, life, c: col, s: r, g: 0, add: true }); },
    ring(x, y, r, col, life = .45, width = 6) { FM.S.rings.push({ x, y, r, col, life, max: life, w: width }); },
    text(x, y, str, col = '#fff', size = 18) { this.p({ k: 'text', x, y, vx: 0, vy: -60, life: 1, c: col, s: size, g: 0, str }); },
    shake(v) { FM.S.shake = Math.max(FM.S.shake, v); },
    flash(col, a = .5) { FM.S.flash.col = col; FM.S.flash.a = Math.max(FM.S.flash.a, a); },
    toast(m, col) { FM.S.toasts.push({ m, t: 2.6, max: 2.6, col: col || '#fff' }); },
    feed(a, icon, b) { const f = FM.S.feed; f.unshift({ a, icon, b, t: 4 }); if (f.length > 4) f.length = 4; }
  };

  /* ---------------- kayıt sistemi ---------------- */
  const SAVE_KEY = 'fuatmorel_save_v2';
  FM.defaultSave = function () {
    // Kupa sıfırlama (5. tur): herkes 0 kupayla başlar (FM.CH[k].tr artık yalnızca bilgi alanı, başlangıç değeri DEĞİL)
    const trophies = {}; for (const k of FM.ORDER) trophies[k] = 0;
    const now = Date.now();
    return {
      v: 2, coins: 500, gems: 10, xp: 0, level: 1,
      trReset: 1,               // kupa sıfırlama göçü yapıldı işareti (normSave: !== 1 ise bir kerelik sıfırlanır)
      created: now, since: now, // kaydın oluşturulma ve ilk oynama anı (ms); profil kartındaki "since"
      h2h: {},                  // kafa kafaya: { pid: { nick, w, l, t } } (meta.js yönetir, en çok ~50 kişi)
      selChar: 'TAFTAF', rounds: 3,
      mode: 'classic',          // tek oyunculu son seçilen mod (FM.MODES id)
      map: 'random',            // tek oyunculu son seçilen harita: 'random' | FM.THEMES id
      rivals: 3,                // tek oyunculu rakip (bot) sayısı 1..9
      trophies,
      upgrades: {},             // meta.js doldurur: { key: level } veya { 'key:charId': level }
      owned: { skins: { }, trails: ['none', 'dust'], plates: ['basic'] }, // skins: { charId: ['klasik', ...] }
      equipped: { skin: {}, trail: 'dust', plate: 'basic' },              // skin: { charId: 'klasik' }
      missions: null,           // meta.js yönetir
      stats: {},                // meta.js yönetir (toplam sayaçlar)
      settings: { music: 0.6, sfx: 0.8, shake: true, quality: 'high' },
      seen: {}
    };
  };
  /* Kayıt doğrulama/göç: dışarıdan gelen (localStorage ya da içe aktarılan) nesneyi geçerli kayda çevirir.
     Eksik alanlar varsayılanla eklenir, bozuk tipler düzeltilir. Nesne kullanılamazsa null. */
  FM.normSave = function (s) {
    const d = FM.defaultSave();
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const num = (v, def) => (typeof v === 'number' && isFinite(v)) ? v : def;
    // Göç bayrakları, varsayılan doldurma ÖNCE okunur (yoksa defaultSave'in trReset:1 / since:şimdi değeri eski kaydı "göçmüş" gösterirdi)
    const needTrReset = s.trReset !== 1;
    const hadSince = typeof s.since === 'number' && isFinite(s.since) && s.since > 0;
    // eksik alanları varsayılanla doldur (derin olmayan birleştirme + bilinen iç nesneler)
    for (const k in d) if (s[k] === undefined) s[k] = d[k];
    s.coins = Math.max(0, num(s.coins, d.coins)); s.gems = Math.max(0, num(s.gems, d.gems));
    s.xp = Math.max(0, num(s.xp, d.xp)); s.level = Math.max(1, Math.floor(num(s.level, d.level)));
    s.rounds = num(s.rounds, d.rounds);
    /* Kupa: 0..1e6 tam sayı. Eksik/bozuk değer 0 olur. BİR KEREYE MAHSUS göç: trReset !== 1 ise (eski kayıt, eski yedek,
       içe aktarılan eski kayıt kodu) tüm karakter kupaları 0'lanır ve trReset = 1 yazılır; sonraki normSave kazanılan kupaya DOKUNMAZ. */
    if (!obj(s.trophies)) s.trophies = {};
    for (const k of FM.ORDER) {
      const v = s.trophies[k];
      s.trophies[k] = (!needTrReset && typeof v === 'number' && isFinite(v) && v > 0) ? Math.min(1e6, Math.round(v)) : 0;
    }
    for (const k of Object.keys(s.trophies)) if (FM.ORDER.indexOf(k) < 0) delete s.trophies[k];
    s.trReset = 1;
    if (!obj(s.h2h)) s.h2h = {};
    if (!obj(s.upgrades)) s.upgrades = {};
    if (!obj(s.stats)) s.stats = {};
    if (!obj(s.seen)) s.seen = {};
    if (s.missions !== null && !obj(s.missions) && !Array.isArray(s.missions)) s.missions = null;
    s.owned = Object.assign({}, d.owned, obj(s.owned) ? s.owned : {});
    if (!obj(s.owned.skins)) s.owned.skins = {};
    if (!Array.isArray(s.owned.trails)) s.owned.trails = d.owned.trails.slice();
    if (!Array.isArray(s.owned.plates)) s.owned.plates = d.owned.plates.slice();
    s.equipped = Object.assign({}, d.equipped, obj(s.equipped) ? s.equipped : {});
    if (!obj(s.equipped.skin)) s.equipped.skin = {};
    if (typeof s.equipped.trail !== 'string') s.equipped.trail = d.equipped.trail;
    if (typeof s.equipped.plate !== 'string') s.equipped.plate = d.equipped.plate;
    s.settings = Object.assign({}, d.settings, obj(s.settings) ? s.settings : {});
    if (typeof s.selChar !== 'string' || !FM.CH[s.selChar]) s.selChar = 'TAFTAF';
    if (!FM.modeById(s.mode)) s.mode = 'classic';
    if (s.map !== 'random' && FM.themeIndex(s.map) < 0) s.map = 'random';
    s.rivals = Math.max(1, Math.min(FM.MAXR - 1, Math.round(num(s.rivals, d.rivals))));
    if (typeof s.created !== 'number' || !isFinite(s.created)) s.created = Date.now();   // kaydın ilk oluşturulma anı (bilgi)
    // ilk oynama anı: eski kayıtta oluşturulma anı (o da yoksa şimdi) — bir kez yazılır, sonra değişmez
    if (!hadSince) s.since = s.created > 0 ? s.created : Date.now();
    return s;
  };
  // Bozuk kayıt ASLA sessizce silinmez: üzerine varsayılan yazılmadan önce ham metin ayrı anahtara kopyalanır.
  function keepCorrupt(raw) {
    try { if (raw && raw !== 'null') localStorage.setItem(SAVE_KEY + '_bozuk_' + Date.now(), raw); } catch (e) { }
  }
  FM.loadSave = function () {
    let raw = null, s = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    try { s = JSON.parse(raw || 'null'); } catch (e) { s = null; keepCorrupt(raw); }
    if (!s || typeof s !== 'object' || Array.isArray(s)) { if (s !== null) keepCorrupt(raw); return FM.defaultSave(); }
    // Bozuk/eski kayıt oyunu ASLA açılmaz hâle getirmesin: alan tiplerini doğrula, olmazsa varsayılan kayıt (ham kayıt yedeklenir)
    try {
      const n = FM.normSave(s);
      if (n) return n;
      keepCorrupt(raw);
      return FM.defaultSave();
    } catch (e) {
      try { console.warn('[kayıt] bozuk kayıt yok sayıldı (yedeklendi)', e); } catch (e2) { }
      keepCorrupt(raw);
      return FM.defaultSave();
    }
  };
  FM.SAVE_KEY = SAVE_KEY;
  FM.save = FM.loadSave();
  let saveTimer = null;
  FM.persist = function (now) {
    const write = () => { saveTimer = null; try { FM.save.savedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(FM.save)); } catch (e) { } };
    if (now) { if (saveTimer) clearTimeout(saveTimer); write(); }
    else if (!saveTimer) saveTimer = setTimeout(write, 300);
  };
  FM.resetSave = function () { FM.save = FM.defaultSave(); FM.persist(true); FM.emit('save:reset'); };

  /* ---------------- URL parametreleri (geliştirici modu) ---------------- */
  FM.params = (function () { const o = {}; try { new URLSearchParams(location.search).forEach((v, k) => { o[k] = v; }); } catch (e) { } return o; })();
  FM.DEV = FM.params.dev === '1';
  // Dokunmatik cihaz (telefon/tablet). Asıl hedef platform TELEFON (yatay). ?mobile=1 ile masaüstünde zorlanabilir.
  FM.isTouch = FM.params.mobile === '1' || (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);


  /* ---------------- kalıcılık, PWA, uygulama-içi tarayıcı ---------------- */
  // Kayıt otomatik: sayfa gizlenince / kapanırken / dondurulurken bekleyen yazım hemen yapılır.
  try {
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) FM.persist(true); });
      document.addEventListener('freeze', () => FM.persist(true));
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => FM.persist(true));
  } catch (e) { }

  /** Uygulama ana ekrandan (PWA) mı açıldı */
  FM.isStandalone = function () {
    try {
      if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
      if (typeof matchMedia === 'function') {
        for (const m of ['fullscreen', 'standalone', 'minimal-ui']) { const q = matchMedia('(display-mode: ' + m + ')'); if (q && q.matches) return true; }
      }
    } catch (e) { }
    return false;
  };

  /** Uygulama-içi tarayıcı (ayrı depolama! ilerleme orada kalır): 'whatsapp' | 'instagram' | 'facebook' | 'messenger' |
      'tiktok' | 'snapchat' | 'twitter' | 'telegram' | 'linkedin' | 'line' | 'wechat' | 'discord' | 'pinterest' | 'webview' | null.
      ua verilmezse navigator.userAgent. Ana ekrandan açılmış PWA'da her zaman null. Görünen ad: FM.IN_APP_NAMES[k]. */
  FM.inAppBrowser = function (ua) {
    try {
      if (ua == null) { if (FM.isStandalone()) return null; ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''; }
      ua = String(ua);
      const T = [
        ['whatsapp', /WhatsApp/i], ['instagram', /Instagram/i],
        ['messenger', /Orca-Android|MessengerForiOS|MessengerLite|FBAN\/Messenger/i],
        ['facebook', /FBAN|FBAV|FB_IAB|FB4A|FBIOS/], ['tiktok', /musical_ly|BytedanceWebview|TikTok|trill_|ByteLocale/i],
        ['snapchat', /Snapchat/i], ['twitter', /\bTwitter/], ['telegram', /Telegram/i], ['linkedin', /LinkedInApp/i],
        ['line', /\bLine\//], ['wechat', /MicroMessenger/i], ['discord', /Discord/i], ['pinterest', /Pinterest/i]
      ];
      for (const [k, re] of T) if (re.test(ua)) return k;
      if (/Android/.test(ua) && /; wv\)/.test(ua)) return 'webview';                                        // Android WebView
      if (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'webview'; // iOS WKWebView
    } catch (e) { }
    return null;
  };
  FM.IN_APP_NAMES = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', messenger: 'Messenger', tiktok: 'TikTok', snapchat: 'Snapchat',
    twitter: 'X (Twitter)', telegram: 'Telegram', linkedin: 'LinkedIn', line: 'LINE', wechat: 'WeChat', discord: 'Discord', pinterest: 'Pinterest', webview: 'uygulama içi tarayıcı' };

  // Kalıcı depolama izni: tarayıcı veriyi kendiliğinden silmesin. İlk dokunuşta (Firefox izin sorabilir) ve kurulunca istenir.
  FM.storage = { persisted: null };
  FM.askPersist = function () {
    try {
      const st = typeof navigator !== 'undefined' && navigator.storage;
      if (!st || typeof st.persist !== 'function') return Promise.resolve(false);
      const chk = typeof st.persisted === 'function' ? st.persisted() : Promise.resolve(false);
      return chk.then(p => p ? true : st.persist()).then(ok => { FM.storage.persisted = !!ok; return !!ok; }).catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  };

  /* PWA: service worker (yalnızca http/https, geliştirici modunda değil) + "Ana ekrana ekle" istemi.
     FM.pwa.canInstall() → Android Chrome kurulum istemi hazır mı; FM.pwa.install() → Promise<bool>.
     Olaylar: 'pwa:installable', 'pwa:installed'. */
  let installEvt = null;
  FM.pwa = {
    sw: null, err: null,
    canInstall: () => !!installEvt,
    install() {
      const e = installEvt; if (!e || typeof e.prompt !== 'function') return Promise.resolve(false);
      installEvt = null;
      try { e.prompt(); return (e.userChoice || Promise.resolve({})).then(c => !!c && c.outcome === 'accepted').catch(() => false); }
      catch (er) { return Promise.resolve(false); }
    }
  };
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof location !== 'undefined') {
      let asked = false;
      const firstTouch = () => { if (asked) return; asked = true; FM.askPersist(); };
      window.addEventListener('pointerdown', firstTouch, { once: true, passive: true });
      window.addEventListener('keydown', firstTouch, { once: true });
      if (FM.isStandalone()) FM.askPersist();
      window.addEventListener('beforeinstallprompt', e => { installEvt = e; FM.emit('pwa:installable', {}); });   // tarayıcının kendi önerisi engellenmez
      window.addEventListener('appinstalled', () => { installEvt = null; FM.askPersist(); FM.emit('pwa:installed', {}); });
      const okProto = /^https?:$/.test(location.protocol || '');
      if (okProto && !FM.DEV && typeof navigator !== 'undefined' && navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
        const reg = () => navigator.serviceWorker.register('sw.js').then(r => { FM.pwa.sw = r; }).catch(e => { FM.pwa.err = String(e && e.message || e); });
        if (typeof document !== 'undefined' && document.readyState === 'complete') reg(); else window.addEventListener('load', reg, { once: true });
      }
    }
  } catch (e) { }
})(window.FM);

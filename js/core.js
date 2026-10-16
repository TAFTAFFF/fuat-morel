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
  FM.PTS = [10, 6, 3, 1];
  FM.TROPHY = [30, 12, -5, -15];

  /* ---------------- eşyalar ---------------- */
  // col: eşyanın tema rengi (HUD/çizim için)
  FM.ITEMS = {
    saw:     { ic: '🪚', n: 'Testere',       col: '#c7ccd6', d: 'Yerde yuvarlanır, duvardan seker. Değdiği herkesi öldürür — geri sekerse seni de!' },
    dyn:     { ic: '🧨', n: 'Dinamit',       col: '#e23b3b', d: 'İleri fırlatılır, 1 sn sonra patlar. Yakındaysan sen de gidersin.' },
    trap:    { ic: '🪤', n: 'Ayı Tuzağı',    col: '#9aa3b2', d: 'Arkana bırakılır. Basan ölür (sen dahil).' },
    mis:     { ic: '🚀', n: 'Güdümlü Füze',  col: '#ff6b3d', d: 'Lideri (lider sensen ikinciyi) kovalar ve patlar.' },
    bolt:    { ic: '🌩️', n: 'Yıldırım',      col: '#ffe14d', d: 'Önündeki herkesin üstünde bulut belirir, 1.8 sn sonra çakar. Kalkan ve balon korur.' },
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
  FM.THEMES = [
    { id: 'forest', n: 'Çılgın Orman',      liquid: 'water',     sky: ['#3d9cf5', '#8fd0ff', '#e3f6ff'] },
    { id: 'candy',  n: 'Şeker Diyarı',      liquid: 'chocolate', sky: ['#ff8fc8', '#ffc0e3', '#fff1fa'] },
    { id: 'snow',   n: 'Karlı Zirve',       liquid: 'icewater',  sky: ['#5b93dc', '#a9cdf3', '#eef6ff'] },
    { id: 'castle', n: 'Gün Batımı Kalesi', liquid: 'lava',      sky: ['#2b1a4a', '#ff6f61', '#ffc778'] }
  ];
  // Her temada üretilecek dekor tipleri (render-world.js hepsini çizmek ZORUNDA)
  FM.DECOR = {
    forest: { back: ['tree', 'tree2', 'bush', 'rock_big'],          front: ['flower', 'grass', 'mushroom_s', 'rock', 'sign'] },
    candy:  { back: ['lollipop', 'candycane', 'cupcake', 'gumtree'], front: ['gumdrop', 'sprinkle', 'candy', 'donut'] },
    snow:   { back: ['pine', 'pine_big', 'snowman', 'iceblock'],     front: ['snowtuft', 'crystal', 'rock_snow', 'lantern'] },
    castle: { back: ['banner', 'torch', 'pillar', 'statue'],         front: ['barrel', 'crate', 'skull', 'weed'] }
  };

  /* ---------------- kozmetik (görsel, güç vermez) ---------------- */
  FM.COSMETICS = {
    skins: [ // her karakter için aynı id seti; render-chars renk dönüşümünü uygular
      { id: 'klasik', n: 'Klasik', price: 0 },
      { id: 'altin',  n: 'Altın',  price: 1500 },
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
      { id: 'spades',   n: 'Maça (Klan)',  price: 1000, colors: ['#111111', '#c0182e', '#ffffff'] },
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
    const trophies = {}; for (const k of FM.ORDER) trophies[k] = FM.CH[k].tr;
    return {
      v: 2, coins: 300, gems: 10, xp: 0, level: 1,
      selChar: 'TAFTAF', rounds: 3,
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
  FM.loadSave = function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
    const d = FM.defaultSave();
    if (!s || typeof s !== 'object' || Array.isArray(s)) return d;
    // Bozuk/eski kayıt oyunu ASLA açılmaz hâle getirmesin: alan tiplerini doğrula, olmazsa varsayılan kayıt
    try {
      const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
      const num = (v, def) => (typeof v === 'number' && isFinite(v)) ? v : def;
      // eksik alanları varsayılanla doldur (derin olmayan birleştirme + bilinen iç nesneler)
      for (const k in d) if (s[k] === undefined) s[k] = d[k];
      s.coins = Math.max(0, num(s.coins, d.coins)); s.gems = Math.max(0, num(s.gems, d.gems));
      s.xp = Math.max(0, num(s.xp, d.xp)); s.level = Math.max(1, Math.floor(num(s.level, d.level)));
      s.rounds = num(s.rounds, d.rounds);
      if (!obj(s.trophies)) s.trophies = d.trophies;
      for (const k of FM.ORDER) if (typeof s.trophies[k] !== 'number' || !isFinite(s.trophies[k])) s.trophies[k] = FM.CH[k].tr;
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
      return s;
    } catch (e) {
      try { console.warn('[kayıt] bozuk kayıt yok sayıldı', e); } catch (e2) { }
      return d;
    }
  };
  FM.save = FM.loadSave();
  let saveTimer = null;
  FM.persist = function (now) {
    const write = () => { saveTimer = null; try { localStorage.setItem(SAVE_KEY, JSON.stringify(FM.save)); } catch (e) { } };
    if (now) { if (saveTimer) clearTimeout(saveTimer); write(); }
    else if (!saveTimer) saveTimer = setTimeout(write, 300);
  };
  FM.resetSave = function () { FM.save = FM.defaultSave(); FM.persist(true); FM.emit('save:reset'); };

  /* ---------------- URL parametreleri (geliştirici modu) ---------------- */
  FM.params = (function () { const o = {}; try { new URLSearchParams(location.search).forEach((v, k) => { o[k] = v; }); } catch (e) { } return o; })();
  FM.DEV = FM.params.dev === '1';
  // Dokunmatik cihaz (telefon/tablet). Asıl hedef platform TELEFON (yatay). ?mobile=1 ile masaüstünde zorlanabilir.
  FM.isTouch = FM.params.mobile === '1' || (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

})(window.FM);

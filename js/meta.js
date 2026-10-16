/* FUAT MOREL — meta.js
   Oyun ekonomisi ve ilerleme: altın / elmas, XP / seviye, günlük görevler, kademeli başarımlar,
   yetenek geliştirmeleri, kozmetik satın alma / kuşanma, 7 günlük giriş ödülü, yarış ve maç ödülleri.
   HİÇBİR ŞEY ÇİZMEZ. Tüm kalıcı veri FM.save içinde tutulur, değişince FM.persist() ile kaydedilir.

   Kayıt şeması genişletmesi (FM.save içinde):
     coins, gems, xp, level                     (core.js varsayılanları)
     upgrades   { 'ab:<charId>': 1..5, charge: 1..5, start: 1..3 }
     startItem  'speed' | 'shield' | 'balloon'      (kilidi açık olanlardan seçilen başlangıç eşyası; saldırı eşyası YOK)
     owned      { skins: { charId: [id...] }, trails: [id...], plates: [id...] }
     equipped   { skin: { charId: id }, trail: id, plate: id }
     missions   { v, day:'YYYY-MM-DD', list:[{t,slot,goal,prog,c,n,ch,r}], bonus, bonusN, rr, ach:{key:claimedTier}, achN:{key:notifiedTier} }
     stats      { races, wins, ... toplam sayaçlar; charRaces:{}, charWins:{}, killsBy:{}, itemsBy:{}, best:{} }
     daily      { last:'YYYY-MM-DD', streak }

   Eşitlik notu: game.js botlara oyuncunun mods() değerlerini kopyalar; bu yüzden geliştirmeler yarışı adil tutar.
   mods() her zaman abLv ∈ [1,5], chargeMul ∈ [1, 1.24] ve geçerli bir başlangıç eşyası döndürür.
   Çok oyunculu odada herkesin kendi geliştirmesi KULLANILMAZ: mods(charId, {room}) / roomMods() odaya özel sabit,
   herkese aynı değeri döndürür (altın harcayan kazanmasın — "eşit güç" kuralı). */
'use strict';
(function (FM) {
  const meta = FM.meta = {};

  /* =====================================================================
     AYARLAR (denge tablosu)
     ===================================================================== */
  const MAX_BAL = 999999999;          // bakiye üst sınırı (taşma / NaN koruması)
  const MAX_LEVEL = 999;
  const PLACE_COINS = [120, 70, 40, 20];
  const PLACE_XP = [60, 40, 25, 15];
  const COIN_VALUE = 1;               // yarışta toplanan her altın para = 1 altın (yarış başına ~60 para toplanıyor)
  const START_COINS = 500;            // yeni oyuncunun başlangıç altını: ilk oturumda bir kozmetik (500) alınabilsin
  const KILL_COINS = 15;              // her patlatılan rakip
  const KILL_COINS_CAP = 10;          // tek yarışta en fazla 10 öldürme ödüllendirilir
  const FINISH_COINS = 20;            // bitiş bonusu
  const CLEAN_COINS = 25;             // hiç ölmeden bitirme bonusu
  const STREAK_COINS = 15, STREAK_CAP = 75;   // üst üste galibiyet bonusu
  const FINISH_XP = 10, KILL_XP = 5, KILL_XP_CAP = 30, CLEAN_XP = 10;
  const DNF_MUL = 0.5;                // yarışı bitiremeyen oyuncu sıra ödülünün yarısını alır

  const xpNeed = lv => 100 + 60 * (Math.max(1, lv) - 1);
  // elmas seyrek kalsın (ikinci bir altın birimine dönüşmesin): yalnızca her 5 seviyede bir
  const levelReward = lv => ({ coins: 50 + 25 * lv, gems: lv % 5 === 0 ? 3 : 0 });

  // Günlük giriş ödülü (7 günlük seri; gün atlanırsa seri sıfırlanır; 7. günden sonra döngü başa sarar)
  const LOGIN = [
    { coins: 50, gems: 0, icon: '🪙' },
    { coins: 80, gems: 0, icon: '🪙' },
    { coins: 120, gems: 0, icon: '💰' },
    { coins: 160, gems: 0, icon: '💰' },
    { coins: 220, gems: 0, icon: '💰' },
    { coins: 300, gems: 0, icon: '🧰' },
    { coins: 0, gems: 5, icon: '💎' }
  ];

  const DIFF_NAMES = ['Kolay', 'Orta', 'Zor'];
  const DAILY_REWARD = [
    { coins: 80, gems: 0, xp: 25 },
    { coins: 140, gems: 0, xp: 40 },
    { coins: 220, gems: 2, xp: 60 }
  ];
  const BONUS_REWARD = { coins: 150, gems: 3, xp: 50 };     // 3 günlük görevin hepsi → günlük sandık
  const ACH_REWARD = [
    { coins: 100, gems: 0, xp: 30 },
    { coins: 250, gems: 2, xp: 70 },
    { coins: 600, gems: 4, xp: 150 }
  ];
  const REROLL_GEMS = 5;              // günde 1 görev değiştirme ücretsiz, sonrakiler elmasla

  // Elmas → altın bozdurma paketleri (elmasın harcanacağı yer)
  const PACKS = [
    { id: 'kese', n: 'Altın Kesesi', gems: 5, coins: 400, icon: '👛' },
    { id: 'sandik', n: 'Altın Sandığı', gems: 15, coins: 1300, icon: '🧰' },
    { id: 'hazine', n: 'Hazine', gems: 40, coins: 3800, icon: '💰' }
  ];

  /* ---------------- geliştirmeler ---------------- */
  // Sırayla açılır; 'speed' baştan açık. Saldırı eşyası (testere vb.) başlangıç eşyası OLAMAZ: botlar da aynı
  // eşyayla başladığı için start çizgisinde iç içe dizilmiş yarışçılara katliam olur.
  const START_ITEMS = ['speed', 'shield', 'balloon'];
  const START_LEGACY_COSTS = [600, 1000, 1800];   // eski 4 kademeli tablo (4. kademe 'saw' idi) → iade hesabı
  // Tempo: ana karakterin gücü ~1 saatte Seviye 4-5, tüm katalog ~10 saat (geliştirmeler botlara da yansır, yalnızca "his")
  const UPG = {
    ab: {
      key: 'ab', n: 'Özel Güç Seviyesi', icon: '⚡', scope: 'char', max: 5,
      costs: [600, 1500, 3000, 5500]
    },
    charge: {
      key: 'charge', n: 'Güç Dolumu', icon: '🔋', scope: 'global', max: 5,
      costs: [800, 1600, 3200, 5500]
    },
    start: {
      key: 'start', n: 'Başlangıç Eşyası', icon: '🎒', scope: 'global', max: START_ITEMS.length,
      costs: [500, 1000]
    }
  };
  // Çok oyunculu oda: herkese aynı uygulanan sabit geliştirme değerleri (ev sahibi değiştirebilir; fairMods ile doğrulanır)
  const ROOM_MODS = { abLv: 3, chargeMul: 1.12, startItem: 'speed' };
  const UPG_ORDER = ['ab', 'charge', 'start'];

  /* ---------------- günlük görev havuzu ----------------
     d: zorluk (0 kolay, 1 orta, 2 zor) — her gün her zorluktan bir görev seçilir.
     cat: aynı gün aynı kategoriden iki görev gelmez.  ev: hangi sayaç ilerletir.
     {g} = hedef sayı, {c} = karaktere özel görevlerde karakter adı. t1: hedef 1 iken kullanılan doğal başlık.
     Hedef: bot düzeyindeki oyuncu ortalaması kolay 1-2, orta 2-3, zor 3-5 yarış (dev ölçümü: yarış başına ~60 para,
     ~6 kutu/eşya, ~2,2 güç, ~1,1 öldürme, ~0,7 engelleme, ~0,6 dinamit; ilk 2 %50, birincilik %25, kusursuz ~%20).
     id'ler kayıt uyumu için SABİT (eski kayıttaki görev kendi hedefini korur); sayı yalnızca goal alanındadır. */
  const DAILY = [
    // KOLAY
    { id: 'coin40', d: 0, cat: 'coin', ev: 'coin', goal: 60, icon: '🪙', t: '{g} altın para topla', ds: 'Yarışlarda yol boyunca dizili altın paraları topla.' },
    { id: 'slide6', d: 0, cat: 'move', ev: 'slide', goal: 6, icon: '💨', t: '{g} kez kay', ds: 'Koşarken aşağı tuşuyla kay, alçak engellerin altından geç.' },
    { id: 'climb5', d: 0, cat: 'move', ev: 'climb', goal: 4, icon: '🧗', t: '{g} duvara tırman', ds: 'Duvara koş ve zıplamayı basılı tutarak tırman.' },
    { id: 'dbl12', d: 0, cat: 'move', ev: 'dbl', goal: 6, icon: '🦘', t: '{g} kez çift zıpla', ds: 'Havadayken bir kez daha zıpla.' },
    { id: 'pad4', d: 0, cat: 'move', ev: 'pad', goal: 4, icon: '⏩', t: '{g} hız pedine bas', ds: 'Yerdeki parlayan hız pedlerinin üstünden koş.' },
    { id: 'box8', d: 0, cat: 'box', ev: 'box', goal: 8, icon: '📦', t: '{g} sürpriz kutu aç', ds: 'Yoldaki eşya kutularına çarp.' },
    { id: 'mush5', d: 0, cat: 'move', ev: 'mush', goal: 5, icon: '🍄', t: '{g} kez mantarla zıpla', ds: 'Zıplatan mantarlara basıp havalan.' },
    { id: 'race3', d: 0, cat: 'race', ev: 'finish', goal: 2, icon: '🏁', t: '{g} yarış bitir', t1: 'Bir yarış bitir', ds: 'Hangi sırada olursa olsun bitiş çizgisini geç.' },
    { id: 'slam6', d: 0, cat: 'move', ev: 'slam', goal: 5, icon: '⬇️', t: '{g} kez yere çakıl', ds: 'Havadayken aşağı tuşuna basıp yere çakıl.' },
    { id: 'jump50', d: 0, cat: 'move', ev: 'jump', goal: 30, icon: '⬆️', t: '{g} kez zıpla', ds: 'Yarışlarda zıpla, zıpla, zıpla!' },
    // ORTA
    { id: 'item8', d: 1, cat: 'box', ev: 'item', goal: 12, icon: '🎁', t: '{g} eşya kullan', ds: 'Kutulardan çıkan eşyaları kullan.' },
    { id: 'abil3', d: 1, cat: 'abil', ev: 'ability', goal: 4, icon: '⚡', t: '{g} kez özel güç kullan', ds: 'Güç barın dolunca karakterinin özel gücünü patlat.' },
    { id: 'kill3', d: 1, cat: 'kill', ev: 'kill', goal: 3, icon: '💥', t: '{g} rakibi patlat', t1: 'Bir rakibi patlat', ds: 'Eşyalarınla rakiplerini yok et.' },
    { id: 'top2x3', d: 1, cat: 'race', ev: 'top2', goal: 1, icon: '🥈', t: "{g} yarışta ilk 2'ye gir", t1: "Bir yarışta ilk 2'ye gir", ds: 'Yarışı birinci ya da ikinci bitir.' },
    { id: 'char1', d: 1, cat: 'race', ev: 'fchar', goal: 1, icon: '🎭', t: '{c} ile bir yarış bitir', ds: 'Karakter seçiminde {c} karakterini seç ve bir yarışı bitir.' },
    { id: 'coin80', d: 1, cat: 'coin', ev: 'coin', goal: 120, icon: '💰', t: '{g} altın para topla', ds: 'Yol boyunca dizili altın paraları kaçırma.' },
    // ZOR
    { id: 'shield2', d: 2, cat: 'def', ev: 'bshield', goal: 1, icon: '🛡️', t: 'Kalkanla {g} saldırı engelle', t1: 'Kalkanla bir saldırı engelle', ds: 'Kalkan açıkken gelen saldırıları boşa çıkar.' },
    { id: 'clean1', d: 2, cat: 'race', ev: 'clean', goal: 1, icon: '😇', t: 'Hiç ölmeden {g} yarış bitir', t1: 'Hiç ölmeden bir yarış bitir', ds: 'Tek bir kez bile ölmeden bitiş çizgisine ulaş.' },
    { id: 'win2', d: 2, cat: 'race', ev: 'win', goal: 1, icon: '🏆', t: '{g} yarış kazan', t1: 'Bir yarış kazan', ds: 'Yarışı birinci bitir.' },
    { id: 'dyn2', d: 2, cat: 'box', ev: 'u_dyn', goal: 2, icon: '🧨', t: '{g} dinamit fırlat', t1: 'Bir dinamit fırlat', ds: 'Kutudan dinamit çıkınca rakiplerinin dibine fırlat.' },
    { id: 'saw1', d: 2, cat: 'kill', ev: 'k_saw', goal: 1, icon: '🪚', t: 'Testereyle {g} rakip biç', t1: 'Testereyle bir rakip biç', ds: 'Testereyi yerde yuvarla — duvardan sekip geri gelebilir, dikkat!' },
    { id: 'mis1', d: 2, cat: 'kill', ev: 'k_mis', goal: 1, icon: '🚀', t: 'Füzeyle {g} rakip vur', t1: 'Füzeyle bir rakibi vur', ds: 'Güdümlü füzeyle önündekini avla.' },
    { id: 'kill6', d: 2, cat: 'kill', ev: 'kill', goal: 5, icon: '☠️', t: '{g} rakibi patlat', ds: 'Bugün kimse güvende değil.' },
    { id: 'champ1', d: 2, cat: 'race', ev: 'mtop2', goal: 1, icon: '🏅', t: "{g} maçı ilk 2'de bitir", t1: "Bir maçı ilk 2'de bitir", ds: 'Maç sonunda puan tablosunda birinci ya da ikinci ol.' },
    { id: 'block2', d: 2, cat: 'def', ev: 'block', goal: 3, icon: '🎈', t: '{g} saldırıyı savuştur', ds: 'Kalkan ya da balonla gelen saldırıları engelle.' },
    { id: 'abil6', d: 2, cat: 'abil', ev: 'ability', goal: 8, icon: '🌟', t: '{g} kez özel güç kullan', ds: 'Güç barını doldur, gücünü boşa harcama.' }
  ];
  const DAILY_BY_ID = {}; for (const t of DAILY) DAILY_BY_ID[t.id] = t;

  /* ---------------- kalıcı, kademeli başarımlar ----------------
     stat: FM.save.stats anahtarı ya da (s) => sayı.  tiers: kademe hedefleri. */
  const ACH = [
    { key: 'races', icon: '🏃', t: 'Koşucu', stat: 'races', tiers: [10, 50, 200], ds: g => `${fmt(g)} yarış tamamla` },
    { key: 'wins', icon: '🏆', t: 'Zafer Avcısı', stat: 'wins', tiers: [1, 10, 50], ds: g => g === 1 ? 'İlk yarışını kazan' : `${fmt(g)} yarış kazan` },
    { key: 'coinsGot', icon: '🪙', t: 'Altın Avcısı', stat: 'coinsGot', tiers: [100, 1000, 5000], ds: g => `Yarışlarda ${fmt(g)} altın para topla` },
    { key: 'kills', icon: '💥', t: 'Yok Edici', stat: 'kills', tiers: [10, 100, 500], ds: g => `${fmt(g)} rakip patlat` },
    { key: 'allChars', icon: '♠️', t: 'Klanın Her Üyesi', stat: s => countKeys(s.stats.charRaces), tiers: [3, 7], ds: g => g >= FM.ORDER.length ? 'Klandaki 7 karakterin hepsiyle yarış' : `${g} farklı karakterle yarış` },
    { key: 'skins', icon: '👕', t: 'Gardırop', stat: s => ownedSkinCount(s), tiers: [1, 7, 28], ds: g => g >= totalSkins() ? `Bütün kostümleri topla (${totalSkins()})` : `${g} kostüm satın al` },
    { key: 'style', icon: '✨', t: 'Tarz Sahibi', stat: s => ownedStyleCount(s), tiers: [2, 5, 9], ds: g => g >= totalStyle() ? 'Bütün iz ve isim plakalarını topla' : `${g} iz ya da isim plakası satın al` },
    { key: 'matches', icon: '🎮', t: 'Maç Adamı', stat: 'matches', tiers: [5, 25, 100], ds: g => `${fmt(g)} maç tamamla` },
    { key: 'champs', icon: '👑', t: 'Kupa Kralı', stat: 'champs', tiers: [1, 10, 30], ds: g => g === 1 ? 'İlk maçını şampiyon bitir' : `${fmt(g)} maçta şampiyon ol` },
    { key: 'items', icon: '🎁', t: 'Eşya Ustası', stat: 'items', tiers: [50, 250, 1000], ds: g => `${fmt(g)} eşya kullan` },
    { key: 'abilities', icon: '⚡', t: 'Güç Bende', stat: 'abilities', tiers: [20, 100, 400], ds: g => `${fmt(g)} kez özel güç kullan` },
    { key: 'jumps', icon: '🦘', t: 'Yaylı Ayak', stat: 'jumps', tiers: [500, 2500, 10000], ds: g => `${fmt(g)} kez zıpla` },
    { key: 'climbs', icon: '🧗', t: 'Örümcek', stat: 'climbs', tiers: [50, 250, 1000], ds: g => `${fmt(g)} duvara tırman` },
    { key: 'slides', icon: '💨', t: 'Kaygan', stat: 'slides', tiers: [100, 500, 2000], ds: g => `${fmt(g)} kez kay` },
    { key: 'clean', icon: '😇', t: 'Kusursuz', stat: 'clean', tiers: [1, 10, 50], ds: g => g === 1 ? 'Hiç ölmeden bir yarış bitir' : `Hiç ölmeden ${fmt(g)} yarış bitir` },
    { key: 'level', icon: '⭐', t: 'Tecrübeli', stat: s => s.level, tiers: [5, 10, 25], ds: g => `${g}. seviyeye ulaş` },
    { key: 'dyn', icon: '🧨', t: 'Bomba Uzmanı', stat: s => num0(s.stats.killsBy.dyn), tiers: [5, 25, 100], ds: g => `Dinamitle ${fmt(g)} rakip patlat` },
    { key: 'blocks', icon: '🛡️', t: 'Duvar Gibi', stat: 'blocks', tiers: [10, 50, 200], ds: g => `Kalkan ya da balonla ${fmt(g)} saldırı engelle` },
    { key: 'upgrades', icon: '📈', t: 'Gelişim', stat: 'upBought', tiers: [1, 5, 15], ds: g => g === 1 ? 'İlk geliştirmeni satın al' : `${g} geliştirme satın al` },
    { key: 'pads', icon: '⏩', t: 'Hız Tutkunu', stat: 'pads', tiers: [50, 250, 1000], ds: g => `${fmt(g)} hız pedine bas` },
    { key: 'streak', icon: '🔥', t: 'Durdurulamaz', stat: 'bestStreak', tiers: [2, 3, 5], ds: g => `Üst üste ${g} yarış kazan` },
    { key: 'logins', icon: '📅', t: 'Sadık Üye', stat: 'dailyClaims', tiers: [3, 7, 30], ds: g => `${g} kez günlük ödül al` },
    { key: 'dailyDone', icon: '📋', t: 'Görev Adamı', stat: 'dailyDone', tiers: [5, 25, 100], ds: g => `${fmt(g)} günlük görev tamamla` },
    { key: 'earned', icon: '💰', t: 'Zengin', stat: 'earned', tiers: [2000, 10000, 50000], ds: g => `Toplam ${fmt(g)} altın kazan` }
  ];
  const ACH_BY_KEY = {}; for (const a of ACH) ACH_BY_KEY[a.key] = a;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  /* ---------------- istatistik alanları ---------------- */
  const STAT_KEYS = ['races', 'finishes', 'wins', 'top2', 'clean', 'matches', 'champs', 'coinsGot', 'kills', 'deaths', 'selfKills',
    'items', 'abilities', 'abHits', 'hitsDealt', 'hitsTaken', 'jumps', 'dbl', 'slides', 'slams', 'climbs', 'vaults', 'flaps', 'pads', 'mush', 'boxes',
    'blocks', 'blocksShield', 'blocksBalloon', 'earned', 'spent', 'gemsEarned', 'gemsSpent', 'dailyClaims', 'dailyDone', 'achDone',
    'upBought', 'skinsBought', 'styleBought', 'winStreak', 'bestStreak', 'time', 'xpTotal', 'rerolls', 'exchanges'];
  const STAT_MAPS = ['charRaces', 'charWins', 'killsBy', 'itemsBy', 'best'];

  /* =====================================================================
     YARDIMCILAR
     ===================================================================== */
  const isNum = v => typeof v === 'number' && isFinite(v);
  const num0 = v => (isNum(v) && v > 0) ? v : 0;
  const clampInt = (v, lo, hi, def) => { if (!isNum(v)) v = def; v = Math.floor(v); return v < lo ? lo : v > hi ? hi : v; };
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  function countKeys(o) { let n = 0; if (isObj(o)) for (const k in o) if (num0(o[k]) > 0) n++; return n; }
  /** Türkçe binlik ayırıcılı sayı: 12500 → "12.500" */
  function fmt(n) {
    n = Math.round(num0(Math.abs(n))) * (n < 0 ? -1 : 1);
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '-' : '') + s;
  }
  meta.fmt = fmt;
  function charOk(id) { return !!(id && FM.CH && has(FM.CH, id)); }
  function charOr(id) { return charOk(id) ? id : (FM.save && charOk(FM.save.selChar) ? FM.save.selChar : FM.ORDER[0]); }
  function charName(id) { return id; }   // karakter adları zaten görünen ad (TAFTAF, Caner, ...)
  function itemName(k) { return (FM.ITEMS && FM.ITEMS[k] && FM.ITEMS[k].n) || k; }
  function S() { return FM.save; }

  /* ---------------- tarih (yerel saat) ---------------- */
  function nowDate() { return new Date(); }
  function keyOf(d) {
    const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function todayKey() { return keyOf(nowDate()); }
  function keyMs(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof k === 'string' ? k : '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  /** b - a (gün). Geçersiz anahtarda NaN. */
  function dayDiff(a, b) { const x = keyMs(a), y = keyMs(b); return (isNaN(x) || isNaN(y)) ? NaN : Math.round((y - x) / 86400000); }
  function msToMidnight() {
    const d = nowDate();
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    return Math.max(0, n.getTime() - d.getTime());
  }

  /* ---------------- kozmetik yardımcıları ---------------- */
  function normType(t) {
    if (t === 'skin' || t === 'skins') return 'skins';
    if (t === 'trail' || t === 'trails') return 'trails';
    if (t === 'plate' || t === 'plates') return 'plates';
    return null;
  }
  function cosList(type) { const t = normType(type); return t && FM.COSMETICS && Array.isArray(FM.COSMETICS[t]) ? FM.COSMETICS[t] : []; }
  function cosItem(type, id) { const l = cosList(type); for (const x of l) if (x.id === id) return x; return null; }
  function freeIds(type) { return cosList(type).filter(x => !(num0(x.price) > 0)).map(x => x.id); }
  function totalSkins() { return FM.ORDER.length * cosList('skins').filter(x => num0(x.price) > 0).length; }
  function totalStyle() { return cosList('trails').filter(x => num0(x.price) > 0).length + cosList('plates').filter(x => num0(x.price) > 0).length; }
  function ownedSkinCount(s) {
    let n = 0; const o = s.owned && s.owned.skins;
    if (!isObj(o)) return 0;
    for (const c of FM.ORDER) { const a = o[c]; if (Array.isArray(a)) for (const id of a) { const it = cosItem('skins', id); if (it && num0(it.price) > 0) n++; } }
    return n;
  }
  function ownedStyleCount(s) {
    let n = 0;
    for (const t of ['trails', 'plates']) { const a = s.owned && s.owned[t]; if (Array.isArray(a)) for (const id of a) { const it = cosItem(t, id); if (it && num0(it.price) > 0) n++; } }
    return n;
  }

  /* =====================================================================
     KAYIT NORMALLEŞTİRME (eski / bozuk kayıtlarla uyum)
     ===================================================================== */
  function freshMissions() { return { v: 1, day: '', list: [], bonus: 0, bonusN: 0, rr: 0, ach: {}, achN: {} }; }
  function normalize() {
    if (!isObj(FM.save)) FM.save = FM.defaultSave();
    const s = FM.save, d = FM.defaultSave();
    // bakiyeler
    s.coins = clampInt(s.coins, 0, MAX_BAL, d.coins);
    s.gems = clampInt(s.gems, 0, MAX_BAL, d.gems);
    s.level = clampInt(s.level, 1, MAX_LEVEL, 1);
    s.xp = clampInt(s.xp, 0, 1e9, 0);
    let guard = 0;
    while (s.xp >= xpNeed(s.level) && s.level < MAX_LEVEL && guard++ < 1000) { s.xp -= xpNeed(s.level); s.level++; }
    if (s.level >= MAX_LEVEL) s.xp = Math.min(s.xp, xpNeed(MAX_LEVEL) - 1);
    // yepyeni kayıt (meta henüz hiç görmemiş, hiç oynanmamış): ilk oturumda bir şey satın alınabilsin
    if (s.metaV == null && s.level === 1 && s.xp === 0 && s.coins === d.coins && !(isObj(s.stats) && num0(s.stats.races) > 0)) {
      s.coins = Math.max(s.coins, Math.min(MAX_BAL, START_COINS));
    }
    // geliştirmeler
    if (!isObj(s.upgrades)) s.upgrades = {};
    // eski kayıt: 4. kademe ('Testere' başlangıç eşyası) kaldırıldı → o kademeye ödenen altın iade edilir (bir kez; sonra kırpılır)
    if (isNum(s.upgrades.start) && s.upgrades.start > UPG.start.max) {
      let refund = 0;
      const top = Math.min(Math.floor(s.upgrades.start), START_LEGACY_COSTS.length + 1);
      for (let lv = UPG.start.max; lv < top; lv++) refund += num0(START_LEGACY_COSTS[lv - 1]);
      if (refund > 0) s.coins = Math.min(MAX_BAL, s.coins + refund);
    }
    for (const k of Object.keys(s.upgrades)) {
      const v = s.upgrades[k];
      if (k === 'charge') s.upgrades[k] = clampInt(v, 1, UPG.charge.max, 1);
      else if (k === 'start') s.upgrades[k] = clampInt(v, 1, UPG.start.max, 1);
      else if (k.indexOf('ab:') === 0 && charOk(k.slice(3))) s.upgrades[k] = clampInt(v, 1, UPG.ab.max, 1);
      else delete s.upgrades[k];
    }
    const sl = clampInt(s.upgrades.start, 1, UPG.start.max, 1);
    if (START_ITEMS.indexOf(s.startItem) < 0 || START_ITEMS.indexOf(s.startItem) >= sl) s.startItem = 'speed';
    // sahiplik
    if (!isObj(s.owned)) s.owned = { skins: {}, trails: [], plates: [] };
    if (!isObj(s.owned.skins)) s.owned.skins = {};
    for (const k of Object.keys(s.owned.skins)) if (!charOk(k)) delete s.owned.skins[k];
    for (const c of FM.ORDER) {
      const a = Array.isArray(s.owned.skins[c]) ? s.owned.skins[c] : [];
      const out = [];
      for (const id of freeIds('skins').concat(a)) if (cosItem('skins', id) && out.indexOf(id) < 0) out.push(id);
      s.owned.skins[c] = out;
    }
    for (const t of ['trails', 'plates']) {
      const a = Array.isArray(s.owned[t]) ? s.owned[t] : [];
      const out = [];
      for (const id of freeIds(t).concat(a)) if (cosItem(t, id) && out.indexOf(id) < 0) out.push(id);
      s.owned[t] = out;
    }
    // kuşanılanlar
    if (!isObj(s.equipped)) s.equipped = {};
    if (!isObj(s.equipped.skin)) s.equipped.skin = {};
    for (const k of Object.keys(s.equipped.skin)) {
      if (!charOk(k) || s.owned.skins[k].indexOf(s.equipped.skin[k]) < 0) delete s.equipped.skin[k];
    }
    if (s.owned.trails.indexOf(s.equipped.trail) < 0) s.equipped.trail = s.owned.trails.indexOf('dust') >= 0 ? 'dust' : (s.owned.trails[0] || 'none');
    if (s.owned.plates.indexOf(s.equipped.plate) < 0) s.equipped.plate = s.owned.plates.indexOf('basic') >= 0 ? 'basic' : (s.owned.plates[0] || 'basic');
    // istatistikler
    if (!isObj(s.stats)) s.stats = {};
    for (const k of STAT_KEYS) s.stats[k] = clampInt(s.stats[k], 0, 1e12, 0);
    for (const k of STAT_MAPS) {
      if (!isObj(s.stats[k])) s.stats[k] = {};
      const m = s.stats[k];
      for (const kk of Object.keys(m)) { if (!isNum(m[kk]) || m[kk] < 0) delete m[kk]; }
    }
    // görevler
    if (!isObj(s.missions) || s.missions.v !== 1) s.missions = freshMissions();
    const M = s.missions;
    if (typeof M.day !== 'string') M.day = '';
    if (!Array.isArray(M.list)) M.list = [];
    M.list = M.list.filter(e => isObj(e) && has(DAILY_BY_ID, e.t)).slice(0, 3).map((e, i) => {
      const tp = DAILY_BY_ID[e.t];
      return {
        t: e.t, slot: i, goal: clampInt(e.goal, 1, 1e6, tp.goal), prog: clampInt(e.prog, 0, 1e6, 0),
        c: e.c ? 1 : 0, n: e.n ? 1 : 0, ch: charOk(e.ch) ? e.ch : (tp.ev === 'fchar' ? FM.ORDER[0] : ''), r: clampInt(e.r, 0, 999, 0)
      };
    });
    if (M.list.length !== 3) { M.day = ''; M.list = []; }
    M.bonus = M.bonus ? 1 : 0; M.bonusN = M.bonusN ? 1 : 0;
    M.rr = clampInt(M.rr, 0, 999, 0);
    if (!isObj(M.ach)) M.ach = {};
    if (!isObj(M.achN)) M.achN = {};
    for (const a of ACH) {
      M.ach[a.key] = clampInt(M.ach[a.key], 0, a.tiers.length, 0);
      M.achN[a.key] = Math.max(M.ach[a.key], clampInt(M.achN[a.key], 0, a.tiers.length, 0));
    }
    for (const k of Object.keys(M.ach)) if (!ACH_BY_KEY[k]) delete M.ach[k];
    for (const k of Object.keys(M.achN)) if (!ACH_BY_KEY[k]) delete M.achN[k];
    // günlük giriş
    if (!isObj(s.daily)) s.daily = { last: '', streak: 0 };
    if (typeof s.daily.last !== 'string' || isNaN(keyMs(s.daily.last))) s.daily.last = '';
    s.daily.streak = clampInt(s.daily.streak, 0, 1e6, 0);
    s.metaV = 1;
  }

  /* =====================================================================
     KAYDETME / BİLDİRİM
     ===================================================================== */
  let dirty = false;
  function persist(now) { dirty = false; try { if (typeof FM.persist === 'function') FM.persist(!!now); } catch (e) { } }
  function flush() { if (dirty) persist(true); }
  function changed(info) { persist(); FM.emit('meta:change', info || {}); }
  /* Tek bildirim kanalı: arayüz (ui.js) 'meta:mission' / 'meta:levelup' olaylarıyla DOM bildirimi gösterir ve
     sonuç paneli seviye atlamayı ayrıca kutlar. HUD yazısı yalnızca arayüz yüklü DEĞİLSE (yedek) ve yalnızca
     geri sayım / yarışta çıkar; tur bitişinde ('end') asla (aynı bilgi ekranda 2-3 kez görünmesin). */
  function toast(msg, col) {
    try {
      if (FM.ui) return;
      const m = FM.S && FM.S.mode;
      if ((m === 'race' || m === 'count') && FM.fx && typeof FM.fx.toast === 'function') FM.fx.toast(msg, col);
    } catch (e) { }
  }

  /* =====================================================================
     BAKİYE
     ===================================================================== */
  /** Bakiyeye ekler; gerçekten eklenen miktarı döndürür (taşmaya karşı sınırlı). Bildirim yayınlamaz. */
  function credit(cur, n, reason) {
    if (cur !== 'coins' && cur !== 'gems') return 0;
    n = Math.floor(num0(n)); if (!n) return 0;
    const s = S(), before = s[cur];
    s[cur] = Math.min(MAX_BAL, before + n);
    const got = s[cur] - before;
    if (cur === 'coins') s.stats.earned += got; else s.stats.gemsEarned += got;
    return got;
  }
  function debit(cur, n) {
    if (cur !== 'coins' && cur !== 'gems') return false;
    if (!isNum(n) || n < 0) return false;
    n = Math.ceil(n);
    const s = S();
    if (s[cur] < n) return false;
    s[cur] -= n;
    if (cur === 'coins') s.stats.spent += n; else s.stats.gemsSpent += n;
    return true;
  }
  meta.coins = function () { return S().coins | 0; };
  meta.gems = function () { return S().gems | 0; };
  /** add('coins'|'gems', n, reason) → yeni bakiye. Negatif n harcama gibi davranır (yetersizse değişmez). */
  meta.add = function (cur, n, reason) {
    if (cur !== 'coins' && cur !== 'gems') return 0;
    if (!isNum(n) || n === 0) return S()[cur];
    if (n < 0) { meta.spend(cur, -n); return S()[cur]; }
    const got = credit(cur, n, reason);
    if (got) { checkMissions(); changed({ cur, n: got, reason: reason || 'add' }); }
    return S()[cur];
  };
  /** spend(cur, n) → yeterliyse düşer ve true döner, değilse hiçbir şey değişmez ve false döner. */
  meta.spend = function (cur, n) {
    if (!isNum(n) || n < 0) return false;
    if (n === 0) return cur === 'coins' || cur === 'gems';
    if (!debit(cur, n)) return false;
    changed({ cur, n: -Math.ceil(n), reason: 'spend' });
    return true;
  };
  meta.canAfford = function (cur, n) { return (cur === 'coins' || cur === 'gems') && isNum(n) && n >= 0 && S()[cur] >= Math.ceil(n); };

  /* =====================================================================
     XP / SEVİYE
     ===================================================================== */
  /** XP ekler, seviye atlamalarını işler (ödülleri verir). Atlanan seviyeleri [{level, coins, gems}] döndürür. */
  function addXp(n) {
    n = Math.floor(num0(n)); if (!n) return [];
    n = Math.min(n, 1e7);
    const s = S(); const ups = [];
    s.xp += n; s.stats.xpTotal += n;
    let guard = 0;
    while (s.level < MAX_LEVEL && s.xp >= xpNeed(s.level) && guard++ < 1000) {
      s.xp -= xpNeed(s.level); s.level++;
      const rw = levelReward(s.level);
      const c = credit('coins', rw.coins, 'levelup'), g = credit('gems', rw.gems, 'levelup');
      ups.push({ level: s.level, coins: c, gems: g });
    }
    if (s.level >= MAX_LEVEL) s.xp = Math.min(s.xp, xpNeed(MAX_LEVEL) - 1);
    for (const u of ups) {
      toast(`SEVİYE ${u.level}!`, '#ffe14d');
      FM.emit('meta:levelup', { level: u.level, reward: { coins: u.coins, gems: u.gems } });
    }
    return ups;
  }
  meta.levelInfo = function () {
    const s = S(), need = xpNeed(s.level);
    const frac = Math.max(0, Math.min(1, s.xp / need));
    return { level: s.level, xp: s.xp, need, pct: Math.round(frac * 1000) / 10, frac, next: levelReward(s.level + 1) };
  };
  meta.xpNeed = xpNeed;

  /** Ödül nesnesini ({coins, gems, xp}) verir; gerçekte verilenleri ve atlanan seviyeleri döndürür. */
  function grant(rw, reason) {
    rw = rw || {};
    const out = { coins: 0, gems: 0, xp: 0, levelUp: 0, levels: [] };
    out.coins = credit('coins', rw.coins, reason);
    out.gems = credit('gems', rw.gems, reason);
    const xp = Math.floor(num0(rw.xp));
    if (xp) {
      out.xp = xp;
      const ups = addXp(xp);
      if (ups.length) {
        out.levelUp = ups[ups.length - 1].level; out.levels = ups;
        for (const u of ups) { out.coins += u.coins; out.gems += u.gems; }
      }
    }
    return out;
  }

  /* =====================================================================
     GÜNLÜK GÖREVLER
     ===================================================================== */
  function daySeed(day) { return (parseInt(String(day).replace(/\D/g, ''), 10) || 1) >>> 0; }
  function pickTpl(rng, diff, usedCats, usedIds) {
    let pool = DAILY.filter(t => t.d === diff && usedIds.indexOf(t.id) < 0 && usedCats.indexOf(t.cat) < 0);
    if (!pool.length) pool = DAILY.filter(t => t.d === diff && usedIds.indexOf(t.id) < 0);
    if (!pool.length) pool = DAILY.filter(t => t.d === diff);
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }
  function mkEntry(tp, slot, rng, r) {
    return { t: tp.id, slot, goal: tp.goal, prog: 0, c: 0, n: 0, ch: tp.ev === 'fchar' ? FM.ORDER[Math.floor(rng() * FM.ORDER.length) % FM.ORDER.length] : '', r: r || 0 };
  }
  /** O güne ait 3 görevi deterministik olarak üretir (aynı gün herkes aynı görevleri alır — klan kardeşliği). */
  function genDaily(day) {
    const rng = FM.mulberry32((daySeed(day) * 2654435761) ^ 0x5EED1234);
    const usedCats = [], usedIds = [], list = [];
    for (let slot = 0; slot < 3; slot++) {
      const tp = pickTpl(rng, slot, usedCats, usedIds);
      usedCats.push(tp.cat); usedIds.push(tp.id);
      list.push(mkEntry(tp, slot, rng, 0));
    }
    const M = S().missions;
    M.day = day; M.list = list; M.bonus = 0; M.bonusN = 0; M.rr = 0;
    dirty = true;
  }
  let lastDayCheck = -1e15;
  /** Gün değiştiyse günlük görevleri yeniler. true → yenilendi. */
  function ensureDay(force) {
    const t = Date.now();
    if (!force && t - lastDayCheck < 5000 && t >= lastDayCheck) return false;
    lastDayCheck = t;
    const k = todayKey(), M = S().missions;
    if (M.day !== k || !Array.isArray(M.list) || M.list.length !== 3) { genDaily(k); return true; }
    return false;
  }
  function fill(str, e) { return String(str).replace(/\{g\}/g, fmt(e.goal)).replace(/\{c\}/g, charName(e.ch || '')); }
  /** Görev başlığı: hedef 1 ise doğal tekil başlık ("Bir yarış kazan"), değilse sayılı ("2 yarış kazan") */
  function tplTitle(tp, e) { return fill(e.goal === 1 && tp.t1 ? tp.t1 : tp.t, e); }
  function dailyObj(e, day) {
    const tp = DAILY_BY_ID[e.t];
    const goal = Math.max(1, e.goal), prog = Math.min(goal, e.prog);
    const rw = DAILY_REWARD[tp.d] || DAILY_REWARD[0];
    return {
      id: 'd:' + day + ':' + e.slot, kind: 'daily', tpl: tp.id, slot: e.slot, diff: tp.d, diffName: DIFF_NAMES[tp.d],
      title: tplTitle(tp, e), desc: fill(tp.ds, e), icon: tp.icon, goal, prog, pct: prog / goal,
      reward: { coins: rw.coins, gems: rw.gems, xp: rw.xp }, done: prog >= goal, claimed: !!e.c,
      char: e.ch || null, rerollable: !e.c && prog < goal
    };
  }
  function bonusProg() { let n = 0; for (const e of S().missions.list) if (e.prog >= e.goal) n++; return n; }
  function bonusObj(day) {
    const M = S().missions, prog = Math.min(3, bonusProg());
    return {
      id: 'd:' + day + ':all', kind: 'daily', bonus: true, tpl: 'all', slot: 3, diff: 2, diffName: 'Sandık',
      title: 'Günlük Sandık', desc: 'Bugünkü 3 görevin hepsini tamamla, sandığı aç.', icon: '🎁',
      goal: 3, prog, pct: prog / 3, reward: { coins: BONUS_REWARD.coins, gems: BONUS_REWARD.gems, xp: BONUS_REWARD.xp },
      done: prog >= 3, claimed: !!M.bonus, char: null, rerollable: false
    };
  }
  /** Günlük görev sayacını ilerletir. ev: şablon ev anahtarı. ch: 'fchar' için karakter. */
  function bump(ev, n, ch) {
    const M = S().missions; if (!M || !Array.isArray(M.list)) return;
    n = num0(n) || 0; if (!n) return;
    for (const e of M.list) {
      const tp = DAILY_BY_ID[e.t];
      if (!tp || tp.ev !== ev || e.c || e.prog >= e.goal) continue;
      if (ev === 'fchar' && e.ch !== ch) continue;
      e.prog = Math.min(e.goal, e.prog + n);
    }
  }

  /* =====================================================================
     BAŞARIMLAR
     ===================================================================== */
  function achStat(a) {
    const s = S();
    try { return Math.floor(num0(typeof a.stat === 'function' ? a.stat(s) : s.stats[a.stat])); } catch (e) { return 0; }
  }
  // 2 kademeli başarımda (allChars) ikinci kademe orta ödül alır (en büyük ödül 3. kademelere ait)
  function achRewardIdx(a, tier) { return a.tiers.length === 2 ? Math.min(1, tier) : Math.min(2, tier); }
  function achObj(a) {
    const M = S().missions, claimedTiers = M.ach[a.key] | 0, maxed = claimedTiers >= a.tiers.length;
    const tier = maxed ? a.tiers.length - 1 : claimedTiers;
    const goal = a.tiers[tier], v = achStat(a), prog = Math.min(goal, v);
    const rw = ACH_REWARD[achRewardIdx(a, tier)];
    return {
      id: 'a:' + a.key + ':' + tier, kind: 'ach', key: a.key, tier, tiers: a.tiers.length, maxed,
      title: a.t + ' ' + ROMAN[tier], desc: a.ds(goal), icon: a.icon, goal, prog, pct: prog / goal, value: v,
      reward: { coins: rw.coins, gems: rw.gems, xp: rw.xp }, done: v >= goal, claimed: maxed
    };
  }

  /* =====================================================================
     GÖREV TAMAMLANMA BİLDİRİMİ (her görev / kademe için yalnızca BİR kez)
     ===================================================================== */
  let raceDone = [];        // bu yarışta tamamlanan görevler (lastRewards.missionsDone)
  function announce(m, silent) {
    if (silent) return;
    raceDone.push({ id: m.id, kind: m.kind, title: m.title, icon: m.icon, reward: m.reward });
    toast('GÖREV TAMAM: ' + m.title, '#7dff8a');
    FM.emit('meta:mission', { mission: m });
  }
  function checkMissions(silent) {
    const s = S(), M = s.missions; if (!M) return;
    const day = M.day;
    // günlükler
    for (const e of M.list) {
      if (!e.n && e.prog >= e.goal) {
        e.n = 1; s.stats.dailyDone++; dirty = true;
        announce(dailyObj(e, day), silent);
      }
    }
    if (!M.bonusN && M.list.length === 3 && bonusProg() >= 3) { M.bonusN = 1; dirty = true; announce(bonusObj(day), silent); }
    // başarımlar (kademe kademe)
    for (const a of ACH) {
      const notified = M.achN[a.key] | 0;
      if (notified >= a.tiers.length) continue;
      if ((M.ach[a.key] | 0) < notified) continue;       // önceki kademe henüz alınmadı (bildirimi zaten yapıldı)
      if (achStat(a) >= a.tiers[notified]) {
        M.achN[a.key] = notified + 1; s.stats.achDone++; dirty = true;
        announce(achObj(a), silent);
      }
    }
  }

  /** missions(kind?) → [{id, kind, title, desc, icon, goal, prog, reward, done, claimed, ...}]
      Sıra: 3 günlük görev + günlük sandık, sonra başarımlar (alınabilir olanlar önce, bitmiş olanlar sonda). */
  meta.missions = function (kind) {
    if (ensureDay(true)) persist();
    checkMissions(false);
    const M = S().missions, out = [];
    if (!kind || kind === 'daily') {
      for (const e of M.list) out.push(dailyObj(e, M.day));
      out.push(bonusObj(M.day));
    }
    if (!kind || kind === 'ach') {
      const achs = ACH.map((a, i) => { const o = achObj(a); o._i = i; return o; });
      const rank = o => o.maxed ? 3 : (o.done && !o.claimed) ? 0 : o.pct > 0 ? 1 : 2;
      achs.sort((x, y) => rank(x) - rank(y) || (rank(x) === 1 ? y.pct - x.pct : 0) || x._i - y._i);
      for (const o of achs) { delete o._i; out.push(o); }
    }
    if (dirty) persist();
    return out;
  };
  /** Alınmayı bekleyen ödül sayısı (menüde kırmızı rozet için) */
  meta.claimable = function () {
    ensureDay(); checkMissions(false);
    const M = S().missions; let n = 0;
    for (const e of M.list) if (e.prog >= e.goal && !e.c) n++;
    if (bonusProg() >= 3 && !M.bonus) n++;
    for (const a of ACH) { const t = M.ach[a.key] | 0; if (t < a.tiers.length && achStat(a) >= a.tiers[t]) n++; }
    if (meta.daily().ready) n++;
    return n;
  };
  meta.missionBadge = meta.claimable;
  /** Yeni günlük görevlere kalan süre (ms) */
  meta.dailyResetIn = msToMidnight;
  /** "5 sa 12 dk" biçiminde kalan süre */
  meta.dailyResetText = function () {
    const ms = msToMidnight(), m = Math.floor(ms / 60000), h = Math.floor(m / 60), mm = m % 60;
    return h > 0 ? `${h} sa ${mm} dk` : `${Math.max(1, mm)} dk`;
  };

  /** claim(id) → verilen ödül {coins, gems, xp, levelUp, title} ya da null (bitmemiş / zaten alınmış / geçersiz). */
  meta.claim = function (id) {
    if (typeof id !== 'string') return null;
    ensureDay(true);
    const s = S(), M = s.missions, parts = id.split(':');
    let rw = null, title = '', icon = '🎁', kind = '';
    if (parts[0] === 'd' && parts.length === 3) {
      if (parts[1] !== M.day) return null;                  // dünün görevi: süresi doldu
      kind = 'daily';
      if (parts[2] === 'all') {
        if (M.bonus || bonusProg() < 3) return null;
        M.bonus = 1; rw = BONUS_REWARD; title = 'Günlük Sandık'; icon = '🎁';
      } else {
        const slot = +parts[2], e = M.list[slot];
        if (!e || e.slot !== slot || e.c || e.prog < e.goal) return null;
        e.c = 1; const tp = DAILY_BY_ID[e.t]; rw = DAILY_REWARD[tp.d] || DAILY_REWARD[0]; title = tplTitle(tp, e); icon = tp.icon;
      }
    } else if (parts[0] === 'a' && parts.length === 3) {
      const a = ACH_BY_KEY[parts[1]], tier = +parts[2];
      if (!a || !isNum(tier)) return null;
      const cur = M.ach[a.key] | 0;
      if (tier !== cur || cur >= a.tiers.length) return null;
      if (achStat(a) < a.tiers[cur]) return null;
      M.ach[a.key] = cur + 1;
      if ((M.achN[a.key] | 0) < cur + 1) { M.achN[a.key] = cur + 1; }
      kind = 'ach'; rw = ACH_REWARD[achRewardIdx(a, cur)]; title = a.t + ' ' + ROMAN[cur]; icon = a.icon;
    } else return null;
    const g = grant(rw, 'mission');
    const out = { coins: g.coins, gems: g.gems, xp: g.xp, levelUp: g.levelUp, levels: g.levels, title, icon, kind, id };
    checkMissions(false);
    persist(true);
    FM.emit('meta:rewards', { rewards: out, kind: 'mission' });
    FM.emit('meta:change', { reason: 'claim', id });
    return out;
  };

  /** Görev değiştirme: günde 1 ücretsiz, sonra REROLL_GEMS elmas. Bitmiş ya da alınmış görev değişmez. */
  meta.rerollCost = function () { ensureDay(); return S().missions.rr > 0 ? REROLL_GEMS : 0; };
  meta.rerollMission = function (id) {
    if (typeof id !== 'string') return false;
    ensureDay(true);
    const s = S(), M = s.missions, parts = id.split(':');
    if (parts[0] !== 'd' || parts[1] !== M.day || parts[2] === 'all') return false;
    const slot = +parts[2], e = M.list[slot];
    if (!e || e.c || e.prog >= e.goal) return false;
    const cost = M.rr > 0 ? REROLL_GEMS : 0;
    if (cost && !debit('gems', cost)) return false;
    const r = e.r + 1;
    const rng = FM.mulberry32((daySeed(M.day) * 2654435761 + 7919 * (slot + 1) + 104729 * r) ^ 0x7E7011);
    const others = M.list.filter(x => x !== e);
    const usedCats = others.map(x => DAILY_BY_ID[x.t].cat), usedIds = M.list.map(x => x.t);
    const tp = pickTpl(rng, DAILY_BY_ID[e.t].d, usedCats, usedIds);
    M.list[slot] = mkEntry(tp, slot, rng, r);
    M.rr++; s.stats.rerolls++;
    persist(true);
    FM.emit('meta:change', { reason: 'reroll', id });
    return true;
  };

  /* =====================================================================
     GELİŞTİRMELER
     ===================================================================== */
  function upKey(key, charId) { return key === 'ab' ? 'ab:' + charOr(charId) : key; }
  function upLevel(key, charId) {
    const u = UPG[key]; if (!u) return 0;
    return clampInt(S().upgrades[upKey(key, charId)], 1, u.max, 1);
  }
  function pctTxt(lv, step) { const v = Math.round((lv - 1) * step); return v > 0 ? '+%' + v : 'Temel'; }
  function upgObj(key, charId) {
    const u = UPG[key], lv = upLevel(key, charId), maxed = lv >= u.max;
    const cost = maxed ? null : u.costs[lv - 1];
    const o = {
      key, n: u.n, icon: u.icon, lv, max: u.max, cost, maxed, scope: u.scope,
      can: !maxed && S().coins >= cost, charId: u.scope === 'char' ? charOr(charId) : null, desc: '', cur: '', next: ''
    };
    if (key === 'ab') {
      const ch = FM.CH[o.charId];
      o.n = 'Özel Güç Seviyesi';
      o.sub = ch ? ch.ab : '';
      o.desc = (ch ? ch.ab + ': ' : '') + 'gücün süresi ve etkisi her seviyede %10 artar.';
      o.cur = pctTxt(lv, 10); o.next = maxed ? '' : pctTxt(lv + 1, 10);
    } else if (key === 'charge') {
      o.desc = 'Özel güç barın her seviyede %6 daha hızlı dolar (tüm karakterlerde geçerli).';
      o.cur = pctTxt(lv, 6); o.next = maxed ? '' : pctTxt(lv + 1, 6);
    } else if (key === 'start') {
      const sel = S().startItem;
      o.desc = 'Her yarışa seçtiğin eşyayla başla. Yeni eşyaların kilidini aç.';
      o.cur = itemName(sel); o.next = maxed ? '' : itemName(START_ITEMS[lv]);
      o.sel = sel;
      o.options = START_ITEMS.map((it, i) => ({
        item: it, n: itemName(it), ic: (FM.ITEMS[it] && FM.ITEMS[it].ic) || '', owned: i < lv, selected: it === sel,
        cost: i < lv ? 0 : u.costs[i - 1], next: i === lv
      }));
    }
    return o;
  }
  /** upgrades(charId) → [{key, n, desc, icon, lv, max, cost, cur, next, scope, can, maxed, ...}] */
  meta.upgrades = function (charId) { return UPG_ORDER.map(k => upgObj(k, charId)); };
  /** buyUpgrade(key, charId) → true (alındı) / false (en üst seviye, geçersiz ya da altın yetersiz) */
  meta.buyUpgrade = function (key, charId) {
    const u = UPG[key]; if (!u) return false;
    if (u.scope === 'char' && charId != null && !charOk(charId)) return false;
    const lv = upLevel(key, charId);
    if (lv >= u.max) return false;
    const cost = u.costs[lv - 1];
    if (!isNum(cost) || !debit('coins', cost)) return false;
    const s = S();
    s.upgrades[upKey(key, charId)] = lv + 1;
    s.stats.upBought++;
    if (key === 'start') s.startItem = START_ITEMS[lv];       // yeni açılan eşya hemen seçilir
    checkMissions(false);
    persist(true);
    FM.emit('meta:upgrade', { key, lv: lv + 1, charId: u.scope === 'char' ? charOr(charId) : null });
    FM.emit('meta:change', { reason: 'upgrade', key });
    return true;
  };
  /** Başlangıç eşyaları listesi ve seçimi */
  meta.startItems = function () { return upgObj('start').options; };
  meta.selectStartItem = function (item) {
    const i = START_ITEMS.indexOf(item);
    if (i < 0 || i >= upLevel('start')) return false;
    if (S().startItem === item) return true;
    S().startItem = item;
    persist(true);
    FM.emit('meta:change', { reason: 'startItem', item });
    return true;
  };
  /** Dışarıdan gelen (ör. ağdan) geliştirme değerini doğrular: abLv ∈ [1,5] tam sayı, chargeMul ∈ [1,1.24], başlangıç eşyası geçerli. */
  function fairMods(m) {
    m = isObj(m) ? m : {};
    const cm = isNum(m.chargeMul) ? Math.max(1, Math.min(1.24, m.chargeMul)) : ROOM_MODS.chargeMul;
    return {
      abLv: clampInt(m.abLv, 1, UPG.ab.max, ROOM_MODS.abLv),
      chargeMul: Math.round(cm * 100) / 100,
      startItem: START_ITEMS.indexOf(m.startItem) >= 0 ? m.startItem : ROOM_MODS.startItem
    };
  }
  /** roomMods(m?) → çok oyunculu odada HERKESE aynı uygulanacak değer (ev sahibinin seçimi ya da varsayılan).
      Ev sahibi bunu ctl.start mesajında `mods` olarak yayınlar; her istemci kendi kaydını değil bunu kullanır. */
  meta.roomMods = function (m) { return fairMods(m == null ? ROOM_MODS : m); };
  meta.ROOM_MODS = Object.assign({}, ROOM_MODS);
  /** mods(charId, opts?) → {abLv, chargeMul, startItem}. game.js maç başında çağırır; botlar oyuncunun değerlerini kopyalar.
      opts.room (true ya da {abLv, chargeMul, startItem}) verilirse oyuncunun kendi geliştirmeleri yok sayılır (eşit güç). */
  meta.mods = function (charId, opts) {
    if (opts && opts.room) return fairMods(opts.room === true ? ROOM_MODS : opts.room);
    const abLv = upLevel('ab', charId), chLv = upLevel('charge');
    const st = START_ITEMS.indexOf(S().startItem) >= 0 && START_ITEMS.indexOf(S().startItem) < upLevel('start') ? S().startItem : 'speed';
    return { abLv: Math.max(1, Math.min(5, abLv)), chargeMul: Math.min(1.24, 1 + 0.06 * (chLv - 1)), startItem: st };
  };

  /* =====================================================================
     KOZMETİK
     ===================================================================== */
  /** owns(type, id, charId) → bool. 'klasik' kostüm ve ücretsiz öğeler her zaman sahipli. */
  meta.owns = function (type, id, charId) {
    const t = normType(type), it = cosItem(t, id); if (!it) return false;
    if (!(num0(it.price) > 0)) return true;
    const s = S();
    if (t === 'skins') { const a = s.owned.skins[charOr(charId)]; return Array.isArray(a) && a.indexOf(id) >= 0; }
    return Array.isArray(s.owned[t]) && s.owned[t].indexOf(id) >= 0;
  };
  meta.price = function (type, id) { const it = cosItem(type, id); return it ? Math.floor(num0(it.price)) : null; };
  /** buyCosmetic(type, id, charId) → true (alındı ya da zaten sahipli) / false (geçersiz ya da altın yetersiz).
      Satın alınan öğe otomatik kuşanılır. */
  meta.buyCosmetic = function (type, id, charId) {
    const t = normType(type), it = cosItem(t, id); if (!it) return false;
    if (t === 'skins' && charId != null && !charOk(charId)) return false;
    if (meta.owns(t, id, charId)) return true;
    const price = Math.floor(num0(it.price));
    if (!debit('coins', price)) return false;
    const s = S();
    if (t === 'skins') { const c = charOr(charId); (s.owned.skins[c] = s.owned.skins[c] || []).push(id); s.stats.skinsBought++; }
    else { s.owned[t].push(id); s.stats.styleBought++; }
    equipRaw(t, id, charId);
    checkMissions(false);
    persist(true);
    FM.emit('meta:buy', { type: t, id, charId: t === 'skins' ? charOr(charId) : null, price });
    FM.emit('meta:change', { reason: 'buy', type: t, id });
    return true;
  };
  function equipRaw(t, id, charId) {
    const s = S();
    if (t === 'skins') s.equipped.skin[charOr(charId)] = id;
    else if (t === 'trails') s.equipped.trail = id;
    else if (t === 'plates') s.equipped.plate = id;
  }
  /** equip(type, id, charId) → bool (sahip değilsen false) */
  meta.equip = function (type, id, charId) {
    const t = normType(type); if (!t || !cosItem(t, id)) return false;
    if (t === 'skins' && charId != null && !charOk(charId)) return false;
    if (!meta.owns(t, id, charId)) return false;
    if (meta.equipped(t, charId) === id) return true;
    equipRaw(t, id, charId);
    persist(true);
    FM.emit('meta:change', { reason: 'equip', type: t, id });
    return true;
  };
  /** equipped(type, charId) → kuşanılan öğenin id'si (her zaman geçerli bir id) */
  meta.equipped = function (type, charId) {
    const t = normType(type), s = S();
    if (t === 'skins') { const c = charOr(charId), id = s.equipped.skin[c]; return id && meta.owns('skins', id, c) ? id : 'klasik'; }
    if (t === 'trails') return cosItem('trails', s.equipped.trail) && meta.owns('trails', s.equipped.trail) ? s.equipped.trail : 'dust';
    if (t === 'plates') return cosItem('plates', s.equipped.plate) && meta.owns('plates', s.equipped.plate) ? s.equipped.plate : 'basic';
    return null;
  };
  /** cosmetics(type, charId) → [{id, n, price, owned, equipped, can, ...}] (mağaza listesi için) */
  meta.cosmetics = function (type, charId) {
    const t = normType(type); if (!t) return [];
    const eq = meta.equipped(t, charId), coins = S().coins;
    return cosList(t).map(x => {
      const owned = meta.owns(t, x.id, charId), price = Math.floor(num0(x.price));
      return Object.assign({}, x, { type: t, price, owned, equipped: x.id === eq, can: owned || coins >= price });
    });
  };

  /* =====================================================================
     GÜNLÜK GİRİŞ ÖDÜLÜ (7 günlük seri)
     ===================================================================== */
  function loginRewards() {
    return LOGIN.map((r, i) => ({ day: i + 1, coins: r.coins, gems: r.gems, icon: r.icon }));
  }
  /** daily() → {ready, streak, day (1..7), reward, rewards:[7], claimedToday, next} */
  meta.daily = function () {
    const s = S(), D = s.daily, today = todayKey();
    const diff = D.last ? dayDiff(D.last, today) : NaN;
    const rewards = loginRewards();
    if (diff === 0) {
      const day = ((Math.max(1, D.streak) - 1) % 7) + 1;
      return { ready: false, streak: D.streak, day, reward: rewards[day - 1], rewards, claimedToday: true, next: rewards[day % 7] };
    }
    // diff === 1 → seri sürüyor; diğer her durumda (ilk kez, gün atlandı, saat geri alındı) seri baştan
    const alive = diff === 1;
    const nextStreak = alive ? D.streak + 1 : 1;
    const day = ((nextStreak - 1) % 7) + 1;
    return { ready: true, streak: alive ? D.streak : 0, day, reward: rewards[day - 1], rewards, claimedToday: false, next: rewards[day % 7], broken: !alive && D.streak > 0 };
  };
  /** claimDaily() → {coins, gems, day, streak, ...} ya da null (bugün zaten alındı) */
  meta.claimDaily = function () {
    const info = meta.daily(); if (!info.ready) return null;
    const s = S(), D = s.daily;
    D.last = todayKey();
    D.streak = info.streak + 1;
    s.stats.dailyClaims++;
    const g = grant({ coins: info.reward.coins, gems: info.reward.gems }, 'daily');
    const out = { coins: g.coins, gems: g.gems, xp: 0, day: info.day, streak: D.streak, title: info.day + '. gün ödülü', icon: info.reward.icon, kind: 'daily' };
    checkMissions(false);
    persist(true);
    FM.emit('meta:rewards', { rewards: out, kind: 'daily' });
    FM.emit('meta:change', { reason: 'daily' });
    return out;
  };

  /* =====================================================================
     ELMAS BOZDURMA
     ===================================================================== */
  meta.packs = function () { const g = S().gems; return PACKS.map(p => Object.assign({ can: g >= p.gems }, p)); };
  meta.exchange = function (packId) {
    let p = null; for (const x of PACKS) if (x.id === packId) p = x;
    if (!p || !debit('gems', p.gems)) return false;
    credit('coins', p.coins, 'exchange');
    S().stats.exchanges++;
    checkMissions(false);
    persist(true);
    FM.emit('meta:change', { reason: 'exchange', id: p.id });
    return true;
  };

  /* =====================================================================
     İSTATİSTİK ERİŞİMİ (profil / klan ekranı için)
     ===================================================================== */
  meta.stats = function () { return JSON.parse(JSON.stringify(S().stats)); };
  meta.charStats = function (id) {
    const st = S().stats, c = charOr(id);
    return { races: num0(st.charRaces[c]), wins: num0(st.charWins[c]), abLv: upLevel('ab', c), skin: meta.equipped('skins', c) };
  };

  /* =====================================================================
     OYUN OLAYLARINI DİNLE (yalnızca oyuncu, demo hariç)
     ===================================================================== */
  /* Yalnızca gerçek yarış ('race') sayılır: demo, geri sayım ve tur bittikten sonra ('end' / 'podium' — fizik
     sürerken mantar zıplaması, çukur ölümü olabiliyor) istatistik ve görev ilerlemesi YAZILMAZ. */
  function live() { return !!FM.S && FM.S.mode === 'race'; }
  function mine(r) { return !!r && live() && r === FM.S.player; }
  function st(k, n) { const s = S().stats; s[k] = num0(s[k]) + (n == null ? 1 : n); }
  function stMap(m, k, n) { const o = S().stats[m]; o[k] = num0(o[k]) + (n == null ? 1 : n); }
  function gameplay(fn) {
    return function (d) {
      try {
        if (!FM.save || !FM.S) return;
        if (fn(d || {}) === false) return;
        ensureDay(false);
        dirty = true;
        checkMissions(false);
      } catch (e) { console.error('[meta]', e); }
    };
  }
  FM.on('jump', gameplay(d => {
    if (!mine(d.r)) return false;
    st('jumps'); bump('jump', 1);
    if (d.dbl) { st('dbl'); bump('dbl', 1); }
  }));
  FM.on('slide', gameplay(d => { if (!mine(d.r)) return false; st('slides'); bump('slide', 1); }));
  FM.on('slam', gameplay(d => { if (!mine(d.r)) return false; st('slams'); bump('slam', 1); }));
  FM.on('climb', gameplay(d => { if (!mine(d.r)) return false; st('climbs'); bump('climb', 1); }));
  FM.on('vault', gameplay(d => { if (!mine(d.r)) return false; st('vaults'); }));
  FM.on('flap', gameplay(d => { if (!mine(d.r)) return false; st('flaps'); }));
  FM.on('pad', gameplay(d => { if (!mine(d.r)) return false; st('pads'); bump('pad', 1); }));
  FM.on('mush', gameplay(d => { if (!mine(d.r)) return false; st('mush'); bump('mush', 1); }));
  FM.on('box', gameplay(d => { if (!mine(d.r)) return false; st('boxes'); bump('box', 1); }));
  FM.on('coin', gameplay(d => { if (!mine(d.r)) return false; st('coinsGot'); bump('coin', 1); }));
  FM.on('item:use', gameplay(d => {
    if (!mine(d.r)) return false;
    st('items'); bump('item', 1);
    if (typeof d.item === 'string') { stMap('itemsBy', d.item); bump('u_' + d.item, 1); }
  }));
  FM.on('ability', gameplay(d => { if (!mine(d.r)) return false; st('abilities'); bump('ability', 1); }));
  FM.on('hit', gameplay(d => {
    if (!live()) return false;
    const P = FM.S.player; let any = false;
    if (d.src && d.src === P && d.victim && d.victim !== P) {
      st('hitsDealt'); any = true;
      if (d.cause && FM.CH && has(FM.CH, d.cause)) { st('abHits'); bump('abhit', 1); }
    }
    if (d.victim && d.victim === P) { st('hitsTaken'); any = true; }
    return any ? undefined : false;
  }));
  FM.on('blocked', gameplay(d => {
    if (!mine(d.r)) return false;
    st('blocks'); bump('block', 1);
    if (d.by === 'shield') { st('blocksShield'); bump('bshield', 1); }
    else if (d.by === 'balloon') st('blocksBalloon');
  }));
  FM.on('death', gameplay(d => {
    if (!live()) return false;
    const P = FM.S.player; let any = false;
    if (d.r && d.r === P) { st('deaths'); if (d.self) st('selfKills'); any = true; }
    if (d.killer && d.killer === P && d.r && d.r !== P) {
      st('kills'); bump('kill', 1); any = true;
      const c = typeof d.cause === 'string' ? d.cause : 'env';
      stMap('killsBy', c);
      if (c === 'dyn' || c === 'saw' || c === 'mis' || c === 'trap' || c === 'bolt') bump('k_' + c, 1);
    }
    return any ? undefined : false;
  }));

  /* ---------------- yarış / maç akışı ---------------- */
  let matchId = 0, matchTotals = { coins: 0, gems: 0, xp: 0, races: 0 }, rewardedRace = '', rewardedMatch = -1;
  const EMPTY_REWARDS = () => ({ kind: 'race', coins: 0, gems: 0, xp: 0, lines: [], levelUp: 0, levels: [], missionsDone: [], place: 0, finished: false, round: 0, rounds: 0 });
  meta.lastRewards = EMPTY_REWARDS();
  meta.lastRaceRewards = meta.lastRewards;
  meta.lastMatchRewards = null;
  meta.matchTotals = function () { return Object.assign({}, matchTotals); };

  FM.on('match:start', () => {
    matchId++; matchTotals = { coins: 0, gems: 0, xp: 0, races: 0 };
    ensureDay(true);
  });
  FM.on('race:start', () => { raceDone = []; ensureDay(true); });

  function line(t, v, cur, icon) {
    v = Math.round(v) || 0;
    const sign = v > 0 ? '+' : '';
    const s = cur === 'xp' ? `${sign}${fmt(v)} XP` : cur === 'gems' ? `${sign}${fmt(v)} elmas` : cur === 'trophy' ? `${sign}${fmt(v)} kupa` : `${sign}${fmt(v)} altın`;
    return { t, v, cur, icon, s };
  }

  FM.on('race:end', res => {
    try {
      if (!FM.S || FM.S.mode === 'demo') return;
      res = res || {};
      const P = res.player || FM.S.player; if (!P) return;
      const key = matchId + ':' + (res.round | 0) + ':' + (FM.S.matchStats && FM.S.matchStats.startedAt || 0);
      if (key === rewardedRace) return;                      // aynı tur için iki kez ödül verme
      rewardedRace = key;
      ensureDay(true);
      const s = S(), stt = s.stats;
      const rank = clampInt(res.playerRank, 0, 3, 3);
      const fin = !!P.finished;
      const kills = clampInt(P.kills, 0, 999, 0), coinsGot = clampInt(P.coins, 0, 9999, 0), deaths = clampInt(P.deaths, 0, 999, 0);
      const clean = fin && deaths === 0, win = fin && rank === 0, top2 = fin && rank <= 1;
      const cid = charOr(P.id);

      // istatistikler + günlük sayaçlar
      st('races'); stMap('charRaces', cid);
      if (fin) { st('finishes'); bump('finish', 1); bump('fchar', 1, cid); }
      if (win) { st('wins'); stMap('charWins', cid); bump('win', 1); stt.winStreak++; stt.bestStreak = Math.max(stt.bestStreak, stt.winStreak); }
      else stt.winStreak = 0;
      if (top2) { st('top2'); bump('top2', 1); }
      if (clean) { st('clean'); bump('clean', 1); }
      const rt = num0(FM.S.raceT); st('time', Math.round(rt));
      if (fin && num0(P.ftime) > 0 && res.theme && res.theme.id) {
        const b = stt.best[res.theme.id];
        if (!isNum(b) || P.ftime < b) stt.best[res.theme.id] = Math.round(P.ftime * 100) / 100;
      }

      // ödül dökümü
      const lines = [];
      const pc = Math.round(PLACE_COINS[rank] * (fin ? 1 : DNF_MUL));
      lines.push(line(fin ? `${rank + 1}. oldun` : `Bitiremedin (${rank + 1}. sıra)`, pc, 'coins', ['🥇', '🥈', '🥉', '🏅'][rank]));
      if (coinsGot > 0) lines.push(line(`Toplanan altın ×${coinsGot}`, coinsGot * COIN_VALUE, 'coins', '🪙'));
      if (kills > 0) lines.push(line(`Patlatılan rakip ×${kills}`, Math.min(kills, KILL_COINS_CAP) * KILL_COINS, 'coins', '💥'));
      if (fin) lines.push(line('Bitiş bonusu', FINISH_COINS, 'coins', '🏁'));
      if (clean) lines.push(line('Kusursuz yarış (hiç ölmedin)', CLEAN_COINS, 'coins', '😇'));
      if (win && stt.winStreak >= 2) lines.push(line(`Galibiyet serisi ×${stt.winStreak}`, Math.min(STREAK_CAP, STREAK_COINS * (stt.winStreak - 1)), 'coins', '🔥'));
      let xp = Math.round(PLACE_XP[rank] * (fin ? 1 : DNF_MUL));
      if (fin) xp += FINISH_XP;
      xp += Math.min(KILL_XP_CAP, kills * KILL_XP);
      if (clean) xp += CLEAN_XP;
      lines.push(line('Deneyim', xp, 'xp', '⭐'));

      let coins = 0; for (const l of lines) if (l.cur === 'coins') coins += l.v;
      const g = grant({ coins, xp }, 'race');
      for (const u of g.levels) {
        lines.push(line(`Seviye ${u.level} oldun!`, u.coins, 'coins', '⬆️'));
        if (u.gems) lines.push(line(`Seviye ${u.level} elmas ödülü`, u.gems, 'gems', '💎'));
      }
      if (isNum(P.td) && P.td !== 0) lines.push(line('Kupa', P.td, 'trophy', '🏆'));
      else if (isNum(res.trophyDelta) && res.trophyDelta !== 0) lines.push(line('Kupa', res.trophyDelta, 'trophy', '🏆'));

      checkMissions(false);
      const out = {
        kind: 'race', coins: g.coins, gems: g.gems, xp: g.xp, lines, levelUp: g.levelUp, levels: g.levels,
        missionsDone: raceDone.slice(), place: rank + 1, finished: fin, round: res.round | 0, rounds: res.rounds | 0,
        kills, coinsGot, deaths, char: cid, last: !!res.last, level: meta.levelInfo()
      };
      raceDone = [];
      matchTotals.coins += out.coins; matchTotals.gems += out.gems; matchTotals.xp += out.xp; matchTotals.races++;
      out.matchTotals = Object.assign({}, matchTotals);
      meta.lastRewards = out; meta.lastRaceRewards = out;
      persist();
      FM.emit('meta:rewards', { rewards: out, kind: 'race' });
      FM.emit('meta:change', { reason: 'race' });
    } catch (e) { console.error('[meta race:end]', e); }
  });

  FM.on('match:end', d => {
    try {
      if (!FM.S || FM.S.mode === 'demo') return;
      d = d || {};
      if (rewardedMatch === matchId) return;
      rewardedMatch = matchId;
      ensureDay(true);
      raceDone = [];
      const rounds = clampInt(FM.S.ROUNDS, 1, 99, 1);
      const champ = !!d.champion;
      const st0 = Array.isArray(d.standings) ? d.standings : [];
      const P = d.player || FM.S.player;
      const ix = st0.indexOf(P), pos = Math.max(0, ix);
      st('matches');
      if (champ || (ix >= 0 && ix <= 1)) bump('mtop2', 1);      // günlük "maçı ilk 2'de bitir"
      const lines = [];
      let rw;
      if (champ) {
        st('champs'); bump('champ', 1);
        rw = { coins: 50 * rounds, gems: Math.floor(rounds * 2 / 3), xp: 15 * rounds + 5 };
        lines.push(line('Şampiyonluk bonusu', rw.coins, 'coins', '👑'));
        if (rw.gems) lines.push(line('Şampiyonluk elması', rw.gems, 'gems', '💎'));
      } else {
        rw = { coins: 10 * rounds, gems: 0, xp: 5 * rounds + 5 };
        lines.push(line(`Maç tamamlandı (${pos + 1}. sıra)`, rw.coins, 'coins', '🎮'));
      }
      lines.push(line('Maç deneyimi', rw.xp, 'xp', '⭐'));
      const g = grant(rw, 'match');
      for (const u of g.levels) {
        lines.push(line(`Seviye ${u.level} oldun!`, u.coins, 'coins', '⬆️'));
        if (u.gems) lines.push(line(`Seviye ${u.level} elmas ödülü`, u.gems, 'gems', '💎'));
      }
      checkMissions(false);
      matchTotals.coins += g.coins; matchTotals.gems += g.gems; matchTotals.xp += g.xp;
      const out = {
        kind: 'match', coins: g.coins, gems: g.gems, xp: g.xp, lines, levelUp: g.levelUp, levels: g.levels,
        missionsDone: raceDone.slice(), champion: champ, place: pos + 1, finished: true, round: rounds, rounds,
        total: Object.assign({}, matchTotals), matchTotals: Object.assign({}, matchTotals), race: meta.lastRaceRewards, level: meta.levelInfo()
      };
      raceDone = [];
      meta.lastMatchRewards = out; meta.lastRewards = out;
      persist(true);
      FM.emit('meta:rewards', { rewards: out, kind: 'match' });
      FM.emit('meta:change', { reason: 'match' });
    } catch (e) { console.error('[meta match:end]', e); }
  });

  // yarış içi sayaçlar her olayda yazılmaz; bu anlarda topluca kaydedilir
  FM.on('ui:menu', () => { ensureDay(true); flush(); });
  FM.on('ui:pause', () => flush());
  FM.on('save:reset', () => {
    normalize(); ensureDay(true); checkMissions(true);
    meta.lastRewards = EMPTY_REWARDS(); meta.lastRaceRewards = meta.lastRewards; meta.lastMatchRewards = null;
    persist(true); FM.emit('meta:change', { reason: 'reset' });
  });
  try {
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    }
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', flush);
    }
  } catch (e) { }

  /* =====================================================================
     AÇILIŞ
     ===================================================================== */
  // dışa açık tanımlar (UI ve test için, salt okunur kopyalar)
  meta.DAILY_POOL = DAILY.map(t => Object.assign({}, t));
  meta.ACHIEVEMENTS = ACH.map(a => ({ key: a.key, icon: a.icon, t: a.t, tiers: a.tiers.slice() }));
  meta.START_ITEMS = START_ITEMS.slice();
  meta.LOGIN_REWARDS = loginRewards();
  meta.todayKey = todayKey;
  meta._normalize = normalize;
  meta._ensureDay = ensureDay;

  try {
    normalize();
    ensureDay(true);
    checkMissions(true);     // eski kayıtta zaten tamamlanmış olanları sessizce işaretle
    persist();
  } catch (e) { console.error('[meta init]', e); }
})(window.FM);

/* FUAT MOREL — meta.js
   Oyun ekonomisi ve ilerleme: altın / elmas, XP / seviye, günlük görevler, kademeli başarımlar,
   yetenek geliştirmeleri, kozmetik satın alma / kuşanma, 7 günlük giriş ödülü, yarış ve maç ödülleri.
   HİÇBİR ŞEY ÇİZMEZ. Tüm kalıcı veri FM.save içinde tutulur, değişince FM.persist() ile kaydedilir.

   Kayıt şeması genişletmesi (FM.save içinde):
     coins, gems, xp, level                     (core.js varsayılanları)
     upgrades   { 'ab:<charId>': 1..5, charge: 1..5, start: 1..3 }
     startItem  'speed' | 'shield' | 'balloon'      (kilidi açık olanlardan seçilen başlangıç eşyası; saldırı eşyası YOK)
     owned      { skins: { charId: [id...] }, trails: [id...], plates: [id...], hats: [id...], wins: [id...], deaths: [id...] }
     equipped   { skin: { charId: id }, trail: id, plate: id, hat: id, win: id, death: id }
     Mağaza 2.0: tür ∈ 'skins'|'trails'|'plates'|'hats'|'wins'|'deaths' (FM.COS_TYPES); nadirlik FM.meta.rarity(rar);
       günlük vitrin FM.meta.dailyShop() (tarihe göre deterministik, herkese aynı, bir öğe %30 indirimli; buyCosmetic indirimi uygular).
     missions   { v, day:'YYYY-MM-DD', list:[{t,slot,goal,prog,c,n,ch,r}], bonus, bonusN, rr, ach:{key:claimedTier}, achN:{key:notifiedTier} }
     stats      { races, wins, ... toplam sayaçlar; charRaces:{}, charWins:{}, killsBy:{}, itemsBy:{}, best:{} }
     daily      { last:'YYYY-MM-DD', streak }
     stats.mp*  çok oyunculu sayaçlar (mpRaces, mpWins, mpTop3, mpMatches, mpChamps); modeRaces{mod}, themeRaces{tema}
     Kayıt aktarma: exportCode / importCode / cloudSave / cloudLoad (en altta). pid ve cihaz ayarları içe aktarmada korunur.
     5. tur (profil): trReset (1 = kupa sıfırlama göçü yapıldı; core.js normSave), since (ilk oynama ms), h2h { pid: {nick, w, l, t} },
       stats.playSec (toplam oynama sn), stats.trBest (ulaşılan en yüksek toplam kupa). Profil kartı: FM.meta.card() + 'meta:card' olayı.

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
  const HUNT_VALUE = 0.6, HUNT_CAP = 150;   // Altın Avı: toplanan altının ödül değeri ve tavanı
  const MP_BONUS = 15, MP_BONUS_PER = 3, MP_BONUS_CAP = 40, MP_XP = 10;   // arkadaşlarla yarış bonusu (2 kişi 15 … 10 kişi 39)
  /* Sıra ödülü n kişiye ölçekli: 4 kişilik tablo [1., 2., 3., 4.] n sıraya doğrusal örneklenir
     (4 kişide eski değerler aynen; 10 kişide 1. 120, 2. ~103 … son 20; 2 kişide 120 / 20). */
  function placeVal(tab, rank, n) {
    if (n <= 1) return tab[0];
    const p = Math.max(0, Math.min(1, rank / (n - 1))) * (tab.length - 1), i = Math.floor(p), f = p - i;
    return i >= tab.length - 1 ? tab[tab.length - 1] : tab[i] + (tab[i + 1] - tab[i]) * f;
  }

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

  // Ligler: TOPLAM kupaya (7 karakterin toplamı, hepsi 0'dan başlar) göre. min artan sırada olmalı.
  const LEAGUES = [
    { id: 'bronz',  n: 'Bronz',  col: '#cd7f32', min: 0 },
    { id: 'gumus',  n: 'Gümüş',  col: '#c4ccd8', min: 300 },
    { id: 'altin',  n: 'Altın',  col: '#ffd23f', min: 800 },
    { id: 'elmas',  n: 'Elmas',  col: '#5fe0ff', min: 1600 },
    { id: 'efsane', n: 'Efsane', col: '#ff4fa3', min: 3000 }
  ];
  // Oynama süresi sayacı
  const PLAY_IDLE_MS = 90 * 1000;     // yarış dışında bu süre etkileşim yoksa süre işlemez
  const PLAY_TICK_MS = 3000;          // toplu sayım aralığı
  const PLAY_SAVE_MS = 30 * 1000;     // kaydı bu aralıktan sık yazma
  const PLAY_MAX_DT = 6;              // tek sayımda en çok eklenecek sn (uyku / zamanlayıcı kısılması koruması)
  const CARD_MIN_MS = 1000;           // 'meta:card' en sık bu aralıkla
  const H2H_MAX = 50;                 // kafa kafaya listesinde en çok kişi

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
    { id: 'mp2', d: 1, cat: 'mp', ev: 'mp', goal: 2, icon: '🤝', t: 'Arkadaşlarla {g} yarış yap', t1: 'Arkadaşlarla bir yarış yap', ds: 'ARKADAŞLARLA düğmesiyle oda kur ya da arkadaşının linkiyle odaya katıl.' },
    { id: 'elim3', d: 1, cat: 'mode', ev: 'elimtop3', goal: 1, icon: '🚪', t: "Eleme modunda {g} kez ilk 3'e gir", t1: "Eleme modunda ilk 3'e gir", ds: 'Eleme kapılarından en son geçen sen olma!' },
    { id: 'hunt80', d: 1, cat: 'mode', ev: 'huntcoin', goal: 80, icon: '🪙', t: "Altın Avı'nda {g} altın topla", ds: "Altın Avı modunda altınları kap (birden çok yarışta da toplanabilir)." },
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
    { id: 'abil6', d: 2, cat: 'abil', ev: 'ability', goal: 8, icon: '🌟', t: '{g} kez özel güç kullan', ds: 'Güç barını doldur, gücünü boşa harcama.' },
    { id: 'meteor3', d: 2, cat: 'mode', ev: 'dodge', goal: 3, icon: '☄️', t: "Kaos'ta {g} meteordan kaç", ds: 'Kaos modunda kırmızı gölgeyi görünce kaç: meteor yanına düşsün ama sana değmesin.' }
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
    { key: 'style', icon: '✨', t: 'Tarz Sahibi', stat: s => ownedStyleCount(s), tiers: [2, 6, 15], ds: g => g >= totalStyle() ? 'Bütün süsleri topla (iz, plaka, aksesuar, kutlama, ölüm efekti)' : `${g} süs satın al (iz, plaka, aksesuar, kutlama ya da ölüm efekti)` },
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
    { key: 'earned', icon: '💰', t: 'Zengin', stat: 'earned', tiers: [2000, 10000, 50000], ds: g => `Toplam ${fmt(g)} altın kazan` },
    // oynama süresi (ilerleme DAKİKA olarak sayılır) ve lig yolu (ulaşılan en yüksek toplam kupa; kupa kaybetmek ilerlemeyi geri almaz)
    { key: 'playTime', icon: '⏱️', t: 'Maratoncu', stat: s => Math.floor(num0(s.stats.playSec) / 60), tiers: [60, 300, 1440],
      ds: g => `Toplam ${g % 60 === 0 ? (g / 60) + ' saat' : fmt(g) + ' dakika'} oyna (${fmt(g)} dk)` },
    { key: 'trophy', icon: '🏆', t: 'Lig Yolcusu', stat: 'trBest', tiers: [300, 800, 1600], ds: g => `Toplam ${fmt(g)} kupaya ulaş (${leagueOf(g).n} Ligi)` },
    // çok oyunculu ve modlar
    { key: 'mpRaces', icon: '🤝', t: 'Kanka', stat: 'mpRaces', tiers: [1, 10, 50], ds: g => g === 1 ? 'Arkadaşlarınla ilk yarışını yap' : `Arkadaşlarınla ${fmt(g)} yarış yap` },
    { key: 'mpWins', icon: '😎', t: 'Odanın Kralı', stat: 'mpWins', tiers: [1, 10, 30], ds: g => g === 1 ? 'Arkadaşlarına karşı bir yarış kazan' : `Arkadaşlarına karşı ${fmt(g)} yarış kazan` },
    { key: 'mpChamps', icon: '🏆', t: 'Ekibin Şampiyonu', stat: 'mpChamps', tiers: [1, 5, 20], ds: g => g === 1 ? 'Arkadaşlarınla oynadığın bir maçı şampiyon bitir' : `Arkadaşlarınla ${fmt(g)} maçta şampiyon ol` },
    { key: 'elimTop3', icon: '🚪', t: 'Hayatta Kalan', stat: 'elimTop3', tiers: [1, 10, 30], ds: g => g === 1 ? "Eleme modunda ilk 3'e gir" : `Eleme modunda ${fmt(g)} kez ilk 3'e gir` },
    { key: 'coinsBest', icon: '🪙', t: 'Hazine Avcısı', stat: 'coinsBest', tiers: [80, 150, 250], ds: g => `Altın Avı'nda tek yarışta ${fmt(g)} altın topla` },
    { key: 'meteorDodge', icon: '☄️', t: 'Meteor Savar', stat: 'meteorDodge', tiers: [3, 25, 100], ds: g => `Kaos'ta ${fmt(g)} meteordan kaç` },
    { key: 'modes', icon: '🎲', t: 'Çok Yönlü', stat: s => countKeys(s.stats.modeRaces), tiers: [3, 5], ds: g => g >= 5 ? 'Beş oyun modunun hepsinde yarış' : `${g} farklı oyun modunda yarış` },
    { key: 'maps', icon: '🗺️', t: 'Gezgin', stat: s => countKeys(s.stats.themeRaces), tiers: [4, 8], ds: g => g >= 8 ? 'Sekiz haritanın hepsinde yarış' : `${g} farklı haritada yarış` }
  ];
  // her harita için "X haritasında yarış" başarımı (FM.THEMES sırasıyla; anahtar 'th_<tema id>')
  const THEME_ICONS = { forest: '🌲', candy: '🍭', snow: '❄️', castle: '🏰', desert: '🏜️', space: '🚀', city: '🌃', tropic: '🌴' };
  for (const th of (FM.THEMES || [])) {
    ACH.push({ key: 'th_' + th.id, icon: THEME_ICONS[th.id] || '🗺️', t: th.n + ' Ustası', stat: s => num0(s.stats.themeRaces && s.stats.themeRaces[th.id]), tiers: [1, 10, 30],
      ds: g => g === 1 ? `${th.n} haritasında bir yarış yap` : `${th.n} haritasında ${fmt(g)} yarış yap` });
  }
  const ACH_BY_KEY = {}; for (const a of ACH) ACH_BY_KEY[a.key] = a;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  /* ---------------- istatistik alanları ---------------- */
  const STAT_KEYS = ['races', 'finishes', 'wins', 'top2', 'clean', 'matches', 'champs', 'coinsGot', 'kills', 'deaths', 'selfKills',
    'items', 'abilities', 'abHits', 'hitsDealt', 'hitsTaken', 'jumps', 'dbl', 'slides', 'slams', 'climbs', 'vaults', 'flaps', 'pads', 'mush', 'boxes',
    'blocks', 'blocksShield', 'blocksBalloon', 'earned', 'spent', 'gemsEarned', 'gemsSpent', 'dailyClaims', 'dailyDone', 'achDone',
    'upBought', 'skinsBought', 'styleBought', 'winStreak', 'bestStreak', 'time', 'xpTotal', 'rerolls', 'exchanges',
    'mpRaces', 'mpWins', 'mpTop3', 'mpMatches', 'mpChamps', 'mpKills', 'elimTop3', 'elimWins', 'coinsBest', 'coinsWins', 'meteorDodge', 'gemCos', 'imports', 'playSec', 'trBest', 'dealsBought'];
  const STAT_MAPS = ['charRaces', 'charWins', 'killsBy', 'itemsBy', 'best', 'modeRaces', 'themeRaces'];

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
  /** Toplam kupa (7 karakterin toplamı; bozuk/eksik değer 0). */
  function totalTrophies(sv) {
    let tr = 0; const t = sv && sv.trophies;
    if (isObj(t)) for (const k of FM.ORDER) tr += num0(t[k]);
    return Math.round(tr);
  }
  /** Kupa → lig. min artan olduğundan son uygun olan seçilir. */
  function leagueOf(tr) {
    tr = num0(tr);
    let i = 0; for (let j = 1; j < LEAGUES.length; j++) if (tr >= LEAGUES[j].min) i = j;
    const L = LEAGUES[i], N = LEAGUES[i + 1] || null;
    return { id: L.id, n: L.n, col: L.col, min: L.min, next: N ? N.min : null, nextN: N ? N.n : null, idx: i, pct: N ? Math.max(0, Math.min(1, (tr - L.min) / (N.min - L.min))) : 1 };
  }
  /** Takma adı ağdaki kuralla (net.js cleanNick) aynı biçimde temizler: kontrol karakterleri ve <>"'`\ atılır, en çok 14 karakter. */
  function cleanNick(v) {
    v = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(v).slice(0, 14).join('').trim();
  }
  /** Oyuncu kimliği anahtarı (net.js pid biçimi + güvenli sınır) */
  const PID_RE = /^[A-Za-z0-9_-]{1,24}$/;

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
  // Tür tabloları: skins karakter başına; diğerleri ("tarz" türleri) hesap geneli tek liste + tek kuşanılan.
  const STYLE_TYPES = ['trails', 'plates', 'hats', 'wins', 'deaths'];
  const EQ_KEY = { trails: 'trail', plates: 'plate', hats: 'hat', wins: 'win', deaths: 'death' };   // FM.save.equipped alan adı
  const DEF_ID = { skins: 'klasik', trails: 'dust', plates: 'basic', hats: 'none', wins: 'none', deaths: 'none' };
  const TYPE_INFO = {
    skins:  { n: 'Görünümler',    one: 'Görünüm',    icon: 'user' },
    hats:   { n: 'Aksesuarlar',   one: 'Aksesuar',   icon: 'hat' },
    trails: { n: 'İzler',         one: 'İz',         icon: 'sparkle' },
    plates: { n: 'Plakalar',      one: 'Plaka',      icon: 'flag' },
    wins:   { n: 'Kutlamalar',    one: 'Kutlama',    icon: 'trophy' },
    deaths: { n: 'Ölüm Efektleri', one: 'Ölüm Efekti', icon: 'skull' }
  };
  const RARITY = FM.RARITY || { c: { n: 'Sıradan', col: '#9aa3b2' }, r: { n: 'Nadir', col: '#4fb3ff' }, e: { n: 'Destansı', col: '#c084fc' }, l: { n: 'Efsanevi', col: '#ffb020' } };
  const RAR_ORDER = ['c', 'r', 'e', 'l'];
  function normType(t) {
    if (typeof t !== 'string') return null;
    if (t === 'skin' || t === 'skins') return 'skins';
    if (t === 'trail' || t === 'trails') return 'trails';
    if (t === 'plate' || t === 'plates') return 'plates';
    if (t === 'hat' || t === 'hats') return 'hats';
    if (t === 'win' || t === 'wins') return 'wins';
    if (t === 'death' || t === 'deaths') return 'deaths';
    return null;
  }
  function cosList(type) { const t = normType(type); return t && FM.COSMETICS && Array.isArray(FM.COSMETICS[t]) ? FM.COSMETICS[t] : []; }
  function cosItem(type, id) { const l = cosList(type); for (const x of l) if (x.id === id) return x; return null; }
  function freeIds(type) { return cosList(type).filter(x => !(num0(x.price) > 0)).map(x => x.id); }
  /** Kozmetiğin para birimi: FM.COSMETICS öğesinde cur: 'gems' ise elmas, yoksa altın */
  function cosCur(it) { return it && it.cur === 'gems' ? 'gems' : 'coins'; }
  function rarOf(it) { return it && RARITY[it.rar] ? it.rar : 'c'; }
  function totalSkins() { return FM.ORDER.length * cosList('skins').filter(x => num0(x.price) > 0).length; }
  function totalStyle() { let n = 0; for (const t of STYLE_TYPES) n += cosList(t).filter(x => num0(x.price) > 0).length; return n; }
  function ownedSkinCount(s) {
    let n = 0; const o = s.owned && s.owned.skins;
    if (!isObj(o)) return 0;
    for (const c of FM.ORDER) { const a = o[c]; if (Array.isArray(a)) for (const id of a) { const it = cosItem('skins', id); if (it && num0(it.price) > 0) n++; } }
    return n;
  }
  function ownedStyleCount(s) {
    let n = 0;
    for (const t of STYLE_TYPES) { const a = s.owned && s.owned[t]; if (Array.isArray(a)) for (const id of a) { const it = cosItem(t, id); if (it && num0(it.price) > 0) n++; } }
    return n;
  }
  /** Türün varsayılan (her zaman sahipli) öğesi: listede varsa DEF_ID, yoksa ilk ücretsiz, o da yoksa ilk öğe */
  function defId(t) {
    if (cosItem(t, DEF_ID[t])) return DEF_ID[t];
    const f = freeIds(t); if (f.length) return f[0];
    const l = cosList(t); return l.length ? l[0].id : DEF_ID[t];
  }

  /* =====================================================================
     KAYIT NORMALLEŞTİRME (eski / bozuk kayıtlarla uyum)
     ===================================================================== */
  /** Kafa kafaya listesini doğrular: { pid: {nick, w, l, t} }; geçersiz/boş kayıtlar ve kendi pid'in atılır, en çok H2H_MAX kişi (en eski t önce düşer). */
  function normH2h(src, ownPid) {
    const out = {};
    if (isObj(src)) {
      for (const pid of Object.keys(src)) {
        const e = src[pid];
        if (!PID_RE.test(pid) || pid === ownPid || !isObj(e)) continue;
        const w = clampInt(e.w, 0, 1e6, 0), l = clampInt(e.l, 0, 1e6, 0);
        if (!w && !l) continue;
        out[pid] = { nick: cleanNick(e.nick) || 'Oyuncu', w, l, t: clampInt(e.t, 0, 4e12, 0) };
      }
    }
    trimH2h(out);
    return out;
  }
  function trimH2h(o) {
    const keys = Object.keys(o);
    if (keys.length <= H2H_MAX) return o;
    keys.sort((a, b) => o[b].t - o[a].t);
    for (let i = H2H_MAX; i < keys.length; i++) delete o[keys[i]];
    return o;
  }
  function freshMissions() { return { v: 1, day: '', list: [], bonus: 0, bonusN: 0, rr: 0, ach: {}, achN: {} }; }
  function normalize() {
    if (!isObj(FM.save)) FM.save = FM.defaultSave();
    // core.js normSave'den geçmemiş bir kayıt (kupa sıfırlama göçü yapılmamış) buraya gelirse aynı göçü uygula (yerinde değiştirir)
    if (FM.save.trReset !== 1) { try { FM.normSave(FM.save); } catch (e) { } }
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
    s.owned.chars = (Array.isArray(s.owned.chars) ? s.owned.chars : []).filter((k, i, a) => typeof k === 'string' && FM.chPaid(k) && a.indexOf(k) === i);
    for (const c of FM.ORDER) {
      const a = Array.isArray(s.owned.skins[c]) ? s.owned.skins[c] : [];
      const out = [];
      for (const id of freeIds('skins').concat(a)) if (cosItem('skins', id) && out.indexOf(id) < 0) out.push(id);
      s.owned.skins[c] = out;
    }
    for (const t of STYLE_TYPES) {
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
    for (const t of STYLE_TYPES) {
      const k = EQ_KEY[t];
      if (s.owned[t].indexOf(s.equipped[k]) < 0) s.equipped[k] = s.owned[t].indexOf(defId(t)) >= 0 ? defId(t) : (s.owned[t][0] || defId(t));
    }
    // istatistikler
    if (!isObj(s.stats)) s.stats = {};
    for (const k of STAT_KEYS) s.stats[k] = clampInt(s.stats[k], 0, 1e12, 0);
    for (const k of STAT_MAPS) {
      if (!isObj(s.stats[k])) s.stats[k] = {};
      const m = s.stats[k];
      for (const kk of Object.keys(m)) { if (!isNum(m[kk]) || m[kk] < 0) delete m[kk]; }
    }
    s.stats.trBest = Math.max(s.stats.trBest, totalTrophies(s));      // ulaşılan en yüksek toplam kupa (Lig Yolcusu başarımı)
    // profil: ilk oynama anı + kafa kafaya listesi
    if (!isNum(s.since) || s.since <= 0) s.since = isNum(s.created) && s.created > 0 ? s.created : Date.now();
    s.h2h = normH2h(s.h2h, s.pid);
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
  /** price(type, id) → bugünkü fiyat (vitrin indirimi uygulanmış); geçersiz öğede null. basePrice → liste fiyatı. */
  meta.price = function (type, id) { const it = cosItem(type, id); return it ? effPrice(normType(type), it).price : null; };
  meta.basePrice = function (type, id) { const it = cosItem(type, id); return it ? Math.floor(num0(it.price)) : null; };
  /** currency(type, id) → 'coins' | 'gems' (geçersiz öğede null) */
  meta.currency = function (type, id) { const it = cosItem(type, id); return it ? cosCur(it) : null; };
  /** rarity(rar | öğe) → {id, n, col, idx} (bilinmeyen → Sıradan) */
  meta.rarity = function (r) {
    const id = isObj(r) ? rarOf(r) : (RARITY[r] ? r : 'c');
    return { id, n: RARITY[id].n, col: RARITY[id].col, idx: RAR_ORDER.indexOf(id) };
  };
  meta.RARITY = RAR_ORDER.map(id => Object.assign({ id, idx: RAR_ORDER.indexOf(id) }, RARITY[id]));
  /** cosTypes() → [{type, n, one, icon, count}] mağaza sekmeleri için (sırası: görünüm, aksesuar, iz, plaka, kutlama, ölüm) */
  meta.cosTypes = function () {
    return ['skins', 'hats', 'trails', 'plates', 'wins', 'deaths'].filter(t => cosList(t).length).map(t => Object.assign({ type: t, count: cosList(t).length }, TYPE_INFO[t]));
  };
  meta.typeName = function (type) { const t = normType(type); return t && TYPE_INFO[t] ? TYPE_INFO[t].n : ''; };
  /** Bugünkü geçerli fiyat: vitrinde indirimliyse indirimli, değilse liste fiyatı → {price, cur, base, off} */
  function effPrice(t, it) {
    const base = Math.floor(num0(it.price)), cur = cosCur(it);
    const d = shopEntry(t, it.id);
    if (d && d.off > 0 && base > 0) return { price: discounted(base, cur, d.off), cur, base, off: d.off };
    return { price: base, cur, base, off: 0 };
  }
  /** buyCosmetic(type, id, charId) → true (alındı ya da zaten sahipli) / false (geçersiz ya da altın yetersiz).
      Günün vitrinindeki indirim otomatik uygulanır. Satın alınan öğe otomatik kuşanılır. */
  meta.buyCosmetic = function (type, id, charId) {
    const t = normType(type), it = cosItem(t, id); if (!it) return false;
    if (t === 'skins' && charId != null && !charOk(charId)) return false;
    if (meta.owns(t, id, charId)) return true;
    const ep = effPrice(t, it), price = ep.price, cur = ep.cur;
    if (!debit(cur, price)) return false;
    const s = S();
    if (t === 'skins') { const c = charOr(charId); (s.owned.skins[c] = s.owned.skins[c] || []).push(id); s.stats.skinsBought++; }
    else { s.owned[t].push(id); s.stats.styleBought++; }
    if (cur === 'gems') s.stats.gemCos++;
    if (ep.off) s.stats.dealsBought = num0(s.stats.dealsBought) + 1;
    equipRaw(t, id, charId);
    checkMissions(false);
    persist(true);
    FM.emit('meta:buy', { type: t, id, charId: t === 'skins' ? charOr(charId) : null, price, cur, off: ep.off, base: ep.base, rar: rarOf(it) });
    FM.emit('meta:change', { reason: 'buy', type: t, id });
    return true;
  };
  /* ---------------- karakter açma (Türk tiplemeleri) ----------------
     Klan karakterleri ücretsiz. Tiplemeler bir kez açılır: altınla (FM.CH[id].price) ya da elmasla (FM.CH[id].gems).
     Güç farkı yok (herkes eşit); açılan şey yeni karakter, yeni özel güç ve görünüştür. */
  meta.ownsChar = function (id) { return !!(FM.chOwned && FM.chOwned(id, S())); };
  /** charPrice(id) → null (ücretsiz/geçersiz) ya da {coins, gems} */
  meta.charPrice = function (id) {
    const c = FM.CH && FM.CH[id];
    if (!c || !FM.chPaid(id)) return null;
    return { coins: Math.floor(num0(c.price)), gems: Math.floor(num0(c.gems)) };
  };
  /** buyChar(id, 'coins'|'gems') → true (açıldı ya da zaten açık) / false (geçersiz ya da bakiye yetersiz). Açılan karakter seçilir. */
  meta.buyChar = function (id, cur) {
    if (!charOk(id)) return false;
    if (meta.ownsChar(id)) return true;
    const p = meta.charPrice(id); if (!p) return false;
    cur = cur === 'gems' ? 'gems' : 'coins';
    const n = p[cur]; if (!(n > 0)) return false;
    if (!debit(cur, n)) return false;
    const s = S();
    s.owned.chars.push(id);
    s.selChar = id;
    checkMissions(false);
    persist(true);
    FM.emit('meta:buy', { type: 'char', id, charId: id, price: n, cur, off: 0, base: n, rar: 'l' });
    FM.emit('meta:change', { reason: 'buy', type: 'char', id });
    return true;
  };
  function equipRaw(t, id, charId) {
    const s = S();
    if (t === 'skins') s.equipped.skin[charOr(charId)] = id;
    else if (EQ_KEY[t]) s.equipped[EQ_KEY[t]] = id;
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
  /** equipped(type, charId) → kuşanılan öğenin id'si (her zaman geçerli bir id; tür geçersizse null) */
  meta.equipped = function (type, charId) {
    const t = normType(type), s = S();
    if (t === 'skins') { const c = charOr(charId), id = s.equipped.skin[c]; return id && meta.owns('skins', id, c) ? id : 'klasik'; }
    if (!t) return null;
    const id = s.equipped[EQ_KEY[t]];
    return cosItem(t, id) && meta.owns(t, id) ? id : defId(t);
  };
  /** loadout(charId) → {skin, trail, plate, hat, win, death}: yarışçıya kopyalanacak kuşanılan kozmetikler (game.js / netgame.js / net.js profili) */
  meta.loadout = function (charId) {
    const c = charOr(charId);
    return { skin: meta.equipped('skins', c), trail: meta.equipped('trails'), plate: meta.equipped('plates'), hat: meta.equipped('hats'), win: meta.equipped('wins'), death: meta.equipped('deaths') };
  };
  /** Öğe görünümü (mağaza kartı): katalog alanları + {type, price (bugünkü), base, off, cur, rar, rarN, rarCol, owned, equipped, can} */
  function cosView(t, x, charId, eq) {
    const owned = meta.owns(t, x.id, charId), ep = effPrice(t, x), rr = rarOf(x);
    return Object.assign({}, x, { type: t, price: ep.price, base: ep.base, off: ep.off, cur: ep.cur, rar: rr, rarN: RARITY[rr].n, rarCol: RARITY[rr].col,
      owned, equipped: x.id === eq, can: owned || S()[ep.cur] >= ep.price });
  }
  /** cosmetics(type, charId) → [{id, n, d, price, base, off, cur, rar, rarN, rarCol, owned, equipped, can, ...}] (mağaza listesi; katalog sırası) */
  meta.cosmetics = function (type, charId) {
    const t = normType(type); if (!t) return [];
    const eq = meta.equipped(t, charId);
    return cosList(t).map(x => cosView(t, x, charId, eq));
  };
  /** cosmetic(type, id, charId) → tek öğe görünümü | null */
  meta.cosmetic = function (type, id, charId) {
    const t = normType(type), it = cosItem(t, id); if (!it) return null;
    return cosView(t, it, charId, meta.equipped(t, charId));
  };
  /** Sahiplik özeti: {owned, total, pct} (tüm türler; skins 7 karakter × ücretli görünüm) */
  meta.collection = function () {
    const s = S(), owned = ownedSkinCount(s) + ownedStyleCount(s), total = totalSkins() + totalStyle();
    return { owned, total, pct: total ? Math.round(100 * owned / total) : 0 };
  };

  /* ---------------- GÜNÜN VİTRİNİ (günlük değişen mağaza) ----------------
     Tarihe göre deterministik (FM.mulberry32 + gün tohumu): aynı gün herkes aynı 6 öğeyi görür.
     Dizilim: [efsanevi|destansı, destansı, nadir, nadir, sıradan, sıradan]; türler olabildiğince farklı; bir öğe %30 indirimli. */
  const SHOP_SLOTS = ['L', 'e', 'r', 'r', 'c', 'c'];   // 'L' = %50 efsanevi, değilse destansı
  const SHOP_OFF = 30;
  function discounted(base, cur, off) {
    const v = base * (1 - off / 100);
    return cur === 'gems' ? Math.max(1, Math.round(v)) : Math.max(10, Math.round(v / 10) * 10);
  }
  function shopPool() {
    const out = [];
    for (const t of FM.COS_TYPES || ['skins', 'trails', 'plates', 'hats', 'wins', 'deaths']) for (const it of cosList(t)) if (num0(it.price) > 0) out.push({ type: t, it });
    return out;
  }
  function genShop(day) {
    const rng = FM.mulberry32((daySeed(day) * 2246822519 + 0x51A7E) >>> 0);
    const pool = shopPool(), used = [], usedTypes = [];
    for (const slot of SHOP_SLOTS) {
      let rar = slot === 'L' ? (rng() < 0.5 ? 'l' : 'e') : slot;
      let cand = [];
      for (let tries = 0; tries < 4 && !cand.length; tries++) {
        cand = pool.filter(p => rarOf(p.it) === rar && used.indexOf(p) < 0 && (tries > 0 || usedTypes.indexOf(p.type) < 0));
        if (!cand.length && tries === 1) rar = rar === 'l' ? 'e' : rar === 'e' ? 'r' : rar === 'r' ? 'c' : 'r';
      }
      if (!cand.length) cand = pool.filter(p => used.indexOf(p) < 0);
      if (!cand.length) break;
      const p = cand[Math.min(cand.length - 1, Math.floor(rng() * cand.length))];
      used.push(p); usedTypes.push(p.type);
    }
    const offIdx = used.length ? Math.floor(rng() * used.length) : -1;
    return used.map((p, i) => ({ type: p.type, id: p.it.id, off: i === offIdx ? SHOP_OFF : 0 }));
  }
  let shopDay = '', shopList = [];
  function ensureShop() { const k = todayKey(); if (shopDay !== k) { shopDay = k; shopList = genShop(k); } return shopList; }
  function shopEntry(t, id) { for (const e of ensureShop()) if (e.type === t && e.id === id) return e; return null; }
  /** dailyShop(charId) → {day, items:[{type, typeN, id, n, d, rar, rarN, rarCol, base, price, cur, off, owned, equipped, can, featured}], resetsIn (ms), resetsText}
      5-6 öğe; aynı gün herkese aynı; bir öğe %30 indirimli (off). Görünüm (skins) seçili karakter içindir. */
  meta.dailyShop = function (charId) {
    const list = ensureShop();
    const items = list.map((e, i) => {
      const it = cosItem(e.type, e.id); if (!it) return null;
      const v = cosView(e.type, it, charId, meta.equipped(e.type, charId));
      v.typeN = TYPE_INFO[e.type] ? TYPE_INFO[e.type].n : e.type; v.typeOne = TYPE_INFO[e.type] ? TYPE_INFO[e.type].one : e.type;
      v.featured = i === 0; v.slot = i;
      return v;
    }).filter(Boolean);
    return { day: shopDay, items, resetsIn: msToMidnight(), resetsText: meta.dailyResetText() };
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

  // Kaos: oyuncunun yakınına (≤ 260 px) düşen ve onu öldürmeyen meteor = kaçış (patlama 'meteor' olayından ÖNCE işlenir)
  FM.on('meteor', gameplay(d => {
    const P = FM.S.player;
    if (!live() || !P || P.ghost || P.out || P.finished || P.dead > 0 || FM.S.gameMode !== 'chaos' || !isNum(d.x)) return false;
    if (Math.abs(P.x + (P.w || 28) / 2 - d.x) > 260) return false;
    st('meteorDodge'); bump('dodge', 1);
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
      const n = clampInt(res.n, 1, 10, Array.isArray(res.ranking) && res.ranking.length ? res.ranking.length : 4);
      const rank = clampInt(res.playerRank, 0, n - 1, n - 1);
      const mode = typeof res.mode === 'string' ? res.mode : 'classic';
      const fin = !!P.finished;
      // Altın Avı'nda sıra altına göre, Elemede elenme sırasına göre: bitirmemek orada "yarım ödül" sebebi değil
      const ranked = fin || mode === 'coins' || (mode === 'elim' && (rank === 0 || !!P.out));
      const kills = clampInt(P.kills, 0, 999, 0), coinsGot = clampInt(P.coins, 0, 9999, 0), deaths = clampInt(P.deaths, 0, 999, 0);
      const clean = fin && deaths === 0;
      const win = rank === 0 && (fin || mode === 'coins' || (mode === 'elim' && !P.out));
      const top2 = rank <= 1 && ranked && (fin || mode === 'coins' || mode === 'elim');
      const cid = charOr(P.id);
      const mp = !!res.mp;
      let humans = 1;
      if (mp && Array.isArray(res.ranking)) humans = res.ranking.filter(r => r && (r.ctrl === 'local' || (r.ctrl === 'remote' && !r.nbot))).length || 1;
      const themeId = res.theme && typeof res.theme.id === 'string' ? res.theme.id : '';

      // istatistikler + günlük sayaçlar
      st('races'); stMap('charRaces', cid);
      if (fin) { st('finishes'); bump('finish', 1); bump('fchar', 1, cid); }
      if (win) { st('wins'); stMap('charWins', cid); bump('win', 1); stt.winStreak++; stt.bestStreak = Math.max(stt.bestStreak, stt.winStreak); }
      else stt.winStreak = 0;
      if (top2) { st('top2'); bump('top2', 1); }
      if (clean) { st('clean'); bump('clean', 1); }
      const rt = num0(FM.S.raceT); st('time', Math.round(rt));
      // mod / harita / çok oyunculu sayaçları
      if (FM.modeById && FM.modeById(mode)) stMap('modeRaces', mode);
      if (themeId && FM.themeIndex && FM.themeIndex(themeId) >= 0) stMap('themeRaces', themeId);
      if (mp) {
        st('mpRaces'); bump('mp', 1);
        if (win) st('mpWins');
        if (rank <= 2) st('mpTop3');
        if (kills) st('mpKills', kills);
      }
      // profil: kafa kafaya (yalnızca çok oyunculu, gerçek insanlara karşı), ulaşılan en yüksek kupa, lig değişimi
      if (mp) recordH2h(res.ranking, P, rank);
      const trNow = totalTrophies(s), lgNow = leagueOf(trNow), lgPrev = leagueOf(trSeen);
      trSeen = trNow;
      if (trNow > num0(stt.trBest)) stt.trBest = trNow;
      if (mode === 'elim') { if (rank <= 2) { st('elimTop3'); bump('elimtop3', 1); } if (win) st('elimWins'); }
      if (mode === 'coins') { if (coinsGot > num0(stt.coinsBest)) stt.coinsBest = coinsGot; if (coinsGot) bump('huntcoin', coinsGot); if (win) st('coinsWins'); }
      if (fin && mode === 'classic' && num0(P.ftime) > 0 && res.theme && res.theme.id) {
        const b = stt.best[res.theme.id];
        if (!isNum(b) || P.ftime < b) stt.best[res.theme.id] = Math.round(P.ftime * 100) / 100;
      }

      // ödül dökümü
      const lines = [];
      const pc = Math.round(placeVal(PLACE_COINS, rank, n) * (ranked ? 1 : DNF_MUL));
      const placeTxt = ranked ? `${rank + 1}. oldun` + (n !== 4 ? ` (${n} kişi)` : '') : `Bitiremedin (${rank + 1}. sıra)`;
      lines.push(line(placeTxt, pc, 'coins', ['🥇', '🥈', '🥉'][rank] || '🏅'));
      if (coinsGot > 0) {
        // Altın Avı'nda yarışta 100-250 altın toplanabiliyor → ekonomi dengesi için değer düşük ve tavanlı
        const cv = mode === 'coins' ? Math.min(HUNT_CAP, Math.round(coinsGot * HUNT_VALUE)) : coinsGot * COIN_VALUE;
        lines.push(line(`Toplanan altın ×${coinsGot}`, cv, 'coins', '🪙'));
      }
      if (mp && humans >= 2) lines.push(line(`Arkadaşlarla yarış (${humans} kişi)`, Math.min(MP_BONUS_CAP, MP_BONUS + MP_BONUS_PER * (humans - 2)), 'coins', '🤝'));
      if (kills > 0) lines.push(line(`Patlatılan rakip ×${kills}`, Math.min(kills, KILL_COINS_CAP) * KILL_COINS, 'coins', '💥'));
      if (fin) lines.push(line('Bitiş bonusu', FINISH_COINS, 'coins', '🏁'));
      if (clean) lines.push(line('Kusursuz yarış (hiç ölmedin)', CLEAN_COINS, 'coins', '😇'));
      if (win && stt.winStreak >= 2) lines.push(line(`Galibiyet serisi ×${stt.winStreak}`, Math.min(STREAK_CAP, STREAK_COINS * (stt.winStreak - 1)), 'coins', '🔥'));
      let xp = Math.round(placeVal(PLACE_XP, rank, n) * (ranked ? 1 : DNF_MUL));
      if (mp && humans >= 2) xp += MP_XP;
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
        kills, coinsGot, deaths, char: cid, last: !!res.last, level: meta.levelInfo(), n, mode, mp, humans, win,
        league: { id: lgNow.id, n: lgNow.n, col: lgNow.col, tr: trNow, up: lgNow.idx > lgPrev.idx, down: lgNow.idx < lgPrev.idx }
      };
      raceDone = [];
      matchTotals.coins += out.coins; matchTotals.gems += out.gems; matchTotals.xp += out.xp; matchTotals.races++;
      out.matchTotals = Object.assign({}, matchTotals);
      meta.lastRewards = out; meta.lastRaceRewards = out;
      persist();
      FM.emit('meta:rewards', { rewards: out, kind: 'race' });
      FM.emit('meta:change', { reason: 'race' });
      if (out.league.up) FM.emit('meta:league', { league: lgNow, prev: lgPrev, up: true });     // lige yükseldi (arayüz kutlayabilir)
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
      if (FM.S.netRole) { st('mpMatches'); if (champ) st('mpChamps'); }
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
     PROFİL: OYNAMA SÜRESİ, LİG, KAFA KAFAYA, PROFİL KARTI
     ===================================================================== */
  let trSeen = 0;           // son yarış sonunda (ya da kayıt yüklenince) görülen toplam kupa: lige yükselişi bulmak için
  let lastTick = Date.now(), lastInput = Date.now(), playPend = 0, playSavedAt = Date.now(), playDirty = false;

  function pageHidden() { try { return typeof document !== 'undefined' && !!document && document.hidden === true; } catch (e) { return false; } }
  /** Yarış sürüyor mu (geri sayım / yarış / tur sonu; duraklatılmış yarış sayılmaz) */
  function racing() { const M = FM.S; return !!M && !M.paused && (M.mode === 'count' || M.mode === 'race' || M.mode === 'end'); }

  /** [son sayım, şimdi] aralığını oynama süresine ekler: sayfa GÖRÜNÜRKEN ve (yarış sürüyor YA DA son 90 sn'de etkileşim var).
      Yalnızca TAM saniyeler stats.playSec'e yazılır, kesir bellekte kalır. visible verilmezse sayfanın şimdiki durumu. */
  function playAccount(visible) {
    const t = Date.now();
    const dt = (t - lastTick) / 1000;
    lastTick = t;
    if (!(dt > 0)) return 0;                                   // saat geri alındı / aynı ms
    if (visible === undefined) visible = !pageHidden();
    if (!visible || !FM.save || !isObj(FM.save.stats)) return 0;
    if (!(racing() || t - lastInput <= PLAY_IDLE_MS)) return 0;
    playPend += Math.min(dt, PLAY_MAX_DT);                     // uyku / kısılmış zamanlayıcı yüzünden dev sıçrama eklenmez
    const w = Math.floor(playPend);
    if (w < 1) return 0;
    playPend -= w;
    const st = FM.save.stats;
    st.playSec = Math.min(1e12, num0(st.playSec) + w);
    playDirty = true; dirty = true;
    return w;
  }
  /** Toplam oynama süresi (sn). Çağrıldığı an sayacı da günceller. */
  meta.playTime = function () { try { playAccount(); } catch (e) { } return Math.floor(num0(S().stats && S().stats.playSec)); };
  /** Süreyi kısa Türkçe yazar: 45 → "45 sn", 750 → "12 dk", 45000 → "12 sa 30 dk", 7200 → "2 sa" */
  meta.fmtDur = function (sec) {
    sec = Math.floor(num0(sec));
    if (sec < 60) return sec + ' sn';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' dk';
    const h = Math.floor(m / 60), mm = m % 60;
    return fmt(h) + ' sa' + (mm ? ' ' + mm + ' dk' : '');
  };

  function onInput() {
    const t = Date.now();
    // uzun boşluktan sonraki ilk etkileşim: boşta geçen aralık sayılmasın
    if (t - lastInput > PLAY_IDLE_MS && !racing()) lastTick = t;
    lastInput = t;
  }
  /** Her PLAY_TICK_MS'de: süreyi topla, kaydı seyrek yaz (30 sn), kart değiştiyse bildir. */
  function profileTick() {
    try {
      playAccount();
      const t = Date.now();
      if (playDirty && t - playSavedAt >= PLAY_SAVE_MS) { playSavedAt = t; playDirty = false; persist(); }
      cardCheck();
    } catch (e) { }
  }
  /** Sayfa gizlenirken / kapanırken son görünür aralığı ekle ve HEMEN yaz (core.js'in yazımı bu eklemeden önce çalışmış olabilir). */
  function playFlush() {
    try { playAccount(true); playSavedAt = Date.now(); playDirty = false; persist(true); } catch (e) { }
  }

  /* ---------------- lig ---------------- */
  /** league(tr?) → {id:'bronz'|'gumus'|'altin'|'elmas'|'efsane', n, col, min, next (sonraki ligin kupası | null), nextN, idx, pct (0..1 ilerleme)}.
      tr verilmezse kendi toplam kupan. Başkasının kartındaki kupayla da çağrılabilir: FM.meta.league(card.tr). */
  meta.league = function (tr) { return leagueOf(tr == null ? totalTrophies(S()) : tr); };
  meta.LEAGUES = LEAGUES.map(l => Object.assign({}, l));
  /** Toplam kupa (7 karakterin toplamı) */
  meta.totalTrophies = function () { return totalTrophies(S()); };

  /* ---------------- kafa kafaya (yalnızca çok oyunculu, gerçek insanlara karşı) ---------------- */
  /** race:end: sıralamada kendinden önce/sonra biten her İNSAN için w/l artır. Botlar (bot/nbot), izleyiciler ve kopanlar sayılmaz. */
  function recordH2h(rk, P, rank) {
    if (!Array.isArray(rk) || !P) return;
    let me = rk.indexOf(P); if (me < 0) me = rank;
    const sv = S(); if (!isObj(sv.h2h)) sv.h2h = {};
    const H = sv.h2h, t = Date.now(); let any = false;
    for (let i = 0; i < rk.length; i++) {
      const r = rk[i];
      if (!r || r === P || i === me) continue;
      if (r.ctrl !== 'remote' || r.nbot || r.bot || r.ghost || r.off || r.spec) continue;
      const pid = r.pid;
      if (typeof pid !== 'string' || !PID_RE.test(pid) || pid === sv.pid || pid === P.pid) continue;
      const e = H[pid] || (H[pid] = { nick: '', w: 0, l: 0, t: 0 });
      if (me < i) e.w = Math.min(1e6, num0(e.w) + 1); else e.l = Math.min(1e6, num0(e.l) + 1);
      e.nick = cleanNick(r.nick || r.name) || e.nick || 'Oyuncu';
      e.t = t; any = true;
    }
    if (any) trimH2h(H);
  }
  /** h2h() → {pid: {nick, w, l, t}} (w = onu geçtiğin, l = seni geçtiği yarış sayısı; t = son yarış ms). h2h(pid) → tek kayıt | null. */
  meta.h2h = function (pid) {
    const H = S().h2h, out = {};
    if (isObj(H)) for (const k of Object.keys(H)) { const e = H[k]; if (isObj(e)) out[k] = { nick: e.nick, w: e.w | 0, l: e.l | 0, t: e.t || 0 }; }
    return pid === undefined ? out : (out[pid] || null);
  };

  /* ---------------- profil kartı ---------------- */
  /** En çok yarışılan karakter (eşitlikte seçili karakter, yarış yoksa seçili karakter) */
  function bestChar(sv) {
    const m = sv.stats && sv.stats.charRaces, sel = charOr(sv.selChar);
    let best = '', bn = 0;
    for (const k of FM.ORDER) {
      const n = isObj(m) ? num0(m[k]) : 0;
      if (n > bn || (n === bn && n > 0 && k === sel)) { best = k; bn = n; }
    }
    return best || sel;
  }
  /** card() → {nick, char, skin, hat, lvl, tr, play, races, wins, kills, best, since, lg}. Hepsi düz JSON sayı/metin (ağda paylaşılır).
      tr = toplam kupa, play = oynama sn, best = en çok yarışılan karakter, since = ilk oynama ms, lg = lig id'si, hat = kuşanılan aksesuar (Mağaza 2.0). */
  meta.card = function () {
    const sv = S(), st = isObj(sv.stats) ? sv.stats : {}, ch = charOr(sv.selChar), tr = totalTrophies(sv);
    return {
      nick: cleanNick(sv.nick) || ch, char: ch, skin: meta.equipped('skins', ch), hat: meta.equipped('hats'), lvl: clampInt(sv.level, 1, MAX_LEVEL, 1), tr,
      play: meta.playTime(), races: Math.floor(num0(st.races)), wins: Math.floor(num0(st.wins)), kills: Math.floor(num0(st.kills)),
      best: bestChar(sv), since: Math.floor(num0(sv.since)), lg: leagueOf(tr).id
    };
  };
  /* 'meta:card' yalnızca kart DEĞİŞİNCE ve en sık ~1 sn'de bir yayınlanır. Oynama süresi dakikaya yuvarlanarak karşılaştırılır
     (sürekli artan sayı kartı her saniye değiştirmesin; AĞ kartı en fazla dakikada bir yeniden yayınlar). */
  let cardSig = null, cardLast = 0, cardTimer = null;
  function cardSigOf(c) { return [c.nick, c.char, c.skin, c.hat, c.lvl, c.tr, Math.floor(c.play / 60), c.races, c.wins, c.kills, c.best, c.since, c.lg].join('|'); }
  function cardCheck(force) {
    let c; try { c = meta.card(); } catch (e) { return; }
    const sig = cardSigOf(c);
    if (sig === cardSig) return;
    const t = Date.now();
    if (!force && cardSig !== null && t >= cardLast && t - cardLast < CARD_MIN_MS) {          // çok sık: kısa süre sonra yeniden bak
      if (!cardTimer && typeof setTimeout === 'function') cardTimer = setTimeout(() => { cardTimer = null; cardCheck(); }, CARD_MIN_MS - (t - cardLast) + 30);
      return;
    }
    cardSig = sig; cardLast = t;
    FM.emit('meta:card', { card: c });
  }
  meta._cardCheck = cardCheck;
  // kart değiştiren her şey zaten meta:change yayınlar (yarış sonu, seviye, kostüm/kuşanma, satın alma, içe aktarma). Karakter seçimi (ui.js) olay
  // yayınlamıyor: bu yüzden periyodik sayımda (3 sn) imza karşılaştırılır.
  FM.on('meta:change', () => cardCheck());
  FM.on('meta:levelup', () => cardCheck());
  FM.on('save:reset', () => { trSeen = totalTrophies(S()); cardCheck(); });

  try {
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      for (const ev of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']) window.addEventListener(ev, onInput, { passive: true, capture: true });
      window.addEventListener('pagehide', playFlush);
    }
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) playFlush(); else { lastTick = Date.now(); } });
    }
  } catch (e) { }

  /* =====================================================================
     ÇOK OYUNCULU İSTATİSTİK
     ===================================================================== */
  /** mpStats() → {races, wins, top3, matches, champs, kills, winPct, byMode: {modId: yarış}, byTheme: {temaId: yarış}} */
  meta.mpStats = function () {
    const t = S().stats;
    return {
      races: num0(t.mpRaces), wins: num0(t.mpWins), top3: num0(t.mpTop3), matches: num0(t.mpMatches), champs: num0(t.mpChamps), kills: num0(t.mpKills),
      winPct: num0(t.mpRaces) > 0 ? Math.round(100 * num0(t.mpWins) / t.mpRaces) : 0,
      byMode: Object.assign({}, t.modeRaces), byTheme: Object.assign({}, t.themeRaces)
    };
  };

  /* =====================================================================
     KAYIT AKTARMA (telefon / tarayıcı değiştirme)
     Uzun kod: tamamen çevrimdışı. Bulut kodu: herkese açık MQTT aracısında retain'li konu (en iyi çaba).
     İçe aktarmada mevcut kayıt localStorage'a yedeklenir; pid (çok oyunculu kimlik) ve cihaz ayarları korunur.
     ===================================================================== */
  const XKEY_BACKUP = 'fuatmorel_save_v2_yedek', XKEY_BACKUP2 = 'fuatmorel_save_v2_yedek_onceki';
  const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CLOUD_ROOT = 'fuatmorel/v1/save/';
  const CLOUD_BROKERS = ['wss://test.mosquitto.org:8081/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const CLOUD_WARN = 'Bulut kodu herkese açık ücretsiz bir sunucuda durur: genelde günlerce çalışır ama sunucu sıfırlanırsa silinebilir. Garanti için uzun kodu da bir yere kaydet.';
  const bad = err => ({ ok: false, err });

  const enc = s => new TextEncoder().encode(s);
  const dec = u => new TextDecoder().decode(u);
  function b64u(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    let b = str.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    const bin = atob(b), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function';
  function zpipe(u8, T) { return new Response(new Blob([u8]).stream().pipeThrough(new T('gzip'))).arrayBuffer().then(b => new Uint8Array(b)); }
  function rndCode(n) {
    let out = '';
    try {
      const a = new Uint8Array(n); crypto.getRandomValues(a);
      for (let i = 0; i < n; i++) out += CODE_ALPHA[a[i] & 31];
      return out;
    } catch (e) { }
    for (let i = 0; i < n; i++) out += CODE_ALPHA[(Math.random() * 32) | 0];
    return out;
  }

  function exportObj() {
    const c = JSON.parse(JSON.stringify(S()));
    delete c.pid;          // çok oyunculu kimlik cihaza özel (iki cihaz aynı pid → odada 'dup')
    delete c.settings;     // ses / kalite ayarları cihaza özel
    return { fm: 'fuatmorel', v: 1, t: Date.now(), s: c };
  }
  /** exportCode() → Promise<string|null>: 'FM1.<gzip+base64url>.<sağlama>' (CompressionStream yoksa 'FM0.' sıkıştırmasız). Asla reddetmez. */
  meta.exportCode = function () {
    let raw;
    try { playAccount(); flush(); raw = enc(JSON.stringify(exportObj())); } catch (e) { return Promise.resolve(null); }
    const plain = () => { const b = 'FM0.' + b64u(raw); return b + '.' + fnv(b); };
    if (!canZip()) { try { return Promise.resolve(plain()); } catch (e) { return Promise.resolve(null); } }
    return zpipe(raw, CompressionStream).then(z => { const b = 'FM1.' + b64u(z); return b + '.' + fnv(b); }).catch(() => { try { return plain(); } catch (e) { return null; } });
  };
  function checkObj(o) {
    if (!isObj(o) || o.fm !== 'fuatmorel' || !isObj(o.s)) return bad('Bu bir Fuat Morel kayıt kodu değil.');
    let ns = null;
    try { ns = FM.normSave(JSON.parse(JSON.stringify(o.s))); } catch (e) { ns = null; }
    if (!ns) return bad('Kayıt okunamadı (bozuk).');
    return { ok: true, save: ns, t: isNum(o.t) ? o.t : 0 };
  }
  /** Uzun kodu çözer → Promise<{ok, save, t} | {ok:false, err}> */
  function decodeCode(str) {
    const t = String(str == null ? '' : str).replace(/\s+/g, '');
    const m = /^(FM[01])\.([A-Za-z0-9_-]+)\.([0-9a-z]+)$/.exec(t);
    if (!m) return Promise.resolve(bad('Kod tanınmadı. Kodun TAMAMINI kopyalayıp yapıştır.'));
    if (fnv(m[1] + '.' + m[2]) !== m[3]) return Promise.resolve(bad('Kod eksik ya da bozuk kopyalanmış. Tamamını yeniden kopyala.'));
    let u;
    try { u = unb64u(m[2]); } catch (e) { return Promise.resolve(bad('Kod bozuk.')); }
    let p;
    if (m[1] === 'FM1') { if (!canZip()) return Promise.resolve(bad('Bu tarayıcı sıkıştırılmış kodu açamıyor. Tarayıcını güncelle ya da Chrome kullan.')); p = zpipe(u, DecompressionStream); }
    else p = Promise.resolve(u);
    return p.then(raw => checkObj(JSON.parse(dec(raw)))).catch(() => bad('Kod açılamadı (bozuk).'));
  }
  function summary(sv, t) {
    sv = isObj(sv) ? sv : {};
    const st = isObj(sv.stats) ? sv.stats : {};
    // kupa sıfırlama göçünden geçmemiş (eski) kayıt/yedek uygulanınca kupaları 0 olacak: özet de 0 göstermeli
    const tr = sv.trReset === 1 ? totalTrophies(sv) : 0;
    let skins = 0; try { skins = ownedSkinCount(sv); } catch (e) { skins = 0; }
    return {
      nick: typeof sv.nick === 'string' ? sv.nick.slice(0, 14) : '', level: clampInt(sv.level, 1, MAX_LEVEL, 1),
      coins: clampInt(sv.coins, 0, MAX_BAL, 0), gems: clampInt(sv.gems, 0, MAX_BAL, 0), trophies: Math.round(tr),
      races: Math.floor(num0(st.races)), wins: Math.floor(num0(st.wins)), skins, play: Math.floor(num0(st.playSec)),
      savedAt: num0(t) || num0(sv.savedAt) || 0
    };
  }
  let pending = null;
  function preview(r, src) {
    const tok = { save: r.save, t: r.t, src };
    pending = tok;
    return { ok: true, src, preview: summary(r.save, r.t), current: summary(S(), S().savedAt), apply: () => meta.applyImport(tok) };
  }
  /** Bulut kodu biçimi: 8 karakter (tire/boşluk/küçük harf kabul) → 'ABCD2345' ya da null */
  function cloudCode(str) {
    const t = String(str == null ? '' : str).toUpperCase().replace(/[\s-]/g, '');
    if (t.length !== 8) return null;
    for (const ch of t) if (CODE_ALPHA.indexOf(ch) < 0) return null;
    return t;
  }
  meta.cloudCodeValid = s => !!cloudCode(s);

  /** importCode(metin) → Promise<{ok:true, src:'code'|'cloud', preview, current, apply()} | {ok:false, err}>.
      Uzun kodu da 8 karakterli bulut kodunu da kabul eder. HİÇBİR ŞEYİ DEĞİŞTİRMEZ: kullanıcıya preview/current
      (nick, level, coins, gems, trophies, races, wins, skins, play (sn), savedAt) gösterilip onaylanınca apply() çağrılır. */
  meta.importCode = function (str) {
    try {
      const t = String(str == null ? '' : str).trim();
      if (!/^FM[01]\./.test(t.replace(/\s+/g, ''))) { const cc = cloudCode(t); if (cc) return meta.cloudLoad(cc); }
      return decodeCode(t).then(r => r.ok ? preview(r, 'code') : r).catch(() => bad('Kod açılamadı.'));
    } catch (e) { return Promise.resolve(bad('Kod açılamadı.')); }
  };
  function writeBackup(cur) {
    try {
      const prev = localStorage.getItem(XKEY_BACKUP);
      if (prev) localStorage.setItem(XKEY_BACKUP2, prev);
      localStorage.setItem(XKEY_BACKUP, JSON.stringify({ t: Date.now(), s: cur }));
      return true;
    } catch (e) { return false; }
  }
  function installSave(ns, src) {
    const cur = S();
    ns = JSON.parse(JSON.stringify(ns));
    if (typeof cur.pid === 'string') ns.pid = cur.pid; else delete ns.pid;      // kimlik bu cihazınki kalır
    ns.settings = cur.settings;                                                 // cihaz ayarları korunur
    if (typeof ns.nick !== 'string' || !ns.nick) { ns.nick = cur.nick; ns.nickSet = cur.nickSet; }
    FM.save = ns;
    normalize(); ensureDay(true); checkMissions(true);
    S().stats.imports = num0(S().stats.imports) + 1;
    pending = null;
    persist(true);
    FM.emit('save:import', { src });
    FM.emit('save:reset', { import: true, src });    // arayüz/ağ yenilensin (meta da yeniden doğrular)
  }
  function busyRace() { const m = FM.S && FM.S.mode; return m === 'race' || m === 'count' || m === 'end'; }
  /** applyImport(tok?) → bool. tok verilmezse son önizleme. Önce mevcut kayıt yedeklenir (yedek yazılamazsa false). Yarışta false. */
  meta.applyImport = function (tok) {
    try {
      tok = tok || pending;
      if (!tok || !isObj(tok.save) || busyRace()) return false;
      if (!writeBackup(S())) return false;
      installSave(tok.save, tok.src || 'code');
      return true;
    } catch (e) { console.error('[meta import]', e); return false; }
  };
  /** backupInfo() → içe aktarmadan önceki kaydın özeti {nick, level, coins, gems, trophies, races, wins, skins, play, savedAt} ya da null */
  meta.backupInfo = function () {
    try { const o = JSON.parse(localStorage.getItem(XKEY_BACKUP) || 'null'); return isObj(o) && isObj(o.s) ? summary(o.s, o.t) : null; } catch (e) { return null; }
  };
  /** restoreBackup() → bool: yedeği geri yükler (şimdiki kayıt da yedeğe geçer — geri alınabilir). */
  meta.restoreBackup = function () {
    try {
      if (busyRace()) return false;
      const o = JSON.parse(localStorage.getItem(XKEY_BACKUP) || 'null');
      if (!isObj(o) || !isObj(o.s)) return false;
      const ns = FM.normSave(JSON.parse(JSON.stringify(o.s)));
      if (!ns) return false;
      if (!writeBackup(S())) return false;
      installSave(ns, 'backup');
      return true;
    } catch (e) { return false; }
  };

  /* ---------- bulut: tek seferlik minimal MQTT 3.1.1 oturumu (net.js'ten bağımsız, oda bağlantısını etkilemez) ---------- */
  function mqLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
  function mqStr(u) { const o = new Uint8Array(2 + u.length); o[0] = u.length >> 8; o[1] = u.length & 255; o.set(u, 2); return o; }
  function mqPkt(h, parts) {
    let n = 0; for (const p of parts) n += p.length;
    const L = mqLen(n), out = new Uint8Array(1 + L.length + n);
    out[0] = h; out.set(L, 1); let o = 1 + L.length;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  /** Bağlan → konuya abone ol → body varsa retain'li yayınla ve yankısını bekle (= aracı aldı); yoksa retain'li mesajı bekle.
      → Promise<string|null> (asla reddetmez) */
  function mqOnce(url, topic, body, ms) {
    return new Promise(resolve => {
      let ws = null, done = false, buf = new Uint8Array(0), quiet = null, tm = null;
      const fin = v => {
        if (done) return; done = true; clearTimeout(tm); clearTimeout(quiet);
        try { if (ws && ws.readyState === 1) ws.send(new Uint8Array([0xE0, 0])); } catch (e) { }
        try { if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; ws.onerror = function () { }; ws.close(); } } catch (e) { }
        resolve(v);
      };
      tm = setTimeout(() => fin(null), ms);
      try { ws = new WebSocket(url, ['mqtt']); ws.binaryType = 'arraybuffer'; } catch (e) { fin(null); return; }
      ws.onerror = () => fin(null);
      ws.onclose = () => fin(null);
      ws.onopen = () => {
        try { ws.send(mqPkt(0x10, [mqStr(enc('MQTT')), new Uint8Array([4, 0x02, 0, 30]), mqStr(enc('fmk' + rndCode(10).toLowerCase()))])); } catch (e) { fin(null); }
      };
      ws.onmessage = ev => {
        try {
          if (done || typeof ev.data === 'string' || !ev.data) return;
          const u = new Uint8Array(ev.data), c = new Uint8Array(buf.length + u.length);
          c.set(buf, 0); c.set(u, buf.length); buf = c;
          for (;;) {
            if (buf.length < 2) break;
            let len = 0, mul = 1, i = 1, ok = false;
            for (let k = 0; k < 4 && i < buf.length; k++) { const b = buf[i++]; len += (b & 127) * mul; mul *= 128; if (!(b & 128)) { ok = true; break; } }
            if (!ok) { if (i >= 5) { fin(null); return; } break; }
            if (buf.length < i + len) break;
            const h = buf[0], b = buf.subarray(i, i + len);
            buf = buf.slice(i + len);
            const type = h >> 4;
            if (type === 2) {                                        // CONNACK → abone ol
              if (b.length < 2 || b[1] !== 0) { fin(null); return; }
              ws.send(mqPkt(0x82, [new Uint8Array([0, 1]), mqStr(enc(topic)), new Uint8Array([0])]));
            } else if (type === 9) {                                 // SUBACK → yaz ya da retain'i bekle
              if (body != null) ws.send(mqPkt(0x31, [mqStr(enc(topic)), enc(body)]));
              else quiet = setTimeout(() => fin(null), 3500);
            } else if (type === 3 && b.length >= 2) {                // PUBLISH
              const qos = (h >> 1) & 3, tl = (b[0] << 8) | b[1];
              if (dec(b.subarray(2, 2 + tl)) !== topic) continue;
              const txt = dec(b.subarray(2 + tl + (qos > 0 ? 2 : 0)));
              if (body == null) { fin(txt || null); return; }
              if (txt === body) { fin(txt); return; }
            }
          }
        } catch (e) { fin(null); }
      };
    });
  }
  /** cloudSave() → Promise<{ok:true, code:'ABCD2345', text:'ABCD-2345', warn, servers} | {ok:false, err}>. Asla reddetmez.
      Kayıt 3 aracıya birden yazılır (en az biri onaylarsa başarılı). Son kod FM.save.cloud = {code, t}. */
  meta.cloudSave = function () {
    if (typeof WebSocket !== 'function') return Promise.resolve(bad('Bu tarayıcı bulut kodunu desteklemiyor. Uzun kodu kullan.'));
    return meta.exportCode().then(body => {
      if (!body) return bad('Kayıt hazırlanamadı.');
      const code = rndCode(8), topic = CLOUD_ROOT + code;
      return new Promise(resolve => {
        let left = CLOUD_BROKERS.length, okN = 0, grace = null, sent = false;
        const end = () => {
          if (sent) return; sent = true; clearTimeout(grace);
          if (!okN) { resolve(bad('Sunucuya ulaşılamadı. İnternetini kontrol et ya da uzun kodu kullan.')); return; }
          try { S().cloud = { code, t: Date.now() }; persist(true); } catch (e) { }
          resolve({ ok: true, code, text: code.slice(0, 4) + '-' + code.slice(4), warn: CLOUD_WARN, servers: okN });
        };
        for (const u of CLOUD_BROKERS) {
          mqOnce(u, topic, body, 9000).then(v => {
            left--; if (v === body) { okN++; if (!grace) grace = setTimeout(end, 2500); }
            if (!left) end();
          });
        }
      });
    }).catch(() => bad('Bulut kaydı başarısız. Uzun kodu kullan.'));
  };
  /** cloudLoad(kod) → Promise<importCode ile aynı sonuç (önizleme + apply())>. Asla reddetmez. */
  meta.cloudLoad = function (code) {
    const c = cloudCode(code);
    if (!c) return Promise.resolve(bad('Bulut kodu 8 karakter olmalı (ör. ABCD-2345).'));
    if (typeof WebSocket !== 'function') return Promise.resolve(bad('Bu tarayıcı bulut kodunu desteklemiyor. Uzun kodu kullan.'));
    return new Promise(resolve => {
      let left = CLOUD_BROKERS.length, sent = false;
      for (const u of CLOUD_BROKERS) {
        mqOnce(u, CLOUD_ROOT + c, null, 8000).then(v => {
          left--;
          if (sent) return;
          if (v) { sent = true; resolve(v); } else if (!left) { sent = true; resolve(null); }
        });
      }
    }).then(body => {
      if (!body) return bad('Bu kodla kayıt bulunamadı. Kodun süresi dolmuş olabilir; uzun kodu dene.');
      return decodeCode(body).then(r => r.ok ? preview(r, 'cloud') : r);
    }).catch(() => bad('Bulut kaydı okunamadı.'));
  };
  meta._decodeCode = decodeCode;

  /* =====================================================================
     AÇILIŞ
     ===================================================================== */
  // dışa açık tanımlar (UI ve test için, salt okunur kopyalar)
  meta.DAILY_POOL = DAILY.map(t => Object.assign({}, t));
  meta.ACHIEVEMENTS = ACH.map(a => ({ key: a.key, icon: a.icon, t: a.t, tiers: a.tiers.slice() }));
  meta.START_ITEMS = START_ITEMS.slice();
  meta.LOGIN_REWARDS = loginRewards();
  meta.COS_TYPES = ['skins', 'hats', 'trails', 'plates', 'wins', 'deaths'];
  meta._genShop = genShop;
  meta.todayKey = todayKey;
  meta._normalize = normalize;
  meta._ensureDay = ensureDay;

  try {
    normalize();
    ensureDay(true);
    checkMissions(true);     // eski kayıtta zaten tamamlanmış olanları sessizce işaretle
    persist();
  } catch (e) { console.error('[meta init]', e); }
  try {
    trSeen = totalTrophies(S());
    lastTick = lastInput = playSavedAt = Date.now();
    if (typeof setInterval === 'function') setInterval(profileTick, PLAY_TICK_MS);
    // ilk kart bildirimi: AĞ, meta'dan önce yüklendiği için olayı kaçırmasın (kendisi de meta.card()'ı çağırabilir)
    if (typeof setTimeout === 'function') setTimeout(() => cardCheck(true), 1500);
  } catch (e) { console.error('[meta profil]', e); }
})(window.FM);

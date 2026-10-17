/* FUAT MOREL — game.js : fizik, eşyalar, özel güçler, yapay zekâ, yarış akışı. HİÇBİR ŞEY ÇİZMEZ. */
'use strict';
(function (FM) {
  const C = FM.C, S = FM.S, { clamp, ov } = FM;
  const cxOf = FM.cx, cyOf = FM.cy;
  const G = C.G, JUMP = C.JUMP, DJ = C.DJ, RUN = C.RUN, ACC = C.ACC, AIRACC = C.AIRACC, CLIMB = C.CLIMB, SLAM = C.SLAM, MUSH = C.MUSH, RW = C.RW, RH = C.RH, SH = C.SH;

  /* Oyuncu girdisi (klavye/dokunmatik bunları doldurur). jp/dp/use/ab "basıldı" darbeleri (game tüketir), jh/dh basılı tutma.
     Yönlü atış (docs/TUR5.md §2): aim = null | 'item' | 'ab' (nişan alınıyor), ax/ay = nişan birim vektörü (x sağa +, y aşağı +);
     (0,0) = varsayılan yön. Bırakınca use/ab = true ve aim = null; ax/ay son yönü tutar, darbe tüketilince sıfırlanır. */
  FM.input = { jh: false, jp: false, dh: false, dp: false, use: false, ab: false, aim: null, ax: 0, ay: 0 };

  const DEATH_ICON = { spikes: '🔺', crush: '⛓️', saw: '⚙️', water: '💧', chocolate: '🍫', icewater: '🧊', lava: '🔥', fall: '💧',
    quicksand: '⏳', plasma: '⚡', neon: '☢️', boulder: '🪨', meteor: '☄️' };
  // yeni seviye öğelerinin fizik sabitleri
  const TRAMP = 1400;              // trambolin fırlatma hızı (mantar 1250)
  const GEYSER = 1250;             // gayzer fırlatma hızı
  const LIFT = 5600, LIFT_MAX = 700; // rüzgâr bacası: yukarı ivme / en yüksek tırmanış hızı
  const LOWG = .55;                // düşük yerçekimi bölgesi çarpanı
  const DROP_LIFE = 12;            // Altın Avı: yere düşen altının ömrü (sn)
  const METEOR_WARN = 1.25, METEOR_R = 62;
  // ağda yalnızca ev sahibi (ya da tek oyunculu) dünya kararlarını verir: eleme, meteor, tur sonu
  const auth = () => S.netRole !== 'member';
  // Saldırı eşyaları: yarışın ilk START_LOCK saniyesinde kullanılamaz (start çizgisinde iç içe dizilmiş yarışçılara katliam olmasın)
  const ATTACK = { saw: 1, dyn: 1, trap: 1, mis: 1, bolt: 1, ice: 1, mag: 1, net: 1, ink: 1 };
  const START_LOCK = 3;
  const ASSIST_T = 2.5;            // saldırıdan sonra bu süre içinde çevreden ölürse öldürme saldırgana yazılır
  const DYN_MIN = 165, DYN_MAX = 365; // bot dinamiti öndekine bu mesafedeyken atar (yeni atış menziline göre)
  const post = () => S.mode === 'end' || S.mode === 'podium';   // tur bitti: kimse zarar görmez
  function clearInput() { const I = FM.input; if (I) { I.jp = I.dp = I.use = I.ab = false; if (!I.aim) I.ax = I.ay = 0; } }
  /* ---- yönlü atış sabitleri (gerçek varlıklar ve aimPreview AYNI değerleri kullanır) ---- */
  const AIM_ITEMS = { saw: 1, dyn: 1, trap: 1, net: 1, mis: 1 };           // yönlü eşyalar
  const AIM_ABS = { TAFTAF: 1, Caner: 1, Kral: 1, baso: 1, Nuss: 1, Teyze: 1 };      // yönlü özel güçler
  /* Türk tiplemeleri (FM.CH tag 'tipleme'):
     Almancı Dayı — Alman Arabası: CAR_T sn araba (r.car = kalan sn): yerde ×CAR_MUL hız, çevre tehlikelerine/tuzak/ağ/çamur/kuma
       bağışık (eşyalar yine vurur), dokunduğunu savurur; tek kısa zıplama (çift zıplama/kayma yok); duvara takılırsa ya da
       sersemletilirse araba biter; inişte 0.5 sn dokunulmazlık.
     Terlikli Teyze — Uçan Terlik: nişanlı, hedefi yumuşak izleyen terlik (dönüş hızı sınırlı → doğru anda zıplayan kaçar;
       hedefi geçerse izlemeyi bırakır), vurduğunu 1.5 sn sersemletir, bir kez en yakın ikinci rakibe seker.
     Simitçi Martı — Simit Kapma: öndeki (≤ STEAL_R px) eşyası olan en yakın rakibin eşyasını kapar ('steal'); kimsede eşya yoksa
       yerde yuvarlanan simit atar (çarptığını SIMIT_SLOW sn yavaşlatır; zıplanarak aşılır). */
  const CAR_T = 2, CAR_MUL = 1.35, CAR_KNOCK = 1, CAR_HOP = .8;
  const TERLIK_V = 680, TERLIK_TURN = 3, TERLIK_STUN = 1.5, TERLIK_LIFE = 2.6, TERLIK_R = 13;
  const SIMIT_V = 520, SIMIT_SLOW = 2.2, SIMIT_R = 16, STEAL_R = 900;
  const SAW_V = 560, DYN_V = 720, DYN_LOB = 240, TRAP_V = 560, TRAP_LOB = 220, NET_V = 600, NET_LOB = 260;
  // Kar Fırtınası: kısa hazırlık → atandan yayılan buz dalgası (ulaştığı herkes donar). Mürekkep: ileri fışkıran mürekkep cephesi
  const FROST_WIND = .22, FROST_SP = 1700, FROST_R = 1600, INK_SP = 1900, INK_R = 2600;
  const THROW_INH = .5;            // yönlü atışta atanın ileri hızının bu kadarı varlığa geçer
  const DYN_FUSE = .95, DASH_V = 2.2;
  const KRAL_SPREAD = .62, KRAL_NEAR = 90, WAVE_V = 880;
  const JBUF = .12;                // zıplama tamponu (yere değmeden önce basılan zıplama sayılır)
  const FALL_G = 1.22;             // düşerken yerçekimi çarpanı (zıplama tepesi aynı, iniş daha çabuk)
  // Fun Run gibi: zıplamak ve kaymak hız keser (boşuna zıplamak/kaymak cezalı; kusursuz zıplama muaf)
  const JUMP_KEEP = .92, DJ_KEEP = .85, AIR_MUL = .9, SLIDE_MUL = .8;
  const SPAWN_T = .5;              // yeniden doğunca yerinde hazırlık süresi
  const ICE_TAPS = 4;              // donmuşken bu kadar basışla buz kırılır
  const SAFE_AHEAD = 260, SAFE_BACK = 80;   // güvenli nokta: önünde ~260 px tehlike olmamalı (doğan oyuncunun tepki payı)
  const PERF_WIN = .08, PERF_T = .7, PERF_MUL = 1.1;   // kusursuz iniş/zıplama penceresi ve hız ödülü
  const DRAFT_MIN = 40, DRAFT_MAX = 160, DRAFT_T = .6, DRAFT_K = .07;   // rüzgâr arkası
  const NM_CD = 2;                 // kıl payı olayı en sık 2 sn'de bir
  // nişan yönü: p.ax/p.ay'den birim vektör ya da null (yok / (0,0) → varsayılan davranış)
  function dirOf(ax, ay) {
    ax = +ax || 0; ay = +ay || 0;
    const l = Math.hypot(ax, ay);
    return l > .05 ? { x: ax / l, y: ay / l } : null;
  }
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  /* Ağ (netgame.js): ctrl === 'remote' yarışçı başka bir telefonda simüle edilir → burada fizik/hasar/ölüm UYGULANMAZ.
     curEnt: updateEnts o an hangi varlığı işliyor (hit/death/blocked olaylarına `ent` olarak eklenir → ağda varlık eşitleme). */
  const isRemote = r => !!r && r.ctrl === 'remote';
  let curEnt = null;

  /* =================== YARIŞÇI =================== */
  // görünen ad: FM.CH[id].n varsa o (ör. 'Almancı Dayı'), yoksa kimlik; kimlik (id) mantık/ağ için aynen kalır
  const dispName = id => (FM.CH[id] && typeof FM.CH[id].n === 'string' && FM.CH[id].n) || id;
  game_dispName = dispName;
  function mkRacer(id, idx, bot) {
    const nm = dispName(id);
    return {
      id, idx, name: nm, nick: nm, bot, ctrl: bot ? 'bot' : 'local', pid: null,
      x: 0, y: 0, w: RW, h: RH, vx: 0, vy: 0, onGround: false, coy: 0, jumps: 0,
      out: false, elim: false, outN: 0, outT: 0, gates: 0, gateT: null, tp: 0,
      portCd: 0, ventCd: 0, bounceT: 0, onIce: false, onSand: false, inLift: false,
      slide: false, slideT: 0, climb: false, blocked: false, slam: false,
      item: null, charge: 0, boost: 0, shield: 0, balloon: false, padT: 0,
      dead: 0, inv: 0, stun: 0, frozen: 0, netted: 0, slowT: 0, pull: 0, inked: 0, ccImm: 0,
      dash: 0, sled: 0, fly: 0, dashX: 1, dashY: 0, flyMul: 1.3, car: 0, carBlk: 0,
      jbuf: 0, landT: 9, perfT: 0, perfCd: 0, slamPerf: false, draft: 0, draftT: 0, nmCd: 0, nmPend: null,
      onMud: false, onBelt: false, safe: { x: 60, y: 460 },
      finished: false, place: 0, ftime: 0, rp: 0, total: 0, deaths: 0, kills: 0, coins: 0, ph: 0,
      land: 0, jumpT: 0, face: 1, lastHitBy: null, lastHitT: -9, lockMsg: 0,
      abLv: 1, chargeMul: 1, skin: 'klasik', trail: 'dust', plate: 'basic',
      ctl: { jh: false, jp: false, dh: false, dp: false, use: false, ab: false, ax: 0, ay: 0, bx: 0, by: 0 },   // ax/ay eşya, bx/by güç nişanı
      ai: { skip: 0, itemT: 1, abT: 0, slideT: 0, wait: 0, aimT: 0 }
    };
  }
  function modsFor(id) {
    const m = FM.meta && FM.meta.mods ? FM.meta.mods(id) : null;
    return { abLv: (m && m.abLv) || 1, chargeMul: (m && m.chargeMul) || 1, startItem: (m && m.startItem) || 'speed' };
  }
  /* Oyuncunun kuşandığı kozmetikler (Mağaza 2.0: skin, trail, plate, hat, win, death) — FM.meta.loadout; meta yoksa kayıttan */
  function cosmeticsFor(id) {
    if (FM.meta && typeof FM.meta.loadout === 'function') { try { const lo = FM.meta.loadout(id); if (lo && lo.skin) return lo; } catch (e) { /* kayıttan devam */ } }
    const sv = FM.save, eq = sv.equipped || {};
    return { skin: (eq.skin && eq.skin[id]) || 'klasik', trail: eq.trail || 'dust', plate: eq.plate || 'basic', hat: eq.hat || 'none', win: eq.win || 'none', death: eq.death || 'none' };
  }
  function randomCosmetics(rnd) {
    const C = FM.COSMETICS, sk = C.skins, tr = C.trails, pl = C.plates, ht = C.hats || [], wn = C.wins || [], dt = C.deaths || [];
    const pick = (L, p, def) => (L.length > 1 && rnd() < p) ? L[1 + Math.floor(rnd() * (L.length - 1))].id : def;
    return {
      skin: rnd() < .7 ? 'klasik' : sk[1 + Math.floor(rnd() * (sk.length - 1))].id,
      trail: tr[1 + Math.floor(rnd() * (tr.length - 1))].id,
      plate: rnd() < .6 ? 'basic' : pl[Math.floor(rnd() * pl.length)].id,
      hat: pick(ht, .45, 'none'), win: pick(wn, .6, 'none'), death: pick(dt, .5, 'none')
    };
  }

  /* =================== MAÇ / TUR AKIŞI =================== */
  const game = FM.game = {};
  /* Rastgele seçimlerde kullanılabilen temalar: eski 4 tema her zaman; yeni temalar (base alanı olanlar) ancak
     render-world onları çizebildiğini FM.R.themeReady(id) ile bildirince (o zamana kadar yalnızca açıkça seçilince açılır). */
  function readyThemes() {
    const out = [];
    FM.THEMES.forEach((t, i) => { if (!t.base || (FM.R && typeof FM.R.themeReady === 'function' && FM.R.themeReady(t.id))) out.push(i); });
    return out.length ? out : [0];
  }
  game.readyThemes = readyThemes;
  // tema seçimi: 'random' | indeks | id → tur başına tema indeksleri
  function themeSeqFor(tv, rounds, rnd) {
    rnd = rnd || Math.random;
    let fixed = -1;
    if (tv != null && tv !== 'random' && tv !== '') fixed = FM.themeIndex(typeof tv === 'string' && !isFinite(+tv) ? tv : +tv);
    const seq = [];
    if (fixed >= 0) { for (let i = 0; i < rounds; i++) seq.push(fixed); return seq; }
    const pool = readyThemes().sort(() => rnd() - .5);
    for (let i = 0; i < rounds; i++) seq.push(pool[i % pool.length]);
    return seq;
  }
  game.themeSeqFor = themeSeqFor;
  /* startMatch({char, rounds, mode, theme:'random'|indeks|id, n (toplam yarışçı 2..10), seed?, auto?})
     Verilmeyenler FM.save'den (mode, map, rivals) ya da varsayılandan gelir. */
  game.startMatch = function (opts) {
    opts = opts || {};
    const sv = FM.save;
    const sel = opts.char && FM.CH[opts.char] ? opts.char : sv.selChar;
    S.ROUNDS = opts.rounds || sv.rounds || 3; S.round = 1;
    S.gameMode = FM.modeById(opts.mode) ? opts.mode : (FM.modeById(sv.mode) ? sv.mode : 'classic');
    S.netRole = null;
    const tv = opts.theme != null ? opts.theme : opts.themeIdx != null ? opts.themeIdx : sv.map;
    S.themeSeq = themeSeqFor(tv, S.ROUNDS);
    const n = clamp(Math.round(+opts.n || (+sv.rivals + 1) || 4), 2, FM.MAXR);
    // rakipler: önce seçilenden farklı karakterler; 7'den fazla yarışçıda karakterler tekrar eder (adı numaralanır)
    const others = FM.ORDER.filter(k => k !== sel).sort(() => Math.random() - .5);
    const ids = [sel];
    for (let i = 1; i < n; i++) ids.push(i - 1 < others.length ? others[i - 1] : FM.ORDER[(Math.random() * FM.ORDER.length) | 0]);
    S.racers = ids.map((k, i) => mkRacer(k, i, i === 0 ? !!opts.auto : true));
    S.player = S.racers[0];
    const pm = modsFor(sel);
    for (const r of S.racers) {
      // eşitlik: botlar oyuncunun geliştirme seviyesini yansıtır
      r.abLv = pm.abLv; r.chargeMul = pm.chargeMul; r.startItem = pm.startItem;
      Object.assign(r, r === S.player ? cosmeticsFor(r.id) : randomCosmetics(Math.random));
    }
    // yerel oyuncunun plakasında takma adı (kayıtta ayarlanmışsa) görünür; botlar karakter adıyla kalır
    if (!opts.auto && sv.nickSet && typeof sv.nick === 'string' && sv.nick.trim()) S.player.name = S.player.nick = sv.nick.trim().slice(0, 14);
    nameDupes(S.racers);
    S.matchStats = { startedAt: Date.now() };
    game.startRound({ seed: opts.seed });
    FM.emit('match:start', { racers: S.racers, player: S.player, rounds: S.ROUNDS, mode: S.gameMode });
  };
  // aynı karakterden birden çok yarışçı: "Kral 2" gibi adlandır, farklı kostüm ver (ayırt edilebilsin)
  function nameDupes(rs) {
    const cnt = {};
    for (const r of rs) {
      cnt[r.id] = (cnt[r.id] || 0) + 1;
      if (cnt[r.id] > 1) {
        r.name = r.nick = dispName(r.id) + ' ' + cnt[r.id];
        const sk = FM.COSMETICS.skins;
        if (r.bot) r.skin = sk[(cnt[r.id] - 1) % sk.length].id;
      }
    }
  }
  game.nameDupes = nameDupes;
  /* Tur başlat. opts: {seed?, themeIdx?} — verilmezse tema S.themeSeq'ten, seed rastgele. */
  game.startRound = function (opts) {
    opts = opts || {};
    const ti = opts.themeIdx != null ? opts.themeIdx : (S.themeSeq && S.themeSeq[S.round - 1] != null ? S.themeSeq[S.round - 1] : undefined);
    S.L = FM.genLevel(S.round, { theme: ti, seed: opts.seed, mode: S.gameMode || 'classic' });
    resetRace();
    S.limitT = S.gameMode === 'coins' ? FM.COINS_TIME : null;   // Altın Avı süresi (kalan: game.timeLeft())
    S.paused = false;          // savunma: önceki turdan kalan duraklatma yeni geri sayımı kilitlemesin
    S.mode = 'count'; S.countT = 3.6; S.lastCount = 4;
    FM.fx.toast(S.L.theme.n);
    const md = FM.modeById(S.gameMode);
    if (md && S.gameMode !== 'classic') FM.fx.toast(md.n, '#ffe14d');
    FM.emit('race:start', { round: S.round, rounds: S.ROUNDS, theme: S.L.theme, mode: S.gameMode || 'classic' });
  };
  function resetRace() {
    S.ents = []; S.parts = []; S.rings = []; S.toasts = []; S.feed = [];
    S.finishedN = 0; S.endTimer = null; S.raceT = 0; S.shake = 0; S.flash.a = 0; S.endReq = false;
    S.lt = 0;                                   // seviye saati (tehlike döngüleri; tur başında 0 → ağda herkeste aynı)
    S.elimN = 0; S.spec = null; S.dropN = 0;
    S.limitT = null;
    S.meteorT = null; S.meteorQ = []; S.timeUpSent = false;
    S.aim = null; S.threats = []; S.hint = null;
    const pure = S.gameMode === 'pure';
    S.racers.forEach((r, i) => {
      const keep = { id: r.id, idx: r.idx, bot: r.bot, total: r.total, abLv: r.abLv, chargeMul: r.chargeMul, startItem: r.startItem, skin: r.skin, trail: r.trail, plate: r.plate,
        hat: r.hat, win: r.win, death: r.death, name: r.name, nick: r.nick, ctrl: r.ctrl, pid: r.pid };
      Object.assign(r, mkRacer(r.id, r.idx, r.bot), keep);
      r.x = 80 + i * 4; r.y = S.L.startY - RH; r.safe = { x: r.x + r.w / 2, y: S.L.startY };
      r.item = pure ? null : (r.startItem || 'speed');
      // botlar başlangıç eşyasını aynı anda değil, farklı anlarda kullanır (saldırı eşyası ise kilit bitince)
      if (r.bot) r.ai.itemT = (ATTACK[r.item] ? START_LOCK + .3 : 1) + Math.random() * 3;
    });
    // eleme kapıları: yarışçı sayısına göre yalnızca SON (n-1) kapı etkin (2 kişide tek kapı, 5+ kişide dördü de)
    const G = S.L.gates || [], act = Math.min(G.length, Math.max(1, S.racers.length - 1));
    G.forEach((g, i) => { g.off = i < G.length - act; g.pass = 0; g.done = false; g.t0 = null; g.tc = null; });
    clearInput();
    S.cam.x = 0; S.cam.y = 0;
  }
  game.startDemo = function () {
    const ids = FM.ORDER.slice().sort(() => Math.random() - .5).slice(0, 4);
    S.ROUNDS = 1; S.round = 1; S.gameMode = 'classic'; S.netRole = null;
    const rt = readyThemes(); S.themeSeq = [rt[(Math.random() * rt.length) | 0]];
    S.racers = ids.map((k, i) => mkRacer(k, i, true));
    S.racers.forEach(r => Object.assign(r, randomCosmetics(Math.random)));
    S.player = S.racers[0];
    S.mode = 'demo';
    S.L = FM.genLevel(1, { len: 9000, theme: S.themeSeq[0], mode: 'classic' });
    resetRace();
    S.mode = 'demo';
  };
  game.next = function () {
    if (S.round >= S.ROUNDS) { game.endMatch(); return; }
    S.round++; game.startRound();
  };
  game.endMatch = function () {
    const st = S.racers.slice().sort((a, b) => b.total - a.total || a._rk - b._rk);
    S.mode = 'menu';
    FM.emit('match:end', { standings: st, player: S.player, champion: st[0] === S.player });
  };
  game.toMenu = function () { game.startDemo(); FM.emit('ui:menu'); };
  game.quitRace = function () { game.startDemo(); FM.emit('ui:menu'); };

  /* Sıralama (moda göre):
     classic/pure/chaos: bitirenler bitiş sırasıyla, sonra x'e göre.
     elim: bitirenler, sonra yarışta kalanlar (x), sonra elenenler (son elenen önde).
     coins: altına göre; eşitlikte yukarıdaki kural. */
  function ranking() {
    const coinsM = S.gameMode === 'coins';
    return S.racers.slice().sort((a, b) => {
      if (coinsM && (b.coins | 0) !== (a.coins | 0)) return (b.coins | 0) - (a.coins | 0);
      if (!!a.out !== !!b.out) return a.out ? 1 : -1;
      if (a.out && b.out) return b.outN - a.outN;
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.x - a.x;
    });
  }
  game.ranking = ranking;
  game.timeLeft = () => S.limitT ? Math.max(0, S.limitT - S.raceT) : null;

  // tur puanları (sıralama dizisine göre): eleme ve altın avında herkes sırasına göre puan alır; diğer modlarda yalnızca bitirenler
  function roundPoints(rk) {
    const pts = FM.ptsFor(rk.length), all = S.gameMode === 'elim' || S.gameMode === 'coins';
    return rk.map((r, i) => all ? (pts[i] || 0) : (r.finished ? pts[r.place - 1] || 0 : 0));
  }
  game.roundPoints = roundPoints;
  /* Tur sonu. fixed (ağ): {ranking: [yarışçı], rp: [puan], total: [toplam]} — ev sahibinin kararı herkeste AYNEN uygulanır.
     Ağda ev sahibinde (fixed yok) karar game.onEndRound kancasına devredilir (netgame.js sıralamayı yayınlar; yankısı fixed ile gelir).
     Oyuncu sıralamada yoksa (geç katılan izleyici) kupa/ödül yok: race:end YAYINLANMAZ, yalnızca kürsü (res.spectator). */
  function endRound(fixed) {
    if (!fixed && S.netRole === 'host' && typeof game.onEndRound === 'function') {
      if (!S.endReq) { S.endReq = true; try { game.onEndRound(); } catch (e) { console.error(e); } }
      return;
    }
    S.mode = 'end';
    let rk;
    if (fixed && Array.isArray(fixed.ranking)) {
      rk = fixed.ranking;
      rk.forEach((r, i) => { r.rp = (fixed.rp && fixed.rp[i]) | 0; r.total = fixed.total && fixed.total[i] != null ? fixed.total[i] | 0 : (r.total | 0) + r.rp; r._rk = i; });
    } else {
      rk = ranking();
      const rp = roundPoints(rk);
      rk.forEach((r, i) => { r.rp = rp[i]; r.total += r.rp; r._rk = i; });
    }
    const N = rk.length;
    const pr = rk.indexOf(S.player);
    // kupa: tablo değeri uygulanır ama 0'ın altına inilmez → bildirilen değişim GERÇEKTE uygulanan fark (0 kupada kayıp "-5" görünmesin)
    let td = 0;
    if (pr >= 0) {
      const old = Math.max(0, FM.save.trophies[S.player.id] | 0), nw = Math.max(0, old + (FM.trophyFor(N)[pr] || 0));
      FM.save.trophies[S.player.id] = nw;
      td = nw - old;
      S.player.td = td;
      FM.persist();
    }
    const res = { ranking: rk, player: S.player, playerRank: pr, round: S.round, rounds: S.ROUNDS, theme: S.L.theme, trophyDelta: td, last: S.round >= S.ROUNDS,
      mode: S.gameMode || 'classic', n: N };
    if (S.netRole) { res.mp = true; if (pr < 0) res.spectator = true; }
    S.lastResult = res;
    if (pr >= 0) FM.emit('race:end', res);
    setTimeout(() => { if (S.mode === 'end') { S.paused = false; S.mode = 'podium'; S.podiumT = 0; FM.emit('ui:podium', res); } }, 1500);
  }

  /* =================== FİZİK YARDIMCILARI =================== */
  /* Eğimli zemin (level.js sözleşmesi): katının üst kenarı (x, y) → (x + w, y2); y2 yoksa düz. topAt(s, x) yüzey yüksekliği. */
  const topAt = FM.level.topAt, slopeOf = FM.level.slopeOf;
  const inSolid = (s, px, py) => px >= s.x && px < s.x + s.w && py < s.y + s.h && py >= (s.y2 == null ? s.y : topAt(s, px));
  // kutu katıyla kesişiyor mu. Eğimli yüzeyde ölçü kutunun ORTASININ (bloğa kırpılmış) yüzey yüksekliği: yokuşta duran yarışçının
  // köşesi yüzeye birkaç px girer (destek merkezden), bu çakışma sayılmaz (kayarken kalkma, basamak, doğma testleri yokuşta da çalışır)
  function boxHits(s, x, y, w, h) {
    if (!(x < s.x + s.w && x + w > s.x && y < s.y + s.h)) return false;
    return y + h > (s.y2 == null ? s.y : topAt(s, x + w / 2));
  }
  function solidAt(px, py) { for (const s of S.L.solids) if (inSolid(s, px, py)) return true; return false; }
  function boxFree(x, y, w, h) { for (const s of S.L.solids) if (boxHits(s, x, y, w, h)) return false; return true; }
  // px'te yüzey py − up .. py + d arasında mı (up: yokuşta önündeki yüzey ayaktan biraz yukarıda olabilir)
  function groundWithin(px, py, d, up) { up = up == null ? 4 : up; for (const s of S.L.solids) { if (px < s.x || px > s.x + s.w) continue; const t = topAt(s, px); if (t >= py - up && t < py + d) return true; } return false; }
  // px'te, py − 8'in altındaki en üst yüzey (eğimli zeminde yüzeyin o noktadaki yüksekliği) | null
  // ex kenarında s'ye aynı yükseklikte (2 px) bitişik başka bir zemin bloğu var mı: yokuş tepesi/dibi gibi kesintisiz birleşim
  // duvar/basamak sayılmaz (tepede kaldırıp zıplatmaz)
  function seam(s, ex, face) {
    for (const q of S.L.solids) {
      if (q === s || q.float) continue;
      if (Math.abs(q.x + q.w - ex) < 1 && Math.abs(topAt(q, ex) - face) < 2) return true;
      if (Math.abs(q.x - ex) < 1 && Math.abs(topAt(q, ex) - face) < 2) return true;
    }
    return false;
  }
  function groundY(px, py) { let b = null; for (const s of S.L.solids) { if (px < s.x || px > s.x + s.w) continue; const t = topAt(s, px); if (t >= py - 8 && (b === null || t < b)) b = t; } return b; }
  game.solidAt = solidAt; game.groundY = groundY; game.topAt = topAt; game.boxFree = boxFree;
  const inLowG = x => { for (const z of S.L.lowg) if (x >= z.x && x <= z.x + z.w) return true; return false; };
  game.inLowG = inLowG;
  /* Yuvarlanan kaya: seviye saati t'de durum (saf fonksiyon → yapay zekâ ileriyi hesaplar; ağda herkeste aynı).
     Döngü: [0, rest) içeride (st 0) → [rest, rest+warn) uyarı (st 1, zararsız) → yuvarlanma (st 2, x1'den x0'a). */
  function boulderAt(b, t, out) {
    out = out || {};
    const roll = (b.x1 - b.x0) / b.sp, rest = b.per - b.warn - roll;
    let u = (t + b.ph) % b.per; if (u < 0) u += b.per;
    out.by = b.y - b.r;
    if (u < rest) { out.st = 0; out.k = 0; out.bx = b.x1 + b.r * 2; }
    else if (u < rest + b.warn) { out.st = 1; out.k = (u - rest) / b.warn; out.bx = b.x1 + b.r * 2 * (1 - out.k); }
    else { const d = (u - rest - b.warn) * b.sp; out.st = 2; out.k = d / (b.x1 - b.x0); out.bx = b.x1 - d; }
    return out;
  }
  game.boulderAt = boulderAt;
  // focus: efektlerin/kameranın "yakın" ölçüsü — elenmiş/izleyici oyuncuda izlenen yarışçı
  const focus = () => (S.player && (S.player.out || S.player.spec) && S.spec) || S.player;
  game.focus = focus;
  // Kayan yarışçı ayağa kalkarsa ezici/testere makinesine çarpar mı? (altındayken kayma sürer: tek dokunuşla geçilebilsin)
  function underHazard(r) {
    const L = S.L, feet = r.y + r.h, top = feet - RH;
    for (const k of L.crush) if (r.x + r.w > k.x - 3 && r.x < k.x + k.w + 3 && top < k.y + k.h && feet > k.y + k.h) return true;
    for (const s of L.saws) if (r.x + r.w > s.cx - s.r - 4 && r.x < s.cx + s.r + 4 && Math.abs(feet - (s.cy + 80)) < 14) return true;
    return false;
  }
  // Saldırıya uğradıktan kısa süre sonra çevreden ölen yarışçının öldürmesi saldırgana yazılır (savurma/sersemletme/yavaşlatma)
  function assistOf(q) { const k = q.lastHitBy; return k && k !== q && S.raceT - (q.lastHitT == null ? -99 : q.lastHitT) < ASSIST_T ? k : null; }

  // kapı geçişini kaydet: t = geçiş anı (yarış saati; ağda geçenin kendi telefonundaki an — eleme kararında "en son geçen" buna göre)
  function passGate(r, g, t) {
    const gb = 1 << g.n;
    if (r.gates & gb) { if (t != null && isFinite(t)) (r.gateT || (r.gateT = {}))[g.n] = t; return false; }
    r.gates |= gb; (r.gateT || (r.gateT = {}))[g.n] = t != null && isFinite(t) ? t : S.raceT;
    if (!g.off) { g.pass++; FM.emit('gate', { r, n: g.n }); }
    return true;
  }
  game.passGate = passGate;
  // eleme kapıları: x'i kapıyı geçen yarışçının geçişini kaydet (eleme kararı checkGates'te). Uzak yarışçılar için de çağrılır.
  function markGates(r) {
    const G0 = S.L.gates; if (!G0.length || r.out) return;
    const cx = cxOf(r);
    for (const g of G0) if (!(r.gates & (1 << g.n)) && cx > g.x) passGate(r, g);
  }
  game.markGates = markGates;
  function setSlide(r, on) {
    if (on === r.slide) return true;
    if (on) { r.y += RH - SH; r.h = SH; r.slide = true; r.slideT = 0; return true; }
    if (!boxFree(r.x, r.y - (RH - SH), r.w, RH)) return false;
    r.y -= RH - SH; r.h = RH; r.slide = false; return true;
  }
  const near = r => { const f = focus(); return !!f && Math.abs(cxOf(r) - cxOf(f)) < FM.view.VW; };

  /* Yakın doğma noktası: ölünen yerin (x0) RESP_A..RESP_B px gerisinde, önce en yakını. Ölüm yüksekliğine en yakın sağlam yüzey
     (yüzen platform yalnızca genişse), tehlikenin üstünde/hemen önünde (60 px) değil; mantar/trambolin/gayzer/bataklık/kaya
     bölgesi dışında, gövde sığar. Doğan 2 sn dokunulmaz (önündeki tehlikeden tepki süresiyle geçer). Yoksa null (→ r.safe). */
  const RESP_A = 150, RESP_B = 250;
  function respPoint(x0, feet) {
    const L = S.L;
    const at = x => {
      let best = null, bt = 0;
      for (const s of L.solids) {
        if (x < s.x + 14 || x > s.x + s.w - 14 || (s.float && s.w < 200)) continue;
        const t = topAt(s, x);
        if (t < feet - 170 || t > L.liq - 20) continue;
        if (best === null || Math.abs(t - feet) < Math.abs(bt - feet)) { best = s; bt = t; }
      }
      if (best === null || !boxFree(x - RW / 2, bt - RH - 1, RW, RH)) return null;
      const near = (a, b, pa, pb) => x > a - pa && x < b + pb;
      for (const q of L.spikes) if (near(q.x, q.x + q.w, 60, 40) && Math.abs(q.y + q.h - bt) < 90) return null;
      for (const k of L.crush) if (near(k.x, k.x + k.w, 70, 40)) return null;
      for (const q of L.saws) if (near(q.cx - q.r, q.cx + q.r, 70, 40)) return null;
      for (const b of L.boulders) if (near(b.x0, b.x1 + 2 * b.r, 80, 80)) return null;
      for (const m of L.mush) if (near(m.x, m.x + m.w, 40, 30)) return null;
      for (const m of L.tramp) if (near(m.x, m.x + m.w, 40, 30)) return null;
      for (const v of L.vents) if (near(v.x, v.x + v.w, 40, 30)) return null;
      for (const q of L.quicksand) if (near(q.x, q.x + q.w, 30, 20)) return null;
      return bt;
    };
    const tryX = x => { if (x < L.start + 40) return null; const t = at(x); return t === null ? null : { x, y: t }; };
    for (let b = RESP_A; b <= RESP_B; b += 10) { const p = tryX(x0 - b); if (p) return p; }
    for (let b = RESP_A - 10; b >= 90; b -= 10) { const p = tryX(x0 - b); if (p) return p; }
    for (let b = RESP_B + 10; b <= 450; b += 10) { const p = tryX(x0 - b); if (p) return p; }
    return null;
  }
  game.respPoint = respPoint;
  function die(r, src, cause) {
    if (isRemote(r) || r.dead > 0 || r.finished || post()) return;
    setSlide(r, false);
    // yakın doğma: ölünen yerin biraz gerisi (r.safe yalnızca yedek / kurtarma)
    const rp = respPoint(cxOf(r), r.y + r.h);
    r.respX = rp ? rp.x : null; r.respY = rp ? rp.y : null;
    r.dead = 1.1; r.deaths++; r.vx = r.vy = 0; r.climb = false; r.fly = 0; r.dash = 0; r.sled = 0; r.boost = 0; r.stun = 0; r.frozen = 0; r.netted = 0; r.pull = 0; r.ccImm = 0;
    const killer = src && src !== r ? src : null;
    if (killer) killer.kills++;
    r.lastHitBy = null; r.lastHitT = -9;
    // kilitlenme önleyici: aynı güvenli noktadan arka arkaya çok ölüm → güvenli noktayı ilerideki sağlam zemine taşı
    const lp = r.loop || (r.loop = { sx: -1, n: 0 });
    // doğduktan sonraki 3 sn içinde ölmek (oyuncu tepki veremeden) iki kez sayılır → iki hızlı ölümde kurtarma
    const quick = S.raceT - (r.spawnAt == null ? -9 : r.spawnAt) < 3;
    const sx0 = r.respX != null ? r.respX : r.safe.x;
    if (Math.abs(sx0 - lp.sx) < 60) lp.n += quick ? 2 : 1; else { lp.sx = sx0; lp.n = 1; }
    if (lp.n >= (r.bot ? 4 : 3)) {
      const dx = Math.max(r.x, sx0) + 40;
      let best = null;
      for (const s of S.L.solids) if (!s.float && s.w >= 220 && s.x > dx && (!best || s.x < best.x)) best = s;
      if (best) { r.safe.x = best.x + 90; r.safe.y = topAt(best, best.x + 90); lp.sx = r.safe.x; lp.n = 0; r.respX = null; FM.emit('rescue', { r }); }
    }
    const icon = (cause && FM.ITEMS[cause] && FM.ITEMS[cause].ic) || DEATH_ICON[cause] || '💥';
    if (near(r)) {
      FM.fx.burst(cxOf(r), cyOf(r), ['#ffffff', '#ffd23f', '#ff5a36', FM.CH[r.id].col], 22, 340);
      FM.fx.puff(cxOf(r), cyOf(r), 8, 'rgba(255,255,255,.85)', 14, 90);
    }
    FM.fx.feed(killer ? killer.name : (src === r ? r.name : ''), icon, r.name);
    if (r === S.player) FM.fx.shake(.3);
    FM.emit('death', { r, src: src || null, killer, cause: cause || 'env', self: src === r, ent: curEnt });
    // Altın Avı: ölen altınının %20'sini düşürür (yerdeki altını herkes toplayabilir)
    if (S.gameMode === 'coins' && S.mode === 'race' && (r.coins | 0) >= 1) {
      const n = Math.floor(r.coins * .2);
      if (n > 0) {
        r.coins -= n;
        let x = cxOf(r), y = cyOf(r);
        // çukurda/sıvıda öldüyse altınlar son güvenli zemine saçılır (sıvıya düşüp kaybolmasın)
        const gy = groundY(x, y - 10);
        if (gy === null || gy - y > 420 || y > S.L.liq - 10) { x = r.safe.x; y = r.safe.y - 30; }
        const key = r.idx + '-' + r.deaths;
        const ids = dropCoins(x, y, n, key);
        FM.emit('coins:drop', { r, x, y, n, key, ids });
      }
    }
  }
  function respawn(r) {
    // doğunca yarım saniye yerinde hazırlan (oyuncu ne olduğunu görsün; zıplarsa hemen koşar), 2 sn dokunulmaz
    const px = r.respX != null ? r.respX : r.safe.x;
    let py = r.respX != null ? r.respY : r.safe.y;
    r.respX = r.respY = null;
    { const g = groundY(px, py - 60); if (g !== null && Math.abs(g - py) < 60) py = g; }   // yokuşta eski/yuvarlanmış y → yüzeye
    r.x = px - r.w / 2; r.y = py - RH - 1; r.h = RH; r.slide = false; r.vx = 0; r.vy = 0; r.inv = 2; r.onGround = false;
    r.spawnT = SPAWN_T; r.spawnAt = S.raceT;
    r.tp = (r.tp | 0) + 1;
    if (near(r)) FM.fx.puff(cxOf(r), cyOf(r), 10, 'rgba(255,255,255,.9)', 14, 80);
    FM.emit('respawn', { r });
  }
  /* Altın Avı: (x,y)'de n altını en fazla 6 parçaya bölüp saçar. key → parça id'leri `key:i` ve saçılma yönü
     (deterministik: ağda aynı key ile her istemcide aynı parçalar oluşur). Parça kimlikleri döner. */
  function dropCoins(x, y, n, key) {
    n = Math.max(0, n | 0); if (!n || !S.L) return [];
    key = String(key == null ? 'd' + (S.dropN = (S.dropN | 0) + 1) : key);
    const k = Math.min(6, n), ids = [];
    let seed = 0; for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
    for (let i = 0; i < k; i++) {
      const v = Math.floor(n / k) + (i < n % k ? 1 : 0);
      const h1 = FM.hash(seed + i * 17), h2 = FM.hash(seed + i * 17 + 7);
      const id = key + ':' + i; ids.push(id);
      S.L.coins.push({ x, y, got: 0, drop: true, v, id, t: DROP_LIFE, ready: .5, vx: (h1 - .35) * 420, vy: -380 - h2 * 260, rest: false });
    }
    return ids;
  }
  game.dropCoins = dropCoins;
  // ağdan gelen "başkası aldı" bildirimi: parçayı kimseye çizme/verme
  game.takeDrop = function (id) { for (const co of S.L ? S.L.coins : []) if (co.drop && co.id === id) { co.got = FM.ALLBITS; return true; } return false; };
  /* Eleme: yarışçı elenir → izleyici (r.out). dead çok büyük tutulur (çizilmez, hedef alınmaz, yeniden doğmaz). */
  function eliminate(r, gate) {
    if (!r || r.out) return;
    if (r.slide) setSlide(r, false);
    if (near(r)) {
      FM.fx.burst(cxOf(r), cyOf(r), ['#ffffff', '#ff5a6e', '#ffd23f', FM.CH[r.id] ? FM.CH[r.id].col : '#ffffff'], 22, 300);
      FM.fx.puff(cxOf(r), cyOf(r), 12, 'rgba(255,255,255,.9)', 16, 110);
      FM.fx.ring(cxOf(r), cyOf(r), 90, '#ff5a6e', .5, 8);
    }
    r.out = true; r.elim = true; r.outN = ++S.elimN; r.outT = S.raceT;
    r.dead = 1e9; r.item = null; r.charge = 0; r.vx = r.vy = 0; r.fly = 0; r.dash = 0; r.sled = 0; r.climb = false; r.boost = 0; r.shield = 0; r.balloon = false;
    FM.fx.feed('', '🚪', r.name);
    if (r === S.player) { FM.fx.toast('ELENDİN!', '#ff5a6e'); FM.fx.shake(.25); clearInput(); }
    else if (S.mode !== 'demo') FM.fx.toast(r.name + ' elendi!', '#ffb3bd');
    FM.emit('eliminated', { r, gate: gate == null ? -1 : gate });
  }
  game.eliminate = eliminate;
  // saldırı etkisi: true dönerse isabet
  function harm(q, kind, dur, src, cause) {
    if (isRemote(q)) return false;   // ağ: uzak yarışçıya isabet kendi telefonunda hesaplanır (oradan olay gelir)
    if (q.dead > 0 || q.finished || post()) return false;
    if (q.dash > 0 || q.frozen > 0) return false;
    if (q.shield > 0) { if (near(q)) FM.fx.burst(cxOf(q), cyOf(q), ['#7be3ff', '#ffffff'], 12); FM.emit('blocked', { r: q, by: 'shield', src, cause, ent: curEnt }); return false; }
    if (q.inv > 0) return false;
    // kontrol kaybı (sersemletme/ağ/dondurma/savurma) üst üste zincirlenemez; ama öldürücü saldırılar etkili kalır
    const cc = kind === 'stun' || kind === 'net' || kind === 'freeze' || kind === 'knock';
    if (cc && q.ccImm > 0) return false;
    if (q.balloon && kind !== 'ink') { q.balloon = false; q.inv = .4; if (near(q)) FM.fx.burst(cxOf(q), q.y - 14, ['#ff5a7a', '#ffffff'], 12); FM.emit('blocked', { r: q, by: 'balloon', src, cause, ent: curEnt }); return false; }
    q.boost = 0; q.lastHitBy = src || null; q.lastHitT = S.raceT;
    if (kind === 'kill') die(q, src, cause);
    else if (kind === 'stun') { q.stun = dur; q.ccImm = dur + 1; q.climb = false; q.fly = 0; if (near(q)) FM.fx.burst(cxOf(q), q.y, ['#ffd23f', '#ffffff'], 8); }
    else if (kind === 'freeze') { q.frozen = dur; q.inv = dur + .35; q.ccImm = dur + 1; q.climb = false; q.fly = 0; if (near(q)) FM.fx.burst(cxOf(q), cyOf(q), ['#bfefff', '#ffffff'], 10, 160, 300, 'ice'); }
    else if (kind === 'net') { q.netted = dur; q.stun = dur; q.ccImm = dur + 1; q.vx = 0; q.vy = 0; q.climb = false; q.fly = 0; }
    else if (kind === 'knock') { q.vx = -480; q.vy = -320; q.stun = dur; q.inv = dur + .3; q.ccImm = dur + 1; q.climb = false; q.onGround = false; }
    else if (kind === 'slow') { q.slowT = dur; }
    else if (kind === 'pull') { q.pull = dur; }
    else if (kind === 'ink') { q.inked = dur; }
    FM.emit('hit', { victim: q, src: src || null, kind, cause: cause || null, ent: curEnt });
    return true;
  }
  game.harm = harm;
  function envHit(q, groundHaz, cause) {
    if (q.dead > 0 || q.finished || q.dash > 0 || q.shield > 0 || q.inv > 0 || q.frozen > 0) return;
    if (groundHaz && q.sled > 0) return;
    die(q, assistOf(q), cause);
  }
  /* Affedici tehlike kutuları (görselden küçük). underHazard (kayarken ayağa kalkma denetimi) tam kutuyu kullanmaya devam eder. */
  // testere makinesi: öldürme yarıçapı bıçak gövdesi (dişler hariç ~2 px pay); dar bant tasarımı (level.js) sayesinde ayakta
  // koşan her evrede ~4 px değer, kayan ~10 px boşlukla geçer
  const SAW_FORGIVE = 0, BOULDER_FORGIVE = 6;
  // testere makinesinin rayı (bıçağın üstünden çizilen raya kadar; render-world ile aynı üst sınır): üstünden zıplayan da kesilir
  const sawRail = s => { const top = s.cy - s.amp - s.r - 12; return { x: s.cx - 8, y: top, w: 16, h: Math.max(0, s.py - top) }; };
  const spikeBox = s => ({ x: s.x + 8, y: s.y + 11, w: s.w - 16, h: s.h - 11 });
  const crushBox = k => ({ x: k.x + 4, y: k.y, w: k.w - 8, h: k.h - 3 });
  // özel güç dolumu: %100'e ulaştığı an 'charge:full' (yerel oyuncunun sesi/titreşimi için; demoda yok)
  function addCharge(r, v) {
    const was = r.charge;
    r.charge = Math.min(100, r.charge + v);
    if (was < 100 && r.charge >= 100 && S.mode !== 'demo') FM.emit('charge:full', { r });
  }
  // kusursuz iniş/zıplama: kısa hız ödülü (yarışçı başına en sık ~1 sn'de bir)
  function perfect(r, kind) {
    r.perfT = PERF_T; r.perfCd = 1;
    if (near(r)) FM.fx.sparks(cxOf(r), r.y + r.h, 8, '#fff3a0', 260);
    FM.emit('perfect', { r, kind });
  }
  /* Rüzgâr arkası: bir rakibin hemen arkasında (40-160 px, aynı yükseklik) DRAFT_T sn koşan yarışçının r.draft'ı 0→1 dolar
     (fizikte hız × 1 + DRAFT_K·draft). Uzak yarışçılar için yalnızca görsel (çizim r.draft'a bakar). */
  function updateDraft(r, dt) {
    let ok = false;
    if (S.mode === 'race' && r.dead <= 0 && !r.finished && !r.out && r.vx > RUN * .6) {
      const feet = r.y + r.h;
      for (const q of S.racers) {
        if (q === r || q.dead > 0 || q.out || q.finished) continue;
        const dx = q.x - r.x;
        if (dx >= DRAFT_MIN && dx <= DRAFT_MAX && Math.abs(q.y + q.h - feet) < 34) { ok = true; break; }
      }
    }
    r.draftT = ok ? (r.draftT || 0) + dt : 0;
    r.draft = r.draftT >= DRAFT_T ? Math.min(1, (r.draft || 0) + dt * 2.5) : Math.max(0, (r.draft || 0) - dt * 2);
  }
  /* Kıl payı: yerel oyuncu bir tehlikeye/mermiye birkaç px kala değmeden geçerse (0.25 sn sonra hâlâ hayattaysa) 'nearmiss'.
     Kayarak altından geçilmesi tasarlanmış ezici/testere makinesi sayılmaz. */
  function nearMissNote(r, cause) {
    if (r !== S.player || r.ctrl !== 'local' || S.mode !== 'race' || r.nmCd > 0 || r.nmPend) return;
    if (r.dead > 0 || r.inv > 0 || r.shield > 0 || r.dash > 0 || r.frozen > 0 || r.sled > 0 || r.finished) return;
    r.nmPend = { c: cause, t: .25 };
  }
  function nearMiss(r, dt, hb) {
    r.nmCd = Math.max(0, (r.nmCd || 0) - dt);
    if (r.nmPend) {
      if (r.dead > 0) r.nmPend = null;
      else if ((r.nmPend.t -= dt) <= 0) { FM.emit('nearmiss', { r, cause: r.nmPend.c }); r.nmPend = null; r.nmCd = NM_CD; }
      return;
    }
    if (r.nmCd > 0 || r.dead > 0 || r.inv > 0 || r.shield > 0 || r.dash > 0 || r.frozen > 0 || r.sled > 0) return;
    const L = S.L, M = 7, ex = { x: hb.x - M, y: hb.y - M, w: hb.w + 2 * M, h: hb.h + 2 * M };
    const circ = (x, y, rad) => { const nx = clamp(x, hb.x, hb.x + hb.w), ny = clamp(y, hb.y, hb.y + hb.h); return (nx - x) ** 2 + (ny - y) ** 2 < rad * rad; };
    let c = null;
    for (const s of L.spikes) if (s.x < ex.x + ex.w && s.x + s.w > ex.x && ov(ex, spikeBox(s))) { c = 'spikes'; break; }
    if (!c && !r.slide) for (const k of L.crush) if (ov(ex, crushBox(k))) { c = 'crush'; break; }
    if (!c && !r.slide) for (const s of L.saws) if (Math.abs(s.px - hb.x) < 120 && circ(s.px, s.py, s.r - SAW_FORGIVE + M)) { c = 'saw'; break; }
    if (!c) for (const b of L.boulders) if (b.st === 2 && circ(b.bx, b.by, b.r - BOULDER_FORGIVE + M)) { c = 'boulder'; break; }
    if (!c) for (const e of S.ents) {
      if (e.type === 'saw' && (e.o !== r || e.b > 0) && circ(e.x, e.y, e.r + M)) { c = 'saw'; break; }
      if (e.type === 'mis' && e.o !== r && e.age > e.warn && circ(e.x, e.y, 34)) { c = 'mis'; break; }
    }
    if (c) nearMissNote(r, c);
  }

  /* =================== FİZİK =================== */
  function physics(r, dt) {
    const c = r.ctl, L = S.L;
    r.inv = Math.max(0, r.inv - dt); r.stun = Math.max(0, r.stun - dt); r.frozen = Math.max(0, r.frozen - dt); r.netted = Math.max(0, r.netted - dt);
    // buzu kır: donmuşken her basış (zıpla/kay/eşya/güç) buzu çatlatır, ICE_TAPS basışta kırılır (Fun Run gibi). Botlar da hızlı basar.
    if (r.frozen > 0) {
      if (r.bot && !isRemote(r) && Math.random() < dt * 5) c.jp = true;
      if (c.jp || c.dp || c.use || c.ab) {
        c.jp = c.dp = c.use = c.ab = false; r.jbuf = 0;
        r.iceHits = (r.iceHits | 0) + 1;
        FM.emit('ice:crack', { r, n: r.iceHits, need: ICE_TAPS });
        if (near(r)) FM.fx.burst(cxOf(r), cyOf(r), ['#bfefff', '#ffffff'], 5, 140, 300, 'ice');
        if (r.iceHits >= ICE_TAPS) {
          r.frozen = 0; r.iceHits = 0;
          if (near(r)) { FM.fx.burst(cxOf(r), cyOf(r), ['#bfefff', '#ffffff', '#7fd8ff'], 16, 260, 400, 'ice'); FM.fx.ring(cxOf(r), cyOf(r), 46, '#bfefff', .35, 6); }
          FM.emit('ice:break', { r });
        }
      }
    } else r.iceHits = 0;
    r.slowT = Math.max(0, r.slowT - dt); r.pull = Math.max(0, r.pull - dt); r.inked = Math.max(0, r.inked - dt); r.padT = Math.max(0, r.padT - dt);
    r.ccImm = Math.max(0, (r.ccImm || 0) - dt);
    r.portCd = Math.max(0, (r.portCd || 0) - dt); r.ventCd = Math.max(0, (r.ventCd || 0) - dt); r.bounceT = Math.max(0, (r.bounceT || 0) - dt);
    const wasPow = r.dash > 0 || r.sled > 0 || r.fly > 0;
    r.boost = Math.max(0, r.boost - dt); r.shield = Math.max(0, r.shield - dt); r.dash = Math.max(0, r.dash - dt); r.sled = Math.max(0, r.sled - dt); r.fly = Math.max(0, r.fly - dt);
    // güç (atılım/kızak/süzülüş) bittiği an tehlikenin üstünde kalınca anında ölmesin: kısa lütuf süresi
    if (wasPow && r.dash <= 0 && r.sled <= 0 && r.fly <= 0 && r.dead <= 0) {
      r.inv = Math.max(r.inv, .35);
      if (r.dashY < 0 && r.vy < -240) r.vy = -240;   // yukarı atılım bitti: ivmesi fırlatmasın (kısa ve güvenli)
      r.dashY = 0;
    }
    r.land = Math.max(0, r.land - dt * 5); r.jumpT = Math.max(0, r.jumpT - dt * 5);
    r.perfT = Math.max(0, (r.perfT || 0) - dt); r.perfCd = Math.max(0, (r.perfCd || 0) - dt); r.landT = (r.landT || 0) + dt;
    if (r.dead > 0) { r.dead -= dt; if (r.dead <= 0) respawn(r); c.jp = c.dp = c.use = c.ab = false; r.jbuf = 0; return; }
    const running = S.mode === 'race' || S.mode === 'demo';
    if (running && !r.finished) addCharge(r, dt * 4 * r.chargeMul * (S.gameMode === 'chaos' ? 2 : 1));
    if (r.netted > 0) { r.vx = 0; r.vy = 0; c.jp = c.dp = c.use = c.ab = false; r.jbuf = 0; return; }
    const locked = r.stun > 0 || r.frozen > 0 || !running || r.finished;
    // hedef hız
    let mult = 1;
    if (r.boost > 0) mult *= 1.45;
    if (r.padT > 0) mult *= 1.3;
    if (r.sled > 0) mult *= 1.5;
    if (r.fly > 0) mult *= r.flyMul || 1.3;              // Nuss: ileri nişanlı süzülüş biraz daha hızlı
    if (r.slowT > 0) mult *= .5;
    if (r.onMud && r.sled <= 0) mult *= .6;
    if (r.onSand && r.sled <= 0) mult *= .45;          // bataklık kum: çamurdan yavaş
    if (r.onIce) mult *= r.slide ? 1.3 : 1.1;           // buz: kaygan ve hızlı (göbek üstü kayış daha da hızlı)
    if (r.perfT > 0) mult *= PERF_MUL;                  // kusursuz iniş/zıplama ödülü
    if (r.draft > 0) mult *= 1 + DRAFT_K * r.draft;     // rüzgâr arkası
    if (r.slide && r.onGround && r.sled <= 0 && !r.onIce) mult *= SLIDE_MUL;          // kayış hız keser (buzda ve kızakta değil)
    if (r.airJ && !r.onGround && r.fly <= 0 && r.dash <= 0) mult *= AIR_MUL;           // zıplayan havada daha yavaş
    // yokuş: çıkış biraz yavaş, iniş biraz hızlı; yokuş aşağı KAYMAK hızlı (eğlenceli). r.slope = dy/dx (+ iniş)
    if (r.onGround && r.slope) mult *= 1 + clamp(r.slope, -.75, .75) * (r.slide ? .5 : .2);
    if (r.dash > 0) mult = DASH_V * (r.dashX == null ? 1 : r.dashX);   // yönlü atılımda yatay pay
    if (r.bot) mult *= 1 + .035 * Math.sin(S.T * .55 + r.idx * 2.1);   // ortalaması 0: yalnızca görsel ayrışma
    if (r.spawnT > 0) { r.spawnT = (c.jp || c.dp) ? 0 : r.spawnT - dt; }   // hazırlık: zıplarsa/kayarsa hemen koşar
    let tgt = (locked || r.spawnT > 0) ? 0 : RUN * mult;
    if (r.onBelt && !locked) tgt += 200;
    if (r.pull > 0) tgt = -300;
    if (r.frozen > 0) r.vx *= Math.max(0, 1 - .4 * dt);
    else {
      let acc = (r.onGround ? ACC : AIRACC) * (r.dash > 0 || r.pull > 0 || r.stun > 0 ? 4 : 1);
      // buzda hızlanma yavaş, yavaşlama çok yavaş (kayar)
      if (r.onIce && r.onGround && r.dash <= 0 && r.pull <= 0) acc *= tgt > r.vx ? .35 : .15;
      r.vx += clamp(tgt - r.vx, -acc * 1.6 * dt, acc * dt);
    }
    if (r.onGround) r.coy = .1; else r.coy -= dt;
    if (!r.onGround && r.coy <= 0 && r.jumps === 0) r.jumps = 1;
    // eylemler
    if (!locked) {
      // zıplama tamponu: havada zıplama hakkı yokken (ya da kayarken ayağa kalkılamıyorken) basılan zıplama JBUF sn saklanır,
      // yere değince / kalkabilince kendiliğinden yapılır. Çift zıplama ve kanat çırpma yalnızca gerçek basışla.
      if (c.jp) r.jbuf = JBUF;
      if (r.jbuf > 0) {
        if (r.fly > 0) {
          if (c.jp) { r.vy = -420; if (near(r)) FM.fx.puff(cxOf(r), cyOf(r), 4, 'rgba(255,255,255,.9)', 8, 80); FM.emit('flap', { r }); }
          r.jbuf = 0;
        }
        else if (r.climb) { r.jbuf = 0; }
        else if (r.coy > 0) {
          if (!(r.slide && !setSlide(r, false))) {
            // kusursuz zıplama: inişten hemen sonra (ya da hemen önce basılmış tamponla) zıplayan hız kaybetmez + kısa hız ödülü
            const age = JBUF - r.jbuf;
            const perf = S.mode === 'race' && r.onGround && r.landT <= PERF_WIN && age - r.landT <= PERF_WIN && r.landHard && r.perfCd <= 0;
            r.vy = -JUMP * (r.onSand ? .82 : 1); if (!perf) r.vx *= JUMP_KEEP; r.airJ = !perf; r.coy = 0; r.jumps = 1; r.onGround = false; r.jumpT = 1; r.jbuf = 0;
            if (near(r)) FM.fx.puff(cxOf(r), r.y + r.h, 4, 'rgba(255,255,255,.8)', 7, 70);
            FM.emit('jump', { r, dbl: false });
            if (perf) perfect(r, 'jump');
          }
        } else if (c.jp && r.jumps < 2) {
          if (r.slide) setSlide(r, false);
          r.vy = -DJ; r.vx *= DJ_KEEP; r.airJ = true; r.jumps = 2; r.slam = false; r.slamPerf = false; r.jumpT = 1; r.jbuf = 0;
          if (near(r)) FM.fx.burst(cxOf(r), r.y + r.h, ['#ffffff', '#bfe9ff'], 7, 110, 300, 'star', 4);
          FM.emit('jump', { r, dbl: true });
        }
      }
      if (c.dp) {
        if (r.onGround && !r.slide) { setSlide(r, true); FM.emit('slide', { r }); }
        else if (!r.onGround && !r.climb && r.fly <= 0 && r.dash <= 0 && !r.slam) {
          // kusursuz çakılma: düşerken zemine çok yakınken (son an) başlatılan çakılma inişte hız ödülü verir
          const gy = r.vy > 0 ? groundY(cxOf(r), r.y + r.h) : null;
          r.slamPerf = S.mode === 'race' && gy !== null && gy - (r.y + r.h) < 64 && r.perfCd <= 0;
          r.vy = SLAM; r.slam = true; FM.emit('slam', { r });
        }
      }
      if (c.use) useItem(r, c.ax, c.ay);
      if (c.ab) useAbility(r, c.bx, c.by);
    }
    r.jbuf = Math.max(0, r.jbuf - dt);
    c.jp = c.dp = c.use = c.ab = false; c.ax = c.ay = c.bx = c.by = 0;
    // kayma
    if (r.sled > 0 && r.onGround && !r.slide) setSlide(r, true);
    if (r.slide) {
      r.slideT += dt;
      const under = underHazard(r);   // ezici/testere altındayken kayma sürer (tuşu basılı tutmak gerekmez)
      if (!r.onGround && r.slideT > .15 && r.sled <= 0 && !under) setSlide(r, false);
      else if (r.sled <= 0 && !c.dh && r.slideT > .5 && !under) setSlide(r, false);
    }
    // tırmanma
    if (r.climb) {
      if (!c.jh || locked || !solidAt(r.x + r.w + 3, r.y + r.h - 2)) {
        if (!solidAt(r.x + r.w + 3, r.y + r.h - 2) && !locked) { r.vy = -260; r.vx = 200; FM.emit('vault', { r }); }
        r.climb = false;
      }
    } else if (r.blocked && c.jh && !locked && !r.slide && r.fly <= 0) { r.climb = true; r.slam = false; FM.emit('climb', { r }); }
    // yerçekimi
    if (r.climb) { r.vy = -CLIMB; r.vx = 0; r.jumps = 1; }
    else if (r.dash > 0) { r.vy = (r.dashY || 0) * RUN * DASH_V; }   // yönlü atılım: dikey pay (yerçekimi yok)
    else {
      let g = G;
      if (L.lowg.length && inLowG(cxOf(r))) g *= LOWG;
      if (r.fly > 0) g *= r.vy < 0 ? NUSS_UP_G : .12;   // süzülüş: kısa sıçrayış, sonra yavaş alçalış (eskiden ~470 px yükselip ekrandan çıkıyordu)
      else if (r.vy < 0 && !c.jh && !r.slam && r.bounceT <= 0) g *= 1.6;   // trambolin/gayzer fırlatması: tuşa basılı tutulmuş say
      else if (r.vy > 0 && !r.slam) g *= FALL_G;   // Fun Run gibi: iniş çıkıştan hızlı (yüzer gibi değil, tok zıplama)
      r.vy = Math.min(r.fly > 0 ? 90 : 1500, r.vy + g * dt);
    }
    // rüzgâr bacası: bölgedeki yarışçıyı yukarı taşır (duvar dibindeyse tırmanmaktan hızlı)
    if (L.vents.length && r.dash <= 0) {
      let inL = false;
      const vcx = cxOf(r), vft = r.y + r.h;
      for (let i = 0; i < L.vents.length; i++) {
        const v = L.vents[i];
        if (v.kind !== 'lift' || !v.act) continue;
        if (vcx > v.x && vcx < v.x + v.w && vft > v.y - v.h && r.y < v.y) {
          inL = true;
          r.vy = Math.max(Math.min(r.vy, 600) - LIFT * dt, -LIFT_MAX); r.slam = false;
          if (!r.inLift) FM.emit('vent', { r, i, kind: 'lift' });
        }
      }
      r.inLift = inL;
    }
    // X hareketi
    r.x += r.vx * dt; r.blocked = false;
    if (r.x < 0) { r.x = 0; r.vx = Math.max(0, r.vx); }
    // yatay çarpışma: yalnızca DİK yüzler (duvar/basamak) engeller. Yokuşun başı ayak hizasındaysa engel değil, yürünür
    // (dikey yüzey takibi koşucuyu yokuşa oturtur). ≤ 46 px basamağa kendiliğinden çıkılır.
    // Yalnızca gövde merkezi bloğun DIŞINDAYKEN yandan çarpılır; merkez bloğun üstündeyse (yokuşta yürürken kutunun köşesi
    // yüzeye değer) dikey yüzey takibi yönetir — yokuş başında/sonunda kaldırma/fırlatma olmaz.
    for (const s of L.solids) {
      if (!boxHits(s, r.x, r.y + 1, r.w, r.h - 2)) continue;
      const feet = r.y + r.h, mx = r.x + r.w / 2;
      if (r.vx >= 0 && mx <= s.x + 2) {
        const face = topAt(s, s.x);
        if (feet <= face + 1.5 || seam(s, s.x, face)) continue;
        let lip = feet - face;
        // yokuşun tepesindeki basamak: yükseklik, yokuşun BİTTİĞİ yerden ölçülür (gövde merkezi yokuşta birkaç px aşağıda)
        if (lip > 46 && r.onGround) { const lt = edgeTop(s, s.x, true); if (lt !== null && lt < feet && feet - lt < 30) lip = lt - face; }
        if (lip <= 46 && !r.climb && boxFree(r.x, face - r.h - .5, r.w, r.h)) { r.y = face - r.h - .5; continue; }
        r.x = s.x - r.w; r.blocked = true; if (r.vx > 0) r.vx = 0;
      } else if (r.vx < 0 && mx >= s.x + s.w - 2) {
        const face = topAt(s, s.x + s.w);
        if (feet <= face + 1.5 || seam(s, s.x + s.w, face)) continue;
        r.x = s.x + s.w; r.vx = 0;
      }
    }
    if (r.climb) r.blocked = true;
    // Y hareketi — yüzey takibi (eğimli zemin): destek, gövde merkezinin altındaki yüzeydir (yokuşta pürüzsüz çıkış/iniş).
    // Yerde koşarken (zıplamadan) merkez yüzeyi |vx|·dt + 11 px aşağıdaysa yapışılır: yokuş aşağıda sekme/uçma yok.
    // Merkez boşluktaysa (kenar) kutunun değdiği kenar destek olur (eski affedici kenar davranışı).
    // Tavan yalnızca alttan girilince (düz katılar); eğimli zemin bloklarının altına girilemez.
    const vyBefore = r.vy, feet0 = r.y + r.h, was = r.onGround;
    r.y += r.vy * dt; r.onGround = false;
    {
      const rcx = r.x + r.w / 2, feet = r.y + r.h;
      if (r.vy >= 0) {
        // yapışma payı: adım başına yatay yol + 11 px (kenar desteğinden yokuşa geçişte merkez yüzeyi ~10 px aşağıda kalabilir)
        const snap = was && vyBefore >= 0 && !r.climb ? Math.abs(r.vx) * dt + 11 : 0;
        let sup = null, supY = 0, edge = null, edgeY = 0;
        for (const s of L.solids) {
          if (!(r.x < s.x + s.w && r.x + r.w > s.x)) continue;
          if (rcx >= s.x && rcx < s.x + s.w) {
            const t = s.y2 == null ? s.y : topAt(s, rcx);
            // zemin bloğunda basamak payı kadar (46 px) gömülme de yukarı itilir (ağ düzeltmesi, ışınlanma, eski güvenli nokta)
            if (feet0 <= t + (s.float ? 14 : 46) && feet + snap >= t && (sup === null || t < supY)) { sup = s; supY = t; }
          } else {
            const t = topAt(s, rcx < s.x ? s.x : s.x + s.w);
            if (feet0 <= t + 1 && feet >= t && (edge === null || t < edgeY)) { edge = s; edgeY = t; }
          }
        }
        const land = sup || edge;
        if (land) {
          r.y = (sup ? supY : edgeY) - r.h; r.onGround = true; r.jumps = 0; r.vy = 0;
          r.slope = sup && sup.y2 != null ? slopeOf(sup) : 0;
          if (!was) {
            r.land = clamp(vyBefore / 1300, .25, 1);
            r.landT = 0; r.landHard = vyBefore > 500; r.airJ = false;   // kusursuz zıplama penceresi inişten sayılır
            if (near(r) && (vyBefore > 700 || r.slam)) FM.fx.puff(cxOf(r), r.y + r.h, r.slam ? 10 : 5, 'rgba(255,255,255,.85)', r.slam ? 12 : 8, r.slam ? 140 : 70);
            if (r.slam) {
              if (r === S.player) FM.fx.shake(.12);
              FM.emit('slamLand', { r });
              if (r.slamPerf) { r.vx = Math.max(r.vx, RUN * 1.12); perfect(r, 'slam'); }
            }
            FM.emit('land', { r, hard: vyBefore > 900 });
          }
          r.slam = false; r.slamPerf = false;
        } else r.slope = 0;
      } else {
        r.slope = 0;
        for (const s of L.solids) {
          if (s.y2 != null || !ov(r, s) || feet0 - r.h < s.y + s.h - 14) continue;
          r.y = s.y + s.h; r.vy = 0; if (r.climb) r.climb = false;
        }
      }
    }
    if (r.onGround || r.climb) r.ph += (r.climb ? CLIMB : Math.abs(r.vx)) * dt * .066;   // koşu adımı hıza göre: Fun Run gibi çevik bacaklar (eskiden ağır çekim gibi)
    else r.ph += dt * 4;
    // zemin öğeleri
    r.onMud = false; r.onBelt = false; r.onIce = false; r.onSand = false;
    const cx = cxOf(r), feet = r.y + r.h;
    if (r.onGround) {
      for (const p of L.pads) if (cx > p.x && cx < p.x + p.w && Math.abs(feet - p.y) < 3) { if (r.padT < .5) FM.emit('pad', { r }); r.padT = 1.3; }
      for (const b of L.belts) if (cx > b.x && cx < b.x + b.w && Math.abs(feet - b.y) < 3) r.onBelt = true;
      for (const m of L.mud) if (cx > m.x && cx < m.x + m.w && Math.abs(feet - m.y) < 3) r.onMud = true;
      for (const m of L.ice) if (cx > m.x && cx < m.x + m.w && Math.abs(feet - m.y) < 3) r.onIce = true;
      for (const m of L.quicksand) if (cx > m.x && cx < m.x + m.w && Math.abs(feet - m.y) < 3) r.onSand = true;
    }
    if (r.vy >= 0) for (const m of L.mush) {
      if (cx > m.x - 4 && cx < m.x + m.w + 4 && feet > m.y - 24 && feet <= m.y + 2) {
        if (r.slide) setSlide(r, false);
        r.vy = -MUSH; r.jumps = 1; r.onGround = false; r.y = m.y - 24 - r.h; m.sq = .3; r.jumpT = 1; r.airJ = false;   // harita fırlatması: zıplama cezası yok
        FM.emit('mush', { r });
      }
    }
    // trambolin (şehir çatıları): mantar gibi ama daha güçlü; fırlatma tuşa basılı tutulmuş sayılır → boşluğu hep aşar
    if (r.vy >= 0) for (const m of L.tramp) {
      if (cx > m.x - 4 && cx < m.x + m.w + 4 && feet > m.y - 24 && feet <= m.y + 2) {
        if (r.slide) setSlide(r, false);
        r.vy = -TRAMP; r.jumps = 1; r.onGround = false; r.y = m.y - 24 - r.h; m.sq = .35; r.jumpT = 1; r.bounceT = .6; r.climb = false; r.airJ = false;
        FM.emit('mush', { r, kind: 'tramp' });
      }
    }
    // gayzer (tropik): fışkırırken üstünden geçeni yukarı fırlatır
    if (r.ventCd <= 0 && r.dash <= 0) for (let i = 0; i < L.vents.length; i++) {
      const v = L.vents[i];
      if (v.kind !== 'burst' || !v.act) continue;
      if (cx > v.x && cx < v.x + v.w && feet > v.y - 70 && feet <= v.y + 2) {
        if (r.slide) setSlide(r, false);
        r.vy = -GEYSER; r.jumps = 1; r.onGround = false; r.y = Math.min(r.y, v.y - r.h - 2); r.jumpT = 1; r.bounceT = .5; r.ventCd = .7; r.climb = false; r.slam = false;
        if (near(r)) FM.fx.puff(cx, v.y - 10, 8, 'rgba(255,255,255,.85)', 14, 120);
        FM.emit('vent', { r, i, kind: 'burst' });
        break;
      }
    }
    // çevre tehlikeleri (çarpışma kutuları görselden birkaç px küçük: "kıl payı" geçişler affedilir)
    const hb = { x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 7 };
    for (const s of L.spikes) if (ov(hb, spikeBox(s))) envHit(r, true, 'spikes');
    for (const k of L.crush) if (ov(hb, crushBox(k))) envHit(r, true, 'crush');
    for (const s of L.saws) {
      const nx = clamp(s.px, hb.x, hb.x + hb.w), ny = clamp(s.py, hb.y, hb.y + hb.h);
      if ((nx - s.px) ** 2 + (ny - s.py) ** 2 < (s.r - SAW_FORGIVE) ** 2 || ov(hb, sawRail(s))) envHit(r, false, 'saw');
    }
    for (const b of L.boulders) {
      if (b.st !== 2) continue;
      const nx = clamp(b.bx, hb.x, hb.x + hb.w), ny = clamp(b.by, hb.y, hb.y + hb.h);
      if ((nx - b.bx) ** 2 + (ny - b.by) ** 2 < (b.r - BOULDER_FORGIVE) ** 2) envHit(r, true, 'boulder');
    }
    if (r === S.player && r.ctrl === 'local') nearMiss(r, dt, hb);
    // ışınlanma kapısı (uzay): havadaki A'ya giren yerdeki B'den çıkar
    if (r.portCd <= 0 && r.dead <= 0) for (let i = 0; i < L.portals.length; i++) {
      const p = L.portals[i];
      if (Math.abs(cx - p.ax) < p.r + r.w / 2 - 6 && r.y < p.ay + p.h && r.y + r.h > p.ay - p.h) {
        if (near(r)) { FM.fx.burst(p.ax, p.ay, ['#c084fc', '#7be3ff', '#ffffff'], 14, 220, 0, 'star'); FM.fx.ring(p.ax, p.ay, 50, '#c084fc', .4, 6); }
        if (r.slide) setSlide(r, false);
        r.x = p.bx - r.w / 2; r.y = p.by - r.h - 1; r.vy = -240; r.onGround = false; r.climb = false; r.slam = false;
        r.portCd = 1; r.tp = (r.tp | 0) + 1;
        if (near(r)) { FM.fx.burst(p.bx, p.by - 40, ['#c084fc', '#7be3ff', '#ffffff'], 14, 220, 0, 'star'); FM.fx.ring(p.bx, p.by - 40, 50, '#7be3ff', .4, 6); }
        FM.emit('portal', { r, i, ax: p.ax, ay: p.ay, bx: p.bx, by: p.by });
        return;
      }
    }
    // DÜŞÜP ÖLME YOK (Fun Run 4 gibi): hiçbir sıvı (su/lav/çikolata/plazma/neon...) öldürmez. Her boşluğun tabanı var; yine de
    // dünyanın altına düşen olursa (beklenmez) ölüm sayılmadan son güvenli noktaya taşınır.
    if (r.y + r.h > L.liq + 18 && r.dead <= 0) {
      if (r.slide) setSlide(r, false);
      r.x = r.safe.x - r.w / 2; r.y = r.safe.y - RH - 1; r.vx = r.vy = 0; r.climb = false; r.fly = 0; r.dash = 0; r.slam = false;
      r.onGround = false; r.inv = Math.max(r.inv, 1); r.tp = (r.tp | 0) + 1;
      FM.emit('rescue', { r, fall: true });
      return;
    }
    // güvenli nokta (route'un geniş yüzen platformları da sayılır; Nuss süzülürken altındaki zemin de)
    if (!r.finished && r.dead <= 0) {
      let sy = null;
      if (r.onGround) sy = feet;
      else if (r.fly > 0) { const gy = groundY(cx, feet); if (gy !== null && gy - feet <= 300) sy = gy; }
      if (sy !== null) {
        let ok = false;
        // altında sağlam (yüzmeyen ya da geniş) katı; yokuşta kenar payı komşu bloklarla sürer (arkada 60, önde 160 px zemin)
        for (const s of L.solids) if ((!s.float || s.w >= 200) && cx >= s.x && cx < s.x + s.w && Math.abs(sy - topAt(s, cx)) < 3) {
          if (s.y2 == null && s.float) ok = cx > s.x + 60 && cx < s.x + s.w - 160;
          else { const gb = groundY(cx - 60, sy - 50), ga = groundY(cx + 160, sy - 130); ok = gb !== null && ga !== null && Math.abs(gb - sy) < 60 && Math.abs(ga - sy) < 130; }
          break;
        }
        const A0 = cx - SAFE_BACK, A1 = cx + SAFE_AHEAD;
        if (ok) for (const s of L.spikes) if (s.x + s.w > A0 && s.x < A1) { ok = false; break; }
        if (ok) for (const k of L.crush) if (k.x + k.w > A0 && k.x < A1) { ok = false; break; }
        if (ok) for (const s of L.saws) if (s.cx + 110 > A0 && s.cx - 110 < A1) { ok = false; break; }
        if (ok) for (const b of L.boulders) if (cx > b.x0 - 80 && cx < b.x1 + 80) { ok = false; break; }
        if (ok && r.onSand) ok = false;
        if (ok) { r.safe.x = cx; r.safe.y = sy; }
      }
    }
    // kutular (her yarışçı için ayrı)
    for (const b of L.boxes) {
      if (b.cd[r.idx] > 0) b.cd[r.idx] -= dt;
      else if (ov(r, b)) {
        b.cd[r.idx] = S.gameMode === 'chaos' ? 1.5 : 3.5; addCharge(r, 18);
        const got = !r.item;
        if (got) { r.item = rollItem(r); if (r.bot) r.ai.itemT = .5 + Math.random() * 2; }
        if (near(r)) FM.fx.burst(b.x + 16, b.y + 16, ['#ff4d4d', '#ffffff', '#ffd23f'], 12, 200, 400, 'star', 4);
        FM.emit('box', { r, item: got ? r.item : null });
      }
    }
    // altınlar (her yarışçı kendi altınlarını toplar). Ağda süre dolunca toplanmaz (ev sahibinin bitirme mesajı gelene kadar sayı donar)
    const bit = 1 << r.idx;
    if (!(S.netRole && S.limitT && S.raceT >= S.limitT)) for (const co of L.coins) {
      if (co.got & bit) continue;
      if (co.drop && (co.ready > 0 || co.t <= 0)) continue;
      if (Math.abs(co.x - cx) < 22 && co.y > r.y - 16 && co.y < r.y + r.h + 10) {
        if (co.drop) {
          // yere düşmüş altın: ilk alan alır, herkes için kaybolur
          co.got = FM.ALLBITS; r.coins += co.v | 0;
          if (r === S.player) FM.fx.sparks(co.x, co.y, 10, '#ffe14d', 220);
          FM.emit('coin', { r, x: co.x, y: co.y, n: co.v | 0, drop: true });
          FM.emit('coins:pick', { r, id: co.id, n: co.v | 0 });
          continue;
        }
        co.got |= bit; r.coins++;
        if (r === S.player) { FM.fx.sparks(co.x, co.y, 6, '#ffe14d', 180); }
        FM.emit('coin', { r, x: co.x, y: co.y });
      }
    }
    markGates(r);
    // bitiş
    if (!r.finished && r.x > L.end) finishRacer(r);
  }
  /* Bitiş kaydı. net = true: uzak yarışçının bitişi (ağdan; altın bonusunu kendi telefonu ekledi). ftime verilmezse şimdiki yarış saati. */
  function finishRacer(r, ftime, net) {
    if (!r || r.finished) return false;
    const L = S.L;
    r.finished = true; r.place = ++S.finishedN; r.ftime = ftime != null && isFinite(ftime) ? +ftime : S.raceT; r.inv = 999; r.item = null;
    if (S.gameMode === 'coins' && S.mode === 'race') {
      if (!net) { r.coins += FM.COINS_FINISH; FM.emit('coins:bonus', { r, n: FM.COINS_FINISH }); }
      FM.fx.toast(`${r.name} bitirdi!  +${FM.COINS_FINISH} altın`, r === S.player ? '#ffe14d' : '#ffffff');
    } else if (S.mode !== 'demo' && (r === S.player || r.place === 1)) FM.fx.toast(`${r.name} bitirdi!  #${r.place}`, r === S.player ? '#ffe14d' : '#ffffff');
    if (near(r)) FM.fx.confetti(L.end + 40, L.finY - 200, r === S.player ? 70 : 25);
    // ilk bitirenden sonra diğerlerine 12 sn; kalabalık yarışta kişi başı +1.5 sn (10 kişide 21), kaosta +4 (Altın Avı'nda süre sayacı belirler)
    if (S.finishedN === 1 && !S.limitT) S.endTimer = 12 + Math.max(0, S.racers.length - 4) * 1.5 + (S.gameMode === 'chaos' ? 4 : 0);
    FM.emit('finish', net ? { r, place: r.place, time: r.ftime, net: true } : { r, place: r.place, time: r.ftime });
    return true;
  }
  game.finishRacer = finishRacer;

  /* =================== EŞYALAR =================== */
  /* Eşya şansı sıraya göre (f: 0 lider → 1 sonuncu). Lastik bant: liderden çok geride kalan (far 0..1) daha çok hız/füze/
     yıldırım/mıknatıs, daha az tuzak/ağ/kalkan alır — geriden gelenin yarışa dönme şansı artar. */
  function rollItem(r) {
    const rk = ranking().indexOf(r), f = S.racers.length > 1 ? rk / (S.racers.length - 1) : 0;
    let lead = -1e9; for (const q of S.racers) if (!q.out && !q.finished && q.x > lead) lead = q.x;
    const far = rk > 0 && lead > -1e9 ? clamp((lead - r.x - 500) / 1500, 0, 1) : 0;
    const w = { saw: 14, dyn: 12, trap: 6 + 10 * (1 - f), mis: rk > 0 ? 6 + 12 * f : 0, bolt: f > .6 ? 5 : 0, ice: 5 + 6 * f, mag: rk > 0 ? 5 + 8 * f : 0, net: 4 + 10 * (1 - f), ink: rk > 0 ? 3 + 6 * f : 0, speed: 8 + 14 * f, shield: 8 + 6 * (1 - f), balloon: 9 };
    // geride kalana asıl yardım hız; saldırı payı az (kalabalıkta geride kalan çok olur, ölüm artmasın)
    if (far > 0) { w.speed *= 1 + 1.8 * far; w.mis *= 1 + .3 * far; w.mag *= 1 + .4 * far; w.trap *= 1 - .6 * far; w.net *= 1 - .6 * far; w.shield *= 1 - .3 * far; w.balloon *= 1 - .3 * far; }
    // Kaos: saldırı eşyaları çok daha sık
    if (S.gameMode === 'chaos') for (const k in w) w[k] *= ATTACK[k] ? 1.7 : .6;
    // kalabalık yarış (5-10 kişi): hedef çok olduğundan saldırılar daha öldürücü → saldırı eşyası biraz seyrek (kaos hariç)
    else if (S.racers.length > 4) {
      const big = Math.min(1, (S.racers.length - 4) / 6);
      for (const k in w) if (ATTACK[k]) w[k] *= 1 - (k === 'bolt' ? .5 : .3) * big;
    }
    let tot = 0; for (const k in w) tot += w[k];
    let v = Math.random() * tot;
    for (const k in w) { v -= w[k]; if (v <= 0) return k; }
    return 'speed';
  }
  function aheadOf(r, range) {
    let best = null;
    for (const q of S.racers) { if (q === r || q.dead > 0 || q.finished) continue; const d = q.x - r.x; if (d > 0 && d < range && (!best || d < best.x - r.x)) best = q; }
    return best;
  }
  function behindOf(r, range) {
    let best = null;
    for (const q of S.racers) { if (q === r || q.dead > 0 || q.finished || q.out) continue; const d = r.x - q.x; if (d > 0 && d < range && (!best || d < r.x - best.x)) best = q; }
    return best;
  }
  // nişan yönündeki (yarım açısı spread olan koni içindeki) en yakın rakip; yakın ve nişana yakın olan önce
  function pickTarget(r, d, range, spread) {
    const ox = cxOf(r), oy = cyOf(r), cs = Math.cos(spread);
    let best = null, bs = 1e9;
    for (const q of S.racers) {
      if (q === r || q.dead > 0 || q.finished || q.out) continue;
      const dx = cxOf(q) - ox, dy = cyOf(q) - oy, dist = Math.hypot(dx, dy) || 1;
      if (dist > range) continue;
      const dot = (dx * d.x + dy * d.y) / dist;
      if (dot < cs) continue;
      const sc = dist * (2 - dot);
      if (sc < bs) { bs = sc; best = q; }
    }
    return best;
  }
  // start kalabalığında saldırı eşyası kilitli (eşya elde kalır)
  const attackLocked = it => !!ATTACK[it] && S.raceT < START_LOCK && (S.mode === 'race' || S.mode === 'demo');
  /* Eşya kullan. ax/ay: nişan yönü (yoksa/0 ise varsayılan). Yönlü eşyada p'ye ax/ay (2 ondalık) eklenir; varlığın tüm
     başlangıç değerleri (x, y, vx, vy, tgt) p'dedir → ağda aynı p ile her istemcide aynı varlık kurulur. */
  function useItem(r, ax, ay) {
    if (!r.item || r.dead > 0 || r.finished) return;
    if (attackLocked(r.item)) {
      if (r === S.player && !r.bot && !r.lockMsg) { r.lockMsg = 1; FM.fx.toast('Eşya ' + Math.max(1, Math.ceil(START_LOCK - S.raceT)) + ' sn sonra hazır!', '#ffb347'); }
      return;
    }
    const it = r.item;
    const d = AIM_ITEMS[it] ? aimDir(ax, ay) : null;
    const p = itemParams(r, it, d);
    if (!p) {   // tuzak çukura düşecek / füzenin hedefi yok: eşya elde kalır
      if (r === S.player && !r.bot && S.mode === 'race') FM.fx.toast(it === 'mis' ? 'Hedef yok!' : it === 'trap' ? 'Tuzak buraya kurulamaz!' : 'Şimdi olmaz!', '#ffb347');
      return;
    }
    if (d) { p.ax = d.x; p.ay = d.y; }
    r.item = null;
    const ents = castItem(r, it, p);
    FM.emit('item:use', { r, item: it, p, ents });
  }
  // yön: birim vektör, 2 ondalığa yuvarlanmış (ağda giden değerle birebir aynı hesap)
  function aimDir(ax, ay) { const d = dirOf(ax, ay); return d ? { x: r2(d.x), y: r2(d.y) } : null; }
  /* Fırlatılan eşyanın (testere/dinamit/tuzak/ağ) başlangıç değerleri; d = nişan yönü ya da null (varsayılan atış). Doğrulama YOK
     (aimPreview bunu çizer); itemParams kullanılamaz atışları ayrıca eler. */
  function throwParams(r, it, d) {
    const cx = cxOf(r), cy = cyOf(r), inh = Math.max(0, r.vx) * THROW_INH;
    switch (it) {
      case 'saw': {
        // yerde yuvarlanan testere: yavaş (okunur, zıplanarak kaçılır) ve zemine yakın (merkez ayağın 19 px üstü, yarıçap 18)
        if (!d) return { x: cx + 20, y: r.y + r.h - 19, vx: SAW_V + Math.max(0, r.vx) * .3, vy: 0 };
        // yatay (ya da yerdeyken aşağı) nişan → yerde yuvarlanır (ileri/geri); yukarı/çapraz → kavisli atış
        const roll = Math.abs(d.y) < .3 || (d.y > 0 && r.onGround), sx = d.x < 0 ? -1 : 1;
        if (roll) return { x: r1(cx + 20 * sx), y: r1(r.y + r.h - 19), vx: r1(sx * SAW_V + Math.max(0, r.vx) * .3), vy: 0 };
        return { x: r1(cx + 18 * d.x), y: r1(cy - 6), vx: r1(d.x * SAW_V + Math.max(0, r.vx) * .3), vy: r1(d.y * SAW_V) };
      }
      // varsayılan uzun atış: patlama atanın ~250+ px önüne düşer. Yönlüde hafif yukarı kavis (DYN_LOB): yatay nişan da yay çizer
      case 'dyn':
        if (!d) return { x: cx + 10, y: r.y, vx: Math.max(0, r.vx) + 520, vy: -600 };
        return { x: r1(cx + 10 * d.x), y: r1(r.y), vx: r1(d.x * DYN_V + inh), vy: r1(d.y * DYN_V - DYN_LOB) };
      // varsayılan: ayağın dibine/arkasına bırakılır (havadaysan aşağıdaki zemine düşer); nişanlı: kısa kavisli atış
      case 'trap':
        if (!d) return { x: r1(r.x - 26), y: r1(r.y + r.h - 12) };
        return { x: r1(cx - 17 + 8 * d.x), y: r1(r.y + r.h - 30), vx: r1(d.x * TRAP_V + inh), vy: r1(d.y * TRAP_V - TRAP_LOB) };
      // ağ: varsayılan arkana (zemine düşüp dikilir); nişanlı: kavisli atış, düştüğü zemine dikilir
      case 'net':
        if (!d) return { x: r1(r.x - 56), y: r1(r.y + r.h - 72) };
        return { x: r1(cx - 22 + 10 * d.x), y: r1(r.y + r.h - 80), vx: r1(d.x * NET_V + inh), vy: r1(d.y * NET_V - NET_LOB) };
    }
    return null;
  }
  /* Eşya kullanım parametreleri (konum, hız, hedef) — kullananın telefonunda hesaplanır; ağda aynen yayınlanır ve
     castItem her istemcide aynı varlığı kurar. null = şu an kullanılamaz (eşya elde kalır). d: nişan yönü | null. */
  function itemParams(r, it, d) {
    const cx = cxOf(r), cy = cyOf(r);
    if (d === undefined) d = null;
    switch (it) {
      // fırlatılan/bırakılan her şey yerçekimiyle düşer ve bir yüzeye oturur; çukura/sıvıya düşen kaybolur ('fizzle')
      case 'saw': case 'dyn': case 'net': case 'trap': return throwParams(r, it, d);
      case 'mis': {
        // geri çekilmiş nişan (ax < -0.3): arkandaki en yakın rakip; yoksa lider (lider sensen ikinci)
        if (d && d.x < -.3) { const tgt = behindOf(r, 2600); return tgt ? { x: cx, y: r.y - 30, tgt } : null; }
        const rk = ranking().filter(q => !q.finished && q.dead <= 0);
        const tgt = rk[0] === r ? rk[1] : rk[0];
        return tgt ? { x: cx, y: r.y - 30, tgt } : null;   // hedef yok: eşya boşa gitmesin
      }
      // yıldırım yalnızca öndekiler; en yakın 4 kişi (10 kişilik yarışta herkesi silmesin)
      case 'bolt': return { x: cx, y: cy, tg: S.racers.filter(q => q !== r && !q.finished && !q.out && q.x > r.x).sort((a, b) => a.x - b.x).slice(0, 4) };
      default: return { x: cx, y: cy, rx: r.x };
    }
  }
  // atılan eşyanın varlığı (castItem ve önizleme/yapay zekâ simülasyonu AYNI nesneyi kurar)
  function mkThrown(r, it, p) {
    switch (it) {
      case 'saw': return { type: 'saw', x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, r: 18, o: r, age: 0, life: 2.6, b: 0 };
      case 'dyn': return { type: 'dyn', x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, o: r, age: 0, fuse: DYN_FUSE };
      // tuzak ve ağ HER ZAMAN fiziksel: yerçekimiyle düşer, bir yüzeye oturunca o yüzeye sabitlenir ve ancak o zaman kurulur
      // (age yere oturunca 0'dan sayar). Atan 1.6 sn kendi tuzağına basmaz (ileri atışta üstünden geçebilsin).
      case 'trap': return { type: 'trap', x: p.x, y: p.y, w: 34, h: 12, o: r, age: 0, life: 16, fly: true, vx: p.vx || 0, vy: p.vy || 0, og: 1.6 };
      case 'net': return { type: 'net', x: p.x, y: p.y, w: 44, h: 76, o: r, age: 0, life: 10, n: 0, fly: true, vx: p.vx || 0, vy: p.vy || 0 };
    }
    return null;
  }
  // istatistik/çizim için yön etiketi
  const aimTag = d => !d ? null : d.x < -.3 ? 'back' : d.y < -.35 ? 'up' : d.y > .35 ? 'down' : 'fwd';
  /* Eşyanın etkisini uygular / varlığını kurar; kurulan varlıkları döndürür. Uzak (ağ) kullanıcıda kendi durumuna (hız, kalkan,
     balon) dokunulmaz — onu kendi telefonu simüle eder; alan etkileri (buz, mürekkep) harm() ile yalnızca yerel yetkililere işler.
     Yön p.ax/p.ay'den (yoksa varsayılan); eski (yönsüz) ağ mesajlarıyla uyumlu. */
  function castItem(r, it, p) {
    const out = [], own = !isRemote(r);
    const add = e => { S.ents.push(e); out.push(e); };
    const d = dirOf(p.ax, p.ay);
    switch (it) {
      case 'speed': if (own) { r.boost = 3.2; r.shield = 0; } break;
      case 'shield': if (own) { r.shield = 4; r.boost = 0; } break;
      case 'balloon': if (own) r.balloon = true; break;
      case 'saw': case 'dyn': case 'trap': case 'net': { const e = mkThrown(r, it, p); if (e) { if (d) e.aim = aimTag(d); add(e); } break; }
      case 'mis': add({ type: 'mis', x: p.x, y: p.y, vx: 0, vy: 0, tgt: p.tgt || null, o: r, age: 0, warn: 1.1, back: !!(d && d.x < -.3), aim: d ? aimTag(d) : undefined }); break;
      case 'bolt': for (const q of p.tg || []) add({ type: 'bolt', tgt: q, o: r, t: 1.8, age: 0 }); break;
      // Kar Fırtınası: kısa hazırlık, sonra atandan yayılan buz dalgası (ulaştığı herkes 2.2 sn donar) — okunur ve adil
      case 'ice': add({ type: 'frost', x: p.x, y: p.y, o: r, age: 0, r: 0, rmax: FROST_R, hit: [] }); break;
      case 'mag': add({ type: 'mag', o: r, t: .45, age: 0 }); break;
      // Mürekkep: atanın önünden ileri fışkıran mürekkep cephesi; geçtiği (öndeki) herkesin ekranı kararır
      case 'ink': { const rx = p.rx != null ? p.rx : r.x; add({ type: 'inkw', x: rx + r.w, rx, y: p.y, o: r, age: 0, hit: [] }); FM.fx.burst(p.x, p.y, ['#222233', '#444466'], 16, 240); break; }
    }
    return out;
  }
  function explode(x, y, rad, owner, cause) {
    const pad = cause === 'meteor' ? 6 : 14;   // meteor biraz daha affedici
    for (const q of S.racers) {
      if (q === owner && (cause === 'mis' || cause === 'dyn')) continue;   // kendi füzen/dinamitin sana zarar vermez (yukarı/geri atış güvenli)
      const dd = Math.hypot(cxOf(q) - x, cyOf(q) - y);
      if (dd < rad + pad) harm(q, 'kill', 0, owner, cause);
      else if (dd < rad + pad + 40 && q === S.player) nearMissNote(q, cause || 'explode');
    }
    FM.fx.ring(x, y, rad, '#ffb347', .45, 10);
    FM.fx.glow(x, y, rad * 1.8, 'rgba(255,170,60,1)', .35);
    FM.fx.burst(x, y, ['#ffb347', '#ff5a36', '#ffffff', '#555555'], 30, 360);
    FM.fx.puff(x, y, 12, 'rgba(70,60,60,.75)', 22, 140);
    FM.fx.sparks(x, y, 16, '#ffd23f', 520);
    const fo = focus();
    if (fo && Math.hypot(x - cxOf(fo), y - cyOf(fo)) < 520) FM.fx.shake(.35);
    FM.emit('explode', { x, y, rad, owner });
  }

  /* =================== ÖZEL GÜÇLER =================== */
  const abK = r => 1 + (r.abLv - 1) * .1;   // seviye başına %10 güç
  function useAbility(r, ax, ay) {
    if (r.charge < 100 || r.dead > 0 || r.finished) return;
    r.charge = 0;
    const d = AIM_ABS[r.id] ? aimDir(ax, ay) : null;
    const p = { x: cxOf(r), y: cyOf(r), fy: r.y + r.h };
    if (d) { p.ax = d.x; p.ay = d.y; }
    if (r.id === 'Caner') p.tgt = canerTarget(r, d);
    const ents = castAbility(r, p);
    FM.emit('ability', { r, id: r.id, p, ents });
  }
  // Caner'in hedefi: varsayılan öndeki en yakın; nişanlıysa nişan yönündeki (önde/arkada) en yakın rakip
  function canerTarget(r, d) {
    if (!d) return aheadOf(r, 1300);
    return pickTarget(r, d, 1300, 1) || (d.x >= 0 ? aheadOf(r, 1300) : null);
  }
  // TAFTAF atılım yönü: her zaman biraz ileri (geri nişan aynalanır), en dik ~67° yukarı, en çok ~19° aşağı
  function dashVec(d) {
    if (!d) return { x: 1, y: 0 };
    const x = Math.max(.35, Math.abs(d.x)), y = clamp(d.y, -.85, .35), l = Math.hypot(x, y);
    return { x: x / l, y: y / l };
  }
  const dashDur = (r, v) => .55 * abK(r) * (1 - .38 * Math.max(0, -v.y));   // yukarı atılım kısa (~230 px yükselir: en yüksek duvarı aşar)
  // Nuss süzülüşü: up = nişanın yukarı payı 0..1 (-1 = nişansız → eski değerler)
  // yükselirken yerçekimi ×NUSS_UP_G (≈ 120 px sıçrayış), alçalırken ×0.12 (en çok 90 px/sn): gerçek süzülüş
  const NUSS_UP_G = .55;
  const nussVy = up => up < 0 ? -560 : -(300 + 420 * up), nussMul = up => up < 0 ? 1.3 : 1.3 + .22 * (1 - up);
  // baso dalgası: ileri/geri, yataydan en çok ~40° sapar
  function waveVec(d) {
    if (!d) return { x: 1, y: 0 };
    const sx = d.x < -.05 ? -1 : 1, a = clamp(Math.atan2(d.y, Math.abs(d.x)), -.7, .7);
    return { x: sx * Math.cos(a), y: Math.sin(a) };
  }
  // Kral kükremesi konisi: dibindeki (KRAL_NEAR) herkes + nişan yönünde yarım açısı spread olan koni
  function inCone(dx, dy, d, len, spread) {
    const dist = Math.hypot(dx, dy);
    if (dist > len) return false;
    if (dist < KRAL_NEAR) return true;
    return (dx * d.x + dy * d.y) / dist > Math.cos(spread);
  }
  /* Özel gücün etkisi (p = kullanım anındaki gövde merkezi x,y + ayak fy; Caner için hedef tgt; yönlüde ax/ay). Kurulan varlıkları döndürür.
     Uzak (ağ) kullanıcıda kendi hareketi (atılım/kızak/süzülüş/hız) uygulanmaz; alan etkileri yalnızca yerel yetkililere işler. */
  function castAbility(r, p) {
    const out = [], own = !isRemote(r);
    const cx = p.x, cy = p.y, fy = p.fy != null ? p.fy : cy + RH / 2, k = abK(r);
    const d = AIM_ABS[r.id] ? dirOf(p.ax, p.ay) : null;
    if (S.mode !== 'demo' && r === S.player) FM.fx.toast(`${FM.CH[r.id].ab}!`, FM.CH[r.id].col2);   // yalnızca kendi gücün: ekran dolmasın
    switch (r.id) {
      case 'TAFTAF': {
        if (own) {
          const v = dashVec(d);
          r.dashX = v.x; r.dashY = v.y; r.dash = dashDur(r, v); r.climb = false; if (r.slide) setSlide(r, false);
          // yukarı atılım: yerden kalkar, bitince çift zıplama hakkı kalır (güvenli iniş)
          if (v.y < -.2) { r.jumps = Math.min(r.jumps, 1); r.onGround = false; r.slam = false; r.slamPerf = false; }
        }
        FM.fx.burst(cx, cy, ['#5b2a86', '#c9a0ff'], 16, 200, 0, 'star');
        break;
      }
      case 'Caner': {
        const tgt = p.tgt;
        if (tgt) for (let i = 0; i < 3; i++) { const e = { type: 'crow', x: cx - 10 * i, y: cy - 20 - i * 12, tgt, o: r, life: 3.5, first: i === 0, ph: i, age: 0, dur: 2.0 * k, fx: cxOf(tgt) < cx ? -1 : 1 }; S.ents.push(e); out.push(e); }
        else { if (own) r.boost = 2.2 * k; FM.fx.burst(cx, cy, ['#c0182e', '#1d1d26'], 16, 220); }
        break;
      }
      case 'LUL': {
        const rad = 340 * k;
        for (const q of S.racers) if (q !== r && Math.abs(cxOf(q) - cx) < rad && Math.abs(cyOf(q) - cy) < 130 && q.onGround) harm(q, 'stun', 1.7 * k, r, 'LUL');
        FM.fx.ring(cx, fy, rad, '#8fa8dd', .6, 10); FM.fx.burst(cx, fy, ['#8a6a3a', '#dddddd'], 24, 300); FM.fx.puff(cx, fy, 14, 'rgba(200,180,150,.8)', 16, 220);
        if (near(r)) FM.fx.shake(.25);
        break;
      }
      case 'ertan': if (own) { r.sled = 1.25 * k; if (r.onGround) setSlide(r, true); } FM.fx.burst(cx, cy + 10, ['#bfefff', '#ffffff'], 14, 160, 200, 'ice'); break;
      case 'Kral': {
        const rad = 420 * k;
        for (const q of S.racers) {
          if (q === r) continue;
          const dx = cxOf(q) - cx, dy = cyOf(q) - cy;
          // varsayılan: öndeki yakın rakipler (eski kutu); nişanlı: koni nişan yönüne (ileri/geri/yukarı)
          if (d ? inCone(dx, dy, d, rad, KRAL_SPREAD) : (dx > -60 && dx < rad && Math.abs(dy) < 200)) harm(q, 'knock', 1.0 * k, r, 'Kral');
        }
        S.ents = S.ents.filter(e => {
          if (e.o === r || e.type === 'bolt' || e.type === 'mag' || e.type === 'frost' || e.type === 'inkw' || e.type === 'meteor') return true;   // alan etkileri nesne değil
          const ex = e.type === 'trap' || e.type === 'net' ? e.x + e.w / 2 : e.x, ey = e.type === 'trap' || e.type === 'net' ? e.y + e.h / 2 : e.y;
          if (Math.hypot(ex - cx, ey - cy) < rad + 40) { FM.fx.burst(ex, ey, ['#ffd23f', '#ffffff'], 8); return false; }
          return true;
        });
        FM.fx.ring(cx, cy, rad, '#ffd23f', .6, 10);
        if (d) FM.fx.burst(cx + d.x * 70, cy + d.y * 70, ['#ffd23f', '#ffffff', '#ff9e3d'], 14, 360, 0, 'star', 4);
        break;
      }
      case 'Nuss': {
        if (own) {
          // nişan: yukarı → varsayılan kadar yüksek kalkış, ileri → alçak ve daha hızlı süzülüş (nişansız: eskisi gibi)
          const up = d ? clamp(-d.y, 0, 1) : -1;
          r.fly = 2.4 * k; r.vy = nussVy(up); r.flyMul = nussMul(up);
          r.climb = false; if (r.slide) setSlide(r, false);
        }
        FM.fx.burst(cx, cy, ['#ffffff', '#7be3ff'], 16, 200, 100, 'leaf');
        break;
      }
      case 'baso': {
        const v = waveVec(d);
        const e = { type: 'wave', x: cx + v.x * r.w / 2, y: cy, o: r, life: 1.15 * k, hit: [], age: 0, dur: 3.2 * k, vx: v.x * WAVE_V, vy: v.y * WAVE_V };
        if (d) { e.aim = aimTag(d); e.dir = v.x < 0 ? -1 : 1; }
        S.ents.push(e); out.push(e);
        break;
      }
    }
    return out;
  }

  /* =================== VARLIK HAREKETİ (gerçek varlık ve önizleme/yapay zekâ simülasyonu AYNI fonksiyonları kullanır) ===================
     sol(px, py) → nokta katının içinde mi (gerçekte solidAt; önizlemede yakın katılarla aynı test). */
  /* Testere: yerde yuvarlanır (yokuş çıkar/iner; e.gr = yerde), duvardan seker. Yokuş aşağı yüzeye yapışır (|vx|·dt + 3 px):
     sekip havalanmaz, zıplayarak kaçılacak yükseklikte kalır. İlk adımda zemine gömülü doğduysa (yokuşta atan) önce üstüne çıkar. */
  function moveSaw(e, dt, sol) {   // true = duvardan sekti
    if (!e.mv) { e.mv = 1; let k = 0; while (sol(e.x, e.y + e.r) && k < 40) { e.y -= 1; k++; } if (k) e.gr = 1; }
    e.vy = Math.min(1500, e.vy + G * dt);
    e.x += e.vx * dt;
    let wall = false;
    if (sol(e.x + Math.sign(e.vx) * e.r, e.y - 3)) { e.vx = -e.vx * .9; e.x += e.vx * dt * 2; e.b++; wall = true; }
    e.y += e.vy * dt;
    if (e.vy < 0 && sol(e.x, e.y - e.r)) { e.y -= e.vy * dt; e.vy = 0; }   // yukarı atış tavana çarptı
    if (e.vy > 0 && sol(e.x, e.y + e.r)) { let k = 0; while (sol(e.x, e.y + e.r) && k < 60) { e.y -= 1; k++; } e.vy = 0; e.gr = 1; }
    else if (e.gr && e.vy > 0) {
      const d = Math.abs(e.vx) * dt + 3; let k = 1;
      while (k <= d && !sol(e.x, e.y + e.r + k)) k++;
      if (k <= d) { e.y += k - 1; e.vy = 0; } else e.gr = 0;   // yüzey snap mesafesinden derinde: kenardan düşer
    }
    return wall;
  }
  function moveDyn(e, dt, sol) {
    e.vy = Math.min(1500, e.vy + G * dt);
    e.x += e.vx * dt;
    if (sol(e.x, e.y)) { e.x -= e.vx * dt; e.vx = -e.vx * .4; }
    e.y += e.vy * dt;
    if (e.vy < 0 && sol(e.x, e.y - 6)) { e.y -= e.vy * dt; e.vy = 0; }
    if (e.vy > 0 && sol(e.x, e.y + 6)) { let k = 0; while (sol(e.x, e.y + 6) && k < 60) { e.y -= 1; k++; } e.vy = -e.vy * .3; e.vx *= .55; }
  }
  /* Düşen eşya (tuzak / ağ; bırakılan ya da fırlatılan): yerçekimi, duvardan sekme, tavana çarpma. Alt-orta noktası bir katının
     ÜST yüzeyine değince o yüzeye oturur (e.y = üst − h), sabitlenir: true döner. İlk adımda zemine gömülü doğduysa (kayan/
     yerdeki atan) doğrudan o katının üstüne oturur. Havada asla durmaz. sol(px, py) → katı nesnesi | null. */
  // yokuşa oturan tuzak/ağın eğim açısı (radyan, + = sağa doğru iniş; çizim bu açıyla döndürür). Düz zeminde 0.
  const dropAng = s => s.y2 == null ? 0 : Math.round(Math.atan(slopeOf(s)) * 100) / 100;
  function moveDrop(e, dt, sol) {
    const first = !e.mv; e.mv = 1;
    if (first) {
      const s0 = sol(e.x + e.w / 2, e.y + e.h);
      if (s0) {
        const t0 = topAt(s0, e.x + e.w / 2);
        if (!e.vx && !e.vy) { e.y = t0 - e.h; e.fly = false; e.ang = dropAng(s0); return true; }   // bırakılan: zaten zeminde → hemen oturur
        if (t0 > e.y + e.h - 48) e.y = t0 - e.h - 1;                          // fırlatılan: zemine gömülü doğduysa üstüne kaldır, uçmaya devam
      }
    }
    e.vy = Math.min(1500, e.vy + G * dt);
    if (e.vx) {
      const nx = e.x + e.vx * dt, fx = e.vx > 0 ? nx + e.w : nx;
      if (sol(fx, e.y + e.h * .5) || sol(fx, e.y + e.h - 3)) e.vx = -e.vx * .3; else e.x = nx;
    }
    const cx = e.x + e.w / 2, b0 = e.y + e.h;
    e.y += e.vy * dt;
    if (e.vy < 0) { if (sol(cx, e.y)) { e.y -= e.vy * dt; e.vy = 0; } return false; }
    const s = sol(cx, e.y + e.h);
    if (s) { const t = topAt(s, cx); if (t >= b0 - 6) { e.y = t - e.h; e.vx = e.vy = 0; e.fly = false; e.ang = dropAng(s); return true; } }
    return false;
  }
  // sıvıya battı mı (eşya kaybolur)
  const sunk = e => (e.type === 'trap' || e.type === 'net' ? e.y + e.h * .5 : e.y) > S.L.liq + 8;
  // sıvıya düşen eşya: buhar + kıvılcım, 'fizzle {e, type, x, y}' olayı (ses/efekt için)
  function fizzle(e) {
    e.dead = true; e.fizz = true;
    const x = e.type === 'trap' || e.type === 'net' ? e.x + e.w / 2 : e.x, y = S.L.liq;
    if (near({ x: x - 14, w: 28 })) {
      FM.fx.puff(x, y - 4, 8, 'rgba(235,240,255,.85)', 12, 70);
      FM.fx.sparks(x, y - 6, e.type === 'net' ? 14 : 7, e.type === 'net' ? '#7be3ff' : '#ffd23f', 260);
    }
    FM.emit('fizzle', { e, type: e.type, x, y });
  }
  // gerçek oyunda nokta → katı nesnesi (düşen eşyanın oturacağı yüzey)
  function solidOf(px, py) { for (const s of S.L.solids) if (inSolid(s, px, py)) return s; return null; }
  // yakın katılar (önizleme/simülasyon hızlı olsun) ve onlarla nokta testi (katı nesnesi | null döner)
  function solTest(x0, x1) {
    const list = [];
    for (const s of S.L.solids) if (s.x < x1 && s.x + s.w > x0) list.push(s);
    return (px, py) => { for (let i = 0; i < list.length; i++) { const s = list[i]; if (inSolid(s, px, py)) return s; } return null; };
  }
  // önizleme/simülasyon noktası: tuzak ve ağda TABAN (iniş halkası zemine düşsün), diğerlerinde merkez
  const entPt = e => e.type === 'trap' || e.type === 'net' ? [e.x + e.w / 2, e.y + e.h - 6] : [e.x, e.y];
  /* Atılan eşyanın yolunu GERÇEK hareket fonksiyonlarıyla simüle eder. rec: yol noktalarını kaydet (≤ ~26 nokta).
     probe(e, t) true dönerse durur (yapay zekâ / nişan yardımı isabet testi). Sonuç: {pts, ok, x, y, t, hit}
     Durma: testere ilk duvar sekmesinde, dinamit fitil bitince (patlama noktası), tuzak yere oturunca, ağ durunca; sıvıya düşen durur. */
  function simThrow(r, it, p, rec, probe) {
    const e = mkThrown(r, it, p), res = { pts: rec ? [] : null, ok: false, x: 0, y: 0, t: 0, hit: null };
    if (!e || !S.L) return res;
    const span = it === 'saw' ? 1100 : 800;
    const sol = solTest(Math.min(e.x, cxOf(r)) - span, Math.max(e.x, cxOf(r)) + span);
    const drop = it === 'trap' || it === 'net';
    const T = it === 'saw' ? .8 : it === 'dyn' ? e.fuse : 2.5, dt = C.STEP;
    const every = Math.max(1, Math.round((drop ? .9 : T) / dt / 22));
    let t = 0, n = 0, stop = false, ok = !drop;
    if (rec) { const q = entPt(e); res.pts.push([r1(q[0]), r1(q[1])]); }
    while (t < T && !stop) {
      t += dt; n++;
      if (it === 'saw') stop = moveSaw(e, dt, sol);
      else if (it === 'dyn') moveDyn(e, dt, sol);
      else if (moveDrop(e, dt, sol)) { ok = true; stop = true; }
      if (sunk(e)) { stop = true; ok = false; res.sunk = true; }
      if (probe && probe(e, t)) { res.hit = true; stop = true; }
      if (rec && (stop || n % every === 0)) { const q = entPt(e); res.pts.push([r1(q[0]), r1(q[1])]); }
    }
    if (rec && res.pts.length < 2) { const q = entPt(e); res.pts.push([r1(q[0]), r1(q[1])]); }
    const q = entPt(e); res.x = q[0]; res.y = q[1]; res.t = t; res.ok = ok;
    return res;
  }

  /* =================== NİŞAN: önizleme, nişan yardımı, yönlü mü? =================== */
  /* aimPreview(r, kind, ax, ay) → { kind, key, shape: 'arc'|'line'|'cone'|'target'|'none', pts, cone, tgt, ok, ax, ay }
     Gerçek fizikle (aynı sabitler ve hareket fonksiyonları) hesaplanır. ok=false: şu an kullanılamaz (kilit, hedef yok, dolmadı…). */
  function aimPreview(r, kind, ax, ay) {
    const A = { kind, key: null, shape: 'none', pts: null, cone: null, tgt: null, ok: false, ax: 0, ay: 0 };
    if (!r || !S.L) return A;
    const d = aimDir(ax, ay);
    if (d) { A.ax = d.x; A.ay = d.y; }
    const alive = r.dead <= 0 && !r.finished && !r.out && S.mode === 'race';   // geri sayımda nişan alınabilir ama atılamaz
    const cx = cxOf(r), cy = cyOf(r);
    if (kind === 'item') {
      const it = r.item; A.key = it || null;
      if (!it) return A;
      A.ok = alive && !attackLocked(it);
      if (!AIM_ITEMS[it]) return A;
      if (it === 'mis') { const p = itemParams(r, it, d); A.shape = 'target'; A.tgt = p ? p.tgt : null; if (!A.tgt) A.ok = false; return A; }
      // gerçek yol: tuzak/ağ (bırakılan dahil) düşüp oturacağı yüzeye kadar; sıvıya düşecekse ok=false (eşya kaybolur)
      const p = throwParams(r, it, d);
      const sim = simThrow(r, it, p, true);
      A.pts = sim.pts; A.shape = it === 'saw' && !p.vy ? 'line' : 'arc';
      if ((it === 'trap' || it === 'net') && A.pts.length && Math.hypot(A.pts[0][0] - cx, A.pts[0][1] - cy) > 20) A.pts.unshift([r1(cx), r1(cy)]);   // elden çıkış
      if (!sim.ok) A.ok = false;
      A.land = sim.ok && (it === 'trap' || it === 'net') ? [r1(sim.x), r1(sim.y)] : null;
      return A;
    }
    // özel güç
    A.key = r.id;
    A.ok = alive && r.charge >= 100;
    if (!AIM_ABS[r.id]) return A;
    const k = abK(r);
    switch (r.id) {
      case 'Caner': A.tgt = canerTarget(r, d); A.shape = A.tgt ? 'target' : 'none'; break;
      case 'Kral': A.shape = 'cone'; A.cone = d ? { x: r1(cx), y: r1(cy), ang: r2(Math.atan2(d.y, d.x)), spread: KRAL_SPREAD, len: 420 * k } : { x: r1(cx), y: r1(cy), ang: 0, spread: .45, len: 420 * k }; break;
      case 'baso': {
        const v = waveVec(d), len = WAVE_V * 1.15 * k, x0 = cx + v.x * r.w / 2;
        A.shape = 'line'; A.pts = [];
        for (let i = 0; i <= 12; i++) A.pts.push([r1(x0 + v.x * len * i / 12), r1(cy + v.y * len * i / 12)]);
        break;
      }
      case 'TAFTAF': {
        const v = dashVec(d), dur = dashDur(r, v), sp = RUN * DASH_V, sol = solTest(cx - 200, cx + sp * dur + 200);
        let x = cx, y = cy; A.shape = 'line'; A.pts = [[r1(x), r1(y)]];
        for (let i = 1; i <= 20; i++) {
          const nx = x + v.x * sp * dur / 20, ny = y + v.y * sp * dur / 20;
          if (sol(nx + v.x * 14, ny + v.y * 21) || sol(nx + 14, ny)) {
            if (!sol(x, ny + v.y * 21) && v.y < 0) { y = ny; A.pts.push([r1(x), r1(y)]); continue; }   // duvar boyunca yukarı kayar
            break;
          }
          x = nx; y = ny;
          if (i % 2 === 0) A.pts.push([r1(x), r1(y)]);
        }
        if (A.pts.length < 2) A.pts.push([r1(x + 1), r1(y)]);
        break;
      }
      case 'Nuss': {
        const up = d ? clamp(-d.y, 0, 1) : -1, mul = nussMul(up);
        let x = cx, y = cy, vx = Math.max(0, r.vx), vy = nussVy(up);
        const sol = solTest(cx - 100, cx + 900), dt = 1 / 60, tgt = RUN * mul;
        A.shape = 'arc'; A.pts = [[r1(x), r1(y)]];
        for (let i = 1; i <= 84; i++) {
          vx += clamp(tgt - vx, -AIRACC * 1.6 * dt, AIRACC * dt);
          vy = Math.min(90, vy + G * (vy < 0 ? NUSS_UP_G : .12) * (inLowG(x) ? LOWG : 1) * dt);
          x += vx * dt; y += vy * dt;
          if (sol(x + 14, y) || sol(x, y + 21)) { A.pts.push([r1(x), r1(y)]); break; }
          if (i % 4 === 0) A.pts.push([r1(x), r1(y)]);
        }
        break;
      }
    }
    return A;
  }
  game.aimPreview = aimPreview;
  // yerel oyuncunun elindeki eşya (kind 'item') / gücü (kind 'ab') yönlü mü? (arayüz: false ise nişan çizgisi yok, basınca hemen kullan)
  game.aimable = function (kind) {
    const P = S.player;
    if (!P || P.ghost || P.out || P.spec || P.ctrl === 'spec') return false;
    if (kind === 'ab') return !!AIM_ABS[P.id] && P.charge >= 100;
    return !!(P.item && AIM_ITEMS[P.item]);
  };
  game.AIM_ITEMS = AIM_ITEMS; game.AIM_ABS = AIM_ABS;
  /* Nişan yardımı (dokunmatikte varsayılan açık; FM.save.settings.aimAssist): nişanın ±15° çevresinde, GERÇEK yolu simüle
     edilen atışın isabet ettiği en yakın açıya çeker (testere, dinamit), baso dalgasını yöndeki rakibe çevirir. */
  const ASSIST_LIM = .27;
  function assistOn() { const s = FM.save && FM.save.settings, v = s ? s.aimAssist : undefined; return v === undefined || v === null ? !!FM.isTouch : !!v; }
  // atış rakiplerden birine isabet eder mi? (testere: yolda temas; dinamit: patlama alanında, atan güvende)
  function throwHits(r, it, d, rivals) {
    const p = throwParams(r, it, d); if (!p) return null;
    let got = null;
    if (it === 'saw') {
      simThrow(r, it, p, false, (e, t) => {
        for (const q of rivals) { const tx = cxOf(q) + q.vx * t, ty = cyOf(q); if (Math.abs(tx - e.x) < e.r + 16 && Math.abs(ty - e.y) < e.r + 22) { got = q; return true; } }
        return false;
      });
      return got;
    }
    if (it === 'dyn') {
      const s = simThrow(r, it, p, false), T = s.t, rad = 95 + 14;
      if (Math.hypot(cxOf(r) + Math.max(0, r.vx) * T - s.x, cyOf(r) - s.y) < rad + 25) return null;   // kendini vurmasın
      for (const q of rivals) if (Math.hypot(cxOf(q) + q.vx * T - s.x, cyOf(q) - s.y) < rad - 25) return q;
    }
    return null;
  }
  function assistAim(r, kind, ax, ay) {
    const res = { ax: +ax || 0, ay: +ay || 0, snap: null };
    const d = dirOf(ax, ay);
    if (!d || !r || r.bot || !assistOn() || !S.L) return res;
    const key = kind === 'item' ? r.item : AIM_ABS[r.id] ? r.id : null;
    if (key !== 'saw' && key !== 'dyn' && key !== 'baso') return res;
    const rivals = S.racers.filter(q => q !== r && q.dead <= 0 && !q.finished && !q.out && Math.abs(q.x - r.x) < 950);
    if (!rivals.length) return res;
    const a0 = Math.atan2(d.y, d.x);
    if (key === 'baso') {
      const v0 = waveVec(d); let best = null, bd = ASSIST_LIM, ba = 0;
      for (const q of rivals) {
        const dx = cxOf(q) - cxOf(r), dy = cyOf(q) - cyOf(r), t = Math.abs(dx) / WAVE_V;
        if (Math.sign(dx) !== Math.sign(v0.x)) continue;
        const a = Math.atan2(dy, dx + q.vx * t), df = Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0)));
        if (df < bd) { bd = df; best = q; ba = a; }
      }
      if (best) { res.ax = r2(Math.cos(ba)); res.ay = r2(Math.sin(ba)); res.snap = best; }
      return res;
    }
    // balistik arama: önce nişanın kendisi, sonra ±0.025 rad adımlarla dışa doğru (dinamitin isabet penceresi dar)
    for (let i = 0; i <= 22; i++) {
      const kk = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * .025;
      if (Math.abs(kk) > ASSIST_LIM) break;
      const a = a0 + kk, dd = aimDir(Math.cos(a), Math.sin(a));
      const q = throwHits(r, key, dd, rivals);
      if (q) { if (i > 0) { res.ax = dd.x; res.ay = dd.y; } res.snap = q; break; }
    }
    return res;
  }
  game.assistAim = assistAim;
  /* aim:start/aim:end (yerel oyuncu; ses için) — FM.input.aim geçişleri. game.step ve updateAim çağırır (darbe tüketilmeden önce). */
  let aimPrev = null;
  function trackAim() {
    const I = FM.input, cur = I && (I.aim === 'item' || I.aim === 'ab') ? I.aim : null;
    if (cur === aimPrev) return;
    if (aimPrev) {
      const P = S.player, pulse = aimPrev === 'item' ? I.use : I.ab;
      const can = !!P && S.mode === 'race' && P.dead <= 0 && !P.finished && !P.out && (aimPrev === 'item' ? !!P.item && !attackLocked(P.item) : P.charge >= 100);
      FM.emit('aim:end', { kind: aimPrev, fired: !!pulse && can });
    }
    if (cur) FM.emit('aim:start', { kind: cur });
    aimPrev = cur;
  }
  // her karede (main.js): yerel oyuncu nişan alıyorsa FM.S.aim = önizleme, almıyorsa null.
  // Nişan yardımı araması pahalı (birkaç simülasyon): nişan pek değişmediyse 0.1 sn boyunca önceki sonuç kullanılır.
  let asC = null;
  /* Oyuncunun ham nişanı (parmak sürükleme / ok tuşları) → mantıklı atış yönü. Yukarı sürüklemek "ileri-yukarı kavis"
     demektir (dimdik yukarı atış yok: başparmak sağ alttan yukarı-sola kaysa da ileri atar); yalnızca belirgin sola çekmek
     geriye atar; aşağı sürüklemek alçaktan/yerden ileri. Yükseliş -15°..65° arasında kalır. */
  function humanAim(ax, ay) {
    const l = Math.hypot(ax, ay); if (!(l > .05)) return { ax: 0, ay: 0 };
    const x = ax / l, y = ay / l, back = x < -.6;
    const el = clamp(Math.asin(clamp(-y, -1, 1)), -.26, 1.13);
    return { ax: r2((back ? -1 : 1) * Math.cos(el)), ay: r2(-Math.sin(el)) };
  }
  game.humanAim = humanAim;
  game.updateAim = function () {
    trackAim();
    const I = FM.input, P = S.player, kind = I && I.aim;
    if ((kind !== 'item' && kind !== 'ab') || I.cancel || !P || P.ghost || P.out || !S.L || !(S.mode === 'race' || S.mode === 'count')) { S.aim = null; asC = null; return null; }   // I.cancel: arayüzde İPTAL seçili → önizleme yok
    const ck = kind + ':' + (kind === 'item' ? P.item : P.id), h = humanAim(+I.ax || 0, +I.ay || 0), ax = h.ax, ay = h.ay;
    let a;
    if (asC && asC.k === ck && Math.abs(asC.ax - ax) < .015 && Math.abs(asC.ay - ay) < .015 && S.T - asC.t < .1 && S.T >= asC.t) a = asC.a;
    else { a = assistAim(P, kind, ax, ay); asC = { k: ck, ax, ay, t: S.T, a }; }
    const A = aimPreview(P, kind, a.ax, a.ay);
    A.rax = I.ax || 0; A.ray = I.ay || 0; A.assist = a.snap || null;
    S.aim = A;
    return A;
  };
  /* =================== TEHDİTLER (yaklaşan atış uyarısı; yalnızca okuma) ===================
     FM.S.threats = [{x, y, kind, dir, eta, e}] — YEREL oyuncuya yaklaşan atış/etki (eta küçükten büyüğe, en fazla 8).
       kind: 'saw' | 'dyn' | 'mis' | 'crow' | 'wave' | 'bolt' | 'ice' | 'ink' | 'meteor'
       x, y: tehlikenin dünya konumu (bolt'ta oyuncunun tepesi);  dir: -1 arkadan, 1 önden, 0 yukarıdan / yerinde
       eta : isabete kalan tahmini süre (sn, ≤ THR_T; 2 ondalık);  e: varlığın kendisi (çizim için; DEĞİŞTİRME)
     Bir varlık ilk kez listeye girince bir kez FM.emit('threat', {kind, x, y, dir, eta, e}) (ses/titreşim). Oyunu etkilemez
     (ağda determinizm bozulmaz); main.js her çizilen karede çağırır. Kendi atışın senin için tehdit değildir. */
  const THR_T = 2.2, thrPool = [];
  game.updateThreats = function () {
    const out = S.threats || (S.threats = []); out.length = 0;
    const P = S.player;
    if (!P || !S.L || P.dead > 0 || P.finished || P.out || P.ghost || S.mode !== 'race') return out;
    const px = cxOf(P), py = cyOf(P), pvx = P.vx || 0;
    const put = (e, kind, x, y, eta, dir) => {
      if (!(eta >= 0 && eta <= THR_T) || out.length >= 8) return;
      const t = thrPool[out.length] || (thrPool[out.length] = {});
      t.x = x; t.y = y; t.kind = kind; t.dir = dir; t.eta = Math.round(eta * 100) / 100; t.e = e;
      out.push(t);
      if (!e.thr) { e.thr = 1; FM.emit('threat', { kind, x, y, dir, eta: t.eta, e }); }
    };
    // yatay yaklaşan (testere, dalga): yaklaşma hızı ve mesafeden varış süresi
    const horiz = (e, kind, vx, pad) => {
      const dx = e.x - px, cl = dx < 0 ? vx - pvx : pvx - vx;
      if (cl > 30) put(e, kind, e.x, e.y, Math.max(0, Math.abs(dx) - pad) / cl, dx < 0 ? -1 : 1);
    };
    for (const e of S.ents) {
      if (e.dead) continue;
      switch (e.type) {
        case 'saw': if (e.o !== P && Math.abs(e.y - py) < 150) horiz(e, 'saw', e.vx, 30); break;
        case 'wave': if (e.o !== P && !e.hit.includes(P) && Math.abs(e.y - py) < 110) horiz(e, 'wave', e.vx != null ? e.vx : WAVE_V, 24); break;
        case 'dyn': {
          if (e.o === P) break;
          const rem = Math.max(0, e.fuse - e.age), qx = px + pvx * rem;   // patladığı anda neredesin
          if (Math.hypot(e.x - qx, e.y - py) < 95 + 14 + 70) put(e, 'dyn', e.x, e.y, rem, Math.abs(e.x - px) < 30 ? 0 : e.x < px ? -1 : 1);
          break;
        }
        case 'mis': {
          if (e.tgt !== P) break;
          const d = Math.hypot(e.x - px, e.y - py);
          put(e, 'mis', e.x, e.y, (e.age < e.warn ? e.warn - e.age : 0) + d / Math.max(700, Math.hypot(e.vx, e.vy)), Math.abs(e.x - px) < 30 ? 0 : e.x < px ? -1 : 1);
          break;
        }
        case 'crow': if (e.tgt === P && e.first) put(e, 'crow', e.x, e.y, Math.hypot(e.x - px, e.y - py) / 820, Math.abs(e.x - px) < 30 ? 0 : e.x < px ? -1 : 1); break;
        case 'bolt': if (e.tgt === P) put(e, 'bolt', px, P.y - 160, e.t, 0); break;
        case 'frost': {
          if (e.o === P || e.hit.includes(P)) break;
          const d = Math.hypot(px - e.x, py - e.y);
          if (d < e.rmax) put(e, 'ice', e.x, e.y, e.age < FROST_WIND ? FROST_WIND - e.age + d / FROST_SP : Math.max(0, d - e.r) / FROST_SP, e.x < px ? -1 : 1);
          break;
        }
        case 'inkw': if (e.o !== P && !e.hit.includes(P) && P.x > e.rx && px > e.x) put(e, 'ink', e.x, e.y, (px - e.x) / Math.max(1, INK_SP - pvx), -1); break;
        case 'meteor': if (Math.abs(e.x - (px + pvx * e.t)) < e.r + 60 && Math.abs(e.y - (P.y + P.h)) < 140) put(e, 'meteor', e.x, e.y, e.t, 0); break;
      }
    }
    if (out.length > 1) out.sort((a, b) => a.eta - b.eta);
    return out;
  };
  /* =================== İPUCU: sıradaki engelde ne yapmalı (yalnızca okuma) ===================
     FM.S.hint = { act, x, y, dist, eta, kind } | null — YEREL oyuncunun önünde, HINT_T sn içindeki ilk eylem isteyen engel
     (dev/obstacles.js'deki "doğru cevap" ile aynı):
       act : 'jump' zıpla | 'slide' kay | 'climb' zıpla + basılı tut (duvara tırman) | 'dbl' çift zıpla (geniş hendek)
       kind: 'spikes' diken | 'wall' duvar/yüksek basamak | 'ditch' hendek | 'crush' ezici | 'saw' testere makinesi | 'boulder' kaya
             | 'sand' küçük bataklık | 'trap' tuzak | 'net' ağ | 'rollsaw' sana yuvarlanan testere
       x, y: engelin başladığı dünya noktası (ikon/işaret için; y = engel tepesi ya da kenar zemini)
       dist: oyuncunun önünden engele px (≥ 0; içindeyken 0);  eta: varış süresi (sn, 2 ondalık)
     Oyunu etkilemez (ağda determinizm bozulmaz); main.js her çizilen karede çağırır. Kısa pencere taranır (~1.6 sn koşu). */
  const HINT_T = 1.6;
  const hintO = { act: '', x: 0, y: 0, dist: 0, eta: 0, kind: '' };
  // ex'te biten / başlayan (düz ya da eğimli) zemin bloğunun o kenardaki yüzeyi
  const edgeTop = (s, ex, end) => { for (const q of S.L.solids) if (!q.float && q !== s && Math.abs((end ? q.x + q.w : q.x) - ex) < 1) return topAt(q, ex); return null; };
  game.updateHint = function () {
    const P = S.player, L = S.L;
    if (!P || !L || P.dead > 0 || P.finished || P.out || P.ghost || S.mode !== 'race') return (S.hint = null);
    const fx = P.x + P.w, feet = P.y + P.h, cx = cxOf(P), v = Math.max(160, P.vx || 0), x1 = fx + v * HINT_T + 20;
    let bt = HINT_T + 1e-6, ba = '', bk = '', bx = 0, by = 0, bd = 0;
    const cand = (act, kind, x, y, d, eta) => { d = Math.max(0, d); if (eta == null) eta = d / v; if (eta < bt) { bt = eta; ba = act; bk = kind; bx = x; by = y; bd = d; } };
    for (const s of L.spikes) if (s.x <= x1 && s.x + s.w >= fx - 6 && Math.abs(s.y + s.h - feet) < 60) cand('jump', 'spikes', s.x, s.y, s.x - fx);
    for (const k of L.crush) if (k.x <= x1 && k.x + k.w >= P.x && Math.abs(k.y + k.h + 26 - feet) < 40) cand('slide', 'crush', k.x, k.y + k.h, k.x - fx);
    for (const q of L.saws) if (q.cx - q.r <= x1 && q.cx + q.r >= P.x && Math.abs(q.cy + 80 - feet) < 40) cand('slide', 'saw', q.cx - q.r, q.py, q.cx - q.r - fx);
    for (const q of L.quicksand) if (q.w < 260 && q.x <= x1 && q.x >= fx - 6 && Math.abs(q.y - feet) < 30) cand('jump', 'sand', q.x, q.y, q.x - fx);
    // duvar / yüksek basamak / hendek: zemin bloklarının birleşim yerleri (≤ 46 px basamağa kendiliğinden çıkılır)
    for (const s of L.solids) {
      if (s.float || s.x > x1 || s.x < fx - 4) continue;
      const lt = edgeTop(s, s.x, true);
      if (lt === null || Math.abs(lt - feet) > 90) continue;
      const face = topAt(s, s.x), lip = lt - face;
      if (lip > 46) cand(lip <= 120 ? 'jump' : 'climb', 'wall', s.x, face, s.x - fx);
      else if (lip < -60 && s.y2 == null && s.w <= 260) {
        const rt = edgeTop(s, s.x + s.w, false);
        if (rt !== null && Math.abs(rt - lt) < 50) cand(s.w > 190 ? 'dbl' : 'jump', 'ditch', s.x, lt, s.x - fx);
      }
    }
    for (const b of L.boulders) {
      if (fx < b.x0 - 60 - v * .9 || P.x > b.x1 + 2 * b.r || Math.abs(b.y - feet) > 40) continue;
      const tc = boulderContact(b, P);
      if (tc >= 0) cand('jump', 'boulder', b.bx != null ? b.bx : b.x1, b.y, Math.max(0, (b.bx != null ? b.bx : b.x1) - b.r - fx), tc);
    }
    for (const e of S.ents) {
      if ((e.type === 'trap' || e.type === 'net') && !e.fly && !e.dead && e.o !== P && e.x <= x1 && e.x + e.w >= fx - 6 && Math.abs(e.y + e.h - feet) < 30) cand('jump', e.type, e.x, e.y, e.x - fx);
      else if (e.type === 'saw' && e.o !== P && !e.dead && Math.abs(e.y + e.r - feet) < 40) {
        const dx = e.x - cx, cl = dx < 0 ? e.vx - P.vx : P.vx - e.vx;
        if (cl > 30) { const d = Math.max(0, Math.abs(dx) - e.r - P.w / 2); cand('jump', 'rollsaw', e.x, e.y, d, d / cl); }
      }
    }
    if (!ba) return (S.hint = null);
    hintO.act = ba; hintO.kind = bk; hintO.x = bx; hintO.y = by; hintO.dist = Math.round(bd); hintO.eta = Math.round(bt * 100) / 100;
    return (S.hint = hintO);
  };
  // bırakılan nişanın son yönü: ekranda görülen (yardımlı) yön aynen kullanılır; darbe tüketilince ham yön sıfırlanır
  function fireAim(r, kind) {
    const I = FM.input, A = S.aim;
    let ax = +I.ax || 0, ay = +I.ay || 0;
    if (A && A.kind === kind && A.rax === ax && A.ray === ay) { ax = A.ax; ay = A.ay; }
    else { const h = humanAim(ax, ay), a = assistAim(r, kind, h.ax, h.ay); ax = a.ax; ay = a.ay; }
    if (!I.aim) I.ax = I.ay = 0;
    return { ax, ay };
  }

  /* =================== VARLIKLAR =================== */
  function circleHit(e, q, rad) { const hx = clamp(e.x, q.x, q.x + q.w), hy = clamp(e.y, q.y, q.y + q.h); return (hx - e.x) ** 2 + (hy - e.y) ** 2 < rad * rad; }
  function updateEnts(dt) {
    try { for (const e of S.ents) { curEnt = e; updateEnt(e, dt); } } finally { curEnt = null; }
    S.ents = S.ents.filter(e => !e.dead && !(e.life !== undefined && e.life <= 0 && e.type !== 'bolt'));
  }
  function updateEnt(e, dt) {
    {
      e.age = (e.age || 0) + dt;
      switch (e.type) {
        case 'saw': {
          if (moveSaw(e, dt, solidAt)) { if (e.b > 2) e.life = 0; FM.fx.sparks(e.x, e.y, 6, '#ffe9a0', 260); }
          // yerde yuvarlanırken zeminden kıvılcım (uzaktan/telefonda da fark edilsin)
          else if (e.gr && ((e.age * 22) | 0) !== (((e.age - dt) * 22) | 0) && near({ x: e.x - 14, w: 28 })) FM.fx.sparks(e.x - Math.sign(e.vx) * e.r * .5, e.y + e.r - 1, 2, '#ffd27a', 150);
          if (sunk(e)) { fizzle(e); break; }
          e.life -= dt;
          if (e.life <= 0 && near({ x: e.x - 14, w: 28 })) FM.fx.sparks(e.x, e.y, 10, '#ffe9a0', 300);   // ömrü bitti: kırılır
          for (const q of S.racers) {
            if (q === e.o) continue;   // kendi testeren sana zarar vermez (yukarı/geri atılıp üstüne düşse de)
            // atılan testere en fazla 2 kişiyi biçer, sonra kırılır (10 kişilik sıkışık grupta katliam olmasın)
            if (circleHit(e, q, e.r - 2) && harm(q, 'kill', 0, e.o, 'saw') && (e.k = (e.k | 0) + 1) >= 2) { e.life = 0; FM.fx.sparks(e.x, e.y, 12, '#ffe9a0', 320); break; }
          }
          break;
        }
        case 'dyn': {
          moveDyn(e, dt, solidAt);
          if (sunk(e)) { fizzle(e); break; }   // sıvıya düşen dinamit söner
          if (e.age > e.fuse) { explode(e.x, e.y, 95, e.o, 'dyn'); e.dead = true; }
          break;
        }
        case 'trap': {
          e.life -= dt; if (e.life <= 0) e.dead = true;
          // düşen tuzak: yere oturana kadar kurulu değil (age 0'da tutulur); sıvıya düşerse kaybolur
          if (e.fly) { e.age = 0; moveDrop(e, dt, solidOf); if (sunk(e)) fizzle(e); break; }
          if (e.og > 0) e.og -= dt;
          if (e.age > .5) for (const q of S.racers) {
            if (q === e.o && e.og > 0) continue;
            if (q.dead <= 0 && ov(q, e) && !(q.sled > 0) && q.fly <= 0) {
              const hit = harm(q, 'kill', 0, e.o, 'trap');
              if (hit || q.dead > 0) { e.dead = true; e.snap = true; FM.fx.burst(e.x + 17, e.y, ['#888888', '#cccccc'], 10); FM.emit('trap:snap', { e, r: q }); break; }
            }
          }
          break;
        }
        case 'net': {
          e.life -= dt; if (e.life <= 0) e.dead = true;
          // düşen ağ: yere oturana kadar kurulu değil; oturduğu zemine dikilir, kısa süre sonra açılır
          if (e.fly) { e.age = 0; moveDrop(e, dt, solidOf); if (sunk(e)) fizzle(e); break; }
          if (e.age > .6) for (const q of S.racers) {
            if (q === e.o) continue;   // kendi ağın seni tutmaz (ileri fırlatılan ağın içinden geçebilirsin)
            if (q.dead <= 0 && q.netted <= 0 && ov(q, e) && !(q.sled > 0)) {
              if (harm(q, 'net', 1.5, e.o, 'net')) {
                e.n++;
                // yarışçı ağın ortasına çekilir; oraya sığmıyorsa (duvara tırmanırken yakalandı, yokuş) ağın tabanına oturtulur,
                // o da olmazsa yerinde tutulur (katıya gömülmesin)
                const nx = e.x + e.w / 2 - q.w / 2;
                if (boxFree(nx, q.y, q.w, q.h)) q.x = nx;
                else if (boxFree(nx, e.y + e.h - q.h - .5, q.w, q.h)) { q.x = nx; q.y = e.y + e.h - q.h - .5; }
                if (q.onGround) { const gy = groundY(cxOf(q), q.y + q.h - 40); if (gy !== null && Math.abs(gy - (q.y + q.h)) < 40) q.y = gy - q.h; }
                FM.fx.sparks(e.x + 22, e.y + 38, 10, '#7be3ff', 300); if (e.n >= 2) e.dead = true;
              }
            }
          }
          break;
        }
        case 'mis': {
          let t = e.tgt;
          if (!t || t.dead > 0 || t.finished) {
            // hedef öldü/bitirdi: geri atılmış füze arkadaki en yakını, ileri atılmış sahibi dışındaki lideri yeniden hedefler; kimse yoksa söner
            if (e.back) t = e.tgt = behindOf(e.o, 2600);
            else { const rk = ranking().filter(q => q !== e.o && !q.finished && q.dead <= 0); t = e.tgt = rk[0] || null; }
            if (!t) { e.dead = true; FM.fx.puff(e.x, e.y, 8, 'rgba(90,86,96,.8)', 12, 90); break; }
          }
          if (e.age < e.warn) { e.x = cxOf(e.o); e.y = e.o.y - 34; break; }
          const dx = cxOf(t) - e.x, dy = cyOf(t) - e.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(1250, 600 + (e.age - e.warn) * 900);
          e.vx = dx / d * sp; e.vy = dy / d * sp; e.x += e.vx * dt; e.y += e.vy * dt;
          if (d < 26 || e.age > 7) { explode(e.x, e.y, 70, e.o, 'mis'); e.dead = true; }
          break;
        }
        case 'bolt': {
          e.t -= dt;
          if (e.t <= 0) {
            const q = e.tgt;
            if (q.dead <= 0 && !q.finished) {
              // kalkan, balon ve dokunulmazlık korur
              harm(q, 'kill', 0, e.o, 'bolt');
              e.strike = cxOf(q); e.sy = q.y;
            }
            e.flash = .3; e.type = 'flash';
            if (q === S.player) FM.fx.flash('#ffffff', .6);
            FM.emit('bolt:strike', { r: q });
          }
          break;
        }
        case 'flash': { e.flash -= dt; if (e.flash <= 0) e.dead = true; break; }
        case 'meteor': {
          e.t -= dt;
          // yedek görsel: render-fx meteoru çizmiyorsa (FM.R.meteorFx yok) iniş noktasında kırmızı parıltı
          if (!(FM.R && FM.R.meteorFx) && near({ x: e.x, w: 0 }) && ((e.age * 8) | 0) !== (((e.age - dt) * 8) | 0)) FM.fx.glow(e.x, e.y - 6, 30 + 40 * (1 - e.t / e.max), 'rgba(255,70,30,0.9)', .2);
          if (e.t <= 0) {
            e.dead = true;
            explode(e.x, e.y - 8, e.r, null, 'meteor');
            FM.emit('meteor', { x: e.x, y: e.y });
          }
          break;
        }
        case 'frost': {
          // hazırlık: atanın çevresinde kar tanecikleri toplanır (okunur başlangıç), sonra buz dalgası yayılır
          if (e.age < FROST_WIND) {
            if (near(e.o) && ((e.age * 120) | 0) % 2 === 0) { const a = Math.random() * 6.283; FM.fx.p({ k: 'ice', x: e.x + Math.cos(a) * 95, y: e.y + Math.sin(a) * 70, vx: -Math.cos(a) * 420, vy: -Math.sin(a) * 320, life: .2, c: '#e6f8ff', s: 4, g: 0 }); }
            break;
          }
          const T = e.rmax / FROST_SP, k = Math.min(1, (e.age - FROST_WIND) / T);
          if (!e.go) {
            e.go = true;
            FM.fx.ring(e.x, e.y, e.rmax, '#bfefff', T, 16); FM.fx.burst(e.x, e.y, ['#bfefff', '#ffffff'], 22, 420, 0, 'ice');
            if (near(e.o)) FM.fx.shake(.12);
          }
          // cephe, render-fx halkasıyla aynı eğriyle büyür (easeOutCubic): ekranda gördüğün halka değince donarsın
          e.r = e.rmax * (.1 + .9 * (1 - Math.pow(1 - k, 3)));
          for (const q of S.racers) {
            if (q === e.o || e.hit.includes(q)) continue;
            if (Math.hypot(cxOf(q) - e.x, cyOf(q) - e.y) < e.r) { e.hit.push(q); harm(q, 'freeze', 2.2, e.o, 'ice'); }
          }
          if (k >= 1) e.dead = true;
          break;
        }
        case 'inkw': {
          // ileri fışkıran mürekkep cephesi: atanın önündeki, cephenin geçtiği herkes kararır
          e.x += INK_SP * dt;
          for (const q of S.racers) {
            if (q === e.o || e.hit.includes(q) || q.x <= e.rx) continue;
            if (cxOf(q) < e.x) { e.hit.push(q); if (harm(q, 'ink', 3.5, e.o, 'ink') && near(q)) FM.fx.burst(cxOf(q), cyOf(q), ['#1a1a2a', '#3b3b55'], 10, 220); }
          }
          if (near({ x: e.x - 14, w: 28 }) && ((e.age * 120) | 0) % 3 === 0) FM.fx.p({ k: 'puff', x: e.x, y: e.y + (Math.random() - .5) * 150, vx: -260, vy: (Math.random() - .5) * 60, life: .45, c: 'rgba(30,28,48,.85)', s: 14 + Math.random() * 12, g: 0, drag: 2 });
          if (e.x - e.rx > INK_R) e.dead = true;
          break;
        }
        case 'mag': {
          e.t -= dt;
          if (e.t <= 0) { for (const q of S.racers) { const d = q.x - e.o.x; if (q !== e.o && d > 0 && d < 800) harm(q, 'pull', .7, e.o, 'mag'); } FM.fx.ring(cxOf(e.o), cyOf(e.o), 200, '#c084fc', .5); e.dead = true; }
          break;
        }
        case 'crow': {
          const t = e.tgt; e.life -= dt;
          if (t.dead > 0 || t.finished || e.life <= 0) { e.dead = true; break; }
          const dx = cxOf(t) - e.x, dy = t.y - 6 - e.y, d = Math.hypot(dx, dy) || 1, sp = 820;
          e.x += dx / d * sp * dt; e.y += dy / d * sp * dt + Math.sin(e.age * 14 + e.ph) * 1.5; e.fx = Math.sign(dx) || 1;
          if (d < 22) { if (e.first) harm(t, 'stun', e.dur || 2.0, e.o, 'Caner'); FM.fx.burst(e.x, e.y, ['#1d1d26', '#c0182e'], 8, 200, 300, 'leaf'); e.dead = true; }
          break;
        }
        case 'wave': {
          e.x += (e.vx != null ? e.vx : WAVE_V) * dt; if (e.vy) e.y += e.vy * dt;
          e.life -= dt; if (e.life <= 0) e.dead = true;
          for (const q of S.racers) {
            if (q === e.o || e.hit.includes(q)) continue;
            // varsayılan (sağa): eski isabet penceresi; nişanlı dalga: merkezine yakın olanlar
            const inW = e.aim ? Math.abs(cyOf(q) - e.y) < 85 && Math.abs(cxOf(q) - e.x) < 32 : Math.abs(cyOf(q) - e.y) < 85 && q.x + q.w > e.x - 24 && q.x < e.x + 12;
            if (inW) { if (harm(q, 'slow', e.dur || 3.2, e.o, 'baso')) FM.fx.burst(cxOf(q), cyOf(q), ['#a855f7', '#3cb371'], 8, 200, 100, 'note'); e.hit.push(q); }
          }
          break;
        }
      }
    }
  }

  /* =================== YAPAY ZEKÂ =================== */
  function ai(r, dt) {
    const a = r.ai, c = r.ctl, L = S.L;
    a.skip = Math.max(0, a.skip - dt); a.itemT -= dt; a.slideT = Math.max(0, a.slideT - dt); a.coinT = (a.coinT || 0) - dt;
    c.jh = false; c.dh = a.slideT > 0;
    if (r.dead > 0 || r.finished) return;
    // insan oyuncunun epey önündeki bot biraz daha sık hata yapar (hafif lastik bant; tamamen bot yarışlarında etkisiz)
    const hum = S.player && !S.player.bot ? S.player : null;
    const fx = r.x + r.w, feet = r.y + r.h, cx = cxOf(r), err = r.inked > 0 ? .3 : (hum && r.x > hum.x + 300 ? .08 : .04);
    const decide = () => { if (a.skip > 0) return false; if (Math.random() < err) { a.skip = .3; return false; } return true; };
    if (r.blocked || r.climb || (!r.onGround && r.vy < 0)) c.jh = true;
    if (r.fly > 0) {
      if (r.vy > 40 && (!groundWithin(cx + 60, feet, 120) || r.vy > 80)) c.jp = Math.random() < .08;
    } else if (r.onGround || r.coy > 0) {
      let j = false, sl = false, need = false;
      // önde kayma engeli (ezici/testere makinesi) varken isteğe bağlı zıplama (altın, meteor, atılan nesne, kutu) yapılmaz:
      // havadan ezicinin altına inen ayakta ölür
      const slideAhead = L.crush.some(k => k.x + k.w > fx - 30 && k.x < fx + 230 && Math.abs(k.y + k.h + 26 - feet) < 30) || L.saws.some(s => s.cx + s.r > fx - 30 && s.cx - s.r < fx + 230 && Math.abs(s.cy + 80 - feet) < 30);
      if (!groundWithin(fx + 8, feet, 240, 20)) j = need = true;   // 20: yokuş yukarı yüzey (≤ .75 eğim) zıplatmaz
      else {
        // hendek/dar vadi: önde zemin birden derine iniyor ama karşı kenar aynı seviyede → atla (düşüp tırmanmak zaman kaybı)
        const g1 = groundY(fx + 12, feet - 4);
        if (g1 !== null && g1 - feet > 60) for (const D of [150, 190, 230]) { const g2 = groundY(fx + D, feet - 60); if (g2 !== null && Math.abs(g2 - feet) < 40) { j = need = true; break; } }
      }
      // diken: geniş grupta daha erken zıpla (zıplama penceresi 36 px'te 0..140, 108 px'te 0..68 px — ortasını hedefle)
      for (const s of L.spikes) { const dx = s.x - fx, lead = 64 - Math.max(0, s.w - 36) * .4; if (dx > -6 && dx < lead && Math.abs(s.y + s.h - feet) < 40) { j = need = true; break; } }
      for (const e of S.ents) {
        if (e.type === 'trap' || e.type === 'net') { const dx = e.x - fx; if (dx > -e.w && dx < 90 && e.y < feet + 4 && e.y + e.h > r.y - 40) j = true; }
        else if (e.type === 'saw' && e.o !== r && Math.abs(e.y - feet) < 50) {
          const dx = e.x - fx;
          if ((dx > -20 && dx < 120 && e.vx < 0) || (dx > -20 && dx < 40)) j = true;
          // arkadan yetişen testere: varışına ~0.3 sn kala zıpla (havada kalış ~0.6 sn, üstünden geçer)
          else if (e.x < r.x && e.vx > r.vx + 50 && (r.x - e.x - e.r) / (e.vx - r.vx) < .3) j = need = true;
        }
      }
      for (const k of L.crush) { const dx = k.x - fx; const gap = feet - (k.y + k.h); if (dx > -k.w - r.w && dx < 60 && gap > 8 && gap < 45) sl = true; }
      // testere makinesi: altından kayan her zaman geçer (bıçağın en alt noktası kayan yarışçının üstünde kalır)
      for (const s of L.saws) { const dx = s.cx - s.r - fx; if (dx > -(2 * s.r + r.w + 6) && dx < 64 && Math.abs(s.cy + 80 - feet) < 30) { sl = true; break; } }
      // yuvarlanan kaya: ileriyi hesapla, temas 0.07-0.38 sn sonraysa zıpla (havada kalış penceresi geniş)
      for (const b of L.boulders) {
        if (fx < b.x0 - 60 || r.x > b.x1 + 2 * b.r || Math.abs(b.y - feet) > 40) continue;
        const tc = boulderContact(b, r);
        if (tc > .07 && tc < .38) { j = need = true; break; }
      }
      // küçük bataklık kum: üstünden atla
      for (const q of L.quicksand) { const dx = q.x - fx; if (q.w < 260 && dx > 2 && dx < 36 && Math.abs(q.y - feet) < 4) { j = true; break; } }
      // ışınlanma kapısı: bot başına deterministik karar (~%65 girer)
      for (const p of L.portals) {
        const dx = (p.ax - p.r) - fx;
        if (dx > 25 && dx < 95 && Math.abs(p.by - feet) < 12 && FM.hash(r.idx * 131 + (p.ax | 0)) < .65) { j = true; break; }
      }
      // meteor: iniş noktasındaysan, düşmeden hemen önce zıpla
      for (const e of S.ents) if (e.type === 'meteor' && e.t > .1 && e.t < .32 && Math.abs(cx + r.vx * e.t - e.x) < e.r + 24 && Math.abs(e.y - feet) < 70) { j = true; break; }
      // Altın Avı: biraz yukarıdaki altınlar için zıpla
      if (S.gameMode === 'coins' && !j && r.onGround && a.coinT <= 0) {
        const bit = 1 << r.idx;
        for (const co of L.coins) {
          if (co.got & bit) continue;
          const dx = co.x - fx, up = feet - co.y;
          if (dx > 50 && dx < 120 && up > 60 && up < 150) { if (Math.random() < .6) j = true; a.coinT = .5; break; }
        }
      }
      // kutular koşarken başa değer; yalnızca daha yüksekteki bir kutu için, tam altına gelince zıpla
      if (!j && !sl && !r.item && r.onGround) {
        for (const b of L.boxes) {
          if (b.cd[r.idx] > 0 || b.y + b.h > r.y + 3) continue;
          const dx = b.x - fx;
          if (dx > -25 && dx < 25 && b.y + b.h > r.y - 90 && b.y < feet) { j = true; break; }
        }
      }
      if (j && !need && slideAhead) j = false;
      if (sl && r.sled <= 0) { if (r.slide || decide()) { c.dh = true; if (!r.slide) c.dp = true; a.slideT = .15; } j = false; }
      else if (j && decide()) c.jp = true;
    } else if (!r.climb && r.jumps < 2 && r.vy > 120) {
      // çift zıplamayı yalnızca altında hiç zemin yoksa (sıvı çukuru) harca; derin iniş/mantar düşüşü çukur sanılmasın
      if (!groundWithin(cx + r.vx * .08, feet, 700) && !groundWithin(cx + r.vx * .3, feet, 700) && groundWithin(cx + 190, feet - 80, 440)) c.jp = true;
    }
    // eşya — yönlü kullanım: aynı seviyedekine yuvarlanan testere (ileri/geri), farklı yükseklikteki ya da arkadaki hedefe
    // gerçek yolu simüle edilerek seçilen kavisli atış (testere/dinamit), öndekinin önüne tuzak/ağ, yakın kovalayana geri füze
    a.aimT = Math.max(0, (a.aimT || 0) - dt);
    if (r.item && a.itemT <= 0) {
      const ah = aheadOf(r, 700), bh = behindOf(r, 460), it = r.item;
      const level = q => Math.abs(q.y + q.h - feet) < 30;
      let go = false, ax = 0, ay = 0;
      if (it === 'saw') {
        const fw = aheadOf(r, 600);
        if (fw && r.onGround && level(fw)) go = true;                                          // ileri yuvarla (varsayılan)
        else if (bh && r.onGround && level(bh) && r.x - bh.x < 400 && a.wait > .6) { go = true; ax = -1; }    // arkadakine geri yuvarla
        else if ((fw || bh) && a.aimT <= 0 && a.wait > 1.2) { a.aimT = .3; const v = botAim(r, 'saw', fw || bh); if (v) { go = true; ax = v.x; ay = v.y; } }
      } else if (it === 'dyn') {
        if (ah && ah.x - r.x > DYN_MIN && ah.x - r.x < DYN_MAX) go = true;                     // varsayılan uzun atış
        else if (a.aimT <= 0 && a.wait > 1.2) {                                                // varsayılan fırsat çıkmadıysa nişanlı atış
          a.aimT = .3;
          const tg = ah && ah.x - r.x < 650 ? ah : bh;
          if (tg) { const v = botAim(r, 'dyn', tg); if (v) { go = true; ax = v.x; ay = v.y; } }
        }
      } else if (it === 'trap' || it === 'net') {
        // varsayılan: arkaya bırak (düşeceği yer çukursa bekle — eşya boşa gitmesin)
        if (S.racers.some(q => q !== r && !q.out && q.x < r.x && r.x - q.x < 450)) go = simThrow(r, it, throwParams(r, it, null), false).ok;
        else if (ah && ah.x - r.x > 50 && ah.x - r.x < 340 && r.onGround && a.aimT <= 0) {
          // öndekinin önüne fırlat: düştüğü/durduğu yer, hedef oraya varmadan kurulacak kadar önde mi?
          a.aimT = .4;
          for (const d of it === 'trap' ? [{ x: .8, y: -.6 }, { x: .6, y: -.8 }] : [{ x: .99, y: -.15 }, { x: .86, y: -.5 }]) {
            const p = throwParams(r, it, d), sm = simThrow(r, it, p, false);
            const tp = cxOf(ah) + Math.max(0, ah.vx) * sm.t, lead = sm.x - tp, arm = Math.max(0, ah.vx) * (it === 'trap' ? .55 : .2);
            if (sm.ok && lead > arm && lead < arm + 130 && Math.abs(sm.y - (ah.y + ah.h - 6)) < 45) { go = true; ax = d.x; ay = d.y; break; }
          }
        }
      } else if (it === 'mis') {
        go = !!ah || ranking()[0] !== r;
        if (go && bh && r.x - bh.x < 300 && (!ah || ah.x - r.x > 600)) ax = -1;                // uzak lider yerine yakın kovalayan
      } else if (it === 'ink' || it === 'mag') go = !!ah || ranking()[0] !== r;
      else go = true;
      a.wait += dt;
      if (go || a.wait > 7) { c.use = true; c.ax = go ? ax : 0; c.ay = go ? ay : 0; a.wait = 0; a.itemT = .5; }
    }
    // özel güç (yönlü: arkadakine karga/kükreme/dalga, duvar önünde yukarı atılım, çukurda hızlı süzülüş)
    if (r.charge >= 100) {
      a.abT += dt; let go = false, bx = 0, by = 0;
      let safe = true;
      switch (r.id) {
        case 'TAFTAF':
          if (r.onGround && wallAhead(r) && upDashSafe(r)) { go = true; bx = .55; by = -.83; }
          else { safe = dashSafe(r); go = r.onGround && safe; }   // atılım çukur/diken üstünde bitmesin
          break;
        case 'Caner': { const b = behindOf(r, 600); if (aheadOf(r, 1100)) go = true; else if (b) { go = true; bx = -1; } else go = a.abT > 3; break; }
        case 'LUL': go = S.racers.some(q => q !== r && q.x > r.x - 40 && q.x - r.x < 320 && q.onGround && q.dead <= 0) || a.abT > 4; break;
        case 'ertan': go = r.onGround && groundWithin(fx + 200, feet, 30); break;
        case 'Kral': {
          const threat = S.ents.some(e => e.o !== r && e.type === 'mis' && e.tgt === r && Math.hypot(e.x - cx, e.y - cyOf(r)) < 260);
          const b = behindOf(r, 260);
          if (aheadOf(r, 300) || threat) go = true;
          else if (b) { go = true; bx = -1; by = b.y + b.h < feet - 60 ? -.5 : 0; }
          else go = a.abT > 5;
          break;
        }
        case 'Nuss':
          if (r.onGround && !groundWithin(fx + 120, feet, 200)) { go = true; bx = .95; by = -.3; }   // çukur: alçak ve hızlı süzülüş
          else if (r.onGround && wallAhead(r)) { go = a.abT > 1; bx = .4; by = -.92; }              // duvar: yukarı süzülüş
          break;
        case 'baso': { const b = behindOf(r, 520); if (aheadOf(r, 800)) go = true; else if (b) { go = true; bx = -1; } break; }
      }
      if (go || (a.abT > 6 && safe)) { c.ab = true; c.bx = go ? bx : 0; c.by = go ? by : 0; a.abT = 0; }
    }
  }
  // yapay zekâ: hedefe isabet eden atış yönü (gerçek yol simülasyonuyla; önce yatay, sonra giderek dikleşen açılar)
  const BOT_ANGS = [-.12, 0, -.35, -.55, -.75, -.95, -1.15, .25];
  function botAim(r, it, tgt) {
    const sx = cxOf(tgt) >= cxOf(r) ? 1 : -1;
    for (const a of BOT_ANGS) {
      const d = aimDir(sx * Math.cos(a), Math.sin(a));
      if (throwHits(r, it, d, [tgt])) {
        // insan gibi küçük nişan hatası (±0.08 rad): botlar her atışta kusursuz olmasın
        const e = (Math.random() - .5) * .16, b = Math.atan2(d.y, d.x) + e;
        return aimDir(Math.cos(b), Math.sin(b));
      }
    }
    return null;
  }
  // önünde zıplanarak çıkılamayacak duvar var mı?
  const wallAhead = r => r.blocked || (solidAt(r.x + r.w + 50, r.y + r.h - 56) && solidAt(r.x + r.w + 50, r.y + r.h - 2));
  // yukarı çapraz atılım sonrası iniş bölgesi (duvarın üstü) güvenli mi?
  function upDashSafe(r) {
    const L = S.L, x0 = cxOf(r) + 200, top = r.y + r.h - 270;
    for (let x = x0; x <= x0 + 120; x += 40) if (groundY(x, top) === null) return false;
    for (const s of L.spikes) if (s.x < x0 + 160 && s.x + s.w > x0 - 60) return false;
    for (const q of L.crush) if (q.x < x0 + 160 && q.x + q.w > x0 - 60) return false;
    for (const s of L.saws) if (Math.abs(s.cx - x0) < 140) return false;
    for (const b of L.boulders) if (x0 + 160 > b.x0 && x0 - 60 < b.x1 + 60) return false;
    return true;
  }
  // TAFTAF atılımının bittiği yerde (ve sonrasındaki yavaşlama boyunca) zemin var, diken/ezici/testere yok mu?
  function dashSafe(r) {
    const L = S.L, feet = r.y + r.h, k = 1 + (r.abLv - 1) * .1;
    const x0 = cxOf(r) + RUN * 2.2 * .55 * k;
    for (let x = x0 - 20; x <= x0 + 140; x += 40) if (groundY(x, feet - 60) === null) return false;
    for (const s of L.spikes) if (s.x < x0 + 150 && s.x + s.w > x0 - 40) return false;
    for (const q of L.crush) if (q.x < x0 + 150 && q.x + q.w > x0 - 40) return false;
    for (const s of L.saws) if (Math.abs(s.cx - x0) < 120) return false;
    for (const b of L.boulders) if (x0 + 150 > b.x0 && x0 - 40 < b.x1 + 60) return false;
    for (const q of L.quicksand) if (q.x < x0 + 150 && q.x + q.w > x0 - 40) return false;
    return true;
  }
  // kaya ile tahmini temas süresi (sn; yoksa -1): yarışçı mevcut hızıyla düz koşarsa
  const _bo = {};
  function boulderContact(b, r) {
    const c0 = cxOf(r), v = Math.max(0, r.vx);
    for (let t = 0; t <= .9; t += .03) {
      boulderAt(b, S.lt + t, _bo);
      if (_bo.st === 2 && Math.abs(_bo.bx - (c0 + v * t)) < b.r + r.w / 2 + 2) return t;
    }
    return -1;
  }
  game.boulderContact = boulderContact;

  /* =================== ADIM =================== */
  // Tur bittikten sonra (end/podium) bitiremeyen yarışçı: tehlike, mantar, ped, kutu, altın, olay YOK.
  // Yere düz iner ve durur.
  function settle(r, dt) {
    const c = r.ctl; c.jp = c.dp = c.use = c.ab = false;
    if (r.dead > 0) return;
    r.climb = false; r.fly = 0; r.dash = 0; r.sled = 0; r.vx = 0;
    if (r.onGround) { r.vy = 0; return; }
    r.vy = Math.min(1500, r.vy + G * dt);
    const f0 = r.y + r.h;
    r.y += r.vy * dt;
    if (r.vy < 0) { for (const s of S.L.solids) if (s.y2 == null && ov(r, s)) { r.y = s.y + s.h; r.vy = 0; break; } return; }
    // iniş: gövde merkezinin altındaki yüzey (eğimli zemin dahil)
    const gy = groundY(cxOf(r), f0 - 2);
    if (gy !== null && r.y + r.h >= gy) { r.y = gy - r.h; r.onGround = true; r.jumps = 0; r.vy = 0; }
  }
  function updateLevel(dt) {
    const L = S.L, t = S.lt;
    // tehlike döngüleri seviye saatine (S.lt) bağlı: ağda herkeste aynı evre
    for (const s of L.saws) { s.px = s.cx; s.py = s.cy + (s.off || 0) + Math.sin(t * s.sp + s.ph) * s.amp; }
    for (const m of L.mush) if (m.sq > 0) m.sq -= dt;
    for (const m of L.tramp) if (m.sq > 0) m.sq -= dt;
    for (const b of L.boulders) { boulderAt(b, t, b); b.rot = (b.x1 - b.bx) / b.r; }
    for (const v of L.vents) {
      if (v.kind !== 'burst' || !(v.per > 0)) continue;
      let u = (t + v.ph) % v.per; if (u < 0) u += v.per;
      v.act = u < v.on;
      v.k = v.act ? 1 : Math.max(0, 1 - (v.per - u) / .6);   // fışkırmadan önceki 0.6 sn: 0 → 1
    }
    // Altın Avı: yere düşen altınlar (saçılır, zemine oturur, ömrü dolunca kaybolur)
    if (S.gameMode === 'coins') for (const co of L.coins) {
      if (!co.drop || co.got === FM.ALLBITS) continue;
      co.t -= dt; co.ready -= dt;
      if (co.t <= 0) { co.got = FM.ALLBITS; continue; }
      if (co.rest) continue;
      co.vy = Math.min(1200, co.vy + G * .8 * dt);
      const nx = co.x + co.vx * dt;
      if (solidAt(nx, co.y)) co.vx = -co.vx * .4; else co.x = nx;
      co.y += co.vy * dt;
      if (co.vy > 0 && solidAt(co.x, co.y + 12)) {
        let k = 0; while (solidAt(co.x, co.y + 12) && k < 80) { co.y -= 1; k++; }
        co.vy = -co.vy * .35; co.vx *= .55;
        if (Math.abs(co.vy) < 110) { co.vy = 0; co.vx = 0; co.rest = true; }
      }
      if (co.y > L.liq + 10) co.got = FM.ALLBITS;   // sıvıya düştü: kayıp
    }
  }
  /* ---------- mod kuralları (yalnızca yarışta) ---------- */
  // Eleme: hayattaki (elenmemiş) herkesin kapıdan geçmesi beklenir; geçmeyen son k kişi elenir.
  // k = max(1, floor((kalan-1) / kalan etkin kapı)) → kapılar eşit dağıtır, son kapıda 1 kişi kalır.
  // Ağda uzak geçişler gecikmeyle gelir: koşul sağlanınca bu kadar beklenir, sonra GEÇİŞ ZAMANINA göre en son geçen(ler) elenir.
  const GATE_GRACE = .45;
  function checkGates() {
    const G0 = S.L.gates; if (!G0.length || !auth()) return;
    const grace = S.netRole ? GATE_GRACE : 0;
    for (const g of G0) {
      if (g.off || g.done) continue;
      const alive = S.racers.filter(r => !r.out);
      if (alive.length <= 1) { g.done = true; continue; }
      const gb = 1 << g.n, left = alive.filter(r => !(r.gates & gb));
      if (left.length === alive.length) continue;          // henüz kimse geçmedi
      if (g.t0 == null) g.t0 = S.raceT;
      let gl = 0; for (const q of G0) if (!q.off && !q.done) gl++;
      const k = Math.max(1, Math.floor((alive.length - 1) / Math.max(1, gl)));
      // güvenlik: ilk geçişten 40 sn sonra hâlâ bekleyen varsa en geridekiler elenir (takılan/çevrimdışı oyuncu)
      const timeout = S.raceT - g.t0 > 40;
      if (left.length <= k || timeout) {
        let vic;
        if (grace > 0 && !timeout) {
          if (g.tc == null) g.tc = S.raceT;
          if (S.raceT - g.tc < grace) continue;
          // geçemeyenler (en geride olan önce), sonra geçiş anı en geç olanlar; bitirmiş olan asla elenmez
          const gt = r => (r.gateT && r.gateT[g.n] != null ? r.gateT[g.n] : 0);
          vic = alive.filter(r => !r.finished).sort((p, q) => {
            const pc = !!(p.gates & gb), qc = !!(q.gates & gb);
            if (pc !== qc) return pc ? 1 : -1;
            return pc ? gt(q) - gt(p) : p.x - q.x;
          }).slice(0, k);
        } else {
          left.sort((p, q) => p.x - q.x);
          vic = left.slice(0, Math.min(k, left.length));
        }
        g.done = true;
        for (const v of vic) eliminate(v, g.n);
        // zaman aşımında kalanlar kapıdan geçmiş sayılır
        for (const v of left) if (!v.out) v.gates |= gb;
      }
    }
    checkSurvivor();
  }
  game.checkGates = checkGates;
  // Eleme: tek kişi kaldıysa hayatta kalan kazanır (ağda üyeler de ev sahibinin elemelerini uyguladıktan sonra çağırır)
  function checkSurvivor() {
    if (S.gameMode !== 'elim' || S.mode !== 'race') return false;
    const alive = S.racers.filter(r => !r.out);
    if (alive.length === 1 && !alive[0].finished && S.elimN > 0) {
      const w = alive[0];
      w.finished = true; w.place = ++S.finishedN; w.ftime = S.raceT; w.inv = 999; w.item = null;
      FM.fx.toast(w === S.player ? 'HAYATTA KALDIN! KAZANDIN!' : `${w.name} kazandı!`, '#ffe14d');
      if (near(w)) FM.fx.confetti(cxOf(w), w.y - 160, w === S.player ? 70 : 30);
      FM.emit('finish', { r: w, place: w.place, time: w.ftime, survivor: true });
      return true;
    }
    return false;
  }
  game.checkSurvivor = checkSurvivor;
  // Kaos: arada bir meteor yağmuru (uyarı gölgesi METEOR_WARN sn önce)
  function spawnMeteor(x, warn, y) {
    if (!S.L) return null;
    warn = warn > 0 ? warn : METEOR_WARN;
    if (y == null) { const gy = groundY(x, -3000); y = gy === null ? S.L.liq : gy; }
    const e = { type: 'meteor', x, y, t: warn, max: warn, r: METEOR_R, age: 0 };
    S.ents.push(e);
    FM.emit('meteor:warn', { x, y, t: warn });
    return e;
  }
  game.spawnMeteor = spawnMeteor;
  function meteorStep() {
    if (!auth()) return;
    if (S.meteorT == null) S.meteorT = 6 + Math.random() * 2;
    if (S.raceT >= S.meteorT) {
      const n = 3 + ((Math.random() * 3) | 0);
      let t = S.raceT;
      for (let i = 0; i < n; i++) { S.meteorQ.push(t); t += .3 + Math.random() * .3; }
      S.meteorT = S.raceT + 7 + Math.random() * 4;
      FM.emit('meteor:shower', { n });
    }
    while (S.meteorQ.length && S.meteorQ[0] <= S.raceT) {
      S.meteorQ.shift();
      const act = S.racers.filter(r => !r.out && !r.finished && r.dead <= 0);
      if (!act.length) break;
      const tg = act[(Math.random() * act.length) | 0];
      spawnMeteor(cxOf(tg) + Math.max(0, tg.vx) * METEOR_WARN + (Math.random() * 300 - 120), METEOR_WARN);
    }
  }
  // elenen/izleyici oyuncunun kamerası: öndeki (bitirmemiş) yarışçı; sık sık atlamasın diye 150 px eşik
  function updateSpec() {
    const p = S.player;
    if (!p || !(p.out || p.spec)) { S.spec = null; return; }
    let cur = S.spec && !S.spec.out && S.racers.indexOf(S.spec) >= 0 ? S.spec : null, lead = null;
    for (const r of S.racers) if (r !== p && !r.out && (!lead || (lead.finished && !r.finished) || (!r.finished === !lead.finished && r.x > lead.x))) lead = r;
    if (!cur || (lead && lead !== cur && ((cur.finished && !lead.finished) || lead.x > cur.x + 150))) cur = lead;
    S.spec = cur;
  }
  game.step = function (dt) {
    if (!S.L) return;
    // ağ yarışı: netgame.js her adım başında uzak durumları/olayları işler, kendi durumunu yayınlar, saati eşitler
    if (S.netRole && typeof game.onNetStep === 'function') { try { game.onNetStep(dt); } catch (e) { console.error(e); } }
    S.T += dt; S.lt = (S.lt || 0) + dt; updateLevel(dt);
    trackAim();   // aim:start / aim:end (bırakma darbesi tüketilmeden önce)
    if (S.mode === 'count') {
      S.countT -= dt;
      const n = Math.ceil(S.countT - .6);
      if (n !== S.lastCount) { S.lastCount = n; FM.emit('countdown', { n: Math.max(0, n) }); }
      // geri sayımda basılan ZIPLA/EŞYA/GÜÇ tamponlanıp KOŞ! anında kendiliğinden tetiklenmesin (basılı tutma bilgisi kalır)
      clearInput();
      for (const r of S.racers) {
        if (r.out) continue;
        if (r.ctrl === 'remote') { if (typeof game.onRemote === 'function') { try { game.onRemote(r, dt); } catch (e) { console.error(e); } } continue; }
        const c = r.ctl; c.jp = c.dp = c.use = c.ab = false; physics(r, dt);
      }
      if (S.countT <= 0) { S.mode = 'race'; FM.fx.toast('KOŞ!', '#7be3ff'); FM.emit('go', {}); }
      return;
    }
    if (S.mode === 'race' || S.mode === 'end' || S.mode === 'demo' || S.mode === 'podium') {
      if (S.mode === 'race' || S.mode === 'demo') S.raceT += dt;
      const after = post();
      for (const r of S.racers) {
        if (r.out) { if (r === S.player) clearInput(); continue; }   // elenmiş: izleyici
        // uzak (ağ) yarışçı: fizik yok; ağ katmanı game.onRemote(r, dt) ile konumu doldurur, kapı geçişi buradan izlenir
        if (r.ctrl === 'remote') { if (typeof game.onRemote === 'function') { try { game.onRemote(r, dt); } catch (e) { console.error(e); } } if (S.mode === 'race') { markGates(r); updateDraft(r, dt); } continue; }
        if (!r.bot) {
          const c = r.ctl, I = FM.input;
          c.jh = I.jh; c.dh = I.dh;
          if (I.jp) { c.jp = true; I.jp = false; }
          if (I.dp) { c.dp = true; I.dp = false; }
          if (I.use) { const a = fireAim(r, 'item'); c.use = true; c.ax = a.ax; c.ay = a.ay; I.use = false; }
          if (I.ab) { const a = fireAim(r, 'ab'); c.ab = true; c.bx = a.ax; c.by = a.ay; I.ab = false; }
        } else if (S.mode === 'race' || S.mode === 'demo') ai(r, dt);
        updateDraft(r, dt);
        if (after && !r.finished) settle(r, dt);   // tur bitti: bitiremeyenler olduğu yerde durur (tehlike/mantar/olay yok)
        else physics(r, dt);
      }
      updateEnts(dt);
      if (S.mode === 'race') {
        if (S.gameMode === 'elim') checkGates();
        else if (S.gameMode === 'chaos') meteorStep();
        updateSpec();
        if (S.endTimer === null && S.raceT > 150) S.endTimer = 10;
        if (S.endTimer !== null) S.endTimer -= dt;
        let active = 0; for (const r of S.racers) if (!r.finished && !r.out) active++;
        const timeUp = S.limitT && S.raceT >= S.limitT;
        if (timeUp && !S.timeUpSent) { S.timeUpSent = true; FM.emit('timeup', {}); }
        if (auth() && (active === 0 || (S.endTimer !== null && S.endTimer <= 0) || timeUp)) endRound();
      } else if (S.mode === 'demo') {
        if (S.finishedN >= 1 && S.endTimer !== null) S.endTimer -= dt;
        if (S.finishedN === S.racers.length || (S.endTimer !== null && S.endTimer <= 4) || S.raceT > 90) game.startDemo();
      }
    }
  };
  // yardımcıları dışa aç (test/geliştirme için)
  game.physics = physics; game.ai = ai; game.useItem = useItem; game.useAbility = useAbility; game.mkRacer = mkRacer; game.explode = explode;
  game.endRound = endRound; game.die = die; game.harm = harm; game.respawn = respawn;
  game.itemParams = itemParams; game.castItem = castItem; game.castAbility = castAbility; game.near = near;
  game.throwParams = throwParams; game.simThrow = simThrow; game.behindOf = behindOf; game.aheadOf = aheadOf; game.botAim = botAim;
  game.deathIcon = cause => (cause && FM.ITEMS[cause] && FM.ITEMS[cause].ic) || DEATH_ICON[cause] || '💥';
  // turu hemen bitir (ör. elenen oyuncu "Sonuçlara geç" derse): o anki sıralamayla puanlanır. Ağ yarışında YOK (tur herkes için biter).
  game.finishNow = function () { if (S.mode === 'race' && auth() && !S.netRole) { endRound(); return true; } return false; };
})(window.FM);

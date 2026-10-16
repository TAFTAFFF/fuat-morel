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
  const AIM_ABS = { TAFTAF: 1, Caner: 1, Kral: 1, baso: 1, Nuss: 1 };      // yönlü özel güçler
  const SAW_V = 760, DYN_V = 720, DYN_LOB = 240, TRAP_V = 560, TRAP_LOB = 220, NET_V = 900, NET_DEC = 1500;
  const THROW_INH = .5;            // yönlü atışta atanın ileri hızının bu kadarı varlığa geçer
  const DYN_FUSE = .95, DASH_V = 2.2;
  const KRAL_SPREAD = .62, KRAL_NEAR = 90, WAVE_V = 880;
  const JBUF = .12;                // zıplama tamponu (yere değmeden önce basılan zıplama sayılır)
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
  function mkRacer(id, idx, bot) {
    return {
      id, idx, name: id, nick: id, bot, ctrl: bot ? 'bot' : 'local', pid: null,
      x: 0, y: 0, w: RW, h: RH, vx: 0, vy: 0, onGround: false, coy: 0, jumps: 0,
      out: false, elim: false, outN: 0, outT: 0, gates: 0, gateT: null, tp: 0,
      portCd: 0, ventCd: 0, bounceT: 0, onIce: false, onSand: false, inLift: false,
      slide: false, slideT: 0, climb: false, blocked: false, slam: false,
      item: null, charge: 0, boost: 0, shield: 0, balloon: false, padT: 0,
      dead: 0, inv: 0, stun: 0, frozen: 0, netted: 0, slowT: 0, pull: 0, inked: 0, ccImm: 0,
      dash: 0, sled: 0, fly: 0, dashX: 1, dashY: 0, flyMul: 1.3,
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
  function cosmeticsFor(id) {
    const sv = FM.save;
    return { skin: (sv.equipped.skin && sv.equipped.skin[id]) || 'klasik', trail: sv.equipped.trail || 'dust', plate: sv.equipped.plate || 'basic' };
  }
  function randomCosmetics(rnd) {
    const sk = FM.COSMETICS.skins, tr = FM.COSMETICS.trails, pl = FM.COSMETICS.plates;
    return {
      skin: rnd() < .7 ? 'klasik' : sk[1 + Math.floor(rnd() * (sk.length - 1))].id,
      trail: tr[1 + Math.floor(rnd() * (tr.length - 1))].id,
      plate: rnd() < .6 ? 'basic' : pl[Math.floor(rnd() * pl.length)].id
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
        r.name = r.nick = r.id + ' ' + cnt[r.id];
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
    S.aim = null;
    const pure = S.gameMode === 'pure';
    S.racers.forEach((r, i) => {
      const keep = { id: r.id, idx: r.idx, bot: r.bot, total: r.total, abLv: r.abLv, chargeMul: r.chargeMul, startItem: r.startItem, skin: r.skin, trail: r.trail, plate: r.plate,
        name: r.name, nick: r.nick, ctrl: r.ctrl, pid: r.pid };
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
    const td = pr >= 0 ? FM.trophyFor(N)[pr] || 0 : 0;
    if (pr >= 0) {
      FM.save.trophies[S.player.id] = Math.max(0, (FM.save.trophies[S.player.id] || 0) + td);
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
  function solidAt(px, py) { for (const s of S.L.solids) if (px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h) return true; return false; }
  function boxFree(x, y, w, h) { for (const s of S.L.solids) if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) return false; return true; }
  function groundWithin(px, py, d) { for (const s of S.L.solids) if (px >= s.x && px <= s.x + s.w && s.y >= py - 4 && s.y < py + d) return true; return false; }
  function groundY(px, py) { let b = null; for (const s of S.L.solids) if (px >= s.x && px <= s.x + s.w && s.y >= py - 8 && (b === null || s.y < b)) b = s.y; return b; }
  game.solidAt = solidAt; game.groundY = groundY;
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

  function die(r, src, cause) {
    if (isRemote(r) || r.dead > 0 || r.finished || post()) return;
    setSlide(r, false);
    r.dead = 1.1; r.deaths++; r.vx = r.vy = 0; r.climb = false; r.fly = 0; r.dash = 0; r.sled = 0; r.boost = 0; r.stun = 0; r.frozen = 0; r.netted = 0; r.pull = 0; r.ccImm = 0;
    const killer = src && src !== r ? src : null;
    if (killer) killer.kills++;
    r.lastHitBy = null; r.lastHitT = -9;
    // kilitlenme önleyici: aynı güvenli noktadan arka arkaya çok ölüm → güvenli noktayı ilerideki sağlam zemine taşı
    const lp = r.loop || (r.loop = { sx: -1, n: 0 });
    if (Math.abs(r.safe.x - lp.sx) < 40) lp.n++; else { lp.sx = r.safe.x; lp.n = 1; }
    if (lp.n >= (r.bot ? 4 : 3)) {
      const dx = Math.max(r.x, r.safe.x) + 40;
      let best = null;
      for (const s of S.L.solids) if (!s.float && s.w >= 220 && s.x > dx && (!best || s.x < best.x)) best = s;
      if (best) { r.safe.x = best.x + 90; r.safe.y = best.y; lp.sx = r.safe.x; lp.n = 0; FM.emit('rescue', { r }); }
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
    r.x = r.safe.x - r.w / 2; r.y = r.safe.y - RH - 1; r.h = RH; r.slide = false; r.vx = RUN * .7; r.vy = 0; r.inv = 1.6; r.onGround = false;
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
  const SAW_FORGIVE = 7, BOULDER_FORGIVE = 6;
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
    r.slowT = Math.max(0, r.slowT - dt); r.pull = Math.max(0, r.pull - dt); r.inked = Math.max(0, r.inked - dt); r.padT = Math.max(0, r.padT - dt);
    r.ccImm = Math.max(0, (r.ccImm || 0) - dt);
    r.portCd = Math.max(0, (r.portCd || 0) - dt); r.ventCd = Math.max(0, (r.ventCd || 0) - dt); r.bounceT = Math.max(0, (r.bounceT || 0) - dt);
    const wasPow = r.dash > 0 || r.sled > 0 || r.fly > 0;
    r.boost = Math.max(0, r.boost - dt); r.shield = Math.max(0, r.shield - dt); r.dash = Math.max(0, r.dash - dt); r.sled = Math.max(0, r.sled - dt); r.fly = Math.max(0, r.fly - dt);
    // güç (atılım/kızak/süzülüş) bittiği an tehlikenin üstünde kalınca anında ölmesin: kısa lütuf süresi
    if (wasPow && r.dash <= 0 && r.sled <= 0 && r.fly <= 0 && r.dead <= 0) r.inv = Math.max(r.inv, .35);
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
    if (r.dash > 0) mult = DASH_V * (r.dashX == null ? 1 : r.dashX);   // yönlü atılımda yatay pay
    if (r.bot) mult *= 1 + .035 * Math.sin(S.T * .55 + r.idx * 2.1);   // ortalaması 0: yalnızca görsel ayrışma
    let tgt = locked ? 0 : RUN * mult;
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
            r.vy = -JUMP * (r.onSand ? .82 : 1); if (!perf) r.vx *= .96; r.coy = 0; r.jumps = 1; r.onGround = false; r.jumpT = 1; r.jbuf = 0;
            if (near(r)) FM.fx.puff(cxOf(r), r.y + r.h, 4, 'rgba(255,255,255,.8)', 7, 70);
            FM.emit('jump', { r, dbl: false });
            if (perf) perfect(r, 'jump');
          }
        } else if (c.jp && r.jumps < 2) {
          if (r.slide) setSlide(r, false);
          r.vy = -DJ; r.vx *= .88; r.jumps = 2; r.slam = false; r.slamPerf = false; r.jumpT = 1; r.jbuf = 0;
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
      if (r.fly > 0) g *= .12;
      else if (r.vy < 0 && !c.jh && !r.slam && r.bounceT <= 0) g *= 1.6;   // trambolin/gayzer fırlatması: tuşa basılı tutulmuş say
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
    for (const s of L.solids) {
      if (r.x < s.x + s.w && r.x + r.w > s.x && r.y + r.h > s.y + 1 && r.y < s.y + s.h - 1) {
        if (r.vx >= 0 && r.x + r.w - s.x < 40) {
          const lip = r.y + r.h - s.y;
          if (lip > 0 && lip <= 46 && !r.climb && boxFree(r.x, s.y - r.h - .5, r.w, r.h)) { r.y = s.y - r.h - .5; continue; }
          r.x = s.x - r.w; r.blocked = true; if (r.vx > 0) r.vx = 0;
        } else if (r.vx < 0) { r.x = s.x + s.w; r.vx = 0; }
      }
    }
    if (r.climb) r.blocked = true;
    // Y hareketi
    const vyBefore = r.vy;
    r.y += r.vy * dt; const was = r.onGround; r.onGround = false;
    for (const s of L.solids) {
      if (ov(r, s)) {
        if (r.vy > 0) {
          r.y = s.y - r.h; r.onGround = true; r.jumps = 0;
          if (!was) {
            r.land = clamp(vyBefore / 1300, .25, 1);
            r.landT = 0; r.landHard = vyBefore > 500;   // kusursuz zıplama penceresi inişten sayılır
            if (near(r) && (vyBefore > 700 || r.slam)) FM.fx.puff(cxOf(r), r.y + r.h, r.slam ? 10 : 5, 'rgba(255,255,255,.85)', r.slam ? 12 : 8, r.slam ? 140 : 70);
            if (r.slam) {
              if (r === S.player) FM.fx.shake(.12);
              FM.emit('slamLand', { r });
              if (r.slamPerf) { r.vx = Math.max(r.vx, RUN * 1.12); perfect(r, 'slam'); }
            }
            FM.emit('land', { r, hard: vyBefore > 900 });
          }
          r.slam = false; r.slamPerf = false;
        } else if (r.vy < 0) { r.y = s.y + s.h; if (r.climb) r.climb = false; }
        r.vy = 0;
      }
    }
    if (r.onGround || r.climb) r.ph += (r.climb ? CLIMB : Math.abs(r.vx)) * dt * .05;
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
        r.vy = -MUSH; r.jumps = 1; r.onGround = false; r.y = m.y - 24 - r.h; m.sq = .3; r.jumpT = 1;
        FM.emit('mush', { r });
      }
    }
    // trambolin (şehir çatıları): mantar gibi ama daha güçlü; fırlatma tuşa basılı tutulmuş sayılır → boşluğu hep aşar
    if (r.vy >= 0) for (const m of L.tramp) {
      if (cx > m.x - 4 && cx < m.x + m.w + 4 && feet > m.y - 24 && feet <= m.y + 2) {
        if (r.slide) setSlide(r, false);
        r.vy = -TRAMP; r.jumps = 1; r.onGround = false; r.y = m.y - 24 - r.h; m.sq = .35; r.jumpT = 1; r.bounceT = .6; r.climb = false;
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
      if ((nx - s.px) ** 2 + (ny - s.py) ** 2 < (s.r - SAW_FORGIVE) ** 2) envHit(r, false, 'saw');
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
    if (r.y + r.h > L.liq + 18 && r.dead <= 0) {
      r.inv = 0; r.shield = 0; r.dash = 0; r.frozen = 0;
      FM.emit('splash', { x: cxOf(r), y: L.liq, liquid: L.theme.liquid, r });
      die(r, assistOf(r), L.theme.liquid);
      return;
    }
    // güvenli nokta (route'un geniş yüzen platformları da sayılır; Nuss süzülürken altındaki zemin de)
    if (!r.finished && r.dead <= 0) {
      let sy = null;
      if (r.onGround) sy = feet;
      else if (r.fly > 0) { const gy = groundY(cx, feet); if (gy !== null && gy - feet <= 300) sy = gy; }
      if (sy !== null) {
        let ok = false;
        for (const s of L.solids) if ((!s.float || s.w >= 200) && cx > s.x + 60 && cx < s.x + s.w - 60 && Math.abs(sy - s.y) < 2) { ok = true; break; }
        if (ok) for (const s of L.spikes) if (Math.abs(s.x + s.w / 2 - cx) < s.w / 2 + 80) { ok = false; break; }
        if (ok) for (const k of L.crush) if (Math.abs(k.x + k.w / 2 - cx) < k.w / 2 + 80) { ok = false; break; }
        if (ok) for (const s of L.saws) if (Math.abs(s.cx - cx) < 110) { ok = false; break; }
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
    } else if (S.mode !== 'demo') FM.fx.toast(`${r.name} bitirdi!  #${r.place}`, r === S.player ? '#ffe14d' : '#ffffff');
    if (near(r)) FM.fx.confetti(L.end + 40, L.finY - 200, r === S.player ? 70 : 25);
    // ilk bitirenden sonra diğerlerine 12 sn; kalabalık yarışta kişi başı +1.5 sn (10 kişide 21), kaosta +4 (Altın Avı'nda süre sayacı belirler)
    if (S.finishedN === 1 && !S.limitT) S.endTimer = 12 + Math.max(0, S.racers.length - 4) * 1.5 + (S.gameMode === 'chaos' ? 4 : 0);
    FM.emit('finish', net ? { r, place: r.place, time: r.ftime, net: true } : { r, place: r.place, time: r.ftime });
    return true;
  }
  game.finishRacer = finishRacer;

  /* =================== EŞYALAR =================== */
  function rollItem(r) {
    const rk = ranking().indexOf(r), f = S.racers.length > 1 ? rk / (S.racers.length - 1) : 0;
    const w = { saw: 14, dyn: 12, trap: 6 + 10 * (1 - f), mis: rk > 0 ? 6 + 12 * f : 0, bolt: f > .6 ? 5 : 0, ice: 5 + 6 * f, mag: rk > 0 ? 5 + 8 * f : 0, net: 4 + 10 * (1 - f), ink: rk > 0 ? 3 + 6 * f : 0, speed: 8 + 14 * f, shield: 8 + 6 * (1 - f), balloon: 9 };
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
  function useItem(r) {
    if (!r.item || r.dead > 0 || r.finished) return;
    if (ATTACK[r.item] && S.raceT < START_LOCK && (S.mode === 'race' || S.mode === 'demo')) {
      // start kalabalığında saldırı eşyası kilitli: eşya elde kalır
      if (r === S.player && !r.bot && !r.lockMsg) { r.lockMsg = 1; FM.fx.toast('Eşya ' + Math.max(1, Math.ceil(START_LOCK - S.raceT)) + ' sn sonra hazır!', '#ffb347'); }
      return;
    }
    const it = r.item;
    const p = itemParams(r, it);
    if (!p) return;   // tuzak çukurun üstünde kurulamaz / füzenin hedefi yok: eşya elde kalır
    r.item = null;
    const ents = castItem(r, it, p);
    FM.emit('item:use', { r, item: it, p, ents });
  }
  /* Eşya kullanım parametreleri (konum, hız, hedef) — kullananın telefonunda hesaplanır; ağda aynen yayınlanır ve
     castItem her istemcide aynı varlığı kurar. null = şu an kullanılamaz (eşya elde kalır). */
  function itemParams(r, it) {
    const cx = cxOf(r), cy = cyOf(r);
    switch (it) {
      case 'saw': return { x: cx + 20, y: r.y + r.h - 16, vx: 720 + Math.max(0, r.vx) * .3 };
      // uzun atış: patlama atanın ~250+ px önüne düşer (eskiden 114 px: atan sık sık kendini patlatıyordu)
      case 'dyn': return { x: cx + 10, y: r.y, vx: Math.max(0, r.vx) + 520, vy: -600 };
      case 'trap': { const gy = groundY(r.x - 12, r.y + r.h - 10); return gy === null ? null : { x: r.x - 26, y: gy - 12 }; }
      case 'net': return { x: r.x - 56, y: r.y - 30 };
      case 'mis': {
        const rk = ranking().filter(q => !q.finished && q.dead <= 0);
        const tgt = rk[0] === r ? rk[1] : rk[0];
        return tgt ? { x: cx, y: r.y - 30, tgt } : null;   // hedef yok: eşya boşa gitmesin
      }
      // yıldırım yalnızca öndekiler; en yakın 4 kişi (10 kişilik yarışta herkesi silmesin)
      case 'bolt': return { x: cx, y: cy, tg: S.racers.filter(q => q !== r && !q.finished && !q.out && q.x > r.x).sort((a, b) => a.x - b.x).slice(0, 4) };
      default: return { x: cx, y: cy, rx: r.x };
    }
  }
  /* Eşyanın etkisini uygular / varlığını kurar; kurulan varlıkları döndürür. Uzak (ağ) kullanıcıda kendi durumuna (hız, kalkan,
     balon) dokunulmaz — onu kendi telefonu simüle eder; alan etkileri (buz, mürekkep) harm() ile yalnızca yerel yetkililere işler. */
  function castItem(r, it, p) {
    const out = [], own = !isRemote(r);
    const add = e => { S.ents.push(e); out.push(e); };
    switch (it) {
      case 'speed': if (own) { r.boost = 3.2; r.shield = 0; } break;
      case 'shield': if (own) { r.shield = 4; r.boost = 0; } break;
      case 'balloon': if (own) r.balloon = true; break;
      case 'saw': add({ type: 'saw', x: p.x, y: p.y, vx: p.vx, vy: 0, r: 15, o: r, age: 0, life: 2.4, b: 0 }); break;
      case 'dyn': add({ type: 'dyn', x: p.x, y: p.y, vx: p.vx, vy: p.vy, o: r, age: 0, fuse: .95 }); break;
      case 'trap': add({ type: 'trap', x: p.x, y: p.y, w: 34, h: 12, o: r, age: 0, life: 16 }); break;
      case 'net': add({ type: 'net', x: p.x, y: p.y, w: 44, h: 76, o: r, age: 0, life: 10, n: 0 }); break;
      case 'mis': add({ type: 'mis', x: p.x, y: p.y, vx: 0, vy: 0, tgt: p.tgt || null, o: r, age: 0, warn: 1.1 }); break;
      case 'bolt': for (const q of p.tg || []) add({ type: 'bolt', tgt: q, o: r, t: 1.8, age: 0 }); break;
      case 'ice': for (const q of S.racers) if (q !== r) harm(q, 'freeze', 2.2, r, 'ice'); FM.fx.ring(p.x, p.y, 300, '#bfefff', .6); break;
      case 'mag': add({ type: 'mag', o: r, t: .45, age: 0 }); break;
      case 'ink': { const rx = p.rx != null ? p.rx : r.x; for (const q of S.racers) if (q !== r && q.x > rx) harm(q, 'ink', 3.5, r, 'ink'); FM.fx.burst(p.x, p.y, ['#222233', '#444466'], 16, 240); break; }
    }
    return out;
  }
  function explode(x, y, rad, owner, cause) {
    for (const q of S.racers) {
      if (cause === 'mis' && q === owner) continue;   // güdümlü füze sahibine zarar vermez
      if (Math.hypot(cxOf(q) - x, cyOf(q) - y) < rad + 14) harm(q, 'kill', 0, owner, cause);
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
  function useAbility(r) {
    if (r.charge < 100 || r.dead > 0 || r.finished) return;
    r.charge = 0;
    const p = { x: cxOf(r), y: cyOf(r), fy: r.y + r.h };
    if (r.id === 'Caner') p.tgt = aheadOf(r, 1300);
    const ents = castAbility(r, p);
    FM.emit('ability', { r, id: r.id, p, ents });
  }
  /* Özel gücün etkisi (p = kullanım anındaki gövde merkezi x,y + ayak fy; Caner için hedef tgt). Kurulan varlıkları döndürür.
     Uzak (ağ) kullanıcıda kendi hareketi (atılım/kızak/süzülüş/hız) uygulanmaz; alan etkileri yalnızca yerel yetkililere işler. */
  function castAbility(r, p) {
    const out = [], own = !isRemote(r);
    const cx = p.x, cy = p.y, fy = p.fy != null ? p.fy : cy + RH / 2, k = 1 + (r.abLv - 1) * .1; // seviye başına %10 güç
    if (S.mode !== 'demo') FM.fx.toast(`${r.name}: ${FM.CH[r.id].ab}!`, FM.CH[r.id].col2);
    switch (r.id) {
      case 'TAFTAF': if (own) { r.dash = .55 * k; r.climb = false; if (r.slide) setSlide(r, false); } FM.fx.burst(cx, cy, ['#5b2a86', '#c9a0ff'], 16, 200, 0, 'star'); break;
      case 'Caner': {
        const tgt = p.tgt;
        if (tgt) for (let i = 0; i < 3; i++) { const e = { type: 'crow', x: cx - 10 * i, y: cy - 20 - i * 12, tgt, o: r, life: 3.5, first: i === 0, ph: i, age: 0, dur: 2.0 * k }; S.ents.push(e); out.push(e); }
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
        for (const q of S.racers) { const dx = cxOf(q) - cx; if (q !== r && dx > -60 && dx < rad && Math.abs(cyOf(q) - cy) < 200) harm(q, 'knock', 1.0 * k, r, 'Kral'); }
        S.ents = S.ents.filter(e => {
          if (e.o === r || e.type === 'bolt' || e.type === 'mag') return true;
          const ex = e.type === 'trap' || e.type === 'net' ? e.x + e.w / 2 : e.x, ey = e.type === 'trap' || e.type === 'net' ? e.y + e.h / 2 : e.y;
          if (Math.hypot(ex - cx, ey - cy) < rad + 40) { FM.fx.burst(ex, ey, ['#ffd23f', '#ffffff'], 8); return false; }
          return true;
        });
        FM.fx.ring(cx, cy, rad, '#ffd23f', .6, 10);
        break;
      }
      case 'Nuss': if (own) { r.fly = 2.4 * k; r.vy = -520; r.climb = false; if (r.slide) setSlide(r, false); } FM.fx.burst(cx, cy, ['#ffffff', '#7be3ff'], 16, 200, 100, 'leaf'); break;
      case 'baso': { const e = { type: 'wave', x: cx + r.w / 2, y: cy, o: r, life: 1.15 * k, hit: [], age: 0, dur: 3.2 * k }; S.ents.push(e); out.push(e); break; }
    }
    return out;
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
          e.vy = Math.min(1500, e.vy + G * dt);
          e.x += e.vx * dt;
          if (solidAt(e.x + Math.sign(e.vx) * e.r, e.y)) { e.vx = -e.vx * .9; e.x += e.vx * dt * 2; e.b++; if (e.b > 2) e.life = 0; FM.fx.sparks(e.x, e.y, 6, '#ffe9a0', 260); }
          e.y += e.vy * dt;
          if (e.vy > 0 && solidAt(e.x, e.y + e.r)) { let k = 0; while (solidAt(e.x, e.y + e.r) && k < 60) { e.y -= 1; k++; } e.vy = 0; }
          e.life -= dt; if (e.y > C.KILLY) e.life = 0;
          for (const q of S.racers) {
            if (q === e.o && e.b === 0 && e.age < .7) continue;
            // atılan testere en fazla 2 kişiyi biçer, sonra kırılır (10 kişilik sıkışık grupta katliam olmasın)
            if (circleHit(e, q, e.r - 2) && harm(q, 'kill', 0, e.o, 'saw') && (e.k = (e.k | 0) + 1) >= 2) { e.life = 0; FM.fx.sparks(e.x, e.y, 12, '#ffe9a0', 320); break; }
          }
          break;
        }
        case 'dyn': {
          e.vy = Math.min(1500, e.vy + G * dt);
          e.x += e.vx * dt;
          if (solidAt(e.x, e.y)) { e.x -= e.vx * dt; e.vx = -e.vx * .4; }
          e.y += e.vy * dt;
          if (e.vy > 0 && solidAt(e.x, e.y + 6)) { let k = 0; while (solidAt(e.x, e.y + 6) && k < 60) { e.y -= 1; k++; } e.vy = -e.vy * .3; e.vx *= .55; }
          if (e.age > e.fuse || e.y > C.KILLY) { explode(e.x, e.y, 95, e.o, 'dyn'); e.dead = true; }
          break;
        }
        case 'trap': {
          e.life -= dt; if (e.life <= 0) e.dead = true;
          if (e.age > .5) for (const q of S.racers) {
            if (q.dead <= 0 && ov(q, e) && !(q.sled > 0) && q.fly <= 0) {
              const hit = harm(q, 'kill', 0, e.o, 'trap');
              if (hit || q.dead > 0) { e.dead = true; e.snap = true; FM.fx.burst(e.x + 17, e.y, ['#888888', '#cccccc'], 10); FM.emit('trap:snap', { e, r: q }); break; }
            }
          }
          break;
        }
        case 'net': {
          e.life -= dt; if (e.life <= 0) e.dead = true;
          if (e.age > .6) for (const q of S.racers) {
            if (q.dead <= 0 && q.netted <= 0 && ov(q, e) && !(q.sled > 0)) {
              if (harm(q, 'net', 1.5, e.o, 'net')) { e.n++; q.x = e.x + e.w / 2 - q.w / 2; FM.fx.sparks(e.x + 22, e.y + 38, 10, '#7be3ff', 300); if (e.n >= 2) e.dead = true; }
            }
          }
          break;
        }
        case 'mis': {
          let t = e.tgt;
          if (!t || t.dead > 0 || t.finished) {
            // hedef öldü/bitirdi: sahibi dışındaki lideri yeniden hedefle; kimse yoksa zararsızca sön
            const rk = ranking().filter(q => q !== e.o && !q.finished && q.dead <= 0);
            t = e.tgt = rk[0] || null;
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
          e.x += 880 * dt; e.life -= dt; if (e.life <= 0) e.dead = true;
          for (const q of S.racers) {
            if (q === e.o || e.hit.includes(q)) continue;
            if (Math.abs(cyOf(q) - e.y) < 85 && q.x + q.w > e.x - 24 && q.x < e.x + 12) { if (harm(q, 'slow', e.dur || 3.2, e.o, 'baso')) FM.fx.burst(cxOf(q), cyOf(q), ['#a855f7', '#3cb371'], 8, 200, 100, 'note'); e.hit.push(q); }
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
      let j = false, sl = false;
      if (!groundWithin(fx + 8, feet, 240)) j = true;
      for (const s of L.spikes) { const dx = s.x - fx; if (dx > -6 && dx < 64 && Math.abs(s.y + s.h - feet) < 40) { j = true; break; } }
      for (const e of S.ents) {
        if (e.type === 'trap' || e.type === 'net') { const dx = e.x - fx; if (dx > -e.w && dx < 90 && e.y < feet + 4 && e.y + e.h > r.y - 40) j = true; }
        else if (e.type === 'saw') { const dx = e.x - fx; if ((dx > -20 && dx < 120 && e.vx < 0) || (dx > -20 && dx < 40)) if (Math.abs(e.y - feet) < 50) j = true; }
      }
      for (const k of L.crush) { const dx = k.x - fx; const gap = feet - (k.y + k.h); if (dx > -k.w - r.w && dx < 60 && gap > 8 && gap < 45) sl = true; }
      // testere makinesi: altından kayan her zaman geçer (bıçağın en alt noktası kayan yarışçının üstünde kalır)
      for (const s of L.saws) { const dx = s.cx - s.r - fx; if (dx > -(2 * s.r + r.w + 6) && dx < 64 && Math.abs(s.cy + 80 - feet) < 30) { sl = true; break; } }
      // yuvarlanan kaya: ileriyi hesapla, temas 0.07-0.38 sn sonraysa zıpla (havada kalış penceresi geniş)
      for (const b of L.boulders) {
        if (fx < b.x0 - 60 || r.x > b.x1 + 2 * b.r || Math.abs(b.y - feet) > 40) continue;
        const tc = boulderContact(b, r);
        if (tc > .07 && tc < .38) { j = true; break; }
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
      if (sl && r.sled <= 0) { if (r.slide || decide()) { c.dh = true; if (!r.slide) c.dp = true; a.slideT = .15; } j = false; }
      else if (j && decide()) c.jp = true;
    } else if (!r.climb && r.jumps < 2 && r.vy > 120) {
      // çift zıplamayı yalnızca altında hiç zemin yoksa (sıvı çukuru) harca; derin iniş/mantar düşüşü çukur sanılmasın
      if (!groundWithin(cx + r.vx * .08, feet, 700) && !groundWithin(cx + r.vx * .3, feet, 700) && groundWithin(cx + 190, feet - 80, 440)) c.jp = true;
    }
    // eşya
    if (r.item && a.itemT <= 0) {
      const ah = aheadOf(r, 700), it = r.item;
      let go = false;
      if (it === 'saw') go = !!aheadOf(r, 600) && r.onGround;
      else if (it === 'dyn') go = !!ah && ah.x - r.x > DYN_MIN && ah.x - r.x < DYN_MAX;
      else if (it === 'trap' || it === 'net') go = S.racers.some(q => q !== r && q.x < r.x && r.x - q.x < 450);
      else if (it === 'mis' || it === 'ink' || it === 'mag') go = !!ah || ranking()[0] !== r;
      else go = true;
      a.wait += dt;
      if (go || a.wait > 7) { c.use = true; a.wait = 0; a.itemT = .5; }
    }
    // özel güç
    if (r.charge >= 100) {
      a.abT += dt; let go = false;
      let safe = true;
      switch (r.id) {
        case 'TAFTAF': safe = dashSafe(r); go = r.onGround && safe; break;   // atılım çukur/diken üstünde bitmesin
        case 'Caner': go = !!aheadOf(r, 1100) || a.abT > 3; break;
        case 'LUL': go = S.racers.some(q => q !== r && q.x > r.x - 40 && q.x - r.x < 320 && q.onGround && q.dead <= 0) || a.abT > 4; break;
        case 'ertan': go = r.onGround && groundWithin(fx + 200, feet, 30); break;
        case 'Kral': go = !!aheadOf(r, 300) || a.abT > 5 || S.ents.some(e => e.o !== r && e.type === 'mis' && e.tgt === r && Math.hypot(e.x - cx, e.y - cyOf(r)) < 260); break;
        case 'Nuss': go = !groundWithin(fx + 120, feet, 200) && r.onGround; break;
        case 'baso': go = !!aheadOf(r, 800); break;
      }
      if (go || (a.abT > 6 && safe)) { c.ab = true; a.abT = 0; }
    }
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
  // Yere düz iner ve durur; çukurdaysa sıvının altında sessizce gizlenir (ölüm sayılmaz).
  function settle(r, dt) {
    const c = r.ctl; c.jp = c.dp = c.use = c.ab = false;
    if (r.dead > 0) return;
    r.climb = false; r.fly = 0; r.dash = 0; r.sled = 0; r.vx = 0;
    if (r.onGround) { r.vy = 0; return; }
    if (r.y + r.h > S.L.liq + 18) { r.vy = 0; r.dead = 1e9; return; }
    r.vy = Math.min(1500, r.vy + G * dt);
    r.y += r.vy * dt;
    for (const s of S.L.solids) if (ov(r, s)) {
      if (r.vy >= 0) { r.y = s.y - r.h; r.onGround = true; r.jumps = 0; } else r.y = s.y + s.h;
      r.vy = 0; break;
    }
  }
  function updateLevel(dt) {
    const L = S.L, t = S.lt;
    // tehlike döngüleri seviye saatine (S.lt) bağlı: ağda herkeste aynı evre
    for (const s of L.saws) { s.px = s.cx; s.py = s.cy + Math.sin(t * s.sp + s.ph) * s.amp; }
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
        if (r.ctrl === 'remote') { if (typeof game.onRemote === 'function') { try { game.onRemote(r, dt); } catch (e) { console.error(e); } } if (S.mode === 'race') markGates(r); continue; }
        if (!r.bot) {
          const c = r.ctl, I = FM.input;
          c.jh = I.jh; c.dh = I.dh;
          if (I.jp) { c.jp = true; I.jp = false; }
          if (I.dp) { c.dp = true; I.dp = false; }
          if (I.use) { c.use = true; I.use = false; }
          if (I.ab) { c.ab = true; I.ab = false; }
        } else if (S.mode === 'race' || S.mode === 'demo') ai(r, dt);
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
  game.deathIcon = cause => (cause && FM.ITEMS[cause] && FM.ITEMS[cause].ic) || DEATH_ICON[cause] || '💥';
  // turu hemen bitir (ör. elenen oyuncu "Sonuçlara geç" derse): o anki sıralamayla puanlanır. Ağ yarışında YOK (tur herkes için biter).
  game.finishNow = function () { if (S.mode === 'race' && auth() && !S.netRole) { endRound(); return true; } return false; };
})(window.FM);

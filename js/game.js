/* FUAT MOREL — game.js : fizik, eşyalar, özel güçler, yapay zekâ, yarış akışı. HİÇBİR ŞEY ÇİZMEZ. */
'use strict';
(function (FM) {
  const C = FM.C, S = FM.S, { clamp, ov } = FM;
  const cxOf = FM.cx, cyOf = FM.cy;
  const G = C.G, JUMP = C.JUMP, DJ = C.DJ, RUN = C.RUN, ACC = C.ACC, AIRACC = C.AIRACC, CLIMB = C.CLIMB, SLAM = C.SLAM, MUSH = C.MUSH, RW = C.RW, RH = C.RH, SH = C.SH;

  // Oyuncu girdisi (klavye/dokunmatik bunları doldurur)
  FM.input = { jh: false, jp: false, dh: false, dp: false, use: false, ab: false };

  const DEATH_ICON = { spikes: '🔺', crush: '⛓️', saw: '⚙️', water: '💧', chocolate: '🍫', icewater: '🧊', lava: '🔥', fall: '💧' };
  // Saldırı eşyaları: yarışın ilk START_LOCK saniyesinde kullanılamaz (start çizgisinde iç içe dizilmiş yarışçılara katliam olmasın)
  const ATTACK = { saw: 1, dyn: 1, trap: 1, mis: 1, bolt: 1, ice: 1, mag: 1, net: 1, ink: 1 };
  const START_LOCK = 3;
  const ASSIST_T = 2.5;            // saldırıdan sonra bu süre içinde çevreden ölürse öldürme saldırgana yazılır
  const DYN_MIN = 165, DYN_MAX = 365; // bot dinamiti öndekine bu mesafedeyken atar (yeni atış menziline göre)
  const post = () => S.mode === 'end' || S.mode === 'podium';   // tur bitti: kimse zarar görmez
  function clearInput() { const I = FM.input; if (I) { I.jp = I.dp = I.use = I.ab = false; } }

  /* =================== YARIŞÇI =================== */
  function mkRacer(id, idx, bot) {
    return {
      id, idx, name: id, bot, x: 0, y: 0, w: RW, h: RH, vx: 0, vy: 0, onGround: false, coy: 0, jumps: 0,
      slide: false, slideT: 0, climb: false, blocked: false, slam: false,
      item: null, charge: 0, boost: 0, shield: 0, balloon: false, padT: 0,
      dead: 0, inv: 0, stun: 0, frozen: 0, netted: 0, slowT: 0, pull: 0, inked: 0, ccImm: 0,
      dash: 0, sled: 0, fly: 0,
      onMud: false, onBelt: false, safe: { x: 60, y: 460 },
      finished: false, place: 0, ftime: 0, rp: 0, total: 0, deaths: 0, kills: 0, coins: 0, ph: 0,
      land: 0, jumpT: 0, face: 1, lastHitBy: null, lastHitT: -9, lockMsg: 0,
      abLv: 1, chargeMul: 1, skin: 'klasik', trail: 'dust', plate: 'basic',
      ctl: { jh: false, jp: false, dh: false, dp: false, use: false, ab: false },
      ai: { skip: 0, itemT: 1, abT: 0, slideT: 0, wait: 0 }
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
  game.startMatch = function (opts) {
    opts = opts || {};
    const sel = opts.char && FM.CH[opts.char] ? opts.char : FM.save.selChar;
    S.ROUNDS = opts.rounds || FM.save.rounds || 3; S.round = 1;
    S.themeOff = opts.theme != null ? (+opts.theme) : (Math.random() * FM.THEMES.length) | 0;
    const others = FM.ORDER.filter(k => k !== sel).sort(() => Math.random() - .5).slice(0, 3);
    S.racers = [mkRacer(sel, 0, !!opts.auto)];
    others.forEach((k, i) => S.racers.push(mkRacer(k, i + 1, true)));
    S.player = S.racers[0];
    const pm = modsFor(sel);
    for (const r of S.racers) {
      // eşitlik: botlar oyuncunun geliştirme seviyesini yansıtır
      r.abLv = pm.abLv; r.chargeMul = pm.chargeMul; r.startItem = pm.startItem;
      Object.assign(r, r === S.player ? cosmeticsFor(r.id) : randomCosmetics(Math.random));
    }
    S.matchStats = { startedAt: Date.now() };
    game.startRound(opts);
    FM.emit('match:start', { racers: S.racers, player: S.player, rounds: S.ROUNDS });
  };
  game.startRound = function (opts) {
    opts = opts || {};
    S.L = FM.genLevel(S.round, { theme: opts.themeIdx, seed: opts.seed });
    resetRace();
    S.paused = false;          // savunma: önceki turdan kalan duraklatma yeni geri sayımı kilitlemesin
    S.mode = 'count'; S.countT = 3.6; S.lastCount = 4;
    FM.fx.toast(S.L.theme.n);
    FM.emit('race:start', { round: S.round, rounds: S.ROUNDS, theme: S.L.theme });
  };
  function resetRace() {
    S.ents = []; S.parts = []; S.rings = []; S.toasts = []; S.feed = [];
    S.finishedN = 0; S.endTimer = null; S.raceT = 0; S.shake = 0; S.flash.a = 0;
    S.racers.forEach((r, i) => {
      const keep = { id: r.id, idx: r.idx, bot: r.bot, total: r.total, abLv: r.abLv, chargeMul: r.chargeMul, startItem: r.startItem, skin: r.skin, trail: r.trail, plate: r.plate };
      Object.assign(r, mkRacer(r.id, r.idx, r.bot), keep);
      r.x = 80 + i * 4; r.y = S.L.startY - RH; r.safe = { x: r.x + r.w / 2, y: S.L.startY };
      r.item = r.startItem || 'speed';
      // botlar başlangıç eşyasını aynı anda değil, farklı anlarda kullanır (saldırı eşyası ise kilit bitince)
      if (r.bot) r.ai.itemT = (ATTACK[r.item] ? START_LOCK + .3 : 1) + Math.random() * 3;
    });
    clearInput();
    S.cam.x = 0; S.cam.y = 0;
  }
  game.startDemo = function () {
    const ids = FM.ORDER.slice().sort(() => Math.random() - .5).slice(0, 4);
    S.ROUNDS = 1; S.round = 1; S.themeOff = (Math.random() * FM.THEMES.length) | 0;
    S.racers = ids.map((k, i) => mkRacer(k, i, true));
    S.racers.forEach(r => Object.assign(r, randomCosmetics(Math.random)));
    S.player = S.racers[0];
    S.L = FM.genLevel(1, { len: 9000 });
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

  function ranking() {
    return S.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.x - a.x;
    });
  }
  game.ranking = ranking;

  function endRound() {
    S.mode = 'end';
    const rk = ranking();
    rk.forEach((r, i) => { r.rp = r.finished ? FM.PTS[r.place - 1] || 0 : 0; r.total += r.rp; r._rk = i; });
    const pr = rk.indexOf(S.player);
    const td = FM.TROPHY[pr] || 0;
    FM.save.trophies[S.player.id] = Math.max(0, (FM.save.trophies[S.player.id] || 0) + td);
    S.player.td = td;
    FM.persist();
    const res = { ranking: rk, player: S.player, playerRank: pr, round: S.round, rounds: S.ROUNDS, theme: S.L.theme, trophyDelta: td, last: S.round >= S.ROUNDS };
    S.lastResult = res;
    FM.emit('race:end', res);
    setTimeout(() => { if (S.mode === 'end') { S.paused = false; S.mode = 'podium'; S.podiumT = 0; FM.emit('ui:podium', res); } }, 1500);
  }

  /* =================== FİZİK YARDIMCILARI =================== */
  function solidAt(px, py) { for (const s of S.L.solids) if (px >= s.x && px < s.x + s.w && py >= s.y && py < s.y + s.h) return true; return false; }
  function boxFree(x, y, w, h) { for (const s of S.L.solids) if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) return false; return true; }
  function groundWithin(px, py, d) { for (const s of S.L.solids) if (px >= s.x && px <= s.x + s.w && s.y >= py - 4 && s.y < py + d) return true; return false; }
  function groundY(px, py) { let b = null; for (const s of S.L.solids) if (px >= s.x && px <= s.x + s.w && s.y >= py - 8 && (b === null || s.y < b)) b = s.y; return b; }
  game.solidAt = solidAt; game.groundY = groundY;
  // Kayan yarışçı ayağa kalkarsa ezici/testere makinesine çarpar mı? (altındayken kayma sürer: tek dokunuşla geçilebilsin)
  function underHazard(r) {
    const L = S.L, feet = r.y + r.h, top = feet - RH;
    for (const k of L.crush) if (r.x + r.w > k.x - 3 && r.x < k.x + k.w + 3 && top < k.y + k.h && feet > k.y + k.h) return true;
    for (const s of L.saws) if (r.x + r.w > s.cx - s.r - 4 && r.x < s.cx + s.r + 4 && Math.abs(feet - (s.cy + 80)) < 14) return true;
    return false;
  }
  // Saldırıya uğradıktan kısa süre sonra çevreden ölen yarışçının öldürmesi saldırgana yazılır (savurma/sersemletme/yavaşlatma)
  function assistOf(q) { const k = q.lastHitBy; return k && k !== q && S.raceT - (q.lastHitT == null ? -99 : q.lastHitT) < ASSIST_T ? k : null; }

  function setSlide(r, on) {
    if (on === r.slide) return true;
    if (on) { r.y += RH - SH; r.h = SH; r.slide = true; r.slideT = 0; return true; }
    if (!boxFree(r.x, r.y - (RH - SH), r.w, RH)) return false;
    r.y -= RH - SH; r.h = RH; r.slide = false; return true;
  }
  const near = r => S.player && Math.abs(cxOf(r) - cxOf(S.player)) < FM.view.VW;

  function die(r, src, cause) {
    if (r.dead > 0 || r.finished || post()) return;
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
    FM.emit('death', { r, src: src || null, killer, cause: cause || 'env', self: src === r });
  }
  function respawn(r) {
    r.x = r.safe.x - r.w / 2; r.y = r.safe.y - RH - 1; r.h = RH; r.slide = false; r.vx = RUN * .7; r.vy = 0; r.inv = 1.6; r.onGround = false;
    if (near(r)) FM.fx.puff(cxOf(r), cyOf(r), 10, 'rgba(255,255,255,.9)', 14, 80);
    FM.emit('respawn', { r });
  }
  // saldırı etkisi: true dönerse isabet
  function harm(q, kind, dur, src, cause) {
    if (q.dead > 0 || q.finished || post()) return false;
    if (q.dash > 0 || q.frozen > 0) return false;
    if (q.shield > 0) { if (near(q)) FM.fx.burst(cxOf(q), cyOf(q), ['#7be3ff', '#ffffff'], 12); FM.emit('blocked', { r: q, by: 'shield', src, cause }); return false; }
    if (q.inv > 0) return false;
    // kontrol kaybı (sersemletme/ağ/dondurma/savurma) üst üste zincirlenemez; ama öldürücü saldırılar etkili kalır
    const cc = kind === 'stun' || kind === 'net' || kind === 'freeze' || kind === 'knock';
    if (cc && q.ccImm > 0) return false;
    if (q.balloon && kind !== 'ink') { q.balloon = false; q.inv = .4; if (near(q)) FM.fx.burst(cxOf(q), q.y - 14, ['#ff5a7a', '#ffffff'], 12); FM.emit('blocked', { r: q, by: 'balloon', src, cause }); return false; }
    q.boost = 0; q.lastHitBy = src || null; q.lastHitT = S.raceT;
    if (kind === 'kill') die(q, src, cause);
    else if (kind === 'stun') { q.stun = dur; q.ccImm = dur + 1; q.climb = false; q.fly = 0; if (near(q)) FM.fx.burst(cxOf(q), q.y, ['#ffd23f', '#ffffff'], 8); }
    else if (kind === 'freeze') { q.frozen = dur; q.inv = dur + .35; q.ccImm = dur + 1; q.climb = false; q.fly = 0; if (near(q)) FM.fx.burst(cxOf(q), cyOf(q), ['#bfefff', '#ffffff'], 10, 160, 300, 'ice'); }
    else if (kind === 'net') { q.netted = dur; q.stun = dur; q.ccImm = dur + 1; q.vx = 0; q.vy = 0; q.climb = false; q.fly = 0; }
    else if (kind === 'knock') { q.vx = -480; q.vy = -320; q.stun = dur; q.inv = dur + .3; q.ccImm = dur + 1; q.climb = false; q.onGround = false; }
    else if (kind === 'slow') { q.slowT = dur; }
    else if (kind === 'pull') { q.pull = dur; }
    else if (kind === 'ink') { q.inked = dur; }
    FM.emit('hit', { victim: q, src: src || null, kind, cause: cause || null });
    return true;
  }
  game.harm = harm;
  function envHit(q, groundHaz, cause) {
    if (q.dead > 0 || q.finished || q.dash > 0 || q.shield > 0 || q.inv > 0 || q.frozen > 0) return;
    if (groundHaz && q.sled > 0) return;
    die(q, assistOf(q), cause);
  }

  /* =================== FİZİK =================== */
  function physics(r, dt) {
    const c = r.ctl, L = S.L;
    r.inv = Math.max(0, r.inv - dt); r.stun = Math.max(0, r.stun - dt); r.frozen = Math.max(0, r.frozen - dt); r.netted = Math.max(0, r.netted - dt);
    r.slowT = Math.max(0, r.slowT - dt); r.pull = Math.max(0, r.pull - dt); r.inked = Math.max(0, r.inked - dt); r.padT = Math.max(0, r.padT - dt);
    r.ccImm = Math.max(0, (r.ccImm || 0) - dt);
    const wasPow = r.dash > 0 || r.sled > 0 || r.fly > 0;
    r.boost = Math.max(0, r.boost - dt); r.shield = Math.max(0, r.shield - dt); r.dash = Math.max(0, r.dash - dt); r.sled = Math.max(0, r.sled - dt); r.fly = Math.max(0, r.fly - dt);
    // güç (atılım/kızak/süzülüş) bittiği an tehlikenin üstünde kalınca anında ölmesin: kısa lütuf süresi
    if (wasPow && r.dash <= 0 && r.sled <= 0 && r.fly <= 0 && r.dead <= 0) r.inv = Math.max(r.inv, .35);
    r.land = Math.max(0, r.land - dt * 5); r.jumpT = Math.max(0, r.jumpT - dt * 5);
    if (r.dead > 0) { r.dead -= dt; if (r.dead <= 0) respawn(r); c.jp = c.dp = c.use = c.ab = false; return; }
    const running = S.mode === 'race' || S.mode === 'demo';
    if (running && !r.finished) r.charge = Math.min(100, r.charge + dt * 4 * r.chargeMul);
    if (r.netted > 0) { r.vx = 0; r.vy = 0; c.jp = c.dp = c.use = c.ab = false; return; }
    const locked = r.stun > 0 || r.frozen > 0 || !running || r.finished;
    // hedef hız
    let mult = 1;
    if (r.boost > 0) mult *= 1.45;
    if (r.padT > 0) mult *= 1.3;
    if (r.sled > 0) mult *= 1.5;
    if (r.fly > 0) mult *= 1.3;
    if (r.slowT > 0) mult *= .5;
    if (r.onMud && r.sled <= 0) mult *= .6;
    if (r.dash > 0) mult = 2.2;
    if (r.bot) mult *= 1 + .035 * Math.sin(S.T * .55 + r.idx * 2.1);   // ortalaması 0: yalnızca görsel ayrışma
    let tgt = locked ? 0 : RUN * mult;
    if (r.onBelt && !locked) tgt += 200;
    if (r.pull > 0) tgt = -300;
    if (r.frozen > 0) r.vx *= Math.max(0, 1 - .4 * dt);
    else {
      const acc = (r.onGround ? ACC : AIRACC) * (r.dash > 0 || r.pull > 0 || r.stun > 0 ? 4 : 1);
      r.vx += clamp(tgt - r.vx, -acc * 1.6 * dt, acc * dt);
    }
    if (r.onGround) r.coy = .1; else r.coy -= dt;
    if (!r.onGround && r.coy <= 0 && r.jumps === 0) r.jumps = 1;
    // eylemler
    if (!locked) {
      if (c.jp) {
        if (r.fly > 0) { r.vy = -420; if (near(r)) FM.fx.puff(cxOf(r), cyOf(r), 4, 'rgba(255,255,255,.9)', 8, 80); FM.emit('flap', { r }); }
        else if (r.climb) { }
        else if (r.coy > 0) {
          if (!(r.slide && !setSlide(r, false))) {
            r.vy = -JUMP; r.vx *= .96; r.coy = 0; r.jumps = 1; r.onGround = false; r.jumpT = 1;
            if (near(r)) FM.fx.puff(cxOf(r), r.y + r.h, 4, 'rgba(255,255,255,.8)', 7, 70);
            FM.emit('jump', { r, dbl: false });
          }
        } else if (r.jumps < 2) {
          if (r.slide) setSlide(r, false);
          r.vy = -DJ; r.vx *= .88; r.jumps = 2; r.slam = false; r.jumpT = 1;
          if (near(r)) FM.fx.burst(cxOf(r), r.y + r.h, ['#ffffff', '#bfe9ff'], 7, 110, 300, 'star', 4);
          FM.emit('jump', { r, dbl: true });
        }
      }
      if (c.dp) {
        if (r.onGround && !r.slide) { setSlide(r, true); FM.emit('slide', { r }); }
        else if (!r.onGround && !r.climb && r.fly <= 0 && r.dash <= 0 && !r.slam) { r.vy = SLAM; r.slam = true; FM.emit('slam', { r }); }
      }
      if (c.use) useItem(r);
      if (c.ab) useAbility(r);
    }
    c.jp = c.dp = c.use = c.ab = false;
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
    else if (r.dash > 0) { r.vy = 0; }
    else {
      let g = G;
      if (r.fly > 0) g *= .12;
      else if (r.vy < 0 && !c.jh && !r.slam) g *= 1.6;
      r.vy = Math.min(r.fly > 0 ? 90 : 1500, r.vy + g * dt);
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
            if (near(r) && (vyBefore > 700 || r.slam)) FM.fx.puff(cxOf(r), r.y + r.h, r.slam ? 10 : 5, 'rgba(255,255,255,.85)', r.slam ? 12 : 8, r.slam ? 140 : 70);
            if (r.slam) { if (r === S.player) FM.fx.shake(.12); FM.emit('slamLand', { r }); }
            FM.emit('land', { r, hard: vyBefore > 900 });
          }
          r.slam = false;
        } else if (r.vy < 0) { r.y = s.y + s.h; if (r.climb) r.climb = false; }
        r.vy = 0;
      }
    }
    if (r.onGround || r.climb) r.ph += (r.climb ? CLIMB : Math.abs(r.vx)) * dt * .05;
    else r.ph += dt * 4;
    // zemin öğeleri
    r.onMud = false; r.onBelt = false;
    const cx = cxOf(r), feet = r.y + r.h;
    if (r.onGround) {
      for (const p of L.pads) if (cx > p.x && cx < p.x + p.w && Math.abs(feet - p.y) < 3) { if (r.padT < .5) FM.emit('pad', { r }); r.padT = 1.3; }
      for (const b of L.belts) if (cx > b.x && cx < b.x + b.w && Math.abs(feet - b.y) < 3) r.onBelt = true;
      for (const m of L.mud) if (cx > m.x && cx < m.x + m.w && Math.abs(feet - m.y) < 3) r.onMud = true;
    }
    if (r.vy >= 0) for (const m of L.mush) {
      if (cx > m.x - 4 && cx < m.x + m.w + 4 && feet > m.y - 24 && feet <= m.y + 2) {
        if (r.slide) setSlide(r, false);
        r.vy = -MUSH; r.jumps = 1; r.onGround = false; r.y = m.y - 24 - r.h; m.sq = .3; r.jumpT = 1;
        FM.emit('mush', { r });
      }
    }
    // çevre tehlikeleri
    const hb = { x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 7 };
    for (const s of L.spikes) if (ov(hb, { x: s.x + 5, y: s.y + 8, w: s.w - 10, h: s.h - 8 })) envHit(r, true, 'spikes');
    for (const k of L.crush) if (ov(hb, k)) envHit(r, true, 'crush');
    for (const s of L.saws) {
      const nx = clamp(s.px, hb.x, hb.x + hb.w), ny = clamp(s.py, hb.y, hb.y + hb.h);
      if ((nx - s.px) ** 2 + (ny - s.py) ** 2 < (s.r - 4) ** 2) envHit(r, false, 'saw');
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
        if (ok) { r.safe.x = cx; r.safe.y = sy; }
      }
    }
    // kutular (her yarışçı için ayrı)
    for (const b of L.boxes) {
      if (b.cd[r.idx] > 0) b.cd[r.idx] -= dt;
      else if (ov(r, b)) {
        b.cd[r.idx] = 3.5; r.charge = Math.min(100, r.charge + 18);
        const got = !r.item;
        if (got) { r.item = rollItem(r); if (r.bot) r.ai.itemT = .5 + Math.random() * 2; }
        if (near(r)) FM.fx.burst(b.x + 16, b.y + 16, ['#ff4d4d', '#ffffff', '#ffd23f'], 12, 200, 400, 'star', 4);
        FM.emit('box', { r, item: got ? r.item : null });
      }
    }
    // altınlar (her yarışçı kendi altınlarını toplar)
    const bit = 1 << r.idx;
    for (const co of L.coins) {
      if (co.got & bit) continue;
      if (Math.abs(co.x - cx) < 22 && co.y > r.y - 16 && co.y < r.y + r.h + 10) {
        co.got |= bit; r.coins++;
        if (r === S.player) { FM.fx.sparks(co.x, co.y, 6, '#ffe14d', 180); }
        FM.emit('coin', { r, x: co.x, y: co.y });
      }
    }
    // bitiş
    if (!r.finished && r.x > L.end) {
      r.finished = true; r.place = ++S.finishedN; r.ftime = S.raceT; r.inv = 999; r.item = null;
      if (S.mode !== 'demo') FM.fx.toast(`${r.name} bitirdi!  #${r.place}`, r === S.player ? '#ffe14d' : '#ffffff');
      if (near(r)) FM.fx.confetti(L.end + 40, L.finY - 200, r === S.player ? 70 : 25);
      if (S.finishedN === 1) S.endTimer = 12;
      FM.emit('finish', { r, place: r.place, time: r.ftime });
    }
  }

  /* =================== EŞYALAR =================== */
  function rollItem(r) {
    const rk = ranking().indexOf(r), f = rk / (S.racers.length - 1);
    const w = { saw: 14, dyn: 12, trap: 6 + 10 * (1 - f), mis: rk > 0 ? 6 + 12 * f : 0, bolt: f > .6 ? 5 : 0, ice: 5 + 6 * f, mag: rk > 0 ? 5 + 8 * f : 0, net: 4 + 10 * (1 - f), ink: rk > 0 ? 3 + 6 * f : 0, speed: 8 + 14 * f, shield: 8 + 6 * (1 - f), balloon: 9 };
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
    const cx = cxOf(r), cy = cyOf(r);
    let gyTrap = null;
    if (it === 'trap') { gyTrap = groundY(r.x - 12, r.y + r.h - 10); if (gyTrap === null) return; }   // çukurun üstünde: kurulamaz, eşya elde kalır
    r.item = null;
    switch (it) {
      case 'speed': r.boost = 3.2; r.shield = 0; break;
      case 'shield': r.shield = 4; r.boost = 0; break;
      case 'balloon': r.balloon = true; break;
      case 'saw': S.ents.push({ type: 'saw', x: cx + 20, y: r.y + r.h - 16, vx: 720 + Math.max(0, r.vx) * .3, vy: 0, r: 15, o: r, age: 0, life: 2.4, b: 0 }); break;
      // uzun atış: patlama atanın ~250+ px önüne düşer (eskiden 114 px: atan sık sık kendini patlatıyordu)
      case 'dyn': S.ents.push({ type: 'dyn', x: cx + 10, y: r.y, vx: Math.max(0, r.vx) + 520, vy: -600, o: r, age: 0, fuse: .95 }); break;
      case 'trap': S.ents.push({ type: 'trap', x: r.x - 26, y: gyTrap - 12, w: 34, h: 12, o: r, age: 0, life: 16 }); break;
      case 'net': S.ents.push({ type: 'net', x: r.x - 56, y: r.y - 30, w: 44, h: 76, o: r, age: 0, life: 10, n: 0 }); break;
      case 'mis': {
        const rk = ranking().filter(q => !q.finished && q.dead <= 0);
        const tgt = rk[0] === r ? rk[1] : rk[0];
        if (!tgt) { r.item = it; return; }   // hedef yok: eşya boşa gitmesin
        S.ents.push({ type: 'mis', x: cx, y: r.y - 30, vx: 0, vy: 0, tgt, o: r, age: 0, warn: 1.1 });
        break;
      }
      case 'bolt': for (const q of S.racers) if (q !== r && !q.finished && q.x > r.x) S.ents.push({ type: 'bolt', tgt: q, o: r, t: 1.8, age: 0 }); break;   // yalnızca öndekiler
      case 'ice': for (const q of S.racers) if (q !== r) harm(q, 'freeze', 2.2, r, 'ice'); FM.fx.ring(cx, cy, 300, '#bfefff', .6); break;
      case 'mag': S.ents.push({ type: 'mag', o: r, t: .45, age: 0 }); break;
      case 'ink': for (const q of S.racers) if (q !== r && q.x > r.x) harm(q, 'ink', 3.5, r, 'ink'); FM.fx.burst(cx, cy, ['#222233', '#444466'], 16, 240); break;
    }
    FM.emit('item:use', { r, item: it });
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
    if (S.player && Math.hypot(x - cxOf(S.player), y - cyOf(S.player)) < 520) FM.fx.shake(.35);
    FM.emit('explode', { x, y, rad, owner });
  }

  /* =================== ÖZEL GÜÇLER =================== */
  function useAbility(r) {
    if (r.charge < 100 || r.dead > 0 || r.finished) return;
    r.charge = 0;
    const cx = cxOf(r), cy = cyOf(r), k = 1 + (r.abLv - 1) * .1; // seviye başına %10 güç
    if (S.mode !== 'demo') FM.fx.toast(`${r.name}: ${FM.CH[r.id].ab}!`, FM.CH[r.id].col2);
    switch (r.id) {
      case 'TAFTAF': r.dash = .55 * k; r.climb = false; if (r.slide) setSlide(r, false); FM.fx.burst(cx, cy, ['#5b2a86', '#c9a0ff'], 16, 200, 0, 'star'); break;
      case 'Caner': {
        const tgt = aheadOf(r, 1300);
        if (tgt) for (let i = 0; i < 3; i++) S.ents.push({ type: 'crow', x: cx - 10 * i, y: cy - 20 - i * 12, tgt, o: r, life: 3.5, first: i === 0, ph: i, age: 0, dur: 2.0 * k });
        else { r.boost = 2.2 * k; FM.fx.burst(cx, cy, ['#c0182e', '#1d1d26'], 16, 220); }
        break;
      }
      case 'LUL': {
        const rad = 340 * k;
        for (const q of S.racers) if (q !== r && Math.abs(cxOf(q) - cx) < rad && Math.abs(cyOf(q) - cy) < 130 && q.onGround) harm(q, 'stun', 1.7 * k, r, 'LUL');
        FM.fx.ring(cx, r.y + r.h, rad, '#8fa8dd', .6, 10); FM.fx.burst(cx, r.y + r.h, ['#8a6a3a', '#dddddd'], 24, 300); FM.fx.puff(cx, r.y + r.h, 14, 'rgba(200,180,150,.8)', 16, 220);
        if (near(r)) FM.fx.shake(.25);
        break;
      }
      case 'ertan': r.sled = 1.25 * k; if (r.onGround) setSlide(r, true); FM.fx.burst(cx, cy + 10, ['#bfefff', '#ffffff'], 14, 160, 200, 'ice'); break;
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
      case 'Nuss': r.fly = 2.4 * k; r.vy = -520; r.climb = false; if (r.slide) setSlide(r, false); FM.fx.burst(cx, cy, ['#ffffff', '#7be3ff'], 16, 200, 100, 'leaf'); break;
      case 'baso': S.ents.push({ type: 'wave', x: r.x + r.w, y: cy, o: r, life: 1.15 * k, hit: [], age: 0, dur: 3.2 * k }); break;
    }
    FM.emit('ability', { r, id: r.id });
  }

  /* =================== VARLIKLAR =================== */
  function circleHit(e, q, rad) { const hx = clamp(e.x, q.x, q.x + q.w), hy = clamp(e.y, q.y, q.y + q.h); return (hx - e.x) ** 2 + (hy - e.y) ** 2 < rad * rad; }
  function updateEnts(dt) {
    for (const e of S.ents) {
      e.age = (e.age || 0) + dt;
      switch (e.type) {
        case 'saw': {
          e.vy = Math.min(1500, e.vy + G * dt);
          e.x += e.vx * dt;
          if (solidAt(e.x + Math.sign(e.vx) * e.r, e.y)) { e.vx = -e.vx * .9; e.x += e.vx * dt * 2; e.b++; if (e.b > 2) e.life = 0; FM.fx.sparks(e.x, e.y, 6, '#ffe9a0', 260); }
          e.y += e.vy * dt;
          if (e.vy > 0 && solidAt(e.x, e.y + e.r)) { let k = 0; while (solidAt(e.x, e.y + e.r) && k < 60) { e.y -= 1; k++; } e.vy = 0; }
          e.life -= dt; if (e.y > C.KILLY) e.life = 0;
          for (const q of S.racers) { if (q === e.o && e.b === 0 && e.age < .7) continue; if (circleHit(e, q, e.r - 2)) harm(q, 'kill', 0, e.o, 'saw'); }
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
    S.ents = S.ents.filter(e => !e.dead && !(e.life !== undefined && e.life <= 0 && e.type !== 'bolt'));
  }

  /* =================== YAPAY ZEKÂ =================== */
  function ai(r, dt) {
    const a = r.ai, c = r.ctl, L = S.L;
    a.skip = Math.max(0, a.skip - dt); a.itemT -= dt; a.slideT = Math.max(0, a.slideT - dt);
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
    return true;
  }

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
    const L = S.L;
    for (const s of L.saws) { s.px = s.cx; s.py = s.cy + Math.sin(S.T * s.sp + s.ph) * s.amp; }
    for (const m of L.mush) if (m.sq > 0) m.sq -= dt;
  }
  game.step = function (dt) {
    if (!S.L) return;
    S.T += dt; updateLevel(dt);
    if (S.mode === 'count') {
      S.countT -= dt;
      const n = Math.ceil(S.countT - .6);
      if (n !== S.lastCount) { S.lastCount = n; FM.emit('countdown', { n: Math.max(0, n) }); }
      // geri sayımda basılan ZIPLA/EŞYA/GÜÇ tamponlanıp KOŞ! anında kendiliğinden tetiklenmesin (basılı tutma bilgisi kalır)
      clearInput();
      for (const r of S.racers) { const c = r.ctl; c.jp = c.dp = c.use = c.ab = false; physics(r, dt); }
      if (S.countT <= 0) { S.mode = 'race'; FM.fx.toast('KOŞ!', '#7be3ff'); FM.emit('go', {}); }
      return;
    }
    if (S.mode === 'race' || S.mode === 'end' || S.mode === 'demo' || S.mode === 'podium') {
      if (S.mode === 'race' || S.mode === 'demo') S.raceT += dt;
      const after = post();
      for (const r of S.racers) {
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
        if (S.endTimer === null && S.raceT > 150) S.endTimer = 10;
        if (S.endTimer !== null) S.endTimer -= dt;
        if (S.finishedN === S.racers.length || (S.endTimer !== null && S.endTimer <= 0)) endRound();
      } else if (S.mode === 'demo') {
        if (S.finishedN >= 1 && S.endTimer !== null) S.endTimer -= dt;
        if (S.finishedN === S.racers.length || (S.endTimer !== null && S.endTimer <= 4) || S.raceT > 90) game.startDemo();
      }
    }
  };
  // yardımcıları dışa aç (test/geliştirme için)
  game.physics = physics; game.ai = ai; game.useItem = useItem; game.useAbility = useAbility; game.mkRacer = mkRacer; game.explode = explode;
})(window.FM);

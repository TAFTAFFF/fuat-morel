/* FUAT MOREL — main.js : tuval, döngü, kamera, çizim sırası, klavye, geliştirici modu. EN SON yüklenir. */
'use strict';
(function (FM) {
  const S = FM.S, C = FM.C, V = FM.view;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  FM.canvas = cv; FM.ctx = ctx;
  const touchNow = () => !!FM.isTouch;   // FM.isTouch core.js'de belirlenir (ui.js ilk dokunuşta güncelleyebilir)

  /* ---------- uyarlanır çözünürlük ----------
     Telefon yarışta yavaşsa çizim çözünürlüğü kademeli düşer (adaptDpr). Karar yarış ortasında verilse bile
     önbellek yenilemesi (takılma) yarış DIŞINDA uygulanır. Öğrenilen değer kayıtta saklanır.
     Kalite ayarı 'low' ise hep 1. Yüksek DPR'li ekranlarda alt sınır 1.25 (HUD yazıları bulanıklaşmasın). */
  const devDpr = () => window.devicePixelRatio || 1;
  const dprFloor = () => devDpr() >= 2 ? 1.25 : 1;
  const stepDown = d => d > 1.5 ? 1.5 : d > 1.25 ? 1.25 : 1;
  const stepUp = d => d < 1.25 ? 1.25 : d < 1.5 ? 1.5 : 2;
  const settings = () => (FM.save && FM.save.settings) || {};
  let adaptDpr = 2;
  { const sv = +settings().adaptDpr; if (sv >= 1 && sv <= 2) adaptDpr = sv; }
  adaptDpr = Math.max(adaptDpr, dprFloor());
  let pendingDpr = 0;
  let lastQuality = settings().quality;

  /* ---------- güvenli alan (çentikli telefonlar): sol kenar boşluğu, CSS px ---------- */
  let safeL = 0;
  function measureSafe() {
    safeL = 0;
    try {
      if (!document.body) return;
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px)';
      document.body.appendChild(d);
      safeL = parseFloat(getComputedStyle(d).paddingLeft) || 0;
      d.remove();
    } catch (e) { safeL = 0; }
  }

  /* ---------- boyutlandırma ---------- */
  let lastKey = '', lastRs = 0, dirty = true;
  function resize(force) {
    const q = settings().quality;
    if (q !== lastQuality) {
      // kullanıcı kaliteyi 'düşük'ten geri aldıysa öğrenilmiş düşük çözünürlüğü unut
      if (lastQuality === 'low' && q !== 'low') { adaptDpr = 2; pendingDpr = 0; saveDpr(); }
      lastQuality = q;
    }
    const touch = touchNow();
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    let dpr = Math.min(devDpr(), q === 'low' ? 1 : adaptDpr);
    // dokunmatikte toplam piksel sınırı (tablet / büyük ekran): ~2.4 MP üstüne çıkma
    if (touch) dpr = Math.min(dpr, Math.max(1, Math.sqrt(2.4e6 / (w * h))));
    dpr = Math.round(dpr * 100) / 100;
    const key = w + 'x' + h + '@' + dpr + (touch ? 't' : 'm');
    if (key === lastKey && !force) return;   // boyut değişmediyse hiçbir şey yapma (önbellekler korunur, takılma yok)
    lastKey = key;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    V.dpr = dpr; V.W = cv.width; V.H = cv.height;
    // Telefonda (kısa ekran) kamera yakınlaşır: karakterler parmak ucu kadar küçük kalmasın.
    V.VH = (touch || h < 520) ? 440 : C.VH;
    V.S = cv.height / V.VH; V.VW = cv.width / V.S;
    V.mobile = touch;
    measureSafe();
    // sprite önbelleğini yalnızca sprite çözünürlüğü gerçekten değiştiyse boşalt
    if (FM.gfx) { const k = FM.gfx.rs(); if (k !== lastRs) { if (lastRs) FM.gfx.clearCache(); lastRs = k; } }
    if (FM.R.resize) try { FM.R.resize(); } catch (e) { console.error(e); }
    FM.emit('resize', V);
    if (S.paused && S.L) updateCamera(0, true);   // duraklatılmışken kare güncellenmez: kamerayı yeni görünüm genişliğine oturt
    dirty = true;
  }
  // Tarayıcı olayları seyreltilir: bir serinin ilk olayı hemen uygulanır, art arda gelenler (iOS araç çubuğu,
  // döndürme animasyonu) seri bitince tek yenilemeye iner. Boyut aynıysa resize() hiçbir şey yapmaz.
  let rzT = 0, rzLast = -1e9;
  function queueResize(ms) {
    const now = performance.now();
    clearTimeout(rzT);
    if (now - rzLast > 250) { rzLast = now; resize(false); }
    rzT = setTimeout(() => { rzLast = performance.now(); resize(false); }, ms);
  }
  window.addEventListener('resize', () => queueResize(120));
  window.addEventListener('orientationchange', () => queueResize(300));
  FM.resize = function () { resize(true); };   // ui.js (kalite değişimi) çağırır
  function saveDpr() { try { settings().adaptDpr = adaptDpr; if (FM.persist) FM.persist(); } catch (e) { } }
  function applyPendingDpr() {
    if (!pendingDpr) return;
    adaptDpr = pendingDpr; pendingDpr = 0; saveDpr();
    resize(true);
  }

  /* ---------- kamera ----------
     Yatay: oyuncu (gövde merkezi) her hızda ekranın ~%28-33'ünde; dokunmatikte sol düğmelerin (KAY/EŞYA) ve çentiğin sağında kalır.
     Dikey: zemine bağlı ölü bölge. Normal ve çift zıplamada kamera sabit kalır (zemin/çukur görünür kalır);
     oyuncu ekranın üst %16'sına girerse yukarı kayar; son zeminin altına düşerken aşağıyı gösterir;
     sert sınırlar sayesinde oyuncu hızlı düşüşte ya da mantar fırlatmasında ekrandan çıkmaz. */
  const cam = { t: null, gy: null };
  function camTarget() {
    if (S.mode === 'demo') { // demoda öndekini izle
      let lead = S.racers[0];
      for (const r of S.racers) if (!r.finished && r.dead <= 0 && r.x > lead.x) lead = r;
      return lead;
    }
    return S.player;
  }
  function updateCamera(dt, snap) {
    const t = camTarget(); if (!t || !S.L) return;
    const touch = touchNow(), VW = V.VW, VH = V.VH, cl = FM.clamp;
    if (S.cam.x === 0 && S.cam.y === 0) snap = true;   // yeni tur/demo başında (resetRace kamerayı 0,0'a çeker): kayarak gelme, yerine otur
    // --- yatay
    let tx;
    if (touch) { const sl = safeL * (V.dpr || 1) / (V.S || 1); tx = t.x - (VW * .29 + sl) + cl(t.vx * .12, -40, 70); }
    else tx = t.x - VW * .30 + cl(t.vx * .15, -50, 110);
    tx = Math.max(0, tx);
    // --- dikey
    if (cam.t !== t) { cam.t = t; cam.gy = null; }
    const feet = t.y + t.h, dead = t.dead > 0;
    if (dead) cam.gy = null;
    else if (t.onGround || t.climb) cam.gy = feet;
    const g = cam.gy != null ? cam.gy : feet;
    const kF = touch ? .60 : .64;                         // zemindeyken ayakların ekran yüksekliğindeki yeri
    let ty = g - VH * kF;
    const fall = !dead && t.vy > 0 && feet > g + 4;       // son basılan zeminin altına iniyor (basamak inişi / çukur)
    if (fall) ty = Math.max(ty, feet - VH * kF + cl(t.vy * .1, 0, 90));   // düşerken aşağıyı göster
    const topK = touch ? .26 : .16, hardK = touch ? .19 : .06;   // telefonda üst çubuk + isim plakası ~%19 yer kaplar
    if (!dead) ty = Math.min(ty, t.y - VH * topK);        // üst banda girerse yukarı kay
    const minY = -760, maxY = S.L.liq + 95 - VH;
    ty = cl(ty, minY, maxY);
    if (snap) { S.cam.x = tx; S.cam.y = ty; return; }
    S.cam.x += (tx - S.cam.x) * Math.min(1, 7 * dt);
    const rate = fall && t.vy > 300 ? 9 : t.climb ? 6 : ty < S.cam.y ? 7 : 3;
    S.cam.y += (ty - S.cam.y) * Math.min(1, rate * dt);
    if (!dead) {
      // sert sınırlar: ayaklar ekranın %86'sının altına, baş üst %6'nın üstüne çıkmasın
      const lo = feet - VH * .86, hi = t.y - VH * hardK;
      if (S.cam.y < lo) S.cam.y = lo;
      if (S.cam.y > hi) S.cam.y = hi;
    }
    S.cam.y = cl(S.cam.y, minY, maxY);
  }
  FM.updateCamera = updateCamera;

  /* ---------- çizim ---------- */
  function call(fn, ...a) { if (typeof fn === 'function') { try { fn(...a); } catch (e) { if (!call.errs) call.errs = 0; if (call.errs++ < 20) console.error(e); } } }
  function render() {
    const R = FM.R;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!S.L) { ctx.fillStyle = '#2a1a4a'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
    // 1) arka plan (ekran koordinatı, ölçek S)
    ctx.setTransform(V.S, 0, 0, V.S, 0, 0);
    call(R.drawBackground, ctx);
    // 2) dünya
    const sh = S.shake > 0 && FM.save.settings.shake !== false ? S.shake / .35 : 0;
    const sx = sh ? (Math.random() - .5) * 14 * sh : 0, sy = sh ? (Math.random() - .5) * 14 * sh : 0;
    ctx.setTransform(V.S, 0, 0, V.S, 0, 0);
    ctx.translate(-Math.round(S.cam.x * V.S) / V.S + sx, -Math.round(S.cam.y * V.S) / V.S + sy);
    call(R.drawWorldBack, ctx);
    call(R.drawEnts, ctx);
    call(R.drawRacers, ctx);
    call(R.drawParticles, ctx);
    call(R.drawWorldFront, ctx);
    // 3) ekran efektleri + HUD
    ctx.setTransform(V.S, 0, 0, V.S, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    call(R.drawScreenFX, ctx);
    if (S.mode === 'count' || S.mode === 'race' || S.mode === 'end') call(R.drawHUD, ctx);
    if (S.mode === 'podium') call(R.drawPodium, ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  FM.render = render;

  /* ---------- ne zaman çizilir? (pil/ısınma) ----------
     Duraklatılmışken ve "telefonu yan çevir" katmanı açıkken görüntü değişmez: bir kez çiz, sonra yarım saniyede bir tazele.
     Menünün alt ekranlarında / final ekranında / menü pencerelerinde arkadaki demo yarışı bulanık ve neredeyse opak bir
     panelin arkasında kalır: 30 FPS yeterli (bulanıklık filtresi de yarı sıklıkla yeniden hesaplanır). */
  let rotEl = null, wasPaused = false, frameN = 0, lastStill = 0;
  function rotOn() {
    if (!rotEl) rotEl = document.querySelector('.ly-rot');
    return !!(rotEl && rotEl.classList.contains('on'));
  }
  function behindPanel() {
    if (FM.lowFps === true) return true;
    if (S.mode !== 'demo' && S.mode !== 'menu') return false;
    const st = FM.ui && typeof FM.ui.state === 'function' ? FM.ui.state() : null;
    if (!st) return false;
    return st.view === 'final' || (st.view === 'menu' && (st.screen !== 'menu' || !!st.modal));
  }
  function shouldRender(now) {
    frameN++;
    if (S.paused !== wasPaused) { wasPaused = S.paused; dirty = true; }
    if (dirty) { dirty = false; lastStill = now; return true; }
    if (S.paused || rotOn()) { if (now - lastStill > 500) { lastStill = now; return true; } return false; }
    if (behindPanel()) return (frameN & 1) === 0;
    return true;
  }

  /* ---------- kare güncelleme (görsel, gerçek dt) ---------- */
  function frameUpdate(dt) {
    for (const t of S.toasts) t.t -= dt; S.toasts = S.toasts.filter(t => t.t > 0);
    for (const f of S.feed) f.t -= dt; S.feed = S.feed.filter(f => f.t > 0);
    S.shake = Math.max(0, S.shake - dt);
    S.flash.a = Math.max(0, S.flash.a - dt * 2.2);
    if (S.mode === 'podium') S.podiumT = (S.podiumT || 0) + dt;
    for (const u of FM.R.updaters) call(u, dt);
    updateCamera(dt);
  }

  /* ---------- performans izleme: YALNIZCA yarışta ölçülür (menü bulanıklığı vb. yanıltmasın) ---------- */
  const perf = { sum: 0, n: 0, slow: 0, good: 0, downs: 0, ups: 0 };
  function watchPerf(dt) {
    if (S.paused || document.hidden || FM.DEV || S.mode !== 'race') { perf.sum = 0; perf.n = 0; return; }
    perf.sum += dt; perf.n++;
    if (perf.n < 90) return;
    const avg = perf.sum / perf.n; perf.sum = 0; perf.n = 0;
    if (avg > 1 / 45) { perf.slow++; perf.good = 0; }
    else { perf.slow = Math.max(0, perf.slow - 1); perf.good = avg < 1 / 56 ? perf.good + 1 : 0; }
    const cur = pendingDpr || adaptDpr;
    if (perf.slow >= 2 && cur > dprFloor()) {
      pendingDpr = Math.max(dprFloor(), stepDown(cur)); perf.slow = 0; perf.good = 0; perf.downs++;
    } else if (perf.good >= 12 && perf.downs <= 1 && perf.ups < 1 && cur < 2 && settings().quality !== 'low' && devDpr() > cur) {
      // yük kalktı (ör. arka plan uygulaması kapandı): oturum başına bir kez bir kademe geri çık
      pendingDpr = stepUp(cur); perf.good = 0; perf.ups++;
    }
  }

  /* ---------- ana döngü (sabit adımlı fizik) ---------- */
  let last = performance.now(), acc = 0, loopErrs = 0;
  function loop(now) {
    try {
      let dt = (now - last) / 1000; last = now;
      if (dt > .1) dt = .1; if (dt < 0) dt = 0;
      if (touchNow() !== !!V.mobile) resize(false);           // ilk dokunuşta dokunmatik düzene geçildi: telefon kamerası
      if (pendingDpr && S.mode !== 'race') applyPendingDpr();   // çözünürlük düşürme yarış dışında (takılma görünmesin)
      watchPerf(dt);
      if (!S.paused && S.L) {
        acc += dt;
        let n = 0;
        while (acc >= C.STEP && n < 12) { FM.game.step(C.STEP); acc -= C.STEP; n++; }
        if (n >= 12) acc = 0;
        frameUpdate(dt);
      }
      if (shouldRender(now)) render();
    } catch (e) {
      if (loopErrs++ < 10) console.error(e);
    } finally {
      requestAnimationFrame(loop);
    }
  }

  /* ---------- klavye ---------- */
  const I = FM.input;
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'], DOWN_KEYS = ['ArrowDown', 'KeyS'];
  window.addEventListener('keydown', e => {
    const c = e.code;
    const inGame = S.mode === 'race' || S.mode === 'count';
    if (inGame && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (e.repeat) return;
    if (c === 'Escape' || c === 'KeyP') { if (inGame || S.paused) FM.emit('ui:pause', { toggle: true }); return; }
    if (!inGame || S.paused) return;
    if (JUMP_KEYS.includes(c)) { I.jp = true; I.jh = true; }
    else if (DOWN_KEYS.includes(c)) { I.dp = true; I.dh = true; }
    else if (c === 'KeyE' || c === 'ShiftLeft' || c === 'ShiftRight' || c === 'KeyJ') I.use = true;
    else if (c === 'KeyQ' || c === 'KeyF' || c === 'KeyK') I.ab = true;
  });
  window.addEventListener('keyup', e => {
    if (JUMP_KEYS.includes(e.code)) I.jh = false;
    else if (DOWN_KEYS.includes(e.code)) I.dh = false;
  });
  /* ---------- telefon: tam ekran + yatay kilit, yakınlaştırma/uzun basma engelleri ---------- */
  FM.enterFullscreen = function () {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { }); } catch (e) { }
        }).catch(() => { });
      }
    } catch (e) { }
  };
  document.addEventListener('contextmenu', e => { if (S.mode === 'race' || S.mode === 'count' || e.target === cv) e.preventDefault(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  cv.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  cv.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  window.addEventListener('blur', () => { I.jh = I.dh = false; if (S.mode === 'race' && !S.paused) FM.emit('ui:pause', { toggle: false, force: true }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.mode === 'race' && !S.paused) FM.emit('ui:pause', { force: true }); last = performance.now(); dirty = true; });
  if (document.fonts && document.fonts.addEventListener) { try { document.fonts.addEventListener('loadingdone', () => { dirty = true; }); } catch (e) { } }

  /* ---------- geliştirici modu: ?dev=1&scene=race&t=6&char=Kral&theme=2&seed=5 ----------
     Simülasyonu senkron ilerletip tek kare çizer (headless ekran görüntüsü için). */
  function devScene() {
    const P = FM.params, scene = P.scene || 'race', t = +(P.t || 6);
    const theme = P.theme != null ? +P.theme : undefined;
    if (scene === 'race' || scene === 'podium' || scene === 'hud') {
      FM.game.startMatch({ char: P.char, rounds: +(P.rounds || 3), theme, themeIdx: theme, auto: P.auto !== '0', seed: P.seed != null ? +P.seed : undefined });
      FM.emit('ui:hide');
      S.countT = .01;
      const until = scene === 'podium' ? 240 : t;
      let sim = 0;
      while (sim < until) {
        FM.game.step(C.STEP); sim += C.STEP;
        if ((sim * 120 | 0) % 2 === 0) frameUpdate(C.STEP * 2);
        if (scene === 'podium' && (S.mode === 'end' || S.mode === 'podium')) break;
      }
      if (scene === 'podium') { S.mode = 'podium'; S.podiumT = 2; FM.emit('ui:podium', S.lastResult); for (let i = 0; i < 120; i++) frameUpdate(1 / 60); }
      updateCamera(0, true);
      for (let i = 0; i < 30; i++) frameUpdate(1 / 120);
      S.paused = P.run !== '1';
    } else {
      // menü / ui ekranları: demo arka planda
      FM.game.startDemo();
      let sim = 0; while (sim < t) { FM.game.step(C.STEP); sim += C.STEP; if ((sim * 120 | 0) % 2 === 0) frameUpdate(C.STEP * 2); }
      updateCamera(0, true);
      S.paused = P.run !== '1';
    }
    dirty = true;
  }

  /* ---------- açılış ---------- */
  function boot() {
    resize(true);
    FM.emit('boot', {});
    if (FM.DEV && FM.params.scene) devScene();
    else { FM.game.startDemo(); updateCamera(0, true); FM.emit('ui:menu', {}); }
    requestAnimationFrame(t => { last = t; loop(t); });
  }
  FM.boot = boot;
  const fontsReady = (document.fonts && document.fonts.ready) ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
  fontsReady.then(boot, boot);
})(window.FM);

/* FUAT MOREL — main.js : tuval, döngü, kamera, çizim sırası, klavye, geliştirici modu. EN SON yüklenir. */
'use strict';
(function (FM) {
  const S = FM.S, C = FM.C, V = FM.view;
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  FM.canvas = cv; FM.ctx = ctx;
  const touchNow = () => !!FM.isTouch;   // FM.isTouch core.js'de belirlenir (ui.js ilk dokunuşta güncelleyebilir)

  /* ---------- uyarlanır çözünürlük ----------
     Herkes YÜKSEK çözünürlükte oynar: varsayılan cihazın kendi DPR'si (en çok 3). Telefon yarışta çok yavaşsa
     çözünürlük kademeli düşer ama yüksek DPR'li ekranlarda 2'nin altına inmez (karakterler bulanıklaşmasın).
     Karar yarış ortasında verilse bile önbellek yenilemesi (takılma) yarış DIŞINDA uygulanır. Öğrenilen değer kayıtta
     `adaptDpr3` olarak saklanır (eski `adaptDpr` anahtarındaki öğrenilmiş düşük değerler yok sayılır).
     Kalite ayarı 'low' ise hep 1. */
  const devDpr = () => window.devicePixelRatio || 1;
  const DPR_MAX = 3;
  const dprFloor = () => devDpr() >= 2 ? 2 : 1;   // yüksek çözünürlük (oyuncu isteği): yüksek DPR'li telefonda 2x'in altına inmez
  const LV = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const stepDown = d => { for (let i = LV.length - 1; i >= 0; i--) if (LV[i] < d - 1e-6) return LV[i]; return 1; };
  const stepUp = d => { for (const v of LV) if (v > d + 1e-6) return v; return DPR_MAX; };
  const settings = () => (FM.save && FM.save.settings) || {};
  let adaptDpr = DPR_MAX;
  // her oturum tam çözünürlükle başlar (öğrenilmiş düşük değer geri yüklenmez; zorlanırsa oturum içinde kademe düşer)
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
      if (lastQuality === 'low' && q !== 'low') { adaptDpr = DPR_MAX; pendingDpr = 0; saveDpr(); }
      lastQuality = q;
    }
    const touch = touchNow();
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    let dpr = Math.min(devDpr(), q === 'low' ? 1 : adaptDpr);
    // dokunmatikte toplam piksel sınırı (tablet / büyük ekran): ~3.6 MP üstüne çıkma (telefonlar 3x'e kadar tam çözünürlük)
    if (touch) dpr = Math.min(dpr, Math.max(1, Math.sqrt(3.6e6 / (w * h))));
    dpr = Math.round(dpr * 100) / 100;
    const key = w + 'x' + h + '@' + dpr + (touch ? 't' : 'm');
    if (key === lastKey && !force) return;   // boyut değişmediyse hiçbir şey yapma (önbellekler korunur, takılma yok)
    lastKey = key;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    V.dpr = dpr; V.W = cv.width; V.H = cv.height;
    // Telefonda (kısa ekran) kamera yakınlaşır: karakterler parmak ucu kadar küçük kalmasın (5. tur: 440 → 400).
    // Uzun dokunmatik ekranda (tablet) yakınlık kademeli azalır: CSS yüksekliği 480 → 400, ~1080 → 540 (masaüstü).
    V.VH = (touch || h < 520) ? Math.round(FM.clamp(CAM.VH_TOUCH + Math.max(0, h - 480) * .35, CAM.VH_TOUCH, C.VH)) : C.VH;
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
  function saveDpr() { try { settings().adaptDpr3 = adaptDpr; if (FM.persist) FM.persist(); } catch (e) { } }
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
  const cam = { t: null, gy: null, la: 0, glide: false, off: 0, force: false };
  /* Kamera ayarları (5. tur, docs/TUR5.md §4): zemin telefonda ekranın üstten ~%71'inde, masaüstünde ~%68'inde
     ("harita üstte kalıyor" şikâyeti); telefonda görünen dünya yüksekliği 400 (karakterler biraz büyük). */
  const CAM = { VH_TOUCH: 460, KF_TOUCH: .66, KF_DESK: .66 };   // Fun Run 4 kadrajı: zemin üstten ~%65   // VH_TOUCH 460: 400 çok yakın, 520 çok uzak geldi (oyuncu geri bildirimi)
  FM.CAM = CAM;
  function camTarget() {
    if (S.mode === 'demo') { // demoda öndekini izle
      let lead = S.racers[0];
      for (const r of S.racers) if (!r.finished && r.dead <= 0 && r.x > lead.x) lead = r;
      return lead;
    }
    // oyuncu elendi / izleyici: game.js'in seçtiği izlenen yarışçı (S.spec: öndeki, titremesin diye eşikli)
    const p = S.player;
    if (p && (p.out || p.spec) && S.spec && S.racers.indexOf(S.spec) >= 0) return S.spec;
    return p;
  }
  function updateCamera(dt, snap) {
    const t = camTarget(); if (!t || !S.L) return;
    const touch = touchNow(), VW = V.VW, VH = V.VH, cl = FM.clamp;
    if (S.cam.x === 0 && S.cam.y === 0) snap = true;   // yeni tur/demo başında (resetRace kamerayı 0,0'a çeker): kayarak gelme, yerine otur
    const ease = k => 1 - Math.exp(-k * dt);           // kare hızından bağımsız yumuşatma
    if (cam.t !== t) { cam.t = t; cam.gy = null; if (!snap) cam.force = true; }   // izlenen değişti (demo lideri, izleyici): kayarak geç
    // --- yatay: oyuncu ekranda SABİT konumda (kilitli; ara değerlenmiş konum → akıcı). Yalnızca hıza bağlı ileri bakış payı
    // yavaşça değişir: zıplama/kayma hız kesince oyuncu ekranda ileri-geri kaymaz (eskiden gecikmeli izleme bunu yapıyordu).
    // ileri bakış normal koşu hızına göre: normal hızda 0 (oyuncu sabit yerde), hız/ped/rüzgâr arkasında biraz ileriyi gösterir
    const laT = 0;   // Fun Run 4: kamera koşucuya tam kilitli (karakter ve harita birlikte hareket eder; ileri bakış kaydırması yok)
    cam.la = snap ? laT : cam.la + (laT - cam.la) * ease(2.5);
    const base = touch ? VW * .33 + safeL * (V.dpr || 1) / (V.S || 1) : VW * .32;   // Fun Run 4: koşucu soldan ~%33
    const tx = Math.max(0, t.x - base + cam.la);
    // --- dikey
    const feet = t.y + t.h, dead = t.dead > 0;
    if (dead) cam.gy = null;
    else if (t.onGround || t.climb) cam.gy = feet;
    const g = cam.gy != null ? cam.gy : feet;
    const kF = touch ? CAM.KF_TOUCH : CAM.KF_DESK;       // zemindeyken ayakların ekran yüksekliğindeki yeri
    let ty = g - VH * kF;
    const fall = !dead && t.vy > 0 && feet > g + 4;       // son basılan zeminin altına iniyor (basamak inişi / çukur)
    if (fall) ty = Math.max(ty, feet - VH * kF + cl(t.vy * .1, 0, 90));   // düşerken aşağıyı göster
    const topK = touch ? .26 : .16, hardK = touch ? .19 : .06;   // telefonda üst çubuk + isim plakası ~%19 yer kaplar
    if (!dead) ty = Math.min(ty, t.y - VH * topK);        // üst banda girerse yukarı kay
    const minY = -760, maxY = S.L.liq + 95 - VH;
    ty = cl(ty, minY, maxY);
    if (snap) { S.cam.x = tx; S.cam.y = ty; cam.glide = false; cam.force = false; return; }
    // büyük sıçrama (yeniden doğma, izlenen değişti): kamera hedefe göre bir FARK ile başlar ve fark sönümlenir (hareketli hedefin
    // peşinden koşup sonsuza dek gecikmez); fark bitince yeniden kilitlenir
    if (cam.force || (cam.glide ? Math.abs(tx + cam.off - S.cam.x) > 140 : Math.abs(tx - S.cam.x) > 140)) { cam.glide = true; cam.off = S.cam.x - tx; cam.force = false; }
    if (cam.glide) { cam.off *= Math.exp(-9 * dt); S.cam.x = tx + cam.off; if (Math.abs(cam.off) < 1) cam.glide = false; }
    else S.cam.x = tx;
    const rate = fall && t.vy > 300 ? 9 : t.climb ? 6 : ty < S.cam.y ? 7 : 3;
    S.cam.y += (ty - S.cam.y) * ease(rate);
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
    // yönlü atış önizlemesi: çizilen her karede (duraklatılmış/geliştirici karesi dahil) yerel oyuncunun nişanı → FM.S.aim
    if (FM.game && typeof FM.game.updateAim === 'function') { try { FM.game.updateAim(); } catch (e) { S.aim = null; if (!call.errs) call.errs = 0; if (call.errs++ < 20) console.error(e); } }
    // yaklaşan atış uyarıları (testere, dinamit, füze...) → FM.S.threats (HUD uyarı oku için)
    if (FM.game && typeof FM.game.updateThreats === 'function') { try { FM.game.updateThreats(); } catch (e) { S.threats = []; if (!call.errs) call.errs = 0; if (call.errs++ < 20) console.error(e); } }
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
    if (S.aim && typeof R.drawAim === 'function') call(R.drawAim, ctx);   // nişan önizlemesi (dünya koordinatı)
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
  // çok oyunculu yarış ekrandayken DURAKLATMA YOK: menü açılsa da (S.paused) simülasyon ve çizim sürer
  const mpLive = () => !!(FM.netgame && typeof FM.netgame.live === 'function' && FM.netgame.live());
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
    if ((S.paused && !mpLive()) || rotOn()) { if (now - lastStill > 500) { lastStill = now; return true; } return false; }
    if (behindPanel()) return (frameN & 1) === 0;
    return true;
  }

  /* ---------- kare güncelleme (görsel, gerçek dt) ---------- */
  function frameUpdate(dt, noCam) {
    for (const t of S.toasts) t.t -= dt; S.toasts = S.toasts.filter(t => t.t > 0);
    for (const f of S.feed) f.t -= dt; S.feed = S.feed.filter(f => f.t > 0);
    S.shake = Math.max(0, S.shake - dt);
    S.flash.a = Math.max(0, S.flash.a - dt * 2.2);
    if (S.mode === 'podium') S.podiumT = (S.podiumT || 0) + dt;
    for (const u of FM.R.updaters) call(u, dt);
    if (!noCam) updateCamera(dt);   // ana döngü kamerayı ara değerlenmiş konumla ayrıca günceller
  }

  /* ---------- çizim ara değerlemesi (akıcılık) ----------
     Fizik 120 Hz sabit adımla ilerler; ekran 60/90/120 Hz. Bir karede düşen adım sayısı 1-2-3 arasında oynadığından
     ara değerleme olmadan hızlı koşan karakter ve kamera "takılır" (akıcı değil, ağır çekim gibi hissettirir).
     Yarışçılar ve varlıklar son iki fizik adımı arasında, birikmiş sürenin oranı (alpha) kadar ileride çizilir; kamera da
     bu konumu izler. Çizimden sonra gerçek konumlar geri yüklenir (simülasyon ve ağ etkilenmez). */
  const IPL = [];
  function snapPrev() {
    for (const r of S.racers) { r._px = r.x; r._py = r.y; }
    for (const e of S.ents) if (typeof e.x === 'number') { e._px = e.x; e._py = e.y; }
  }
  function ipOne(o, a) {
    if (typeof o._px !== 'number' || typeof o.x !== 'number') return;
    const dx = o.x - o._px, dy = o.y - o._py;
    if (dx * dx + dy * dy > 22500) return;   // ışınlanma / yeniden doğma (150 px üstü): ara değerleme yok
    IPL.push(o, o.x, o.y); o.x = o._px + dx * a; o.y = o._py + dy * a;
  }
  function ipApply(a) {
    IPL.length = 0;
    if (!(a > 0 && a < 1)) return;
    for (const r of S.racers) ipOne(r, a);
    for (const e of S.ents) ipOne(e, a);
  }
  function ipRestore() { for (let i = 0; i < IPL.length; i += 3) { IPL[i].x = IPL[i + 1]; IPL[i].y = IPL[i + 2]; } IPL.length = 0; }

  /* ---------- performans izleme: YALNIZCA yarışta ölçülür (menü bulanıklığı vb. yanıltmasın) ---------- */
  const perf = { sum: 0, n: 0, slow: 0, good: 0, downs: 0, ups: 0 };
  function watchPerf(dt) {
    if (S.paused || document.hidden || FM.DEV || S.mode !== 'race') { perf.sum = 0; perf.n = 0; return; }
    perf.sum += dt; perf.n++;
    if (perf.n < 90) return;
    const avg = perf.sum / perf.n; perf.sum = 0; perf.n = 0;
    if (avg > 1 / 50) { perf.slow++; perf.good = 0; }   // 50 FPS altı: akıcı değil → çözünürlüğü bir kademe düşür
    else { perf.slow = Math.max(0, perf.slow - 1); perf.good = avg < 1 / 56 ? perf.good + 1 : 0; }
    const cur = pendingDpr || adaptDpr;
    if (perf.slow >= 2 && cur > dprFloor()) {
      pendingDpr = Math.max(dprFloor(), stepDown(cur)); perf.slow = 0; perf.good = 0; perf.downs++;
    } else if (perf.good >= 12 && perf.downs <= 1 && perf.ups < 1 && cur < DPR_MAX && settings().quality !== 'low' && devDpr() > cur) {
      // yük kalktı (ör. arka plan uygulaması kapandı): oturum başına bir kez bir kademe geri çık
      pendingDpr = stepUp(cur); perf.good = 0; perf.ups++;
    }
  }

  /* ---------- vuruş anı (hit-stop): yalnızca YEREL his ----------
     Yerel oyuncu birini öldürünce ya da ölünce dünya çok kısa "donar". Tek oyunculuda gerçek yavaşlama (sim ×0.08);
     çok oyunculu yarışta hafif (×0.4, en çok 60 ms) ve kaybedilen süre hemen ardından geri ödenir → seviye saati ve ağ
     eşitliği bozulmaz (sapma < 40 ms; netgame 120 ms altını düzeltmez bile). "Ekran sarsıntısı" kapalıysa hiç yok. */
  let hsT = 0, hsK = 1, hsDebt = 0;
  FM.hitStop = function (sec) {
    if (settings().shake === false || !(sec > 0)) return;
    const mp = mpLive();
    hsT = Math.max(hsT, Math.min(mp ? .05 : .07, sec));   // kısa tut: uzun donma oyunu ağır gösteriyordu
    hsK = mp ? .45 : .3;
  };
  FM.on('death', d => {
    const P = S.player;
    if (!d || S.mode !== 'race' || !P || P.ghost) return;
    if (d.r === P) FM.hitStop(.09);
    else if (d.killer === P) FM.hitStop(.07);
  });
  FM.on('race:start', () => { hsT = 0; hsDebt = 0; });
  function simDt(dt) {
    if (hsT > 0) {
      const k = Math.min(dt, hsT), lost = k * (1 - hsK);
      hsT -= k;
      if (mpLive()) hsDebt += lost;
      return dt - lost;
    }
    if (hsDebt > 0) {
      if (!mpLive()) { hsDebt = 0; return dt; }
      const add = Math.min(hsDebt, dt * .5); hsDebt -= add;
      return dt + add;
    }
    return dt;
  }

  /* ---------- ana döngü (sabit adımlı fizik) ---------- */
  let last = performance.now(), acc = 0, loopErrs = 0;
  /* Kare temposu: 90/120 Hz ekranlarda çizim 60 FPS'e sabitlenir (düzenli kare aralığı = daha akıcı görünür, yük yarıya iner,
     telefon ısınmaz). Simülasyon ve ara değerleme her karede sürer. 60 Hz ekranlarda etkisiz. */
  let ivAvg = 16.7, lastDraw = 0;
  const fpsM = { n: 0, t: 0, v: 0 };
  function paceOK(now) {
    if (ivAvg < 12 && now - lastDraw < 14.5) return false;
    lastDraw = now; return true;
  }
  /** Ayarlar › FPS göstergesi: sol üstte ölçülen çizim hızı ve çözünürlük (oyuncular akıcılığı bildirebilsin) */
  function drawFps(now) {
    fpsM.n++;
    if (now - fpsM.t >= 500) { fpsM.v = Math.round(fpsM.n * 1000 / (now - fpsM.t)); fpsM.n = 0; fpsM.t = now; }
    if (!settings().fps) return;
    ctx.setTransform(V.S, 0, 0, V.S, 0, 0);
    ctx.font = '600 12px ' + (FM.FONT_B || 'sans-serif'); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const txt = fpsM.v + ' FPS · ' + (V.dpr || 1).toFixed(2) + 'x';
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(4, V.VH - 22, ctx.measureText(txt).width + 10, 18);
    ctx.fillStyle = fpsM.v >= 55 ? '#7dff9a' : fpsM.v >= 40 ? '#ffd23f' : '#ff6b6b'; ctx.fillText(txt, 9, V.VH - 19);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function loop(now) {
    try {
      ivAvg += ((now - last) - ivAvg) * .05;
      let dt = (now - last) / 1000; last = now;
      if (dt > .1) dt = .1; if (dt < 0) dt = 0;
      if (touchNow() !== !!V.mobile) resize(false);           // ilk dokunuşta dokunmatik düzene geçildi: telefon kamerası
      if (pendingDpr && S.mode !== 'race') applyPendingDpr();   // çözünürlük düşürme yarış dışında (takılma görünmesin)
      watchPerf(dt);
      if ((!S.paused || mpLive()) && S.L) {
        const sdt = simDt(dt);                                   // hit-stop: kısa yavaşlama (+ çok oyunculuda geri ödeme)
        acc += sdt;
        let n = 0;
        while (acc >= C.STEP && n < 12) { snapPrev(); FM.game.step(C.STEP); acc -= C.STEP; n++; }
        if (n >= 12) acc = 0;
        frameUpdate(sdt, true);
      }
      // çizim ve kamera ara değerlenmiş konumla; ardından gerçek konumlar geri
      ipApply(S.paused && !mpLive() ? 0 : acc / C.STEP);
      try {
        if (S.L && (!S.paused || mpLive())) updateCamera(dt);
        if (shouldRender(now) && paceOK(now)) { render(); drawFps(now); }
      } finally { ipRestore(); }
    } catch (e) {
      if (loopErrs++ < 10) console.error(e);
    } finally {
      requestAnimationFrame(loop);
    }
  }

  /* ---------- klavye ----------
     Boşluk/↑/W zıpla (basılı = tırman), ↓/S kay/çakıl, E/Shift/J eşya, Q/F/K özel güç, Esc/P duraklat.
     Yönlü atış (docs/TUR5.md §2.1): yönlü eşya/güçte tuş BASILI tutulunca nişan (FM.input.aim); bu sırada ok tuşları/WASD yön
     verir (çapraz için iki tuş) ve zıplatmaz/kaydırmaz; bırakınca atılır. Yön tuşu yoksa varsayılan yön. Yönsüzde basınca hemen. */
  const I = FM.input;
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'], DOWN_KEYS = ['ArrowDown', 'KeyS'];
  const ITEM_KEYS = ['KeyE', 'ShiftLeft', 'ShiftRight', 'KeyJ'], AB_KEYS = ['KeyQ', 'KeyF', 'KeyK'];
  const DIR_KEYS = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
  const aimKeys = new Set(), aimDirs = new Set();   // nişanı tutan tuşlar / nişan sırasında basılan yön tuşları
  let curDir = null, prevDir = null, prevEnd = 0;    // şu anki yön; bir önceki yön ve bittiği an (bırakma toleransı)
  function dirNow() {
    let x = 0, y = 0;
    for (const k of aimDirs) { const d = DIR_KEYS[k]; if (d) { x += d[0]; y += d[1]; } }
    x = Math.sign(x); y = Math.sign(y);
    const l = Math.hypot(x, y);
    return l ? { x: Math.round(x / l * 100) / 100, y: Math.round(y / l * 100) / 100 } : null;
  }
  function setAimDir(firing) {
    const d = dirNow(), now = performance.now();
    if (!(d === curDir || (d && curDir && d.x === curDir.x && d.y === curDir.y))) { if (curDir) { prevDir = curDir; prevEnd = now; } curDir = d; }
    let u = d;
    if (firing && prevDir) {
      if (!d && now - prevEnd < 150) u = prevDir;                                          // yön tuşu atıştan hemen önce bırakıldı
      else if (d && (!d.x || !d.y) && prevDir.x && prevDir.y && now - prevEnd < 90) u = prevDir;   // çapraz tuşlar tam aynı anda bırakılmadı
    }
    I.ax = u ? u.x : 0; I.ay = u ? u.y : 0;
  }
  // nişanı bitir: fire = true → bırakma darbesi (use/ab), false → iptal (odak kaybı, yarış dışı)
  function endAim(fire) {
    const k = I.aim;
    if (k && fire) { setAimDir(true); if (k === 'item') I.use = true; else I.ab = true; }
    else { I.ax = 0; I.ay = 0; }
    aimKeys.clear(); aimDirs.clear();
    I.aim = null; curDir = prevDir = null;
  }
  const aimable = kind => !!(FM.game && typeof FM.game.aimable === 'function' && FM.game.aimable(kind));
  window.addEventListener('keydown', e => {
    const c = e.code;
    const inGame = S.mode === 'race' || S.mode === 'count';
    if (inGame && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (e.repeat) return;
    if (c === 'Escape' || c === 'KeyP') { if (I.aim) endAim(false); if (inGame || S.paused) FM.emit('ui:pause', { toggle: true }); return; }
    if (!inGame || S.paused) return;
    const kind = ITEM_KEYS.includes(c) ? 'item' : AB_KEYS.includes(c) ? 'ab' : null;
    if (kind) {
      if (I.aim === kind) { aimKeys.add(c); return; }                         // aynı nişanın ikinci tuşu
      if (I.aim) endAim(true);                                               // diğer nişan sürerken: onu at
      if (aimable(kind)) { I.aim = kind; aimKeys.add(c); aimDirs.clear(); curDir = prevDir = null; I.ax = 0; I.ay = 0; }
      else if (kind === 'item') I.use = true; else I.ab = true;              // yönsüz: hemen
      return;
    }
    if (I.aim && DIR_KEYS[c]) { aimDirs.add(c); setAimDir(); return; }      // nişan sırasında yön tuşu zıplatmaz/kaydırmaz
    if (JUMP_KEYS.includes(c)) { I.jp = true; I.jh = true; }
    else if (DOWN_KEYS.includes(c)) { I.dp = true; I.dh = true; }
  });
  window.addEventListener('keyup', e => {
    const c = e.code;
    if (aimDirs.has(c)) { aimDirs.delete(c); setAimDir(); }
    if (aimKeys.has(c)) {
      aimKeys.delete(c);
      if (!aimKeys.size) endAim(!S.paused && (S.mode === 'race' || S.mode === 'count'));   // son nişan tuşu bırakıldı: at
      return;
    }
    if (JUMP_KEYS.includes(c)) I.jh = false;
    else if (DOWN_KEYS.includes(c)) I.dh = false;
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

  // çok oyunculu yarışta odak/görünürlük kaybı duraklatma menüsü açmaz (yarış zaten durmaz)
  // odak kaybı: basılı tuşların keyup'ı gelmez → tutma ve nişan durumu sıfırlanır (nişan ATILMADAN iptal)
  window.addEventListener('blur', () => { I.jh = I.dh = false; endAim(false); if (S.mode === 'race' && !S.paused && !mpLive()) FM.emit('ui:pause', { toggle: false, force: true }); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { I.jh = I.dh = false; endAim(false); }
    if (document.hidden && S.mode === 'race' && !S.paused && !mpLive()) FM.emit('ui:pause', { force: true });
    last = performance.now(); dirty = true;
  });
  if (document.fonts && document.fonts.addEventListener) { try { document.fonts.addEventListener('loadingdone', () => { dirty = true; }); } catch (e) { } }

  /* ---------- geliştirici modu: ?dev=1&scene=race&t=6&char=Kral&theme=2&seed=5 ----------
     Simülasyonu senkron ilerletip tek kare çizer (headless ekran görüntüsü için). */
  function devScene() {
    const P = FM.params, scene = P.scene || 'race', t = +(P.t || 6);
    const theme = P.theme != null ? (isFinite(+P.theme) ? +P.theme : P.theme) : undefined;
    if (scene === 'race' || scene === 'podium' || scene === 'hud') {
      FM.game.startMatch({ char: P.char, rounds: +(P.rounds || 3), theme, themeIdx: theme, auto: P.auto !== '0', seed: P.seed != null ? +P.seed : undefined,
        mode: P.mode, n: P.n != null ? +P.n : undefined });
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
      // nişan önizlemesi (yalnızca geliştirici): &aim=item|ab&item=dyn&ax=0.7&ay=-0.7 → oyuncuya eşya/dolu güç + nişan
      if ((P.aim === 'item' || P.aim === 'ab') && S.player) {
        const pl = S.player;
        if (P.aim === 'item') pl.item = FM.ITEMS[P.item] ? P.item : (pl.item || 'dyn'); else pl.charge = 100;
        I.aim = P.aim; I.ax = +P.ax || 0; I.ay = +P.ay || 0;
      }
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

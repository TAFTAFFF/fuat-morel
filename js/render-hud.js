/* FUAT MOREL — render-hud.js
   Yarış içi HUD (eşya yuvası, özel güç halkası, ilerleme çubuğu, sıralama rozeti, tur/süre/altın hapları,
   öldürme akışı, bildirimler, geri sayım, yeniden doğma, bitiş kutlaması), kürsü (podium) sahnesi ve
   elle çizilmiş parlak VEKTÖR ikonlar (12 eşya + altın, elmas, kupa, taç, bayrak, ölüm nedenleri).

   API:
     FM.R.drawHUD(ctx)              ekran koordinatı (main scale(S) yapmış olarak çağırır) — mode count/race/end
     FM.R.drawPodium(ctx)           tüm ekranı kaplayan kürsü sahnesi — mode podium (sahne ekranın sol %58'inde)
     FM.R.itemIcon(key, size)       önbellekli <canvas> (size×size CİHAZ pikseli). DOM'a eklerken kopyala ya da iconURL kullan.
     FM.R.coinIcon(size), FM.R.gemIcon(size), FM.R.trophyIcon(size)
     FM.R.icon(name, size)          genel ikon (FM.R.ICONS listesindeki adlar)
     FM.R.iconURL(name, size)       önbellekli PNG data URL (<img src> için)
     FM.R.iconImg(name, cssSize)    hazır <img> elemanı (dpr'a göre keskin)
     FM.R.hudCol(racer)             yarışçının HUD rengi (oyuncu altın sarısı)
*/
'use strict';
(function (FM) {
  const R = FM.R = FM.R || {};
  R.updaters = R.updaters || [];
  const gfx = FM.gfx;
  const TAU = Math.PI * 2;
  const OUT = '#1a1230';                       // tüm HUD'un koyu dış hat rengi
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    outBack: (t, s) => { s = s == null ? 1.70158 : s; t -= 1; return t * t * ((s + 1) * t + s) + 1; },
    outElastic: t => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (TAU / 3)) + 1,
    outBounce: t => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) { t -= 1.5 / d; return n * t * t + .75; }
      if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + .9375; }
      t -= 2.625 / d; return n * t * t + .984375;
    },
    inOut: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  };

  /* =====================================================================
     0) ORTAK ÇİZİM YARDIMCILARI
     ===================================================================== */
  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function lg(g, x0, y0, x1, y1, st) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < st.length; i += 2) gr.addColorStop(st[i], st[i + 1]);
    return gr;
  }
  function rg(g, x0, y0, r0, x1, y1, r1, st) {
    const gr = g.createRadialGradient(x0, y0, Math.max(0, r0), x1, y1, Math.max(0.01, r1));
    for (let i = 0; i < st.length; i += 2) gr.addColorStop(st[i], st[i + 1]);
    return gr;
  }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, Math.abs(rx)), Math.max(0.01, Math.abs(ry)), rot || 0, 0, TAU); }
  function rr(g, x, y, w, h, r) {
    w = Math.max(0.01, w); h = Math.max(0.01, h);
    gfx.rr(g, x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  }
  function starPath(g, x, y, n, r1, r2, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? r2 : r1, a = rot + i * Math.PI / n;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  }
  function poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
  }
  /** 4 köşeli parıltı yıldızı */
  function sparkle(g, x, y, r, col) {
    const k = r * .16;
    g.fillStyle = col; g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + k, y - k, x + r, y);
    g.quadraticCurveTo(x + k, y + k, x, y + r);
    g.quadraticCurveTo(x - k, y + k, x - r, y);
    g.quadraticCurveTo(x - k, y - k, x, y - r);
    g.closePath(); g.fill();
  }
  function hex6(c) {
    if (typeof c !== 'string' || c[0] !== '#') return null;
    if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    if (c.length === 7) return c;
    return null;
  }
  function rgbaOf(hex, a) { const h = hex6(hex) || '#ffffff'; return gfx.rgba(h, a); }
  /** Koyu renkli bildirim metinlerini okunur hâle getirir */
  const legCache = new Map();
  function legible(col) {
    let v = legCache.get(col);
    if (v) return v;
    const h = hex6(col);
    if (!h) v = col || '#ffffff';
    else {
      const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, gg = n >> 8 & 255, b = n & 255;
      const l = (r * .299 + gg * .587 + b * .114) / 255;
      v = l < .55 ? gfx.shade(h, clamp((.62 - l) * 1.4, .25, .75)) : h;
    }
    legCache.set(col, v);
    return v;
  }

  /* metin genişliği önbelleği */
  const twCache = new Map();
  function tw(ctx, s, size, font, weight) {
    const f = font || FM.FONT_H;
    const key = (weight || '') + '|' + size + '|' + f + '|' + s;
    let w = twCache.get(key);
    if (w === undefined) {
      ctx.font = ((weight ? weight + ' ' : '') + size + 'px ' + f);
      w = ctx.measureText(s).width;
      if (twCache.size > 800) twCache.clear();
      twCache.set(key, w);
    }
    return w;
  }
  /** Kalın konturlu HUD yazısı (FM.gfx.text üstüne varsayılanlar) */
  function T(ctx, s, x, y, size, col, o) {
    const opt = { stroke: OUT, lw: Math.max(2.4, size / 4.2), shadowCol: 'rgba(10,5,30,.5)' };
    if (o) for (const k in o) opt[k] = o[k];
    gfx.text(ctx, s, x, y, size, col, opt);
  }

  /* =====================================================================
     1) VEKTÖR İKONLAR — 100×100 alanda çizilir, kalın dış hat ve gölge otomatik eklenir
     ===================================================================== */
  const ART = {};    // ad -> fn(g) (dış hat alır)
  const POST = {};   // ad -> fn(g) (dış hattan sonra, üstüne; parlamalar)
  const STEEL = [0, '#ffffff', .3, '#e3e8ef', .62, '#a3acbb', 1, '#646d80'];
  const GOLD_H = [0, '#b86e00', .18, '#f0a812', .36, '#ffe066', .46, '#fffbe0', .56, '#ffd84a', .82, '#e39a08', 1, '#9a5800'];

  /* ---- ALTIN ---- */
  ART.coin = g => {
    g.fillStyle = '#a65c05'; circ(g, 50, 53, 38); g.fill();
    g.fillStyle = lg(g, 0, 10, 0, 88, [0, '#fff8c8', .3, '#ffdc4f', .7, '#f6a912', 1, '#cf7c06']); circ(g, 50, 48, 38); g.fill();
    g.fillStyle = lg(g, 0, 20, 0, 77, [0, '#e48f0b', .55, '#ffc53a', 1, '#ffe891']); circ(g, 50, 48, 28.5); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = 'rgba(140,70,0,.55)'; circ(g, 50, 48, 28.5); g.stroke();
    g.fillStyle = 'rgba(150,78,0,.5)'; starPath(g, 50, 51, 5, 16.5, 7.2, -Math.PI / 2); g.fill();
    g.fillStyle = lg(g, 0, 31, 0, 66, [0, '#fffdf0', .6, '#ffe57a', 1, '#ffc928']); starPath(g, 50, 48.5, 5, 16.5, 7.2, -Math.PI / 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3.6; g.beginPath(); g.arc(50, 48, 33.4, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.95)'; circ(g, 27.5, 34, 2.3); g.fill();
  };

  /* ---- ELMAS ---- */
  ART.gem = g => {
    const g0 = [10, 40], g1 = [30, 40], g2 = [50, 40], g3 = [70, 40], g4 = [90, 40], t0 = [28, 15], t1 = [50, 15], t2 = [72, 15], B = [50, 90];
    const f = (col, ...p) => { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); g.fillStyle = col; g.fill(); };
    f('#9ff4ff', g0, t0, g1); f('#62d9f8', t0, g2, g1); f('#dcfcff', t0, t1, g2); f('#aef1ff', t1, t2, g2); f('#4cc6ef', t2, g3, g2); f('#2b9ed8', t2, g4, g3);
    f('#43b8ea', g0, g1, B); f('#1f8fd2', g1, g2, B); f('#5ccdf4', g2, g3, B); f('#176fb8', g3, g4, B);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.3; g.beginPath();
    const L = (a, b) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); };
    L(g0, g4); L(t0, g1); L(t0, g2); L(t1, g2); L(t2, g2); L(t2, g3); L(g1, B); L(g2, B); L(g3, B);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.8)'; poly(g, [30, 19, 44, 19, 33, 35]); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; poly(g, [20, 44, 28, 44, 44, 76]); g.fill();
  };
  POST.gem = g => { sparkle(g, 80, 20, 10, '#ffffff'); sparkle(g, 20, 70, 5, 'rgba(255,255,255,.85)'); };

  /* ---- KUPA ---- */
  ART.trophy = g => {
    const handle = s => { g.beginPath(); g.moveTo(50 + s * 22, 22); g.bezierCurveTo(50 + s * 44, 20, 50 + s * 44, 52, 50 + s * 13, 55); };
    for (const s of [-1, 1]) {
      handle(s); g.strokeStyle = OUT; g.lineWidth = 11; g.stroke();
      handle(s); g.strokeStyle = '#e09a0a'; g.lineWidth = 6.5; g.stroke();
      handle(s); g.strokeStyle = '#ffe680'; g.lineWidth = 2.2; g.stroke();
    }
    const cup = () => { g.beginPath(); g.moveTo(24, 14); g.lineTo(76, 14); g.bezierCurveTo(76, 44, 66, 58, 56, 61); g.lineTo(44, 61); g.bezierCurveTo(34, 58, 24, 44, 24, 14); g.closePath(); };
    cup(); g.fillStyle = lg(g, 24, 0, 76, 0, GOLD_H); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    ell(g, 50, 14, 26, 5); g.fillStyle = '#ffeaa0'; g.fill(); g.lineWidth = 2; g.stroke();
    ell(g, 50, 14.6, 21, 3.1); g.fillStyle = '#b87400'; g.fill();
    g.fillStyle = 'rgba(150,80,0,.55)'; starPath(g, 50, 37, 5, 11, 4.8, -Math.PI / 2); g.fill();
    g.fillStyle = lg(g, 0, 25, 0, 47, [0, '#ffffff', 1, '#ffe27a']); starPath(g, 50, 35.5, 5, 11, 4.8, -Math.PI / 2); g.fill();
    g.beginPath(); g.moveTo(45, 60); g.lineTo(55, 60); g.lineTo(53.5, 72); g.lineTo(46.5, 72); g.closePath();
    g.fillStyle = lg(g, 45, 0, 55, 0, GOLD_H); g.fill(); g.lineWidth = 2; g.stroke();
    ell(g, 50, 66, 8, 3); g.fillStyle = '#ffd84a'; g.fill(); g.stroke();
    rr(g, 33, 71, 34, 8, 2.5); g.fillStyle = lg(g, 33, 0, 67, 0, GOLD_H); g.fill(); g.stroke();
    rr(g, 25, 78, 50, 14, 3.5); g.fillStyle = lg(g, 0, 78, 0, 92, [0, '#8a4cc4', 1, '#3d1a66']); g.fill(); g.stroke();
    rr(g, 39, 81.5, 22, 7, 2); g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 1.4; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(31, 21); g.bezierCurveTo(31, 36, 36, 46, 42, 52); g.stroke();
  };
  POST.trophy = g => { sparkle(g, 83, 13, 8, '#ffffff'); };

  /* ---- TAÇ ---- */
  ART.crown = g => {
    const body = () => { g.beginPath(); g.moveTo(17, 78); g.lineTo(12, 34); g.lineTo(32, 54); g.lineTo(50, 22); g.lineTo(68, 54); g.lineTo(88, 34); g.lineTo(83, 78); g.closePath(); };
    body(); g.fillStyle = lg(g, 0, 22, 0, 78, [0, '#fff3a8', .45, '#ffcc33', 1, '#d98a00']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    rr(g, 15, 63, 70, 17, 4); g.fillStyle = lg(g, 0, 63, 0, 80, [0, '#ffd84a', 1, '#c27800']); g.fill(); g.stroke();
    const gem = (x, y, r, c1, c2) => { circ(g, x, y, r); g.fillStyle = rg(g, x - r * .3, y - r * .3, 0, x, y, r, [0, c1, 1, c2]); g.fill(); g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke(); circ(g, x - r * .35, y - r * .35, r * .3); g.fillStyle = 'rgba(255,255,255,.85)'; g.fill(); };
    gem(50, 71.5, 5.5, '#ff8a8a', '#c0182e'); gem(31, 71.5, 4, '#9be7ff', '#1f5fd0'); gem(69, 71.5, 4, '#9be7ff', '#1f5fd0');
    for (const p of [[12, 32, 5], [50, 20, 6], [88, 32, 5]]) { circ(g, p[0], p[1], p[2]); g.fillStyle = lg(g, 0, p[1] - p[2], 0, p[1] + p[2], [0, '#fffbe0', 1, '#f0a812']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(19, 44); g.lineTo(21, 60); g.stroke();
    g.beginPath(); g.moveTo(46, 32); g.lineTo(38, 48); g.stroke();
  };
  POST.crown = g => { sparkle(g, 84, 14, 8, '#ffffff'); };

  /* ---- DAMA BAYRAK ---- */
  ART.flag = g => {
    rr(g, 20, 12, 7, 82, 3.5); g.fillStyle = lg(g, 20, 0, 27, 0, [0, '#8a93a8', .4, '#ffffff', 1, '#6c7688']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    const flagPath = () => { g.beginPath(); g.moveTo(27, 14); g.bezierCurveTo(44, 6, 60, 22, 88, 12); g.lineTo(88, 52); g.bezierCurveTo(60, 62, 44, 46, 27, 54); g.closePath(); };
    flagPath(); g.fillStyle = '#ffffff'; g.fill();
    g.save(); flagPath(); g.clip();
    const off = xx => { const u = (xx - 27) / 61; return -2.6 * Math.sin(u * TAU) - 2 * u; };
    const cols = 6, rows = 4, cw = 61 / cols;
    g.fillStyle = '#1d1a2e';
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if ((i + j) % 2 === 0) {
      const x0 = 27 + i * cw, x1 = x0 + cw;
      g.beginPath(); g.moveTo(x0, 14 + off(x0) + j * 10); g.lineTo(x1, 14 + off(x1) + j * 10); g.lineTo(x1, 14 + off(x1) + (j + 1) * 10); g.lineTo(x0, 14 + off(x0) + (j + 1) * 10); g.closePath(); g.fill();
    }
    g.fillStyle = lg(g, 27, 0, 88, 0, [0, 'rgba(0,0,0,.12)', .3, 'rgba(255,255,255,.18)', .55, 'rgba(0,0,0,.2)', .8, 'rgba(255,255,255,.14)', 1, 'rgba(0,0,0,.1)']);
    g.fillRect(20, 0, 80, 70);
    g.restore();
    flagPath(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    circ(g, 23.5, 12, 5.2); g.fillStyle = lg(g, 0, 7, 0, 17, [0, '#fff3a8', 1, '#e39a08']); g.fill(); g.lineWidth = 2; g.stroke();
  };

  /* ---- KRONOMETRE ---- */
  ART.clock = g => {
    rr(g, 43, 6, 14, 11, 3); g.fillStyle = lg(g, 0, 6, 0, 17, [0, '#ffffff', 1, '#9aa3b2']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    g.save(); g.translate(75, 26); g.rotate(.8); rr(g, -5, -4, 10, 8, 2.5); g.fillStyle = '#c9d3df'; g.fill(); g.stroke(); g.restore();
    circ(g, 50, 56, 37); g.fillStyle = lg(g, 0, 19, 0, 93, [0, '#9be7ff', .5, '#3b9cf5', 1, '#1f4fb0']); g.fill();
    circ(g, 50, 56, 28.5); g.fillStyle = rg(g, 44, 48, 2, 50, 56, 30, [0, '#ffffff', 1, '#dde8fa']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.strokeStyle = '#5a6a8a'; g.lineWidth = 2.6;
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, r0 = i % 3 ? 23 : 20; g.beginPath(); g.moveTo(50 + Math.cos(a) * r0, 56 + Math.sin(a) * r0); g.lineTo(50 + Math.cos(a) * 26, 56 + Math.sin(a) * 26); g.stroke(); }
    g.strokeStyle = OUT; g.lineWidth = 4.4; g.beginPath(); g.moveTo(50, 56); g.lineTo(50, 37); g.stroke();
    g.strokeStyle = '#e23b3b'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(50, 56); g.lineTo(64, 64); g.stroke();
    circ(g, 50, 56, 4); g.fillStyle = OUT; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3; g.beginPath(); g.arc(50, 56, 33, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
  };

  /* ---- TESTERE ---- */
  ART.saw = g => {
    const cx = 50, cy = 50, n = 14, r0 = 32.5, r1 = 43;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU - .2, a1 = a0 + TAU / n * .64, a2 = a0 + TAU / n;
      const x0 = cx + Math.cos(a0) * r0, y0 = cy + Math.sin(a0) * r0;
      if (i) g.lineTo(x0, y0); else g.moveTo(x0, y0);
      g.lineTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
      g.lineTo(cx + Math.cos(a1 + .05) * (r1 - 3), cy + Math.sin(a1 + .05) * (r1 - 3));
      g.lineTo(cx + Math.cos(a2) * r0, cy + Math.sin(a2) * r0);
    }
    g.closePath();
    g.fillStyle = lg(g, 18, 10, 82, 90, [0, '#ffffff', .35, '#dfe5ee', .7, '#9aa4b5', 1, '#6c7688']); g.fill();
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(40,46,66,.55)'; g.stroke();
    circ(g, cx, cy, 34); g.fillStyle = lg(g, 25, 18, 75, 86, [0, '#f7f9fc', .5, '#c3cbd8', 1, '#7f899b']); g.fill();
    g.lineWidth = 2.2; g.strokeStyle = 'rgba(60,68,90,.6)'; circ(g, cx, cy, 25.5); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, 27, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + .5; g.strokeStyle = 'rgba(46,52,72,.8)'; g.lineWidth = 3.6; g.beginPath(); g.arc(cx, cy, 19, a, a + .62); g.stroke(); }
    circ(g, cx, cy, 11.5); g.fillStyle = rg(g, cx - 4, cy - 5, 1, cx, cy, 12.5, [0, '#ffd0a0', .45, '#ff6b3d', 1, '#b8321a']); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .3, px = cx + Math.cos(a) * 6, py = cy + Math.sin(a) * 6; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath();
    g.fillStyle = lg(g, 0, cy - 6, 0, cy + 6, [0, '#e3e8ef', 1, '#6c7688']); g.fill(); g.lineWidth = 1.8; g.stroke();
    circ(g, cx, cy, 2); g.fillStyle = OUT; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3.4; g.beginPath(); g.arc(cx, cy, 30.5, Math.PI * 1.12, Math.PI * 1.42); g.stroke();
  };

  /* ---- DİNAMİT ---- */
  const DYN = { tx: 50, ty: 60, rot: -.18, tipX: 14, tipY: -40 };
  ART.dyn = g => {
    g.save(); g.translate(DYN.tx, DYN.ty); g.rotate(DYN.rot);
    const fuse = (x0, y0, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0, y0 - 9, DYN.tipX - 6, DYN.tipY + 12, DYN.tipX, DYN.tipY); g.stroke(); };
    for (const [x0, y0] of [[-14, -19], [14, -19], [0, -22]]) { fuse(x0, y0, 4.4, '#3b2a1a'); fuse(x0, y0, 1.6, '#b08850'); }
    const stick = (x, y, h) => {
      rr(g, x - 9, y, 18, h, 5);
      g.fillStyle = lg(g, x - 9, 0, x + 9, 0, [0, '#8a1010', .28, '#e83a3a', .44, '#ff8c7a', .6, '#e23434', 1, '#8f1212']); g.fill();
      g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
      ell(g, x, y + 3.2, 7.6, 3.1); g.fillStyle = '#f3d9a6'; g.fill(); g.lineWidth = 1.4; g.stroke();
      circ(g, x, y + 3.2, 1.7); g.fillStyle = '#4a3622'; g.fill();
    };
    stick(-14, -22, 48); stick(14, -22, 48); stick(0, -25, 52);
    rr(g, -25, 2, 50, 11, 3); g.fillStyle = lg(g, 0, 2, 0, 13, [0, '#7a5638', .5, '#3b281c', 1, '#24170f']); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(-22, 3.8, 44, 2);
    g.fillStyle = '#ffd23f'; g.font = '700 7px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TNT', 0, 8);
    g.restore();
    const c = Math.cos(DYN.rot), s = Math.sin(DYN.rot);
    const sx = DYN.tx + DYN.tipX * c - DYN.tipY * s, sy = DYN.ty + DYN.tipX * s + DYN.tipY * c;
    starPath(g, sx, sy, 8, 11, 5, .2); g.fillStyle = lg(g, 0, sy - 11, 0, sy + 11, [0, '#fffbd0', .5, '#ffd23f', 1, '#ff8a1a']); g.fill();
    starPath(g, sx, sy, 6, 5.5, 2.6, .5); g.fillStyle = '#ffffff'; g.fill();
  };
  POST.dyn = g => {
    const c = Math.cos(DYN.rot), s = Math.sin(DYN.rot);
    const sx = DYN.tx + DYN.tipX * c - DYN.tipY * s, sy = DYN.ty + DYN.tipX * s + DYN.tipY * c;
    for (const p of [[14, -8, 2.2], [11, 7, 1.8], [-12, -9, 1.6], [4, -15, 1.5]]) { circ(g, sx + p[0], sy + p[1], p[2]); g.fillStyle = '#ffe14d'; g.fill(); }
  };

  /* ---- AYI TUZAĞI (açık V çeneler) ---- */
  function bz(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
  }
  ART.trap = g => {
    const cx = 50;
    // zincir
    g.lineWidth = 6; g.strokeStyle = OUT;
    for (const p of [[76, 90, .35], [85, 87, -.3]]) { g.save(); g.translate(p[0], p[1]); g.rotate(p[2]); ell(g, 0, 0, 6, 3.6); g.lineWidth = 5.6; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 2.6; g.strokeStyle = '#b9c2cf'; g.stroke(); g.restore(); }
    // taban plakası ve yaylar
    for (const s of [-1, 1]) {
      rr(g, s < 0 ? 10 : 62, 79, 28, 8, 4); g.fillStyle = lg(g, 0, 79, 0, 87, [0, '#c9d3df', 1, '#5c667a']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
      for (let i = 0; i < 3; i++) { const x = cx + s * (20 + i * 6); ell(g, x, 83, 2.4, 5.4); g.fillStyle = i % 2 ? '#8a93a8' : '#e3e8ef'; g.fill(); g.lineWidth = 1.4; g.stroke(); }
    }
    // çeneler
    for (const s of [-1, 1]) {
      const O0 = [cx + s * 3, 84], O1 = [cx + s * 34, 84], O2 = [cx + s * 46, 54], O3 = [cx + s * 41, 16];
      const I0 = [cx + s * 30, 19], I1 = [cx + s * 33, 48], I2 = [cx + s * 22, 71], I3 = [cx + s * 3, 72];
      g.beginPath(); g.moveTo(O0[0], O0[1]); g.bezierCurveTo(O1[0], O1[1], O2[0], O2[1], O3[0], O3[1]);
      g.lineTo(I0[0], I0[1]); g.bezierCurveTo(I1[0], I1[1], I2[0], I2[1], I3[0], I3[1]); g.closePath();
      g.fillStyle = lg(g, cx + s * 46, 0, cx + s * 4, 0, [0, '#5f687a', .35, '#c9d0db', .6, '#f4f7fa', 1, '#8a93a8']); g.fill();
      g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
      // dişler (iç kenar boyunca, merkeze doğru)
      const N = 5;
      for (let i = 0; i < N; i++) {
        const t = .1 + i * (.8 / (N - 1)), dt = .075;
        const a = bz(I0, I1, I2, I3, t - dt), b = bz(I0, I1, I2, I3, t + dt), m = bz(I0, I1, I2, I3, t);
        const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
        let nx = -ty / tl, ny = tx / tl;
        if ((cx - m[0]) * nx < 0) { nx = -nx; ny = -ny; }
        const len = 10 - i * .6;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(m[0] + nx * len, m[1] + ny * len); g.lineTo(b[0], b[1]); g.closePath();
        g.fillStyle = lg(g, a[0], a[1], b[0], b[1], [0, '#ffffff', 1, '#aab3c2']); g.fill(); g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke();
      }
      // parlama
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.2; g.beginPath();
      const h0 = bz(O0, O1, O2, O3, .45), h1 = bz(O0, O1, O2, O3, .8);
      g.moveTo(h0[0] - s * 4, h0[1]); g.lineTo(h1[0] - s * 4, h1[1]); g.stroke();
    }
    // menteşe + basma plakası
    ell(g, cx, 76, 14, 6.5); g.fillStyle = lg(g, 0, 70, 0, 83, [0, '#ffe28a', .5, '#e0a820', 1, '#8f6510']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    ell(g, cx - 3, 74, 6, 2); g.fillStyle = 'rgba(255,255,255,.75)'; g.fill();
    circ(g, cx, 83, 4.6); g.fillStyle = '#5c667a'; g.fill(); g.lineWidth = 1.8; g.stroke();
  };

  /* ---- FÜZE ---- */
  ART.mis = g => {
    for (const p of [[14, 80, 7, '#e8e4f0'], [23, 88, 5, '#d4cfe0'], [9, 90, 3.6, '#c7c1d6']]) { circ(g, p[0], p[1], p[2]); g.fillStyle = p[3]; g.fill(); }
    g.save(); g.translate(53, 49); g.rotate(Math.PI / 4);
    g.beginPath(); g.moveTo(-9, 20); g.quadraticCurveTo(-12, 34, 0, 46); g.quadraticCurveTo(12, 34, 9, 20); g.closePath();
    g.fillStyle = lg(g, 0, 20, 0, 46, [0, '#ffb020', 1, '#ff3b1a']); g.fill();
    g.beginPath(); g.moveTo(-5.5, 20); g.quadraticCurveTo(-7, 30, 0, 38); g.quadraticCurveTo(7, 30, 5.5, 20); g.closePath(); g.fillStyle = '#ffe14d'; g.fill();
    ell(g, 0, 23, 3, 5); g.fillStyle = '#ffffff'; g.fill();
    const fin = s => { g.beginPath(); g.moveTo(s * 10, 0); g.quadraticCurveTo(s * 23, 6, s * 22, 22); g.lineTo(s * 9, 15); g.closePath(); g.fillStyle = lg(g, s * 9, 0, s * 23, 22, [0, '#ff5a5a', 1, '#a3122f']); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke(); };
    fin(-1); fin(1);
    rr(g, -8, 15, 16, 7, 2); g.fillStyle = lg(g, -8, 0, 8, 0, [0, '#3a3550', .5, '#8a8aa0', 1, '#2a2540']); g.fill(); g.lineWidth = 2; g.stroke();
    const body = () => { g.beginPath(); g.moveTo(0, -38); g.bezierCurveTo(10, -30, 11.5, -16, 11, -8); g.lineTo(11, 16); g.quadraticCurveTo(0, 19, -11, 16); g.lineTo(-11, -8); g.bezierCurveTo(-11.5, -16, -10, -30, 0, -38); g.closePath(); };
    body(); g.fillStyle = lg(g, -11, 0, 11, 0, [0, '#8f99ad', .28, '#ffffff', .55, '#e6eaf2', 1, '#7f889d']); g.fill();
    g.save(); body(); g.clip();
    g.fillStyle = lg(g, -11, 0, 11, 0, [0, '#a3122f', .3, '#ff6b6b', .55, '#ff3b3b', 1, '#8a0c16']);
    g.fillRect(-14, -40, 28, 24); g.fillRect(-14, 6, 28, 5);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(-6, -34, 2.6, 16);
    g.restore();
    body(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.beginPath(); g.moveTo(-11, -16); g.lineTo(11, -16); g.lineWidth = 1.6; g.stroke();
    rr(g, -2.5, 4, 5, 18, 2.4); g.fillStyle = '#c0182e'; g.fill(); g.lineWidth = 1.8; g.stroke();
    circ(g, 0, -5, 6.2); g.fillStyle = rg(g, -2, -7, .5, 0, -5, 6.5, [0, '#d8fbff', .5, '#5ac8fa', 1, '#1a5fc0']); g.fill(); g.lineWidth = 2; g.stroke();
    circ(g, -2, -7.2, 1.7); g.fillStyle = '#ffffff'; g.fill();
    g.restore();
  };

  /* ---- YILDIRIM (fırtına bulutu) ---- */
  function cloudShape(g, col1, col2, col3) {
    const C = [[30, 44, 15], [47, 33, 19], [66, 36, 16], [79, 50, 12], [55, 50, 16], [35, 54, 12], [22, 54, 9]];
    const gr = lg(g, 0, 14, 0, 66, [0, col1, .45, col2, 1, col3]);
    g.fillStyle = gr;
    for (const c of C) { circ(g, c[0], c[1], c[2]); g.fill(); }
    rr(g, 18, 46, 66, 18, 9); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(47, 33, 15, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
    g.beginPath(); g.arc(30, 44, 11, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    g.beginPath(); g.arc(66, 36, 12, Math.PI * 1.2, Math.PI * 1.55); g.stroke();
  }
  ART.bolt = g => {
    const pts = [57, 44, 38, 70, 50, 70, 42, 93, 72, 60, 59, 60, 67, 44];
    poly(g, pts); g.fillStyle = lg(g, 0, 44, 0, 93, [0, '#fffbd0', .45, '#ffe14d', 1, '#ffa51f']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(56, 49); g.lineTo(44, 67); g.stroke();
    for (const p of [[24, 74], [78, 72]]) { g.beginPath(); g.moveTo(p[0], p[1] - 6); g.quadraticCurveTo(p[0] + 4, p[1] + 1, p[0], p[1] + 3); g.quadraticCurveTo(p[0] - 4, p[1] + 1, p[0], p[1] - 6); g.fillStyle = '#7be3ff'; g.fill(); }
    cloudShape(g, '#c3bdf0', '#7d76b4', '#4a4478');
    // kızgın gözler
    for (const s of [-1, 1]) {
      const ex = 51 + s * 9;
      ell(g, ex, 47, 5, 5.6); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke();
      circ(g, ex - s * 1.2, 48.5, 2.7); g.fillStyle = OUT; g.fill();
      g.lineWidth = 3; g.beginPath(); g.moveTo(ex + s * 6, 38.5); g.lineTo(ex - s * 4, 42.5); g.stroke();
    }
  };

  /* ---- KAR FIRTINASI (kar tanesi) ---- */
  ART.ice = g => {
    const cx = 50, cy = 50;
    const arms = (lw, style) => {
      g.strokeStyle = style; g.lineWidth = lw; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
        g.moveTo(cx, cy); g.lineTo(cx + ca * 37, cy + sa * 37);
        for (const [d, l] of [[16, 12], [27, 8.5]]) {
          const bx = cx + ca * d, by = cy + sa * d;
          for (const s of [-1, 1]) { const b = a + s * Math.PI / 3.1; g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * l, by + Math.sin(b) * l); }
        }
      }
      g.stroke();
    };
    arms(11, rg(g, cx, cy, 2, cx, cy, 42, [0, '#ffffff', .4, '#c9f6ff', 1, '#4fb8f0']));
    arms(4, 'rgba(255,255,255,.8)');
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const px = cx + Math.cos(a) * 11, py = cy + Math.sin(a) * 11; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath(); g.fillStyle = lg(g, 0, 39, 0, 61, [0, '#ffffff', 1, '#8fdcff']); g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(30,90,150,.7)'; g.stroke();
    circ(g, cx - 3, cy - 3, 2.6); g.fillStyle = '#ffffff'; g.fill();
  };
  POST.ice = g => { sparkle(g, 82, 18, 7, '#ffffff'); sparkle(g, 17, 80, 5, '#e8fbff'); };

  /* ---- MIKNATIS ---- */
  ART.mag = g => {
    g.save(); g.translate(50, 54); g.rotate(-.42);
    const R1 = 31, R2 = 13, top = -32, tipH = 12;
    const U = () => { g.beginPath(); g.moveTo(-R1, top); g.lineTo(-R1, 0); g.arc(0, 0, R1, Math.PI, 0, true); g.lineTo(R1, top); g.lineTo(R2, top); g.lineTo(R2, 0); g.arc(0, 0, R2, 0, Math.PI, false); g.lineTo(-R2, top); g.closePath(); };
    const RED = [0, '#9a0f1a', .25, '#ff4a4a', .45, '#ffb0b0', .62, '#e82525', 1, '#8a0c16'];
    g.save(); U(); g.clip();
    g.fillStyle = lg(g, -R1, 0, -R2, 0, RED); g.fillRect(-R1 - 2, top - 2, R1 - R2 + 2, -top + 2);
    g.fillStyle = lg(g, R2, 0, R1, 0, RED); g.fillRect(R2, top - 2, R1 - R2 + 2, -top + 2);
    g.fillStyle = rg(g, 0, 0, R2, 0, 0, R1, RED); g.fillRect(-R1 - 2, 0, R1 * 2 + 4, R1 + 2);
    const SIL = [0, '#6c7890', .3, '#e3e9f2', .45, '#ffffff', .7, '#aab6c8', 1, '#5c667a'];
    g.fillStyle = lg(g, -R1, 0, -R2, 0, SIL); g.fillRect(-R1 - 2, top - 2, R1 - R2 + 2, tipH + 2);
    g.fillStyle = lg(g, R2, 0, R1, 0, SIL); g.fillRect(R2, top - 2, R1 - R2 + 2, tipH + 2);
    g.restore();
    U(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.lineWidth = 2; g.beginPath(); g.moveTo(-R1, top + tipH); g.lineTo(-R2, top + tipH); g.moveTo(R2, top + tipH); g.lineTo(R1, top + tipH); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-R1 + 5.5, top + tipH + 4); g.lineTo(-R1 + 5.5, 0); g.arc(0, 0, R1 - 5.5, Math.PI, Math.PI * .72, true); g.stroke();
    g.restore();
  };
  POST.mag = g => {
    g.strokeStyle = '#d9b8ff'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.arc(28, 12, 9, Math.PI * .35, Math.PI * .95); g.stroke();
    g.beginPath(); g.arc(62, 8, 7, Math.PI * .2, Math.PI * .8); g.stroke();
    sparkle(g, 85, 20, 7, '#ffffff');
  };

  /* ---- ELEKTRİK AĞI ---- */
  ART.net = g => {
    const shape = () => { g.beginPath(); g.moveTo(18, 20); g.quadraticCurveTo(50, 11, 82, 18); g.quadraticCurveTo(92, 50, 85, 80); g.quadraticCurveTo(50, 90, 16, 84); g.quadraticCurveTo(8, 52, 18, 20); g.closePath(); };
    shape(); g.fillStyle = rg(g, 50, 48, 2, 50, 50, 46, [0, '#2f8fc8', .55, '#123a66', 1, '#0b1f3d']); g.fill();
    g.save(); shape(); g.clip();
    g.lineCap = 'round';
    const mesh = (lw, col) => {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
      for (let i = -6; i <= 6; i++) { const o = i * 13; g.moveTo(o, 0); g.lineTo(o + 100, 100); g.moveTo(o + 100, 0); g.lineTo(o, 100); }
      g.stroke();
    };
    mesh(4, '#3fc5f0'); mesh(1.4, '#e8fdff');
    g.restore();
    shape(); g.lineWidth = 5; g.strokeStyle = '#9ff0ff'; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = '#ffffff'; g.stroke();
    const zap = (pts) => { g.lineJoin = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.strokeStyle = OUT; g.lineWidth = 5; g.stroke(); g.strokeStyle = '#ffe14d'; g.lineWidth = 2.8; g.stroke(); };
    zap([30, 34, 38, 42, 34, 46, 44, 56]);
    zap([60, 54, 68, 60, 63, 64, 72, 72]);
    for (const p of [[18, 20], [82, 18], [85, 80], [16, 84]]) {
      circ(g, p[0], p[1], 7); g.fillStyle = rg(g, p[0] - 2, p[1] - 2, .5, p[0], p[1], 7, [0, '#ffffff', .5, '#a3acbb', 1, '#4a5163']); g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    }
  };
  POST.net = g => { sparkle(g, 50, 30, 5, '#ffffff'); sparkle(g, 40, 70, 4, '#bff6ff'); };

  /* ---- MÜREKKEP ---- */
  function dropPath(g, cx, top, r) {
    const cy = top + r * 1.62;
    g.beginPath(); g.moveTo(cx, top);
    g.bezierCurveTo(cx + r * .25, top + r * .5, cx + r, cy - r * .7, cx + r, cy);
    g.bezierCurveTo(cx + r, cy + r * .58, cx + r * .55, cy + r, cx, cy + r);
    g.bezierCurveTo(cx - r * .55, cy + r, cx - r, cy + r * .58, cx - r, cy);
    g.bezierCurveTo(cx - r, cy - r * .7, cx - r * .25, top + r * .5, cx, top);
    g.closePath();
  }
  ART.ink = g => {
    for (const p of [[16, 80, 7], [85, 74, 5.5], [83, 27, 4], [20, 30, 3.4]]) { circ(g, p[0], p[1], p[2]); g.fillStyle = '#2b2550'; g.fill(); circ(g, p[0] - p[2] * .3, p[1] - p[2] * .3, p[2] * .35); g.fillStyle = 'rgba(200,190,255,.6)'; g.fill(); }
    dropPath(g, 50, 8, 31);
    g.fillStyle = rg(g, 38, 44, 2, 50, 62, 40, [0, '#7a6fd0', .45, '#352d6e', 1, '#15122e']); g.fill();
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(150,135,240,.9)'; g.stroke();
    g.save(); g.translate(36, 44); g.rotate(.5); ell(g, 0, 0, 5.5, 11); g.fillStyle = 'rgba(255,255,255,.75)'; g.fill(); g.restore();
    circ(g, 31, 61, 2.4); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill();
    for (const s of [-1, 1]) {
      const ex = 50 + s * 9.5;
      ell(g, ex, 64, 6.4, 7.6); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = OUT; g.stroke();
      circ(g, ex + 1, 66, 3.6); g.fillStyle = OUT; g.fill();
      circ(g, ex + 2.2, 64.6, 1.3); g.fillStyle = '#ffffff'; g.fill();
      g.strokeStyle = '#0d0b1d'; g.lineWidth = 3; g.beginPath(); g.moveTo(ex + s * 7, 54); g.lineTo(ex - s * 4, 57.5); g.stroke();
    }
    g.strokeStyle = '#0d0b1d'; g.lineWidth = 2.6; g.beginPath(); g.arc(50, 76, 5, Math.PI * .15, Math.PI * .85); g.stroke();
  };

  /* ---- HIZ (kanatlı ayakkabı) ---- */
  ART.speed = g => {
    g.lineCap = 'round';
    for (const p of [[6, 52, 15], [3, 62, 17], [7, 72, 14]]) { g.strokeStyle = '#ffffff'; g.lineWidth = 4.5; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[1]); g.stroke(); }
    const wing = () => { g.beginPath(); g.moveTo(42, 46); g.bezierCurveTo(32, 30, 22, 16, 8, 12); g.quadraticCurveTo(10, 22, 19, 25); g.quadraticCurveTo(14, 31, 24, 35); g.quadraticCurveTo(21, 41, 33, 46); g.closePath(); };
    wing(); g.fillStyle = lg(g, 8, 12, 42, 46, [0, '#ffffff', 1, '#c7dcff']); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    g.strokeStyle = 'rgba(70,100,170,.6)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(19, 25); g.quadraticCurveTo(30, 30, 38, 40); g.moveTo(24, 35); g.quadraticCurveTo(31, 39, 37, 44); g.stroke();
    const upper = () => { g.beginPath(); g.moveTo(20, 70); g.lineTo(20, 46); g.quadraticCurveTo(21, 37, 29, 37); g.lineTo(38, 37); g.quadraticCurveTo(42, 46, 52, 44); g.lineTo(57, 40); g.quadraticCurveTo(65, 50, 77, 55); g.quadraticCurveTo(90, 59, 90, 68); g.lineTo(90, 70); g.closePath(); };
    upper(); g.fillStyle = lg(g, 0, 37, 0, 70, [0, '#ffd25a', .45, '#ff7a1a', 1, '#d9400f']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.save(); upper(); g.clip();
    g.fillStyle = 'rgba(255,255,255,.35)'; ell(g, 80, 60, 10, 6); g.fill();
    g.fillStyle = '#e23b3b'; g.fillRect(14, 36, 9, 34);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4.2; g.beginPath(); g.moveTo(26, 63); g.quadraticCurveTo(48, 66, 72, 57); g.stroke();
    g.restore();
    g.strokeStyle = OUT; g.lineWidth = 1.6; g.beginPath(); g.moveTo(23, 36); g.lineTo(23, 69); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.6;
    for (const p of [[47, 49, 55, 45], [53, 52, 61, 48], [59, 55, 66, 51]]) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.stroke(); }
    rr(g, 15, 67, 79, 13, 6.5); g.fillStyle = lg(g, 0, 67, 0, 80, [0, '#ffffff', 1, '#c9cfdc']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.strokeStyle = 'rgba(80,90,120,.45)'; g.lineWidth = 1.6;
    for (let x = 24; x < 90; x += 9) { g.beginPath(); g.moveTo(x, 75); g.lineTo(x + 3, 75); g.stroke(); }
  };

  /* ---- KALKAN ---- */
  function shieldPath(g, x0, x1, y0, ym, yb, arch) {
    const cx = (x0 + x1) / 2;
    g.beginPath(); g.moveTo(x0, y0 + 2);
    g.quadraticCurveTo(cx, y0 - arch, x1, y0 + 2);
    g.lineTo(x1, ym);
    g.bezierCurveTo(x1, ym + (yb - ym) * .62, cx + (x1 - cx) * .4, yb - (yb - ym) * .16, cx, yb);
    g.bezierCurveTo(cx - (x1 - cx) * .4, yb - (yb - ym) * .16, x0, ym + (yb - ym) * .62, x0, ym);
    g.closePath();
  }
  ART.shield = g => {
    shieldPath(g, 13, 87, 16, 46, 93, 10);
    g.fillStyle = lg(g, 0, 8, 0, 93, [0, '#fff2a8', .35, '#ffd23f', .7, '#e8a10c', 1, '#a86200']); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    shieldPath(g, 21, 79, 24, 47, 84, 8);
    g.fillStyle = lg(g, 20, 20, 80, 85, [0, '#9fe6ff', .4, '#3b9cf5', .75, '#1f5fd0', 1, '#163e96']); g.fill();
    g.save(); shieldPath(g, 21, 79, 24, 47, 84, 8); g.clip();
    g.fillStyle = 'rgba(10,30,90,.24)'; g.fillRect(50, 0, 50, 100);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.save(); g.translate(34, 34); g.rotate(-.55); ell(g, 0, 0, 10, 20); g.fill(); g.restore();
    g.restore();
    shieldPath(g, 21, 79, 24, 47, 84, 8); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
    g.fillStyle = 'rgba(10,30,90,.45)'; starPath(g, 50, 55, 5, 16, 7, -Math.PI / 2); g.fill();
    g.fillStyle = lg(g, 0, 37, 0, 69, [0, '#ffffff', 1, '#cdeeff']); starPath(g, 50, 53, 5, 16, 7, -Math.PI / 2); g.fill(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(20,50,120,.6)'; g.stroke();
    for (const p of [[18.5, 23], [81.5, 23], [50, 89]]) { circ(g, p[0], p[1], 2.4); g.fillStyle = '#fff6c8'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#8a4b00'; g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(17, 30); g.quadraticCurveTo(16.5, 52, 25, 66); g.stroke();
  };

  /* ---- BALON ---- */
  ART.balloon = g => {
    g.strokeStyle = '#5b5470'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(50, 77); g.bezierCurveTo(43, 82, 57, 86, 48, 93); g.stroke();
    const body = () => { g.beginPath(); g.moveTo(50, 73); g.bezierCurveTo(30, 70, 19, 52, 19, 38); g.bezierCurveTo(19, 20, 33, 7, 50, 7); g.bezierCurveTo(67, 7, 81, 20, 81, 38); g.bezierCurveTo(81, 52, 70, 70, 50, 73); g.closePath(); };
    body(); g.fillStyle = rg(g, 39, 26, 3, 50, 40, 44, [0, '#ffd6df', .28, '#ff6b8a', .72, '#e8264f', 1, '#a3122f']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    poly(g, [44, 79, 56, 79, 50, 71.5]); g.fillStyle = '#c2183f'; g.fill(); g.lineWidth = 1.8; g.stroke();
    g.save(); g.translate(35, 27); g.rotate(-.5); ell(g, 0, 0, 5.5, 11); g.fillStyle = 'rgba(255,255,255,.8)'; g.fill(); g.restore();
    circ(g, 30, 44, 2.6); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
    g.strokeStyle = 'rgba(120,10,40,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(50, 40, 26, Math.PI * .1, Math.PI * .5); g.stroke();
  };

  /* ---- ÖLÜM NEDENLERİ (öldürme akışı için) ---- */
  ART.x_spikes = g => {
    rr(g, 10, 72, 80, 16, 5); g.fillStyle = lg(g, 0, 72, 0, 88, [0, '#8a93a8', 1, '#454d5e']); g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    for (const [x, tip] of [[28, 26], [72, 26], [50, 14]]) {
      const half = 12.5, by = 74;
      g.save(); poly(g, [x - half, by, x, tip, x + half, by]); g.clip();
      g.fillStyle = '#eef2f7'; g.fillRect(x - half - 1, tip - 1, half + 1, by - tip + 2);
      g.fillStyle = '#8a93a8'; g.fillRect(x, tip - 1, half + 1, by - tip + 2);
      g.fillStyle = '#ff4d5e'; g.fillRect(x - half, tip - 2, half * 2, 18);
      g.fillStyle = '#c0182e'; g.fillRect(x, tip - 2, half, 18);
      g.restore();
      poly(g, [x - half, by, x, tip, x + half, by]); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    }
  };
  ART.x_crush = g => {
    g.lineWidth = 7; g.strokeStyle = OUT; ell(g, 50, 13, 6, 9); g.stroke(); g.lineWidth = 3.6; g.strokeStyle = '#c9d3df'; g.stroke();
    g.lineWidth = 7; g.strokeStyle = OUT; ell(g, 50, 27, 9, 5); g.stroke(); g.lineWidth = 3.6; g.strokeStyle = '#aab4c3'; g.stroke();
    rr(g, 16, 32, 68, 40, 7); g.fillStyle = lg(g, 0, 32, 0, 72, [0, '#9aa3b5', .5, '#5b6474', 1, '#3a4150']); g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
    g.save(); rr(g, 16, 32, 68, 40, 7); g.clip();
    g.fillStyle = '#1d1a2e'; g.fillRect(14, 44, 72, 13);
    g.fillStyle = '#ffd23f';
    for (let x = 6; x < 92; x += 12) { poly(g, [x, 57, x + 6, 57, x + 12, 44, x + 6, 44]); g.fill(); }
    g.restore();
    g.strokeStyle = OUT; g.lineWidth = 1.6; g.beginPath(); g.moveTo(16, 44); g.lineTo(84, 44); g.moveTo(16, 57); g.lineTo(84, 57); g.stroke();
    for (const p of [[23, 38], [77, 38], [23, 65], [77, 65]]) { circ(g, p[0], p[1], 2.4); g.fillStyle = '#e3e9f2'; g.fill(); }
    for (let i = 0; i < 5; i++) {
      const x = 22 + i * 14;
      poly(g, [x - 6, 72, x, 89, x + 6, 72]); g.fillStyle = lg(g, x - 6, 0, x + 6, 0, [0, '#ffffff', .5, '#c9d3df', 1, '#6c7688']); g.fill(); g.lineWidth = 1.8; g.strokeStyle = OUT; g.stroke();
    }
  };
  ART.x_water = g => {
    dropPath(g, 50, 9, 29); g.fillStyle = rg(g, 40, 46, 2, 50, 58, 36, [0, '#e0f8ff', .35, '#5cc8ff', 1, '#1667d9']); g.fill();
    g.save(); g.translate(39, 50); g.rotate(.45); ell(g, 0, 0, 5, 10); g.fillStyle = 'rgba(255,255,255,.8)'; g.fill(); g.restore();
    circ(g, 36, 67, 2.4); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
  };
  ART.x_choc = g => {
    dropPath(g, 50, 9, 29); g.fillStyle = rg(g, 40, 46, 2, 50, 58, 36, [0, '#d9a070', .35, '#8a4d24', 1, '#3d1e0c']); g.fill();
    g.save(); g.translate(39, 50); g.rotate(.45); ell(g, 0, 0, 4.6, 9.5); g.fillStyle = 'rgba(255,240,220,.7)'; g.fill(); g.restore();
  };
  ART.x_icewater = g => {
    g.lineJoin = 'round';
    poly(g, [18, 34, 36, 17, 86, 17, 68, 34]); g.fillStyle = '#f4feff'; g.fill(); g.lineWidth = 2.2; g.strokeStyle = OUT; g.stroke();
    poly(g, [68, 34, 86, 17, 86, 67, 68, 85]); g.fillStyle = lg(g, 68, 0, 86, 0, [0, '#6ccbf0', 1, '#3a9fd8']); g.fill(); g.stroke();
    rr(g, 18, 34, 50, 51, 4); g.fillStyle = lg(g, 0, 34, 0, 85, [0, '#e6fbff', .5, '#a6ecff', 1, '#5cc0ee']); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.9)'; rr(g, 24, 40, 6, 18, 3); g.fill(); rr(g, 24, 62, 6, 6, 3); g.fill();
  };
  ART.x_lava = g => {
    const flame = () => { g.beginPath(); g.moveTo(50, 8); g.bezierCurveTo(60, 26, 82, 38, 80, 62); g.bezierCurveTo(78, 82, 64, 92, 50, 92); g.bezierCurveTo(34, 92, 20, 80, 20, 62); g.bezierCurveTo(20, 48, 30, 40, 34, 30); g.bezierCurveTo(36, 42, 40, 46, 44, 48); g.bezierCurveTo(42, 34, 44, 20, 50, 8); g.closePath(); };
    flame(); g.fillStyle = rg(g, 50, 76, 4, 50, 62, 44, [0, '#fff3a0', .35, '#ffb020', .7, '#ff4d1a', 1, '#c21a0a']); g.fill();
    g.save(); g.translate(50, 92); g.scale(.56, .58); g.translate(-50, -92); flame(); g.fillStyle = lg(g, 0, 8, 0, 92, [0, '#ffe14d', 1, '#fffbe0']); g.fill(); g.restore();
  };
  ART.x_boom = g => {
    starPath(g, 50, 50, 11, 43, 26, -.2); g.fillStyle = rg(g, 50, 50, 4, 50, 50, 44, [0, '#fff7c0', .35, '#ffd23f', .7, '#ff7a1a', 1, '#e0301a']); g.fill();
    starPath(g, 50, 50, 9, 26, 15, .1); g.fillStyle = '#fff3a0'; g.fill();
    circ(g, 50, 50, 9); g.fillStyle = '#ffffff'; g.fill();
  };
  /* yeni ölüm/olay nedenleri: eleme kapısı, meteor, kaya, bataklık kum, neon zehir */
  ART.x_gate = g => {
    g.beginPath(); g.moveTo(14, 92); g.lineTo(14, 44); g.bezierCurveTo(14, 12, 86, 12, 86, 44); g.lineTo(86, 92); g.lineTo(68, 92); g.lineTo(68, 46);
    g.bezierCurveTo(68, 30, 32, 30, 32, 46); g.lineTo(32, 92); g.closePath();
    g.fillStyle = lg(g, 0, 14, 0, 92, [0, '#ff8a96', .5, '#ff3b4e', 1, '#a3122f']); g.fill();
    g.fillStyle = 'rgba(255,255,255,.4)'; rr(g, 18, 46, 6, 40, 3); g.fill();
    g.fillStyle = 'rgba(30,10,40,.55)'; g.beginPath(); g.moveTo(32, 92); g.lineTo(32, 46); g.bezierCurveTo(32, 30, 68, 30, 68, 46); g.lineTo(68, 92); g.closePath(); g.fill();
    for (const s of [-1, 1]) { g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.beginPath(); g.moveTo(50 - 11 * s, 52); g.lineTo(50 + 11 * s, 76); g.stroke(); }
  };
  ART.x_meteor = g => {
    g.beginPath(); g.moveTo(88, 10); g.lineTo(52, 40); g.lineTo(62, 62); g.closePath(); g.fillStyle = 'rgba(255,170,40,.85)'; g.fill();
    g.beginPath(); g.moveTo(72, 8); g.lineTo(40, 36); g.lineTo(58, 50); g.closePath(); g.fillStyle = '#ffe14d'; g.fill();
    circ(g, 40, 62, 28); g.fillStyle = rg(g, 32, 52, 3, 40, 62, 30, [0, '#ffcf8a', .4, '#e0602a', 1, '#7a2410']); g.fill();
    for (const [x, y, r] of [[32, 56, 6], [50, 70, 5], [36, 76, 3.5]]) { circ(g, x, y, r); g.fillStyle = 'rgba(70,20,8,.55)'; g.fill(); }
  };
  ART.x_boulder = g => {
    g.beginPath(); g.moveTo(14, 66); g.bezierCurveTo(10, 36, 34, 14, 56, 16); g.bezierCurveTo(80, 18, 92, 40, 88, 64); g.bezierCurveTo(84, 86, 26, 92, 14, 66); g.closePath();
    g.fillStyle = rg(g, 40, 34, 4, 50, 54, 46, [0, '#e6c79a', .5, '#b08850', 1, '#6e4f28']); g.fill();
    g.strokeStyle = 'rgba(60,36,12,.6)'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(40, 30); g.lineTo(50, 50); g.lineTo(44, 70); g.moveTo(50, 50); g.lineTo(70, 56); g.stroke();
  };
  ART.x_sand = g => {
    ell(g, 50, 66, 40, 20); g.fillStyle = rg(g, 50, 60, 4, 50, 66, 42, [0, '#5a3a14', .6, '#a8752e', 1, '#e0b060']); g.fill();
    g.strokeStyle = 'rgba(255,230,170,.7)'; g.lineWidth = 3.5; g.beginPath(); g.ellipse(50, 66, 24, 11, 0, .3, 5.2); g.stroke();
    g.beginPath(); g.ellipse(50, 66, 11, 5, 0, 1.5, 6); g.stroke();
    g.fillStyle = '#ffe2a8'; for (const [x, y] of [[30, 40], [64, 34], [46, 26]]) { circ(g, x, y, 4.5); g.fill(); }
  };
  ART.x_neon = g => {
    dropPath(g, 50, 8, 34); g.fillStyle = rg(g, 40, 50, 3, 50, 62, 40, [0, '#eaffb0', .4, '#7dff4a', 1, '#1f9a2a']); g.fill();
    g.fillStyle = 'rgba(255,255,255,.75)'; ell(g, 38, 58, 6, 11, -.3); g.fill();
  };
  ART.raincloud = g => {
    cloudShape(g, '#e3e7ef', '#a7afc0', '#6f788c');
    for (const s of [-1, 1]) {
      const ex = 51 + s * 9;
      g.strokeStyle = OUT; g.lineWidth = 2.6; g.beginPath(); g.arc(ex, 47, 4, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    }
    g.beginPath(); g.arc(51, 60, 5, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  };
  ART.unknown = g => {
    circ(g, 50, 50, 38); g.fillStyle = lg(g, 0, 12, 0, 88, [0, '#a78bfa', 1, '#5b2a86']); g.fill();
    g.fillStyle = '#ffffff'; g.font = '62px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 50, 54);
  };

  /* ---- ikon üretimi: çizim + otomatik kalın dış hat + yapışkan gölge ---- */
  function buildIcon(name, px) {
    const ss = px < 72 ? 2 : 1, P = px * ss, k = P / 100;
    const A = mkCanvas(P, P), ga = A.getContext('2d');
    ga.scale(k, k); ga.lineJoin = 'round'; ga.lineCap = 'round';
    try { (ART[name] || ART.unknown)(ga); } catch (e) { console.error('[ikon ' + name + ']', e); }
    const Tn = mkCanvas(P, P), gt = Tn.getContext('2d');
    gt.drawImage(A, 0, 0); gt.globalCompositeOperation = 'source-in'; gt.fillStyle = OUT; gt.fillRect(0, 0, P, P);
    const D = mkCanvas(P, P), gd = D.getContext('2d');
    const ow = Math.max(1.3 * ss, 4.4 * k);
    const n = ow > 7 ? 28 : 18;
    for (let i = 0; i < n; i++) { const a = i / n * TAU; gd.drawImage(Tn, Math.cos(a) * ow, Math.sin(a) * ow); }
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + .3; gd.drawImage(Tn, Math.cos(a) * ow * .55, Math.sin(a) * ow * .55); }
    const F = mkCanvas(P, P), gf = F.getContext('2d');
    gf.globalAlpha = .32; gf.drawImage(D, 0, Math.max(1, 3.2 * k)); gf.globalAlpha = 1;
    gf.drawImage(D, 0, 0); gf.drawImage(A, 0, 0);
    if (POST[name]) {
      gf.save(); gf.scale(k, k); gf.lineJoin = 'round'; gf.lineCap = 'round';
      try { POST[name](gf); } catch (e) { console.error('[ikon parıltı ' + name + ']', e); }
      gf.restore();
    }
    if (ss === 1) return F;
    const out = mkCanvas(px, px), go = out.getContext('2d');
    go.imageSmoothingEnabled = true; try { go.imageSmoothingQuality = 'high'; } catch (e) { }
    go.drawImage(F, 0, 0, px, px);
    return out;
  }
  const iconCache = new Map();
  R.icon = function (name, size) {
    let px = Math.round(+size || 64);
    if (!(px > 0)) px = 64;
    px = clamp(px, 8, 512);
    const nm = ART[name] ? name : 'unknown';
    const key = nm + '|' + px;
    let c = iconCache.get(key);
    if (!c) {
      if (iconCache.size > 400) iconCache.clear();
      c = buildIcon(nm, px);
      iconCache.set(key, c);
    }
    return c;
  };
  R.itemIcon = function (key, size) { return R.icon(key && ART[key] && FM.ITEMS[key] ? key : 'unknown', size); };
  R.coinIcon = function (size) { return R.icon('coin', size); };
  R.gemIcon = function (size) { return R.icon('gem', size); };
  R.trophyIcon = function (size) { return R.icon('trophy', size); };
  const urlCache = new Map();
  R.iconURL = function (name, size) {
    const key = name + '|' + Math.round(size || 64);
    let u = urlCache.get(key);
    if (u === undefined) {
      try { u = R.icon(name, size).toDataURL('image/png'); } catch (e) { u = ''; }
      if (urlCache.size > 300) urlCache.clear();
      urlCache.set(key, u);
    }
    return u;
  };
  R.iconImg = function (name, cssSize) {
    const css = Math.max(8, Math.round(cssSize || 32));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const img = document.createElement('img');
    img.src = R.iconURL(name, Math.round(css * dpr));
    img.width = css; img.height = css; img.alt = ''; img.draggable = false;
    img.className = 'fm-ico';
    return img;
  };
  R.ICONS = Object.keys(ART);

  /* emoji -> ikon adı (öldürme akışı için) */
  const EMOJI = new Map();
  const ENV_EMOJI = { '🔺': 'x_spikes', '⛓️': 'x_crush', '⛓': 'x_crush', '⚙️': 'saw', '⚙': 'saw', '💧': 'x_water', '🍫': 'x_choc', '🧊': 'x_icewater', '🔥': 'x_lava', '💥': 'x_boom',
    '🚪': 'x_gate', '☄️': 'x_meteor', '☄': 'x_meteor', '🪨': 'x_boulder', '⏳': 'x_sand', '☢️': 'x_neon', '☢': 'x_neon' };
  const stripVS = s => String(s || '').replace(/️/g, '');
  function buildEmojiMap() {
    EMOJI.clear();
    for (const k in ENV_EMOJI) { EMOJI.set(k, ENV_EMOJI[k]); EMOJI.set(stripVS(k), ENV_EMOJI[k]); }
    for (const k in FM.ITEMS) { const ic = FM.ITEMS[k].ic; if (ic) { EMOJI.set(ic, k); EMOJI.set(stripVS(ic), k); } }
  }
  buildEmojiMap();
  function iconForFeed(ic) {
    if (!ic) return 'x_boom';
    if (FM.ITEMS[ic]) return ic;
    return EMOJI.get(ic) || EMOJI.get(stripVS(ic)) || null;
  }

  /* =====================================================================
     2) HUD ALTYAPISI: yerleşim, ölçek, sprite önbelleği, portreler
     ===================================================================== */
  // compact: telefon (dokunmatik) ya da kısa pencere (< 480 css px) → sıkı HUD: sağ üst sütun tek satır, akış solda
  const Lo = { hs: 1, W: 960, H: 540, padL: 10, padR: 10, padT: 8, padB: 8, reserve: 60, touch: false, compact: false, cssH: 720 };
  let RES = 1;                         // şu anki mantıksal birim başına cihaz pikseli (sprite/ikon çözünürlüğü)
  let safe = { l: 0, r: 0, t: 0, b: 0 };
  let touchCached = null;
  function measureSafe() {
    safe = { l: 0, r: 0, t: 0, b: 0 };
    try {
      if (!document.body) return;
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
      document.body.appendChild(d);
      const cs = getComputedStyle(d);
      safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
      d.remove();
    } catch (e) { safe = { l: 0, r: 0, t: 0, b: 0 }; }
  }
  function isTouch() {
    if (FM.params && FM.params.touch != null) return FM.params.touch === '1';
    if (typeof FM.isTouch === 'boolean') return FM.isTouch;
    if (touchCached === null) {
      try { touchCached = !!((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0); }
      catch (e) { touchCached = false; }
    }
    return touchCached;
  }
  function layout() {
    const V = FM.view, dpr = V.dpr || 1, S = V.S || 1;
    const cssH = (V.H || 540) / dpr;
    const vk = (V.VH || 540) / 540;                     // telefonda VH=440: mantıksal birim zaten büyük
    const hs = (cssH >= 640 ? 1 : clamp(1 + (640 - cssH) / 250 * .25, 1, 1.28)) * vk;
    const toL = px => px * dpr / S / hs;
    Lo.hs = hs; Lo.cssH = cssH;
    Lo.W = (V.VW || 960) / hs; Lo.H = (V.VH || 540) / hs;
    Lo.padL = 10 + toL(safe.l); Lo.padR = 10 + toL(safe.r); Lo.padT = 8 + toL(safe.t); Lo.padB = 8 + toL(safe.b);
    Lo.reserve = Math.max(60 / hs, toL(64)) - 10 + 8;
    Lo.touch = isTouch();
    Lo.compact = Lo.touch || cssH < 480;
  }

  const hcache = new Map();
  /** HUD sprite önbelleği (çözünürlük = RES; kFixed verilirse sabit) */
  function hspr(key, w, h, ox, oy, fn, kFixed) {
    const k = kFixed || clamp(Math.round(RES * 4) / 4, 1, 4);
    let s = hcache.get(key);
    if (!s || s.k !== k) {
      const c = mkCanvas(w * k, h * k), g = c.getContext('2d');
      g.scale(k, k); g.translate(ox, oy); g.lineJoin = 'round'; g.lineCap = 'round';
      try { fn(g); } catch (e) { console.error('[hud sprite ' + key + ']', e); }
      s = { c, w, h, ox, oy, k };
      if (hcache.size > 260) hcache.clear();
      hcache.set(key, s);
    }
    return s;
  }
  function drawSpr(ctx, s, x, y, sc) { gfx.draw(ctx, s, x, y, sc == null ? 1 : sc); }

  /** ikon çizimi (ref: önbellek boyutu için sabit referans boyut — animasyonlu ölçeklerde yeni canvas üretilmesin) */
  function drawIcon(ctx, name, x, y, size, ref) {
    if (!(size > 0)) return;
    const px = clamp(Math.ceil((ref || size) * RES / 4) * 4, 8, 512);
    const c = R.icon(name, px);
    ctx.drawImage(c, x - size / 2, y - size / 2, size, size);
  }

  /* yarışçı renkleri (oyuncu her zaman altın) */
  // 10 ayrık renk (render-chars R.PLAYER_COLORS ile aynı; plaka noktası/ayak halkası ile HUD portre çerçevesi eşleşir)
  const RCOL = ['#ffd23f', '#ff5a6e', '#4fb3ff', '#5ee07a', '#c084fc', '#ff9f43', '#22d3e6', '#ff6ec7', '#a3e635', '#f2f2f7'];
  function racerColor(r) { const P = Array.isArray(R.PLAYER_COLORS) && R.PLAYER_COLORS.length ? R.PLAYER_COLORS : RCOL; return P[((r && r.idx) | 0) % P.length]; }
  R.hudCol = racerColor;
  const THEME_ACC = { forest: '#38b764', candy: '#ff5fa8', snow: '#3d9df5', castle: '#ff7a3d', desert: '#e0912a', space: '#7c5cff', city: '#ff3fa4', tropic: '#14b8a6' };
  const themeAcc = th => (th && THEME_ACC[th.id]) || '#8b5cf6';
  /* mod / ağ yardımcıları */
  const MODE_COL = { classic: '#38b764', elim: '#e0313f', coins: '#f0a20f', pure: '#2f9be0', chaos: '#ff6a1a' };
  const gMode = () => FM.S.gameMode || 'classic';
  const modeInfo = id => (typeof FM.modeById === 'function' && FM.modeById(id)) || null;
  const upTR = s => { s = String(s == null ? '' : s); try { return s.toLocaleUpperCase('tr-TR'); } catch (e) { return s.toUpperCase(); } };
  const isGhost = P => !!(P && P.ghost);
  function clip(ctx, s, size, maxW, font) {
    s = String(s == null ? '' : s);
    if (tw(ctx, s, size, font) <= maxW) return s;
    let n = s.length;
    while (n > 1 && tw(ctx, s.slice(0, n) + '…', size, font) > maxW) n--;
    return s.slice(0, n) + '…';
  }
  /** küçük kapı (kemer) simgesi, (x,y) alt orta */
  function gateGlyph(ctx, x, y, s, col) {
    ctx.beginPath();
    ctx.moveTo(x - s * .5, y); ctx.lineTo(x - s * .5, y - s * .55); ctx.bezierCurveTo(x - s * .5, y - s * 1.05, x + s * .5, y - s * 1.05, x + s * .5, y - s * .55);
    ctx.lineTo(x + s * .5, y); ctx.lineTo(x + s * .26, y); ctx.lineTo(x + s * .26, y - s * .52);
    ctx.bezierCurveTo(x + s * .26, y - s * .76, x - s * .26, y - s * .76, x - s * .26, y - s * .52); ctx.lineTo(x - s * .26, y); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = Math.max(1.5, s * .12); ctx.strokeStyle = OUT; ctx.stroke();
  }
  /** küçük insan simgesi, (x,y) merkez */
  function personGlyph(ctx, x, y, s, col) {
    ctx.fillStyle = col; ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1.3, s * .12);
    ctx.beginPath(); ctx.arc(x, y + s * .5, s * .46, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    circ(ctx, x, y - s * .2, s * .27); ctx.fill(); ctx.stroke();
  }

  /* ---- yuvarlak portre (FM.R.portrait varsa onunla, yoksa sade yüz) ---- */
  const portCache = new Map();
  function fallbackFace(g, id, px) {
    const ch = FM.CH[id] || { col: '#999999', col2: '#555555', species: '' };
    const c = px / 2, r = px * .36;
    const sp = ch.species || '';
    g.lineWidth = Math.max(1, px * .04); g.strokeStyle = OUT; g.lineJoin = 'round';
    if (sp === 'Aslan') { starPath(g, c, c * 1.05, 12, r * 1.35, r * 1.1, 0); g.fillStyle = ch.col2; g.fill(); g.stroke(); }
    if (sp === 'Kedi') for (const s of [-1, 1]) { poly(g, [c + s * r * .9, c - r * .2, c + s * r * .75, c - r * 1.25, c + s * r * .15, c - r * .75]); g.fillStyle = ch.col; g.fill(); g.stroke(); }
    if (sp === 'Ayı' || sp === 'Goril') for (const s of [-1, 1]) { circ(g, c + s * r * .8, c - r * .7, r * .38); g.fillStyle = ch.col; g.fill(); g.stroke(); }
    circ(g, c, c * 1.08, r); g.fillStyle = lg(g, 0, c - r, 0, c + r, [0, gfx.shade(hex6(ch.col) || '#999999', .25), 1, gfx.shade(hex6(ch.col) || '#999999', -.2)]); g.fill(); g.stroke();
    for (const s of [-1, 1]) {
      ell(g, c + s * r * .38, c * 1.02, r * .24, r * .3); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = Math.max(1, px * .025); g.stroke();
      circ(g, c + s * r * .34, c * 1.06, r * .12); g.fillStyle = OUT; g.fill();
    }
    if (sp === 'Karga' || sp === 'Penguen' || sp === 'Baykuş') { poly(g, [c - r * .2, c * 1.25, c + r * .2, c * 1.25, c, c * 1.25 + r * .35]); g.fillStyle = '#ffb020'; g.fill(); g.stroke(); }
  }
  function portraitCanvas(id, skin, px) {
    px = clamp(Math.round(px), 8, 256);
    const key = id + '|' + (skin || 'klasik') + '|' + px;
    let c = portCache.get(key);
    if (c) return c;
    c = mkCanvas(px, px);
    const g = c.getContext('2d');
    const ch = FM.CH[id] || { col: '#888888', col2: '#444444' };
    const c2 = hex6(ch.col2) || '#555555';
    g.save(); circ(g, px / 2, px / 2, px / 2); g.clip();
    g.fillStyle = rg(g, px * .5, px * .32, px * .04, px * .5, px * .5, px * .62, [0, gfx.shade(c2, .55), .7, gfx.shade(c2, .1), 1, gfx.shade(c2, -.35)]);
    g.fillRect(0, 0, px, px);
    let ok = false;
    if (typeof R.portrait === 'function') {
      try {
        const pc = R.portrait(id, px, { skin: skin || 'klasik' });
        if (pc && pc.width > 0) { g.drawImage(pc, -px * .07, -px * .04, px * 1.14, px * 1.14); ok = true; }
      } catch (e) { ok = false; }
    }
    if (!ok) fallbackFace(g, id, px);
    g.restore();
    if (portCache.size > 220) portCache.clear();
    portCache.set(key, c);
    return c;
  }
  function drawPortrait(ctx, r, x, y, rad) {
    if (!r) return;
    const px = Math.ceil(rad * 2 * RES / 4) * 4;
    const c = portraitCanvas(r.id, r.skin, px);
    ctx.drawImage(c, x - rad, y - rad, rad * 2, rad * 2);
  }

  /* ---- hap (pill) ve tuş kapağı ---- */
  function pill(ctx, x, y, w, h, o) {
    o = o || {};
    const r = h / 2;
    ctx.fillStyle = 'rgba(8,4,24,.32)'; rr(ctx, x, y + 2.5, w, h, r); ctx.fill();
    rr(ctx, x, y, w, h, r);
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, o.top || 'rgba(62,48,118,.94)'); gr.addColorStop(1, o.bot || 'rgba(28,20,60,.94)');
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = o.lw || 2.4; ctx.strokeStyle = o.border || OUT; ctx.stroke();
    if (o.gloss !== false) {
      ctx.fillStyle = o.glossCol || 'rgba(255,255,255,.14)';
      rr(ctx, x + 3, y + 2.2, w - 6, h * .4, h * .2); ctx.fill();
    }
  }
  function keycap(ctx, x, y, label, size) {
    const s = size || 18;
    const w = Math.max(s, tw(ctx, label, s * .62) + s * .55);
    ctx.fillStyle = OUT; rr(ctx, x - w / 2 - 1.8, y - s / 2 - 1.8, w + 3.6, s + 5.4, s * .32); ctx.fill();
    ctx.fillStyle = '#9d97b8'; rr(ctx, x - w / 2, y - s / 2 + 2, w, s, s * .26); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, y - s / 2, 0, y + s / 2, [0, '#ffffff', 1, '#dcd8ec']); rr(ctx, x - w / 2, y - s / 2, w, s, s * .26); ctx.fill();
    T(ctx, label, x, y + .5, s * .62, '#2a2140', { stroke: false, shadow: false });
  }
  /** ortadan kurdele (pankart) */
  function ribbon(ctx, x, y, text, col, size, alpha) {
    const base = hex6(col) || '#8b5cf6';
    const w = tw(ctx, text, size) + size * 2.1, h = size * 1.72, tail = h * .95, drop = h * .3;
    const xl = x - w / 2, xr = x + w / 2, yt = y - h / 2;
    const dark = gfx.shade(base, -.42), light = gfx.shade(base, .32), deeper = gfx.shade(base, -.65);
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2.4, size * .1); ctx.strokeStyle = OUT;
    for (const s of [-1, 1]) {
      const ex = s < 0 ? xl : xr, ins = size * .7;
      ctx.beginPath();
      ctx.moveTo(ex - s * ins, yt + drop);
      ctx.lineTo(ex + s * tail, yt + drop);
      ctx.lineTo(ex + s * (tail - size * .55), yt + drop + h / 2);
      ctx.lineTo(ex + s * tail, yt + drop + h);
      ctx.lineTo(ex - s * ins, yt + drop + h);
      ctx.closePath();
      ctx.fillStyle = dark; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - s * ins, yt + h); ctx.lineTo(ex, yt + h); ctx.lineTo(ex, yt + h + drop); ctx.closePath();
      ctx.fillStyle = deeper; ctx.fill(); ctx.stroke();
    }
    rr(ctx, xl, yt, w, h, h * .2);
    const gr = ctx.createLinearGradient(0, yt, 0, yt + h);
    gr.addColorStop(0, light); gr.addColorStop(.52, base); gr.addColorStop(1, dark);
    ctx.fillStyle = gr; ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.2)'; rr(ctx, xl + 4, yt + 3, w - 8, h * .36, h * .16); ctx.fill();
    ctx.setLineDash([size * .2, size * .2]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(xl + 7, yt + 5); ctx.lineTo(xr - 7, yt + 5); ctx.moveTo(xl + 7, yt + h - 5); ctx.lineTo(xr - 7, yt + h - 5); ctx.stroke();
    ctx.setLineDash([]);
    T(ctx, text, x, y + 1, size, '#ffffff', { lw: Math.max(3, size * .22) });
    ctx.restore();
  }

  /* ---- ışın / koni / halka sprite'ları ---- */
  function raysSprite(col) {
    const h = hex6(col) || '#ffffff';
    return hspr('rays' + h, 600, 600, 300, 300, g => {
      const gr = g.createRadialGradient(0, 0, 8, 0, 0, 300);
      gr.addColorStop(0, gfx.rgba(h, .95)); gr.addColorStop(.45, gfx.rgba(h, .38)); gr.addColorStop(1, gfx.rgba(h, 0));
      g.fillStyle = gr; g.beginPath();
      const n = 16;
      for (let i = 0; i < n; i++) { const a0 = i / n * TAU, a1 = a0 + TAU / n * .5; g.moveTo(0, 0); g.arc(0, 0, 300, a0, a1); g.closePath(); }
      g.fill();
    }, .75);
  }
  function coneSprite(col) {
    const h = hex6(col) || '#ffffff';
    return hspr('cone' + h, 300, 660, 150, 0, g => {
      for (let i = 0; i < 4; i++) {
        const wTop = 6 + i * 2, wBot = 60 + i * 30;
        g.beginPath(); g.moveTo(-wTop, 0); g.lineTo(wTop, 0); g.lineTo(wBot, 650); g.lineTo(-wBot, 650); g.closePath();
        const gr = g.createLinearGradient(0, 0, 0, 650);
        gr.addColorStop(0, gfx.rgba(h, .55 - i * .1)); gr.addColorStop(.55, gfx.rgba(h, .2 - i * .03)); gr.addColorStop(1, gfx.rgba(h, 0));
        g.fillStyle = gr; g.fill();
      }
    }, .6);
  }

  /* =====================================================================
     3) HUD DURUM İZLEME (animasyon tetikleyicileri)
     ===================================================================== */
  const H = {
    t: 0, lastDraw: 0, dd: 0, roundKey: '',
    coins: 0, coinBump: -9, coinGain: 0,
    rank: 0, rankPop: -9, rankDir: 0,
    item: null, itemPop: -9,
    full: false, fullPop: -9,
    mode: '', modeT: 0,
    prog: new Map(), pinX: new Map(), pinY: new Map(), fxMax: {}, rk: []
  };
  /* olay izleme: eleme bandı, meteor yağmuru */
  const EV = { elim: null, meteor: -9 };
  function track(P, rk) {
    const S = FM.S;
    const key = S.round + ':' + (S.L ? S.L.seed : 0) + ':' + P.id;
    const rank = rk.indexOf(P) + 1 || 1;
    if (key !== H.roundKey) {
      H.roundKey = key; H.coins = P.coins | 0; H.rank = rank; H.item = P.item; H.full = P.charge >= 100;
      H.prog.clear(); H.pinX.clear(); H.pinY.clear(); H.fxMax = {}; H.coinBump = H.rankPop = H.itemPop = H.fullPop = -9; H.rankDir = 0;
    }
    if (S.mode !== H.mode) { H.mode = S.mode; H.modeT = H.t; }
    const c = P.coins | 0;
    if (c > H.coins) { H.coinBump = H.t; H.coinGain = c - H.coins; }
    H.coins = c;
    if (rank !== H.rank) { if (S.mode === 'race') { H.rankDir = rank < H.rank ? 1 : -1; H.rankPop = H.t; } H.rank = rank; }
    if (P.item !== H.item) { if (P.item && !(PICK.phase && PICK.it === P.item)) H.itemPop = H.t; H.item = P.item; }   // uçuş sürerken yuva varışta "pop" eder
    const full = P.charge >= 100;
    if (full && !H.full) H.fullPop = H.t;
    H.full = full;
  }
  /* olaydan da (motor charge:full yayınlarsa) aynı anı yakala — track() zaten durumdan türetiyor, çift tetiklenmez */
  FM.on('charge:full', d => { const S = FM.S; if (d && d.r === S.player && !H.full && S.mode !== 'demo') { H.full = true; H.fullPop = H.t; } });

  /* ---- eşya alma geri bildirimi (TUR5 §3): başın üstünde büyük ikon "pop", sonra eşya yuvasına uçuş ----
     Hedef: FM.ui.slotRect('item') (mantıksal ekran birimi) → HUD birimi (÷hs); yoksa dokunmatikte css'teki EŞYA düğmesinin
     yeri, klavyede HUD'un kendi yuvası. Varınca FM.emit('hud:arrive', {kind:'item'}) — ARAYÜZ düğmeyi zıplatır. */
  const PICK = { it: null, t: 0, phase: 0, sx: 0, sy: 0, tx: 0, ty: 0, ts: 60, sp: [] };
  const PICK_POP = .62, PICK_FLY = .46, PICK_END = .4;
  FM.on('box', d => {
    const S = FM.S, P = S.player;
    if (!d || !d.item || !P || d.r !== P || P.ghost || S.mode === 'demo' || !FM.ITEMS[d.item]) return;
    PICK.it = d.item; PICK.t = 0; PICK.phase = 1; PICK.sp.length = 0;
    for (let i = 0; i < 9; i++) PICK.sp.push({ a: Math.random() * TAU, v: 46 + Math.random() * 70, s: 3.5 + Math.random() * 4, d: Math.random() * .25 });
  });
  FM.on('race:start', () => { PICK.phase = 0; PICK.it = null; });
  function itemSlotTarget() {
    const V = FM.view, hs = Lo.hs || 1;
    if (FM.ui && typeof FM.ui.slotRect === 'function') {
      try {
        const r = FM.ui.slotRect('item');
        if (r && isFinite(+r.x) && isFinite(+r.y) && +r.w > 0 && +r.h > 0) return { x: (+r.x + r.w / 2) / hs, y: (+r.y + r.h / 2) / hs, s: Math.min(+r.w, +r.h) / hs };
      } catch (e) { /* arayüz henüz hazır değil */ }
    }
    if (Lo.touch) {
      // css/style.css .tb-item: sağ alt köşe, boyut clamp(70px, 20vh, 116px), kenar 3.2vh + güvenli alan
      const dpr = V.dpr || 1, sc = V.S || 1, cssH = Lo.cssH || 390, cssW = (V.W || 960) / dpr, vh = cssH / 100;
      const size = clamp(20 * vh, 70, 116), m = 3.2 * vh;
      const toL = px => px * dpr / sc / hs;
      return { x: toL(cssW - m - (safe.r || 0) - size / 2), y: toL(cssH - m - (safe.b || 0) - size / 2), s: toL(size) };
    }
    const k = Lo.compact ? CMP_K : SLOT_K;
    return { x: Lo.padL + 42 * k, y: Lo.padT + 42 * k, s: 72 * k };
  }
  function drawPickup(ctx, P) {
    if (!PICK.phase || !P) return;
    const S = FM.S, hs = Lo.hs || 1, it = PICK.it, t = PICK.t;
    if (!FM.ITEMS[it]) { PICK.phase = 0; return; }
    const tg = itemSlotTarget();
    PICK.tx = tg.x; PICK.ty = tg.y; PICK.ts = tg.s;
    const col = hex6(FM.ITEMS[it].col) || '#ffffff';
    ctx.save();
    if (PICK.phase === 1) {
      // başın üstünde (plakanın da üstünde) zıplayarak büyüyen ikon + ezilme/esneme + saçılan parıltılar
      const hx = (P.x + (P.w || 28) / 2 - S.cam.x) / hs, hy = (P.y - 62 - S.cam.y) / hs;
      const u = clamp(t / PICK_POP, 0, 1);
      const e = u < .4 ? ease.outBack(u / .4, 2.8) : 1;
      const sq = u < .4 ? Math.sin(u / .4 * Math.PI) : 0;
      let sx = 1 + .3 * sq, sy = 1 - .24 * sq;
      if (u > .78) { const q = (u - .78) / .22; sx *= 1 - .14 * q; sy *= 1 + .22 * q; }   // kalkışa hazırlık: uzama
      const y = hy - 16 * e - Math.sin(u * Math.PI) * 8, size = 56 * e;
      PICK.sx = hx; PICK.sy = y;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .45 + .25 * Math.sin(H.t * 9);
      drawSpr(ctx, gfx.glowSprite(col, 54), hx, y, e);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      for (const s of PICK.sp) {   // parıltılar
        const k = clamp((u - s.d) / .6, 0, 1);
        if (k <= 0 || k >= 1) continue;
        ctx.globalAlpha = 1 - k;
        sparkle(ctx, hx + Math.cos(s.a) * s.v * k, y + Math.sin(s.a) * s.v * k * .7 - 10 * k, s.s * (1 - k * .5), '#fff6c0');
      }
      ctx.globalAlpha = 1;
      ctx.translate(hx, y); ctx.scale(sx, sy);
      drawIcon(ctx, it, 0, 0, size, 56);
      if (t >= PICK_POP) { PICK.phase = 2; PICK.t = 0; }
    } else if (PICK.phase === 2) {
      // kavisli uçuş: başın üstünden yuvaya (kontrol noktası yukarıda), arkasında solan izler
      const u = clamp(t / PICK_FLY, 0, 1), k = u * u * (3 - 2 * u);
      const x0 = PICK.sx, y0 = PICK.sy, x1 = PICK.tx, y1 = PICK.ty;
      const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 70;
      const at = q => [(1 - q) * (1 - q) * x0 + 2 * (1 - q) * q * cx + q * q * x1, (1 - q) * (1 - q) * y0 + 2 * (1 - q) * q * cy + q * q * y1];
      const sz0 = 52, sz1 = Math.max(26, PICK.ts * .62);
      for (let i = 3; i >= 1; i--) {
        const q = clamp(k - i * .07, 0, 1), p = at(q);
        ctx.globalAlpha = .28 - i * .06;
        drawIcon(ctx, it, p[0], p[1], lerp(sz0, sz1, q) * (1 - i * .12), 56);
      }
      const p = at(k);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5;
      drawSpr(ctx, gfx.glowSprite(col, 40), p[0], p[1]);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      drawIcon(ctx, it, p[0], p[1], lerp(sz0, sz1, k), 56);
      if (u >= 1) {
        PICK.phase = 3; PICK.t = 0; H.itemPop = H.t;
        try { FM.emit('hud:arrive', { kind: 'item' }); } catch (e) { /* dinleyici hatası uçuşu bozmasın */ }
      }
    } else {
      // varış: yuvada genişleyen halka + parıltı
      const u = clamp(t / PICK_END, 0, 1), rr0 = PICK.ts * .5;
      ctx.globalAlpha = (1 - u) * .9;
      ctx.lineWidth = 5 * (1 - u) + 1; ctx.strokeStyle = '#ffffff';
      circ(ctx, PICK.tx, PICK.ty, rr0 + u * 36); ctx.stroke();
      ctx.lineWidth = 2.5 * (1 - u) + .5; ctx.strokeStyle = col;
      circ(ctx, PICK.tx, PICK.ty, rr0 * .8 + u * 26); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + .4, d = rr0 + 8 + u * 30;
        sparkle(ctx, PICK.tx + Math.cos(a) * d, PICK.ty + Math.sin(a) * d, 5 * (1 - u), '#fff6c0');
      }
      if (u >= 1) PICK.phase = 0;
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- ekran dışı rakipler (TUR5 §9): kenar oku + küçük portre + mesafe (30 px = 1 m) ----
     Üst HUD bandının altında, dokunmatikte köşe düğmelerinin üstünde kalır; kenar başına en çok 3 kişi. */
  function drawOffscreen(ctx, P) {
    const S = FM.S, V = FM.view, hs = Lo.hs || 1;
    if (S.mode !== 'race' || !S.L) return;
    const me = (isGhost(P) || P.out) && S.spec ? S.spec : P;
    if (!me || !isFinite(+me.x)) return;
    const camX = S.cam.x, camY = S.cam.y, VW = V.VW || 960, VH = V.VH || 540;
    const top = Lo.padT + 102, bot = Lo.H - Lo.padB - (Lo.touch ? Lo.H * .3 : 16) - 16;
    if (bot - top < 40) return;
    const mx = me.x + (me.w || 28) / 2;
    const left = [], right = [];
    for (const r of S.racers) {
      if (!r || r === me || r.dead > 0 || r.off || r.out || r.ghost) continue;
      const cx = r.x + (r.w || 28) / 2, cy = r.y + (r.h || 42) / 2;
      const sx = cx - camX, sy = cy - camY;
      if (sx >= -8 && sx <= VW + 8 && sy >= -60 && sy <= VH + 40) continue;   // görünür
      if (sx >= -8 && sx <= VW + 8) continue;                                   // yalnız dikey dışarıda: ok yanıltır
      (sx < 0 ? left : right).push({ r, d: Math.abs(cx - mx), y: clamp(sy / hs, top, bot) });
    }
    for (const [list, side] of [[left, -1], [right, 1]]) {
      if (!list.length) continue;
      list.sort((a, b) => a.d - b.d);
      const arr = list.slice(0, 3).sort((a, b) => a.y - b.y);
      for (let i = 1; i < arr.length; i++) if (arr[i].y < arr[i - 1].y + 50) arr[i].y = arr[i - 1].y + 50;   // üst üste binme
      const over = arr[arr.length - 1].y - bot;
      if (over > 0) for (const o of arr) o.y = Math.max(top, o.y - over);
      for (const o of arr) drawEdgePin(ctx, o, side);
    }
  }
  function drawEdgePin(ctx, o, side) {
    const r = o.r, col = racerColor(r);
    const x = side < 0 ? Lo.padL + 30 : Lo.W - Lo.padR - 30, y = o.y + Math.sin(H.t * 4 + (r.idx | 0)) * 1.5;
    const rad = 15, m = Math.max(0, Math.round(o.d / 30));
    ctx.save();
    ctx.globalAlpha = .94;
    // ok: dış kenara bakan üçgen (kenara yapışık)
    const ax = x + side * (rad + 11);
    ctx.beginPath(); ctx.moveTo(ax + side * 9, y); ctx.lineTo(ax - side * 3, y - 10); ctx.lineTo(ax - side * 3, y + 10); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2.6; ctx.strokeStyle = OUT; ctx.lineJoin = 'round'; ctx.stroke();
    // portre
    ctx.fillStyle = 'rgba(8,4,24,.38)'; circ(ctx, x, y + 2.5, rad + 2.6); ctx.fill();
    ctx.fillStyle = OUT; circ(ctx, x, y, rad + 2.6); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, y - rad, 0, y + rad, [0, gfx.shade(col, .35), 1, gfx.shade(col, -.25)]); circ(ctx, x, y, rad + .6); ctx.fill();
    drawPortrait(ctx, r, x, y, rad - 2.4);
    ctx.lineWidth = 1.4; ctx.strokeStyle = OUT; circ(ctx, x, y, rad - 2.4); ctx.stroke();
    if (r.finished) {                                  // bitişte: bayrak rozeti
      ctx.fillStyle = OUT; circ(ctx, x - side * rad * .75, y - rad * .75, 8); ctx.fill();
      drawIcon(ctx, 'flag', x - side * rad * .75, y - rad * .75, 14, 20);
    }
    // mesafe hapı (portrenin altında)
    const txt = m + ' m', sz = 11.5, w = tw(ctx, txt, sz) + 12, h = 17;
    pill(ctx, x - w / 2, y + rad + 3, w, h, { top: 'rgba(30,20,60,.92)', bot: 'rgba(14,9,32,.92)', lw: 1.8, gloss: false });
    T(ctx, txt, x, y + rad + 3 + h / 2 + .5, sz, '#ffffff', { lw: 2.8, shadow: false });
    ctx.restore();
  }

  /* =====================================================================
     4) HUD PARÇALARI
     ===================================================================== */
  const SLOT_K = 1.24;                 // masaüstü (klavye) eşya/güç yuvaları: daha büyük ve belirgin (TUR5 §3)
  function slotFrame() {
    return hspr('slot', 96, 100, 48, 48, g => {
      g.fillStyle = 'rgba(8,4,24,.38)'; circ(g, 0, 4, 42); g.fill();
      g.fillStyle = OUT; circ(g, 0, 0, 42); g.fill();
      g.fillStyle = lg(g, 0, -40, 0, 40, [0, '#fff4b8', .3, '#ffd84a', .65, '#f0a20f', 1, '#b56500']); circ(g, 0, 0, 39); g.fill();
      g.fillStyle = OUT; circ(g, 0, 0, 32.2); g.fill();
      g.fillStyle = rg(g, 0, -12, 2, 0, 0, 31, [0, '#4a3e9c', .6, '#241c56', 1, '#140f33']); circ(g, 0, 0, 30.6); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 4; g.beginPath(); g.arc(0, 1.5, 28.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 36, Math.PI * 1.15, Math.PI * 1.55); g.stroke();
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2, px = Math.cos(a) * 35.6, py = Math.sin(a) * 35.6;
        g.fillStyle = '#8a4b00'; circ(g, px, py + .7, 2.5); g.fill();
        g.fillStyle = '#fff1b0'; circ(g, px, py, 1.9); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 25, Math.PI * .2, Math.PI * .8); g.stroke();
    });
  }
  /** Eşya yuvası; döner: etiket hapının sağ kenarı */
  function drawItemSlot(ctx, P) {
    const x = Lo.padL + 42, y = Lo.padT + 42;
    const it = P.item && FM.ITEMS[P.item] ? P.item : null;
    const pe = H.t - H.itemPop;
    ctx.save(); ctx.translate(x, y);
    const fs = it && pe < .4 ? 1 + .12 * Math.sin(clamp(pe / .4, 0, 1) * Math.PI) : 1;
    ctx.scale(fs, fs);
    if (it) {
      const col = hex6(FM.ITEMS[it].col) || '#ffffff';
      const pulse = .5 + .5 * Math.sin(H.t * 4.2);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .28 + .22 * pulse;
      drawSpr(ctx, gfx.glowSprite(col, 60), 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    drawSpr(ctx, slotFrame(), 0, 0);
    const flying = !!(it && PICK.phase && PICK.phase !== 3 && PICK.it === it);   // ikon hâlâ yuvaya uçuyor: yuva boş görünür
    if (it && !flying) {
      const sc = pe < .6 ? .3 + .7 * ease.outElastic(clamp(pe / .6, 0, 1)) : 1;
      const bob = Math.sin(H.t * 3) * 1.2;
      drawIcon(ctx, it, 0, bob, 50 * sc, 50);
      if (pe < .6) {
        const u = pe / .6;
        ctx.strokeStyle = 'rgba(255,255,255,' + (1 - u).toFixed(3) + ')'; ctx.lineWidth = 5 * (1 - u) + .5;
        circ(ctx, 0, 0, 28 + u * 34); ctx.stroke();
      }
    } else {
      T(ctx, '?', 0, 2, 34, 'rgba(255,255,255,.2)', { stroke: false, shadow: false });
    }
    ctx.restore();
    let right = x + 30;
    const sz = 13, h = 21;
    if (it && !flying) {
      const nm = FM.ITEMS[it].n, w = tw(ctx, nm, sz) + 20;
      const col = hex6(FM.ITEMS[it].col) || '#8b5cf6';
      pill(ctx, x - w / 2, y + 34, w, h, { top: gfx.mix(col, '#2c2066', .55), bot: gfx.mix(col, '#120c2e', .8) });
      T(ctx, nm, x, y + 34 + h / 2 + .5, sz, '#ffffff', { lw: 3.4 });
      right = x + w / 2;
    } else {
      const w = tw(ctx, 'EŞYA', sz) + 20;   // boşken de okunur etiket
      pill(ctx, x - w / 2, y + 34, w, h, { top: 'rgba(44,32,92,.8)', bot: 'rgba(20,14,46,.8)', gloss: false });
      T(ctx, 'EŞYA', x, y + 34 + h / 2 + .5, sz, 'rgba(255,255,255,.55)', { lw: 3, shadow: false });
      right = x + w / 2;
    }
    if (!Lo.touch) {   // tuş kapağı her zaman görünür; eşya varken hafif nabız
      const ks = it && !flying ? 1 + .08 * Math.sin(H.t * 5) : 1;
      ctx.save(); ctx.translate(x + 31, y - 28); ctx.scale(ks, ks); keycap(ctx, 0, 0, 'E', 18); ctx.restore();
    }
    return right;
  }

  function powerBack() {
    return hspr('pback', 84, 88, 42, 42, g => {
      g.fillStyle = 'rgba(8,4,24,.38)'; circ(g, 0, 4, 37); g.fill();
      g.fillStyle = OUT; circ(g, 0, 0, 37); g.fill();
      g.fillStyle = lg(g, 0, -35, 0, 35, [0, '#2e2464', 1, '#17112f']); circ(g, 0, 0, 34.6); g.fill();
      g.fillStyle = OUT; circ(g, 0, 0, 27); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1.2; circ(g, 0, 0, 33.6); g.stroke();
    });
  }
  function ringSprite(full) {
    return hspr(full ? 'pringF' : 'pring', 84, 84, 42, 42, g => {
      const N = 72, r = 31, w = 7.4;
      g.lineWidth = w; g.lineCap = 'butt';
      for (let i = 0; i < N; i++) {
        const t = i / N, a0 = -Math.PI / 2 + t * TAU - .02, a1 = -Math.PI / 2 + (i + 1) / N * TAU + .02;
        let col;
        if (full) col = gfx.mix('#ffd23f', '#fff6c8', .5 + .5 * Math.sin(t * TAU * 3));
        else col = t < .5 ? gfx.mix('#7b2ff7', '#d24bff', t * 2) : gfx.mix('#d24bff', '#ffd23f', (t - .5) * 2);
        g.strokeStyle = col; g.beginPath(); g.arc(0, 0, r, a0, a1); g.stroke();
      }
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,.45)'; circ(g, 0, 0, r + 2.4); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.25)'; circ(g, 0, 0, r - 2.6); g.stroke();
    });
  }
  function drawPower(ctx, P, minLeft) {
    const x = Lo.padL + 42 + 88, y = Lo.padT + 42;
    const ch = FM.CH[P.id] || {};
    const pct = clamp((+P.charge || 0) / 100, 0, 1), full = pct >= 1;
    const fe = H.t - H.fullPop;
    ctx.save(); ctx.translate(x, y);
    const sc = full && fe < .5 ? 1 + .2 * Math.sin(clamp(fe / .5, 0, 1) * Math.PI) : 1;
    ctx.scale(sc, sc);
    if (full) {
      const pulse = .5 + .5 * Math.sin(H.t * 6.5);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35 + .35 * pulse;
      drawSpr(ctx, gfx.glowSprite('#ffc83a', 62), 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    drawSpr(ctx, powerBack(), 0, 0);
    if (pct > 0) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40, -Math.PI / 2, -Math.PI / 2 + pct * TAU); ctx.closePath(); ctx.clip();
      drawSpr(ctx, ringSprite(full), 0, 0);
      ctx.restore();
      if (!full) {
        const a = -Math.PI / 2 + pct * TAU, ex = Math.cos(a) * 31, ey = Math.sin(a) * 31;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .9;
        drawSpr(ctx, gfx.glowSprite('#ffe9a0', 10), ex, ey);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff'; circ(ctx, ex, ey, 2.3); ctx.fill();
      }
    }
    drawPortrait(ctx, P, 0, 0, 23.5);
    ctx.lineWidth = 2; ctx.strokeStyle = OUT; circ(ctx, 0, 0, 24.2); ctx.stroke();
    if (full) {
      for (let i = 0; i < 4; i++) {
        const a = H.t * 2.2 + i * TAU / 4, rr2 = 36 + Math.sin(H.t * 5 + i) * 1.5;
        ctx.globalCompositeOperation = 'lighter';
        sparkle(ctx, Math.cos(a) * rr2, Math.sin(a) * rr2, 4.5 + 1.5 * Math.sin(H.t * 8 + i * 2), '#fff6c8');
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
    // etiket
    const sz = 13, h = 21;
    const label = full ? (ch.ab || 'Özel Güç') : 'GÜÇ %' + Math.floor(pct * 100);
    const w = tw(ctx, label, sz) + 20;
    let lx = x - w / 2;
    if (lx < minLeft + 6) lx = minLeft + 6;
    if (full) {
      const pulse = .5 + .5 * Math.sin(H.t * 6.5);
      pill(ctx, lx, y + 34, w, h, { top: gfx.mix('#ffd84a', '#fff3b0', pulse * .5), bot: '#e08a00', glossCol: 'rgba(255,255,255,.35)' });
      T(ctx, label, lx + w / 2, y + 34 + h / 2 + .5, sz, '#ffffff', { lw: 3.6 });
      if (!Lo.touch) keycap(ctx, x + 31, y - 28, 'Q', 18);
    } else {
      pill(ctx, lx, y + 34, w, h, {});
      T(ctx, label, lx + w / 2, y + 34 + h / 2 + .5, sz, '#d9c9ff', { lw: 3.2 });
    }
  }

  /* aktif etkiler (kalkan, hız, balon, donma, mürekkep, mıknatıs, ağ) */
  const EFX = [
    ['shield', r => r.shield, '#5ad1ff'],
    ['speed', r => r.boost, '#ffb020'],
    ['balloon', r => r.balloon ? 1 : 0, '#ff5a7a', true],
    ['ice', r => r.frozen, '#9be7ff'],
    ['ink', r => r.inked, '#a99bff'],
    ['mag', r => r.pull, '#c084fc'],
    ['net', r => r.netted, '#7be3ff']
  ];
  /** aktif etki halkaları; x0/y verilmezse klasik yer (eşya/güç halkalarının altı). Döner: bir şey çizildi mi */
  function drawEffects(ctx, P, x0, y0) {
    let x = x0 == null ? Lo.padL + 20 : x0;
    const y = y0 == null ? Lo.padT + 42 + 76 : y0;
    let any = false;
    for (const [key, get, col, bool] of EFX) {
      const v = +get(P) || 0;
      if (v <= 0) { H.fxMax[key] = 0; continue; }
      if (!H.fxMax[key] || v > H.fxMax[key]) H.fxMax[key] = v;
      const f = bool ? 1 : clamp(v / H.fxMax[key], 0, 1);
      const blink = !bool && v < .8 ? (Math.sin(H.t * 22) > 0 ? 1 : .45) : 1;
      ctx.globalAlpha = blink;
      ctx.fillStyle = 'rgba(8,4,24,.35)'; circ(ctx, x, y + 2, 15.5); ctx.fill();
      ctx.fillStyle = OUT; circ(ctx, x, y, 15.5); ctx.fill();
      ctx.fillStyle = '#231a4c'; circ(ctx, x, y, 13); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, 13, -Math.PI / 2, -Math.PI / 2 + f * TAU); ctx.stroke();
      drawIcon(ctx, key, x, y, 20, 20);
      ctx.globalAlpha = 1;
      x += 36;
      any = true;
    }
    return any;
  }

  /* ---- ilerleme çubuğu ---- */
  function railSprite(half) {
    return hspr('rail' + half, half * 2 + 30, 36, half + 15, 18, g => {
      const x0 = -half, w = half * 2, h = 14;
      g.fillStyle = 'rgba(8,4,24,.35)'; rr(g, x0 - 3.5, -h / 2 - 3.5 + 3, w + 7, h + 7, (h + 7) / 2); g.fill();
      g.fillStyle = OUT; rr(g, x0 - 3.5, -h / 2 - 3.5, w + 7, h + 7, (h + 7) / 2); g.fill();
      g.fillStyle = lg(g, 0, -h / 2, 0, h / 2, [0, '#0f0a26', .55, '#271d55', 1, '#3d3080']); rr(g, x0, -h / 2, w, h, h / 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, x0 + 3, -h / 2 + 1, w - 6, 3, 1.5); g.fill();
      for (let i = 1; i < 4; i++) { const px = x0 + w * i / 4; g.fillStyle = 'rgba(255,255,255,.2)'; rr(g, px - 1.2, -3.5, 2.4, 7, 1.2); g.fill(); }
      g.fillStyle = OUT; circ(g, x0 + 1, 0, 7.5); g.fill();
      g.fillStyle = lg(g, 0, -6, 0, 6, [0, '#a8ffb8', 1, '#24a84a']); circ(g, x0 + 1, 0, 5.6); g.fill();
    });
  }
  function progOf(r, Lv) {
    const span = Math.max(1, Lv.end - Lv.start);
    const target = r.finished ? 1 : clamp((r.x + (r.w || 28) / 2 - Lv.start) / span, 0, 1);
    let d = H.prog.get(r);
    if (d === undefined || Math.abs(d - target) > .2) d = target;
    else d += (target - d) * Math.min(1, H.dd * 10);
    H.prog.set(r, d);
    return d;
  }
  function drawPin(ctx, r, x, y, rad, isP) {
    const col = (r.off || r.out) ? '#8a88a0' : racerColor(r);
    const fade = r.off ? .5 : r.out ? .62 : r.stale ? .7 : 1;
    if (fade < 1) ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(8,4,24,.38)'; circ(ctx, x, y + 2.6, rad + 2.6); ctx.fill();
    ctx.fillStyle = OUT; circ(ctx, x, y, rad + 2.6); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, y - rad, 0, y + rad, [0, gfx.shade(col, .35), 1, gfx.shade(col, -.25)]); circ(ctx, x, y, rad + .6); ctx.fill();
    drawPortrait(ctx, r, x, y, rad - 2.6);
    ctx.lineWidth = 1.4; ctx.strokeStyle = OUT; circ(ctx, x, y, rad - 2.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, rad - .6, Math.PI * 1.15, Math.PI * 1.6); ctx.stroke();
    if ((r.dead > 0 && !r.finished) || r.off) {
      ctx.fillStyle = r.off ? 'rgba(40,36,60,.6)' : 'rgba(20,10,30,.55)'; circ(ctx, x, y, rad - 2.6); ctx.fill();
      if (!r.off) {
        const d = rad * .48;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
        ctx.strokeStyle = OUT; ctx.lineWidth = rad < 11 ? 5.5 : 6.5; ctx.stroke();
        ctx.strokeStyle = r.out ? '#b0aec4' : '#ff3b4e'; ctx.lineWidth = rad < 11 ? 2.8 : 3.4; ctx.stroke();
      }
    }
    if (fade < 1) ctx.globalAlpha = 1;
    if (r.off) {                                            // bağlantı koptu: kırmızı rozet + kesik fiş
      const bx = x + rad * .72, by = y - rad * .72, br = Math.max(6, rad * .55);
      ctx.fillStyle = OUT; circ(ctx, bx, by, br + 1.8); ctx.fill();
      ctx.fillStyle = '#ff3b4e'; circ(ctx, bx, by, br); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.6, br * .3); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(bx, by + br * .25, br * .55, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - br * .55, by - br * .55); ctx.lineTo(bx + br * .55, by + br * .55); ctx.stroke();
    }
    if (r.finished && r.place && !r.out) {
      const k = clamp(rad / 12, .8, 1.2);
      const bx = x + rad * .78, by = y - rad * .78, mc = MEDAL[clamp(r.place, 1, 4) - 1];
      ctx.fillStyle = OUT; circ(ctx, bx, by, 8.4 * k); ctx.fill();
      ctx.fillStyle = lg(ctx, 0, by - 7, 0, by + 7, [0, mc[0], 1, mc[2]]); circ(ctx, bx, by, 6.8 * k); ctx.fill();
      T(ctx, String(r.place), bx, by + .5, r.place >= 10 ? 8.5 : 10, '#ffffff', { lw: 2.6, shadow: false });
    }
    if (isP) {
      const ay = y - rad - 7 + Math.sin(H.t * 5) * 1.5;
      ctx.beginPath(); ctx.moveTo(x - 6, ay - 5); ctx.lineTo(x + 6, ay - 5); ctx.lineTo(x, ay + 2); ctx.closePath();
      ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
    }
  }
  const MEDAL = [
    ['#fff6c0', '#ffd23f', '#d98a00'],
    ['#ffffff', '#d5dde8', '#8995a8'],
    ['#ffe0c0', '#e89a52', '#9a4f18'],
    ['#d8d6e6', '#9a98b0', '#5c5a72']
  ];
  /** lim0/lim1 (sıkı düzen): çubuğun kullanabileceği yatay aralık (bayrak dahil değil); verilmezse ekran ortasında */
  function drawProgress(ctx, rk, lim0, lim1) {
    const S = FM.S, Lv = S.L;
    if (!Lv) return;
    let cx, half;
    if (lim0 != null && lim1 != null) {
      cx = Math.round((lim0 + lim1) / 2);
      half = Math.round(clamp((lim1 - lim0) / 2, 90, 320));
    } else {
      cx = Lo.W / 2;
      const leftLim = Lo.padL + 196, rightLim = Lo.W - Lo.padR - Lo.reserve - 104;
      half = Math.round(clamp(Math.min(cx - leftLim, rightLim - cx), 90, 250));
    }
    const x0 = cx - half, x1 = cx + half, y = Lo.padT + 30;
    drawSpr(ctx, railSprite(half), cx, y);
    const P = S.player;
    const pp = progOf(P, Lv);
    const fx = x0 + pp * (x1 - x0);
    if (fx > x0 + 3) {
      rr(ctx, x0 + 2, y - 4.5, fx - x0 - 2, 9, 4.5);
      ctx.fillStyle = lg(ctx, 0, y - 4.5, 0, y + 4.5, [0, '#fff3a0', .5, '#ffc21a', 1, '#e08a00']); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; rr(ctx, x0 + 4, y - 3.5, Math.max(0, fx - x0 - 6), 2.4, 1.2); ctx.fill();
    }
    drawIcon(ctx, 'flag', x1 + 15, y - 15, 40, 40);
    drawGateTicks(ctx, Lv, x0, x1, y);
    /* Portreler: kalabalıkta (5+) küçülür ve 3 şeride (ray, altı, üstü) dağılır; boş yer yoksa yana kayar → üst üste binmez.
       Oyuncu (izleyicide izlenen) her zaman rayda ve en üstte. Konum/şerit yumuşatılır (titremez). */
    const many = rk.length > 4;
    const rad = many ? 10 : 12, prad = many ? 14.5 : 16.5;
    const spect = isGhost(P) || !!P.out, focusR = spect && S.spec ? S.spec : P;
    const items = rk.map(r => ({ r, isP: r === focusR, p: r === P ? pp : progOf(r, Lv), x: 0, lane: 0 }));
    for (const it of items) it.x = x0 + it.p * (x1 - x0);
    const lanes = many ? [0, 1, -1] : [0], LDY = { '0': 0, '1': 19, '-1': -18 };
    const occ = { '0': [], '1': [], '-1': [] };
    const freeX = (list, x, r, dir) => {
      let cx = x;
      for (let g = 0; g < 14; g++) {
        let hit = null;
        for (const o of list) if (Math.abs(o[0] - cx) < o[1] + r + 1) { hit = o; break; }
        if (!hit) return cx;
        cx = hit[0] + dir * (hit[1] + r + 1.5);
      }
      return cx;
    };
    // önce oyuncu (rayda, tam yerinde), sonra sağ yarı sağdan sola (sola iterek), sol yarı soldan sağa (sağa iterek)
    const fp = items.find(it => it.isP);
    if (fp) { occ['0'].push([fp.x, prad]); occ['1'].push([fp.x, 9]); occ['-1'].push([fp.x, 9]); }   // oyuncunun büyük portresi üst/alt şeritte de yer kaplar
    const rest = items.filter(it => !it.isP);
    const R1 = rest.filter(it => it.p > .5).sort((a, b) => (b.p - a.p) || ((a.r.idx | 0) - (b.r.idx | 0)));
    const R0 = rest.filter(it => it.p <= .5).sort((a, b) => (a.p - b.p) || ((a.r.idx | 0) - (b.r.idx | 0)));
    const place = (it, dir) => {
      let best = null, bx = it.x, bl = 0;
      for (const ln of lanes) {
        const fx = freeX(occ[ln], it.x, rad, dir), cost = Math.abs(fx - it.x) + (ln ? 2.5 : 0);
        if (best === null || cost < best) { best = cost; bx = fx; bl = ln; }
      }
      it.x = bx; it.lane = bl; occ[bl].push([bx, rad]);
    };
    for (const it of R1) place(it, -1);
    for (const it of R0) place(it, 1);
    const span = Math.max(1, x1 - x0);
    for (const it of items) {
      const tn = (clamp(it.x, x0 - 30, x1 + 10) - x0) / span;   // çubuğa göre normalize (ekran boyutu değişse de doğru kalır)
      let d = H.pinX.get(it.r);
      if (d === undefined || Math.abs(d - tn) > .18) d = tn;
      else d += (tn - d) * Math.min(1, H.dd * 12);
      H.pinX.set(it.r, d); it.dx = x0 + d * span;
      const ty = LDY[it.lane] || 0;
      let dy = H.pinY.get(it.r);
      if (dy === undefined) dy = ty; else dy += (ty - dy) * Math.min(1, H.dd * 14);
      H.pinY.set(it.r, dy); it.dy = dy;
    }
    // arkada: elenen/kopan, sonra diğerleri, en üstte oyuncu
    for (const it of items) if (!it.isP && (it.r.out || it.r.off)) drawPin(ctx, it.r, it.dx, y + it.dy, rad, false);
    for (const it of items) if (!it.isP && !(it.r.out || it.r.off)) drawPin(ctx, it.r, it.dx, y + it.dy, rad, false);
    for (const it of items) if (it.isP) drawPin(ctx, it.r, it.dx, y, prad, !spect);
  }
  /** Eleme kapıları ilerleme çubuğunda: yeşil = sıradaki, sarı = geçtin (bekleniyor), kırmızı = kapandı */
  function drawGateTicks(ctx, Lv, x0, x1, y) {
    const G0 = Lv.gates;
    if (!G0 || !G0.length) return;
    const span = Math.max(1, Lv.end - Lv.start), P = FM.S.player;
    const me = isGhost(P) ? FM.S.spec : P;
    for (const g of G0) {
      if (!g || g.off) continue;
      const gx = x0 + clamp((g.x - Lv.start) / span, 0, 1) * (x1 - x0);
      const passed = me && (me.gates & (1 << g.n));
      const col = g.done ? '#ff4d5e' : passed ? '#ffd23f' : '#5ee07a';
      ctx.fillStyle = OUT; rr(ctx, gx - 3.4, y - 12, 6.8, 24, 3.4); ctx.fill();
      ctx.fillStyle = col; rr(ctx, gx - 1.8, y - 10.4, 3.6, 20.8, 1.8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; rr(ctx, gx - 1, y - 9.5, 1.4, 8, .7); ctx.fill();
    }
  }

  /* ---- sıralama rozeti ---- */
  const RANK_COL = [
    { rim: ['#fff6c0', '#ffd23f', '#f0a20f', '#a85f00'], in: ['#ff5a6a', '#a3122f'] },
    { rim: ['#ffffff', '#e3e9f2', '#aab6c8', '#6c7890'], in: ['#5a9bff', '#1b3d8f'] },
    { rim: ['#ffe6cc', '#f0a060', '#c06a26', '#7a3c10'], in: ['#4cc47a', '#1c5c34'] },
    { rim: ['#e4e2ef', '#a5a3ba', '#77758e', '#4e4c63'], in: ['#6b6584', '#2e2a42'] }
  ];
  function badgePath(g, hw, top, bot) {
    const mid = top + (bot - top) * .45;
    g.beginPath();
    g.moveTo(-hw, top + 6);
    g.quadraticCurveTo(-hw, top - 2, -hw + 9, top - 2);
    g.quadraticCurveTo(0, top - 12, hw - 9, top - 2);
    g.quadraticCurveTo(hw, top - 2, hw, top + 6);
    g.lineTo(hw, mid);
    g.bezierCurveTo(hw, mid + (bot - mid) * .55, hw * .45, bot - 6, 0, bot);
    g.bezierCurveTo(-hw * .45, bot - 6, -hw, mid + (bot - mid) * .55, -hw, mid);
    g.closePath();
  }
  function rankSprite(rank, total) {
    return hspr('rank' + rank + '/' + total, 92, 104, 46, 50, g => {
      const big = rank >= 10;
      const M = RANK_COL[clamp(rank, 1, 4) - 1];
      g.save(); g.translate(0, 4); badgePath(g, 33, -36, 41); g.fillStyle = 'rgba(8,4,24,.38)'; g.fill(); g.restore();
      badgePath(g, 33, -36, 41); g.lineWidth = 7; g.strokeStyle = OUT; g.stroke();
      g.fillStyle = lg(g, 0, -46, 0, 41, [0, M.rim[0], .3, M.rim[1], .7, M.rim[2], 1, M.rim[3]]); g.fill();
      g.save(); g.scale(.78, .8); g.translate(0, 1);
      badgePath(g, 33, -36, 41); g.fillStyle = rg(g, 0, -20, 2, 0, -4, 46, [0, M.in[0], 1, M.in[1]]); g.fill();
      g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
      g.restore();
      g.save(); badgePath(g, 33, -36, 41); g.clip();
      g.fillStyle = 'rgba(255,255,255,.28)'; g.save(); g.translate(-16, -26); g.rotate(-.5); ell(g, 0, 0, 12, 22); g.fill(); g.restore();
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-27, -28); g.quadraticCurveTo(-14, -36, 0, -36); g.stroke();
      T(g, rank + '.', -2, -3, big ? 30 : 38, '#ffffff', { lw: big ? 6.5 : 7.5 });
      T(g, '/' + total, total >= 10 ? 10 : 13, 22, 13, gfx.shade(M.rim[1], .4), { lw: 3.6, shadow: false });
      if (rank === 1) for (const s of [-1, 1]) sparkle(g, s * 26, -32, 5, '#ffffff');
    });
  }
  /** k: ölçek (sıkı düzende .78). Döner: rozetin sol kenarı */
  function drawRank(ctx, rank, total, k) {
    k = k || 1;
    const bx = Lo.W - Lo.padR - Lo.reserve - 8 - 36 * k, by = Lo.padT + 48 * k;
    const e = H.t - H.rankPop;
    const sc = (e < .7 ? 1 + .35 * (1 - ease.outElastic(clamp(e / .7, 0, 1))) : 1) * k;
    if (e < .5) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - e / .5) * .8;
      drawSpr(ctx, gfx.glowSprite(H.rankDir > 0 ? '#9dff9d' : '#ff8080', 64), bx, by, k);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (rank === 1) {
      const pulse = .5 + .5 * Math.sin(H.t * 3);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .25 + .2 * pulse;
      drawSpr(ctx, gfx.glowSprite('#ffd23f', 58), bx, by, k);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    drawSpr(ctx, rankSprite(clamp(rank, 1, 10), clamp(total, 1, 10)), bx, by, sc);
    if (rank === 1) drawIcon(ctx, 'crown', bx - k, by - 43 * k + Math.sin(H.t * 3) * 1.2 * k, 27 * k, 27);
    if (e < 1.5 && H.rankDir) {
      const a = clamp(1.5 - e, 0, 1), up = H.rankDir > 0;
      // sıkı düzende ok, rozetin solundaki süre/tur hapının ALTINDA (rozetin daralan alt kısmının yanında)
      const ax = k < 1 ? bx - 40 : bx - 50;
      const ay = k < 1 ? Lo.padT + 64 + (up ? -e * 6 : e * 6) : by + (up ? -4 - e * 10 : 4 + e * 10);
      ctx.globalAlpha = a;
      ctx.beginPath();
      if (up) { ctx.moveTo(ax - 9, ay + 5); ctx.lineTo(ax + 9, ay + 5); ctx.lineTo(ax, ay - 8); }
      else { ctx.moveTo(ax - 9, ay - 5); ctx.lineTo(ax + 9, ay - 5); ctx.lineTo(ax, ay + 8); }
      ctx.closePath(); ctx.fillStyle = up ? '#5ee07a' : '#ff4d5e'; ctx.fill(); ctx.lineWidth = 2.6; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    return bx - 37 * k;
  }

  /* ---- tur / süre / altın hapları ---- */
  function fmtTime(t) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function drawInfo(ctx, P) {
    const S = FM.S, xr = Lo.W - Lo.padR;
    let y = Math.max(Lo.padT + 106, Lo.reserve + 26);
    const h = 25, sz = 14;
    const tTxt = 'TUR ' + S.round + '/' + S.ROUNDS;
    const w1 = tw(ctx, tTxt, sz) + 22;
    pill(ctx, xr - w1, y - h / 2, w1, h, { top: 'rgba(120,64,210,.95)', bot: 'rgba(66,28,128,.95)' });
    T(ctx, tTxt, xr - w1 / 2, y + 1, sz, '#ffffff', { lw: 3.4 });
    const time = fmtTime(S.raceT);
    const w2 = tw(ctx, time.replace(/\d/g, '0'), sz) + 40;
    const x2 = xr - w1 - 6 - w2;
    pill(ctx, x2, y - h / 2, w2, h, {});
    drawIcon(ctx, 'clock', x2 + 14, y, 21, 21);
    T(ctx, time, x2 + 27, y + 1, sz, '#ffffff', { lw: 3.4, align: 'left' });
    // altın (izleyicide yok) + ağ durumu solunda
    y += h + 8;
    const cw = isGhost(P) ? 0 : drawCoins(ctx, P, xr, y, false);
    if (FM.S.netRole) drawNetBadge(ctx, xr - cw - (cw ? 8 : 0), y, true);
    return y + 28 / 2 + 18;
  }
  /** Altın hapı (yükseklik 28, dikey merkez y). left=true: x sol kenar, '+N' sağda; değilse x sağ kenar, '+N' solda. Döner: genişlik */
  function drawCoins(ctx, P, x, y, left) {
    const e = H.t - H.coinBump;
    const bump = e < .5 ? 1 + .38 * (1 - ease.outElastic(clamp(e / .5, 0, 1))) : 1;
    const cTxt = String(P.coins | 0);
    const ch = 28, csz = 18;
    const w3 = Math.max(tw(ctx, cTxt, csz), tw(ctx, left ? '000' : '00', csz)) + 44;
    const x3 = left ? x : x - w3;
    pill(ctx, x3, y - ch / 2, w3, ch, { top: 'rgba(70,46,20,.94)', bot: 'rgba(36,22,10,.94)', border: OUT });
    ctx.save(); ctx.translate(x3 + 14, y); ctx.scale(bump, bump);
    if (e < .35) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - e / .35; drawSpr(ctx, gfx.glowSprite('#ffd23f', 26), 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    drawIcon(ctx, 'coin', 0, 0, 32, 32);
    ctx.restore();
    ctx.save(); ctx.translate(x3 + 32 + (w3 - 40) / 2, y + 1); ctx.scale(bump, bump);
    T(ctx, cTxt, 0, 0, csz, '#ffe14d', { lw: 4 });
    ctx.restore();
    if (e < .9 && H.coinGain > 0) {
      const u = e / .9;
      ctx.globalAlpha = 1 - u * u;
      if (left) T(ctx, '+' + H.coinGain, x3 + w3 + 4, y + 8 - u * 12, 14, '#ffe14d', { lw: 3.4, align: 'left' });
      else T(ctx, '+' + H.coinGain, x3 - 4, y - 6 - u * 16, 14, '#ffe14d', { lw: 3.4, align: 'right' });
      ctx.globalAlpha = 1;
    }
    return w3;
  }
  /** Sıkı düzen: süre + tur tek hapta ('🕒 0:24 [TUR 1/3]'), sağ kenarı xr, dikey merkez y. Döner: sol kenar */
  function drawInfoCompact(ctx, xr, y) {
    const S = FM.S, h = 25, sz = 14, rsz = 12.5;
    const time = fmtTime(S.raceT);
    const tTxt = 'TUR ' + (S.round || 1) + '/' + (S.ROUNDS || 1);
    const timeW = tw(ctx, time.replace(/\d/g, '0'), sz);
    const rW = tw(ctx, tTxt, rsz) + 14, rH = h - 7;
    const w = 27 + timeW + 8 + rW + 4;
    const x = xr - w;
    pill(ctx, x, y - h / 2, w, h, {});
    drawIcon(ctx, 'clock', x + 14, y, 21, 21);
    T(ctx, time, x + 27, y + 1, sz, '#ffffff', { lw: 3.4, align: 'left' });
    const sx = x + w - 4 - rW;
    rr(ctx, sx, y - rH / 2, rW, rH, rH / 2);
    ctx.fillStyle = lg(ctx, 0, y - rH / 2, 0, y + rH / 2, [0, '#9a5cf0', 1, '#4a1c8c']); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
    T(ctx, tTxt, sx + rW / 2, y + 1, rsz, '#ffffff', { lw: 3, shadow: false });
    return x;
  }

  /* ---- öldürme akışı ---- */
  function nameCol(name) {
    const S = FM.S;
    if (S.player && name === S.player.name) return '#ffe14d';
    for (const r of S.racers) if (r.name === name) return gfx.shade(racerColor(r), .45);
    return '#ffffff';
  }
  function drawFeedIcon(ctx, ic, x, y, size) {
    const nm = iconForFeed(ic);
    if (nm) { drawIcon(ctx, nm, x, y, size, size); return; }
    ctx.font = Math.round(size * .8) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.fillText(String(ic), x, y + 1);
  }
  /** left: sıkı düzende akış sol sütunda (koşu yönünü kapatmasın), en fazla 2 kayıt, soldan kayarak gelir */
  function drawFeed(ctx, y0, left) {
    const S = FM.S, xr = Lo.W - Lo.padR;
    let y = y0;
    const n = Math.min(left ? 2 : 4, S.feed.length);
    for (let i = 0; i < n; i++) {
      const f = S.feed[i];
      if (!f) continue;
      const age = 4 - f.t;
      const a = clamp(Math.min(age / .18, f.t / .5), 0, 1);
      if (a <= 0) continue;
      const slide = (1 - ease.outCubic(clamp(age / .28, 0, 1))) * 50;
      const sz = 13, ic = 22, h = 27;
      const A = f.a ? String(f.a) : '', B = String(f.b || '');
      const aw = A ? tw(ctx, A, sz) : 0, bw = tw(ctx, B, sz);
      const w = 18 + (A ? aw + 7 : 0) + ic + 7 + bw;
      const x = left ? Lo.padL - slide : xr - w + slide;
      const isP = S.player && (A === S.player.name || B === S.player.name);
      ctx.globalAlpha = a;
      pill(ctx, x, y - h / 2, w, h, isP ? { top: 'rgba(96,60,10,.9)', bot: 'rgba(50,30,6,.9)', lw: 2.2 } : { top: 'rgba(36,26,70,.82)', bot: 'rgba(18,12,40,.82)', lw: 2.2 });
      let cx = x + 9;
      if (A) { T(ctx, A, cx, y + 1, sz, nameCol(A), { align: 'left', lw: 3.2, shadow: false }); cx += aw + 7; }
      drawFeedIcon(ctx, f.icon, cx + ic / 2, y, ic);
      cx += ic + 7;
      T(ctx, B, cx, y + 1, sz, nameCol(B), { align: 'left', lw: 3.2, shadow: false });
      ctx.globalAlpha = 1;
      y += h + 5;
    }
  }

  /* ---- dokunmatik: kısa süreli bilgi hapları (eşya/güç halkaları EŞYA/GÜÇ düğmelerinde zaten görünüyor) ---- */
  const CHIP_T = 1.7;
  /** Sol hizalı hap: ikon + yazı; soldan büyüyerek gelir, sonda söner. y: üst kenar. Döner: sonraki üst kenar */
  function chip(ctx, x, y, age, text, o, drawIco) {
    const a = clamp(Math.min(age / .12, (CHIP_T - age) / .35), 0, 1);
    if (a <= 0) return y;
    const sz = 14, h = 28, ic = 24;
    const w = 8 + ic + 6 + tw(ctx, text, sz) + 12;
    const s = age < .35 ? .55 + .45 * ease.outBack(clamp(age / .35, 0, 1), 2.2) : 1;
    ctx.save();
    ctx.globalAlpha = a; ctx.translate(x, y + h / 2); ctx.scale(s, s);
    pill(ctx, 0, -h / 2, w, h, o);
    drawIco(8 + ic / 2, ic);
    T(ctx, text, 8 + ic + 6, 1, sz, '#ffffff', { lw: 3.4, align: 'left' });
    if (age < .5) {                                   // ilk anda beyaz parlama
      ctx.globalAlpha = a * (1 - age / .5) * .55; ctx.fillStyle = '#ffffff';
      rr(ctx, 0, -h / 2, w, h, h / 2); ctx.fill();
    }
    ctx.restore();
    return y + h + 6;
  }
  function drawTouchChips(ctx, P, y) {
    const x = Lo.padL;
    const it = P.item && FM.ITEMS[P.item] ? P.item : null;
    const pe = H.t - H.itemPop;
    if (it && pe >= 0 && pe < CHIP_T) {
      const col = hex6(FM.ITEMS[it].col) || '#8b5cf6';
      y = chip(ctx, x, y, pe, FM.ITEMS[it].n, { top: gfx.mix(col, '#2c2066', .55), bot: gfx.mix(col, '#120c2e', .8) },
        (cx, s) => drawIcon(ctx, it, cx, 0, s + 2, 26));
    }
    const fe = H.t - H.fullPop;
    if (P.charge >= 100 && fe >= 0 && fe < CHIP_T) {
      y = chip(ctx, x, y, fe, 'GÜÇ HAZIR!', { top: '#ffd84a', bot: '#e08a00', glossCol: 'rgba(255,255,255,.35)' },
        (cx, s) => {
          drawPortrait(ctx, P, cx, 0, s / 2);
          ctx.lineWidth = 2; ctx.strokeStyle = OUT; circ(ctx, cx, 0, s / 2 + .5); ctx.stroke();
        });
    }
    return y;
  }

  /* ---- sıkı (telefon / kısa ekran) HUD düzeni ----
     Üst satır: [altın] [ilerleme çubuğu ......... bayrak] [süre · TUR] [sıra rozeti ×.78] [duraklat]
     Sol sütun (oyuncunun arkası): etkiler, kısa süreli haplar, öldürme akışı (en fazla 2).
     Klavyeli kısa pencerede eşya/güç halkaları %86 ölçekte sol üstte kalır (dokunmatik düğme yok). */
  const CMP_K = .86, RANK_K = .78;
  function drawCompactHUD(ctx, P, rk) {
    const rowY = Lo.padT + 30;                         // üst satır ekseni (ilerleme çubuğuyla aynı)
    const ghost = isGhost(P), pure = gMode() === 'pure';
    let leftEnd, y;
    if (ghost) {                                       // geç katılan izleyici: kendi eşya/altın/güç yok
      leftEnd = Lo.padL;
      y = rowY + 14;
    } else if (Lo.touch) {
      leftEnd = Lo.padL + drawCoins(ctx, P, Lo.padL, rowY, true);
      y = rowY + 14 + 10;
    } else {
      const k = CMP_K;
      ctx.save();
      ctx.translate(Lo.padL, Lo.padT); ctx.scale(k, k); ctx.translate(-Lo.padL, -Lo.padT);
      if (pure) { ctx.translate(-88, 0); drawPower(ctx, P, Lo.padL + 88); }   // Saf Parkur: eşya yuvası yok
      else { const pillR = drawItemSlot(ctx, P); drawPower(ctx, P, pillR); }
      ctx.restore();
      leftEnd = Lo.padL + (pure ? 94 : 182) * k;
      y = Lo.padT + 97 * k + 8;                        // etiket haplarının altı
      drawCoins(ctx, P, Lo.padL + 4, y + 14, true);
      y += 28 + 10;
    }
    let badgeL;
    if (ghost) badgeL = Lo.W - Lo.padR - Lo.reserve;
    else {
      const rank = rk.indexOf(P) + 1 || 1;
      badgeL = drawRank(ctx, rank, rk.length || 4, RANK_K);
    }
    const infoL = drawInfoCompact(ctx, badgeL - 8, rowY);
    drawProgress(ctx, rk, leftEnd + 34, infoL - 46);
    if (FM.S.netRole) drawNetBadge(ctx, infoL, rowY + 26, false, ghost ? Lo.W - Lo.padR - Lo.reserve - 4 : badgeL - 22);
    if (!ghost) {
      if (drawEffects(ctx, P, Lo.padL + 17, y + 16)) y += 38;
      if (Lo.touch) y = drawTouchChips(ctx, P, y);
    }
    drawFeed(ctx, y + 14, true);
    if (gMode() === 'coins') drawCoinBoard(ctx, P, rk, Lo.W - Lo.padR, Lo.padT + 84);
  }

  /* ---- ağ durumu: sinyal çubukları + ping, oyuncu sayısı, ev sahibi tacı (yalnız çok oyunculu) ---- */
  const NETC = { t: -9, st: null, host: false };
  function netInfo() {
    if (H.t - NETC.t > .5 || H.t < NETC.t) {
      NETC.t = H.t;
      try { NETC.st = FM.net && typeof FM.net.status === 'function' ? FM.net.status() : null; } catch (e) { NETC.st = null; }
      try { NETC.host = !!(FM.net && typeof FM.net.isHost === 'function' && FM.net.isHost()); } catch (e) { NETC.host = false; }
    }
    return NETC;
  }
  /** y: dikey merkez. right=true: x sağ kenar. maxR: sağ sınır (sola hizalıyken taşarsa ayrıntı atılır). Döner: genişlik */
  function drawNetBadge(ctx, x, y, right, maxR) {
    const S = FM.S;
    if (!S.netRole) return 0;
    const ni = netInfo(), st = ni.st || {};
    const ok = !st.conn || st.conn === 'open';
    const rtt = +st.rtt || 0;
    const q = !ok ? 0 : rtt <= 0 ? 2 : rtt < 180 ? 3 : rtt < 400 ? 2 : 1;
    const col = q >= 3 ? '#5ee07a' : q === 2 ? '#ffd23f' : '#ff4d5e';
    let humans = 0;
    for (const r of S.racers) if (r && !r.nbot && r.ctrl !== 'bot' && !r.off) humans++;
    if (isGhost(S.player)) humans++;
    const sz = 12.5, h = 21;
    const pTxt = ok ? (rtt > 0 ? Math.min(9999, Math.round(rtt)) + ' ms' : '…') : (st.conn === 'reconnecting' || st.conn === 'connecting' ? 'Bağlanıyor' : 'Bağlantı yok');
    const cTxt = String(humans);
    const pw = tw(ctx, pTxt, sz), cw = tw(ctx, cTxt, sz);
    let showCnt = true, showHost = ni.host, pT = pTxt, pW = pw;
    const calc = () => 8 + 13 + 5 + pW + (showCnt ? 9 + 11 + 3 + cw : 0) + (showHost ? 6 + 15 : 0) + 8;
    let w = calc();
    // dar yerde sırayla: ' ms' atılır, sonra taç, sonra kişi sayısı
    if (!right && maxR != null && x + w > maxR && ok && rtt > 0) { pT = String(Math.min(9999, Math.round(rtt))); pW = tw(ctx, pT, sz); w = calc(); }
    if (!right && maxR != null && x + w > maxR) { showHost = false; w = calc(); if (x + w > maxR) { showCnt = false; w = calc(); } }
    const x0 = right ? x - w : x;
    const blink = !ok ? (Math.sin(H.t * 8) > 0 ? 1 : .55) : 1;
    ctx.save(); ctx.globalAlpha = blink;
    pill(ctx, x0, y - h / 2, w, h, { top: 'rgba(30,22,64,.9)', bot: 'rgba(14,10,34,.9)', lw: 2 });
    let cx = x0 + 8;
    for (let i = 0; i < 3; i++) {                        // sinyal çubukları
      const bh = 4 + i * 3.2, bx = cx + i * 4.6;
      ctx.fillStyle = OUT; rr(ctx, bx - .8, y + 5.5 - bh - .8, 4.2, bh + 1.6, 1.4); ctx.fill();
      ctx.fillStyle = i < q ? col : 'rgba(255,255,255,.22)'; rr(ctx, bx, y + 5.5 - bh, 2.6, bh, 1); ctx.fill();
    }
    cx += 13 + 5;
    T(ctx, pT, cx, y + 1, sz, ok ? '#ffffff' : '#ff9aa4', { align: 'left', lw: 3, shadow: false });
    cx += pW;
    if (showCnt) {
      cx += 9;
      personGlyph(ctx, cx + 5.5, y - 1, 11, '#c9b8ff');
      cx += 11 + 3;
      T(ctx, cTxt, cx, y + 1, sz, '#ffffff', { align: 'left', lw: 3, shadow: false });
      cx += cw;
    }
    if (showHost) { cx += 6; drawIcon(ctx, 'crown', cx + 7.5, y - 1, 17, 17); }
    ctx.restore();
    return w;
  }

  /* ---- Altın Avı: canlı altın sıralaması (ilk 3 + senin yerin). xr sağ kenar, y0 üst. Döner: alt kenar ---- */
  function drawCoinBoard(ctx, P, rk, xr, y0) {
    const S = FM.S;
    if (!rk || !rk.length) return y0;
    const rows = [];
    for (let i = 0; i < Math.min(3, rk.length); i++) rows.push({ r: rk[i], i });
    const pi = rk.indexOf(P);
    if (pi >= 3) rows.push({ r: P, i: pi, sep: true });
    const sz = 13, rh = 23, gap = 3, w = Lo.compact ? 150 : 168;
    const x = xr - w;
    let y = y0;
    // başlık
    {
      const hh = 18, htxt = 'ALTIN SIRASI', hw = tw(ctx, htxt, 12) + 34;
      pill(ctx, xr - hw, y, hw, hh, { top: '#ffd84a', bot: '#c07800', lw: 2, glossCol: 'rgba(255,255,255,.3)' });
      drawIcon(ctx, 'coin', xr - hw + 11, y + hh / 2, 16, 16);
      T(ctx, htxt, xr - hw + 21, y + hh / 2 + 1, 12, '#ffffff', { align: 'left', lw: 3, shadow: false });
      y += hh + 4;
    }
    for (const row of rows) {
      const r = row.r, me = r === P;
      if (row.sep) { ctx.fillStyle = 'rgba(255,255,255,.75)'; for (let k = -1; k <= 1; k++) { circ(ctx, x + w / 2 + k * 7, y + 2, 1.8); ctx.fill(); } y += 7; }
      pill(ctx, x, y, w, rh, me ? { top: 'rgba(120,80,10,.94)', bot: 'rgba(60,36,4,.94)', lw: 2, border: '#ffd23f' } : { top: 'rgba(40,28,82,.88)', bot: 'rgba(18,12,40,.88)', lw: 2 });
      const cy = y + rh / 2;
      const mc = MEDAL[clamp(row.i + 1, 1, 4) - 1];
      ctx.fillStyle = OUT; circ(ctx, x + 12, cy, 9); ctx.fill();
      ctx.fillStyle = lg(ctx, 0, cy - 8, 0, cy + 8, [0, mc[0], 1, mc[2]]); circ(ctx, x + 12, cy, 7.5); ctx.fill();
      T(ctx, String(row.i + 1), x + 12, cy + .5, row.i >= 9 ? 9.5 : 11, '#ffffff', { lw: 2.6, shadow: false });
      drawPortrait(ctx, r, x + 32, cy, 8.5);
      ctx.lineWidth = 1.5; ctx.strokeStyle = OUT; circ(ctx, x + 32, cy, 8.8); ctx.stroke();
      const cTxt = String(r.coins | 0), cw = tw(ctx, cTxt, sz);
      const nmMax = w - 44 - cw - 26;
      const nm = clip(ctx, me ? 'Sen' : (r.name || r.id), sz, nmMax);
      T(ctx, nm, x + 44, cy + 1, sz, me ? '#ffe14d' : (r.off ? '#a8a6bc' : '#ffffff'), { align: 'left', lw: 3, shadow: false });
      drawIcon(ctx, 'coin', x + w - 12, cy, 15, 16);
      T(ctx, cTxt, x + w - 22, cy + 1, sz, '#ffe14d', { align: 'right', lw: 3, shadow: false });
      y += rh + gap;
    }
    return y;
  }

  /* ---- orta üst: moda özel bilgi (Altın Avı geri sayımı, eleme kapısı). Döner: sonraki y ---- */
  function drawModeBar(ctx, P, y) {
    const m = gMode();
    if (m === 'coins') return drawCoinTimer(ctx, y);
    if (m === 'elim') return drawElimBar(ctx, P, y);
    return y;
  }
  function drawCoinTimer(ctx, y) {
    const tl = FM.game && typeof FM.game.timeLeft === 'function' ? FM.game.timeLeft() : null;
    if (tl == null) return y;
    const urgent = tl <= 10 && FM.S.mode === 'race', frac = tl - Math.floor(tl);
    const sz = Lo.compact ? 25 : 29, h = sz + 11;
    const txt = fmtTime(Math.ceil(tl));
    const w = tw(ctx, '0:00', sz) + 58;
    const pop = urgent && tl > 0 && frac > .72 ? 1 + .22 * Math.pow((frac - .72) / .28, 2) : 1;
    const flash = urgent ? .5 + .5 * Math.sin(H.t * 12) : 0;
    ctx.save(); ctx.translate(Lo.W / 2, y + h / 2); ctx.scale(pop, pop);
    if (urgent) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .25 + .3 * flash;
      drawSpr(ctx, gfx.glowSprite('#ff4d5e', 60), 0, 0, 1.2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    pill(ctx, -w / 2, -h / 2, w, h, urgent ? { top: gfx.mix('#ff5a5a', '#ffc0c0', flash * .5), bot: '#a3122f', lw: 2.8 } : { top: 'rgba(122,78,12,.95)', bot: 'rgba(52,30,4,.95)', lw: 2.8, border: OUT });
    drawIcon(ctx, 'clock', -w / 2 + 19, 0, h - 8, 34);
    T(ctx, txt, 13, 1, sz, urgent ? '#ffffff' : '#ffe14d', { lw: Math.max(4, sz * .2) });
    ctx.restore();
    return y + h + 8;
  }
  function drawElimBar(ctx, P, y) {
    const S = FM.S, G0 = (S.L && S.L.gates) || [];
    const act = G0.filter(g => g && !g.off);
    if (!act.length) return y;
    const alive = S.racers.filter(r => !r.out);
    const me = isGhost(P) ? null : P;
    let idx = -1;
    for (let i = 0; i < act.length; i++) if (!act[i].done) { idx = i; break; }
    const g = idx >= 0 ? act[idx] : null;
    let txt, style = 'n';
    if (!g) txt = me && (me.out || me.finished) ? 'Tüm kapılar geçildi' : 'Kapı kalmadı — bitişe koş!';
    else {
      const gb = 1 << g.n;
      const left = alive.filter(r => !(r.gates & gb));
      if (!me || me.out) txt = 'KAPI ' + (idx + 1) + '/' + act.length + ' · ' + (alive.length - left.length) + '/' + alive.length + ' geçti';
      else if (me.finished) txt = 'Bitirdin — güvendesin';
      else if (me.gates & gb) { txt = 'GEÇTİN! ' + left.length + ' kişi bekleniyor'; style = 'ok'; }
      else {
        const m = Math.max(0, Math.round((g.x - (me.x + (me.w || 28) / 2)) / 30));
        txt = 'KAPI ' + (idx + 1) + '/' + act.length + ' · ' + m + ' m';
        if (left.length < alive.length) {                // biri geçti: geride kalan k kişiden misin?
          let gl = 0; for (const q of act) if (!q.done) gl++;
          const k = Math.max(1, Math.floor((alive.length - 1) / Math.max(1, gl)));
          const order = left.slice().sort((a, b) => a.x - b.x);
          if (order.indexOf(me) >= 0 && order.indexOf(me) < k) { txt = 'HIZLAN! Elenmek üzeresin · ' + m + ' m'; style = 'bad'; }
        }
      }
    }
    const sz = Lo.compact ? 14 : 15, h = 27;
    const kTxt = 'KALAN ' + alive.length;
    const tw1 = tw(ctx, txt, sz), kw = tw(ctx, kTxt, sz - 1.5) + 30;
    const w = 12 + 22 + 6 + tw1 + 10 + kw + 4;
    const x = Lo.W / 2 - w / 2, cy = y + h / 2;
    const flash = style === 'bad' ? .5 + .5 * Math.sin(H.t * 12) : 0;
    const pst = style === 'bad' ? { top: gfx.mix('#ff5a5a', '#ffb0b0', flash * .5), bot: '#a3122f', lw: 2.6 }
      : style === 'ok' ? { top: '#4cc47a', bot: '#1c6c3a', lw: 2.6 } : { top: 'rgba(44,32,92,.94)', bot: 'rgba(20,14,46,.94)', lw: 2.6 };
    pill(ctx, x, y, w, h, pst);
    gateGlyph(ctx, x + 12 + 11, cy + 8, 19, style === 'ok' ? '#ffffff' : g ? '#5ee07a' : '#ffd23f');
    T(ctx, txt, x + 12 + 22 + 6, cy + 1, sz, '#ffffff', { align: 'left', lw: 3.4 });
    const kx = x + w - 4 - kw, kh = h - 7;
    rr(ctx, kx, cy - kh / 2, kw, kh, kh / 2);
    ctx.fillStyle = lg(ctx, 0, cy - kh / 2, 0, cy + kh / 2, [0, '#ff6a7a', 1, '#a3122f']); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
    personGlyph(ctx, kx + 12, cy, 11, '#ffffff');
    T(ctx, kTxt, kx + 21, cy + 1, sz - 1.5, '#ffffff', { align: 'left', lw: 3, shadow: false });
    return y + h + 8;
  }

  /* ---- eleme bandı: "SONUNCU: X ELENDİ!" (kapı kapanınca) ---- */
  function drawElimBand(ctx) {
    const b = EV.elim;
    if (!b || !b.names.length) return;
    const e = H.t - b.t, D = 2.8;
    if (e < 0 || e > D) return;
    const a = clamp(Math.min(e / .15, (D - e) / .4), 0, 1);
    const s = e < .35 ? .5 + .5 * ease.outBack(clamp(e / .35, 0, 1), 2.2) : 1;
    const sz = Lo.compact ? 21 : 24;
    let txt;
    if (b.names.length > 1) {
      txt = 'ELENDİ: ' + b.names.map(n => upTR(n)).join(', ');
      if (tw(ctx, txt, sz) > Lo.W * .62) txt = b.names.length + ' KİŞİ ELENDİ!';
    } else txt = 'SONUNCU: ' + upTR(clip(ctx, b.names[0], sz, Lo.W * .3)) + ' ELENDİ!';
    ctx.save(); ctx.translate(Lo.W / 2, Lo.H * .33); ctx.scale(s, s);
    ribbon(ctx, 0, 0, txt, '#e0313f', sz, a);
    ctx.restore();
  }
  /* ---- Kaos: meteor yağmuru bandı + iniş noktası uyarıları (ekran dışındakiler için kenar oku) ---- */
  function drawMeteorWarn(ctx) {
    const S = FM.S, V = FM.view, cam = S.cam || { x: 0, y: 0 }, hs = Lo.hs || 1;
    const e0 = H.t - EV.meteor;
    if (e0 >= 0 && e0 < 2) {
      const a = clamp(Math.min(e0 / .12, (2 - e0) / .4), 0, 1);
      const s = e0 < .3 ? .5 + .5 * ease.outBack(clamp(e0 / .3, 0, 1), 2.4) : 1;
      ctx.save(); ctx.translate(Lo.W / 2 + Math.sin(H.t * 40) * (e0 < .5 ? 2 : 0), Lo.H * .27); ctx.scale(s, s);
      ribbon(ctx, 0, 0, 'METEOR YAĞMURU!', '#ff6a1a', Lo.compact ? 21 : 24, a);
      ctx.restore();
    }
    let n = 0;
    for (const e of S.ents) {
      if (!e || e.type !== 'meteor' || !(e.t > 0)) continue;
      const sx = (e.x - cam.x) / hs, sy = (e.y - cam.y) / hs;
      if (sx < -30 || sx > Lo.W + 900 / hs) continue;
      const u = clamp(1 - e.t / (e.max || 1.25), 0, 1);
      const blink = Math.sin(H.t * (10 + u * 26)) > -.2 ? 1 : .45;
      const off = sx > Lo.W - Lo.padR - 18;
      const x = clamp(sx, Lo.padL + 18, Lo.W - Lo.padR - 18);
      const y = clamp(sy - 120 / hs, Lo.padT + 96, Lo.H - Lo.padB - 60);
      ctx.save(); ctx.globalAlpha = blink; ctx.translate(x, y);
      if (off) {                                       // sağ kenarda ok
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -13); ctx.lineTo(-6, 13); ctx.closePath();
        ctx.fillStyle = '#ff4d1a'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
        ctx.translate(-22, 0);
      }
      const r = 13 + u * 3;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .95, r * .72); ctx.lineTo(-r * .95, r * .72); ctx.closePath();
      ctx.fillStyle = lg(ctx, 0, -r, 0, r, [0, '#ffe066', 1, '#ff7a1a']); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      T(ctx, '!', 0, r * .18, r * 1.1, '#ffffff', { lw: 3.4, shadow: false });
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,90,40,' + (.85 * (1 - u)).toFixed(3) + ')';
      circ(ctx, 0, 0, r + 6 + (1 - u) * 14); ctx.stroke();
      ctx.restore();
      if (++n >= 6) break;
    }
    ctx.globalAlpha = 1;
  }
  /* ---- elenen / izleyici ekranı ---- */
  function drawSpectate(ctx, P) {
    const S = FM.S, ghost = isGhost(P);
    if (!ghost && P.out) {                             // ilk anlar: büyük "ELENDİN!"
      const e = S.raceT - (P.outT || 0);
      if (e >= 0 && e < 2.8) {
        const a = clamp(Math.min(e / .15, (2.8 - e) / .45), 0, 1);
        const s = e < .45 ? ease.outBack(clamp(e / .45, 0, 1), 2.4) : 1;
        const cx = Lo.W / 2, cy = Lo.H * .34;
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = rg(ctx, cx, cy, 10, cx, cy, 220, [0, 'rgba(60,0,10,.55)', 1, 'rgba(60,0,10,0)']);
        circ(ctx, cx, cy, 220); ctx.fill();
        ctx.restore();
        ctx.save(); ctx.translate(cx, cy + 22); ctx.scale(s, s);
        ribbon(ctx, 0, 0, 'ELENDİN!', '#e0313f', Lo.compact ? 30 : 34, a);
        ctx.restore();
        ctx.globalAlpha = a;
        T(ctx, 'Eleme kapısında geride kaldın', cx, cy + 66, 15, '#ffd0d6', { lw: 3.6 });
        ctx.globalAlpha = 1;
      }
    }
    const tgt = S.spec;
    // alt orta: "İZLİYORSUN: X"
    const sz = Lo.compact ? 15 : 16, h = 32;
    const nm = tgt ? clip(ctx, tgt.name || tgt.id, sz, 170) : '';
    const txt = tgt ? 'İZLİYORSUN: ' + nm : 'İZLİYORSUN';
    const sub = ghost ? 'Sonraki turda sen de yarışacaksın' : (gMode() === 'elim' ? 'Elendin — tur bitince sonuçlar gelecek' : '');
    const w = tw(ctx, txt, sz) + (tgt ? 48 : 26);
    const x = Lo.W / 2 - w / 2, y = Lo.H - Lo.padB - h - (sub ? 22 : 6);
    pill(ctx, x, y, w, h, { top: 'rgba(52,36,110,.94)', bot: 'rgba(22,14,52,.94)', lw: 2.6 });
    let tx = x + 13;
    if (tgt) {
      ctx.fillStyle = OUT; circ(ctx, x + 19, y + h / 2, 12.5); ctx.fill();
      drawPortrait(ctx, tgt, x + 19, y + h / 2, 11);
      tx = x + 36;
    }
    T(ctx, txt, tx, y + h / 2 + 1, sz, '#ffffff', { align: 'left', lw: 3.6 });
    if (sub) T(ctx, sub, Lo.W / 2, y + h + 12, 12.5, '#d9c9ff', { lw: 3 });
  }

  /* ---- orta yığın: kalan süre, bitirdin hapı, bildirimler ---- */
  function drawCenter(ctx, P, y0) {
    const S = FM.S, cx = Lo.W / 2;
    let y = y0 == null ? Lo.padT + 72 : y0;
    const coinsM = gMode() === 'coins';
    if (S.endTimer != null && S.mode === 'race') {
      const et = Math.max(0, S.endTimer), n = Math.ceil(et), frac = et - Math.floor(et);
      const urgent = n <= 3;
      const pop = frac > .78 ? 1 + .18 * Math.pow((frac - .78) / .22, 2) : 1;
      const txt = 'Kalan süre: ' + n, sz = 18;
      const w = tw(ctx, txt, sz) + 46, h = 32;
      ctx.save(); ctx.translate(cx, y); ctx.scale(pop, pop);
      const flash = urgent ? .5 + .5 * Math.sin(H.t * 14) : 0;
      pill(ctx, -w / 2, -h / 2, w, h, { top: gfx.mix('#ff5a5a', '#ffb0b0', flash * .5), bot: '#a3122f' });
      drawIcon(ctx, 'clock', -w / 2 + 17, 0, 22, 22);
      T(ctx, txt, 11, 1, sz, '#ffffff', { lw: 4 });
      ctx.restore();
      y += h + 8;
    }
    if (P.finished && !isGhost(P) && S.mode === 'race' && S.raceT - (P.ftime || 0) >= 3) {
      const txt = coinsM ? 'Bitirdin! Altının: ' + (P.coins | 0) : 'Bitirdin! ' + P.place + '. oldun', sz = 16, w = tw(ctx, txt, sz) + 30, h = 28;
      pill(ctx, cx - w / 2, y - h / 2, w, h, { top: '#ffe066', bot: '#e08a00' });
      T(ctx, txt, cx, y + 1, sz, '#ffffff', { lw: 3.8 });
      y += h + 8;
    }
    // 10 kişide bildirim kalabalığı: en yeni 3 tanesi; eleme bildirimlerini eleme bandı/ekranı gösteriyor
    const list = [];
    const cMode = modeInfo(gMode());
    const quiet = P.out && !isGhost(P) && S.raceT - (P.outT || 0) < 2.8;   // "ELENDİN!" ekranı sırasında bildirim yok
    for (const t of quiet ? [] : S.toasts) {
      if (!t || !t.m) continue;
      const m = String(t.m);
      if (m === 'KOŞ!') continue;
      if (S.mode === 'count' && S.L && m === S.L.theme.n) continue;
      if (m === 'ELENDİN!' || / elendi!$/.test(m)) continue;
      if (S.mode === 'count' && cMode && m === cMode.n) continue;      // mod adı geri sayım pankartında
      list.push(t);
    }
    for (const t of list.length > 3 ? list.slice(-3) : list) {
      const max = t.max || 2.6, age = max - t.t;
      const a = clamp(Math.min(age / .16, t.t / .4), 0, 1);
      if (a <= 0) continue;
      const pop = age < .3 ? .6 + .4 * ease.outBack(clamp(age / .3, 0, 1), 2.4) : 1;
      const sz = 19, h = 34, txt = String(t.m);
      const w = tw(ctx, txt, sz) + 32;
      const yy = y - (1 - ease.outCubic(clamp(age / .25, 0, 1))) * 16;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, yy); ctx.scale(pop, pop);
      pill(ctx, -w / 2, -h / 2, w, h, { top: 'rgba(44,32,92,.92)', bot: 'rgba(20,14,46,.92)' });
      const col = legible(t.col || '#ffffff');
      T(ctx, txt, 0, 1, sz, col, { lw: 4.2 });
      ctx.restore();
      y += h + 6;
    }
  }

  /* ---- geri sayım ---- */
  const CD_COL = {
    3: ['#ffe0e0', '#ff4d5e', '#a3122f'],
    2: ['#fff3c4', '#ffb020', '#b85a00'],
    1: ['#dcffdc', '#45d16a', '#137a36'],
    0: ['#e6fcff', '#36c9ff', '#1257b8']
  };
  function bigWord(ctx, str, x, y, size, cols, lt, holdEnd) {
    const end = holdEnd || .8;
    let s, a;
    const u1 = clamp(lt / .22, 0, 1);
    s = 1 + 1.3 * (1 - ease.outBack(u1, 2.6));
    a = clamp(lt / .1, 0, 1);
    if (lt > end) { const u2 = clamp((lt - end) / (1 - end), 0, 1); s *= 1 + .35 * u2; a *= 1 - u2; }
    if (a <= 0.001) return;
    const sh = Math.max(0, s);
    // ışınlar + koyu spot
    ctx.save(); ctx.globalAlpha = a * .55;
    ctx.fillStyle = rg(ctx, x, y, 10, x, y, size * 1.3, [0, 'rgba(10,5,30,.55)', 1, 'rgba(10,5,30,0)']);
    circ(ctx, x, y, size * 1.3); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .3;
    ctx.translate(x, y); ctx.rotate((FM.S.T || 0) * .5); ctx.scale(size / 300 * 1.25 * sh, size / 300 * 1.25 * sh);
    ctx.drawImage(raysSprite(cols[1]).c, -300, -300, 600, 600);
    ctx.restore();
    // halka patlaması
    if (lt > .14 && lt < .8) {
      const u = (lt - .14) / .66;
      ctx.save(); ctx.globalAlpha = (1 - u) * .9 * a;
      ctx.strokeStyle = cols[0]; ctx.lineWidth = 14 * (1 - u) + 1;
      circ(ctx, x, y, size * .45 + u * size * 1.1); ctx.stroke();
      ctx.strokeStyle = cols[1]; ctx.lineWidth = 6 * (1 - u) + .5;
      circ(ctx, x, y, size * .35 + u * size * .8); ctx.stroke();
      ctx.restore();
    }
    // yazı
    ctx.save(); ctx.translate(x, y); ctx.scale(sh, sh); ctx.globalAlpha = a;
    ctx.font = size + 'px ' + FM.FONT_H; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(10,5,30,.5)'; ctx.fillText(str, 0, size * .08);
    ctx.lineWidth = size * .2; ctx.strokeStyle = OUT; ctx.strokeText(str, 0, 0);
    ctx.lineWidth = size * .09; ctx.strokeStyle = cols[2]; ctx.strokeText(str, 0, 0);
    ctx.fillStyle = lg(ctx, 0, -size * .42, 0, size * .42, [0, '#ffffff', .2, cols[0], .5, cols[0], .52, cols[1], 1, gfx.shade(cols[1], -.2)]);
    ctx.fillText(str, 0, 0);
    ctx.save(); ctx.beginPath(); ctx.rect(-size * 2, -size * .6, size * 4, size * .36); ctx.clip();
    ctx.globalAlpha = a * .35; ctx.fillStyle = '#ffffff'; ctx.fillText(str, 0, 0);
    ctx.restore();
    ctx.restore();
  }
  /** geri sayım yerleşimi: pankart ilerleme çubuğunun altında, rakam ekrana sığacak boyutta */
  function cdLayout() {
    const by = Math.max(Lo.H * .2, Lo.padT + 30 + 84);
    const size = Math.min(170, Lo.H * .34);
    const cy = Math.max(Lo.H * .45, by + 40 + size * .5) + 22;   // +22: kurdelenin altındaki mod/harita açıklama satırına yer
    return { by, cy, size };
  }
  function drawRoundBanner(ctx, age, fadeOut) {
    const S = FM.S, th = (S.L && S.L.theme) || { n: '', id: '' };
    const a = clamp(age / .25, 0, 1) * fadeOut;
    if (a <= 0) return;
    const u = ease.outBack(clamp(age / .5, 0, 1), 2);
    const y = cdLayout().by - (1 - u) * 50;
    const mid = gMode(), mi = modeInfo(mid), mcol = MODE_COL[mid] || '#8b5cf6';
    // üstte: [TUR 1 / 3] [MOD ADI] — altta harita kurdelesi — en altta modun kuralı (klasikte haritanın mekaniği)
    const tTxt = 'TUR ' + S.round + ' / ' + S.ROUNDS, mTxt = mi ? upTR(mi.n) : '';
    const sz = 15, h = 25, w1 = tw(ctx, tTxt, sz) + 28, w2 = mTxt ? tw(ctx, mTxt, sz) + 28 : 0, gap = w2 ? 8 : 0;
    const x0 = Lo.W / 2 - (w1 + gap + w2) / 2;
    ctx.save(); ctx.globalAlpha = a;
    pill(ctx, x0, y - 44, w1, h, { top: 'rgba(30,20,60,.92)', bot: 'rgba(14,9,32,.92)' });
    T(ctx, tTxt, x0 + w1 / 2, y - 44 + h / 2 + 1, sz, '#ffe14d', { lw: 3.6 });
    if (w2) {
      pill(ctx, x0 + w1 + gap, y - 44, w2, h, { top: gfx.shade(mcol, .25), bot: gfx.shade(mcol, -.35) });
      T(ctx, mTxt, x0 + w1 + gap + w2 / 2, y - 44 + h / 2 + 1, sz, '#ffffff', { lw: 3.6 });
    }
    ctx.restore();
    ribbon(ctx, Lo.W / 2, y, th.n || '', themeAcc(th), 27, a);
    let desc = mid !== 'classic' && mi && mi.d ? String(mi.d) : String(th.mech || '');
    const cut = desc.indexOf('. ');
    if (cut > 0) desc = desc.slice(0, cut + 1);
    if (desc) {
      const dsz = 13, dh = 22;
      desc = clip(ctx, desc, dsz, Lo.W - 60);
      const dw = tw(ctx, desc, dsz) + 26;
      ctx.save(); ctx.globalAlpha = a;
      pill(ctx, Lo.W / 2 - dw / 2, y + 40, dw, dh, { top: 'rgba(30,20,60,.88)', bot: 'rgba(14,9,32,.88)', lw: 2 });
      T(ctx, desc, Lo.W / 2, y + 40 + dh / 2 + 1, dsz, '#ffffff', { lw: 3.2, shadow: false });
      ctx.restore();
    }
  }
  function drawCountdown(ctx) {
    const S = FM.S, ct = S.countT;
    const n = Math.max(0, Math.ceil(ct - .6));
    const L = cdLayout(), cx = Lo.W / 2;
    drawRoundBanner(ctx, 3.6 - ct, clamp((ct - .45) / .3, 0, 1));
    if (n >= 1 && n <= 3) bigWord(ctx, String(n), cx, L.cy, L.size, CD_COL[n], clamp((n + .6) - ct, 0, 1), .82);
    else if (n === 0) goWord(ctx, clamp(.6 - ct, 0, .6));
    else bigWord(ctx, String(n), cx, L.cy, L.size, CD_COL[3], clamp((n + .6) - ct, 0, 1), .82);
  }
  const GO_LEN = 2.0;
  function goWord(ctx, gt) {
    // gt: 0..GO_LEN (0-.6 geri sayımın sonu, sonrası yarışın ilk saniyeleri)
    if (gt < 0 || gt > GO_LEN) return;
    const L = cdLayout();
    bigWord(ctx, 'KOŞ!', Lo.W / 2, L.cy, L.size * .82, CD_COL[0], gt / GO_LEN, .55);
  }
  function drawGo(ctx) {
    const S = FM.S;
    if (S.mode !== 'race') return;
    for (const t of S.toasts) if (t && t.m === 'KOŞ!') { goWord(ctx, .6 + ((t.max || 2.6) - t.t)); return; }
  }

  /* ---- yeniden doğma ---- */
  function drawRespawn(ctx, P) {
    const S = FM.S, cx = Lo.W / 2, cy = Lo.H * .37;
    const age = 1.1 - P.dead, prog = clamp(age / 1.1, 0, 1);
    const a = clamp(age / .18, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    ctx.save(); ctx.translate(cx, cy - 8); ctx.scale(1.75, .62);
    ctx.fillStyle = rg(ctx, 0, 0, 5, 0, 0, 120, [0, 'rgba(10,5,25,.5)', .6, 'rgba(10,5,25,.3)', 1, 'rgba(10,5,25,0)']);
    circ(ctx, 0, 0, 120); ctx.fill();
    ctx.restore();
    // katil satırı
    let f = null;
    for (const q of S.feed) if (q && q.b === P.name) { f = q; break; }
    if (f && f.a) {
      const self = f.a === P.name;
      const txt = self ? 'Kendi tuzağına düştün!' : f.a + ' seni hakladı!';
      const sz = 17, w = tw(ctx, txt, sz) + 30;
      drawFeedIcon(ctx, f.icon, cx - w / 2, cy - 36, 26);
      T(ctx, txt, cx + 6, cy - 35, sz, self ? '#ffd0a0' : '#ff8a96', { lw: 4 });
    }
    const base = 'Yeniden doğuyorsun', sz = 27;
    const bw = tw(ctx, base, sz), dw = tw(ctx, '...', sz);
    const x0 = cx - (bw + dw) / 2;
    T(ctx, base, x0, cy, sz, '#ffffff', { align: 'left', lw: 5.5 });
    const dots = 1 + (Math.floor(H.t * 3) % 3);
    T(ctx, '...'.slice(0, dots), x0 + bw, cy, sz, '#ffffff', { align: 'left', lw: 5.5 });
    const bw2 = 190, bh = 12, by = cy + 26;
    ctx.fillStyle = OUT; rr(ctx, cx - bw2 / 2 - 3, by - bh / 2 - 3, bw2 + 6, bh + 6, (bh + 6) / 2); ctx.fill();
    ctx.fillStyle = '#231a4c'; rr(ctx, cx - bw2 / 2, by - bh / 2, bw2, bh, bh / 2); ctx.fill();
    if (prog > .02) {
      ctx.fillStyle = lg(ctx, 0, by - bh / 2, 0, by + bh / 2, [0, '#c8fbff', .5, '#36c9ff', 1, '#1a6fd1']);
      rr(ctx, cx - bw2 / 2, by - bh / 2, bw2 * prog, bh, bh / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; rr(ctx, cx - bw2 / 2 + 3, by - bh / 2 + 2, Math.max(0, bw2 * prog - 6), 3, 1.5); ctx.fill();
    }
    ctx.restore();
  }

  /* ---- bitiş kutlaması ---- */
  function drawFinish(ctx, P) {
    const e = FM.S.raceT - (P.ftime || 0);
    if (e < 0 || e > 3) return;
    const cx = Lo.W / 2, cy = Lo.H * .36;
    const coinsM = gMode() === 'coins';
    // Altın Avı'nda sıra altına göre: madalya o anki altın sırası
    const real = coinsM ? (H.rk.indexOf(P) + 1 || 1) : Math.max(1, P.place | 0 || 1);
    const place = clamp(real, 1, 4), mc = MEDAL[place - 1];
    const s = e < .4 ? ease.outBack(clamp(e / .4, 0, 1), 2.4) : 1;
    const a = e > 2.5 ? clamp((3 - e) / .5, 0, 1) : 1;
    ctx.save(); ctx.globalAlpha = a;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .45;
    ctx.translate(cx, cy); ctx.rotate(H.t * .4); ctx.scale(.6 * s, .6 * s);
    ctx.drawImage(raysSprite(mc[1]).c, -300, -300, 600, 600);
    ctx.restore();
    ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(8,4,24,.4)'; circ(ctx, 0, 5, 50); ctx.fill();
    ctx.fillStyle = OUT; circ(ctx, 0, 0, 50); ctx.fill();
    ctx.fillStyle = lg(ctx, 0, -46, 0, 46, [0, mc[0], .5, mc[1], 1, mc[2]]); circ(ctx, 0, 0, 46.5); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.45)'; circ(ctx, 0, 0, 39); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = OUT; circ(ctx, 0, 0, 36); ctx.stroke();
    T(ctx, real + '.', -2, 0, real >= 10 ? 38 : 46, '#ffffff', { lw: 8 });
    ctx.restore();
    const txt = coinsM ? 'BİTİRDİN! +' + (FM.COINS_FINISH || 15) + ' ALTIN' : place === 1 ? (P.out ? 'BİTİRDİN!' : 'BİRİNCİSİN!') : 'BİTİRDİN!';
    ribbon(ctx, cx, cy + 66, txt, coinsM ? '#f0a20f' : place === 1 ? '#f0a20f' : '#38b764', 24, a);
  }

  function drawRoundOver(ctx) {
    const e = H.t - H.modeT;
    const s = e < .4 ? ease.outBack(clamp(e / .4, 0, 1), 2.4) : 1;
    ctx.save(); ctx.translate(Lo.W / 2, Lo.H * .4); ctx.scale(s, s);
    ribbon(ctx, 0, 0, 'TUR BİTTİ!', '#8b5cf6', 34, 1);
    ctx.restore();
  }

  function drawHints(ctx) {
    const S = FM.S, a = clamp(Math.min((3.6 - S.countT) / .3, (S.countT + .1) / .3), 0, 1);
    if (a <= 0) return;
    const items = [['Boşluk', 'Zıpla'], ['↓', 'Kay'], ['E', 'Eşya'], ['Q', 'Güç']];
    const ksz = 20, lsz = 15, gap = 18;
    let tot = 0;
    const ws = items.map(([k, l]) => { const kw = Math.max(ksz, tw(ctx, k, ksz * .62) + ksz * .55); const lw = tw(ctx, l, lsz, FM.FONT_B, 700); const w = kw + 7 + lw; tot += w; return [kw, lw, w]; });
    tot += gap * (items.length - 1) + 32;
    const y = Lo.H - Lo.padB - 26, x0 = Lo.W / 2 - tot / 2;
    ctx.save(); ctx.globalAlpha = a;
    pill(ctx, x0, y - 19, tot, 38, { top: 'rgba(30,20,60,.75)', bot: 'rgba(14,9,32,.75)' });
    let x = x0 + 16;
    items.forEach(([k, l], i) => {
      const [kw, , w] = ws[i];
      keycap(ctx, x + kw / 2, y - 1, k, ksz);
      gfx.text(ctx, l, x + kw + 7, y, lsz, '#ffffff', { align: 'left', font: FM.FONT_B, weight: 700, stroke: OUT, lw: 3.4, shadow: false });
      x += w + gap;
    });
    ctx.restore();
  }

  /* =====================================================================
     5) ANA HUD ÇİZİMİ
     ===================================================================== */
  R.drawHUD = function (ctx) {
    const S = FM.S, P = S.player;
    if (!P || !S.L || !ctx) return;
    layout();
    RES = (FM.view.S || 1) * Lo.hs;
    let rk;
    try { rk = (FM.game && typeof FM.game.ranking === 'function') ? FM.game.ranking() : S.racers.slice(); } catch (e) { rk = S.racers.slice(); }
    H.rk = rk;
    track(P, rk);
    H.dd = clamp(H.t - H.lastDraw, 0, .1); H.lastDraw = H.t;
    ctx.save();
    try {
      ctx.scale(Lo.hs, Lo.hs);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const ghost = isGhost(P), mode = gMode();
      if (Lo.compact) drawCompactHUD(ctx, P, rk);
      else {
        if (!ghost) {
          if (mode === 'pure') { ctx.save(); ctx.translate(-88, 0); drawPower(ctx, P, Lo.padL + 88); ctx.restore(); }   // Saf Parkur: eşya yuvası yok
          else { const pillR = drawItemSlot(ctx, P); drawPower(ctx, P, pillR); }
          drawEffects(ctx, P);
        }
        drawProgress(ctx, rk);
        if (!ghost) drawRank(ctx, rk.indexOf(P) + 1 || 1, rk.length || 4);
        let fy = drawInfo(ctx, P);
        if (mode === 'coins') fy = drawCoinBoard(ctx, P, rk, Lo.W - Lo.padR, fy - 8) + 12;
        drawFeed(ctx, fy);
      }
      let cy0 = Lo.padT + 72;
      if (S.mode === 'race' || S.mode === 'end') {
        const mb0 = Lo.padT + 64, mb1 = drawModeBar(ctx, P, mb0);
        if (mb1 > mb0) cy0 = mb1 + 14;
      }
      drawCenter(ctx, P, cy0);
      if (S.mode === 'race') { drawMeteorWarn(ctx); drawElimBand(ctx); }
      if (S.mode === 'count') drawCountdown(ctx);
      else drawGo(ctx);
      if (S.mode === 'race' && P.dead > 0 && !P.finished && !P.out && !ghost) drawRespawn(ctx, P);
      if (S.mode === 'race' && P.finished && !ghost) drawFinish(ctx, P);
      if ((S.mode === 'race' || S.mode === 'end') && (P.out || ghost)) drawSpectate(ctx, P);
      if (S.mode === 'end') drawRoundOver(ctx);
      if (S.mode === 'count' && !Lo.touch) drawHints(ctx);
    } finally {
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* =====================================================================
     6) KÜRSÜ (PODIUM) SAHNESİ
     ===================================================================== */
  const STEP_COL = [
    ['#fff7c8', '#ffd84a', '#f0a20f', '#a85f00'],
    ['#ffffff', '#e1e8f0', '#a9b5c6', '#66728a'],
    ['#ffe2c6', '#f2a35e', '#c4712c', '#7a3c10']
  ];
  const DROP_T = [1.35, 1.15, 1.0, .85, .85, .85];   // sıraya göre (0 = birinci) karakter düşüş zamanı
  const RISE_T = [.6, .3, .45];                        // basamak yükselme zamanları
  const CROWN_T = 2.0, BURST_T = 2.05;
  const CHAR_H = 60;                                   // drawCharacter ölçek 1 iken ayaktan kafa üstüne yaklaşık yükseklik

  function podVK() { const V = FM.view; return (V.VH || 540) / 540; }
  function podGeo() {
    const V = FM.view, W = (V.VW || 960) / podVK();
    const cssH = (V.H || 540) / (V.dpr || 1);
    const tm = cssH >= 640 ? 1 : clamp(1 + (640 - cssH) / 250 * .18, 1, 1.18);
    const stageW = W * .58;
    // 5+ kişi: ilk 3 kürsüde, 4. ve sonrası kürsünün sağında kompakt sıralı liste (sonuç paneline taşmaz)
    const N = podRanking().length, list = N > 4;
    const listW = list ? clamp(stageW * .4, 200, 290) : 0;
    const areaW = stageW - listW;
    const ps = list ? clamp(areaW / 560, .6, 1) : clamp(stageW / 590, .74, 1.05);
    const sw = 124 * ps;
    const cx = list ? areaW / 2 + 6 * ps : stageW / 2 - 26 * ps;
    const floorY = 452;
    const hts = [150 * ps, 106 * ps, 76 * ps];
    const xs = [cx, cx - sw, cx + sw];
    const x4 = cx + sw * 1.5 + 66 * ps;
    const rx = list ? sw * 1.5 + 44 * ps : sw * 1.5 + 120 * ps, ry = 23 * ps;
    const scx = list ? cx : cx + 34 * ps;
    // short: telefon yüksekliği — sağdaki sonuç paneli 'TUR x / y' kurdelesini zaten gösteriyor
    return { W, stageW, ps, sw, cx, floorY, hts, xs, x4, rx, ry, scx, tm, short: cssH < 480, list, N, listX: areaW + 4, listW: listW - 30 };
  }
  function podRanking() {
    const S = FM.S, res = S.lastResult;
    if (res && Array.isArray(res.ranking) && res.ranking.length) return res.ranking.filter(Boolean);
    return S.racers.slice().sort((a, b) => (a.place || 9) - (b.place || 9));
  }
  function slotPos(G, i) {
    // i: sıra indeksi (0 = birinci). Döner: {x, footY, stepTop, h}
    if (i < 3) {
      const h = G.hts[i], base = G.floorY + 6 * G.ps;
      return { x: G.xs[i], base, h, foot: base - h + 9 * G.ps };
    }
    const k = i - 3;
    return { x: G.x4 + k * 62 * G.ps, base: G.floorY + 12 * G.ps, h: 0, foot: G.floorY + 12 * G.ps + k * 4 };
  }
  function stepSprite(i, sw, h, ps) {
    const key = 'step' + i + ':' + Math.round(sw) + ':' + Math.round(h);
    return hspr(key, sw + 16, h + 16, sw / 2 + 8, h + 8, g => {
      const M = STEP_COL[i], x0 = -sw / 2, tf = 15 * ps;
      g.fillStyle = 'rgba(8,4,24,.35)'; rr(g, x0 + 4, -h + 4, sw, h, 9); g.fill();
      g.fillStyle = OUT; rr(g, x0 - 3, -h - 3, sw + 6, h + 6, 11); g.fill();
      g.fillStyle = lg(g, x0, 0, x0 + sw, 0, [0, M[3], .1, M[2], .3, M[1], .46, M[0], .6, M[1], .88, M[2], 1, M[3]]);
      rr(g, x0, -h, sw, h, 8); g.fill();
      // üst yüz
      g.fillStyle = lg(g, 0, -h, 0, -h + tf, [0, '#ffffff', 1, M[0]]);
      rr(g, x0, -h, sw, tf, 8); g.fill();
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x0 + 2, -h + tf - 1, sw - 4, 4);
      g.strokeStyle = OUT; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, -h + tf); g.lineTo(x0 + sw, -h + tf); g.stroke();
      // iç pano
      const px = x0 + 11, py = -h + tf + 10, pw = sw - 22, ph = h - tf - 20;
      if (ph > 12) {
        g.fillStyle = lg(g, 0, py, 0, py + ph, [0, gfx.shade(M[2], -.12), 1, gfx.shade(M[1], -.05)]); rr(g, px, py, pw, ph, 7); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; rr(g, px, py, pw, ph, 7); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(px + 6, py + ph + 1.5); g.lineTo(px + pw - 6, py + ph + 1.5); g.stroke();
        const ns = Math.min(ph * .82, pw * .62, 78 * ps);
        T(g, String(i + 1), 0, py + ph / 2 + ns * .04, ns, '#ffffff', { lw: Math.max(4, ns * .16), shadowCol: 'rgba(0,0,0,.35)' });
        if (i === 0) for (const s of [-1, 1]) { g.fillStyle = '#fffbe0'; starPath(g, s * (pw / 2 - 12), py + 12, 5, 6, 2.6, -Math.PI / 2); g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(120,60,0,.6)'; g.stroke(); }
      }
      g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(x0 + sw * .2, -h + tf + 3, 5, h - tf - 8);
      g.strokeStyle = OUT; g.lineWidth = 3; rr(g, x0, -h, sw, h, 8); g.stroke();
    });
  }
  function stageSprite(G) {
    const rx = Math.round(G.rx), ry = G.ry, hF = 540 - G.floorY + 12;
    return hspr('stage' + rx + ':' + Math.round(ry), rx * 2 + 20, ry + hF + 20, rx + 10, ry + 10, g => {
      // ön etek (kadife perde)
      g.beginPath(); g.moveTo(-rx, 0); g.lineTo(-rx, hF); g.lineTo(rx, hF); g.lineTo(rx, 0); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI, false); g.closePath();
      g.fillStyle = lg(g, 0, 0, 0, hF, [0, '#8a1838', 1, '#3a0716']); g.fill();
      g.save(); g.clip();
      const N = Math.max(8, Math.round(rx / 18));
      const fold = g.createLinearGradient(-rx, 0, rx, 0);
      for (let i = 0; i <= N; i++) fold.addColorStop(i / N, i % 2 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.28)');
      g.fillStyle = fold; g.fillRect(-rx, 0, rx * 2, hF);
      g.fillStyle = lg(g, -rx, 0, rx, 0, [0, 'rgba(0,0,0,.55)', .2, 'rgba(0,0,0,0)', .8, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.55)']); g.fillRect(-rx, 0, rx * 2, hF);
      g.restore();
      g.strokeStyle = OUT; g.lineWidth = 3; g.beginPath(); g.moveTo(-rx, 0); g.lineTo(-rx, hF); g.moveTo(rx, 0); g.lineTo(rx, hF); g.stroke();
      // altın şerit
      g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI, false);
      g.lineWidth = 11; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 7; g.strokeStyle = '#e8a10c'; g.stroke();
      g.lineWidth = 2.4; g.strokeStyle = '#fff1a8'; g.beginPath(); g.ellipse(0, -1.5, rx, ry, 0, Math.PI * .08, Math.PI * .92, false); g.stroke();
      // püsküller
      for (let i = 1; i < 12; i++) {
        const a = Math.PI * i / 12, px = Math.cos(a) * rx, py = Math.sin(a) * ry + 4;
        g.fillStyle = OUT; poly(g, [px - 4.5, py, px + 4.5, py, px, py + 11]); g.fill();
        g.fillStyle = '#ffd23f'; poly(g, [px - 3, py + 1, px + 3, py + 1, px, py + 8.5]); g.fill();
      }
      // üst yüzey
      ell(g, 0, 0, rx, ry);
      g.fillStyle = rg(g, 0, -ry * .3, 4, 0, 0, rx, [0, '#5b4a9a', .6, '#2f2560', 1, '#1b1440']); g.fill();
      g.save(); ell(g, 0, 0, rx, ry); g.clip();
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
      for (let x = -rx; x < rx; x += 26) { g.beginPath(); g.moveTo(x, -ry); g.lineTo(x + 30, ry); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.12)'; ell(g, -rx * .25, -ry * .35, rx * .5, ry * .3); g.fill();
      g.restore();
      ell(g, 0, 0, rx, ry); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,230,160,.5)'; ell(g, 0, 0, rx - 5, ry - 3); g.stroke();
    });
  }

  /* kürsünün sabit arka katmanı (dünya arka planı + koyulaştırma + vinyet + ışık) — her karede tek drawImage */
  const podStatic = { c: null, key: '' };
  let podSerial = 0;
  function podStaticLayer(G, th) {
    const V = FM.view, S = FM.S;
    const key = podSerial + ':' + V.W + 'x' + V.H + ':' + (S.L ? S.L.seed : 0) + ':' + ((th && th.id) || '');
    if (podStatic.c && podStatic.key === key) return podStatic.c;
    const c = (podStatic.c && podStatic.c.width === V.W && podStatic.c.height === V.H) ? podStatic.c : mkCanvas(V.W, V.H);
    const g = c.getContext('2d'), W = (V.VW || 960) / podVK();
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(V.S, 0, 0, V.S, 0, 0);
    let ok = false;
    if (typeof R.drawBackground === 'function' && S.L) {
      g.save();
      try { R.drawBackground(g); ok = true; } catch (e) { ok = false; }
      g.restore();
    }
    { const vk = podVK(); g.setTransform(V.S * vk, 0, 0, V.S * vk, 0, 0); }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (!ok) {
      const sky = (th && th.sky) || ['#2b1a4a', '#5b3a8a', '#9a6ac0'];
      g.fillStyle = lg(g, 0, 0, 0, 540, [0, sky[0], .55, sky[1], 1, sky[2]]); g.fillRect(0, 0, W, 540);
    }
    g.fillStyle = lg(g, 0, 0, 0, 540, [0, 'rgba(22,10,50,.62)', .55, 'rgba(16,8,38,.72)', 1, 'rgba(8,4,22,.9)']);
    g.fillRect(0, 0, W, 540);
    const vg = g.createRadialGradient(G.cx, 300, 120, G.cx, 300, Math.max(W, 700) * .75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(5,2,15,.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, 540);
    g.globalCompositeOperation = 'lighter';
    const acc = hex6(themeAcc(th)) || '#8b5cf6';
    const glow = (x, y, r, col, a) => { g.fillStyle = rg(g, x, y, 0, x, y, r, [0, gfx.rgba(col, a), 1, gfx.rgba(col, 0)]); g.fillRect(x - r, y - r, r * 2, r * 2); };
    glow(G.cx, G.floorY - 140, 260, '#aa78ff', .44);
    glow(G.cx, G.floorY - 40, 200, acc, .32);
    g.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
    podStatic.c = c; podStatic.key = key;
    return c;
  }

  /* kürsü parçacıkları (ekran uzayında konfeti, toz, yıldız) */
  const pod = { parts: [], lastPT: -1, next: BURST_T, landed: 0, crownFx: false };
  const CONF_COLS = ['#ff3b5c', '#ffd23f', '#3ddc84', '#3b82f6', '#a855f7', '#ff8fc8', '#ffffff', '#2de2e6', '#ff9f43'];
  function podReset() { pod.parts.length = 0; pod.next = BURST_T; pod.landed = 0; pod.crownFx = false; }
  function confetti(x, y, n, ang, spread, sp) {
    for (let i = 0; i < n; i++) {
      if (pod.parts.length > 340) pod.parts.shift();
      const a = ang + (Math.random() - .5) * spread, v = sp * (.45 + Math.random() * .75);
      pod.parts.push({ k: 0, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * 6, vr: (Math.random() - .5) * 14, fl: Math.random() * 6, vf: 6 + Math.random() * 10,
        w: 6 + Math.random() * 6, h: 3.5 + Math.random() * 3, c: CONF_COLS[(Math.random() * CONF_COLS.length) | 0], life: 4 + Math.random() * 2, max: 6, ph: Math.random() * 6 });
    }
  }
  function dust(x, y, n, s) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      pod.parts.push({ k: 1, x: x + dir * Math.random() * 12 * s, y: y - Math.random() * 4, vx: dir * (60 + Math.random() * 90) * s, vy: -Math.random() * 40 * s, r: (7 + Math.random() * 6) * s, life: .5 + Math.random() * .3, max: .8 });
    }
  }
  function twinkles(x, y, n, rad) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 80 + Math.random() * 160;
      pod.parts.push({ k: 2, x: x + Math.cos(a) * rad * .3, y: y + Math.sin(a) * rad * .3, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, r: 4 + Math.random() * 5, life: .6 + Math.random() * .5, max: 1.1, rot: Math.random() * 6 });
    }
  }
  function podUpdate(dt) {
    const S = FM.S;
    if (S.mode !== 'podium') { if (pod.parts.length) pod.parts.length = 0; pod.lastPT = -1; podStatic.c = null; podStatic.key = ''; return; }
    const pt = S.podiumT || 0;
    if (pod.lastPT < 0 || pt + .001 < pod.lastPT) { podReset(); podSerial++; }
    pod.lastPT = pt;
    const G = podGeo(), rk = podRanking();
    // inişte toz
    for (let i = 0; i < rk.length && i < (G.list ? 3 : 6); i++) {
      const tl = DROP_T[i] + .22;
      if (!(pod.landed & (1 << i)) && pt >= tl) {
        pod.landed |= 1 << i;
        if (pt - tl < .4) { const sp = slotPos(G, i); dust(sp.x, sp.foot, 8, G.ps); }
      }
    }
    // taç parıltısı
    if (!pod.crownFx && pt >= CROWN_T + .25) {
      pod.crownFx = true;
      if (pt - CROWN_T < 1) { const sp = slotPos(G, 0); twinkles(sp.x, sp.foot - (CHAR_H * 1.62 + 20) * G.ps, 14, 40); }
    }
    // konfeti patlamaları
    let guard = 0;
    while (pt >= pod.next && guard++ < 50) {
      if (pt - pod.next < 1) {
        const first = pod.next === BURST_T;
        const lx = G.scx - G.rx * .92, rx = G.scx + G.rx * .92, by = G.floorY + 6;
        confetti(lx, by, first ? 70 : 40, -Math.PI / 2 + .45, .55, first ? 760 : 640);
        confetti(rx, by, first ? 70 : 40, -Math.PI / 2 - .45, .55, first ? 760 : 640);
        const sp = slotPos(G, 0);
        confetti(sp.x, sp.foot - CHAR_H * 1.62 * G.ps, first ? 40 : 18, -Math.PI / 2, 2.2, 360);
      }
      pod.next += 2.8;
    }
    // hafif sürekli yağmur
    if (pt > BURST_T && Math.random() < dt * 9) {
      const x = Math.random() * G.stageW;
      pod.parts.push({ k: 0, x, y: -10, vx: (Math.random() - .5) * 30, vy: 40 + Math.random() * 40, rot: Math.random() * 6, vr: (Math.random() - .5) * 8, fl: Math.random() * 6, vf: 5 + Math.random() * 8,
        w: 6 + Math.random() * 5, h: 3.5 + Math.random() * 2.5, c: CONF_COLS[(Math.random() * CONF_COLS.length) | 0], life: 9, max: 9, ph: Math.random() * 6 });
    }
    // güncelle
    const ps = pod.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.k === 0) {
        p.vy += 420 * dt;
        p.vx *= Math.max(0, 1 - 1.8 * dt);
        if (p.vy > 95) p.vy += (95 - p.vy) * Math.min(1, 4 * dt);
        p.x += (p.vx + Math.sin(pt * 3 + p.ph) * 28) * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt; p.fl += p.vf * dt;
        if (p.y > 560) p.life = 0;
      } else if (p.k === 1) {
        p.vx *= Math.max(0, 1 - 4 * dt); p.vy *= Math.max(0, 1 - 4 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt;
      } else {
        p.vx *= Math.max(0, 1 - 3 * dt); p.vy *= Math.max(0, 1 - 3 * dt); p.vy += 60 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += 3 * dt;
      }
      if (p.life <= 0) ps.splice(i, 1);
    }
  }
  function drawPodParts(ctx, front) {
    const ps = pod.parts;
    if (!ps.length) return;
    let m = null;
    try { m = ctx.getTransform ? ctx.getTransform() : null; } catch (e) { m = null; }
    const a = m ? m.a : (FM.view.S || 1), d = m ? m.d : (FM.view.S || 1), e = m ? m.e : 0, f = m ? m.f : 0;
    for (const p of ps) {
      if (p.k === 0) {
        if (!front) continue;
        const al = clamp(p.life / .6, 0, 1);
        const c = Math.cos(p.rot), s = Math.sin(p.rot), fy = Math.cos(p.fl);
        ctx.globalAlpha = al;
        ctx.setTransform(a * c, d * s, -a * s * fy, d * c * fy, a * p.x + e, d * p.y + f);
        ctx.fillStyle = fy > 0 ? p.c : gfx.shade(p.c, -.3);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.k === 1) {
        if (front) continue;
        ctx.setTransform(a, 0, 0, d, e, f);
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * .85;
        ctx.fillStyle = '#f3eefc'; circ(ctx, p.x, p.y, p.r); ctx.fill();
      } else {
        if (!front) continue;
        ctx.setTransform(a, 0, 0, d, e, f);
        ctx.globalAlpha = clamp(p.life / .4, 0, 1);
        ctx.globalCompositeOperation = 'lighter';
        sparkle(ctx, p.x, p.y, p.r, '#fff3b0');
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.setTransform(a, 0, 0, d, e, f);
    ctx.globalAlpha = 1;
  }

  function fallbackChar(ctx, id, x, y, sc, st, t) {
    const ch = FM.CH[id] || { col: '#999999', col2: '#555555' };
    const col = hex6(ch.col) || '#999999', col2 = hex6(ch.col2) || '#555555';
    const bob = st === 'cheer' ? Math.abs(Math.sin(t * 6)) * 6 : st === 'sad' ? 0 : Math.sin(t * 2) * 1.2;
    ctx.save(); ctx.translate(x, y - bob * sc * .5); ctx.scale(sc, sc);
    ctx.lineWidth = 2.4; ctx.strokeStyle = OUT; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (st === 'cheer') for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 10, -30); ctx.lineTo(s * 19, -50); ctx.lineWidth = 7; ctx.strokeStyle = OUT; ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke(); }
    ell(ctx, 0, -22, 15, 22); ctx.fillStyle = lg(ctx, 0, -44, 0, 0, [0, gfx.shade(col, .25), 1, gfx.shade(col, -.25)]); ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = OUT; ctx.stroke();
    ell(ctx, 0, -14, 9, 11); ctx.fillStyle = col2; ctx.fill();
    for (const s of [-1, 1]) {
      ell(ctx, s * 5.5, -31, 3.8, 4.6); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 1.2; ctx.stroke();
      circ(ctx, s * 5.5 + .6, st === 'sad' ? -29.5 : -30.5, 1.9); ctx.fillStyle = OUT; ctx.fill();
    }
    ctx.beginPath(); ctx.lineWidth = 1.6;
    if (st === 'sad') ctx.arc(0, -19, 4, Math.PI * 1.15, Math.PI * 1.85); else ctx.arc(0, -24, 4, Math.PI * .15, Math.PI * .85);
    ctx.stroke();
    ctx.restore();
  }
  function drawPodChar(ctx, r, x, y, sc, st, pt) {
    if (typeof R.drawCharacter === 'function') {
      ctx.save();
      try { R.drawCharacter(ctx, r.id, x, y, sc, { st, ph: pt * 7 + (r.idx || 0), t: pt, vy: 0 }, { skin: r.skin || 'klasik', outline: true }); }
      catch (e) { if (!drawPodChar.err) { drawPodChar.err = 1; console.error('[kürsü karakter]', e); } fallbackChar(ctx, r.id, x, y, sc, st, pt); }
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    } else fallbackChar(ctx, r.id, x, y, sc, st, pt);
  }

  function podiumScene(ctx) {
    const S = FM.S, V = FM.view, W = (V.VW || 960) / podVK();
    RES = V.S || 1;
    const res = S.lastResult || null;
    const pt = S.podiumT || 0;
    const G = podGeo(), ps = G.ps, tm = G.tm;
    const rk = podRanking();
    const th = (res && res.theme) || (S.L && S.L.theme) || FM.THEMES[0];
    // 1-2) arka plan + karartma + vinyet + sahne arkası ışık: kürsü girişinde bir kez önbelleğe çizilir
    ctx.drawImage(podStaticLayer(G, th), 0, 0, W, 540);
    // 3) dönen spot ışıkları
    const cones = [
      [G.cx - G.stageW * .48, -30, .62, '#ff8fc8', 0],
      [G.cx + G.stageW * .55, -30, -.62, '#7be3ff', 1.7],
      [G.cx - 40 * ps, -60, .05, '#fff3b0', 3.1]
    ];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, base, col, ph] of cones) {
      const ang = base + Math.sin(pt * .9 + ph) * .28;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-ang); ctx.globalAlpha = .26;
      const cs = coneSprite(col); ctx.drawImage(cs.c, -150, 0, 300, 660);
      ctx.restore();
      const hx = x + Math.tan(ang) * (G.floorY - y), hy = G.floorY;
      if (hx > -100 && hx < G.stageW + 150) {
        ctx.save(); ctx.translate(hx, hy); ctx.scale(1, .26); ctx.globalAlpha = .4;
        drawSpr(ctx, gfx.glowSprite(gfx.rgba(hex6(col), .9), 110), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
    // 4) kazanan arkası ışınlar
    const ra = clamp((pt - 1.6) / .6, 0, 1);
    if (ra > 0 && rk.length) {
      const sp = slotPos(G, 0);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .38 * ra;
      ctx.translate(sp.x, sp.foot - 70 * ps); ctx.rotate(pt * .25); ctx.scale(.85 * ps, .85 * ps);
      ctx.drawImage(raysSprite('#ffd23f').c, -300, -300, 600, 600);
      ctx.restore();
    }
    // 5) sahne
    drawSpr(ctx, stageSprite(G), G.scx, G.floorY);
    // 6) basamaklar (2., 3., 1. sırasıyla)
    for (const i of [1, 2, 0]) {
      const u = clamp((pt - RISE_T[i]) / .5, 0, 1);
      if (u <= 0) continue;
      const sy = ease.outBack(u, 1.8);
      const s = stepSprite(i, G.sw, G.hts[i], ps);
      const sp = slotPos(G, i);
      ctx.drawImage(s.c, sp.x - s.ox, sp.base - s.oy * sy, s.w, s.h * sy);
    }
    // toz (arkada)
    drawPodParts(ctx, false);
    // 7) karakterler
    const order = [];
    for (let i = rk.length - 1; i >= 0; i--) order.push(i);
    const heads = [];
    for (const i of order) {
      const r = rk[i];
      if (!r || (G.list && i >= 3)) continue;
      const sp = slotPos(G, i);
      const u = clamp((pt - (DROP_T[i] || .85)) / .6, 0, 1);
      if (u <= 0) continue;
      const dy = -(1 - ease.outBounce(u)) * 460;
      const sc = (i === 0 ? 1.62 : i < 3 ? 1.5 : 1.4) * ps;
      const st = i < 2 ? 'cheer' : i === 2 ? 'idle' : 'sad';
      // gölge
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ell(ctx, sp.x, sp.foot + 1, 20 * sc * (u > .3 ? 1 : .6), 4.5 * sc * .6); ctx.fill();
      drawPodChar(ctx, r, sp.x, sp.foot + dy, sc, u < .36 ? 'idle' : st, pt);
      heads.push({ i, r, x: sp.x, y: sp.foot + dy - CHAR_H * sc, sc });
    }
    // 8) taç, "SEN" işareti, yağmur bulutu
    for (const hd of heads) {
      if (hd.i === 0) {
        const u = clamp((pt - CROWN_T) / .5, 0, 1);
        if (u > 0) {
          const cy = hd.y - 20 * ps - (1 - ease.outBounce(u)) * 260 + Math.sin(pt * 3) * 2.5;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .2 * Math.sin(pt * 4);
          drawSpr(ctx, gfx.glowSprite('#ffd23f', 48), hd.x, cy);
          ctx.restore();
          drawIcon(ctx, 'crown', hd.x, cy, 60 * ps, 60 * ps);
          for (let k = 0; k < 4; k++) {
            const a = pt * 1.6 + k * TAU / 4, rr2 = 52 * ps;
            const tw2 = .5 + .5 * Math.sin(pt * 6 + k * 1.7);
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = tw2;
            sparkle(ctx, hd.x + Math.cos(a) * rr2, cy + 10 * ps + Math.sin(a) * rr2 * .5, 5 * ps * (.6 + tw2 * .6), '#fff6c8');
            ctx.restore();
          }
        }
      }
      if (hd.i >= 3) {
        const u = clamp((pt - DROP_T[hd.i] - .7) / .5, 0, 1);
        if (u > 0) {
          const cx2 = hd.x, cy2 = hd.y - 4 * ps + Math.sin(pt * 2) * 2;
          ctx.globalAlpha = u;
          ctx.strokeStyle = '#7be3ff'; ctx.lineWidth = 2.4 * ps; ctx.lineCap = 'round';
          for (let k = 0; k < 4; k++) {
            const ry2 = ((pt * 1.6 + k * .27) % 1);
            const dx = (k - 1.5) * 9 * ps, y0 = cy2 + 14 * ps + ry2 * 36 * ps;
            ctx.globalAlpha = u * (1 - ry2);
            ctx.beginPath(); ctx.moveTo(cx2 + dx, y0); ctx.lineTo(cx2 + dx - 1.5 * ps, y0 + 7 * ps); ctx.stroke();
          }
          ctx.globalAlpha = u;
          drawIcon(ctx, 'raincloud', cx2, cy2, 58 * ps, 58 * ps);
          ctx.globalAlpha = 1;
        }
      }
      if (hd.r === S.player && hd.i !== 0) {
        const u = clamp((pt - DROP_T[hd.i] - .5) / .3, 0, 1);
        if (u > 0) {
          const my = hd.y - (hd.i >= 3 ? 52 : 20) * ps + Math.sin(pt * 5) * 3;
          ctx.globalAlpha = u;
          const w = 46 * tm, h = 22 * tm;
          pill(ctx, hd.x - w / 2, my - h / 2, w, h, { top: '#ffe066', bot: '#e08a00' });
          ctx.beginPath(); ctx.moveTo(hd.x - 6, my + h / 2 - 1); ctx.lineTo(hd.x + 6, my + h / 2 - 1); ctx.lineTo(hd.x, my + h / 2 + 7); ctx.closePath();
          ctx.fillStyle = '#e08a00'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
          T(ctx, 'SEN', hd.x, my + 1, 14 * tm, '#ffffff', { lw: 3.6 });
          ctx.globalAlpha = 1;
        }
      }
    }
    // 9) isim plakaları (sahne önünde)
    const pu = clamp((pt - 1.3) / .4, 0, 1);
    if (pu > 0) {
      for (let i = 0; i < rk.length && i < (G.list ? 3 : 6); i++) {
        const r = rk[i];
        if (!r) continue;
        const sp = slotPos(G, i);
        const isP = r === S.player;
        const sz = (G.list ? 13.5 : 16) * tm, padN = G.list ? 16 : 26;
        const nm = clip(ctx, String(r.name || r.id), sz, (G.list ? G.sw - 4 : 220) - padN);
        const w = Math.max(tw(ctx, nm, sz) + padN, (G.list ? 56 : 76) * ps), h = 27 * tm;
        const phh = 20 * tm, pyB = 540 - (G.short ? 20 : 7) - phh / 2;   // puan hapı ekranın altına sığsın (telefonda kenara yapışmasın)
        const y = Math.min(G.floorY + G.ry + 26 * tm, pyB - phh / 2 - 3 - h / 2) - (1 - ease.outCubic(pu)) * 14;
        ctx.globalAlpha = pu;
        const col = racerColor(r);
        pill(ctx, sp.x - w / 2, y - h / 2, w, h, isP ? { top: '#5a3c08', bot: '#2e1c02', border: OUT } : { top: 'rgba(40,28,80,.95)', bot: 'rgba(18,12,40,.95)' });
        ctx.fillStyle = col; rr(ctx, sp.x - w / 2 + 6, y + h / 2 - 5, w - 12, 2.6, 1.3); ctx.fill();
        T(ctx, nm, sp.x, y, sz, isP ? '#ffe14d' : '#ffffff', { lw: 3.8 });
        // kazanma ölçütü: Altın Avı'nda altın sayısı, elemede elenen etiketi; kopan oyuncu gri
        const mode = (res && res.mode) || gMode();
        const coinsM = mode === 'coins';
        const pts = (r.out && mode === 'elim' && !G.list ? 'ELENDİ · ' : '') + '+' + (r.rp | 0) + (coinsM || G.list ? '' : ' puan');
        const psz = Math.max(12, 12.5 * tm), ph = 20 * tm, py = y + h / 2 + ph / 2 + 3;
        const cTxt = coinsM ? String(r.coins | 0) : '', cW = coinsM ? tw(ctx, cTxt, psz) + 22 : 0;
        const pw = tw(ctx, pts, psz) + 18 + cW;
        pill(ctx, sp.x - pw / 2, py - ph / 2, pw, ph, r.off ? { top: '#8a88a0', bot: '#4e4c63' } : (r.rp | 0) > 0 ? { top: '#5ee07a', bot: '#1f8a44' } : { top: '#8a88a0', bot: '#4e4c63' });
        if (coinsM) {
          drawIcon(ctx, 'coin', sp.x - pw / 2 + 15, py, 17 * tm, 18);
          T(ctx, cTxt, sp.x - pw / 2 + 25, py + .5, psz, '#ffe14d', { align: 'left', lw: 3.2, shadow: false });
        }
        T(ctx, pts, sp.x + cW / 2, py + .5, psz, '#ffffff', { lw: 3.2, shadow: false });
        ctx.globalAlpha = 1;
      }
    }
    // 10) başlık
    {
      const u = ease.outBack(clamp((pt - .1) / .5, 0, 1), 1.8);
      const y = lerp(-70, 44 * tm, u);
      const round = (res && res.round) || S.round || 1, rounds = (res && res.rounds) || S.ROUNDS || 1;
      // telefonda tur bilgisi sonuç panelinin kurdelesinde: burada tema adı kurdelede, altında yalnızca kupa hapı
      const thName = (th && th.n) || '';
      const short = G.short && !!thName;
      ribbon(ctx, G.cx + 20 * ps, y, short ? thName : 'TUR ' + round + ' / ' + rounds, themeAcc(th), 30 * tm, clamp(u * 2, 0, 1));
      const y2 = y + 42 * tm;
      const nm = short ? '' : thName, sz = 14 * tm, h = 24 * tm;
      const w1 = nm ? tw(ctx, nm, sz) + 24 : 0;
      const td = res && !res.spectator && typeof res.trophyDelta === 'number' ? res.trophyDelta : null;
      const tdTxt = td == null ? '' : (td > 0 ? '+' : '') + td;
      const w2 = td == null ? 0 : tw(ctx, tdTxt, sz) + 44;
      const pm = (res && res.mode) || gMode(), pmi = pm !== 'classic' ? modeInfo(pm) : null;
      const mTxt = pmi ? upTR(pmi.n) : '', w0 = mTxt ? tw(ctx, mTxt, sz) + 24 : 0;
      const tot = w0 + (w0 && (w1 || w2) ? 8 : 0) + w1 + (w1 && w2 ? 8 : 0) + w2;
      let x = G.cx + 20 * ps - tot / 2;
      ctx.globalAlpha = clamp((pt - .35) / .3, 0, 1);
      if (ctx.globalAlpha > 0) {
        if (w0) {
          const mc = MODE_COL[pm] || '#8b5cf6';
          pill(ctx, x, y2 - h / 2, w0, h, { top: gfx.shade(mc, .25), bot: gfx.shade(mc, -.35) });
          T(ctx, mTxt, x + w0 / 2, y2 + 1, sz, '#ffffff', { lw: 3.4 });
          x += w0 + 8;
        }
        if (w1) {
          pill(ctx, x, y2 - h / 2, w1, h, { top: 'rgba(30,20,60,.92)', bot: 'rgba(14,9,32,.92)' });
          T(ctx, nm, x + w1 / 2, y2 + 1, sz, '#ffffff', { lw: 3.4 });
        }
        if (w2) {
          if (w1) x += w1 + 8;
          pill(ctx, x, y2 - h / 2, w2, h, td >= 0 ? { top: '#3fa860', bot: '#1c5c34' } : { top: '#c23a4a', bot: '#7a1020' });
          drawIcon(ctx, 'trophy', x + 15, y2, 24 * tm, 24 * tm);
          T(ctx, tdTxt, x + 28 + (w2 - 32) / 2, y2 + 1, sz, '#ffffff', { lw: 3.4 });
        }
      }
      ctx.globalAlpha = 1;
    }
    // 10b) 4. ve sonrası: kompakt liste
    if (G.list) drawPodList(ctx, G, rk, pt, res);
    // 11) konfeti (önde)
    drawPodParts(ctx, true);
  }
  /** Kürsü listesi (4..N): sıra, portre, ad, ölçüt (altın / elendi / koptu), tur puanı. Kürsünün sağında, sonuç panelinin solunda. */
  function drawPodList(ctx, G, rk, pt, res) {
    const S = FM.S, tm = G.tm, n = rk.length - 3;
    if (n <= 0) return;
    const mode = (res && res.mode) || gMode(), coinsM = mode === 'coins', elimM = mode === 'elim';
    const top = 20 * tm, bot = 540 - 12, gap = 5;
    const rh = clamp((bot - top - (n - 1) * gap) / n, 26, 40 * tm);
    const tot = n * rh + (n - 1) * gap;
    const y0 = Math.max(top, (top + bot) / 2 - tot / 2 + 20);
    const x = G.listX, w = G.listW;
    const sz = clamp(rh * .42, 12, 16 * tm);
    for (let k = 0; k < n; k++) {
      const i = k + 3, r = rk[i];
      if (!r) continue;
      const u = clamp((pt - 1.0 - k * .08) / .35, 0, 1);
      if (u <= 0) continue;
      const y = y0 + k * (rh + gap), cy = y + rh / 2;
      const me = r === S.player;
      ctx.save();
      ctx.globalAlpha = u; ctx.translate((1 - ease.outCubic(u)) * 60, 0);
      pill(ctx, x, y, w, rh, me ? { top: '#5a3c08', bot: '#2e1c02', border: '#ffd23f', lw: 2.4 } : (r.off || r.out) ? { top: 'rgba(52,46,78,.92)', bot: 'rgba(26,22,44,.92)', lw: 2.4 } : { top: 'rgba(40,28,80,.94)', bot: 'rgba(18,12,40,.94)', lw: 2.4 });
      // sıra numarası (yalın), portre (+ elendi/koptu rozeti), ad, ölçüt, puan
      const rsz = Math.max(12, sz * 1.02), nw = tw(ctx, '10', rsz);
      T(ctx, String(i + 1), x + 8 + nw / 2, cy + 1, rsz, me ? '#ffe14d' : '#d9d6ea', { lw: 3.2, shadow: false });
      const br = rh * .36, px = x + 8 + nw + 5 + br;
      if (r.off) ctx.globalAlpha = u * .55;
      ctx.fillStyle = OUT; circ(ctx, px, cy, br + 1.8); ctx.fill();
      drawPortrait(ctx, r, px, cy, br);
      ctx.globalAlpha = u;
      if (r.off || (elimM && r.out)) {
        const bx = px + br * .72, by = cy + br * .62, bb = Math.max(5.5, br * .45);
        ctx.fillStyle = OUT; circ(ctx, bx, by, bb + 1.6); ctx.fill();
        ctx.fillStyle = r.off ? '#8a88a0' : '#ff3b4e'; circ(ctx, bx, by, bb); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, bb * .32); ctx.lineCap = 'round';
        const d = bb * .45;
        ctx.beginPath(); ctx.moveTo(bx - d, by - d); ctx.lineTo(bx + d, by + d); ctx.moveTo(bx + d, by - d); ctx.lineTo(bx - d, by + d); ctx.stroke();
      }
      let xr = x + w - 5;
      const pts = '+' + (r.rp | 0), psz = Math.max(12, sz * .88), pw = tw(ctx, pts, psz) + 12, ph = Math.min(rh - 8, 20 * tm);
      pill(ctx, xr - pw, cy - ph / 2, pw, ph, (r.rp | 0) > 0 ? { top: '#5ee07a', bot: '#1f8a44', lw: 2 } : { top: '#8a88a0', bot: '#4e4c63', lw: 2 });
      T(ctx, pts, xr - pw / 2, cy + .5, psz, '#ffffff', { lw: 3, shadow: false });
      xr -= pw + 5;
      if (coinsM) {
        const cTxt = String(r.coins | 0), cw = tw(ctx, cTxt, psz);
        T(ctx, cTxt, xr, cy + 1, psz, '#ffe14d', { align: 'right', lw: 3, shadow: false });
        drawIcon(ctx, 'coin', xr - cw - 8, cy, 15, 18);
        xr -= cw + 18;
      }
      const nx = px + br + 6;
      const nm = clip(ctx, r.name || r.id, sz, Math.max(16, xr - nx - 2));
      T(ctx, nm, nx, cy + 1, sz, me ? '#ffe14d' : r.off ? '#b8b6c8' : '#ffffff', { align: 'left', lw: 3.4, shadow: false });
      ctx.restore();
    }
  }
  R.drawPodium = function (ctx) {
    if (!ctx) return;
    ctx.save();
    const vk = podVK(); if (vk !== 1) ctx.scale(vk, vk);
    try { podiumScene(ctx); }
    finally {
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* =====================================================================
     7) GÜNCELLEYİCİ VE OLAYLAR
     ===================================================================== */
  R.updaters.push(function (dt) {
    H.t += dt;
    podUpdate(dt);
  });
  FM.on('ui:podium', () => { pod.lastPT = -1; podSerial++; });
  FM.on('race:start', () => { H.roundKey = ''; EV.elim = null; EV.meteor = -9; });
  FM.on('eliminated', e => {
    const S = FM.S;
    if (!e || !e.r || S.mode === 'demo') return;
    const nm = String(e.r.name || e.r.id || '');
    const me = e.r === S.player;
    // kendi elenmemi "ELENDİN!" ekranı gösteriyor → bantta yalnız diğerleri
    if (EV.elim && H.t - EV.elim.t < .8 && EV.elim.gate === e.gate) { if (!me && EV.elim.names.indexOf(nm) < 0) EV.elim.names.push(nm); }
    else EV.elim = { names: me ? [] : [nm], t: H.t, gate: e.gate };
  });
  FM.on('meteor:shower', () => { if (FM.S.mode === 'race') EV.meteor = H.t; });
  FM.on('resize', () => {
    hcache.clear(); portCache.clear(); twCache.clear(); touchCached = null;
    measureSafe();
  });
  FM.on('boot', () => { measureSafe(); buildEmojiMap(); });
  try {
    if (document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => { twCache.clear(); hcache.clear(); iconCache.clear(); urlCache.clear(); });
    }
  } catch (e) { }
})(window.FM);

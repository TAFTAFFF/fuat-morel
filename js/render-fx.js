/* FUAT MOREL — render-fx.js
   Efekt ajanının modülü: parçacıklar, şok halkaları, varlıklar (testere, dinamit, ayı tuzağı, elektrik ağı, füze,
   fırtına bulutu, yıldırım, mıknatıs, karga, ses dalgası), kozmetik izler (trail) ve ekran efektleri
   (mürekkep, kırağı, hız çizgileri, flaş, ölüm vinyeti, vinyet, tema tonu).

   API:  FM.R.drawEnts(ctx)       — dünya koordinatı, yarışçılardan ÖNCE (zemin seviyesi: iz şeritleri, tuzak, testere)
         FM.R.drawParticles(ctx)  — dünya koordinatı, yarışçılardan SONRA (havadaki varlıklar, halkalar, parçacıklar, nişangâhlar)
         FM.R.drawScreenFX(ctx)   — ekran koordinatı
         FM.R.updaters            — parçacık/halka fiziği, varlık efekt üretimi, iz üretimi (her karede, gerçek dt)

   Performans: tüm karmaşık şekiller FM.gfx.sprite ile bir kez çizilip önbelleklenir; sıcak döngüde shadowBlur/filter yok.
   Dönüşümler tek bir temel matris üzerinden setTransform ile yapılır (save/restore yığını yok). */
'use strict';
(function (FM) {
  const S = FM.S, V = FM.view, gfx = FM.gfx;
  const R = FM.R = FM.R || {};
  R.updaters = R.updaters || [];
  const TAU = Math.PI * 2, PI = Math.PI;
  const rnd = Math.random;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const MAXP = 420;   // ekran dolmasın: aynı anda en çok bu kadar parçacık (eskiden 900)
  let FXT = 0;                 // efekt saati (yalnızca kare güncellemesinde ilerler)

  /* =====================================================================
     RENK YARDIMCILARI — hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba() kabul eder
     ===================================================================== */
  const colCache = new Map();
  function C(c) {
    let o = colCache.get(c);
    if (o) return o;
    let r = 255, g = 255, b = 255, a = 1;
    if (typeof c === 'string') {
      const s = c.trim();
      if (s[0] === '#') {
        let h = s.slice(1);
        if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
        if (h.length >= 6) {
          const n = parseInt(h.slice(0, 6), 16);
          if (isFinite(n)) { r = n >> 16 & 255; g = n >> 8 & 255; b = n & 255; }
          if (h.length === 8) { const al = parseInt(h.slice(6, 8), 16); if (isFinite(al)) a = al / 255; }
        }
      } else {
        const m = s.match(/rgba?\(([^)]+)\)/i);
        if (m) {
          const p = m[1].split(/[\s,\/]+/).filter(x => x.length);
          r = clamp(+p[0] || 0, 0, 255) | 0; g = clamp(+p[1] || 0, 0, 255) | 0; b = clamp(+p[2] || 0, 0, 255) | 0;
          if (p[3] != null) { const al = parseFloat(p[3]); a = isFinite(al) ? clamp(p[3].indexOf('%') > 0 ? al / 100 : al, 0, 1) : 1; }
        } else {
          const named = { white: '#ffffff', black: '#000000', red: '#ff0000', yellow: '#ffff00', gold: '#ffd700', orange: '#ffa500', cyan: '#00ffff', blue: '#0000ff', green: '#00ff00', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080' };
          const hx = named[s.toLowerCase()];
          if (hx) { const n = parseInt(hx.slice(1), 16); r = n >> 16 & 255; g = n >> 8 & 255; b = n & 255; }
        }
      }
    }
    const hex = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    o = { r, g, b, a, hex, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
    if (colCache.size > 600) colCache.clear();
    colCache.set(c, o);
    return o;
  }
  const rgba = (c, a) => { const o = C(c); return 'rgba(' + o.r + ',' + o.g + ',' + o.b + ',' + a + ')'; };
  const mix = (a, b, t) => gfx.mix(C(a).hex, C(b).hex, t);
  const shade = (c, f) => gfx.shade(C(c).hex, f);
  const INK = '#1a1030';      // ortak koyu çizgi film dış hattı (mor-siyah)

  /* =====================================================================
     DÖNÜŞÜM YARDIMCILARI — tek temel matris, parçacık başına setTransform
     ===================================================================== */
  let MA = 1, MB = 0, MC = 0, MD = 1, ME = 0, MF = 0;
  function grabXf(ctx, world) {
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      MA = m.a; MB = m.b; MC = m.c; MD = m.d; ME = m.e; MF = m.f;
    } else {                       // çok eski tarayıcı: main.js'in kurduğu dönüşümü yeniden üret
      const k = V.S || 1;
      MA = k; MB = 0; MC = 0; MD = k;
      ME = world ? -Math.round(S.cam.x * k) : 0; MF = world ? -Math.round(S.cam.y * k) : 0;
    }
  }
  function setXf(ctx, x, y, rot, sx, sy) {
    let m0 = sx, m1 = 0, m2 = 0, m3 = sy;
    if (rot) { const c = Math.cos(rot), s = Math.sin(rot); m0 = c * sx; m1 = s * sx; m2 = -s * sy; m3 = c * sy; }
    ctx.setTransform(MA * m0 + MC * m1, MB * m0 + MD * m1, MA * m2 + MC * m3, MB * m2 + MD * m3, MA * x + MC * y + ME, MB * x + MD * y + MF);
  }
  function resetXf(ctx) { ctx.setTransform(MA, MB, MC, MD, ME, MF); }
  /** sprite'ı (x,y) bağlantı noktasına döndürüp ölçekleyerek çizer (temel matris korunur, sonra resetXf gerekir) */
  function spr(ctx, s, x, y, rot, sx, sy) {
    if (!s) return;
    setXf(ctx, x, y, rot, sx, sy === undefined ? sx : sy);
    ctx.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  }
  const sp = (key, w, h, ox, oy, fn) => gfx.sprite('fx:' + key, w, h, ox, oy, fn);

  /* =====================================================================
     YOL (PATH) YARDIMCILARI
     ===================================================================== */
  function starPath(g, R0, r0, n) {
    n = n || 5;
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = -PI / 2 + i * PI / n, rr = i % 2 ? r0 : R0;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  }
  function heartPath(g, s) {
    g.beginPath();
    g.moveTo(0, s * .95);
    g.bezierCurveTo(-s * .25, s * .72, -s * 1.12, s * .22, -s * 1.05, -s * .32);
    g.bezierCurveTo(-s * .98, -s * .98, -s * .2, -s * 1.08, 0, -s * .46);
    g.bezierCurveTo(s * .2, -s * 1.08, s * .98, -s * .98, s * 1.05, -s * .32);
    g.bezierCurveTo(s * 1.12, s * .22, s * .25, s * .72, 0, s * .95);
    g.closePath();
  }
  function spadePath(g, s) {
    g.beginPath();
    g.moveTo(0, -s * 1.02);
    g.bezierCurveTo(s * .3, -s * .62, s * 1.12, -s * .2, s * 1.06, s * .3);
    g.bezierCurveTo(s * 1.0, s * .86, s * .36, s * .96, s * .1, s * .56);
    g.quadraticCurveTo(s * .2, s * .96, s * .48, s * 1.14);
    g.lineTo(-s * .48, s * 1.14);
    g.quadraticCurveTo(-s * .2, s * .96, -s * .1, s * .56);
    g.bezierCurveTo(-s * .36, s * .96, -s * 1.0, s * .86, -s * 1.06, s * .3);
    g.bezierCurveTo(-s * 1.12, -s * .2, -s * .3, -s * .62, 0, -s * 1.02);
    g.closePath();
  }
  function polyline(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  }
  /** Orta nokta kaydırmalı zikzak (yıldırım/elektrik arkı) — düz sayı dizisi döndürür [x0,y0,x1,y1,...] */
  function zigzag(x0, y0, x1, y1, disp, depth) {
    let pts = [x0, y0, x1, y1];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (let d = 0; d < depth; d++) {
      const np = [];
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        const o = (rnd() - .5) * disp;
        np.push(ax, ay, (ax + bx) / 2 + nx * o, (ay + by) / 2 + ny * o);
      }
      np.push(pts[pts.length - 2], pts[pts.length - 1]);
      pts = np; disp *= .56;
    }
    return pts;
  }

  /* =====================================================================
     GÖRÜNÜRLÜK
     ===================================================================== */
  function inView(x, y, m) {
    const cx = S.cam.x, cy = S.cam.y;
    return x > cx - m && x < cx + V.VW + m && y > cy - m && y < cy + V.VH + m;
  }
  const rcx = r => r.x + (r.w || 28) / 2;
  const rcy = r => r.y + (r.h || 42) / 2;

  /* Varlık başına görsel durum (oyun nesnelerini kirletmeden) */
  const VIS = new WeakMap();
  function vis(e) {
    let v = VIS.get(e);
    if (!v) { v = { t: 0, rot: 0, acc: 0, acc2: 0, seed: rnd() * 1000, hist: null, arcs: null, arcT: 0 }; VIS.set(e, v); }
    return v;
  }

  /** Parçacık üret (FM.fx.p varsa onu kullan — üst sınırı o uygular) */
  function P(o) {
    if (o.max === undefined) o.max = o.life;
    if (o.rot === undefined) o.rot = 0;
    if (o.vr === undefined) o.vr = 0;
    if (o.g === undefined) o.g = 0;
    if (o.drag === undefined) o.drag = 0;
    if (FM.fx && typeof FM.fx.p === 'function') return FM.fx.p(o);
    const L = S.parts; if (L.length > MAXP) L.splice(0, L.length - MAXP);
    L.push(o); return o;
  }
  /** Kozmetik/süs üretimi için bütçe: parçacık sayısı yüksekse süsleri azalt */
  const budget = () => S.parts.length < 280;

  /* =====================================================================
     PARÇACIK SPRITE'LARI (renk başına önbellek)
     ===================================================================== */
  function dotSprite(hex) {
    return sp('dot:' + hex, 26, 26, 13, 13, g => {
      const R0 = 10;
      const gr = g.createRadialGradient(-3.5, -4, 1, 0, 0, R0);
      gr.addColorStop(0, mix(hex, '#ffffff', .55));
      gr.addColorStop(.5, hex);
      gr.addColorStop(1, mix(hex, '#3a2f6b', .3));
      g.beginPath(); g.arc(0, 0, R0, 0, TAU);
      g.lineWidth = 2.4; g.strokeStyle = mix(hex, INK, .72); g.stroke();
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.beginPath(); g.ellipse(-3.4, -4.2, 3.4, 2.2, -.6, 0, TAU); g.fill();
    });
  }

  const PUFF_SHAPES = [
    [[0, 4, 18], [-13, 7, 13], [13, 6, 14], [-5, -8, 14], [8, -7, 12]],
    [[0, 3, 17], [-12, 3, 14], [12, 8, 12], [3, -10, 13], [-14, 10, 9], [15, -1, 10]],
    [[0, 5, 16], [-10, -4, 14], [10, -3, 14], [-15, 8, 10], [14, 9, 11], [0, -12, 9]]
  ];
  function puffSprite(hex, v) {
    v = v % PUFF_SHAPES.length;
    return sp('puff:' + hex + ':' + v, 76, 76, 38, 38, g => {
      const sh = PUFF_SHAPES[v];
      const path = () => { g.beginPath(); for (const c of sh) { g.moveTo(c[0] + c[2], c[1]); g.arc(c[0], c[1], c[2], 0, TAU); } };
      // yumuşak hale
      const halo = g.createRadialGradient(0, 2, 10, 0, 2, 36);
      halo.addColorStop(0, rgba(hex, .28)); halo.addColorStop(1, rgba(hex, 0));
      g.fillStyle = halo; g.fillRect(-38, -38, 76, 76);
      // dış hat (yarısı fill altında kalır → sadece dış birleşim kenarı görünür)
      path(); g.lineWidth = 3.4; g.strokeStyle = rgba(mix(hex, '#2a2048', .6), .55); g.stroke();
      const gr = g.createLinearGradient(0, -24, 0, 26);
      gr.addColorStop(0, mix(hex, '#ffffff', .5));
      gr.addColorStop(.48, hex);
      gr.addColorStop(1, mix(hex, '#5a5288', .32));
      path(); g.fillStyle = gr; g.fill();
      // her balonun üst-solunda yumuşak parlama
      for (const c of sh) {
        const hg = g.createRadialGradient(c[0] - c[2] * .3, c[1] - c[2] * .38, 0, c[0] - c[2] * .3, c[1] - c[2] * .38, c[2] * .62);
        hg.addColorStop(0, 'rgba(255,255,255,.42)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = hg; g.beginPath(); g.arc(c[0], c[1], c[2], 0, TAU); g.fill();
      }
      // alt gölge şeridi
      g.save(); path(); g.clip();
      const bg = g.createLinearGradient(0, 6, 0, 26);
      bg.addColorStop(0, 'rgba(40,30,80,0)'); bg.addColorStop(1, 'rgba(40,30,80,.18)');
      g.fillStyle = bg; g.fillRect(-38, 0, 76, 38);
      g.restore();
    });
  }

  function sparkSprite(hex) {
    return sp('spark:' + hex, 44, 10, 39, 5, g => {
      const gr = g.createLinearGradient(-38, 0, 4, 0);
      gr.addColorStop(0, rgba(hex, 0)); gr.addColorStop(.55, rgba(hex, .85)); gr.addColorStop(.9, mix(hex, '#ffffff', .6)); gr.addColorStop(1, '#ffffff');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-38, 0); g.quadraticCurveTo(-10, -3.2, 2, -2.5); g.arc(2, 0, 2.5, -PI / 2, PI / 2); g.quadraticCurveTo(-10, 3.2, -38, 0); g.fill();
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.moveTo(-18, 0); g.quadraticCurveTo(-4, -1.1, 2, -1.1); g.arc(2, 0, 1.1, -PI / 2, PI / 2); g.quadraticCurveTo(-4, 1.1, -18, 0); g.fill();
    });
  }

  function confSprite(hex, back) {
    return sp('conf:' + hex + (back ? ':b' : ''), 18, 12, 9, 6, g => {
      const base = back ? mix(hex, '#2a1f50', .3) : hex;
      gfx.rr(g, -6.5, -3.8, 13, 7.6, 2);
      g.lineWidth = 1.6; g.strokeStyle = mix(base, INK, .65); g.stroke();
      g.fillStyle = base; g.fill();
      if (!back) { g.fillStyle = 'rgba(255,255,255,.5)'; gfx.rr(g, -5, -2.6, 10, 2, 1); g.fill(); }
      else { g.fillStyle = 'rgba(0,0,0,.12)'; gfx.rr(g, -5, .8, 10, 2, 1); g.fill(); }
    });
  }

  function glowSprite(hex) {
    return sp('glow:' + hex, 64, 64, 32, 32, g => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, rgba(mix(hex, '#ffffff', .55), 1));
      gr.addColorStop(.14, rgba(hex, .82));
      gr.addColorStop(.4, rgba(hex, .3));
      gr.addColorStop(.7, rgba(hex, .08));
      gr.addColorStop(1, rgba(hex, 0));
      g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
    });
  }

  /* TEHLİKE DİLİ: her zararlı varlığın arkasında aynı sıcak kırmızı-turuncu hale (önbellekli sprite, source-over →
     açık şeker/çöl göğünde de koyu kale/uzay göğünde de okunur), hafif nabız. Dost nesneler (ped, mantar, altın) bunu KULLANMAZ. */
  function dangerSprite() {
    return sp('danger', 96, 96, 48, 48, g => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 48);
      gr.addColorStop(0, 'rgba(255,130,60,.72)'); gr.addColorStop(.3, 'rgba(255,60,36,.7)'); gr.addColorStop(.62, 'rgba(255,40,30,.32)'); gr.addColorStop(1, 'rgba(255,40,30,0)');
      g.fillStyle = gr; g.fillRect(-48, -48, 96, 96);
    });
  }
  function danger(ctx, x, y, r, a) {
    const pulse = .82 + .18 * Math.sin(FXT * 9 + x * .013);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = (a == null ? .9 : a) * pulse;
    spr(ctx, dangerSprite(), x, y, 0, r / 48);
    ctx.globalAlpha = 1;
  }

  function starSprite(hex) {
    return sp('star:' + hex, 34, 34, 17, 17, g => {
      const halo = g.createRadialGradient(0, 0, 2, 0, 0, 16);
      halo.addColorStop(0, rgba(hex, .5)); halo.addColorStop(1, rgba(hex, 0));
      g.fillStyle = halo; g.fillRect(-17, -17, 34, 34);
      g.lineJoin = 'round';
      starPath(g, 11.5, 5.4);
      g.lineWidth = 3; g.strokeStyle = mix(hex, '#3a1d08', .7); g.stroke();
      const gr = g.createRadialGradient(-2, -3, .5, 0, 0, 12);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.35, mix(hex, '#ffffff', .45)); gr.addColorStop(1, hex);
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.ellipse(-2.6, -3.8, 2, 1.2, -.5, 0, TAU); g.fill();
    });
  }
  /** 4 kollu parıltı (kıvılcım başı, cam yansıması) */
  function twinkleSprite(hex) {
    return sp('twk:' + hex, 40, 40, 20, 20, g => {
      const halo = g.createRadialGradient(0, 0, 0, 0, 0, 18);
      halo.addColorStop(0, rgba(hex, .7)); halo.addColorStop(.35, rgba(hex, .22)); halo.addColorStop(1, rgba(hex, 0));
      g.fillStyle = halo; g.fillRect(-20, -20, 40, 40);
      g.fillStyle = mix(hex, '#ffffff', .6);
      g.beginPath();
      g.moveTo(0, -18); g.quadraticCurveTo(1.4, -1.4, 18, 0); g.quadraticCurveTo(1.4, 1.4, 0, 18);
      g.quadraticCurveTo(-1.4, 1.4, -18, 0); g.quadraticCurveTo(-1.4, -1.4, 0, -18); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill();
    });
  }

  function notePath(g, v) {
    g.beginPath();
    if (v === 0) {           // ♪ tek nota
      g.ellipse(-3.6, 7.8, 5.4, 3.9, -.45, 0, TAU);
      g.moveTo(.4, 7.4); g.lineTo(.4, -11); g.lineTo(2.6, -11); g.lineTo(2.6, 7.4); g.closePath();
      g.moveTo(2.4, -11.4);
      g.bezierCurveTo(5.5, -8.5, 10.5, -7, 8.6, .4);
      g.bezierCurveTo(8.4, -4, 5.4, -5.4, 2.4, -5.6); g.closePath();
    } else {                 // ♫ çift nota
      g.ellipse(-6.6, 8.6, 4.6, 3.4, -.45, 0, TAU);
      g.ellipse(6.4, 6.2, 4.6, 3.4, -.45, 0, TAU);
      g.moveTo(-3.2, 8.2); g.lineTo(-3.2, -8); g.lineTo(-1.2, -8); g.lineTo(-1.2, 8.2); g.closePath();
      g.moveTo(9.8, 5.8); g.lineTo(9.8, -10.4); g.lineTo(11.8, -10.4); g.lineTo(11.8, 5.8); g.closePath();
      g.moveTo(-3.2, -8.6); g.lineTo(11.8, -11.4); g.lineTo(11.8, -6.6); g.lineTo(-3.2, -3.8); g.closePath();
    }
  }
  function noteSprite(hex, v) {
    v = v ? 1 : 0;
    return sp('note:' + hex + ':' + v, 34, 32, 17, 16, g => {
      g.lineJoin = 'round';
      notePath(g, v);
      g.lineWidth = 3.6; g.strokeStyle = mix(hex, INK, .78); g.stroke();
      const gr = g.createLinearGradient(-8, -12, 8, 12);
      gr.addColorStop(0, mix(hex, '#ffffff', .45)); gr.addColorStop(.5, hex); gr.addColorStop(1, mix(hex, '#2a1f50', .25));
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      if (v === 0) { g.beginPath(); g.ellipse(-5, 6.6, 1.8, 1, -.45, 0, TAU); g.fill(); }
      else { g.beginPath(); g.ellipse(-7.8, 7.6, 1.6, .9, -.45, 0, TAU); g.ellipse(5.2, 5.2, 1.6, .9, -.45, 0, TAU); g.fill(); }
    });
  }

  function heartSprite(hex) {
    return sp('heart:' + hex, 28, 26, 14, 13, g => {
      g.lineJoin = 'round';
      heartPath(g, 10);
      g.lineWidth = 3; g.strokeStyle = mix(hex, INK, .72); g.stroke();
      const gr = g.createRadialGradient(-4, -5, 1, 0, 0, 13);
      gr.addColorStop(0, mix(hex, '#ffffff', .55)); gr.addColorStop(.55, hex); gr.addColorStop(1, mix(hex, '#5a0a2a', .3));
      g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.ellipse(-5, -4.6, 2.6, 1.6, -.7, 0, TAU); g.fill();
      g.beginPath(); g.arc(-1.8, -6.4, .9, 0, TAU); g.fill();
    });
  }

  function spadeSprite(hex) {
    return sp('spade:' + hex, 28, 30, 14, 14, g => {
      const dark = C(hex).lum < .2;
      g.lineJoin = 'round';
      spadePath(g, 10);
      if (dark) { g.lineWidth = 4.2; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke(); g.lineWidth = 1.6; g.strokeStyle = '#000'; g.stroke(); }
      else { g.lineWidth = 3; g.strokeStyle = C(hex).lum > .9 ? '#2a2440' : mix(hex, INK, .72); g.stroke(); }
      const gr = g.createLinearGradient(-8, -10, 8, 10);
      if (dark) { gr.addColorStop(0, '#4a4658'); gr.addColorStop(.5, hex); gr.addColorStop(1, '#000000'); }
      else { gr.addColorStop(0, mix(hex, '#ffffff', .5)); gr.addColorStop(.55, hex); gr.addColorStop(1, mix(hex, '#2a1f50', .3)); }
      g.fillStyle = gr; g.fill();
      g.fillStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.75)';
      g.beginPath(); g.ellipse(-4.4, -2.2, 2.2, 1.3, -.9, 0, TAU); g.fill();
    });
  }

  const ICE_SHAPES = [
    [0, -12, 5, -3, 3.5, 10, -4, 8.5, -5.5, -2],
    [-9, -5, 2, -10, 9.5, -1, 4, 8.5, -6.5, 6],
    [0, -11, 7, 0, 0, 11, -7, 0]
  ];
  function iceSprite(hex, v) {
    v = v % ICE_SHAPES.length;
    return sp('ice:' + hex + ':' + v, 28, 28, 14, 14, g => {
      const pts = ICE_SHAPES[v];
      g.lineJoin = 'round';
      const path = () => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); };
      path(); g.lineWidth = 2.6; g.strokeStyle = mix(hex, '#0f3a6a', .78); g.stroke();
      const gr = g.createLinearGradient(-8, -11, 8, 11);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.45, mix(hex, '#ffffff', .25)); gr.addColorStop(1, mix(hex, '#3b86d4', .5));
      g.fillStyle = gr; g.fill();
      // iç fasetler
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(pts[0], pts[1]); g.lineTo(0, 0); g.lineTo(pts[4], pts[5]); g.stroke();
      g.strokeStyle = 'rgba(40,110,190,.35)';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(pts[pts.length - 2], pts[pts.length - 1]); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-1.5, -4, 1.2, 0, TAU); g.fill();
    });
  }

  function featherSprite(hex) {
    return sp('feather:' + hex, 32, 16, 16, 8, g => {
      const dark = C(hex).lum < .2;
      const ol = dark ? '#050508' : mix(hex, '#2a2a55', .62);
      g.lineJoin = 'round'; g.lineCap = 'round';
      const path = () => { g.beginPath(); g.moveTo(-12.5, .6); g.bezierCurveTo(-6, -6.8, 6.5, -6.4, 13.5, -.4); g.bezierCurveTo(6.5, 5.6, -6, 6.4, -12.5, .6); g.closePath(); };
      path(); g.lineWidth = 2.4; g.strokeStyle = ol; g.stroke();
      const gr = g.createLinearGradient(0, -6, 0, 6);
      if (dark) { gr.addColorStop(0, '#5a5470'); gr.addColorStop(.45, hex); gr.addColorStop(1, '#0a0a10'); }
      else { gr.addColorStop(0, mix(hex, '#ffffff', .45)); gr.addColorStop(.6, hex); gr.addColorStop(1, mix(hex, '#6a78b0', .3)); }
      g.fillStyle = gr; g.fill();
      // barb çentikleri
      g.strokeStyle = dark ? 'rgba(150,140,200,.45)' : rgba(mix(hex, '#2a2a55', .5), .55); g.lineWidth = .9;
      g.beginPath();
      g.moveTo(-4, -4.6); g.lineTo(-2, -.6); g.moveTo(3, -4.8); g.lineTo(4.4, -.6);
      g.moveTo(-6, 4.4); g.lineTo(-4, .8); g.moveTo(1.5, 4.8); g.lineTo(3, .8);
      g.stroke();
      // tüy sapı
      g.beginPath(); g.moveTo(-15, 1.2); g.quadraticCurveTo(0, -.6, 12.5, -.4);
      g.strokeStyle = dark ? '#8a84a8' : mix(hex, '#ffffff', .7); g.lineWidth = 1.2; g.stroke();
    });
  }

  const FLAME_STAGES = [['#fffbe6', '#ffe14d', '#ffa51f'], ['#ffe98a', '#ff9a1f', '#ff4d1a'], ['#ffad5c', '#e8401c', '#a3200f']];
  const BLUE_STAGES = [['#f0fcff', '#9fe6ff', '#4fb3ff'], ['#c8f4ff', '#5ec8ff', '#2a7fe8'], ['#8fd0ff', '#2f6fd8', '#1a3aa8']];   // mavi alev (Mağaza 2.0 izi)
  function flameSprite(st, blue) {
    return sp('flame:' + st + (blue ? 'b' : ''), 26, 36, 13, 22, g => {
      const c = (blue ? BLUE_STAGES : FLAME_STAGES)[st];
      const tear = (s, dy) => {
        g.beginPath();
        g.moveTo(0, -18 * s + dy);
        g.bezierCurveTo(5 * s, -10 * s + dy, 10 * s, -3 * s + dy, 9 * s, 4 * s + dy);
        g.arc(0, 4 * s + dy, 9 * s, 0, PI);
        g.bezierCurveTo(-10 * s, -3 * s + dy, -5 * s, -10 * s + dy, 0, -18 * s + dy);
        g.closePath();
      };
      tear(1, 0); g.lineWidth = 1.6; g.strokeStyle = 'rgba(110,20,6,.55)'; g.stroke();
      g.fillStyle = c[2]; g.fill();
      tear(.72, 2.6); g.fillStyle = c[1]; g.fill();
      tear(.42, 5.2); g.fillStyle = c[0]; g.fill();
    });
  }

  /** Konturlu yazı sprite'ı (text parçacığı, geri sayım rakamı) */
  const mctx = document.createElement('canvas').getContext('2d');
  const textDims = new Map();
  function textSprite(str, col, size) {
    const fl = (document.fonts && document.fonts.status === 'loaded') ? 'f' : 'n';
    const hex = C(col).hex, key = 'txt:' + str + '|' + hex + '|' + size + '|' + fl;
    let d = textDims.get(key);
    if (!d) {
      mctx.font = size + 'px ' + FM.FONT_H;
      const w = Math.ceil(mctx.measureText(str).width + size * .9 + 10), h = Math.ceil(size * 1.7);
      d = { w, h };
      if (textDims.size > 400) textDims.clear();
      textDims.set(key, d);
    }
    return sp(key, d.w, d.h, d.w / 2, d.h / 2, g => {
      const darkTxt = C(hex).lum < .22;
      gfx.text(g, str, 0, 0, size, hex, { lw: Math.max(3.5, size / 4), stroke: darkTxt ? '#f4efff' : '#1d1030', shadowCol: 'rgba(0,0,0,.4)' });
      // üst yarıda hafif parlama
      g.globalCompositeOperation = 'source-atop';
      const gr = g.createLinearGradient(0, -size * .5, 0, size * .1);
      gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(-d.w / 2, -size * .6, d.w, size * .6);
      g.globalCompositeOperation = 'source-over';
    });
  }

  /* ateş topu (patlama) renk evresi: sıcak → turuncu → is → duman */
  const FB_COLS = ['#fff3b8', '#ffd45a', '#ffa83a', '#ff7426', '#e04a1e', '#8c3f2e', '#5a4446', '#3e3842'];
  /* ---- Mağaza 2.0 parçacık türleri: bubble (baloncuk), pixel (retro kare), coin (altın para) ---- */
  function bubbleSprite(hex) {
    return sp('bubble:' + hex, 28, 28, 14, 14, g => {
      const r = 11.5;
      const gr = g.createRadialGradient(-3, -3.5, 1, 0, 0, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(.7, rgba(hex, .14)); gr.addColorStop(.93, rgba(hex, .45)); gr.addColorStop(1, rgba(mix(hex, '#ffffff', .5), .85));
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fillStyle = gr; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = rgba(mix(hex, INK, .45), .9); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-4, -4.6, 3, 1.6, -.7, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(4.6, 3.6, 1.2, .8, .5, 0, TAU); g.fill();
    });
  }
  function pixelSprite(hex) {
    return sp('pixel:' + hex, 16, 16, 8, 8, g => {
      g.fillStyle = mix(hex, INK, .7); g.fillRect(-8, -8, 16, 16);
      g.fillStyle = hex; g.fillRect(-6, -6, 12, 12);
      g.fillStyle = mix(hex, '#ffffff', .55); g.fillRect(-6, -6, 12, 3); g.fillRect(-6, -6, 3, 12);
      g.fillStyle = mix(hex, INK, .35); g.fillRect(-6, 3, 12, 3); g.fillRect(3, -6, 3, 12);
    });
  }
  function coinSprite() {
    return sp('coin:tr', 24, 24, 12, 12, g => {
      let ok = false;
      try { if (typeof R.coinIcon === 'function') { const c = R.coinIcon(48); if (c && c.width) { g.drawImage(c, -11, -11, 22, 22); ok = true; } } } catch (e) { ok = false; }
      if (ok) return;
      g.beginPath(); g.arc(0, 0, 10, 0, TAU); g.lineWidth = 2.4; g.strokeStyle = '#6b3a00'; g.stroke();
      const gr = g.createRadialGradient(-3, -4, 1, 0, 0, 10); gr.addColorStop(0, '#fff6c4'); gr.addColorStop(.6, '#ffd23f'); gr.addColorStop(1, '#d08a10');
      g.fillStyle = gr; g.fill();
      g.beginPath(); g.arc(0, 0, 6.2, 0, TAU); g.lineWidth = 1.2; g.strokeStyle = 'rgba(120,70,0,.6)'; g.stroke();
    });
  }

  /* =====================================================================
     PARÇACIK GÜNCELLEME
     ===================================================================== */
  function updParts(dt) {
    const L = S.parts;
    if (!L || !L.length) return;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p) continue;
      p.life = num(p.life, 0) - dt;
      if (!(p.life > 0)) continue;
      const dr = p.drag || 0;
      if (dr) { const f = Math.exp(-dr * dt); p.vx = num(p.vx, 0) * f; p.vy = num(p.vy, 0) * f; }
      p.vy = num(p.vy, 0) + (p.g || 0) * dt;
      p.x = num(p.x, 0) + num(p.vx, 0) * dt;
      p.y = num(p.y, 0) + p.vy * dt;
      if (p.vr) p.rot = num(p.rot, 0) + p.vr * dt;
      if (!(Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6)) continue;
      L[j++] = p;
    }
    L.length = j;
    if (L.length > MAXP) L.splice(0, L.length - MAXP);
  }
  function updRings(dt) {
    const L = S.rings;
    if (!L || !L.length) return;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const g = L[i];
      if (!g) continue;
      g.life = num(g.life, 0) - dt;
      if (g.life > 0) L[j++] = g;
    }
    L.length = j;
    if (L.length > 60) L.splice(0, L.length - 60);
  }

  /* =====================================================================
     PARÇACIK ÇİZİMİ
     ===================================================================== */
  function prep(p) {
    if (p._ph === undefined) { p._ph = rnd() * TAU; p._v = (rnd() * 3) | 0; }
    if (!(p.max > 0)) p.max = Math.max(.01, p.life);
  }
  function drawPuffLike(ctx, p, k, age) {
    const c = C(p.c || 'rgba(255,255,255,.8)');
    const s = num(p.s, 10);
    if (p.k === 'fball') {
      const t = clamp(1 - k, 0, .999), fi = t * (FB_COLS.length - 1), i0 = fi | 0, fr = fi - i0;
      const grow = .62 + .85 * easeOutCubic(t);
      const sc = s / 22 * grow, a = k < .25 ? k / .25 : 1;
      const rot = num(p.rot, 0);
      ctx.globalAlpha = a;
      spr(ctx, puffSprite(FB_COLS[i0], p._v), p.x, p.y, rot, sc);
      if (fr > .05 && i0 + 1 < FB_COLS.length) { ctx.globalAlpha = a * fr; spr(ctx, puffSprite(FB_COLS[i0 + 1], p._v), p.x, p.y, rot, sc); }
      return;
    }
    const grow = .58 + .8 * easeOutCubic(clamp(1 - k, 0, 1));
    const sc = s / 22 * grow;
    ctx.globalAlpha = c.a * Math.min(1, k * 2.2) * (.8 + .2 * k);
    spr(ctx, puffSprite(c.hex, p._v), p.x, p.y, num(p.rot, p._ph), sc);
  }
  function drawPart(ctx, p, k, age) {
    const c = C(p.c || '#ffffff'), hex = c.hex, ca = c.a;
    const s = num(p.s, 4), fade = Math.min(1, k * 3);
    switch (p.k) {
      case 'dot': {
        const sc = s / 10 * (.35 + .65 * k);
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, dotSprite(hex), p.x, p.y, 0, sc);
        break;
      }
      case 'spark': {
        const v = Math.hypot(p.vx || 0, p.vy || 0);
        const len = clamp(v * .04, 5, 42), sy = clamp(s / 2.2, .55, 2.4) * (.5 + .5 * k);
        ctx.globalAlpha = ca * Math.min(1, k * 2.5);
        spr(ctx, sparkSprite(hex), p.x, p.y, v > 1 ? Math.atan2(p.vy, p.vx) : num(p.rot, 0), len / 40, sy);
        break;
      }
      case 'conf': {
        const fl = Math.cos(age * 9 + p._ph + num(p.rot, 0) * .5);
        const sc = s / 6.4;
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, confSprite(hex, fl < 0), p.x + Math.sin(age * 4 + p._ph) * 3, p.y, num(p.rot, 0), sc * Math.max(.1, Math.abs(fl)), sc);
        break;
      }
      case 'star': {
        const tw = .82 + .18 * Math.sin(age * 22 + p._ph);
        const sc = s * 1.5 / 11.5 * tw * Math.min(1, k * 3.5);
        ctx.globalAlpha = ca * fade;
        spr(ctx, starSprite(hex), p.x, p.y, num(p.rot, 0) * .6, sc);
        break;
      }
      case 'note': {
        const sc = s / 5.6 * (k > .85 ? .6 + (1 - k) / .15 * .4 : 1);
        ctx.globalAlpha = ca * fade;
        spr(ctx, noteSprite(hex, p._v === 2), p.x + Math.sin(age * 7 + p._ph) * 3.5, p.y, Math.sin(age * 5 + p._ph) * .35, sc);
        break;
      }
      case 'heart': {
        const sc = s * 1.15 / 10 * (1 + .12 * Math.sin(age * 12 + p._ph)) * Math.min(1, k * 4);
        ctx.globalAlpha = ca * fade;
        spr(ctx, heartSprite(hex), p.x + Math.sin(age * 5 + p._ph) * 2.5, p.y, Math.sin(age * 3 + p._ph) * .25, sc);
        break;
      }
      case 'spade': {
        const sc = s * 1.15 / 10 * Math.min(1, k * 4);
        ctx.globalAlpha = ca * fade;
        spr(ctx, spadeSprite(hex), p.x, p.y, num(p.rot, 0) * .35, sc);
        break;
      }
      case 'ice': {
        const sc = s / 4.4 * (.55 + .45 * k);
        ctx.globalAlpha = ca * fade;
        spr(ctx, iceSprite(hex, p._v), p.x, p.y, num(p.rot, 0), sc);
        break;
      }
      case 'leaf': {
        const sw = Math.sin(age * 4.2 + p._ph);
        const sc = s / 6.2;
        ctx.globalAlpha = ca * fade;
        spr(ctx, featherSprite(hex), p.x + sw * 6, p.y, num(p.rot, 0) * .25 + sw * .7, sc, sc * (.75 + .25 * Math.abs(Math.cos(age * 3 + p._ph))));
        break;
      }
      case 'flame': {
        const st = k > .62 ? 0 : k > .3 ? 1 : 2;
        const sc = s / 9 * (.45 + .55 * k);
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, flameSprite(st, !!p.blue), p.x, p.y, Math.sin(age * 18 + p._ph) * .12, sc, sc * (1 + .15 * Math.sin(age * 25 + p._ph)));
        break;
      }
      case 'bubble': {         // baloncuk: hafif büyür, sonda "patlar" (küçülüp kaybolur)
        const pop = k < .12 ? k / .12 : 1;
        const sc = s / 11.5 * (.7 + .3 * (1 - k)) * (1 + (1 - pop) * .5);
        ctx.globalAlpha = ca * pop;
        spr(ctx, bubbleSprite(hex), p.x + Math.sin(age * 3 + p._ph) * 3, p.y, 0, sc);
        break;
      }
      case 'pixel': {          // retro kare: dönmez, yalnızca küçülür
        const sc = s / 6 * (.45 + .55 * Math.min(1, k * 2));
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, pixelSprite(hex), p.x, p.y, 0, sc);
        break;
      }
      case 'coin': {           // altın para: yatayda döner gibi genişlik salınır
        const spin = Math.cos(age * 11 + p._ph);
        const sc = s / 10;
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, coinSprite(), p.x, p.y, num(p.rot, 0) * .3, sc * Math.max(.15, Math.abs(spin)), sc);
        break;
      }
      case 'twinkle': {
        const sc = s / 18 * (.5 + .5 * Math.sin(clamp(1 - k, 0, 1) * PI));
        ctx.globalAlpha = ca;
        spr(ctx, twinkleSprite(hex), p.x, p.y, num(p.rot, 0), sc);
        break;
      }
      default: {               // bilinmeyen tür → nokta
        const sc = s / 10 * (.35 + .65 * k);
        ctx.globalAlpha = ca * Math.min(1, k * 4);
        spr(ctx, dotSprite(hex), p.x, p.y, 0, sc);
      }
    }
  }
  function drawGlowPart(ctx, p, k) {
    const c = C(p.c || '#ffffff');
    const s = num(p.s, 20);
    const sc = s / 32 * (.75 + .5 * (1 - k));
    ctx.globalAlpha = c.a * Math.pow(k, 1.5);
    spr(ctx, glowSprite(c.hex), p.x, p.y, 0, sc);
  }
  function drawTextPart(ctx, p, k, age) {
    const str = String(p.str == null ? '' : p.str);
    if (!str) return;
    const size = clamp(Math.round(num(p.s, 18)), 8, 72);
    const pop = age < .1 ? .55 + age / .1 * .65 : age < .2 ? 1.2 - (age - .1) / .1 * .2 : 1;
    ctx.globalAlpha = C(p.c || '#fff').a * Math.min(1, p.life / .3);
    spr(ctx, textSprite(str, p.c || '#ffffff', size), p.x, p.y, 0, pop);
  }

  function drawParticleList(ctx) {
    const L = S.parts;
    if (!L || !L.length) return;
    const cx = S.cam.x - 90, cy = S.cam.y - 90, cx2 = S.cam.x + V.VW + 90, cy2 = S.cam.y + V.VH + 90;
    const seen = p => p && p.x > cx && p.x < cx2 && p.y > cy && p.y < cy2 && p.life > 0;
    // 1) duman/toz bulutları (en arkada)
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!seen(p) || (p.k !== 'puff' && p.k !== 'fball')) continue;
      prep(p);
      const k = clamp(p.life / p.max, 0, 1);
      drawPuffLike(ctx, p, k, p.max - p.life);
    }
    // 2) normal karışımlı sprite'lar
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!seen(p) || p.add || p.k === 'puff' || p.k === 'fball' || p.k === 'glow' || p.k === 'text') continue;
      prep(p);
      const k = clamp(p.life / p.max, 0, 1);
      drawPart(ctx, p, k, p.max - p.life);
    }
    resetXf(ctx);
    // 3) ışık ('lighter') katmanı
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || !(p.life > 0)) continue;
      if (p.k === 'glow' ? !inView(p.x, p.y, Math.max(90, num(p.s, 20) * 1.3)) : !seen(p)) continue;
      if (p.k === 'glow') { prep(p); drawGlowPart(ctx, p, clamp(p.life / p.max, 0, 1)); }
      else if (p.k === 'fball') {
        prep(p);
        const k = clamp(p.life / p.max, 0, 1);
        if (k > .45) { ctx.globalAlpha = (k - .45) / .55 * .55; spr(ctx, glowSprite('#ff9a3a'), p.x, p.y, 0, num(p.s, 20) * 1.7 / 32); }
      }
      else if (p.add && p.k !== 'puff' && p.k !== 'text') { prep(p); drawPart(ctx, p, clamp(p.life / p.max, 0, 1), p.max - p.life); }
    }
    ctx.globalCompositeOperation = 'source-over';
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }
  function drawTextParticles(ctx) {
    const L = S.parts;
    if (!L || !L.length) return;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || p.k !== 'text' || !(p.life > 0) || !inView(p.x, p.y, 120)) continue;
      prep(p);
      drawTextPart(ctx, p, clamp(p.life / p.max, 0, 1), p.max - p.life);
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
     HALKALAR — kalın, genişleyen, gradyanlı şok dalgası
     ===================================================================== */
  function drawRings(ctx) {
    const L = S.rings;
    if (!L || !L.length) return;
    ctx.lineCap = 'round';
    for (const g of L) {
      if (!g || !(g.life > 0)) continue;
      const mx = g.max > 0 ? g.max : g.life;
      const k = clamp(g.life / mx, 0, 1), t = 1 - k;
      const R0 = Math.max(4, num(g.r, 60));
      const rr = R0 * (.1 + .9 * easeOutCubic(t));
      const x = num(g.x, 0), y = num(g.y, 0);
      const w = Math.max(2, num(g.w, 6));
      const lw = w * (.45 + .9 * k) + 1.5;
      if (!inView(x, y, rr + lw * 2 + 30)) continue;
      const hex = C(g.col || '#ffffff').hex, light = mix(hex, '#ffffff', .7);
      const a = Math.pow(k, .85);
      // yumuşak şok bandı + iç kubbe (tek radyal gradyan)
      const outer = rr + lw * 1.3;
      const s0 = clamp((rr - lw * 3) / outer, 0, 1), s1 = clamp((rr - lw * .7) / outer, s0, 1), s2 = clamp(rr / outer, s1, 1);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, outer);
      grd.addColorStop(0, rgba(hex, 0));
      grd.addColorStop(s0, rgba(hex, .07 * a));
      grd.addColorStop(s1, rgba(hex, .42 * a));
      grd.addColorStop(s2, rgba(light, .85 * a));
      grd.addColorStop(1, rgba(hex, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, outer, 0, TAU); ctx.fill();
      // koyu ince dış hat (açık zeminde okunurluk)
      ctx.globalAlpha = a * .38;
      ctx.lineWidth = Math.max(2.5, lw * .45) + 3; ctx.strokeStyle = mix(hex, INK, .62);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      // renkli bant
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(2.5, lw * .45); ctx.strokeStyle = hex; ctx.stroke();
      // parlak çekirdek
      ctx.lineWidth = Math.max(1.2, lw * .18); ctx.strokeStyle = light;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, rr - lw * .08), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
     VARLIK SPRITE'LARI
     ===================================================================== */
  /* ---------- TESTERE ---------- */
  function sawRotSprite() {
    return sp('saw:rot', 48, 48, 24, 24, g => {
      const N = 14, R1 = 14.4, R2 = 20.8;
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const a = i / N * TAU, st = TAU / N;
        const pt = (r, aa, first) => { const x = Math.cos(aa) * r, y = Math.sin(aa) * r; if (first) g.moveTo(x, y); else g.lineTo(x, y); };
        pt(R1, a, i === 0);
        pt(R2, a + st * .6);
        pt(R2 - 2.6, a + st * .8);
        pt(R1 + .8, a + st * .97);
      }
      g.closePath();
      const tg = g.createLinearGradient(-20, -20, 20, 20);
      tg.addColorStop(0, '#f7f9fc'); tg.addColorStop(.5, '#b8c1cf'); tg.addColorStop(1, '#5a6475');
      g.lineWidth = 4.2; g.strokeStyle = '#161a24'; g.stroke();
      g.fillStyle = tg; g.fill();
      // TEHLİKE DİLİ: dişler kırmızı-turuncu (nötr gri disk "zararsız" okunuyordu)
      g.save(); g.clip();
      const dg = g.createRadialGradient(0, 0, R1 - 1.5, 0, 0, R2);
      dg.addColorStop(0, 'rgba(232,32,46,0)'); dg.addColorStop(.3, 'rgba(232,32,46,.55)'); dg.addColorStop(1, 'rgba(255,96,60,.95)');
      g.fillStyle = dg; g.fillRect(-24, -24, 48, 48);
      g.restore();
      // diş kenarı bileme parlaması
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = .8;
      g.beginPath();
      for (let i = 0; i < N; i++) {
        const a = i / N * TAU, st = TAU / N;
        g.moveTo(Math.cos(a + st * .15) * (R1 + 1), Math.sin(a + st * .15) * (R1 + 1));
        g.lineTo(Math.cos(a + st * .56) * (R2 - 1.2), Math.sin(a + st * .56) * (R2 - 1.2));
      }
      g.stroke();
      // disk yüzü
      g.beginPath(); g.arc(0, 0, 14.6, 0, TAU);
      const fg = g.createRadialGradient(-5, -6, 1, 0, 0, 15);
      fg.addColorStop(0, '#ffffff'); fg.addColorStop(.45, '#d2d9e3'); fg.addColorStop(1, '#7a8495');
      g.fillStyle = fg; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#262c3a'; g.stroke();
      // tornalama halkaları
      g.lineWidth = .7;
      for (const r of [12.2, 10.4, 8.6]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.strokeStyle = 'rgba(40,48,64,.2)'; g.stroke(); }
      // hafifletme delikleri (yay biçimli)
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + .35;
        g.beginPath(); g.arc(0, 0, 10, a, a + .9); g.arc(0, 0, 6.4, a + .9, a, true); g.closePath();
        g.fillStyle = '#232837'; g.fill(); g.strokeStyle = '#0e1118'; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.arc(0, 0, 6.9, a + .12, a + .78); g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = .9; g.stroke();
      }
      // kırmızı göbek
      g.beginPath(); g.arc(0, 0, 4.8, 0, TAU);
      const hg = g.createRadialGradient(-1.6, -1.6, .5, 0, 0, 4.8);
      hg.addColorStop(0, '#ff8f80'); hg.addColorStop(1, '#b0141c');
      g.fillStyle = hg; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#3a080c'; g.stroke();
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3 + .5;
        g.beginPath(); g.arc(Math.cos(a) * 3, Math.sin(a) * 3, .85, 0, TAU); g.fillStyle = '#f2d0cc'; g.fill();
      }
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const x = Math.cos(a) * 1.6, y = Math.sin(a) * 1.6; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.fillStyle = '#e9edf3'; g.fill(); g.lineWidth = .6; g.strokeStyle = '#3a3f4c'; g.stroke();
    });
  }
  function sawHlSprite() {           // dönmeyen ışık/gölge katmanı (ışık kaynağı sabit)
    return sp('saw:hl', 48, 48, 24, 24, g => {
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(0, 0, 11.8, PI * 1.06, PI * 1.42); g.stroke();
      g.beginPath(); g.arc(0, 0, 11.8, PI * 1.52, PI * 1.6); g.stroke();
      g.strokeStyle = 'rgba(16,20,32,.28)'; g.lineWidth = 2.6;
      g.beginPath(); g.arc(0, 0, 13, PI * .1, PI * .6); g.stroke();
    });
  }
  function sawBlurSprite() {
    return sp('saw:blur', 48, 48, 24, 24, g => {
      const gr = g.createRadialGradient(0, 0, 4, 0, 0, 21.5);
      gr.addColorStop(0, 'rgba(220,226,236,0)');
      gr.addColorStop(.62, 'rgba(214,220,232,.3)');
      gr.addColorStop(.8, 'rgba(176,186,202,.6)');
      gr.addColorStop(.93, 'rgba(110,120,140,.5)');
      gr.addColorStop(1, 'rgba(110,120,140,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 21.5, 0, TAU); g.fill();
      g.lineWidth = .6;
      for (let r = 15.5; r < 21; r += 1.6) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.strokeStyle = 'rgba(255,255,255,.18)'; g.stroke(); }
    });
  }

  /* ---------- DİNAMİT ---------- */
  function dynSprite() {
    return sp('dyn', 22, 36, 11, 18, g => {
      g.lineJoin = 'round';
      const body = () => gfx.rr(g, -6.2, -14, 12.4, 28, 4.6);
      body();
      const bg = g.createLinearGradient(-6.2, 0, 6.2, 0);
      bg.addColorStop(0, '#6e0c10'); bg.addColorStop(.22, '#d22a2c'); bg.addColorStop(.38, '#ff8a76');
      bg.addColorStop(.55, '#e5372f'); bg.addColorStop(1, '#5e0a0d');
      g.fillStyle = bg; g.fill();
      // bantlar ve etiket (gövdeye kırpılmış)
      g.save(); body(); g.clip();
      g.fillStyle = '#20161a'; g.fillRect(-7, -10.6, 14, 2.2); g.fillRect(-7, 8.6, 14, 2.2);
      const lg = g.createLinearGradient(-6.2, 0, 6.2, 0);
      lg.addColorStop(0, '#b89a6a'); lg.addColorStop(.35, '#fff3d6'); lg.addColorStop(1, '#a88a5a');
      g.fillStyle = lg; g.fillRect(-7, -5, 14, 9.6);
      g.fillStyle = 'rgba(90,50,20,.5)'; g.fillRect(-7, -5, 14, .8); g.fillRect(-7, 3.8, 14, .8);
      g.font = '7px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#b0141c'; g.fillText('TNT', 0, .1);
      g.restore();
      body(); g.lineWidth = 1.9; g.strokeStyle = '#260507'; g.stroke();
      // parlama şeridi
      g.fillStyle = 'rgba(255,255,255,.5)'; gfx.rr(g, -3.9, -12, 1.8, 6.4, .9); g.fill(); gfx.rr(g, -3.9, 5.2, 1.8, 6.4, .9); g.fill();
      // karton üst kapak
      g.beginPath(); g.ellipse(0, -14, 6.1, 2.2, 0, 0, TAU);
      g.fillStyle = '#ecd29c'; g.fill(); g.lineWidth = 1.3; g.strokeStyle = '#4a2a10'; g.stroke();
      g.beginPath(); g.ellipse(0, -14, 3.6, 1.2, 0, 0, TAU); g.fillStyle = '#c99c5c'; g.fill();
      g.beginPath(); g.arc(0, -14, .9, 0, TAU); g.fillStyle = '#2a1608'; g.fill();
    });
  }

  /* ---------- AYI TUZAĞI ---------- */
  function trapRingArc(g, a0, a1, rx, ry, cy) {
    g.beginPath(); g.ellipse(0, cy, rx, ry, 0, a0, a1);
    g.lineWidth = 5.4; g.strokeStyle = '#141821'; g.stroke();
    g.lineWidth = 3.2; g.strokeStyle = '#8b94a5'; g.stroke();
    g.beginPath(); g.ellipse(0, cy - .9, rx, ry, 0, a0, a1);
    g.lineWidth = 1; g.strokeStyle = '#eef2f7'; g.stroke();
  }
  function trapTeeth(g, a0, a1, rx, ry, cy, n, h) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      const x = Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      const tw = 1.9 + Math.abs(Math.cos(a)) * -.4;
      g.beginPath(); g.moveTo(x - tw, y); g.lineTo(x, y - h); g.lineTo(x + tw, y); g.closePath();
      g.lineWidth = 1.3; g.strokeStyle = '#141821'; g.stroke();
      g.fillStyle = '#dfe4ec'; g.fill();
      g.beginPath(); g.moveTo(x - tw * .6, y - .4); g.lineTo(x - .2, y - h + 1); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = .6; g.stroke();
    }
  }
  function trapOpenSprite() {
    return sp('trap:open', 64, 32, 32, 24, g => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      // zincir ve kazık (solda)
      g.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const x = -21 - i * 3.6, y = -2.5 + i * .9;
        g.beginPath(); g.ellipse(x, y, 2.4, i % 2 ? 1.1 : 1.6, .2, 0, TAU);
        g.strokeStyle = '#141821'; g.lineWidth = 2.2; g.stroke(); g.strokeStyle = '#a7afbd'; g.lineWidth = 1; g.stroke();
      }
      g.beginPath(); g.moveTo(-31.5, -5); g.lineTo(-29.5, -5); g.lineTo(-30.2, 2); g.closePath();
      g.fillStyle = '#6b7384'; g.fill(); g.strokeStyle = '#141821'; g.lineWidth = 1.2; g.stroke();
      // yaylar (sağda ve solda yassı çubuk + göz)
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(sx * 15, -3.2); g.lineTo(sx * 27, -2.2);
        g.lineWidth = 4.2; g.strokeStyle = '#141821'; g.stroke();
        g.lineWidth = 2.2; g.strokeStyle = '#7d8697'; g.stroke();
        g.beginPath(); g.ellipse(sx * 27.5, -2.4, 2.6, 2.2, 0, 0, TAU);
        g.lineWidth = 3.4; g.strokeStyle = '#141821'; g.stroke();
        g.lineWidth = 1.6; g.strokeStyle = '#b6bdca'; g.stroke();
      }
      // arka yarım çene + dişler
      trapRingArc(g, PI, TAU, 19.5, 6.4, -4);
      trapTeeth(g, PI + .25, TAU - .25, 19.5, 6.4, -4, 7, 7.4);
      // taban çubuğu
      g.beginPath(); g.moveTo(-16, -4); g.lineTo(16, -4);
      g.lineWidth = 3.6; g.strokeStyle = '#141821'; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = '#4b5263'; g.stroke();
      // pirinç basma pedalı
      g.beginPath(); g.ellipse(0, -4.6, 7.8, 2.9, 0, 0, TAU);
      const pg = g.createLinearGradient(0, -7.5, 0, -1.8);
      pg.addColorStop(0, '#ffe08a'); pg.addColorStop(.5, '#e0a63a'); pg.addColorStop(1, '#8a5a12');
      g.fillStyle = pg; g.fill(); g.lineWidth = 1.3; g.strokeStyle = '#3a2408'; g.stroke();
      g.beginPath(); g.ellipse(-2.4, -5.6, 2.6, .9, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
      // ön yarım çene + dişler
      trapTeeth(g, .3, PI - .3, 19.5, 6.4, -4, 7, 7.8);
      trapRingArc(g, 0, PI, 19.5, 6.4, -4);
      // pas lekeleri
      g.fillStyle = 'rgba(150,80,40,.45)';
      g.beginPath(); g.arc(-12, 1, 1.1, 0, TAU); g.arc(9, 1.6, .9, 0, TAU); g.arc(16.5, -1, .8, 0, TAU); g.fill();
    });
  }
  function trapClosedSprite() {
    return sp('trap:closed', 64, 40, 32, 34, g => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      // yaylar
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(sx * 8, -1.5); g.lineTo(sx * 22, -1.5);
        g.lineWidth = 4.2; g.strokeStyle = '#141821'; g.stroke(); g.lineWidth = 2.2; g.strokeStyle = '#7d8697'; g.stroke();
        g.beginPath(); g.ellipse(sx * 22.5, -1.6, 2.6, 2.2, 0, 0, TAU);
        g.lineWidth = 3.4; g.strokeStyle = '#141821'; g.stroke(); g.lineWidth = 1.6; g.strokeStyle = '#b6bdca'; g.stroke();
      }
      // kapalı çeneler: iki yay, tepede birbirine geçen dişler
      for (const sx of [-1, 1]) {
        g.beginPath(); g.ellipse(0, -2, 15, 22, 0, sx < 0 ? PI : PI * 1.5, sx < 0 ? PI * 1.5 : TAU);
        g.lineWidth = 5.6; g.strokeStyle = '#141821'; g.stroke();
        g.lineWidth = 3.4; g.strokeStyle = '#8b94a5'; g.stroke();
        g.lineWidth = 1; g.strokeStyle = '#eef2f7';
        g.beginPath(); g.ellipse(0, -2.8, 15, 22, 0, sx < 0 ? PI * 1.05 : PI * 1.55, sx < 0 ? PI * 1.4 : PI * 1.9); g.stroke();
      }
      // iç dişler (birbirine geçmiş)
      for (let i = 0; i < 6; i++) {
        const y = -18 + i * 3.1, side = i % 2 ? 1 : -1;
        const xr = Math.sqrt(Math.max(0, 1 - Math.pow((y + 2) / 22, 2))) * 15 - 2;
        g.beginPath(); g.moveTo(side * xr, y - 1.6); g.lineTo(-side * 2.4, y); g.lineTo(side * xr, y + 1.6); g.closePath();
        g.lineWidth = 1.2; g.strokeStyle = '#141821'; g.stroke(); g.fillStyle = '#dfe4ec'; g.fill();
      }
      // taban
      g.beginPath(); g.ellipse(0, -1.5, 10, 2.6, 0, 0, TAU);
      g.fillStyle = '#4b5263'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#141821'; g.stroke();
    });
  }

  /* ---------- ELEKTRİK AĞI ---------- */
  function netPoleSprite() {
    return sp('net:pole', 22, 104, 11, 94, g => {
      g.lineJoin = 'round';
      // üçgen ayak
      g.beginPath(); g.moveTo(-7.5, 3); g.lineTo(0, -9); g.lineTo(7.5, 3); g.closePath();
      g.fillStyle = '#4a5162'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#141821'; g.stroke();
      // çubuk
      gfx.rr(g, -2.5, -80, 5, 83, 2.4);
      const rg = g.createLinearGradient(-2.5, 0, 2.5, 0);
      rg.addColorStop(0, '#4c5464'); rg.addColorStop(.35, '#e4e8ef'); rg.addColorStop(.65, '#8c95a6'); rg.addColorStop(1, '#2c3240');
      g.fillStyle = rg; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#141821'; g.stroke();
      // kırmızı-beyaz uyarı şeritleri
      g.fillStyle = '#e23b3b';
      for (let i = 0; i < 3; i++) { g.fillRect(-2.5, -30 - i * 9, 5, 3.2); }
      // bakır bobin halkaları
      for (let i = 0; i < 4; i++) {
        const y = -78.5 + i * 3.4;
        g.beginPath(); g.ellipse(0, y, 5.4, 1.9, 0, 0, TAU);
        g.fillStyle = '#d9822b'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#4a2208'; g.stroke();
        g.beginPath(); g.ellipse(-1.6, y - .6, 2, .55, 0, 0, TAU); g.fillStyle = 'rgba(255,230,180,.8)'; g.fill();
      }
      // tepe küre
      g.beginPath(); g.arc(0, -87, 5.4, 0, TAU);
      const og = g.createRadialGradient(-1.8, -89, .5, 0, -87, 5.4);
      og.addColorStop(0, '#ffffff'); og.addColorStop(.45, '#8ff0ff'); og.addColorStop(1, '#1b84d1');
      g.fillStyle = og; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0b3360'; g.stroke();
    });
  }
  function netMeshSprite(w, h) {
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    return sp('net:mesh:' + w + 'x' + h, w + 8, h + 8, 4, 4, g => {
      const cell = 10.5;
      const lines = () => {
        g.beginPath();
        for (let d = -h; d < w + h; d += cell) { g.moveTo(d, 0); g.lineTo(d + h, h); g.moveTo(d + h, 0); g.lineTo(d, h); }
      };
      g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
      g.lineCap = 'round';
      lines(); g.lineWidth = 2.8; g.strokeStyle = 'rgba(14,70,170,.85)'; g.stroke();
      lines(); g.lineWidth = 1.2; g.strokeStyle = '#a8f4ff'; g.stroke();
      // düğüm noktaları
      g.fillStyle = '#ffffff';
      for (let y = 0; y <= h + .1; y += cell / 2) {
        const row = Math.round(y / (cell / 2));
        for (let x = (row % 2) * cell / 2; x <= w; x += cell) { g.beginPath(); g.arc(x, y, .9, 0, TAU); g.fill(); }
      }
      g.restore();
      // üst ve alt kablolar
      for (const y of [0, h]) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y);
        g.lineWidth = 3.2; g.strokeStyle = '#0d3a73'; g.stroke();
        g.lineWidth = 1.4; g.strokeStyle = '#9ff3ff'; g.stroke();
      }
    });
  }
  function netMeshGlowSprite(w, h) {
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    return sp('net:glow:' + w + 'x' + h, w + 24, h + 24, 12, 12, g => {
      const cell = 10.5;
      g.save(); g.beginPath(); g.rect(-6, -6, w + 12, h + 12); g.clip();
      g.beginPath();
      for (let d = -h; d < w + h; d += cell) { g.moveTo(d, 0); g.lineTo(d + h, h); g.moveTo(d + h, 0); g.lineTo(d, h); }
      g.lineCap = 'round';
      g.lineWidth = 6; g.strokeStyle = 'rgba(40,150,255,.2)'; g.stroke();
      g.lineWidth = 2.4; g.strokeStyle = 'rgba(90,210,255,.4)'; g.stroke();
      g.restore();
    });
  }

  /* ---------- FÜZE ---------- */
  function misSprite() {
    return sp('mis', 56, 34, 28, 17, g => {
      g.lineJoin = 'round';
      const finCol = g.createLinearGradient(0, -14, 0, 14);
      finCol.addColorStop(0, '#ff6a5a'); finCol.addColorStop(.5, '#d0232a'); finCol.addColorStop(1, '#7a0d10');
      // arka kanatçıklar
      for (const sy of [-1, 1]) {
        g.beginPath(); g.moveTo(-15, sy * 5); g.lineTo(-22.5, sy * 13.5); g.lineTo(-17, sy * 13.5); g.lineTo(-8, sy * 5); g.closePath();
        g.fillStyle = finCol; g.fill(); g.lineWidth = 1.7; g.strokeStyle = '#250406'; g.stroke();
      }
      // egzoz nozulu
      g.beginPath(); g.moveTo(-16, -4.2); g.lineTo(-21.5, -6); g.lineTo(-21.5, 6); g.lineTo(-16, 4.2); g.closePath();
      const ng = g.createLinearGradient(0, -6, 0, 6);
      ng.addColorStop(0, '#9aa3b2'); ng.addColorStop(.4, '#4b5263'); ng.addColorStop(1, '#1d2230');
      g.fillStyle = ng; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#0d0f16'; g.stroke();
      // gövde
      const body = () => { g.beginPath(); g.moveTo(-16, -6.2); g.lineTo(10, -6.2); g.lineTo(10, 6.2); g.lineTo(-16, 6.2); g.quadraticCurveTo(-17.5, 0, -16, -6.2); g.closePath(); };
      body();
      const bg = g.createLinearGradient(0, -6.2, 0, 6.2);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(.3, '#eef1f6'); bg.addColorStop(.7, '#b7bfcc'); bg.addColorStop(1, '#7a8394');
      g.fillStyle = bg; g.fill();
      g.save(); body(); g.clip();
      g.fillStyle = '#d0232a'; g.fillRect(-6, -7, 3.6, 14);
      g.fillStyle = '#ffd23f'; g.fillRect(-13, -7, 2.2, 14);
      g.fillStyle = '#1d2230'; for (let i = 0; i < 3; i++) g.fillRect(-13, -7 + i * 5, 2.2, 2.4);
      g.restore();
      body(); g.lineWidth = 1.8; g.strokeStyle = '#141821'; g.stroke();
      // orta kanatçık (yandan)
      g.beginPath(); g.moveTo(-15, -1.3); g.lineTo(-7, -1.3); g.lineTo(-5.5, 0); g.lineTo(-7, 1.3); g.lineTo(-15, 1.3); g.closePath();
      g.fillStyle = '#9e1418'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#250406'; g.stroke();
      // burun konisi
      g.beginPath(); g.moveTo(9.6, -6.2); g.bezierCurveTo(16, -6.2, 21.5, -2.4, 23, 0); g.bezierCurveTo(21.5, 2.4, 16, 6.2, 9.6, 6.2); g.closePath();
      const cg = g.createLinearGradient(0, -6.2, 0, 6.2);
      cg.addColorStop(0, '#ff9a8a'); cg.addColorStop(.35, '#e8333a'); cg.addColorStop(1, '#7a0d10');
      g.fillStyle = cg; g.fill(); g.lineWidth = 1.8; g.strokeStyle = '#250406'; g.stroke();
      // lomboz
      g.beginPath(); g.arc(3.2, -.4, 2.7, 0, TAU);
      const wg = g.createRadialGradient(2.2, -1.4, .3, 3.2, -.4, 2.7);
      wg.addColorStop(0, '#bfe9ff'); wg.addColorStop(1, '#1f4f8a');
      g.fillStyle = wg; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#141821'; g.stroke();
      // üst parlama
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-13.5, -4.3); g.lineTo(7.5, -4.3); g.stroke();
      g.beginPath(); g.moveTo(12, -4.3); g.quadraticCurveTo(16, -3.8, 18.5, -2.2); g.stroke();
    });
  }
  function misFlameSprite() {      // −x yönüne uzanan alev, orijin nozul ağzı
    return sp('mis:flame', 52, 24, 48, 12, g => {
      const tear = (L, H, col) => {
        g.beginPath(); g.moveTo(0, -H);
        g.bezierCurveTo(-L * .35, -H * 1.05, -L * .7, -H * .55, -L, 0);
        g.bezierCurveTo(-L * .7, H * .55, -L * .35, H * 1.05, 0, H);
        g.closePath(); g.fillStyle = col; g.fill();
      };
      const og = g.createLinearGradient(0, 0, -46, 0);
      og.addColorStop(0, '#ff7a2a'); og.addColorStop(.6, 'rgba(255,60,20,.85)'); og.addColorStop(1, 'rgba(200,30,10,0)');
      tear(46, 7.5, og);
      const mg = g.createLinearGradient(0, 0, -30, 0);
      mg.addColorStop(0, '#ffe14d'); mg.addColorStop(1, 'rgba(255,170,40,.2)');
      tear(30, 5, mg);
      const cg = g.createLinearGradient(0, 0, -16, 0);
      cg.addColorStop(0, '#ffffff'); cg.addColorStop(1, 'rgba(255,250,220,.3)');
      tear(16, 3, cg);
    });
  }
  function reticleSprite() {
    return sp('ret:outer', 104, 104, 52, 52, g => {
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a0 = i * PI / 2 + .28, a1 = (i + 1) * PI / 2 - .28;
        g.beginPath(); g.arc(0, 0, 36, a0, a1);
        g.lineWidth = 7; g.strokeStyle = 'rgba(40,4,8,.85)'; g.stroke();
        g.lineWidth = 3.6; g.strokeStyle = '#ff3b30'; g.stroke();
        g.lineWidth = 1.2; g.strokeStyle = '#ffb3a8';
        g.beginPath(); g.arc(0, 0, 36.6, a0 + .08, a1 - .08); g.stroke();
      }
      // içe bakan üçgen işaretler
      g.lineJoin = 'round';
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2, c = Math.cos(a), s = Math.sin(a);
        g.beginPath();
        g.moveTo(c * 27, s * 27);
        g.lineTo(c * 44 - s * 6, s * 44 + c * 6);
        g.lineTo(c * 44 + s * 6, s * 44 - c * 6);
        g.closePath();
        g.lineWidth = 3.4; g.strokeStyle = 'rgba(40,4,8,.9)'; g.stroke();
        g.fillStyle = '#ff5246'; g.fill();
      }
    });
  }
  function reticleInnerSprite() {
    return sp('ret:inner', 64, 64, 32, 32, g => {
      g.lineCap = 'round';
      for (let i = 0; i < 12; i++) {
        const a = i * TAU / 12;
        g.beginPath(); g.arc(0, 0, 20, a + .06, a + TAU / 12 - .2);
        g.lineWidth = 4; g.strokeStyle = 'rgba(40,4,8,.7)'; g.stroke();
        g.lineWidth = 2; g.strokeStyle = '#ff7a6a'; g.stroke();
      }
      // artı işareti (merkez boşluklu)
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2 + PI / 4, c = Math.cos(a), s = Math.sin(a);
        g.beginPath(); g.moveTo(c * 6, s * 6); g.lineTo(c * 14, s * 14);
        g.lineWidth = 4.4; g.strokeStyle = 'rgba(40,4,8,.8)'; g.stroke();
        g.lineWidth = 2.2; g.strokeStyle = '#ffffff'; g.stroke();
      }
      g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fillStyle = '#ff3b30'; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(40,4,8,.8)'; g.stroke();
    });
  }
  function alertSprite() {
    return sp('alert', 34, 34, 17, 19, g => {
      g.lineJoin = 'round';
      const tri = () => { g.beginPath(); g.moveTo(0, -13); g.lineTo(13, 9.5); g.lineTo(-13, 9.5); g.closePath(); };
      tri(); g.lineWidth = 7.5; g.strokeStyle = '#2a0508'; g.stroke();
      const gr = g.createLinearGradient(0, -13, 0, 9.5);
      gr.addColorStop(0, '#ff8a76'); gr.addColorStop(.6, '#e8262c'); gr.addColorStop(1, '#a8121a');
      tri(); g.lineWidth = 3.5; g.strokeStyle = gr; g.stroke(); g.fillStyle = gr; g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath(); g.moveTo(0, -10.5); g.lineTo(-6.5, 1); g.lineTo(-3, 1); g.lineTo(0, -5); g.closePath(); g.fill();
      g.fillStyle = '#ffffff';
      gfx.rr(g, -1.9, -6.4, 3.8, 9.4, 1.9); g.fill();
      g.beginPath(); g.arc(0, 6.4, 2.1, 0, TAU); g.fill();
    });
  }

  /* ---------- FIRTINA BULUTU ---------- */
  const CLOUD = [[0, 0, 16.5], [-16, 4, 12.5], [16, 4, 13], [-8, -8.5, 13.5], [9, -9, 12.5], [-27, 8, 8.5], [27, 8, 8.5], [0, 9, 13]];
  function cloudSprite(dark) {
    return sp('cloud:' + (dark ? 1 : 0), 88, 56, 44, 28, g => {
      const path = () => { g.beginPath(); for (const c of CLOUD) { g.moveTo(c[0] + c[2], c[1]); g.arc(c[0], c[1], c[2], 0, TAU); } };
      path(); g.lineWidth = 4.4; g.strokeStyle = dark ? '#06050b' : '#14131e'; g.stroke();
      const gr = g.createLinearGradient(0, -24, 0, 22);
      if (dark) { gr.addColorStop(0, '#4c4664'); gr.addColorStop(.5, '#2a2539'); gr.addColorStop(1, '#141120'); }
      else { gr.addColorStop(0, '#9599b5'); gr.addColorStop(.5, '#5b5f7a'); gr.addColorStop(1, '#353850'); }
      path(); g.fillStyle = gr; g.fill();
      // üst kabarıklık vurguları
      for (const c of CLOUD) {
        if (c[1] > 2) continue;
        g.beginPath(); g.ellipse(c[0] - c[2] * .2, c[1] - c[2] * .45, c[2] * .55, c[2] * .3, -.2, 0, TAU);
        g.fillStyle = dark ? 'rgba(160,140,220,.16)' : 'rgba(255,255,255,.2)'; g.fill();
      }
      // alt koyu şerit
      g.save(); path(); g.clip();
      g.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(10,10,30,.25)';
      g.beginPath(); g.ellipse(0, 20, 40, 9, 0, 0, TAU); g.fill();
      g.restore();
    });
  }

  /* ---------- MIKNATIS ---------- */
  function magnetSprite() {
    return sp('magnet', 34, 34, 17, 15, g => {
      g.lineJoin = 'round';
      const U = () => {
        g.beginPath();
        g.moveTo(-11, -10); g.lineTo(-11, 0); g.arc(0, 0, 11, PI, 0, true);
        g.lineTo(11, -10); g.lineTo(4.6, -10); g.lineTo(4.6, 0); g.arc(0, 0, 4.6, 0, PI, false);
        g.lineTo(-4.6, -10); g.closePath();
      };
      U(); g.lineWidth = 3.4; g.strokeStyle = '#2a0508'; g.stroke();
      const gr = g.createLinearGradient(-11, 0, 11, 0);
      gr.addColorStop(0, '#b3121b'); gr.addColorStop(.3, '#ff6a5a'); gr.addColorStop(.6, '#e8262c'); gr.addColorStop(1, '#8a0c12');
      g.fillStyle = gr; g.fill();
      // gümüş uçlar
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -11 : 4.6;
        g.beginPath(); g.rect(x0, -10, 6.4, 4.6);
        const sg = g.createLinearGradient(x0, 0, x0 + 6.4, 0);
        sg.addColorStop(0, '#9aa3b2'); sg.addColorStop(.4, '#ffffff'); sg.addColorStop(1, '#7a8394');
        g.fillStyle = sg; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#141821'; g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1.4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-8.6, -4); g.lineTo(-8.6, .5); g.stroke();
      g.beginPath(); g.arc(0, 0, 8.6, PI * .95, PI * .7, true); g.stroke();
    });
  }

  /* ---------- KARGA ---------- */
  function crowWing(g, lift, far) {
    g.save();
    g.translate(far ? 3.5 : -.5, far ? -4 : -1.5);
    g.rotate(lift * 1.1 - .1);
    if (far) g.scale(.88, .88);
    const base = far ? '#0f0e15' : '#1f1c29', hi = far ? '#2a2638' : '#4e4668';
    g.beginPath();
    g.moveTo(3, -2.5);
    g.bezierCurveTo(-4, -9, -15, -8.5, -25, -4);
    g.lineTo(-21.5, -1); g.lineTo(-24, 1.5); g.lineTo(-18.5, 1.6); g.lineTo(-19.5, 4.8); g.lineTo(-14.2, 3.6);
    g.lineTo(-14, 6.8); g.lineTo(-9.2, 4.6); g.lineTo(-7, 7.2); g.lineTo(-3, 4.2);
    g.quadraticCurveTo(1.5, 3, 3, -2.5);
    g.closePath();
    g.lineWidth = 2.2; g.strokeStyle = '#040406'; g.stroke();
    const gr = g.createLinearGradient(0, -9, 0, 7);
    gr.addColorStop(0, hi); gr.addColorStop(1, base);
    g.fillStyle = gr; g.fill();
    g.strokeStyle = far ? 'rgba(120,110,170,.2)' : 'rgba(150,135,210,.4)'; g.lineWidth = .9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-4, -3.5); g.lineTo(-18, -.5); g.moveTo(-6, -.2); g.lineTo(-13, 3); g.stroke();
    g.restore();
  }
  function crowSprite(f) {
    return sp('crow:' + f, 60, 50, 30, 25, g => {
      const lift = Math.sin(f / 6 * TAU);
      g.lineJoin = 'round'; g.lineCap = 'round';
      crowWing(g, -lift * .9 + .2, true);
      // kuyruk
      g.beginPath();
      g.moveTo(-7, -1); g.lineTo(-21, -5); g.lineTo(-19, -1.5); g.lineTo(-23, 0); g.lineTo(-19, 2.5); g.lineTo(-21.5, 5.5); g.lineTo(-7, 4.5); g.closePath();
      g.lineWidth = 2.2; g.strokeStyle = '#040406'; g.stroke();
      g.fillStyle = '#1a1824'; g.fill();
      // gövde
      g.beginPath(); g.ellipse(0, 1.5, 11.5, 7.6, -.12, 0, TAU);
      g.lineWidth = 2.4; g.strokeStyle = '#040406'; g.stroke();
      const bg = g.createLinearGradient(0, -6, 0, 9);
      bg.addColorStop(0, '#3e3858'); bg.addColorStop(.5, '#1d1b28'); bg.addColorStop(1, '#0c0b12');
      g.fillStyle = bg; g.fill();
      // kafa
      g.beginPath(); g.arc(10.5, -4.2, 6.8, 0, TAU);
      g.lineWidth = 2.4; g.strokeStyle = '#040406'; g.stroke();
      const hg = g.createRadialGradient(8.5, -7, 1, 10.5, -4.2, 7);
      hg.addColorStop(0, '#4a4468'); hg.addColorStop(1, '#14121c');
      g.fillStyle = hg; g.fill();
      // tepe tüyleri
      g.beginPath(); g.moveTo(7, -9.5); g.quadraticCurveTo(5, -15, 2.5, -14.5); g.quadraticCurveTo(6, -12.5, 9.5, -10.2);
      g.moveTo(9.5, -10.5); g.quadraticCurveTo(9.5, -16, 7, -16.5); g.quadraticCurveTo(10.5, -14, 12, -10.6);
      g.fillStyle = '#1d1b28'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#040406'; g.stroke();
      // gaga
      g.beginPath(); g.moveTo(15.5, -6.8); g.quadraticCurveTo(21, -6, 25, -3.2); g.lineTo(15.8, -2.2); g.closePath();
      const kg = g.createLinearGradient(0, -7, 0, -2);
      kg.addColorStop(0, '#ffd27a'); kg.addColorStop(1, '#e08a12');
      g.fillStyle = kg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#3a1d02'; g.stroke();
      g.beginPath(); g.moveTo(15.8, -2.4); g.lineTo(23, -2.9); g.lineTo(15.8, -.6); g.closePath();
      g.fillStyle = '#b86a0a'; g.fill(); g.stroke();
      // kızgın göz
      g.beginPath(); g.arc(12, -5.6, 2.3, 0, TAU); g.fillStyle = '#ff2a2a'; g.fill();
      g.lineWidth = .8; g.strokeStyle = '#3a0000'; g.stroke();
      g.beginPath(); g.arc(12.6, -6.2, .8, 0, TAU); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.moveTo(9, -9.2); g.lineTo(15, -7.2); g.lineWidth = 1.8; g.strokeStyle = '#040406'; g.stroke();
      // göğüs parlaması
      g.beginPath(); g.ellipse(-1, -2.5, 6, 2, -.15, 0, TAU); g.fillStyle = 'rgba(160,140,230,.18)'; g.fill();
      crowWing(g, lift, false);
    });
  }

  /* =====================================================================
     VARLIK ÇİZİMİ
     ===================================================================== */
  function drawSaw(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0), r = num(e.r, 15), sc = r / 15;
    if (!inView(x, y, 60)) return;
    const v = vis(e);
    const life = num(e.life, 1), age = num(e.age, 0);
    let a = life < .3 ? Math.max(0, life / .3) : 1;
    const pop = age < .12 ? .6 + age / .12 * .4 : 1;
    const s2 = sc * pop;
    const grounded = Math.abs(num(e.vy, 0)) < 6 && age > .03;
    if (grounded) {
      ctx.globalAlpha = .32 * a; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y + r + 1.5, 17 * sc, 3.4 * sc, 0, 0, TAU); ctx.fill();
    }
    const vx = num(e.vx, 0), dir = vx < 0 ? -1 : 1, spd = Math.abs(vx);
    const rotS = sawRotSprite(), blurS = sawBlurSprite();
    danger(ctx, x, y, 42 * sc, a);
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = a * .13 * (4 - i) / 3 * clamp(spd / 500, 0, 1);
      spr(ctx, rotS, x - dir * i * 7 * clamp(spd / 700, .3, 1.4), y, v.rot - dir * i * .35, s2);
    }
    ctx.globalAlpha = a;
    spr(ctx, rotS, x, y, v.rot, s2);
    ctx.globalAlpha = a * clamp(spd / 1000, 0, .65);
    spr(ctx, blurS, x, y, v.rot, s2);
    ctx.globalAlpha = a;
    spr(ctx, sawHlSprite(), x, y, 0, s2);
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  const DYN_SC = 1.22, MIS_SC = 1.12, TRAP_SC = 1.4;   // kapan büyük ve okunur (oyuncu geri bildirimi: 'kapan gözükmüyor')
  function dynTip(e, v) {
    const age = num(e.age, 0), fuse = Math.max(.1, num(e.fuse, 1));
    const u = clamp(1 - age / fuse, .06, 1);
    // ikinci derece bezier P0(0,-14) P1(0,-23) P2(8,-25)
    const bx = 2 * (1 - u) * u * 0 + u * u * 8, by = (1 - u) * (1 - u) * -14 + 2 * (1 - u) * u * -23 + u * u * -25;
    const c = Math.cos(v.rot) * DYN_SC, s = Math.sin(v.rot) * DYN_SC;
    return { lx: bx, ly: by, x: num(e.x, 0) + c * bx - s * by, y: num(e.y, 0) + s * bx + c * by, u };
  }
  function drawDyn(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0);
    if (!inView(x, y, 70)) return;
    const v = vis(e), age = num(e.age, 0), fuse = Math.max(.1, num(e.fuse, 1));
    const prog = clamp(age / fuse, 0, 1);
    const tip = dynTip(e, v);
    danger(ctx, x, y, 30, .55 + .4 * prog);
    // uyarı nabzı (fitil sonuna doğru hızlanır)
    if (prog > .45) {
      const f = 10 + 40 * prog, pulse = .5 + .5 * Math.sin(age * f);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (prog - .45) / .55 * (.35 + .45 * pulse);
      spr(ctx, glowSprite('#ff3b2a'), x, y, 0, 34 / 32);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    const sq = prog > .8 ? 1 + .08 * Math.sin(age * 60) : 1;
    spr(ctx, dynSprite(), x, y, v.rot, DYN_SC * sq, DYN_SC / sq);
    // fitil (yerel koordinatta, gövdeyle birlikte döner)
    setXf(ctx, x, y, v.rot, DYN_SC, DYN_SC);
    const u = tip.u;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const t = u * i / N;
      const bx = t * t * 8, by = (1 - t) * (1 - t) * -14 + 2 * (1 - t) * t * -23 + t * t * -25;
      if (i) ctx.lineTo(bx, by); else ctx.moveTo(bx, by);
    }
    ctx.lineWidth = 3; ctx.strokeStyle = '#1f140a'; ctx.stroke();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#a8854f'; ctx.stroke();
    ctx.lineWidth = .7; ctx.strokeStyle = 'rgba(255,240,200,.6)'; ctx.setLineDash ? ctx.setLineDash([1.4, 1.6]) : 0; ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    // yanan uç
    ctx.beginPath(); ctx.arc(tip.lx, tip.ly, 1.6, 0, TAU); ctx.fillStyle = '#ff6a1a'; ctx.fill();
    resetXf(ctx);
    // cızırtı parıltısı
    ctx.globalCompositeOperation = 'lighter';
    const fl = .75 + .25 * Math.sin(age * 47) + rnd() * .2;
    ctx.globalAlpha = .9;
    spr(ctx, glowSprite('#ffa03a'), tip.x, tip.y, 0, 16 / 32 * fl);
    spr(ctx, twinkleSprite('#ffe14d'), tip.x, tip.y, age * 13, .5 * fl);
    ctx.globalCompositeOperation = 'source-over';
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function drawTrap(ctx, e) {
    const w = num(e.w, 34), h = num(e.h, 12);
    const x = num(e.x, 0) + w / 2, y = num(e.y, 0) + h;
    if (!inView(x, y, 60)) return;
    const v = vis(e), age = num(e.age, 0), life = num(e.life, 10);
    if (e.fly) {
      // fırlatılan tuzak (yönlü atış): havada takla atan kapalı çeneler + tehlike halesi
      danger(ctx, x, y - h / 2, 26, .7);
      spr(ctx, trapClosedSprite(), x, y - h / 2 + 4, num(v.spin, 0), .66 * TRAP_SC, .66 * TRAP_SC);
      resetXf(ctx);
      return;
    }
    let a = 1;
    if (life < 1.2) a = .35 + .65 * (Math.sin(life * 28) > -.3 ? 1 : 0);
    // zemin gölgesi
    ctx.globalAlpha = .3 * a; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + 1, 25, 4.2, 0, 0, TAU); ctx.fill();
    if (age < .5) {
      // henüz kurulmadı: kapalı, soluk, hafif titrer
      ctx.globalAlpha = (.45 + .15 * Math.sin(age * 30)) * a;
      spr(ctx, trapClosedSprite(), x, y, 0, .66 * TRAP_SC, .66 * TRAP_SC);
    } else {
      const t = age - .5;
      const sy = t < .16 ? lerp(.55, 1.18, t / .16) : t < .3 ? lerp(1.18, 1, (t - .16) / .14) : 1;
      const sx = t < .16 ? lerp(1.1, .94, t / .16) : t < .3 ? lerp(.94, 1, (t - .16) / .14) : 1;
      danger(ctx, x, y - 5, 34, a * .8);   // kurulu tuzak: zeminde kırmızı tehlike halesi
      ctx.globalAlpha = a;
      spr(ctx, trapOpenSprite(), x, y, 0, sx * TRAP_SC, sy * TRAP_SC);
      // dişler boyunca kayan tehlike parıltısı
      const ph = ((age + v.seed) % 1.9) / 1.9;
      if (ph < .35) {
        const q = ph / .35, ang = PI + .3 + q * (PI - .6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * Math.sin(q * PI) * .95;
        spr(ctx, twinkleSprite('#ffffff'), x + Math.cos(ang) * 19.5 * TRAP_SC, y + (-4 + Math.sin(ang) * 6.4 - 6) * TRAP_SC, q * 3, .42);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  /* kapanan tuzak dekali (trap:snap olayından) */
  const snaps = [];
  function drawSnaps(ctx) {
    for (const s of snaps) {
      if (!inView(s.x, s.y, 60)) continue;
      const t = s.t;
      const a = t < .55 ? 1 : Math.max(0, 1 - (t - .55) / .35);
      const jit = t < .25 ? (rnd() - .5) * 3 : 0;
      const sc = t < .08 ? lerp(1.35, .92, t / .08) : t < .18 ? lerp(.92, 1, (t - .08) / .1) : 1;
      ctx.globalAlpha = .3 * a; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 1, 22, 4, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = a;
      spr(ctx, trapClosedSprite(), s.x + jit, s.y, 0, sc * .95 * TRAP_SC, sc * TRAP_SC);
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function drawNet(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0), w = num(e.w, 44), h = num(e.h, 76);
    if (!inView(x + w / 2, y + h / 2, 90)) return;
    const v = vis(e), age = num(e.age, 0), life = num(e.life, 10);
    if (e.fly) {
      // fırlatılan ağ (yönlü atış): katlanmış direk demeti havada döner, tepe küreleri parlar
      const cx = x + w / 2, cy = y + h / 2, sp0 = num(v.spin, 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .4 + .2 * Math.sin(v.t * 20);
      spr(ctx, glowSprite('#7be3ff'), cx, cy, 0, 1.1);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      // iki direk, demetin merkezi etrafında (direk orijini tabanı: 47 birim aşağı kaydır)
      for (const s of [-1, 1]) {
        const ox = s * 4, c = Math.cos(sp0), sn = Math.sin(sp0);
        spr(ctx, netPoleSprite(), cx + c * ox + sn * 47, cy + sn * ox - c * 47, sp0 + s * .12, .9, .9);
      }
      resetXf(ctx);
      return;
    }
    const active = age > .6;
    let a = 1;
    if (life < 1.2) a = .35 + .65 * (Math.sin(life * 26) > -.2 ? 1 : 0);
    const ground = y + h;
    // yere oturan ağ: iniş anından itibaren yeniden "açılır" (uçarken age tutulduğu için inişte sıfırdan)
    const rt = v.landT != null ? Math.min(age, v.t - v.landT) : age;
    const rise = clamp(easeOutBack(clamp(rt / .38, 0, 1)), 0, 1.15);
    // zemin gölgeleri
    ctx.globalAlpha = .28 * a; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x + 2, ground + 2, 9, 2.6, 0, 0, TAU); ctx.ellipse(x + w - 2, ground + 2, 9, 2.6, 0, 0, TAU); ctx.fill();
    // ağ
    const mx = x + 4, my = y + 2, mw = w - 8, mh = h - 8;
    const meshA = active ? 1 : clamp((age - .25) / .35, 0, 1) * .45;
    if (active) danger(ctx, x + w / 2, y + h * .55, 52, a * .55);   // aktif ağ: ortak tehlike halesi (mavi arklar kimliği korur)
    if (meshA > 0) {
      const flick = active ? .82 + .18 * Math.sin(age * 31 + v.seed) * Math.sin(age * 17) : 1;
      const r1 = Math.max(.02, Math.min(1, rise)), top = my + mh * (1 - r1);
      // enerji alanı zemini (her temada elektrik mavisi okunsun)
      const bg = ctx.createLinearGradient(0, top, 0, my + mh);
      bg.addColorStop(0, 'rgba(60,175,255,.3)'); bg.addColorStop(.6, 'rgba(30,110,220,.42)'); bg.addColorStop(1, 'rgba(18,70,180,.55)');
      ctx.globalAlpha = a * meshA; ctx.fillStyle = bg;
      ctx.fillRect(mx, top, mw, mh * r1);
      ctx.globalAlpha = a * meshA * (active ? .92 : 1);
      spr(ctx, netMeshSprite(mw, mh), mx, top, 0, 1, r1);
      if (active) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * .55 * flick * (e.n > 0 ? 1.3 : 1);
        spr(ctx, netMeshGlowSprite(mw, mh), mx, my, 0, 1);
        ctx.globalAlpha = a * .22 * flick;
        spr(ctx, glowSprite('#2f9dff'), x + w / 2, y + h / 2, 0, 58 / 32, 70 / 32);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // direkler
    ctx.globalAlpha = a;
    spr(ctx, netPoleSprite(), x + 2, ground + (1 - Math.min(1, rise)) * 30, 0, 1, Math.max(.05, rise));
    spr(ctx, netPoleSprite(), x + w - 2, ground + (1 - Math.min(1, rise)) * 30, 0, -1, Math.max(.05, rise));
    resetXf(ctx);
    // elektrik arkları
    if (active && v.arcs) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const arc of v.arcs) {
        polyline(ctx, arc);
        ctx.globalAlpha = a * .55; ctx.lineWidth = 3.6; ctx.strokeStyle = '#1452b8'; ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const arc of v.arcs) {
        polyline(ctx, arc);
        ctx.globalAlpha = a * .45; ctx.lineWidth = 6; ctx.strokeStyle = '#3fb8ff'; ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = 1.5; ctx.strokeStyle = '#ecfdff'; ctx.stroke();
      }
      // direk tepesindeki küre parlaması
      const pul = .7 + .3 * Math.sin(age * 21 + v.seed);
      ctx.globalAlpha = a * .9 * pul;
      spr(ctx, glowSprite('#7be3ff'), x + 2, ground - 87, 0, 18 / 32);
      spr(ctx, glowSprite('#7be3ff'), x + w - 2, ground - 87, 0, 18 / 32);
      ctx.globalCompositeOperation = 'source-over';
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function misAngle(e, v) {
    const t = e.tgt;
    const age = num(e.age, 0), warn = num(e.warn, 1);
    if (age < warn) {
      let ta = -PI / 2;
      if (t) ta = Math.atan2(rcy(t) - num(e.y, 0), rcx(t) - num(e.x, 0));
      const q = easeOutCubic(clamp(age / Math.max(.1, warn), 0, 1));
      let d = ta - (-PI / 2); while (d > PI) d -= TAU; while (d < -PI) d += TAU;
      return -PI / 2 + d * q + Math.sin(age * 9) * .06 * (1 - q);
    }
    const vx = num(e.vx, 0), vy = num(e.vy, 0);
    if (Math.abs(vx) + Math.abs(vy) > 1) return Math.atan2(vy, vx);
    return v.ang !== undefined ? v.ang : 0;
  }
  function drawMis(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0);
    if (!inView(x, y, 80)) return;
    const v = vis(e), age = num(e.age, 0), warn = num(e.warn, 1);
    const flying = age >= warn;
    const ang = misAngle(e, v); v.ang = ang;
    const bob = flying ? 0 : Math.sin(age * 7) * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const nx = x - ca * 21 * MIS_SC, ny = y + bob - sa * 21 * MIS_SC;
    danger(ctx, x, y + bob, 36, flying ? .95 : .6);
    // egzoz alevi + ışık
    const fl = flying ? 1.05 + rnd() * .3 : .38 + rnd() * .14;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flying ? .85 : .5;
    spr(ctx, glowSprite('#ff8a2a'), nx - ca * 8, ny - sa * 8, 0, (flying ? 30 : 16) / 32);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    spr(ctx, misFlameSprite(), nx + ca * 1, ny + sa * 1, ang, fl * MIS_SC, (.8 + rnd() * .3) * MIS_SC);
    // gövde
    const pop = (age < .15 ? easeOutBack(age / .15) : 1) * MIS_SC;
    spr(ctx, misSprite(), x, y + bob, ang, pop);
    // yanıp sönen kırmızı kilit ışığı
    if (!flying && Math.sin(age * 22) > 0) {
      ctx.globalCompositeOperation = 'lighter';
      spr(ctx, glowSprite('#ff2a2a'), x + ca * 3 - sa * -5, y + bob + sa * 3 + ca * -5, 0, 9 / 32);
      ctx.globalCompositeOperation = 'source-over';
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }
  function drawMisReticle(ctx, e) {
    const t = e.tgt;
    if (!t || t.dead > 0 || t.finished) return;
    const tx = rcx(t), ty = rcy(t);
    if (!inView(tx, ty, 80)) return;
    const age = num(e.age, 0), warn = Math.max(.1, num(e.warn, 1));
    const flying = age >= warn;
    const q = clamp(age / warn, 0, 1);
    let sc, a;
    if (!flying) { sc = lerp(1.9, 1, easeOutCubic(q)) * (1 + .06 * Math.sin(age * 16)); a = Math.min(1, age / .12); }
    else { sc = .72 + .05 * Math.sin(age * 30); a = Math.sin(age * 26) > -.4 ? .95 : .45; }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * .35;
    spr(ctx, glowSprite('#ff2a1a'), tx, ty, 0, 40 * sc / 32);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    spr(ctx, reticleSprite(), tx, ty, age * (flying ? 5 : 2.2), sc);
    spr(ctx, reticleInnerSprite(), tx, ty, -age * 3.4, sc);
    // "!" uyarısı
    const bounce = Math.abs(Math.sin(age * 8)) * 4;
    const as = (!flying ? (age < .2 ? easeOutBack(age / .2) : 1) : .8) * .85;
    ctx.globalAlpha = .82;
    spr(ctx, alertSprite(), tx + 30, ty - 16 - bounce, Math.sin(age * 10) * .08, as);
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function boltPos(e) {
    const t = e.tgt;
    if (!t) return null;
    return { x: rcx(t), y: num(t.y, 0) - 70 };
  }
  function drawBoltCloud(ctx, e) {
    const p = boltPos(e); if (!p) return;
    if (!inView(p.x, p.y, 90)) return;
    const v = vis(e), age = num(e.age, 0), tl = Math.max(0, num(e.t, 0));
    const app = age < .32 ? Math.max(.05, easeOutBack(age / .32)) : 1;
    const bob = Math.sin(age * 3 + v.seed) * 2;
    const cx = p.x, cy = p.y + bob;
    const dark = clamp(1 - tl / 1.8, 0, 1);
    // uyarı sütunu
    const t = e.tgt;
    if (tl < .75 && t) {
      const top = cy + 18 * app, bot = num(t.y, 0) - 4;
      if (bot > top) {
        const fl = .5 + .5 * Math.sin(age * 40), wa = (1 - tl / .75);
        const off = (age * 60) % 10;
        ctx.globalAlpha = wa * .35; ctx.fillStyle = '#2a1a05';
        for (let yy = top + off; yy < bot; yy += 10) ctx.fillRect(cx - 2.4, yy - 1, 4.8, Math.min(7, bot - yy + 1));
        ctx.globalAlpha = wa * (.55 + .45 * fl); ctx.fillStyle = '#ffe14d';
        for (let yy = top + off; yy < bot; yy += 10) ctx.fillRect(cx - 1.4, yy, 2.8, Math.min(5, bot - yy));
        // yerde hedef halkası
        const fy = num(t.y, 0) + (t.h || 42) + 1;
        ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffe14d';
        ctx.globalAlpha = wa * (.5 + .5 * fl);
        ctx.beginPath(); ctx.ellipse(cx, fy, 18 + 6 * fl, 4.5 + 1.5 * fl, 0, 0, TAU); ctx.stroke();
      }
    }
    danger(ctx, cx, cy + 2, 46 * app, .7);   // fırtına bulutu: tehlike halesi
    // yağmur
    ctx.strokeStyle = '#a9c8ff'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const ph = (age * 2.4 + i * .37 + v.seed) % 1;
      const rx = cx - 24 + i * 8 + Math.sin(i * 7.1) * 3, ry = cy + 14 + ph * 30;
      ctx.moveTo(rx, ry); ctx.lineTo(rx - 1.5, ry + 5);
    }
    ctx.globalAlpha = .55 * app; ctx.stroke();
    // bulut
    ctx.globalAlpha = 1;
    spr(ctx, cloudSprite(false), cx, cy, 0, app);
    if (dark > 0) { ctx.globalAlpha = dark; spr(ctx, cloudSprite(true), cx, cy, 0, app); }
    // içte çakan ışık
    if (v.flick > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = v.flick * .75;
      spr(ctx, glowSprite('#cfe2ff'), cx + v.fx, cy + 4, 0, 36 / 32);
      resetXf(ctx);
      if (v.inner) {
        polyline(ctx, v.inner);
        ctx.globalAlpha = v.flick; ctx.lineWidth = 1.6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function drawBoltDigit(ctx, e) {
    const p = boltPos(e); if (!p) return;
    if (!inView(p.x, p.y, 90)) return;
    const v = vis(e), age = num(e.age, 0), tl = Math.max(0, num(e.t, 0));
    const app = age < .32 ? Math.max(.05, easeOutBack(age / .32)) : 1;
    const n = Math.ceil(tl);
    if (n <= 0 || app < .6) return;
    const fr = tl - (n - 1);
    const sc = (1 + Math.pow(clamp(fr, 0, 1), 7) * .5) * Math.min(1, app);
    const bob = Math.sin(age * 3 + v.seed) * 2;
    ctx.globalAlpha = 1;
    spr(ctx, textSprite(String(n), '#ffe14d', 26), p.x, p.y + bob - 1, 0, sc);
    resetXf(ctx);
  }
  function flashGeom(e) {
    const t = e.tgt;
    const x = e.strike != null ? num(e.strike, 0) : (t ? rcx(t) : 0);
    const sy = e.sy != null ? num(e.sy, 0) : (t ? num(t.y, 0) : 0);
    return { x, top: sy - 70 + 12, bot: sy + 42, cy: sy - 70 };
  }
  function drawFlash(ctx, e) {
    const G = flashGeom(e);
    if (!inView(G.x, (G.top + G.bot) / 2, 140)) return;
    const v = vis(e);
    const k = clamp(num(e.flash, 0) / .3, 0, 1);
    // solmakta olan bulut
    ctx.globalAlpha = Math.min(1, k * 1.6);
    spr(ctx, cloudSprite(true), G.x, G.cy, 0, 1 + (1 - k) * .15);
    resetXf(ctx);
    if (!v.bolt) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // koyu alt çizgi (açık gökyüzünde okunurluk)
    ctx.globalAlpha = .5 * k; ctx.strokeStyle = '#1d3f9a';
    polyline(ctx, v.bolt); ctx.lineWidth = 10; ctx.stroke();
    for (const b of v.branches) { polyline(ctx, b); ctx.lineWidth = 6; ctx.stroke(); }
    ctx.globalCompositeOperation = 'lighter';
    // ışık sütunu
    ctx.globalAlpha = .35 * k;
    spr(ctx, glowSprite('#9fc8ff'), G.x, (G.top + G.bot) / 2, 0, 46 / 32, (G.bot - G.top) * .75 / 32);
    resetXf(ctx);
    const layers = [[24, '#5f9dff', .32], [9, '#d6ebff', .9], [3.6, '#ffffff', 1]];
    for (const L of layers) {
      ctx.globalAlpha = L[2] * k; ctx.strokeStyle = L[1];
      polyline(ctx, v.bolt); ctx.lineWidth = L[0]; ctx.stroke();
      for (const b of v.branches) { polyline(ctx, b); ctx.lineWidth = L[0] * .55; ctx.stroke(); }
    }
    // yere çarpma parlaması
    ctx.globalAlpha = k;
    spr(ctx, glowSprite('#bcd8ff'), G.x, G.bot, 0, (70 + 30 * (1 - k)) / 32);
    spr(ctx, glowSprite('#ffffff'), G.x, G.bot, 0, 22 / 32);
    resetXf(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = k * .9; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(G.x, G.bot + 1, 30 + 20 * (1 - k), 4.5, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawMag(ctx, e) {
    const o = e.o;
    if (!o) return;
    const cx = rcx(o), cy = rcy(o);
    if (!inView(cx, cy, 120)) return;
    const v = vis(e), age = num(e.age, v.t), tl = Math.max(0, num(e.t, 0));
    const p = clamp(1 - tl / .45, 0, 1);
    const fadeIn = Math.min(1, age / .08);
    const rr = 62 - 36 * easeOutCubic(p);
    // içe çeken alan halkası
    ctx.globalAlpha = .45 * fadeIn; ctx.lineWidth = 6; ctx.strokeStyle = '#3b0f6b';
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .55 * fadeIn;
    spr(ctx, glowSprite('#b066ff'), cx, cy, 0, (52 + 18 * p) / 32);
    resetXf(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = .95 * fadeIn; ctx.lineWidth = 3.2; ctx.strokeStyle = '#a855f7';
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.3; ctx.strokeStyle = '#f3e8ff'; ctx.stroke();
    // dönen alan yayları
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = age * 7 + i * TAU / 3;
      ctx.globalAlpha = .55 * fadeIn; ctx.lineWidth = 6; ctx.strokeStyle = '#3b0f6b';
      ctx.beginPath(); ctx.arc(cx, cy, rr + 10, a0, a0 + .95); ctx.stroke();
      ctx.globalAlpha = .95 * fadeIn; ctx.lineWidth = 3.4; ctx.strokeStyle = '#c084fc'; ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.globalAlpha = .8 * fadeIn; ctx.lineWidth = 2.2; ctx.strokeStyle = '#7e22ce';
      ctx.beginPath(); ctx.arc(cx, cy, rr * .62, -a0 * 1.3, -a0 * 1.3 + .7); ctx.stroke();
    }
    // mıknatıstan çıkan arklar
    if (v.arcs) {
      ctx.lineJoin = 'round';
      for (const arc of v.arcs) {
        polyline(ctx, arc);
        ctx.globalAlpha = .6 * fadeIn; ctx.lineWidth = 4.6; ctx.strokeStyle = '#6b21a8'; ctx.stroke();
        ctx.globalAlpha = fadeIn; ctx.lineWidth = 1.6; ctx.strokeStyle = '#f5edff'; ctx.stroke();
      }
    }
    // mıknatıs simgesi (başın üstünde, titreşerek)
    const pop = age < .16 ? easeOutBack(age / .16) : 1;
    const jx = (rnd() - .5) * 1.6 * p, jy = (rnd() - .5) * 1.6 * p;
    ctx.globalAlpha = fadeIn;
    spr(ctx, magnetSprite(), cx + jx, num(o.y, 0) - 20 + jy - Math.sin(age * 12) * 1.5, Math.sin(age * 18) * .08, pop * 1.05);
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  function drawCrow(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0);
    if (!inView(x, y, 70)) return;
    const v = vis(e), age = num(e.age, 0);
    const fx = (e.fx === -1 || e.fx < 0) ? -1 : 1;
    const f = ((age * 15 + num(e.ph, 0) * 2) | 0) % 6;
    const sc = .82, pop = age < .14 ? easeOutBack(age / .14) : 1;
    // hayalet iz
    if (v.hist && v.hist.length) {
      for (let i = 0; i < v.hist.length; i++) {
        const h = v.hist[i];
        ctx.globalAlpha = .07 + .05 * i;
        spr(ctx, crowSprite((f + 6 - (v.hist.length - i)) % 6), h[0], h[1], 0, sc * fx * pop, sc * pop);
      }
      resetXf(ctx);
      // kırmızı göz izi
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      for (let i = 0; i < v.hist.length; i++) {
        const h = v.hist[i], ex = h[0] + 12 * sc * fx, ey = h[1] - 5.6 * sc;
        if (i) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey);
      }
      ctx.lineTo(x + 12 * sc * fx, y - 5.6 * sc);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = .55; ctx.lineWidth = 2.6; ctx.strokeStyle = '#ff2a2a'; ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    danger(ctx, x, y, 30, .85);   // kara karga koyu göklerde kayboluyordu
    spr(ctx, crowSprite(f), x, y, 0, sc * fx * pop, sc * pop);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .7 + .3 * Math.sin(age * 20);
    spr(ctx, glowSprite('#ff2020'), x + 12 * sc * fx, y - 5.6 * sc, 0, 9 / 32);
    ctx.globalCompositeOperation = 'source-over';
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  /* dalganın gidiş açısı: vx/vy (geri de gidebilir, eğik olabilir); yoksa dir; yoksa ileri */
  function waveAng(e) {
    const vx = num(e.vx, 0), vy = num(e.vy, 0);
    if (Math.abs(vx) + Math.abs(vy) > 1) return Math.atan2(vy, vx);
    return num(e.dir, 1) < 0 ? PI : 0;
  }
  function drawWave(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0);
    if (!inView(x, y, 220)) return;
    const v = vis(e), age = num(e.age, 0), life = num(e.life, 0);
    if (!v.max) v.max = Math.max(.2, life + age);
    const fade = Math.min(1, life / .25) * Math.min(1, age / .07);
    if (fade <= 0) return;
    // dalga +x yönünde çizilir; geri/eğik gidiyorsa ön cephe etrafında döndürülür (aynalama dahil)
    const ang = waveAng(e);
    danger(ctx, x, y, 48, fade * .55);
    ctx.save();
    if (ang) { ctx.translate(x, y); ctx.rotate(ang); ctx.translate(-x, -y); }
    try { drawWaveBody(ctx, e, x, y, age, fade); }
    finally { ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
  }
  function drawWaveBody(ctx, e, x, y, age, fade) {
    ctx.lineCap = 'round';
    const span = .92;
    // ön dalga yumuşak dolgu
    {
      const R0 = 80 + age * 40, ax = x - R0;
      const gr = ctx.createRadialGradient(ax, y, R0 * .55, ax, y, R0);
      gr.addColorStop(0, 'rgba(168,85,247,0)'); gr.addColorStop(1, 'rgba(168,85,247,.22)');
      ctx.globalAlpha = fade; ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(ax, y); ctx.arc(ax, y, R0, -span, span); ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      const front = x - i * 22, R0 = 80 + i * 8 + age * 40, ax = front - R0;
      const a = fade * (1 - i * .2);
      const top = y - R0 * Math.sin(span), bot = y + R0 * Math.sin(span);
      const gr = ctx.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, i % 2 ? '#3cb371' : '#c084fc'); gr.addColorStop(.5, i % 2 ? '#6ee7a8' : '#a855f7'); gr.addColorStop(1, i % 2 ? '#2e9a5c' : '#7e22ce');
      ctx.beginPath(); ctx.arc(ax, y, R0, -span, span);
      ctx.globalAlpha = a * .5; ctx.lineWidth = 10 - i * 1.4; ctx.strokeStyle = '#2a0f45'; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = 6 - i; ctx.strokeStyle = gr; ctx.stroke();
      ctx.globalAlpha = a * .85; ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ax, y, R0 - .5, -span * .8, span * .8); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    {
      const R0 = 80 + age * 40, ax = x - R0;
      ctx.beginPath(); ctx.arc(ax, y, R0, -span, span);
      ctx.globalAlpha = fade * .3; ctx.lineWidth = 18; ctx.strokeStyle = '#b37bff'; ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
     İZLER (kozmetik trail)
     ===================================================================== */
  const TR = new WeakMap();
  function trailState(r) {
    let h = TR.get(r);
    if (!h) { h = { pts: [], acc: 0, acc2: 0, lx: r.x, ly: r.y }; TR.set(r, h); }
    return h;
  }
  const trailCols = id => {
    const L = FM.COSMETICS && FM.COSMETICS.trails;
    if (L) for (const t of L) if (t.id === id) return t.colors && t.colors.length ? t.colors : null;
    return null;
  };
  const pick = a => a[(rnd() * a.length) | 0];
  const DUST_COLS = {
    forest: ['rgba(255,255,255,.85)', 'rgba(232,220,200,.85)'],
    candy: ['rgba(255,240,250,.9)', 'rgba(255,214,236,.85)'],
    snow: ['rgba(255,255,255,.95)', 'rgba(225,240,255,.9)'],
    castle: ['rgba(214,200,190,.8)', 'rgba(180,165,160,.8)']
  };
  const TRAIL_RATE = { dust: 20, fire: 46, rainbow: 7, stars: 18, spades: 9, hearts: 9,
    yaprak: 11, kar: 14, baloncuk: 9, nota: 8, simsek: 18, piksel: 13, mavialev: 46, galaksi: 15, altin: 9 };   // Mağaza 2.0 izleri
  /* Bot izleri sakin tutulur (sahne gürültüsü): oran ×.45, boyut ×.7, alfa ×.6; yarışın ilk 1.5 sn'sinde kapalı.
     Aynı anda en çok 2 gösterişli iz: oyuncu + oyuncuya en yakın bot ('dust' gösterişli sayılmaz). */
  const BOT_TRAIL = { rate: .45, s: .7, a: .6, delay: 1.5 };
  const flashy = id => id !== 'dust';
  let TM = null;                       // emitTrail sırasında geçerli bot değiştiricisi (oyuncu için null)
  function TP(o) {
    if (TM) {
      const c = o.c || '#ffffff';
      o.s = num(o.s, 4) * TM.s;
      o.c = rgba(c, Math.round(C(c).a * TM.a * 100) / 100);
    }
    return P(o);
  }
  const FB = { r: null, t: 0 };        // gösterişli iz hakkı olan tek bot
  function flashBot(dt, rs, pl) {
    FB.t -= dt;
    const ok = q => !!q && q !== pl && !(q.dead > 0) && !!TRAIL_RATE[q.trail] && flashy(q.trail) && rs.indexOf(q) >= 0;
    const cur = FB.r;
    if (FB.t > 0 && ok(cur)) return cur;
    FB.t = .5;
    const ox = pl ? rcx(pl) : S.cam.x + V.VW * .5, oy = pl ? rcy(pl) : S.cam.y + V.VH * .5;
    const dist = q => Math.hypot(rcx(q) - ox, rcy(q) - oy);
    let best = null, bd = 1e9;
    for (const q of rs) { if (!ok(q)) continue; const d = dist(q); if (d < bd) { bd = d; best = q; } }
    if (best && ok(cur) && best !== cur && dist(cur) < bd + 80) best = cur;   // histerezis: iz sahibi titreşmesin
    FB.r = best;
    return best;
  }

  function emitTrail(r, id, cols) {
    const P = TP;                      // bot değiştiricisi (TM) burada uygulanır
    const face = r.face === -1 ? -1 : 1, w = r.w || 28, h = r.h || 42;
    const cx = r.x + w / 2, tx = cx - face * 11, ty = r.y + h * .55, fy = r.y + h;
    switch (id) {
      case 'dust': {
        if (!r.onGround) return;
        const tid = S.L && S.L.theme && S.L.theme.id;
        const dc = DUST_COLS[tid] || DUST_COLS.forest;
        P({ k: 'puff', x: cx - face * 9 + (rnd() - .5) * 6, y: fy - 3, vx: -face * (25 + rnd() * 45), vy: -(12 + rnd() * 34), life: .34 + rnd() * .24, c: pick(dc), s: 4.5 + rnd() * 4, g: -30, drag: 3, rot: rnd() * 6 });
        break;
      }
      case 'fire': {
        P({ k: 'flame', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 16, vx: -face * (40 + rnd() * 60) + num(r.vx, 0) * .12, vy: -(30 + rnd() * 60), life: .26 + rnd() * .2, c: '#ffffff', s: 5.5 + rnd() * 4, g: -170, drag: 2.6 });
        if (rnd() < .18) P({ k: 'spark', x: tx, y: ty + (rnd() - .5) * 12, vx: -face * (60 + rnd() * 80), vy: -(60 + rnd() * 120), life: .3 + rnd() * .25, c: pick(['#ffb020', '#ffe14d']), s: 1.6, g: 120, add: true });
        if (rnd() < .16) P({ k: 'glow', x: tx, y: ty, vx: -face * 40, vy: -30, life: .22, c: '#ff7a2a', s: 16 + rnd() * 8, add: true });
        break;
      }
      case 'rainbow': {
        const c = cols ? pick(cols) : '#ffe14d';
        P({ k: 'star', x: tx + (rnd() - .5) * 10, y: ty + (rnd() - .5) * 18, vx: -face * (20 + rnd() * 30), vy: (rnd() - .5) * 40, life: .5 + rnd() * .3, c, s: 3 + rnd() * 2, g: 40, drag: 1.5, rot: rnd() * 6, vr: (rnd() - .5) * 6 });
        break;
      }
      case 'stars': {
        const c = cols ? pick(cols) : '#ffd23f';
        P({ k: 'star', x: tx + (rnd() - .5) * 10, y: ty + (rnd() - .5) * 20, vx: -face * (25 + rnd() * 40), vy: (rnd() - .5) * 50 - 10, life: .55 + rnd() * .3, c, s: 3.6 + rnd() * 2.4, g: 70, drag: 1.4, rot: rnd() * 6, vr: (rnd() - .5) * 7 });
        if (rnd() < .35) P({ k: 'twinkle', x: tx + (rnd() - .5) * 16, y: ty + (rnd() - .5) * 24, vx: -face * 20, vy: 0, life: .3 + rnd() * .2, c: '#fff6b0', s: 10 + rnd() * 6, add: true, rot: rnd() });
        break;
      }
      case 'spades': {
        const c = cols ? pick(cols) : '#111111';
        P({ k: 'spade', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 18, vx: -face * (30 + rnd() * 40), vy: -(20 + rnd() * 40), life: .75 + rnd() * .3, c, s: 5 + rnd() * 2.4, g: 50, drag: 1.6, rot: (rnd() - .5) * 2, vr: (rnd() - .5) * 5 });
        break;
      }
      case 'hearts': {
        const c = cols ? pick(cols) : '#ff5a7a';
        P({ k: 'heart', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 18, vx: -face * (25 + rnd() * 35), vy: -(25 + rnd() * 30), life: .75 + rnd() * .3, c, s: 5 + rnd() * 2.4, g: -70, drag: 1.5 });
        break;
      }
      // ---- Mağaza 2.0 izleri (FM.COSMETICS.trails k alanı) ----
      case 'yaprak': {         // sonbahar yaprakları: salınarak düşer
        const c = cols ? pick(cols) : '#9ad44a';
        P({ k: 'leaf', x: tx + (rnd() - .5) * 10, y: ty + (rnd() - .5) * 20, vx: -face * (30 + rnd() * 40), vy: -(10 + rnd() * 40), life: .8 + rnd() * .4, c, s: 5 + rnd() * 2.5, g: 90, drag: 1.8, rot: rnd() * 6, vr: (rnd() - .5) * 6 });
        break;
      }
      case 'kar': {            // kar taneleri: yavaş süzülür
        const c = cols ? pick(cols) : '#ffffff';
        P({ k: 'ice', x: tx + (rnd() - .5) * 12, y: ty + (rnd() - .5) * 22, vx: -face * (20 + rnd() * 30), vy: -(5 + rnd() * 30), life: .7 + rnd() * .4, c, s: 3.6 + rnd() * 2.4, g: 50, drag: 1.6, rot: rnd() * 6, vr: (rnd() - .5) * 4 });
        if (rnd() < .3) P({ k: 'twinkle', x: tx + (rnd() - .5) * 16, y: ty + (rnd() - .5) * 24, vx: -face * 15, vy: -10, life: .3 + rnd() * .2, c: '#e6f8ff', s: 9 + rnd() * 5, add: true });
        break;
      }
      case 'baloncuk': {       // sabun köpüğü: yukarı süzülür, patlar
        const c = cols ? pick(cols) : '#bff4ff';
        P({ k: 'bubble', x: tx + (rnd() - .5) * 10, y: ty + (rnd() - .5) * 20, vx: -face * (15 + rnd() * 25), vy: -(20 + rnd() * 35), life: .7 + rnd() * .5, c, s: 5 + rnd() * 5, g: -40, drag: 1.4 });
        break;
      }
      case 'nota': {           // müzik notaları
        const c = cols ? pick(cols) : '#ff6ec7';
        P({ k: 'note', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 18, vx: -face * (20 + rnd() * 30), vy: -(30 + rnd() * 30), life: .8 + rnd() * .3, c, s: 5 + rnd() * 2.2, g: -60, drag: 1.4 });
        break;
      }
      case 'simsek': {         // elektrik: kısa parlak kıvılcımlar + ara sıra ışıma
        const c = cols ? pick(cols) : '#7df9ff';
        const a = PI + (rnd() - .5) * 1.4;
        P({ k: 'spark', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 18, vx: Math.cos(a) * face * (120 + rnd() * 160), vy: Math.sin(a) * (120 + rnd() * 160), life: .14 + rnd() * .14, c, s: 2.2, g: 0, add: true });
        if (rnd() < .2) P({ k: 'glow', x: tx, y: ty, vx: -face * 30, vy: 0, life: .18, c: '#7df9ff', s: 18 + rnd() * 8, add: true });
        break;
      }
      case 'piksel': {         // retro kare bloklar
        const c = cols ? pick(cols) : '#3ddc84';
        P({ k: 'pixel', x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 20, vx: -face * (30 + rnd() * 40), vy: -(20 + rnd() * 50), life: .5 + rnd() * .3, c, s: 4 + rnd() * 3, g: 160, drag: 1.2 });
        break;
      }
      case 'mavialev': {       // mavi alev (ateşle aynı ritim, mavi sprite)
        P({ k: 'flame', blue: true, x: tx + (rnd() - .5) * 8, y: ty + (rnd() - .5) * 16, vx: -face * (40 + rnd() * 60) + num(r.vx, 0) * .12, vy: -(30 + rnd() * 60), life: .26 + rnd() * .2, c: '#ffffff', s: 5.5 + rnd() * 4, g: -170, drag: 2.6 });
        if (rnd() < .18) P({ k: 'spark', x: tx, y: ty + (rnd() - .5) * 12, vx: -face * (60 + rnd() * 80), vy: -(60 + rnd() * 120), life: .3 + rnd() * .25, c: pick(['#8fe0ff', '#ffffff']), s: 1.6, g: 120, add: true });
        if (rnd() < .16) P({ k: 'glow', x: tx, y: ty, vx: -face * 40, vy: -30, life: .22, c: '#4fb3ff', s: 16 + rnd() * 8, add: true });
        break;
      }
      case 'galaksi': {        // yıldız tozu + mor ışıma
        const c = cols ? pick(cols) : '#c084fc';
        P({ k: rnd() < .6 ? 'star' : 'twinkle', x: tx + (rnd() - .5) * 12, y: ty + (rnd() - .5) * 22, vx: -face * (20 + rnd() * 30), vy: (rnd() - .5) * 40, life: .5 + rnd() * .4, c, s: rnd() < .6 ? 3 + rnd() * 2 : 9 + rnd() * 6, g: 20, drag: 1.5, rot: rnd() * 6, vr: (rnd() - .5) * 6, add: rnd() < .5 });
        if (rnd() < .25) P({ k: 'glow', x: tx, y: ty, vx: -face * 30, vy: 0, life: .3, c: '#9a7bff', s: 22 + rnd() * 10, add: true });
        break;
      }
      case 'altin': {          // altın yağmuru: paralar zıplayarak düşer
        P({ k: 'coin', x: tx + (rnd() - .5) * 10, y: ty + (rnd() - .5) * 16, vx: -face * (40 + rnd() * 50), vy: -(80 + rnd() * 120), life: .7 + rnd() * .3, c: '#ffd23f', s: 6 + rnd() * 3, g: 520, drag: .6, rot: rnd() * 6, vr: (rnd() - .5) * 8 });
        if (rnd() < .3) P({ k: 'twinkle', x: tx + (rnd() - .5) * 14, y: ty + (rnd() - .5) * 20, vx: -face * 20, vy: -10, life: .25 + rnd() * .2, c: '#fff6b0', s: 9 + rnd() * 5, add: true });
        break;
      }
    }
  }
  function updTrails(dt) {
    const rs = S.racers;
    if (!rs || !rs.length || !S.L) return;
    const now = FXT, pl = S.player;
    const fbr = flashBot(dt, rs, pl);
    const early = S.mode === 'count' || num(S.raceT, 0) < BOT_TRAIL.delay;
    for (const r of rs) {
      if (!r) continue;
      const h = trailState(r);
      const moved = Math.hypot(r.x - h.lx, r.y - h.ly);
      if (moved > 180) h.pts.length = 0;           // ışınlanma / yeniden doğma
      h.lx = r.x; h.ly = r.y;
      const id = r.trail;
      const own = r === pl;
      h.bot = !own;
      const off = !own && (early || (flashy(id) && r !== fbr));
      if (r.dead > 0 || !id || id === 'none' || !TRAIL_RATE[id] || off) { h.pts.length = 0; h.acc = 0; h.on = false; continue; }
      h.on = true;
      const w = r.w || 28, hh = r.h || 42;
      const visible = inView(r.x + w / 2, r.y + hh / 2, 160);
      // gökkuşağı şeridi için geçmiş
      if (id === 'rainbow') {
        const px = r.x + w / 2 - (r.face === -1 ? -1 : 1) * 6, py = r.y + hh * .55;
        const last = h.pts[h.pts.length - 1];
        if (!last || Math.hypot(px - last.x, py - last.y) > 3) h.pts.push({ x: px, y: py, t: now });
        while (h.pts.length && (now - h.pts[0].t > .34 || h.pts.length > 30)) h.pts.shift();
      } else if (h.pts.length) h.pts.length = 0;
      if (!visible) { h.acc = 0; continue; }
      const spd = Math.hypot(num(r.vx, 0), num(r.vy, 0));
      if (spd < 120 || !budget()) { h.acc = Math.min(h.acc, .5); continue; }
      const rate = TRAIL_RATE[id] * (r.slide && id === 'dust' ? 1.6 : 1) * clamp(spd / 330, .6, 1.6) * (own ? 1 : BOT_TRAIL.rate);
      h.acc += dt * rate;
      const cols = trailCols(id);
      let n = 0;
      TM = own ? null : BOT_TRAIL;
      try { while (h.acc >= 1 && n < 6) { h.acc -= 1; n++; emitTrail(r, id, cols); } }
      finally { TM = null; }
      if (h.acc > 3) h.acc = 0;
    }
  }
  function drawRibbons(ctx) {
    const rs = S.racers;
    if (!rs) return;
    const now = FXT;
    for (const r of rs) {
      if (!r || r.trail !== 'rainbow' || r.dead > 0) continue;
      const h = TR.get(r);
      if (!h || !h.on || h.pts.length < 2) continue;
      const w = r.w || 28, hh = r.h || 42;
      if (!inView(r.x, r.y, 300)) continue;
      const bk = h.bot ? BOT_TRAIL.s : 1, ba = h.bot ? BOT_TRAIL.a : 1;
      const pts = h.pts.slice();
      pts.push({ x: r.x + w / 2 - (r.face === -1 ? -1 : 1) * 6, y: r.y + hh * .55, t: now });
      const n = pts.length;
      const head = pts[n - 1], tail = pts[0];
      if (Math.hypot(head.x - tail.x, head.y - tail.y) < 6) continue;
      const cols = trailCols('rainbow') || ['#ff3b3b', '#ffb020', '#ffe14d', '#3ddc84', '#3b82f6', '#a855f7'];
      const nb = cols.length, bw = 3.4 * bk;
      // normal vektörleri
      const nx = new Array(n), ny = new Array(n), tp = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
        nx[i] = -dy / d; ny[i] = dx / d;
        tp[i] = .3 + .7 * (i / (n - 1));
      }
      const lg = (c0, c1) => { const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
      // koyu alt gölge
      const half = nb * bw / 2 + 1.6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const o = -half * tp[i]; const X = pts[i].x + nx[i] * o, Y = pts[i].y + ny[i] * o; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      for (let i = n - 1; i >= 0; i--) { const o = half * tp[i]; ctx.lineTo(pts[i].x + nx[i] * o, pts[i].y + ny[i] * o); }
      ctx.closePath();
      ctx.globalAlpha = ba; ctx.fillStyle = lg('rgba(30,20,60,0)', 'rgba(30,20,60,.35)'); ctx.fill();
      for (let b = 0; b < nb; b++) {
        const o0 = (b - nb / 2) * bw, o1 = o0 + bw + .4;
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const o = o0 * tp[i]; const X = pts[i].x + nx[i] * o, Y = pts[i].y + ny[i] * o; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
        for (let i = n - 1; i >= 0; i--) { const o = o1 * tp[i]; ctx.lineTo(pts[i].x + nx[i] * o, pts[i].y + ny[i] * o); }
        ctx.closePath();
        ctx.fillStyle = lg(rgba(cols[b], 0), rgba(cols[b], .95));
        ctx.fill();
      }
      // parlak üst çizgi
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const o = (-nb / 2 * bw + 1) * tp[i]; const X = pts[i].x + nx[i] * o, Y = pts[i].y + ny[i] * o; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      ctx.lineWidth = 1; ctx.strokeStyle = lg('rgba(255,255,255,0)', 'rgba(255,255,255,.7)'); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* =====================================================================
     VARLIK GÜNCELLEME (efekt üretimi, animasyon durumu)
     ===================================================================== */
  function updEnts(dt) {
    const L = S.ents;
    if (!L || !L.length) return;
    for (const e of L) {
      if (!e || !e.type) continue;
      const v = vis(e);
      v.t += dt;
      switch (e.type) {
        case 'saw': {
          const r = num(e.r, 15);
          v.rot += num(e.vx, 0) / r * dt;
          if (v.rot > 1e4 || v.rot < -1e4) v.rot %= TAU;
          const grounded = Math.abs(num(e.vy, 0)) < 6 && num(e.age, 0) > .03;
          if (grounded && inView(e.x, e.y, 120) && budget()) {
            v.acc += dt * 50;
            const dir = num(e.vx, 0) < 0 ? -1 : 1;
            while (v.acc >= 1) {
              v.acc -= 1;
              P({ k: 'spark', x: e.x - dir * 5 + (rnd() - .5) * 4, y: e.y + r - 1, vx: -dir * (140 + rnd() * 260), vy: -(90 + rnd() * 260), life: .16 + rnd() * .22, c: rnd() < .5 ? '#fff2a8' : '#ffb347', s: 1.6 + rnd(), g: 900, add: true });
            }
            if (rnd() < dt * 8) P({ k: 'puff', x: e.x - dir * 8, y: e.y + r - 2, vx: -dir * 40, vy: -20, life: .35, c: 'rgba(200,200,210,.6)', s: 5 + rnd() * 3, g: -20, drag: 3 });
          } else if (Math.abs(num(e.vx, 0)) > 150 && inView(e.x, e.y, 120) && budget()) {
            // havada: kısa kızıl kıvılcım izi (tehlike dili: "bu şey geliyor")
            v.acc += dt * 22;
            const dir = num(e.vx, 0) < 0 ? -1 : 1;
            while (v.acc >= 1) {
              v.acc -= 1;
              P({ k: 'spark', x: e.x - dir * 6, y: e.y + (rnd() - .5) * 10, vx: -dir * (80 + rnd() * 120), vy: (rnd() - .5) * 80, life: .16 + rnd() * .16, c: rnd() < .5 ? '#ff6a3a' : '#ffb347', s: 1.8, g: 300, add: true });
            }
          }
          break;
        }
        case 'dyn': {
          const vy = num(e.vy, 0), vx = num(e.vx, 0);
          if (Math.abs(vy) > 40) v.rot += clamp(vx * .022, -13, 13) * dt;
          else {
            const tgt = Math.round((v.rot - PI / 2) / PI) * PI + PI / 2;
            v.rot += (tgt - v.rot) * Math.min(1, dt * 12);
          }
          if (inView(e.x, e.y, 100) && budget()) {
            const tip = dynTip(e, v);
            v.acc += dt * 46;
            while (v.acc >= 1) {
              v.acc -= 1;
              const a = -PI / 2 + (rnd() - .5) * 2.6, sp = 70 + rnd() * 170;
              P({ k: 'spark', x: tip.x, y: tip.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .12 + rnd() * .2, c: rnd() < .4 ? '#ffffff' : '#ffd23f', s: 1.3 + rnd(), g: 380, add: true });
            }
            if (rnd() < dt * 10) P({ k: 'puff', x: tip.x, y: tip.y, vx: (rnd() - .5) * 20, vy: -30, life: .4, c: 'rgba(120,115,120,.5)', s: 3 + rnd() * 2, g: -40, drag: 2 });
          }
          break;
        }
        case 'trap': {
          const age = num(e.age, 0);
          if (e.fly) { v.spin = num(v.spin, 0) + dt * 11 * (num(e.vx, 0) < 0 ? -1 : 1); v.wasFly = true; break; }
          if (v.wasFly) {   // yere oturdu: toz + küçük sıçrama
            v.wasFly = false; v.landT = v.t;
            if (inView(e.x, e.y, 120) && FM.fx) FM.fx.puff(num(e.x, 0) + num(e.w, 34) / 2, num(e.y, 0) + num(e.h, 12), 5, 'rgba(230,220,205,.8)', 8, 70);
          }
          if (!v.armed && age > .5) {
            v.armed = true;
            if (inView(e.x, e.y, 120) && FM.fx) {
              FM.fx.puff(num(e.x, 0) + num(e.w, 34) / 2, num(e.y, 0) + num(e.h, 12), 4, 'rgba(230,220,205,.8)', 7, 60);
              P({ k: 'twinkle', x: num(e.x, 0) + 6, y: num(e.y, 0) - 2, vx: 0, vy: 0, life: .3, c: '#ffffff', s: 14, add: true });
            }
          }
          break;
        }
        case 'net': {
          const age = num(e.age, 0);
          if (e.fly) {
            v.spin = num(v.spin, 0) + dt * 9 * (num(e.vx, 0) < 0 ? -1 : 1); v.wasFly = true;
            if (inView(e.x, e.y, 150) && budget() && rnd() < dt * 14) P({ k: 'spark', x: num(e.x, 0) + num(e.w, 44) / 2 + (rnd() - .5) * 14, y: num(e.y, 0) + num(e.h, 76) / 2 + (rnd() - .5) * 14, vx: (rnd() - .5) * 80, vy: (rnd() - .5) * 80, life: .18 + rnd() * .14, c: '#bff6ff', s: 1.6, g: 200, add: true });
            break;
          }
          if (v.wasFly) {   // yere oturdu: iniş anı (açılma animasyonu buradan başlar) + toz
            v.wasFly = false; v.landT = v.t;
            if (inView(e.x, e.y, 150) && FM.fx) FM.fx.puff(num(e.x, 0) + num(e.w, 44) / 2, num(e.y, 0) + num(e.h, 76), 5, 'rgba(220,225,240,.8)', 8, 70);
          }
          if (age > .6) {
            if (!v.on) {
              v.on = true;
              if (inView(e.x, e.y, 150)) {
                P({ k: 'glow', x: num(e.x, 0) + num(e.w, 44) / 2, y: num(e.y, 0) + num(e.h, 76) / 2, vx: 0, vy: 0, life: .3, c: '#7be3ff', s: 80, add: true });
                if (FM.fx && FM.fx.sparks) FM.fx.sparks(num(e.x, 0) + 2, num(e.y, 0) - 10, 6, '#bff6ff', 220);
                if (FM.fx && FM.fx.sparks) FM.fx.sparks(num(e.x, 0) + num(e.w, 44) - 2, num(e.y, 0) - 10, 6, '#bff6ff', 220);
              }
            }
            v.arcT -= dt;
            if (v.arcT <= 0 || !v.arcs) {
              v.arcT = .05 + rnd() * .05;
              const x0 = num(e.x, 0) + 2, x1 = num(e.x, 0) + num(e.w, 44) - 2, y0 = num(e.y, 0), h = num(e.h, 76);
              const n = (e.n > 0 ? 3 : 2);
              v.arcs = [];
              for (let i = 0; i < n; i++) {
                if (rnd() < .3) continue;
                const ya = y0 + 4 + rnd() * (h - 12), yb = y0 + 4 + rnd() * (h - 12);
                v.arcs.push(zigzag(x0, ya, x1, yb, 16, 3));
              }
              if (rnd() < .4) { const tx = rnd() < .5 ? x0 : x1; v.arcs.push(zigzag(tx, y0 + h - 86 + 3, tx + (rnd() - .5) * 26, y0 - 22 - rnd() * 10, 10, 2)); }
            }
            if (inView(e.x, e.y, 120) && rnd() < dt * 4 && budget()) {
              const px = rnd() < .5 ? num(e.x, 0) + 2 : num(e.x, 0) + num(e.w, 44) - 2;
              if (FM.fx && FM.fx.sparks) FM.fx.sparks(px, num(e.y, 0) + num(e.h, 76) - 87, 3, '#bff6ff', 160);
            }
          }
          break;
        }
        case 'mis': {
          const age = num(e.age, 0), warn = num(e.warn, 1), flying = age >= warn;
          if (!inView(e.x, e.y, 150) || !budget()) break;
          const ang = misAngle(e, v), ca = Math.cos(ang), sa = Math.sin(ang);
          const bob = flying ? 0 : Math.sin(age * 7) * 2;
          const nx = num(e.x, 0) - ca * 24, ny = num(e.y, 0) + bob - sa * 24;
          v.acc += dt * (flying ? 70 : 14);
          while (v.acc >= 1) {
            v.acc -= 1;
            const back = 30 + rnd() * 70;
            P({ k: 'puff', x: nx + (rnd() - .5) * 4, y: ny + (rnd() - .5) * 4, vx: -ca * back + (rnd() - .5) * 30, vy: -sa * back + (rnd() - .5) * 30 - 10, life: flying ? .55 + rnd() * .35 : .4 + rnd() * .2, c: rnd() < .35 ? 'rgba(170,165,175,.75)' : 'rgba(225,225,232,.8)', s: flying ? 6 + rnd() * 5 : 3.5 + rnd() * 2.5, g: -25, drag: 2.2, rot: rnd() * 6, vr: (rnd() - .5) * 2 });
            if (flying && rnd() < .35) P({ k: 'flame', x: nx, y: ny, vx: -ca * 120 + (rnd() - .5) * 40, vy: -sa * 120 + (rnd() - .5) * 40, life: .14 + rnd() * .1, c: '#ffffff', s: 5 + rnd() * 3, g: 0, drag: 4 });
            if (flying && rnd() < .2) P({ k: 'spark', x: nx, y: ny, vx: -ca * 260 + (rnd() - .5) * 120, vy: -sa * 260 + (rnd() - .5) * 120, life: .2 + rnd() * .15, c: '#ffb020', s: 1.6, g: 300, add: true });
          }
          break;
        }
        case 'bolt': {
          const p = boltPos(e);
          if (!p) break;
          if (!v.poof) {
            v.poof = true;
            if (inView(p.x, p.y, 120)) for (let i = 0; i < 5; i++) P({ k: 'puff', x: p.x + (rnd() - .5) * 50, y: p.y + (rnd() - .5) * 16, vx: (rnd() - .5) * 80, vy: (rnd() - .5) * 30, life: .4 + rnd() * .2, c: 'rgba(80,78,100,.75)', s: 9 + rnd() * 5, g: 0, drag: 3 });
          }
          v.flick = Math.max(0, (v.flick || 0) - dt * 7);
          v.fT = (v.fT === undefined ? .3 : v.fT) - dt;
          const tl = Math.max(0, num(e.t, 0));
          if (v.fT <= 0) {
            v.fT = .08 + tl * .22 + rnd() * .2;
            v.flick = .7 + rnd() * .3;
            v.fx = (rnd() - .5) * 40;
            const ix = p.x + v.fx;
            v.inner = zigzag(ix - 8 + rnd() * 6, p.y - 4, ix + 8 - rnd() * 6, p.y + 10, 10, 2);
          }
          if (v.inner) {        // bulut hedefle hareket ederken iç çizgiyi kaydır
            const dx = p.x - (v.px === undefined ? p.x : v.px), dy = p.y - (v.py === undefined ? p.y : v.py);
            if (dx || dy) for (let i = 0; i < v.inner.length; i += 2) { v.inner[i] += dx; v.inner[i + 1] += dy; }
          }
          v.px = p.x; v.py = p.y;
          break;
        }
        case 'flash': {
          const G = flashGeom(e);
          v.bT = (v.bT || 0) - dt;
          if (!v.bolt || v.bT <= 0) {
            v.bT = .045;
            v.bolt = zigzag(G.x + (rnd() - .5) * 10, G.top, G.x + (rnd() - .5) * 6, G.bot, 34, 5);
            v.branches = [];
            const nb = 2 + ((rnd() * 2) | 0);
            const segs = v.bolt.length / 2;
            for (let i = 0; i < nb; i++) {
              const si = 2 + ((rnd() * (segs - 6)) | 0), bx = v.bolt[si * 2], by = v.bolt[si * 2 + 1];
              const dir = rnd() < .5 ? -1 : 1;
              v.branches.push(zigzag(bx, by, bx + dir * (18 + rnd() * 30), by + 16 + rnd() * 30, 12, 3));
            }
          }
          if (!v.hit) {
            v.hit = true;
            if (inView(G.x, G.bot, 160) && FM.fx) {
              if (FM.fx.sparks) FM.fx.sparks(G.x, G.bot - 4, 16, '#d6ecff', 460);
              if (FM.fx.ring) FM.fx.ring(G.x, G.bot - 2, 64, '#bfe0ff', .32, 6);
              if (FM.fx.puff) FM.fx.puff(G.x, G.bot - 2, 6, 'rgba(255,255,255,.85)', 11, 130);
              for (let i = 0; i < 6; i++) P({ k: 'dot', x: G.x, y: G.bot - 3, vx: (rnd() - .5) * 260, vy: -(120 + rnd() * 220), life: .45 + rnd() * .3, c: '#6b5a48', s: 2.4 + rnd() * 1.6, g: 900 });
            }
          }
          break;
        }
        case 'mag': {
          const o = e.o;
          if (!o) break;
          const cx = rcx(o), cy = rcy(o);
          v.arcT -= dt;
          if (v.arcT <= 0 || !v.arcs) {
            v.arcT = .05;
            v.arcs = [];
            const tl = Math.max(0, num(e.t, 0)), pr = clamp(1 - tl / .45, 0, 1), rr = 62 - 36 * easeOutCubic(pr);
            const mx = cx, my = num(o.y, 0) - 20;
            for (let i = 0; i < 2; i++) {
              const a = rnd() * TAU, sx = i ? 8 : -8;
              v.arcs.push(zigzag(mx + sx, my - 9, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 14, 3));
            }
          }
          if (inView(cx, cy, 120) && budget()) {
            v.acc += dt * 46;
            while (v.acc >= 1) {
              v.acc -= 1;
              const a = rnd() * TAU, d = 70 + rnd() * 30, sp = 260 + rnd() * 120;
              P({ k: 'dot', x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, life: d / sp * .9, c: rnd() < .5 ? '#e9d5ff' : '#c084fc', s: 2.2 + rnd() * 1.6, g: 0 });
            }
          }
          break;
        }
        case 'crow': {
          v.hT = (v.hT || 0) - dt;
          if (v.hT <= 0) {
            v.hT = .028;
            if (!v.hist) v.hist = [];
            v.hist.push([num(e.x, 0), num(e.y, 0)]);
            if (v.hist.length > 5) v.hist.shift();
          }
          if (inView(e.x, e.y, 100) && rnd() < dt * 5 && budget()) {
            P({ k: 'leaf', x: num(e.x, 0), y: num(e.y, 0), vx: (rnd() - .5) * 60, vy: -20 - rnd() * 30, life: .7 + rnd() * .4, c: '#1d1d26', s: 3 + rnd() * 1.5, g: 120, drag: 2, rot: rnd() * 6, vr: (rnd() - .5) * 4 });
          }
          break;
        }
        case 'wave': {
          if (!v.max) v.max = Math.max(.2, num(e.life, 1) + num(e.age, 0));
          if (inView(e.x, e.y, 160) && num(e.life, 0) > .1 && budget()) {
            v.acc += dt * 16;
            const wa = waveAng(e), wc = Math.cos(wa), ws = Math.sin(wa);   // notalar dalganın gidiş yönünde (geri/eğik dahil)
            while (v.acc >= 1) {
              v.acc -= 1;
              const R0 = 80 + num(e.age, 0) * 40, a = (rnd() - .5) * 1.7;
              const lx = -R0 + Math.cos(a) * R0, ly = Math.sin(a) * R0, sp2 = 300 + rnd() * 200;
              P({ k: 'note', x: num(e.x, 0) + lx * wc - ly * ws, y: num(e.y, 0) + lx * ws + ly * wc, vx: sp2 * wc, vy: sp2 * ws - (40 + rnd() * 80), life: .55 + rnd() * .3, c: pick(['#a855f7', '#3cb371', '#c084fc', '#6ee7a8']), s: 3.4 + rnd() * 1.6, g: -40, drag: 2.4 });
            }
          }
          break;
        }
      }
    }
  }
  function updSnaps(dt) {
    for (let i = snaps.length - 1; i >= 0; i--) { snaps[i].t += dt; if (snaps[i].t > .9) snaps.splice(i, 1); }
  }

  /* =====================================================================
     OLAY KANCALARI (ek "juice")
     ===================================================================== */
  // sıvıya düşüp kaybolan eşya: buhar bulutu + küçük kabarcıklar (havada asılı kalmaz, söner)
  FM.on('fizzle', d => {
    if (!d || typeof d.x !== 'number' || !FM.fx) return;
    try { FM.fx.puff(d.x, d.y - 6, 7, 'rgba(235,240,255,.75)', 11, 70); FM.fx.puff(d.x, d.y - 2, 4, 'rgba(180,200,220,.6)', 7, 40); } catch (e) { /* yok say */ }
  });
  FM.on('explode', d => {
    if (!d || !inView(num(d.x, 0), num(d.y, 0), 200)) return;
    const rad = num(d.rad, 80), x = num(d.x, 0), y = num(d.y, 0);
    const n = 8 + Math.min(4, rad / 30 | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = rad * (.8 + rnd() * 1.6);
      P({ k: 'fball', x: x + Math.cos(a) * rad * .15, y: y + Math.sin(a) * rad * .15, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: .5 + rnd() * .35, c: '#ffb347', s: rad * (.22 + rnd() * .14), g: -70, drag: 3.6, rot: rnd() * 6, vr: (rnd() - .5) * 2 });
    }
    for (let i = 0; i < 5; i++) {
      const a = -PI / 2 + (rnd() - .5) * 2.4, sp = 300 + rnd() * 300;
      P({ k: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .6 + rnd() * .4, c: rnd() < .5 ? '#3a3036' : '#5a4a44', s: 2.5 + rnd() * 2, g: 1000, drag: .5 });
    }
  });
  FM.on('trap:snap', d => {
    const e = d && d.e;
    if (!e) return;
    const x = num(e.x, 0) + num(e.w, 34) / 2, y = num(e.y, 0) + num(e.h, 12);
    snaps.push({ x, y, t: 0 });
    if (snaps.length > 8) snaps.shift();
    if (inView(x, y, 120)) {
      if (FM.fx && FM.fx.sparks) FM.fx.sparks(x, y - 10, 10, '#fff2c0', 300);
      P({ k: 'glow', x, y: y - 8, vx: 0, vy: 0, life: .2, c: '#ffffff', s: 40, add: true });
    }
  });
  /* Zıplama / kayma / çakılma geri bildirimi (yerel oyuncuda daha güçlü, rakiplerde yarım) */
  const ownR = r => r === S.player;
  const feetOf = r => [rcx(r), num(r.y, 0) + num(r.h, 42)];
  FM.on('jump', d => {
    const r = d && d.r; if (!r || !inView(rcx(r), num(r.y, 0), 120) || !budget()) return;
    const [x, y] = feetOf(r), k = ownR(r) ? 1 : .5;
    if (d.dbl) {   // çift zıplama: parlak halka + ışıltı
      if (FM.fx && FM.fx.ring) FM.fx.ring(x, y - 10, ownR(r) ? 36 : 26, '#e8fbff', .32, 5);
      for (let i = 0; i < 6 * k; i++) P({ k: 'twinkle', x: x + (rnd() - .5) * 30, y: y - 6 + (rnd() - .5) * 16, vx: (rnd() - .5) * 60, vy: 20 + rnd() * 60, life: .3 + rnd() * .2, c: '#e8fbff', s: 10 + rnd() * 8, add: true, rot: rnd() });
    } else for (let i = 0; i < 5 * k; i++) P({ k: 'puff', x: x + (rnd() - .5) * 18, y: y - 2, vx: (rnd() - .5) * 120, vy: -10 - rnd() * 40, life: .3 + rnd() * .2, c: 'rgba(255,255,255,.75)', s: 7 + rnd() * 5, g: -30, drag: 3 });
  });
  FM.on('slide', d => {
    const r = d && d.r; if (!r || !inView(rcx(r), num(r.y, 0), 120) || !budget()) return;
    const [x, y] = feetOf(r), face = r.face === -1 ? -1 : 1, k = ownR(r) ? 1 : .5;
    for (let i = 0; i < 6 * k; i++) P({ k: 'puff', x: x - face * (6 + rnd() * 10), y: y - 3, vx: -face * (60 + rnd() * 120), vy: -(10 + rnd() * 30), life: .35 + rnd() * .2, c: 'rgba(255,255,255,.8)', s: 8 + rnd() * 6, g: -30, drag: 2.5 });
    for (let i = 0; i < 3 * k; i++) P({ k: 'spark', x: x - face * 10, y: y - 6 - i * 6, vx: -face * (260 + rnd() * 160), vy: 0, life: .18 + rnd() * .1, c: 'rgba(255,255,255,.85)', s: 2.4, g: 0 });   // alçak hız çizgileri
  });
  FM.on('slamLand', d => {
    const r = d && d.r; if (!r || !inView(rcx(r), num(r.y, 0), 120)) return;
    const [x, y] = feetOf(r);
    if (FM.fx && FM.fx.ring) FM.fx.ring(x, y - 2, ownR(r) ? 70 : 46, '#fff2c0', .4, 7);
  });
  FM.on('race:start', () => { snaps.length = 0; ink.on = false; ink.blobs = []; ink.last = 0; frost.t = 0; });
  FM.on('match:start', () => { snaps.length = 0; ink.on = false; ink.blobs = []; ink.last = 0; });

  /* =====================================================================
     EKRAN EFEKTLERİ
     ===================================================================== */
  let vigC = null, redC = null;
  function radialCanvas(inner, stops) {
    const N = 256, c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(N / 2, N / 2, N / 2 * inner, N / 2, N / 2, N / 2 * 1.45);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return c;
  }
  function buildVignettes() {
    vigC = radialCanvas(.5, [[0, 'rgba(12,6,28,0)'], [.35, 'rgba(12,6,28,.05)'], [.7, 'rgba(12,6,28,.24)'], [1, 'rgba(12,6,28,.5)']]);
    redC = radialCanvas(.25, [[0, 'rgba(160,0,24,0)'], [.35, 'rgba(160,0,24,.12)'], [.7, 'rgba(150,0,24,.5)'], [1, 'rgba(110,0,18,.85)']]);
  }

  /* ---- kırağı (donma) ---- */
  const frost = { c: null, key: '', t: 0, last: 0 };
  function buildFrost() {
    const VW = V.VW || 1000, VH = V.VH || 540;
    const W0 = 760, H0 = Math.max(200, Math.round(W0 * VH / VW));
    const c = document.createElement('canvas'); c.width = W0; c.height = H0;
    const g = c.getContext('2d');
    const rr = FM.mulberry32(9137);
    // kenar gradyanları
    const edge = (x0, y0, x1, y1, a) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(236,250,255,' + a + ')'); gr.addColorStop(.4, 'rgba(190,230,255,' + a * .38 + ')'); gr.addColorStop(1, 'rgba(190,230,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W0, H0);
    };
    edge(0, 0, 0, H0 * .2, .8); edge(0, H0, 0, H0 * .8, .8);
    edge(0, 0, W0 * .12, 0, .8); edge(W0, 0, W0 * .88, 0, .8);
    for (const p of [[0, 0], [W0, 0], [0, H0], [W0, H0]]) {
      const gr = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], H0 * .55);
      gr.addColorStop(0, 'rgba(248,253,255,.95)'); gr.addColorStop(.45, 'rgba(205,238,255,.42)'); gr.addColorStop(1, 'rgba(205,238,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W0, H0);
    }
    // eğreltiotu kristalleri
    g.lineCap = 'round';
    const fern = (x, y, a, len, w, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2);
      g.lineWidth = w; g.strokeStyle = 'rgba(255,255,255,' + (.35 + depth * .12) + ')'; g.stroke();
      if (depth <= 0) return;
      const nb = 3 + ((rr() * 3) | 0);
      for (let i = 1; i <= nb; i++) {
        const t = i / (nb + 1), bx = x + (x2 - x) * t, by = y + (y2 - y) * t;
        const bl = len * (.42 - t * .25) * (.7 + rr() * .5);
        fern(bx, by, a - 1.05, bl, w * .62, depth - 1);
        fern(bx, by, a + 1.05, bl, w * .62, depth - 1);
      }
    };
    for (let i = 0; i < 64; i++) {
      const side = i % 4; let x, y, a;
      if (side === 0) { x = rr() * W0; y = 0; a = PI / 2; }
      else if (side === 1) { x = rr() * W0; y = H0; a = -PI / 2; }
      else if (side === 2) { x = 0; y = rr() * H0; a = 0; }
      else { x = W0; y = rr() * H0; a = PI; }
      // köşelere yoğunlaş
      if (rr() < .72) { if (side < 2) x = rr() < .5 ? rr() * W0 * .22 : W0 - rr() * W0 * .22; else y = rr() < .5 ? rr() * H0 * .28 : H0 - rr() * H0 * .28; }
      a += (rr() - .5) * 1.2;
      const nearC = Math.min(Math.hypot(x, y), Math.hypot(W0 - x, y), Math.hypot(x, H0 - y), Math.hypot(W0 - x, H0 - y)) < H0 * .4;
      fern(x, y, a, (nearC ? 22 : 12) + rr() * (nearC ? 34 : 18), 1.6 + rr() * 1.2, 2);
    }
    // düzensiz buz kenarı
    g.fillStyle = 'rgba(255,255,255,.55)';
    const rim = (horiz, at, dir) => {
      g.beginPath();
      if (horiz) { g.moveTo(0, at); for (let x = 0; x <= W0; x += 14) g.lineTo(x, at + dir * (4 + rr() * 12)); g.lineTo(W0, at); }
      else { g.moveTo(at, 0); for (let y = 0; y <= H0; y += 14) g.lineTo(at + dir * (4 + rr() * 12), y); g.lineTo(at, H0); }
      g.closePath(); g.fill();
    };
    rim(true, 0, 1); rim(true, H0, -1); rim(false, 0, 1); rim(false, W0, -1);
    // parıltılar
    for (let i = 0; i < 70; i++) {
      const side = i % 4;
      const x = side === 2 ? rr() * W0 * .12 : side === 3 ? W0 - rr() * W0 * .12 : rr() * W0;
      const y = side === 0 ? rr() * H0 * .18 : side === 1 ? H0 - rr() * H0 * .18 : rr() * H0;
      const s = .8 + rr() * 2;
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath(); g.moveTo(x, y - s * 2.4); g.lineTo(x + s * .5, y); g.lineTo(x, y + s * 2.4); g.lineTo(x - s * .5, y); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x - s * 2.4, y); g.lineTo(x, y + s * .5); g.lineTo(x + s * 2.4, y); g.lineTo(x, y - s * .5); g.closePath(); g.fill();
    }
    // genel soğuk ton
    g.fillStyle = 'rgba(150,210,255,.07)'; g.fillRect(0, 0, W0, H0);
    frost.c = c; frost.key = Math.round(VW) + 'x' + Math.round(VH);
  }

  /* ---- mürekkep ---- */
  const ink = { on: false, blobs: [], drips: [], t0: 0, last: 0 };
  const INK_COL = '#15111f';
  function makeInkBlob(R0, seed) {
    const rs = clamp(V.S * .85, .6, 1.6);
    const size = R0 * 4, half = size / 2, lim = half - 3;
    const cv = document.createElement('canvas');
    cv.width = Math.max(4, Math.ceil(size * rs)); cv.height = cv.width;
    const g = cv.getContext('2d');
    g.scale(rs, rs); g.translate(half, half);
    const rr = FM.mulberry32(seed | 0);
    const N = 32, pts = [];
    const p1 = rr() * TAU, p2 = rr() * TAU, p3 = rr() * TAU;
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU;
      let r = R0 * (1 + .12 * Math.sin(a * 3 + p1) + .08 * Math.sin(a * 5 + p2) + .045 * Math.sin(a * 9 + p3));
      if (rr() < .14) r *= 1.08 + rr() * .16;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const body = () => {
      g.beginPath();
      g.moveTo((pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2);
      for (let i = 0; i < N; i++) { const p = pts[i], n = pts[(i + 1) % N]; g.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2); }
      g.closePath();
    };
    g.fillStyle = INK_COL;
    // ince sıçrama dilleri (uçları damlalı)
    const nt = 3 + ((rr() * 4) | 0);
    for (let i = 0; i < nt; i++) {
      const a = rr() * TAU, wd = R0 * (.035 + rr() * .03);
      const L = Math.min(lim - wd * 2.2, R0 * (1.35 + rr() * .5));
      const nx = -Math.sin(a), ny = Math.cos(a), c = Math.cos(a), sn = Math.sin(a);
      const bx = c * R0 * .75, by = sn * R0 * .75, ex = c * L, ey = sn * L;
      const bend = (rr() - .5) * R0 * .25;
      g.beginPath();
      g.moveTo(bx + nx * wd * 2.4, by + ny * wd * 2.4);
      g.quadraticCurveTo((bx + ex) / 2 + nx * (bend + wd * .6), (by + ey) / 2 + ny * (bend + wd * .6), ex + nx * wd * .35, ey + ny * wd * .35);
      g.lineTo(ex - nx * wd * .35, ey - ny * wd * .35);
      g.quadraticCurveTo((bx + ex) / 2 + nx * (bend - wd * .6), (by + ey) / 2 + ny * (bend - wd * .6), bx - nx * wd * 2.4, by - ny * wd * 2.4);
      g.closePath(); g.fill();
      g.beginPath(); g.arc(ex, ey, wd * 1.55, 0, TAU); g.fill();
    }
    // ana gövde
    const gr = g.createRadialGradient(-R0 * .25, -R0 * .3, R0 * .1, 0, 0, R0 * 1.3);
    gr.addColorStop(0, 'rgba(52,42,80,.95)'); gr.addColorStop(.6, 'rgba(21,17,31,.92)'); gr.addColorStop(1, 'rgba(10,8,16,.8)');   // yarı saydam gövde
    g.fillStyle = gr;
    body(); g.fill();
    // uydu damlacıklar
    g.fillStyle = INK_COL;
    const nd = 8 + ((rr() * 7) | 0);
    for (let i = 0; i < nd; i++) {
      const a = rr() * TAU, rd = R0 * (.025 + rr() * .06);
      const d = Math.min(lim - rd * 2.5, R0 * (1.15 + rr() * .6));
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      g.beginPath(); g.ellipse(x, y, rd * (1.2 + rr() * .7), rd, a, 0, TAU); g.fill();
      if (rd > R0 * .045) { g.beginPath(); g.arc(x - rd * .3, y - rd * .35, rd * .28, 0, TAU); g.fillStyle = 'rgba(255,255,255,.28)'; g.fill(); g.fillStyle = INK_COL; }
    }
    // ıslak kenar ışığı ve parlaklık
    g.save(); body(); g.clip();
    g.strokeStyle = 'rgba(130,110,190,.38)'; g.lineWidth = Math.max(2, R0 * .05);
    body(); g.stroke();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.beginPath(); g.ellipse(-R0 * .3, -R0 * .38, R0 * .4, R0 * .17, -.6, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.42)';
    g.beginPath(); g.ellipse(-R0 * .5, -R0 * .2, R0 * .07, R0 * .045, -.6, 0, TAU); g.fill();
    g.beginPath(); g.arc(-R0 * .12, -R0 * .56, R0 * .035, 0, TAU); g.fill();
    return { c: cv, size, half };
  }
  function startInk() {
    const VW = V.VW || 1000, VH = V.VH || 540;
    ink.on = true; ink.t0 = FXT; ink.blobs = []; ink.drips = [];
    // göz konforu: 3 küçük leke, en çok ~.7 alfa, yerel oyuncunun çevresi (ekran konumu) boş bırakılır
    const n = 3;
    const pl = S.player, px = pl ? rcx(pl) - S.cam.x : VW * .4, py = pl ? rcy(pl) - S.cam.y : VH * .55;
    const placed = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, R0 = 0;
      for (let tries = 0; tries < 16; tries++) {
        if (i === 0) { x = VW * (.3 + rnd() * .45); y = VH * (.2 + rnd() * .4); R0 = 54 + rnd() * 18; }
        else { x = VW * (.08 + rnd() * .84); y = VH * (.1 + rnd() * .72); R0 = 30 + rnd() * 26; }
        let ok = Math.hypot(x - px, y - py) > R0 + 70;
        for (const q of placed) if (Math.hypot(q.x - x, q.y - y) < (q.R + R0) * .95) { ok = false; break; }
        if (ok) break;
      }
      placed.push({ x, y, R: R0 });
      const b = makeInkBlob(R0, (rnd() * 1e9) | 0);
      b.x = x; b.y = y; b.R = R0; b.delay = i * .055;
      ink.blobs.push(b);
      const nd = 1 + ((rnd() * 2.6) | 0);
      for (let j = 0; j < nd; j++) {
        const w = R0 * (.07 + rnd() * .06), dx = (rnd() - .5) * R0 * 1.1;
        const y0 = y + Math.sqrt(Math.max(0, Math.pow(R0 * .9, 2) - dx * dx)) - w * 1.6;
        ink.drips.push({ x: x + dx, y: y0, w, max: R0 * (.45 + rnd() * 1.1), sp: 20 + rnd() * 36, delay: b.delay + .18 + rnd() * .45, edge: y + Math.sqrt(Math.max(0, R0 * R0 - dx * dx)) });
      }
    }
  }
  function drawInk(ctx, amount) {
    const age = FXT - ink.t0;
    const fade = clamp(amount / .7, 0, 1) * .68;   // en çok ~.7: sert siyah duvar değil, yarı saydam leke
    for (const b of ink.blobs) {
      const t = age - b.delay;
      if (t <= 0) continue;
      const sc = t < .2 ? Math.max(.05, easeOutBack(t / .2)) : 1;
      ctx.globalAlpha = fade;
      const s = b.size * sc;
      ctx.drawImage(b.c, b.x - s / 2, b.y - s / 2, s, s);
    }
    // akan damlalar
    for (const d of ink.drips) {
      const t = age - d.delay;
      if (t <= 0) continue;
      const L = Math.min(d.max, t * d.sp * (1 - Math.min(.6, t * .08)));
      ctx.globalAlpha = fade;
      ctx.fillStyle = INK_COL;
      ctx.beginPath();
      ctx.moveTo(d.x - d.w * .75, d.y);
      ctx.quadraticCurveTo(d.x - d.w * .5, d.y + L * .5, d.x - d.w * .45, d.y + L);
      ctx.arc(d.x, d.y + L + d.w * .25, d.w * .66, PI * .95, PI * .05, true);
      ctx.quadraticCurveTo(d.x + d.w * .5, d.y + L * .5, d.x + d.w * .75, d.y);
      ctx.closePath(); ctx.fill();
      const vis0 = Math.max(d.y, d.edge + 2), vis1 = d.y + L;
      if (vis1 - vis0 > d.w) {
        ctx.globalAlpha = fade * .2; ctx.fillStyle = '#ffffff';
        ctx.fillRect(d.x - d.w * .26, vis0, Math.max(1, d.w * .13), vis1 - vis0 - d.w * .4);
        ctx.globalAlpha = fade * .35;
        ctx.beginPath(); ctx.arc(d.x - d.w * .2, d.y + L + d.w * .1, d.w * .15, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---- hız çizgileri ----
     Yalnızca ekranın dış çerçevesinde (merkez→kenar uzaklığının dış %30'u): oyuncu ve ekran ortası temiz kalır.
     En çok 10 şerit; uçları sivri (ince-kalın-ince), merkeze bakan uçta alfa 0'a iner, α ≤ .35.
     Her şerit kendi ömrü boyunca dışarı kayıp söner (her karede yeniden rastgele üretilmez → titreşmez).
     Önbellekli tek sprite + drawImage: kare başına gradyan/yol yok. */
  const SPEED_N = 10, SPEED_A = .35, STREAK_L = 200;
  const speed = { a: 0, lines: [], col: '255,255,255' };
  function newStreak(i, t0) {
    return {
      a: (i + .15 + rnd() * .7) / SPEED_N * TAU,   // her yuvaya bir açı dilimi → çevreye eşit dağılım
      t: t0, dur: .22 + rnd() * .14,
      lf: .22 + rnd() * .08, j: rnd() * .04, k: .8 + rnd() * .2, w: .85 + rnd() * .4
    };
  }
  function streakSprite(col) {
    return sp('streak:' + col, STREAK_L, 16, 0, 8, g => {
      const L0 = STREAK_L;
      const spindle = (hw, dy) => {
        g.beginPath();
        g.moveTo(0, dy);
        g.bezierCurveTo(L0 * .3, dy - hw * .3, L0 * .6, dy - hw, L0 * .75, dy - hw);
        g.bezierCurveTo(L0 * .88, dy - hw, L0 * .96, dy - hw * .4, L0, dy);
        g.bezierCurveTo(L0 * .96, dy + hw * .4, L0 * .88, dy + hw, L0 * .75, dy + hw);
        g.bezierCurveTo(L0 * .6, dy + hw, L0 * .3, dy + hw * .3, 0, dy);
        g.closePath();
      };
      const ramp = (rgb, a) => {
        const gr = g.createLinearGradient(0, 0, L0, 0);
        gr.addColorStop(0, 'rgba(' + rgb + ',0)');
        gr.addColorStop(.4, 'rgba(' + rgb + ',' + (a * .55) + ')');
        gr.addColorStop(.68, 'rgba(' + rgb + ',' + a + ')');
        gr.addColorStop(1, 'rgba(' + rgb + ',' + (a * .5) + ')');
        return gr;
      };
      spindle(6, 1.2); g.fillStyle = ramp('30,40,80', .5); g.fill();        // koyu alt gölge: açık gökte de seçilsin
      spindle(4.4, 0); g.fillStyle = ramp(col, 1); g.fill();
      spindle(1.6, -.5); g.fillStyle = ramp('255,255,255', .9); g.fill();   // parlak çekirdek
    });
  }
  function drawSpeedLines(ctx, VW, VH) {
    const cx = VW * .5, cy = VH * .5;
    const s0 = streakSprite(speed.col);
    grabXf(ctx, false);
    for (const ln of speed.lines) {
      const env = Math.min(1, Math.sin(PI * clamp(ln.t, 0, 1)) * 1.7);
      if (env < .02) continue;
      const c = Math.cos(ln.a), s = Math.sin(ln.a);
      // ışının ekran kenarına uzaklığı (dikdörtgen); şerit iç ucu ≥ %68'de başlar, en parlak kısmı ekranda kalır
      const te = Math.min(Math.abs(c) > 1e-4 ? cx / Math.abs(c) : 1e9, Math.abs(s) > 1e-4 ? cy / Math.abs(s) : 1e9);
      const len = clamp(te * ln.lf, 40, 160);
      const r0 = te * (.68 + ln.j + .1 * ln.t);
      ctx.globalAlpha = speed.a * SPEED_A * env * ln.k;
      spr(ctx, s0, cx + c * r0, cy + s * r0, ln.a, len / STREAK_L, ln.w * clamp(len / 150, .55, 1.1));
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }

  /* ---- tema tonu + vinyet: tema başına tek önbellekli tuval (tam ekran tek geçiş, kare başına gradyan yok) ---- */
  const THEME_TINT = {
    castle: [[0, 'rgba(255,110,60,.07)'], [1, 'rgba(255,170,80,.035)']],
    snow: [[0, 'rgba(120,170,255,.07)'], [1, 'rgba(180,220,255,.035)']]
  };
  const vigTheme = new Map();
  function themeVignette(tid) {
    const key = THEME_TINT[tid] ? tid : '';
    let c = vigTheme.get(key);
    if (c) return c;
    if (!vigC) buildVignettes();
    const N = vigC.width;
    c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d');
    const tint = THEME_TINT[key];
    if (tint) {
      const gr = g.createLinearGradient(0, 0, 0, N);
      for (const st of tint) gr.addColorStop(st[0], st[1]);
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
    }
    g.globalAlpha = .9; g.drawImage(vigC, 0, 0); g.globalAlpha = 1;   // eski sıra: ton, sonra vinyet ×.9
    vigTheme.set(key, c);
    return c;
  }

  function updScreen(dt) {
    const p = S.player;
    const inRace = S.mode === 'race' || S.mode === 'count' || S.mode === 'end';
    // mürekkep
    const iv = p && inRace ? num(p.inked, 0) : 0;
    if (iv > 0 && (iv > ink.last + .25 || !ink.on)) startInk();
    if (iv <= 0 && ink.on && ink.last <= 0) { ink.on = false; ink.blobs = []; ink.drips = []; }
    ink.last = iv;
    // kırağı
    const fz = p && inRace ? num(p.frozen, 0) : 0;
    if (fz > 0) frost.t += dt; else frost.t = 0;
    // hız çizgileri
    const fast = p && inRace && p.dead <= 0 && (num(p.boost, 0) > 0 || num(p.dash, 0) > 0 || num(p.padT, 0) > 0 || num(p.sled, 0) > 0);
    speed.a = clamp(speed.a + (fast ? dt * 6 : -dt * 4), 0, 1);
    if (speed.a > 0) {
      const Ls = speed.lines;
      if (Ls.length !== SPEED_N) { Ls.length = 0; for (let i = 0; i < SPEED_N; i++) Ls.push(newStreak(i, rnd())); }
      for (let i = 0; i < Ls.length; i++) {
        const ln = Ls[i];
        ln.t += dt / ln.dur;
        if (ln.t >= 1) Ls[i] = newStreak(i, ln.t - 1 > .5 ? 0 : ln.t - 1);
      }
      speed.col = p && num(p.dash, 0) > 0 ? '215,190,255' : p && num(p.sled, 0) > 0 ? '210,240,255' : '255,255,255';
    }
  }

  R.drawScreenFX = function (ctx) {
    if (!S.L || S.mode === 'podium') return;
    const VW = V.VW || 1000, VH = V.VH || 540;
    const p = S.player;
    const inRace = S.mode === 'race' || S.mode === 'count' || S.mode === 'end';
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const tid = S.L.theme && S.L.theme.id;
    // hız çizgileri (yalnızca dış çerçeve)
    if (inRace && speed.a > .01 && speed.lines.length) drawSpeedLines(ctx, VW, VH);
    // kırağı
    if (inRace && p && num(p.frozen, 0) > 0) {
      const key = Math.round(VW) + 'x' + Math.round(VH);
      if (!frost.c || frost.key !== key) buildFrost();
      const a = Math.min(1, frost.t / .18) * Math.min(1, num(p.frozen, 0) / .45);
      ctx.globalAlpha = a * .7;   // göz konforu: kırağı göz almasın
      ctx.drawImage(frost.c, 0, 0, VW, VH);
      ctx.globalAlpha = 1;
    }
    // mürekkep
    if (inRace && ink.on && ink.blobs.length && p && num(p.inked, 0) > 0) drawInk(ctx, num(p.inked, 0));
    // ölüm vinyeti
    if (!vigC) buildVignettes();
    if (inRace && p && p.dead > 0) {
      const d = num(p.dead, 0);
      const a = Math.min(1, (1.1 - d) / .12) * Math.min(1, d / .5);
      if (a > 0) { ctx.globalAlpha = a * .7; ctx.drawImage(redC, 0, 0, VW, VH); }
    }
    // her zaman hafif vinyet (+ kar/kale tema tonu aynı tuvalde pişmiş: tek tam ekran geçiş)
    ctx.globalAlpha = 1;
    ctx.drawImage(themeVignette(tid), 0, 0, VW, VH);
    // vurulma yönü yayı (oyuncunun etrafında)
    if (inRace && hits.length) drawHitDirs(ctx);
    // renkli tam ekran flaş
    const fl = S.flash;
    if (fl && fl.a > .003) {
      ctx.globalAlpha = Math.min(.55, fl.a);   // tam ekran flaş en çok .55: kör etmesin
      ctx.fillStyle = fl.col || '#ffffff';
      ctx.fillRect(0, 0, VW, VH);
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  /* =====================================================================
     YENİ HARİTA / MOD / ÇOK OYUNCULU EFEKTLERİ
     meteor (uyarı gölgesi + alevli kaya + iz + çarpma, yanık izi), ışınlanma girdabı, gayzer suyu/buharı,
     eleme (duman + "ELENDİ!" + yükselen hayalet), düşen altın saçılması, bağlantı kopması.
     Olay yerine durum değişimini izleyenler (ışınlanma: r.tp, gayzer: v.act, düşen altın: L.coins) uzak yarışçılar
     için de çalışır (ağdan gelen durumlar olay yaymaz).
     ===================================================================== */
  R.meteorFx = true;            // game.js'teki yedek kırmızı parıltı kapanır
  R.platesLate = true;          // render-chars plakaları drawParticles sonunda (füze/uyarı üstünde) çizilir
  const swirls = [], ghosts = [], scorches = [];
  const METEOR_FALL = .55, MET_DX = 330, MET_DY = -820;

  function meteorFall(e) {
    const mx = Math.max(.1, num(e.max, 1.25)), fall = Math.min(METEOR_FALL, mx * .6);
    const t = num(e.t, 0);
    if (t > fall) return null;
    const f = clamp(1 - t / fall, 0, 1), u = 1 - f;
    return { f, x: num(e.x, 0) + MET_DX * u, y: num(e.y, 0) - 16 + MET_DY * u };
  }
  function meteorRockSprite() {
    return sp('metRock', 64, 64, 32, 32, g => {
      const n = 11, pts = [];
      for (let i = 0; i < n; i++) { const a = i / n * TAU, rr = 18.5 + Math.sin(i * 2.7) * 2.4 + Math.cos(i * 1.3) * 1.6; pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
      const path = () => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); };
      path(); g.lineJoin = 'round'; g.lineWidth = 3.4; g.strokeStyle = '#1c0c08'; g.stroke();
      const gr = g.createRadialGradient(-6, -7, 2, 0, 0, 22);
      gr.addColorStop(0, '#8a5a44'); gr.addColorStop(.5, '#5a3326'); gr.addColorStop(1, '#2e1610');
      g.fillStyle = gr; g.fill();
      g.save(); path(); g.clip();
      // krater lekeleri
      g.fillStyle = 'rgba(30,12,8,.45)';
      g.beginPath(); g.arc(6, 5, 5, 0, TAU); g.fill(); g.beginPath(); g.arc(-8, 7, 3.2, 0, TAU); g.fill(); g.beginPath(); g.arc(4, -9, 2.6, 0, TAU); g.fill();
      // akkor çatlaklar
      g.lineCap = 'round';
      const crack = (c, w) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(-14, 2); g.lineTo(-5, -1); g.lineTo(0, 6); g.lineTo(9, 3); g.lineTo(15, 9); g.moveTo(-5, -1); g.lineTo(-2, -10); g.lineTo(5, -14); g.moveTo(0, 6); g.lineTo(-3, 15); g.stroke(); };
      crack('rgba(255,120,30,.55)', 4.2); crack('#ffd25a', 1.6);
      // sıcak alt kenar (iniş yönü sol-alt)
      const hg = g.createRadialGradient(-12, 12, 2, -12, 12, 22);
      hg.addColorStop(0, 'rgba(255,190,80,.75)'); hg.addColorStop(1, 'rgba(255,120,30,0)');
      g.fillStyle = hg; g.fillRect(-32, -32, 64, 64);
      g.restore();
      g.beginPath(); g.ellipse(-6, -9, 5, 2.6, -.6, 0, TAU); g.fillStyle = 'rgba(255,230,200,.35)'; g.fill();
    });
  }
  /* alev izi: orijin kaya merkezi, +x yönünde (geriye doğru) uzanır */
  function meteorTrailSprite(core) {
    const L = core ? 150 : 230, W = core ? 26 : 52;
    return sp('metTrail' + (core ? 'C' : ''), L + W, W + 8, W / 2, W / 2 + 4, g => {
      const gr = g.createLinearGradient(-W / 2, 0, L, 0);
      if (core) { gr.addColorStop(0, 'rgba(255,255,235,1)'); gr.addColorStop(.25, 'rgba(255,230,140,.9)'); gr.addColorStop(.7, 'rgba(255,150,50,.35)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); }
      else { gr.addColorStop(0, 'rgba(255,214,110,.95)'); gr.addColorStop(.2, 'rgba(255,140,40,.85)'); gr.addColorStop(.55, 'rgba(220,60,20,.45)'); gr.addColorStop(1, 'rgba(90,30,30,0)'); }
      g.beginPath();
      g.moveTo(0, -W / 2);
      g.bezierCurveTo(L * .35, -W * .42, L * .7, -W * .12, L, 0);
      g.bezierCurveTo(L * .7, W * .12, L * .35, W * .42, 0, W / 2);
      g.arc(0, 0, W / 2, PI / 2, PI * 1.5);
      g.closePath();
      g.fillStyle = gr; g.fill();
    });
  }
  function meteorShadowSprite() {
    return sp('metShadow', 72, 72, 36, 36, g => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 34);
      gr.addColorStop(0, 'rgba(40,6,4,.62)'); gr.addColorStop(.6, 'rgba(70,10,6,.38)'); gr.addColorStop(1, 'rgba(90,10,6,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.fill();
    });
  }
  function meteorBeamSprite() {
    return sp('metBeam', 40, 420, 20, 420, g => {
      const gr = g.createLinearGradient(0, -420, 0, 0);
      gr.addColorStop(0, 'rgba(255,70,40,0)'); gr.addColorStop(.7, 'rgba(255,70,40,.16)'); gr.addColorStop(1, 'rgba(255,90,50,.42)');
      const hg = g.createLinearGradient(-20, 0, 20, 0);
      g.fillStyle = gr; g.fillRect(-20, -420, 40, 420);
      g.globalCompositeOperation = 'destination-in';
      hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(.5, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hg; g.fillRect(-20, -420, 40, 420);
      g.globalCompositeOperation = 'source-over';
    });
  }
  function scorchSprite() {
    return sp('metScorch', 140, 40, 70, 20, g => {
      g.save(); g.scale(1, .26);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 66);
      gr.addColorStop(0, 'rgba(20,8,6,.8)'); gr.addColorStop(.55, 'rgba(40,16,10,.5)'); gr.addColorStop(1, 'rgba(40,16,10,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 66, 0, TAU); g.fill();
      g.restore();
    });
  }
  /* yerde: uyarı gölgesi + ışık sütunu + daralan oklar (yarışçıların ALTINDA) */
  function drawMeteorWarn(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0), rad = num(e.r, 62);
    if (!inView(x, y - 150, rad + 320)) return;
    const mx = Math.max(.1, num(e.max, 1.25)), q = clamp(1 - num(e.t, 0) / mx, 0, 1);
    const pulse = .5 + .5 * Math.sin(FXT * (10 + q * 16));
    // ışık sütunu (gökten iniş çizgisi)
    ctx.globalAlpha = (.35 + .45 * q) * (.75 + .25 * pulse);
    spr(ctx, meteorBeamSprite(), x, y + 2, 0, rad * (1.25 - .55 * q) / 20, 1);
    // büyüyen gölge
    ctx.globalAlpha = .45 + .55 * q;
    spr(ctx, meteorShadowSprite(), x, y + 1, 0, rad * (.35 + .75 * q) / 34, rad * (.35 + .75 * q) / 34 * .3);
    // tehlike halkası
    setXf(ctx, x, y + 1, 0, 1, .3);
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU);
    ctx.globalAlpha = .55 + .45 * pulse;
    ctx.lineWidth = 7 + 2 * pulse; ctx.strokeStyle = 'rgba(60,0,0,.55)'; ctx.stroke();
    ctx.lineWidth = 3.4 + 1.6 * pulse; ctx.strokeStyle = q > .7 ? '#ffd23f' : '#ff3b2a'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, rad * (.25 + .7 * q), 0, TAU);
    ctx.globalAlpha = .25 + .35 * q; ctx.lineWidth = 2.5; ctx.strokeStyle = '#ff7a4a'; ctx.stroke();
    // içe kayan oklar
    const rr = rad * (1.5 - .5 * q);
    ctx.globalAlpha = .6 + .4 * pulse;
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + PI / 4, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr, ux = -Math.cos(a), uy = -Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + ux * 12, cy + uy * 12);
      ctx.lineTo(cx - uy * 9, cy + ux * 9);
      ctx.lineTo(cx + uy * 9, cy - ux * 9);
      ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = '#3a0000'; ctx.stroke();
      ctx.fillStyle = '#ff4a2a'; ctx.fill();
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }
  /* havada: alevli kaya + iz (yarışçıların ÜSTÜNDE) */
  function drawMeteorRock(ctx, e) {
    const m = meteorFall(e);
    if (!m || !inView(m.x, m.y, 320)) return;
    const ang = Math.atan2(-MET_DY, -MET_DX);          // gidiş yönü (sol-aşağı)
    const back = ang + PI, sc = .9 + .2 * m.f, fl = .9 + rnd() * .2;
    ctx.globalAlpha = .9;
    spr(ctx, meteorTrailSprite(false), m.x, m.y, back, sc * fl, sc);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .65;
    spr(ctx, glowSprite('#ff8a2a'), m.x, m.y, 0, 70 / 32 * sc);
    ctx.globalAlpha = .9;
    spr(ctx, meteorTrailSprite(true), m.x, m.y, back, sc * fl, sc * .9);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    spr(ctx, meteorRockSprite(), m.x, m.y, FXT * 7 + num(e.x, 0), sc * 1.05);
    resetXf(ctx);
  }
  function updMeteors(dt) {
    const L = S.ents || [];
    for (const e of L) {
      if (!e || e.type !== 'meteor') continue;
      const m = meteorFall(e);
      if (!m || !inView(m.x, m.y, 260)) continue;
      const v = vis(e);
      v.acc += dt * 70;
      while (v.acc >= 1) {
        v.acc -= 1;
        const j = rnd();
        P({ k: 'fball', x: m.x + MET_DX * .02 * j + (rnd() - .5) * 14, y: m.y + MET_DY * .02 * j + (rnd() - .5) * 14, vx: (rnd() - .5) * 60 + 90, vy: -120 - rnd() * 80, life: .35 + rnd() * .3, c: '#ffb347', s: 9 + rnd() * 8, g: -60, drag: 2.5, rot: rnd() * 6, vr: (rnd() - .5) * 3 });
        if (rnd() < .45) P({ k: 'spark', x: m.x, y: m.y, vx: 160 + rnd() * 220, vy: -320 - rnd() * 380, life: .25 + rnd() * .25, c: '#ffcf6a', s: 2, g: 500, add: true });
      }
    }
    for (let i = scorches.length - 1; i >= 0; i--) { scorches[i].t += dt; if (scorches[i].t > scorches[i].max) scorches.splice(i, 1); }
  }
  function drawScorches(ctx) {
    for (const s of scorches) {
      if (!inView(s.x, s.y, 160)) continue;
      const k = s.t / s.max, a = k < .7 ? 1 : 1 - (k - .7) / .3;
      ctx.globalAlpha = a * .85;
      spr(ctx, scorchSprite(), s.x, s.y + 1, 0, s.r / 62);
      // sönen közler
      if (k < .6) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k / .6) * (.5 + .3 * Math.sin(FXT * 9 + s.x));
        spr(ctx, glowSprite('#ff7a2a'), s.x, s.y - 2, 0, s.r * .7 / 32, s.r * .22 / 32);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }
  FM.on('meteor', d => {
    if (!d) return;
    const x = num(d.x, 0), y = num(d.y, 0);
    if (!inView(x, y, 300)) return;
    scorches.push({ x, y, r: 62, t: 0, max: 4 });
    if (scorches.length > 8) scorches.shift();
    for (let i = 0; i < 12; i++) {
      const a = -PI / 2 + (rnd() - .5) * 2.6, sp2 = 300 + rnd() * 520;
      P({ k: 'dot', x: x + (rnd() - .5) * 30, y: y - 10, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2, life: .8 + rnd() * .5, c: i % 3 === 0 ? '#ff8a2a' : (i % 3 === 1 ? '#5a3a2e' : '#3a2620'), s: 3 + rnd() * 3.5, g: 1400, drag: .4 });
    }
    for (let i = 0; i < 8; i++) P({ k: 'puff', x: x + (rnd() - .5) * 60, y: y - 8 - rnd() * 14, vx: (rnd() - .5) * 320, vy: -40 - rnd() * 140, life: .9 + rnd() * .5, c: 'rgba(130,100,80,.78)', s: 20 + rnd() * 16, g: -30, drag: 2.4 });
    if (FM.fx && FM.fx.sparks) FM.fx.sparks(x, y - 12, 16, '#ffb347', 560);
    if (FM.fx && FM.fx.ring) FM.fx.ring(x, y - 8, 105, '#ff7a2a', .5, 10);
    P({ k: 'glow', x, y: y - 20, vx: 0, vy: 0, life: .35, c: '#ffc070', s: 150, add: true });
    const pl = S.player;
    if (pl && !pl.ghost && Math.abs(rcx(pl) - x) < 520 && Math.abs(rcy(pl) - y) < 400 && FM.fx && FM.fx.shake) FM.fx.shake(.22);
  });

  /* ---------- ışınlanma girdabı (A: içe çeken mor, B: dışa açılan turkuaz) ---------- */
  const TPS = new WeakMap();
  function portalSwirl(x, y, dir, col, sy) {
    swirls.push({ x, y, dir, col, sy, t: 0, max: dir < 0 ? .5 : .6, rot: rnd() * TAU });
    if (swirls.length > 10) swirls.shift();
    if (!budget()) return;
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU;
      if (dir < 0) { const rr = 58 + rnd() * 20; P({ k: i % 2 ? 'star' : 'twinkle', x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * sy, vx: -Math.cos(a) * rr * 3.4, vy: -Math.sin(a) * rr * sy * 3.4, life: .28, c: i % 3 ? col : '#ffffff', s: i % 2 ? 3.2 : 12, rot: a, add: i % 2 === 0 }); }
      else { const v = 140 + rnd() * 200; P({ k: i % 2 ? 'star' : 'twinkle', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * sy * .8 - 40, life: .45 + rnd() * .2, c: i % 3 ? col : '#ffffff', s: i % 2 ? 3.4 : 13, drag: 2.5, rot: a, add: i % 2 === 0 }); }
    }
  }
  function scanTeleports() {
    const L = S.L;
    if (!L || !L.portals || !L.portals.length || !S.racers) return;
    for (const r of S.racers) {
      if (!r) continue;
      const tp = r.tp | 0, dead = r.dead > 0;
      const st = TPS.get(r);
      if (!st) { TPS.set(r, { tp, dead }); continue; }
      if (tp > st.tp && !st.dead && !dead) {
        const cx = rcx(r), feet = num(r.y, 0) + num(r.h, 42);
        for (const p of L.portals) {
          if (Math.abs(p.bx - cx) < 80 && Math.abs(p.by - feet) < 110) {
            if (inView(p.ax, p.ay, 160)) portalSwirl(p.ax, p.ay, -1, '#c084fc', num(p.h, 38) / num(p.r, 22));
            if (inView(p.bx, p.by - 40, 160)) portalSwirl(p.bx, p.by - 40, 1, '#5ef0ff', 1.5);
            break;
          }
        }
      }
      st.tp = tp; st.dead = dead;
    }
  }
  function drawSwirls(ctx) {
    if (!swirls.length) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const w of swirls) {
      if (!inView(w.x, w.y, 140)) continue;
      const k = clamp(w.t / w.max, 0, 1), e = easeOutCubic(k);
      const R0 = w.dir < 0 ? lerp(66, 4, e) : lerp(8, 84, e);
      const a = w.dir < 0 ? Math.min(1, (1 - k) * 2.2) : (1 - k) * (1 - k);
      ctx.globalAlpha = a * .8;
      spr(ctx, glowSprite(w.col), w.x, w.y, 0, (w.dir < 0 ? 70 * (1 - k * .6) : 40 + 60 * e) / 32, (w.dir < 0 ? 70 * (1 - k * .6) : 40 + 60 * e) / 32 * w.sy);
      ctx.globalCompositeOperation = 'source-over';
      setXf(ctx, w.x, w.y, 0, 1, w.sy);
      for (let arm = 0; arm < 3; arm++) {
        ctx.beginPath();
        for (let s = 0; s <= 14; s++) {
          const u = s / 14, ang = w.rot + arm * TAU / 3 + u * 2.6 * w.dir, rr = R0 * (.2 + .8 * u);
          const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
          if (s) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.globalAlpha = a * .35; ctx.lineWidth = 9; ctx.strokeStyle = INK; ctx.stroke();
        ctx.globalAlpha = a * .85; ctx.lineWidth = 6; ctx.strokeStyle = w.col; ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      resetXf(ctx);
      ctx.globalCompositeOperation = 'lighter';
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function updSwirls(dt) {
    for (let i = swirls.length - 1; i >= 0; i--) { const w = swirls[i]; w.t += dt; w.rot += dt * 11 * w.dir; if (w.t >= w.max) swirls.splice(i, 1); }
  }

  /* ---------- gayzer: fışkırma öncesi kabarcık, fışkırmada su + buhar ---------- */
  const VST = new WeakMap();
  const WCOLS = ['#ffffff', '#d6f4ff', '#8fd8ff', '#bfe9ff'];
  function scanVents(dt) {
    const L = S.L;
    if (!L || !L.vents || !L.vents.length) return;
    for (const v of L.vents) {
      if (!v || v.kind !== 'burst') continue;
      const w = num(v.w, 64), cx = num(v.x, 0) + w / 2, y = num(v.y, 0), h = num(v.h, 300);
      if (!inView(cx, y - h / 2, h / 2 + 200)) continue;
      let st = VST.get(v);
      if (!st) { st = { act: !!v.act, a: 0, b: 0 }; VST.set(v, st); }
      if (v.act && !st.act) {
        for (let i = 0; i < 24; i++) P({ k: 'dot', x: cx + (rnd() - .5) * w * .7, y: y - 6, vx: (rnd() - .5) * 340, vy: -650 - rnd() * 520, life: .9 + rnd() * .5, c: WCOLS[i % 4], s: 2.6 + rnd() * 2.6, g: 1500, drag: .2 });
        for (let i = 0; i < 8; i++) P({ k: 'puff', x: cx + (rnd() - .5) * w, y: y - 10, vx: (rnd() - .5) * 260, vy: -60 - rnd() * 120, life: .7 + rnd() * .4, c: 'rgba(240,250,255,.85)', s: 18 + rnd() * 14, g: -40, drag: 2.2 });
        if (FM.fx && FM.fx.ring) FM.fx.ring(cx, y - 8, 70, '#bfe9ff', .4, 7);
      }
      st.act = !!v.act;
      if (!budget()) continue;
      if (v.act) {
        st.a += dt * 30;
        while (st.a >= 1) { st.a -= 1; P({ k: 'dot', x: cx + (rnd() - .5) * w * .5, y: y - 6, vx: (rnd() - .5) * 120, vy: -Math.sqrt(2 * 1500 * h) * (.8 + rnd() * .25), life: 1.1 + rnd() * .3, c: WCOLS[(rnd() * 4) | 0], s: 2.2 + rnd() * 2.4, g: 1500, drag: .15 }); }
        st.b += dt * 11;
        while (st.b >= 1) { st.b -= 1; P({ k: 'puff', x: cx + (rnd() - .5) * w * .8, y: y - h * (.5 + rnd() * .45), vx: (rnd() - .5) * 90, vy: -30 - rnd() * 70, life: .7 + rnd() * .4, c: 'rgba(235,248,255,.7)', s: 16 + rnd() * 16, g: -30, drag: 1.5 }); }
      } else if (num(v.k, 0) > 0) {
        st.a += dt * (6 + v.k * 26);
        while (st.a >= 1) { st.a -= 1; P({ k: 'dot', x: cx + (rnd() - .5) * w * .6, y: y - 3, vx: (rnd() - .5) * 70, vy: -110 - rnd() * 200 * v.k, life: .3 + rnd() * .2, c: '#e8f8ff', s: 1.8 + rnd() * 1.8, g: 900 }); }
        st.b += dt * 5 * v.k;
        while (st.b >= 1) { st.b -= 1; P({ k: 'puff', x: cx + (rnd() - .5) * w * .5, y: y - 8, vx: (rnd() - .5) * 40, vy: -40 - rnd() * 40, life: .5 + rnd() * .3, c: 'rgba(240,250,255,.6)', s: 10 + rnd() * 8, g: -40, drag: 1.5 }); }
      } else { st.a = 0; st.b = 0; }
    }
  }

  /* ---------- eleme: duman + "ELENDİ!" + yükselen hayalet ---------- */
  FM.on('eliminated', d => {
    const r = d && d.r;
    if (!r || !isFinite(r.x) || !isFinite(r.y)) return;
    const x = rcx(r), y = rcy(r);
    if (!inView(x, y, 220)) return;
    for (let i = 0; i < 7; i++) P({ k: 'puff', x: x + (rnd() - .5) * 26, y: y + (rnd() - .5) * 20, vx: (rnd() - .5) * 320, vy: -40 - rnd() * 120, life: .7 + rnd() * .4, c: i % 2 ? 'rgba(110,98,128,.62)' : 'rgba(200,192,214,.6)', s: 14 + rnd() * 12, g: -50, drag: 2.6 });
    if (FM.fx && FM.fx.sparks) FM.fx.sparks(x, y, 14, '#ff5a6e', 440);
    P({ k: 'glow', x, y, vx: 0, vy: 0, life: .3, c: '#ff5a6e', s: 110, add: true });
    P({ k: 'text', x, y: num(r.y, y) - 78, vx: 0, vy: -26, life: 1.7, c: '#ff4d5e', s: 26, g: 0, str: 'ELENDİ!' });
    ghosts.push({ x, y: num(r.y, y) + num(r.h, 42) - 18, id: r.id, skin: r.skin, t: 0, max: 1.9, ph: rnd() * TAU });
    if (ghosts.length > 6) ghosts.shift();
  });
  function drawGhosts(ctx) {
    if (!ghosts.length || typeof R.portrait !== 'function') return;
    for (const g of ghosts) {
      const k = clamp(g.t / g.max, 0, 1);
      const yy = g.y - 18 - 110 * easeOutCubic(k), xx = g.x + Math.sin(g.t * 4.5 + g.ph) * 9;
      if (!inView(xx, yy, 80)) continue;
      const a = (k < .12 ? k / .12 : 1) * (1 - k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * .55;
      spr(ctx, glowSprite('#e8e0ff'), xx, yy, 0, 44 / 32);
      ctx.globalCompositeOperation = 'source-over';
      let c = null;
      try { c = R.portrait(g.id, 72, { skin: g.skin, ring: false }); } catch (e) { c = null; }
      if (c) {
        ctx.globalAlpha = a * .8;
        setXf(ctx, xx, yy, Math.sin(g.t * 3 + g.ph) * .12, 1, 1);
        ctx.drawImage(c, -24, -24, 48, 48);
        // dalgalı hayalet kuyruğu
        ctx.beginPath(); ctx.moveTo(-15, 14);
        for (let i = 0; i <= 6; i++) ctx.lineTo(-15 + i * 5, 26 + (i % 2 ? -5 : 3) + Math.sin(g.t * 9 + i) * 2);
        ctx.lineTo(15, 14); ctx.closePath();
        ctx.globalAlpha = a * .45; ctx.fillStyle = '#efeaff'; ctx.fill();
      }
    }
    resetXf(ctx);
    ctx.globalAlpha = 1;
  }
  function updGhosts(dt) { for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].t += dt; if (ghosts[i].t >= ghosts[i].max) ghosts.splice(i, 1); } }

  /* =====================================================================
     MAĞAZA 2.0 — ZAFER KUTLAMALARI (FM.COSMETICS.wins fx) ve ÖLÜM EFEKTLERİ (FM.COSMETICS.deaths fx)
     Kutlama: 'finish' olayında yarışçının (r.win; yerel oyuncuda kuşanılan) kutlaması ~6 sn boyunca her ~0.75 sn tekrarlar.
     Ölüm: 'death' olayında r.death'e göre ek parçacıklar (klasik puf/patlama game.js'te zaten var; 'none' ek yapmaz).
     ===================================================================== */
  const WINS = [];
  function cosOf(type, id) { const L = FM.COSMETICS && FM.COSMETICS[type]; if (L) for (const it of L) if (it.id === id) return it; return null; }
  function localCos(r, type) {
    if (!r) return null;
    const key = type === 'wins' ? 'win' : 'death';
    let id = r[key];
    if (id == null && r.ctrl === 'local' && !r.ghost && FM.meta && typeof FM.meta.equipped === 'function') { try { id = FM.meta.equipped(type); } catch (e) { id = null; } }
    const it = id && id !== 'none' ? cosOf(type, id) : null;
    return it && it.fx && it.fx.k ? it : null;
  }
  function headOf(r) {
    let h = null;
    try { if (typeof R.charHeadPos === 'function') h = R.charHeadPos(r); } catch (e) { h = null; }
    return h && isFinite(h.x) && isFinite(h.y) ? h : { x: rcx(r), y: num(r.y, 0) + 6 };
  }
  function winBurst(r, fx, first) {
    const cols = fx.cols && fx.cols.length ? fx.cols : ['#ffffff'];
    const cx = rcx(r), fy = num(r.y, 0) + num(r.h, 42), hd = headOf(r), hy = hd.y;
    if (!inView(cx, hy, 220)) return;
    const k = fx.k;
    if (first && fx.ring && FM.fx && FM.fx.ring) FM.fx.ring(cx, fy - 22, 34, fx.ring, .5, 6);
    switch (k) {
      case 'conf':
        for (let i = 0; i < 22; i++) { const a = -PI / 2 + (rnd() - .5) * 1.8, v = 240 + rnd() * 260; P({ k: 'conf', x: cx, y: hy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4 + rnd() * .8, c: cols[i % cols.length], s: 5 + rnd() * 4, g: 380, rot: rnd() * 6, vr: (rnd() - .5) * 16, drag: 1.2 }); }
        break;
      case 'heart':
        for (let i = 0; i < 9; i++) P({ k: 'heart', x: cx + (rnd() - .5) * 60, y: hy + 10 + rnd() * 30, vx: (rnd() - .5) * 50, vy: -(50 + rnd() * 70), life: 1.1 + rnd() * .5, c: cols[i % cols.length], s: 5 + rnd() * 3.5, g: -40, drag: 1.4 });
        break;
      case 'firework': {
        const bx = cx + (rnd() - .5) * 120, by = hy - 70 - rnd() * 70, col = pick(cols);
        for (let i = 0; i < 26; i++) { const a = rnd() * TAU, v = 110 + rnd() * 170; P({ k: i % 3 ? 'spark' : 'star', x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + rnd() * .5, c: i % 4 === 3 ? '#ffffff' : col, s: i % 3 ? 2.2 : 4, g: 160, drag: 1.6, rot: a, add: i % 3 !== 0 }); }
        P({ k: 'glow', x: bx, y: by, vx: 0, vy: 0, life: .35, c: col, s: 90, add: true });
        if (FM.fx && FM.fx.ring) FM.fx.ring(bx, by, 14, col, .4, 4);
        break;
      }
      case 'twinkle':
        for (let i = 0; i < 10; i++) P({ k: 'twinkle', x: cx + (rnd() - .5) * 70, y: fy - rnd() * 70, vx: (rnd() - .5) * 20, vy: -20 - rnd() * 30, life: .4 + rnd() * .4, c: cols[i % cols.length], s: 10 + rnd() * 10, add: true, rot: rnd() });
        break;
      case 'star':
        for (let i = 0; i < 18; i++) { const a = rnd() * TAU, v = 150 + rnd() * 220; P({ k: 'star', x: cx, y: fy - 26, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: .7 + rnd() * .5, c: cols[i % cols.length], s: 3.5 + rnd() * 3, g: 320, drag: 1.4, rot: a, vr: (rnd() - .5) * 8 }); }
        P({ k: 'glow', x: cx, y: fy - 26, vx: 0, vy: 0, life: .3, c: cols[0], s: 80, add: true });
        break;
      case 'note':
        for (let i = 0; i < 6; i++) P({ k: 'note', x: cx + (rnd() - .5) * 50, y: hy + rnd() * 20, vx: (rnd() - .5) * 40, vy: -(50 + rnd() * 60), life: 1 + rnd() * .5, c: cols[i % cols.length], s: 5 + rnd() * 2.5, g: -50, drag: 1.3 });
        break;
      case 'flame':
        for (let i = 0; i < 14; i++) { const a = i / 14 * TAU + rnd() * .3, rr = 30 + rnd() * 8; P({ k: 'flame', x: cx + Math.cos(a) * rr, y: fy - 4 + Math.sin(a) * rr * .3, vx: Math.cos(a) * 20, vy: -(70 + rnd() * 90), life: .5 + rnd() * .35, c: '#ffffff', s: 7 + rnd() * 5, g: -200, drag: 2.2 }); }
        for (let i = 0; i < 6; i++) P({ k: 'spark', x: cx + (rnd() - .5) * 60, y: fy - 10, vx: (rnd() - .5) * 80, vy: -(120 + rnd() * 160), life: .4 + rnd() * .3, c: pick(cols), s: 1.8, g: 200, add: true });
        break;
      default:
        for (let i = 0; i < 10; i++) P({ k: 'dot', x: cx + (rnd() - .5) * 40, y: hy, vx: (rnd() - .5) * 80, vy: -(60 + rnd() * 80), life: .6, c: pick(cols), s: 4, g: 200 });
    }
  }
  function updWins(dt) {
    for (let i = WINS.length - 1; i >= 0; i--) {
      const w = WINS[i], r = w.r;
      w.t += dt; w.next -= dt;
      if (w.t > 6.5 || !r || !r.finished || r.dead > 0 || !(S.mode === 'race' || S.mode === 'end' || S.mode === 'podium')) { WINS.splice(i, 1); continue; }
      if (w.next <= 0 && budget()) { w.next = w.k === 'firework' ? .55 : w.k === 'flame' ? .5 : .8; try { winBurst(r, w.fx, w.n === 0); } catch (e) { /* kutlama çizilemedi */ } w.n++; }
    }
  }
  FM.on('finish', d => {
    const r = d && d.r;
    if (!r || S.mode === 'demo') return;
    const it = localCos(r, 'wins');
    if (!it) return;
    for (const w of WINS) if (w.r === r) return;
    if (WINS.length > 10) WINS.shift();
    WINS.push({ r, fx: it.fx, k: it.fx.k, t: 0, next: 0.15, n: 0 });
  });
  function deathFx(r, fx) {
    const cols = fx.cols && fx.cols.length ? fx.cols : ['#ffffff'];
    const x = rcx(r), y = rcy(r), fy = num(r.y, 0) + num(r.h, 42);
    if (!inView(x, y, 240)) return;
    switch (fx.k) {
      case 'puff':
        for (let i = 0; i < 10; i++) P({ k: 'puff', x: x + (rnd() - .5) * 24, y: y + (rnd() - .5) * 20, vx: (rnd() - .5) * 220, vy: -30 - rnd() * 110, life: .8 + rnd() * .5, c: rgba(cols[i % cols.length], .7), s: 16 + rnd() * 12, g: -40, drag: 2.4, rot: rnd() * 6 });
        break;
      case 'bubble':
        for (let i = 0; i < 14; i++) P({ k: 'bubble', x: x + (rnd() - .5) * 30, y: y + (rnd() - .5) * 30, vx: (rnd() - .5) * 70, vy: -(30 + rnd() * 80), life: .8 + rnd() * .7, c: cols[i % cols.length], s: 5 + rnd() * 7, g: -60, drag: 1.5 });
        break;
      case 'star':
        for (let i = 0; i < 16; i++) { const a = rnd() * TAU, v = 120 + rnd() * 220; P({ k: i % 3 ? 'star' : 'twinkle', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: .6 + rnd() * .5, c: cols[i % cols.length], s: i % 3 ? 3.5 + rnd() * 3 : 12 + rnd() * 8, g: 260, drag: 1.5, rot: a, add: i % 3 === 0 }); }
        P({ k: 'glow', x, y, vx: 0, vy: 0, life: .35, c: cols[0], s: 90, add: true });
        break;
      case 'ghost':
        ghosts.push({ x, y: num(r.y, y) + num(r.h, 42) - 18, id: r.id, skin: r.skin, t: 0, max: 2.1, ph: rnd() * TAU });
        if (ghosts.length > 6) ghosts.shift();
        for (let i = 0; i < 6; i++) P({ k: 'puff', x: x + (rnd() - .5) * 20, y: y + (rnd() - .5) * 16, vx: (rnd() - .5) * 60, vy: -40 - rnd() * 50, life: .6 + rnd() * .3, c: 'rgba(232,224,255,.6)', s: 12 + rnd() * 8, g: -30, drag: 2 });
        break;
      case 'pixel': {
        const ch = FM.CH[r.id], pc = ch ? [ch.col, ch.col2, ch.acc].filter(Boolean).concat(cols) : cols;
        for (let i = 0; i < 24; i++) P({ k: 'pixel', x: x + (rnd() - .5) * 28, y: y + (rnd() - .5) * 40, vx: (rnd() - .5) * 260, vy: -(60 + rnd() * 240), life: .7 + rnd() * .5, c: pc[i % pc.length], s: 5 + rnd() * 4, g: 520, drag: .8 });
        break;
      }
      case 'conf':
        for (let i = 0; i < 30; i++) { const a = rnd() * TAU, v = 160 + rnd() * 260; P({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1.2 + rnd() * .8, c: cols[i % cols.length], s: 5 + rnd() * 4, g: 380, rot: rnd() * 6, vr: (rnd() - .5) * 16, drag: 1.2 }); }
        break;
      case 'bolt': {
        // gökten inen zikzak + beyaz flaş + kıvılcım
        let px = x + (rnd() - .5) * 20, py = y - 190;
        for (let i = 0; i < 9; i++) { const nx = x + (rnd() - .5) * 28, ny = py + 22; const dx = nx - px, dy = ny - py, L = Math.hypot(dx, dy) || 1; P({ k: 'spark', x: (px + nx) / 2, y: (py + ny) / 2, vx: dx / L * .01, vy: dy / L * .01, life: .16 + i * .012, c: i % 2 ? '#ffffff' : cols[0], s: 3.2, g: 0, add: true, rot: Math.atan2(dy, dx) }); px = nx; py = ny; }
        P({ k: 'glow', x, y: y - 10, vx: 0, vy: 0, life: .3, c: cols[1] || '#7df9ff', s: 120, add: true });
        for (let i = 0; i < 16; i++) { const a = rnd() * TAU, v = 160 + rnd() * 260; P({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: .3 + rnd() * .3, c: cols[i % cols.length], s: 2, g: 500, add: true }); }
        if (FM.fx && FM.fx.flash) FM.fx.flash('#ffffff', .18);
        break;
      }
      case 'vortex': {
        // kara delik: dışarıdan merkeze emilen yıldızlar + mor ışıma + büzülen halka hissi
        for (let i = 0; i < 24; i++) { const a = rnd() * TAU, d = 60 + rnd() * 60, life = .35 + rnd() * .3; P({ k: i % 2 ? 'star' : 'dot', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: -Math.cos(a) * d / life, vy: -Math.sin(a) * d / life, life, c: cols[1 + (i % 2)] || '#a855f7', s: 3 + rnd() * 2, g: 0, drag: 0, rot: a, vr: 10, add: true }); }
        P({ k: 'glow', x, y, vx: 0, vy: 0, life: .6, c: cols[0] || '#2a0e5a', s: 110 });
        P({ k: 'glow', x, y, vx: 0, vy: 0, life: .5, c: cols[1] || '#a855f7', s: 60, add: true });
        if (FM.fx && FM.fx.ring) FM.fx.ring(x, y, 70, cols[1] || '#a855f7', .45, 5);
        break;
      }
      default:
        break;
    }
  }
  FM.on('death', d => {
    const r = d && d.r;
    if (!r || S.mode === 'demo') return;
    const it = localCos(r, 'deaths');
    if (!it) return;
    try { deathFx(r, it.fx); } catch (e) { /* ölüm efekti çizilemedi */ }
  });
  FM.on('race:start', () => { WINS.length = 0; });

  /* ---------- Altın Avı: düşen altın saçılması (yerel olay + ağdan gelen dropCoins) ---------- */
  let coinL = null, coinN = 0;
  function scanDrops() {
    const L = S.L;
    if (!L || !L.coins) { coinL = null; return; }
    const n = L.coins.length;
    if (L !== coinL) { coinL = L; coinN = n; return; }
    if (n <= coinN) { coinN = n; return; }
    let gx = 0, gy = 0, gv = 0, gk = null;
    const flush = () => {
      if (!gv || !inView(gx, gy, 180)) return;
      for (let i = 0; i < 10; i++) { const a = rnd() * TAU, v = 90 + rnd() * 200; P({ k: i % 2 ? 'star' : 'twinkle', x: gx, y: gy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: .45 + rnd() * .3, c: i % 3 ? '#ffd23f' : '#ffffff', s: i % 2 ? 3 : 12, g: 300, drag: 1.5, rot: a, add: i % 2 === 0 }); }
      if (FM.fx && FM.fx.ring) FM.fx.ring(gx, gy, 46, '#ffd23f', .35, 5);
      P({ k: 'text', x: gx, y: gy - 34, vx: 0, vy: -46, life: 1.2, c: '#ffb020', s: 20, g: 0, str: '-' + gv });
    };
    for (let i = coinN; i < n; i++) {
      const co = L.coins[i];
      if (!co || !co.drop) continue;
      const key = String(co.id || '').split(':')[0];
      if (key !== gk) { flush(); gk = key; gx = num(co.x, 0); gy = num(co.y, 0); gv = 0; }
      gv += num(co.v, 1);
    }
    flush();
    coinN = n;
  }
  FM.on('coins:bonus', d => {
    const r = d && d.r;
    if (!r || !inView(rcx(r), rcy(r), 160)) return;
    P({ k: 'text', x: rcx(r), y: num(r.y, 0) - 40, vx: 0, vy: -40, life: 1.5, c: '#ffd23f', s: 24, g: 0, str: '+' + (num(d.n, 15) | 0) });
    for (let i = 0; i < 14; i++) { const a = -PI / 2 + (rnd() - .5) * 2.2, v = 180 + rnd() * 260; P({ k: 'star', x: rcx(r), y: rcy(r), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .6 + rnd() * .3, c: i % 2 ? '#ffd23f' : '#fff6c0', s: 3.6, g: 500, drag: 1, rot: a }); }
  });
  /* ---------- eleme kapısı: oyuncu geçince yeşil parıltı ---------- */
  FM.on('gate', d => {
    const r = d && d.r, L = S.L;
    if (!r || r !== S.player || !L || !L.gates) return;
    const g = L.gates[d.n | 0];
    if (!g || !inView(g.x, g.y - 60, 120)) return;
    if (FM.fx && FM.fx.ring) FM.fx.ring(g.x, g.y - 60, 70, '#3ddc84', .4, 7);
    for (let i = 0; i < 10; i++) { const a = rnd() * TAU, v = 120 + rnd() * 160; P({ k: 'star', x: g.x, y: g.y - 60, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5, c: i % 2 ? '#3ddc84' : '#e6ffe8', s: 3.2, g: 200, drag: 1.5, rot: a }); }
  });
  /* ---------- çok oyunculu: bağlantı koptu ---------- */
  FM.on('mp:drop', d => {
    const r = d && d.r;
    if (!r || !(S.mode === 'race' || S.mode === 'count')) return;
    const x = rcx(r), y = rcy(r);
    if (!inView(x, y, 120)) return;
    for (let i = 0; i < 7; i++) P({ k: 'puff', x: x + (rnd() - .5) * 20, y: y + (rnd() - .5) * 20, vx: (rnd() - .5) * 160, vy: -30 - rnd() * 80, life: .8 + rnd() * .4, c: 'rgba(170,160,190,.8)', s: 14 + rnd() * 10, g: -30, drag: 2.2 });
    P({ k: 'text', x, y: num(r.y, y) - 36, vx: 0, vy: -24, life: 1.9, c: '#d9d2ea', s: 15, g: 0, str: 'BAĞLANTI KOPTU' });
  });
  FM.on('race:start', () => { swirls.length = 0; ghosts.length = 0; scorches.length = 0; coinL = null; });

  /* =====================================================================
     5. TUR — YÖNLÜ ATIŞ ÖNİZLEMESİ (FM.S.aim), GÜÇ HAZIR HALKASI, VURULMA YÖNÜ,
     RÜZGÂR ARKASI ÇİZGİLERİ, "KUSURSUZ!" / "KIL PAYI!"
     Sözleşme (docs/TUR5.md §2.4, §3, §9, §11):
       FM.S.aim = { kind: 'item'|'ab', key, shape: 'arc'|'line'|'cone'|'target'|'none', pts: [[x,y],…] (dünya),
                    cone: {x, y, ang, spread, len} | null, tgt: yarışçı | null, ok: bool }
       FM.R.drawAim(ctx) — main.js drawWorldFront'tan SONRA, dünya dönüşümündeyken çağırır.
       charge:full {r} · hit/death/blocked (vurulma yönü) · r.draft (0..1) · perfect {r} · nearmiss {r, cause}
     ===================================================================== */
  const localP = () => { const p = S.player; return p && !p.ghost && S.mode !== 'demo' ? p : null; };

  /* ---------- nişan renkleri: eşya rengi / karakter rengi; ok=false → kırmızı ---------- */
  const AIM_RED = '#ff3b4e';
  function aimCols(aim) {
    let base;
    if (aim.ok === false) base = AIM_RED;
    else if (aim.kind === 'ab') { const ch = FM.CH[aim.key]; base = ch ? (C(ch.col2).lum < .2 ? (ch.acc || ch.col) : ch.col2) : '#ffd23f'; }
    else { const it = FM.ITEMS[aim.key]; base = it && it.col ? it.col : '#ffffff'; }
    const o = C(base);
    const hex = o.lum < .3 ? mix(o.hex, '#ffffff', .45) : o.hex;          // koyu eşya (mürekkep) okunsun
    return { base: hex, core: mix(hex, '#ffffff', .55), dark: mix(hex, INK, .78) };
  }
  /* karakter gücü rozeti (nişan + güç hazır): karakter renkli daire içinde portre */
  function abBadgeSprite(id) {
    const ch = FM.CH[id] || { col: '#ffd23f', col2: '#5b2a86', acc: '#ffd23f' };
    return sp('aimbadge:' + id, 60, 60, 30, 30, g => {
      const c2 = C(ch.col2 || '#5b2a86').hex, c1 = C(ch.col || '#ffd23f').hex;
      g.beginPath(); g.arc(0, 0, 24, 0, TAU);
      g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
      const gr = g.createRadialGradient(-6, -8, 2, 0, 0, 24);
      gr.addColorStop(0, mix(c2, '#ffffff', .45)); gr.addColorStop(.7, c2); gr.addColorStop(1, mix(c2, INK, .4));
      g.fillStyle = gr; g.fill();
      g.lineWidth = 3; g.strokeStyle = c1; g.beginPath(); g.arc(0, 0, 21.2, 0, TAU); g.stroke();
      let ok = false;
      if (typeof R.portrait === 'function') {
        try {
          const pc = R.portrait(id, 48, { ring: false });
          if (pc && pc.width > 0) { g.save(); g.beginPath(); g.arc(0, 0, 19.6, 0, TAU); g.clip(); g.drawImage(pc, -23, -21, 46, 46); g.restore(); ok = true; }
        } catch (e) { ok = false; }
      }
      if (!ok) {   // yıldırım işareti
        g.beginPath(); g.moveTo(3, -14); g.lineTo(-7, 2); g.lineTo(0, 2); g.lineTo(-3, 14); g.lineTo(8, -3); g.lineTo(1, -3); g.closePath();
        g.lineWidth = 3; g.strokeStyle = INK; g.stroke(); g.fillStyle = '#ffe14d'; g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,.26)'; g.beginPath(); g.ellipse(-6, -11, 10, 4.5, -.5, 0, TAU); g.fill();
    });
  }
  /* renkli nişangâh (hedef şekli) */
  function aimRetSprite(hex) {
    const core = mix(hex, '#ffffff', .4);
    return sp('aimret:' + hex, 96, 96, 48, 48, g => {
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = 0; i < 4; i++) {
        const a0 = i * PI / 2 + .3, a1 = (i + 1) * PI / 2 - .3;
        g.beginPath(); g.arc(0, 0, 34, a0, a1);
        g.lineWidth = 7.5; g.strokeStyle = rgba(INK, .85); g.stroke();
        g.lineWidth = 3.8; g.strokeStyle = hex; g.stroke();
        g.lineWidth = 1.3; g.strokeStyle = core; g.beginPath(); g.arc(0, 0, 34.8, a0 + .08, a1 - .08); g.stroke();
      }
      for (let i = 0; i < 4; i++) {   // içe bakan üçgenler
        const a = i * PI / 2, c = Math.cos(a), s = Math.sin(a);
        g.beginPath(); g.moveTo(c * 25, s * 25); g.lineTo(c * 42 - s * 6, s * 42 + c * 6); g.lineTo(c * 42 + s * 6, s * 42 - c * 6); g.closePath();
        g.lineWidth = 3.4; g.strokeStyle = rgba(INK, .9); g.stroke(); g.fillStyle = core; g.fill();
      }
      for (let i = 0; i < 4; i++) {   // merkez artı (boşluklu)
        const a = i * PI / 2, c = Math.cos(a), s = Math.sin(a);
        g.beginPath(); g.moveTo(c * 5, s * 5); g.lineTo(c * 13, s * 13);
        g.lineWidth = 4.4; g.strokeStyle = rgba(INK, .85); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = '#ffffff'; g.stroke();
      }
    });
  }
  /* "×" kullanılamaz rozeti */
  function aimNoSprite() {
    return sp('aimno', 32, 32, 16, 16, g => {
      g.beginPath(); g.arc(0, 0, 11.5, 0, TAU); g.lineWidth = 4; g.strokeStyle = INK; g.stroke(); g.fillStyle = AIM_RED; g.fill();
      g.lineCap = 'round'; g.lineWidth = 3.4; g.strokeStyle = '#ffffff';
      g.beginPath(); g.moveTo(-5, -5); g.lineTo(5, 5); g.moveTo(5, -5); g.lineTo(-5, 5); g.stroke();
    });
  }
  function aimPath(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(+pts[0][0], +pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(+pts[i][0], +pts[i][1]);
  }
  /* yay: koyu taban + akan kesikli parlak çizgi + yol boyunca kayan noktalar + iniş halkası */
  function drawAimArc(ctx, pts, col, ok) {
    aimPath(ctx, pts);
    ctx.lineWidth = 8; ctx.strokeStyle = rgba(col.dark, .6); ctx.stroke();
    ctx.setLineDash([12, 10]); ctx.lineDashOffset = -((FXT * 95) % 22);
    ctx.lineWidth = 4; ctx.strokeStyle = col.base; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col.core; ctx.stroke();
    ctx.setLineDash([]);
    // kayan noktalar (yol uzunluğuna göre eşit aralıklı)
    const STEP = 38, ph = (FXT * 120) % STEP;
    let acc = 0, next = ph, n = 0;
    for (let i = 1; i < pts.length && n < 24; i++) {
      const ax = +pts[i - 1][0], ay = +pts[i - 1][1], bx = +pts[i][0], by = +pts[i][1];
      const seg = Math.hypot(bx - ax, by - ay);
      while (next <= acc + seg && seg > 0 && n < 24) {
        const u = (next - acc) / seg;
        spr(ctx, dotSprite(col.core), lerp(ax, bx, u), lerp(ay, by, u), 0, .36);
        next += STEP; n++;
      }
      acc += seg;
    }
    resetXf(ctx);
    // iniş / çarpma noktası
    const e = pts[pts.length - 1], p2 = pts[pts.length - 2];
    const ex = +e[0], ey = +e[1], dy = ey - +p2[1], dx = ex - +p2[0];
    const pulse = .5 + .5 * Math.sin(FXT * 7);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .35 + .25 * pulse;
    spr(ctx, glowSprite(col.base), ex, ey, 0, 1.3); resetXf(ctx);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ok ? 1 : .8;
    const ground = dy > Math.abs(dx) * .4;          // aşağı iniyor → zemin halkası (elips), yoksa çarpma halkası (daire)
    const rr = 15 + pulse * 4;
    ctx.beginPath();
    if (ground) ctx.ellipse(ex, ey + 4, rr * 1.25, rr * .45, 0, 0, TAU); else ctx.arc(ex, ey, rr * .9, 0, TAU);
    ctx.lineWidth = 7; ctx.strokeStyle = rgba(col.dark, .65); ctx.stroke();
    ctx.lineWidth = 3.4; ctx.strokeStyle = col.base; ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = col.core; ctx.stroke();
    // merkez işareti
    ctx.beginPath(); ctx.arc(ex, ey + (ground ? 4 : 0), 3.2, 0, TAU);
    ctx.lineWidth = 3; ctx.strokeStyle = rgba(INK, .8); ctx.stroke(); ctx.fillStyle = '#ffffff'; ctx.fill();
  }
  /* çizgi: kalın ok + yön boyunca kayan köşeli parantezler */
  function drawAimLine(ctx, pts, col, ok) {
    const a = pts[0], b = pts[pts.length - 1];
    const ax = +a[0], ay = +a[1], bx = +b[0], by = +b[1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (!(len > 6)) return;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const hx = bx - ux * 18, hy = by - uy * 18;
    // gövde (duvardan sekme gibi kırılmaları da izler)
    aimPath(ctx, pts.length > 2 ? pts : [[ax, ay], [hx, hy]]);
    ctx.lineWidth = 12; ctx.strokeStyle = rgba(col.dark, .6); ctx.stroke();
    ctx.lineWidth = 6.5; ctx.strokeStyle = col.base; ctx.stroke();
    ctx.lineWidth = 2.2; ctx.strokeStyle = col.core; ctx.stroke();
    // ok başı
    ctx.beginPath(); ctx.moveTo(bx + ux * 4, by + uy * 4); ctx.lineTo(hx - ux * 3 + px * 13, hy - uy * 3 + py * 13); ctx.lineTo(hx + ux * 2, hy + uy * 2); ctx.lineTo(hx - ux * 3 - px * 13, hy - uy * 3 - py * 13); ctx.closePath();
    ctx.lineWidth = 5; ctx.strokeStyle = rgba(col.dark, .8); ctx.stroke();
    ctx.fillStyle = col.base; ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx - ux * 2, by - uy * 2); ctx.lineTo(hx + px * 6, hy + py * 6); ctx.lineTo(hx - px * 6, hy - py * 6); ctx.closePath();
    ctx.fillStyle = col.core; ctx.fill();
    // kayan ">" işaretleri
    const run = Math.max(10, len - 30);
    for (let i = 0; i < 3; i++) {
      const d = (FXT * 150 + i * run / 3) % run, k = d / run;
      const cx = ax + ux * (d + 8), cy = ay + uy * (d + 8);
      ctx.globalAlpha = (ok ? 1 : .8) * Math.sin(k * PI);
      ctx.beginPath(); ctx.moveTo(cx - ux * 6 + px * 7, cy - uy * 6 + py * 7); ctx.lineTo(cx + ux * 2, cy + uy * 2); ctx.lineTo(cx - ux * 6 - px * 7, cy - uy * 6 - py * 7);
      ctx.lineWidth = 5; ctx.strokeStyle = rgba(col.dark, .7); ctx.stroke();
      ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
    ctx.globalAlpha = ok ? 1 : .8;
  }
  /* koni: yarı saydam dilim + kenar çizgileri + dışa yayılan dalgalar */
  function drawAimCone(ctx, c, col, ok) {
    const x = num(c.x, 0), y = num(c.y, 0), ang = num(c.ang, 0), half = Math.max(.04, num(c.spread, .6)) / 2, len = Math.max(12, num(c.len, 200));
    ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len, ang - half, ang + half); ctx.closePath();
    ctx.fillStyle = rgba(col.base, .17); ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = rgba(col.dark, .55); ctx.stroke();
    ctx.lineWidth = 2.6; ctx.strokeStyle = col.core; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const rr = (FXT * 170 + i * len / 3) % len, k = rr / len;
      const a = (ok ? 1 : .8) * Math.min(1, k * 5) * (1 - k) * .9;
      if (rr < 6) continue;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x, y, rr, ang - half, ang + half);
      ctx.lineWidth = 5.5; ctx.strokeStyle = rgba(col.dark, .55); ctx.stroke();
      ctx.lineWidth = 2.6; ctx.strokeStyle = col.base; ctx.stroke();
    }
    ctx.globalAlpha = ok ? 1 : .8;
  }
  /* hedef: elden hedefe kesikli bağ + renkli nişangâh */
  function drawAimTarget(ctx, lx, ly, t, col, ok) {
    const tx = num(t.x, 0) + num(t.w, 28) / 2, ty = num(t.y, 0) + num(t.h, 42) / 2;
    ctx.setLineDash([9, 11]); ctx.lineDashOffset = -((FXT * 80) % 20);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(tx, ty);
    ctx.lineWidth = 6.5; ctx.strokeStyle = rgba(col.dark, .55); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = col.base; ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = col.core; ctx.stroke();
    ctx.setLineDash([]);
    const sc = 1 + .06 * Math.sin(FXT * 8);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .3;
    spr(ctx, glowSprite(col.base), tx, ty, 0, 1.4);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ok ? 1 : .8;
    spr(ctx, aimRetSprite(col.base), tx, ty, FXT * 1.3, sc);
    resetXf(ctx);
  }
  /* eldeki eşya ikonu / güç rozeti (ön elde, hafif salınır, arkasında ışık) */
  function drawAimBadge(ctx, aim, bx, by, col, ok) {
    const pulse = .5 + .5 * Math.sin(FXT * 6);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .45 + .25 * pulse;
    spr(ctx, glowSprite(col.base), bx, by, 0, 1.15);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ok ? 1 : .78;
    if (aim.kind === 'ab') spr(ctx, abBadgeSprite(aim.key), bx, by, 0, .66);
    else if (typeof R.itemIcon === 'function') {
      let c = null;
      try { c = R.itemIcon(aim.key, clamp(Math.ceil(36 * (V.S || 1) / 8) * 8, 24, 192)); } catch (e) { c = null; }
      if (c) { setXf(ctx, bx, by, Math.sin(FXT * 4) * .08, 1, 1); ctx.drawImage(c, -17, -17, 34, 34); }
    }
    resetXf(ctx);
  }
  R.drawAim = function (ctx) {
    const aim = S.aim;
    if (!aim || !S.L || !ctx) return;
    const P = localP(); if (!P || P.dead > 0 || P.out) return;
    const shape = aim.shape || 'none';
    const pts = Array.isArray(aim.pts) ? aim.pts.filter(p => p && isFinite(+p[0]) && isFinite(+p[1])) : null;
    const ok = aim.ok !== false;
    const col = aimCols(aim);
    const face = P.face === -1 ? -1 : 1;
    const bx = rcx(P) + face * 17, by = num(P.y, 0) + num(P.h, 42) * .42 + Math.sin(FXT * 5) * 1.5;   // ön el
    ctx.save();
    grabXf(ctx, true);
    try {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = ok ? 1 : .8;
      if ((shape === 'arc' || shape === 'line') && pts && pts.length >= 2) { if (shape === 'arc') drawAimArc(ctx, pts, col, ok); else drawAimLine(ctx, pts, col, ok); }
      else if (shape === 'cone' && aim.cone) drawAimCone(ctx, aim.cone, col, ok);
      else if (shape === 'target' && aim.tgt && isFinite(+aim.tgt.x)) drawAimTarget(ctx, bx, by, aim.tgt, col, ok);
      drawAimBadge(ctx, aim, bx, by, col, ok);
      if (!ok) { spr(ctx, aimNoSprite(), bx + 15, by - 15, Math.sin(FXT * 9) * .12, 1); resetXf(ctx); }
    } catch (e) {
      if (!R.drawAim.errs) R.drawAim.errs = 0;
      if (R.drawAim.errs++ < 5) console.error('[drawAim]', e);
    } finally {
      resetXf(ctx);
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- güç hazır: yerel oyuncunun etrafında nabız atan halka + yükselen kıvılcımlar ---------- */
  const pow = { on: false, t: -9, acc: 0 };
  function powCol(p) {
    const ch = FM.CH[p.id] || {};
    const c2 = ch.col2 || '#ffd23f';
    return C(c2).lum < .2 ? (ch.acc || '#ffd23f') : c2;
  }
  function powReady(p) {
    return !!p && num(p.charge, 0) >= 100 && !(p.dead > 0) && !p.finished && !p.out && (S.mode === 'race' || S.mode === 'count');
  }
  function powBurst(p) {
    const x = rcx(p), y = rcy(p), col = powCol(p);
    if (FM.fx && FM.fx.ring) { FM.fx.ring(x, y, 72, col, .5, 7); FM.fx.ring(x, y, 42, '#fff6c0', .35, 4); }
    P({ k: 'glow', x, y, vx: 0, vy: 0, life: .35, c: '#ffe9a0', s: 96, add: true });
    for (let i = 0; i < 12; i++) {
      const a = rnd() * TAU, v = 120 + rnd() * 180;
      P({ k: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: .5 + rnd() * .3, c: i % 2 ? col : '#fff6c0', s: 3.6, g: 260, drag: 1.4, rot: a, vr: (rnd() - .5) * 8 });
    }
  }
  function updPower(dt) {
    const p = localP(), on = powReady(p);
    if (on && !pow.on && FXT - pow.t > .5) { pow.t = FXT; if (inView(rcx(p), rcy(p), 120)) powBurst(p); }
    pow.on = on;
    if (!on || !budget() || !inView(rcx(p), rcy(p), 100)) { pow.acc = 0; return; }
    pow.acc += dt * 8;
    const col = powCol(p);
    let n = 0;
    while (pow.acc >= 1 && n++ < 3) {
      pow.acc -= 1;
      P({ k: 'spark', x: rcx(p) + (rnd() - .5) * 34, y: num(p.y, 0) + num(p.h, 42) - rnd() * 8, vx: (rnd() - .5) * 24, vy: -(50 + rnd() * 70), life: .4 + rnd() * .3, c: rnd() < .5 ? '#fff6c0' : col, s: 1.8, g: -60, add: true });
    }
  }
  FM.on('charge:full', d => {
    const p = localP();
    if (!d || !p || d.r !== p) return;
    if (FXT - pow.t > .5) { pow.t = FXT; pow.on = powReady(p); if (inView(rcx(p), rcy(p), 120)) powBurst(p); }
  });
  /* ayak halkası (yarışçının altında) */
  function drawPowerAura(ctx) {
    const p = localP();
    if (!pow.on || !p) return;
    const x = rcx(p), fy = num(p.y, 0) + num(p.h, 42);
    if (!inView(x, fy, 90)) return;
    const col = powCol(p), pulse = .5 + .5 * Math.sin(FXT * 6);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .4 + .3 * pulse;
    spr(ctx, glowSprite(col), x, fy - 2, 0, 2.1, .7); resetXf(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    // dışa yayılan nabız halkası (0.9 sn'de bir)
    const pk = (FXT % .9) / .9;
    ctx.globalAlpha = (1 - pk) * .8;
    ctx.beginPath(); ctx.ellipse(x, fy - 1, 22 + pk * 34, (22 + pk * 34) * .36, 0, 0, TAU);
    ctx.lineWidth = 5 - pk * 3; ctx.strokeStyle = rgba(INK, .45); ctx.stroke();
    ctx.lineWidth = 3 - pk * 2; ctx.strokeStyle = mix(col, '#ffffff', .4); ctx.stroke();
    // dönen kesikli ana halka
    const rx = 24 + pulse * 3, ry = rx * .36;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.ellipse(x, fy - 1, rx, ry, 0, 0, TAU);
    ctx.lineWidth = 7.5; ctx.strokeStyle = rgba(INK, .55); ctx.stroke();
    ctx.setLineDash([9, 7]); ctx.lineDashOffset = -FXT * 45;
    ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff6c0'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  /* gövde etrafında dönen parıltılar (yarışçının önünde) */
  function drawPowerSparks(ctx) {
    const p = localP();
    if (!pow.on || !p) return;
    const x = rcx(p), y = rcy(p);
    if (!inView(x, y, 90)) return;
    const col = powCol(p);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = FXT * 2.6 + i * TAU / 3, s = .5 + .5 * Math.sin(FXT * 7 + i * 2.1);
      const sx = x + Math.cos(a) * 27, sy = y - 6 + Math.sin(a) * 13;
      ctx.globalAlpha = .5 + .45 * s;
      spr(ctx, twinkleSprite(i ? '#fff6c0' : col), sx, sy, FXT * 2 + i, .34 + .22 * s);
    }
    resetXf(ctx);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  /* ---------- vurulma yönü: oyuncunun etrafında, saldırının geldiği yöne bakan kırmızı yay (ekran katmanı) ---------- */
  const hits = [];
  function hitDir(victim, src, ent, strong, col) {
    const p = localP();
    if (!p || victim !== p || S.mode !== 'race') return;
    let sx = null, sy = null;
    if (ent && isFinite(+ent.x) && isFinite(+ent.y)) { sx = +ent.x; sy = +ent.y; }
    else if (src && src !== p && isFinite(+src.x)) { sx = rcx(src); sy = rcy(src); }
    if (sx === null) return;
    const dx = sx - rcx(p), dy = sy - rcy(p);
    if (Math.hypot(dx, dy) < 10) return;
    hits.push({ ang: Math.atan2(dy, dx), t: 0, max: strong ? 1.1 : .8, col: col || AIM_RED, strong: !!strong });
    if (hits.length > 4) hits.shift();
  }
  FM.on('hit', d => { if (d) hitDir(d.victim, d.src, d.ent, false, null); });
  FM.on('death', d => { if (d && !d.self) hitDir(d.r, d.src, d.ent, true, null); });
  FM.on('blocked', d => { if (d) hitDir(d.r, d.src, d.ent, false, d.by === 'balloon' ? '#ff5a7a' : '#5ad1ff'); });
  function updHits(dt) { for (let i = hits.length - 1; i >= 0; i--) { hits[i].t += dt; if (hits[i].t >= hits[i].max) hits.splice(i, 1); } }
  function drawHitDirs(ctx) {
    if (!hits.length) return;
    const p = localP();
    if (!p) { hits.length = 0; return; }
    const px = rcx(p) - S.cam.x, py = rcy(p) - S.cam.y;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const h of hits) {
      const k = clamp(h.t / h.max, 0, 1), a = k < .1 ? k / .1 : 1 - (k - .1) / .9;
      const r0 = (h.strong ? 66 : 54) + k * 26, half = h.strong ? .8 : .58;
      const light = mix(h.col, '#ffffff', .6);
      ctx.globalAlpha = a * .95;
      ctx.beginPath(); ctx.arc(px, py, r0, h.ang - half, h.ang + half);
      ctx.lineWidth = 14; ctx.strokeStyle = rgba(INK, .5); ctx.stroke();
      ctx.lineWidth = 8; ctx.strokeStyle = h.col; ctx.stroke();
      ctx.lineWidth = 2.4; ctx.strokeStyle = light; ctx.stroke();
      // kaynağa bakan ok ucu
      const ca = Math.cos(h.ang), sa = Math.sin(h.ang), ox = px + ca * (r0 + 12), oy = py + sa * (r0 + 12);
      ctx.beginPath(); ctx.moveTo(ox + ca * 9, oy + sa * 9); ctx.lineTo(ox - ca * 3 - sa * 8, oy - sa * 3 + ca * 8); ctx.lineTo(ox - ca * 3 + sa * 8, oy - sa * 3 - ca * 8); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(INK, .85); ctx.stroke(); ctx.fillStyle = light; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- rüzgâr arkası (draft): bir rakibin hemen arkasında koşarken önde ince hava çizgileri ---------- */
  function drawDraft(ctx) {
    const rs = S.racers;
    if (!rs || !rs.length) return;
    ctx.lineCap = 'round';
    for (const r of rs) {
      if (!r) continue;
      const d = num(r.draft, 0);
      if (!(d > 0) || r.dead > 0 || r.off) continue;
      const face = r.face === -1 ? -1 : 1, cx = rcx(r), w = num(r.w, 28), h = num(r.h, 42), y0 = num(r.y, 0);
      if (!inView(cx, y0, 120)) continue;
      const a = clamp(d, 0, 1);
      for (let i = 0; i < 4; i++) {
        const ph = (FXT * 2.2 + i * .27) % 1;                       // 0 uzak → 1 yakın
        const len = 10 + 16 * a, y = y0 + 5 + i * (h - 10) / 3 + Math.sin(FXT * 9 + i * 1.3) * 1.2;
        const x0 = cx + face * (w / 2 + 8 + (1 - ph) * 34);
        ctx.globalAlpha = a * .85 * Math.sin(ph * PI);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + face * len, y);
        ctx.lineWidth = 4; ctx.strokeStyle = rgba(INK, .35); ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- "KUSURSUZ!" (zamanında iniş/zıplama) ve "KIL PAYI!" (tehlikeyi sıyırma) ---------- */
  FM.on('perfect', d => {
    const r = d && d.r;
    if (!r || !isFinite(+r.x) || S.mode === 'demo') return;
    const x = rcx(r), fy = num(r.y, 0) + num(r.h, 42);
    if (!inView(x, fy, 120) || !budget()) return;
    for (let i = 0; i < 8; i++) {
      const a = -PI / 2 + (rnd() - .5) * 2.4, v = 120 + rnd() * 160;
      P({ k: i % 2 ? 'star' : 'twinkle', x, y: fy - 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .4 + rnd() * .25, c: i % 3 ? '#5ee07a' : '#eaffef', s: i % 2 ? 3 : 11, g: 420, drag: 1.2, rot: a, add: i % 2 === 0 });
    }
    if (FM.fx && FM.fx.ring) FM.fx.ring(x, fy - 2, 34, '#5ee07a', .3, 4);
    if (r === localP()) P({ k: 'text', x, y: num(r.y, 0) - 30, vx: 0, vy: -44, life: .9, c: '#5ee07a', s: 18, g: 0, str: 'KUSURSUZ!' });
  });
  FM.on('nearmiss', d => {
    const r = d && d.r, p = localP();
    if (!r || !p || r !== p) return;
    const x = rcx(r), y = rcy(r);
    if (!inView(x, y, 120)) return;
    P({ k: 'text', x, y: num(r.y, 0) - 34, vx: 0, vy: -40, life: 1.0, c: '#ffd23f', s: 20, g: 0, str: 'KIL PAYI!' });
    if (FM.fx && FM.fx.ring) FM.fx.ring(x, y, 46, '#ffffff', .3, 4);
    for (let i = 0; i < 6; i++) { const a = rnd() * TAU, v = 60 + rnd() * 120; P({ k: 'twinkle', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: .35 + rnd() * .2, c: '#fff6b0', s: 10 + rnd() * 6, g: 100, add: true, rot: a }); }
  });
  FM.on('race:start', () => { hits.length = 0; pow.on = false; pow.t = -9; pow.acc = 0; });

  /* =====================================================================
     ANA ÇİZİM GİRİŞLERİ
     ===================================================================== */
  /* Yeni tiplemelerin mermileri (sprite'lar render-chars'ta): Terlikli Teyze'nin uçan terliği hız yönünde döner,
     Simitçi Martı'nın simidi yuvarlanır. İkisi de tehlike halesiyle (kaçılabilsin diye görünür). */
  function drawSlipper(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0); if (!inView(x, y, 60)) return;
    const s = typeof R.slipperSprite === 'function' ? R.slipperSprite() : null;
    danger(ctx, x, y, 22, .75);
    const vx = num(e.vx, 1), vy = num(e.vy, 0), rot = Math.atan2(vy, vx) + Math.sin(num(e.age, 0) * 18) * .25;
    if (s) spr(ctx, s, x, y, rot, 1.15);
    resetXf(ctx);
  }
  function drawSimit(ctx, e) {
    const x = num(e.x, 0), y = num(e.y, 0); if (!inView(x, y, 60)) return;
    const s = typeof R.simitSprite === 'function' ? R.simitSprite() : null;
    danger(ctx, x, y, 20, .6);
    const rot = num(e.rot, num(e.age, 0) * (num(e.vx, 1) < 0 ? -9 : 9));
    if (s) spr(ctx, s, x, y, rot, .9);
    resetXf(ctx);
  }
  R.drawEnts = function (ctx) {
    if (!S.L) return;
    ctx.save();
    grabXf(ctx, true);
    try {
      drawRibbons(ctx);
      const L = S.ents || [];
      for (const e of L) if (e && e.type === 'trap') drawTrap(ctx, e);
      drawSnaps(ctx);
      for (const e of L) if (e && e.type === 'saw') drawSaw(ctx, e);
      drawScorches(ctx);
      for (const e of L) if (e && e.type === 'meteor') drawMeteorWarn(ctx, e);
      drawPowerAura(ctx);
    } finally {
      resetXf(ctx);
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  R.drawParticles = function (ctx) {
    if (!S.L) { if (typeof R.drawPlates === 'function') R.drawPlates(ctx); return; }
    ctx.save();
    grabXf(ctx, true);
    try {
      const L = S.ents || [];
      // havadaki / yarışçıların önünde görünmesi gereken varlıklar
      for (const e of L) {
        if (!e) continue;
        switch (e.type) {
          case 'net': drawNet(ctx, e); break;
          case 'wave': drawWave(ctx, e); break;
          case 'mag': drawMag(ctx, e); break;
        }
      }
      for (const e of L) {
        if (!e) continue;
        switch (e.type) {
          case 'dyn': drawDyn(ctx, e); break;
          case 'crow': drawCrow(ctx, e); break;
          case 'mis': drawMis(ctx, e); break;
          case 'bolt': drawBoltCloud(ctx, e); break;
          case 'flash': drawFlash(ctx, e); break;
          case 'meteor': drawMeteorRock(ctx, e); break;
          case 'terlik': drawSlipper(ctx, e); break;
          case 'simit': drawSimit(ctx, e); break;
        }
      }
      resetXf(ctx);
      drawRings(ctx);
      drawSwirls(ctx);
      drawDraft(ctx);
      drawPowerSparks(ctx);
      drawParticleList(ctx);
      drawGhosts(ctx);
      // arayüz benzeri katman: nişangâhlar en üstte
      for (const e of L) {
        if (!e) continue;
        if (e.type === 'mis') drawMisReticle(ctx, e);
        else if (e.type === 'bolt') drawBoltDigit(ctx, e);
      }
      drawTextParticles(ctx);
    } finally {
      resetXf(ctx);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // isim plakaları + emoji balonları en üstte (füze, "!" uyarısı ve parçacıklar plakaların altında kalır)
      if (typeof R.drawPlates === 'function') { try { R.drawPlates(ctx); } catch (e) { /* plaka hatası efektleri engellemesin */ } }
      ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* =====================================================================
     GÜNCELLEYİCİ
     ===================================================================== */
  R.updaters.push(function fxUpdate(dt) {
    if (!(dt > 0)) return;
    if (dt > .1) dt = .1;
    FXT += dt;
    updParts(dt);
    updRings(dt);
    updSwirls(dt);
    updGhosts(dt);
    updWins(dt);
    updHits(dt);
    if (S.L) {
      updEnts(dt);
      updTrails(dt);
      updSnaps(dt);
      try { updMeteors(dt); scanTeleports(); scanVents(dt); scanDrops(); updPower(dt); } catch (e) { /* yeni efektler oyunu durdurmasın */ }
    }
    updScreen(dt);
  });

  // vinyet tuvalleri ekran boyutundan bağımsız (256², gerilerek çizilir) → resize'da yeniden üretmeye gerek yok
  FM.on('resize', () => {
    frost.c = null;
  });

  // test/geliştirme yardımcıları
  R.fx = { color: C, zigzag, startInk };
})(window.FM);

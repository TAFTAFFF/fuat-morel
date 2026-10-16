/* FUAT MOREL — render-world.js
   Oyunun "dünyası": gökyüzü + çok katmanlı parallax arka plan, dokulu zemin blokları ve tema kapakları,
   yüzen platformlar, animasyonlu sıvı, dekor sprite'ları, tehlikeler (diken, ezici, testere makinesi),
   mantar / hız pedi / yürüyen bant / çamur, eşya kutuları, dönen altınlar, başlangıç kapısı ve bitiş takı,
   ön plan ortam parçacıkları.
   API:
     FM.R.drawBackground(ctx)  -> EKRAN koordinatı (scale(S))
     FM.R.drawWorldBack(ctx)   -> DÜNYA koordinatı (yarışçıların arkası)
     FM.R.drawWorldFront(ctx)  -> DÜNYA koordinatı (yarışçıların önü: ortam parçacıkları, ön tutamlar)
     FM.R.themeReady(id)       -> bu tema tam çiziliyor mu (8 temanın hepsi: true) — game.readyThemes kullanır
   8 tema: forest, candy, snow, castle, desert (Çöl Tapınağı), space (Uzay İstasyonu), city (Gece Şehri), tropic (Tropik Ada).
   Yeni öğeler: buz, bataklık kum, yuvarlanan kaya + tapınak kapısı, rüzgâr bacası, gayzer, ışınlanma kapıları,
   düşük yerçekimi bölgesi, trambolin, sallanan köprü, eleme kapısı, düşen altın, meteor yer uyarısı (yedek).
   5. tur (belirginlik): arka planın üstüne atmosferik pus perdesi (VEIL: oyun katmanı öne çıkar), kalın zemin kenarı (CAP_LW),
   daha parlak/kalın hatlı kutu-altın-tehlike çizimleri, tehlike ipuçları (ezici altında "kay" okları, testere inişinde ray/zemin
   kırmızısı, kaya yolunda sola akan oklar, gayzer fışkırmadan önce halka + ok). Dost nesneler yeşil/turkuaz (mantar, ped, trambolin).
   Animasyon saati ve ortam parçacıkları FM.R.updaters ile güncellenir.
   Performans: pahalı her şey bir kez sprite/desen/Path2D olarak üretilip önbelleğe alınır; sıcak döngüde
   shadowBlur / filter yok; gradyanlar önbellekte tutulur ve "translate hilesi" ile yeniden kullanılır. */
'use strict';
(function (FM) {
  const R = FM.R = FM.R || {};
  R.updaters = R.updaters || [];
  const G = FM.gfx, S = FM.S, V = FM.view;
  const TAU = Math.PI * 2, PI = Math.PI;
  const hash = FM.hash;
  const clamp = FM.clamp;
  const hs = (a, b) => hash(((a | 0) * 73856093) ^ ((b | 0) * 19349663));
  const mrng = s => FM.mulberry32(s | 0);
  const rgba = (hex, a) => G.rgba(hex, a);
  const shade = (hex, f) => G.shade(hex, f);
  const mix = (a, b, t) => G.mix(a, b, t);

  let tk = 0;                 // görsel animasyon saati (duraklatınca durur)
  /** Düşük kalite ayarı (ayarlar menüsünden): pahalı süsleri azaltır */
  const lowQ = () => !!(FM.save && FM.save.settings && FM.save.settings.quality === 'low');

  /* =====================================================================
     YARDIMCILAR
     ===================================================================== */
  function LG(g, x0, y0, x1, y1, stops) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function RG(g, x0, y0, r0, x1, y1, r1, stops) {
    const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  const gradCache = new Map();
  /** Önbellekli gradyan (kullanıcı uzayında; translate ile farklı yerlerde yeniden kullanılır) */
  function cg(ctx, key, mk) {
    let gr = gradCache.get(key);
    if (!gr) { gr = mk(ctx); gradCache.set(key, gr); }
    return gr;
  }
  function E(g, x, y, rx, ry, col, rot) { G.E(g, x, y, rx, ry, col, rot || 0); }
  function circ(p, x, y, r) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); }
  function rrp(p, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
  }
  /** Noktalardan yumuşak kapalı eğri (ctx veya Path2D) */
  function smoothClosed(p, pts) {
    const n = pts.length;
    p.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    p.closePath();
  }
  /** Noktalardan yumuşak açık eğri (ilk noktadan son noktaya) */
  function smoothOpen(p, pts, move) {
    if (move !== false) p.moveTo(pts[0][0], pts[0][1]); else p.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    const l = pts[pts.length - 1]; p.lineTo(l[0], l[1]);
  }
  function stroke(g, col, lw, path) {
    g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = lw; g.strokeStyle = col;
    if (path) g.stroke(path); else g.stroke();
  }
  function fill(g, col, path) { g.fillStyle = col; if (path) g.fill(path); else g.fill(); }
  /** Önce kalın kontur sonra dolgu: birleşik şekillerde yalnızca dış yarı kontur kalır */
  function olFill(g, path, col, ol, lw) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (ol) { g.lineWidth = lw; g.strokeStyle = ol; g.stroke(path); }
    g.fillStyle = col; g.fill(path);
  }
  /** Maça (♠) yolu: merkez (cx,cy), s = yarı yükseklik */
  function spadePath(p, cx, cy, s) {
    p.moveTo(cx, cy - s);
    p.bezierCurveTo(cx + s * .28, cy - s * .62, cx + s * 1.02, cy - s * .3, cx + s * .98, cy + s * .2);
    p.bezierCurveTo(cx + s * .95, cy + s * .62, cx + s * .42, cy + s * .76, cx + s * .1, cy + s * .42);
    p.quadraticCurveTo(cx + s * .16, cy + s * .82, cx + s * .46, cy + s);
    p.lineTo(cx - s * .46, cy + s);
    p.quadraticCurveTo(cx - s * .16, cy + s * .82, cx - s * .1, cy + s * .42);
    p.bezierCurveTo(cx - s * .42, cy + s * .76, cx - s * .95, cy + s * .62, cx - s * .98, cy + s * .2);
    p.bezierCurveTo(cx - s * 1.02, cy - s * .3, cx - s * .28, cy - s * .62, cx, cy - s);
    p.closePath();
  }
  /** Dikey (sivri tepeli) altıgen */
  function hexPath(p, cx, cy, r) {
    for (let i = 0; i < 6; i++) {
      const a = -PI / 2 + i * PI / 3;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
  }
  /** 4 kollu parıltı yıldızı */
  function sparkPath(p, x, y, r) {
    p.moveTo(x, y - r);
    p.quadraticCurveTo(x + r * .14, y - r * .14, x + r, y);
    p.quadraticCurveTo(x + r * .14, y + r * .14, x, y + r);
    p.quadraticCurveTo(x - r * .14, y + r * .14, x - r, y);
    p.quadraticCurveTo(x - r * .14, y - r * .14, x, y - r);
    p.closePath();
  }
  /** Gözyaşı (alev) yolu: taban (x,y), genişlik w, yükseklik h */
  function dropPath(p, x, y, w, h, lean) {
    lean = lean || 0;
    p.moveTo(x + lean, y - h);
    p.bezierCurveTo(x + w * .55 + lean * .4, y - h * .55, x + w, y - h * .12, x, y);
    p.bezierCurveTo(x - w, y - h * .12, x - w * .55 + lean * .4, y - h * .55, x + lean, y - h);
    p.closePath();
  }

  /* ---------- arka plan sprite önbelleği (tema değişince temizlenir, düşük çözünürlüklü olabilir) ---------- */
  const bgCache = new Map();
  let bgRS = 0;
  function bsprite(key, w, h, ox, oy, fn, mul) {
    const rs = G.rs();
    if (rs !== bgRS) { bgCache.clear(); bgRS = rs; }
    let s = bgCache.get(key);
    if (!s) {
      const k = clamp(Math.min(2.25, rs) * (mul || 1), .5, 2.25);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
      const g = c.getContext('2d');
      g.scale(c.width / w, c.height / h); g.translate(ox, oy);
      try { fn(g); } catch (e) { console.error('[dünya sprite ' + key + ']', e); }
      s = { c, w, h, ox, oy, k };
      bgCache.set(key, s);
    }
    return s;
  }
  function purgeBg(id) { for (const k of Array.from(bgCache.keys())) if (k.indexOf(id + ':') !== 0) bgCache.delete(k); }
  const spr = (key, w, h, ox, oy, fn) => G.sprite('w:' + key, w, h, ox, oy, fn);
  const drawS = (ctx, s, x, y, sc, flip) => G.draw(ctx, s, x, y, sc == null ? 1 : sc, !!flip);

  /* =====================================================================
     TEMA PALETLERİ
     ===================================================================== */
  const PAL = {
    forest: {
      id: 'forest', ol: '#2a1a0c',
      sky: [[0, '#2774dc'], [.3, '#46a0f0'], [.62, '#90cffc'], [.84, '#cdeeff'], [1, '#f2fbff']],
      haze: '#d3edff',
      sun: { x: .80, y: 78, r: 36, core: '#fffef4', mid: '#fff3b0', edge: '#ffd56a', halo: '#fff7d6', rays: '#fffbe8', raysA: .3, add: false },
      cloud: { lit: '#ffffff', mid: '#eef6ff', shade: '#c7dbf3', deep: '#9fbbe0' }
    },
    candy: {
      id: 'candy', ol: '#5a1838',
      // lavanta → pembe: sıcak pembe tepe, pembe-beyaz karakterleri ve kırmızı kutuyu söndürüyordu
      sky: [[0, '#9c8cff'], [.35, '#c9a8ff'], [.7, '#ffc3e3'], [1, '#fff4fb']],
      haze: '#ffe2f1',
      sun: { x: .80, y: 82, r: 34, core: '#fffef8', mid: '#fff3c0', edge: '#ffc0dc', halo: '#fff2fa', rays: '#fff8fc', raysA: .28, add: false },
      cloud: { lit: '#fff9fd', mid: '#ffe6f3', shade: '#ffc4e2', deep: '#f39fcb' }
    },
    snow: {
      id: 'snow', ol: '#1c2f52',
      sky: [[0, '#1d3a80'], [.28, '#3666b8'], [.6, '#80aee8'], [.84, '#cde2fa'], [1, '#f2f8ff']],
      haze: '#e1eeff',
      sun: { x: .72, y: 150, r: 30, core: '#ffffff', mid: '#fff9ec', edge: '#ffe0c6', halo: '#fff4ea', rays: '#ffffff', raysA: .2, add: false },
      cloud: { lit: '#ffffff', mid: '#eef4ff', shade: '#c9d8f0', deep: '#a3b8dd' }
    },
    castle: {
      id: 'castle', ol: '#160b20',
      sky: [[0, '#170e33'], [.26, '#3a1c5c'], [.5, '#91366d'], [.7, '#ea5d58'], [.86, '#ff9d5c'], [1, '#ffd27a']],
      haze: '#ff9868',
      sun: { x: .64, y: 212, r: 58, core: '#fffbe2', mid: '#ffe08a', edge: '#ff9244', halo: '#ffb070', rays: '#ffd090', raysA: .16, add: true },
      cloud: { lit: '#ffb78c', mid: '#e47a8c', shade: '#9c4a86', deep: '#5c2c6e', inv: true }
    }
  };
  let curTheme = '';
  function pal() {
    const t = S.L && S.L.theme;
    return PAL[t && PAL[t.id] ? t.id : t && PAL[t.base] ? t.base : 'forest'];
  }
  function prepTheme(id) {
    if (id === curTheme) return;
    curTheme = id; purgeBg(id); ambInit(id);
  }
  /** katman y'si: kameranın dikey hareketine göre hafif parallax (cam.y≈100 tasarım referansı) */
  const ly = (base, fy) => base - (S.cam.y - 100) * fy;

  /* ---- Atmosferik pus perdesi (şekil-zemin ayrımı): TÜM arka plan katmanlarının üstüne tek bir önbellekli gradyan
     (karede 1-2 fillRect). Gök/parallax/uzak dekor biraz solar, aydınlanır ve kontrastı düşer; zemin, nesneler ve
     yarışçılar (oyun katmanı) bunun ÜSTÜNE çizildiğinden öne çıkar. Açık temalarda açık pus rengi, koyu temalarda
     orta-koyu doygunluğu düşük bir ton (parlak pencereler/yıldızlar yumuşar). Perde aşağı (oyun alanına) doğru güçlenir. */
  const VEIL = {
    forest: { c: '#d4e8ff', a0: .05, a1: .21 },
    candy: { c: '#ffe6f4', a0: .06, a1: .24 },
    snow: { c: '#e2efff', a0: .05, a1: .21 },
    castle: { c: '#6a4a72', a0: .08, a1: .24 },
    desert: { c: '#ffecc8', a0: .05, a1: .22 },
    space: { c: '#23244e', a0: .10, a1: .28 },
    city: { c: '#2a1f44', a0: .10, a1: .28 },
    tropic: { c: '#d6f2fc', a0: .05, a1: .21 }
  };
  function drawVeil(ctx, P, VW, VH) {
    const v = VEIL[P.id] || VEIL.forest;
    const h = Math.round(VH * .74);
    ctx.fillStyle = cg(ctx, P.id + ':veil' + h, g => LG(g, 0, 0, 0, h, [[0, rgba(v.c, v.a0)], [.5, rgba(v.c, (v.a0 + v.a1) * .5)], [1, rgba(v.c, v.a1)]]));
    ctx.fillRect(0, 0, VW, h);
    ctx.fillStyle = rgba(v.c, v.a1); ctx.fillRect(0, h, VW, VH - h + 1);
  }

  /* =====================================================================
     GÖKYÜZÜ ÖĞELERİ: güneş, bulutlar, yıldızlar, kuzey ışıkları, gökkuşağı, kuşlar
     ===================================================================== */
  function drawSun(ctx, P, x, y) {
    const s = P.sun, r = s.r;
    const halo = bsprite(P.id + ':halo', r * 14, r * 14, r * 7, r * 7, g => {
      g.fillStyle = RG(g, 0, 0, 0, 0, 0, r * 7, [[0, rgba(s.halo, .95)], [.1, rgba(s.halo, .6)], [.3, rgba(s.halo, .2)], [.6, rgba(s.halo, .06)], [1, rgba(s.halo, 0)]]);
      g.fillRect(-r * 7, -r * 7, r * 14, r * 14);
    }, .3);
    const rays = bsprite(P.id + ':rays', 1000, 1000, 500, 500, g => {
      const gr = RG(g, 0, 0, 0, 0, 0, 500, [[0, rgba(s.rays, .9)], [.18, rgba(s.rays, .45)], [.55, rgba(s.rays, .12)], [1, rgba(s.rays, 0)]]);
      g.fillStyle = gr;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + (i % 3) * .07, w = i % 2 ? .05 : .09;
        g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 500, a - w, a + w); g.closePath(); g.fill();
      }
    }, .25);
    const disk = bsprite(P.id + ':sun', r * 2 + 16, r * 2 + 16, r + 8, r + 8, g => {
      g.fillStyle = rgba(s.halo, .5); g.beginPath(); g.arc(0, 0, r + 6, 0, TAU); g.fill();
      g.fillStyle = RG(g, -r * .3, -r * .3, 0, 0, 0, r, [[0, s.core], [.55, s.mid], [1, s.edge]]);
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      if (!s.add) { g.fillStyle = rgba('#ffffff', .55); g.beginPath(); g.ellipse(-r * .32, -r * .36, r * .34, r * .2, -.6, 0, TAU); g.fill(); }
    }, 1);
    ctx.save();
    if (s.add) ctx.globalCompositeOperation = 'lighter';
    drawS(ctx, halo, x, y);
    if (!lowQ()) {
      ctx.globalAlpha = s.raysA * (.85 + .15 * Math.sin(tk * .7));
      ctx.translate(x, y); ctx.rotate(tk * .02);
      ctx.drawImage(rays.c, -500, -500, 1000, 1000);
    }
    ctx.restore();
    drawS(ctx, disk, x, y);
  }

  /** Kabarık çizgi film bulutu sprite'ı. c = {lit, mid, shade, deep, inv} */
  function cloudSpr(id, v, c, tag) {
    const W = [300, 236, 176, 264, 210][v % 5], H = [124, 100, 78, 96, 88][v % 5];
    return bsprite(id + ':cloud' + (tag || '') + v, W + 24, H + 30, (W + 24) / 2, H * .62 + 12, g => {
      const rnd = mrng(4111 + v * 977);
      const base = 0;                          // düz alt çizgi y=0
      const n = 5 + ((rnd() * 3) | 0);
      const puffs = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), bell = Math.sin(t * PI);
        const r = H * (.17 + .27 * bell + rnd() * .07);
        const x = -W / 2 + r * .95 + (W - r * 1.9) * t + (rnd() - .5) * 8;
        const y = base - r * (.62 + bell * .32) + (rnd() - .5) * 6;
        puffs.push([x, y, r]);
      }
      // ikinci sıra küçük tepecikler (üst siluet zenginliği)
      for (let i = 0; i < 3; i++) {
        const t = .25 + rnd() * .5, r = H * (.14 + rnd() * .1);
        puffs.push([-W / 2 + W * t, base - H * (.62 + rnd() * .14), r]);
      }
      const sil = new Path2D();
      for (const p of puffs) circ(sil, p[0], p[1], p[2]);
      sil.moveTo(-W / 2 + H * .2, base); rrp(sil, -W / 2 + H * .16, base - H * .3, W - H * .32, H * .3, H * .15);
      g.save();
      g.beginPath(); g.rect(-W, -H * 2, W * 2, H * 2 + base + 1); g.clip();
      g.fillStyle = c.inv ? c.lit : c.deep; g.fill(sil);
      g.globalCompositeOperation = 'source-atop';
      if (!c.inv) {
        g.fillStyle = c.shade;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] + p[2] * .05, p[1] - p[2] * .1, p[2] * .94, 0, TAU); g.fill(); }
        g.fillStyle = c.mid;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] + p[2] * .1, p[1] - p[2] * .2, p[2] * .86, 0, TAU); g.fill(); }
        g.fillStyle = c.lit;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] + p[2] * .16, p[1] - p[2] * .3, p[2] * .72, 0, TAU); g.fill(); }
        g.fillStyle = LG(g, 0, base - H * .45, 0, base, [[0, rgba(c.shade, 0)], [1, rgba(c.shade, .75)]]);
        g.fillRect(-W, base - H * .45, W * 2, H * .46);
      } else {
        // gün batımı: alttan aydınlanan bulut (üst koyu mor, alt turuncu)
        g.fillStyle = c.mid;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] - p[2] * .05, p[1] - p[2] * .12, p[2] * .9, 0, TAU); g.fill(); }
        g.fillStyle = c.shade;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] - p[2] * .08, p[1] - p[2] * .3, p[2] * .76, 0, TAU); g.fill(); }
        g.fillStyle = c.deep;
        for (const p of puffs) { g.beginPath(); g.arc(p[0] - p[2] * .12, p[1] - p[2] * .48, p[2] * .5, 0, TAU); g.fill(); }
      }
      // parlak kenar vurguları
      g.globalCompositeOperation = 'source-atop';
      g.strokeStyle = rgba('#ffffff', c.inv ? .25 : .9); g.lineWidth = 2.2; g.lineCap = 'round';
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i]; if (p[2] < H * .2) continue;
        g.beginPath(); g.arc(p[0], p[1], p[2] * .82, -2.2, -1.2); g.stroke();
      }
      g.restore();
      // çok hafif alt gölge (gökyüzünden ayrışsın)
      g.save(); g.globalCompositeOperation = 'destination-over';
      g.fillStyle = rgba(c.deep, c.inv ? .0 : .28);
      g.beginPath(); g.ellipse(0, base + 3, W * .42, 6, 0, 0, TAU); g.fill();
      g.restore();
    }, .7);
  }
  function clouds(ctx, P, o) {
    const VW = V.VW;
    const off = S.cam.x * o.f + tk * o.wind;
    const yo = -(S.cam.y - 100) * o.fy;
    const m = 260;
    const i0 = Math.floor((off - m) / o.slot), i1 = Math.floor((off + VW + m) / o.slot);
    const c = o.col || P.cloud;
    ctx.globalAlpha = o.a;
    for (let i = i0; i <= i1; i++) {
      if (hs(i, o.salt) > o.prob) continue;
      const a = hs(i, o.salt + 1), b = hs(i, o.salt + 2), d = hs(i, o.salt + 3);
      const s = cloudSpr(P.id, (a * 5) | 0, c, o.tag);
      const sc = o.sc0 + (o.sc1 - o.sc0) * b;
      const x = i * o.slot + a * o.slot * .5 - off, y = o.y0 + (o.y1 - o.y0) * d + yo + Math.sin(tk * .3 + i) * 2;
      if (o.sx) ctx.drawImage(s.c, x - s.ox * sc * o.sx, y - s.oy * sc * o.sy, s.w * sc * o.sx, s.h * sc * o.sy);
      else drawS(ctx, s, x, y, sc, b > .5);
    }
    ctx.globalAlpha = 1;
  }
  function stars(ctx, n, salt, yMax, a) {
    const VW = V.VW;
    const off = S.cam.x * .004;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < n; i++) {
      const h1 = hash(salt + i * 13), h2 = hash(salt + i * 29 + 5), h3 = hash(salt + i * 41 + 9);
      const x = ((h1 * (VW + 40) - off) % (VW + 40) + VW + 40) % (VW + 40) - 20;
      const y = h2 * yMax - (S.cam.y - 100) * .01;
      const tw = .55 + .45 * Math.sin(tk * (1.2 + h3 * 2.5) + h3 * 40);
      const fade = clamp(1 - y / yMax, 0, 1);
      ctx.globalAlpha = a * tw * fade;
      const s = h3 < .12 ? 2.2 : h3 < .45 ? 1.5 : 1;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      if (h3 < .12) { ctx.globalAlpha *= .6; ctx.fillRect(x - 4, y - .4, 8, .8); ctx.fillRect(x - .4, y - 4, .8, 8); }
    }
    ctx.globalAlpha = 1;
  }
  function aurora(ctx) {
    const VW = V.VW;
    const cols = ['#58f5c2', '#79dcff', '#b78dff'];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const y0 = 70 + k * 30 - (S.cam.y - 100) * .015, hg = 80 + k * 14;
      const off = S.cam.x * .012 + k * 230;
      ctx.beginPath();
      const pts = [];
      for (let sx = -30; sx <= VW + 30; sx += 24) {
        const wx = sx + off;
        pts.push([sx, y0 + Math.sin(wx * .0055 + tk * .22 + k * 2) * 22 + Math.sin(wx * .016 - tk * .35 + k) * 7]);
      }
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        ctx.lineTo(p[0] + 10, p[1] - hg - Math.sin(p[0] * .02 + tk * .5 + k) * 14);
      }
      ctx.closePath();
      ctx.save(); ctx.translate(0, y0 - hg - 30);
      ctx.fillStyle = cg(ctx, 'snow:aur' + k, g => LG(g, 0, 0, 0, hg + 60, [[0, rgba(cols[k], 0)], [.5, rgba(cols[k], .16)], [.86, rgba(cols[k], .42)], [1, rgba(cols[k], 0)]]));
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  function rainbow(ctx) {
    const cx = V.VW * .3, cy = ly(500, .03);
    const cols = ['#ff5e86', '#ffa64d', '#ffe066', '#7fe39a', '#6ec8ff', '#b892ff'];
    ctx.save();
    ctx.globalAlpha = .3; ctx.lineWidth = 12;
    for (let i = 0; i < cols.length; i++) {
      ctx.strokeStyle = cols[i]; ctx.beginPath(); ctx.arc(cx, cy, 360 - i * 11.5, PI * 1.02, PI * 1.98); ctx.stroke();
    }
    ctx.restore();
  }
  function birds(ctx, col, n, salt, bat) {
    const VW = V.VW;
    ctx.save();
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const h1 = hash(salt + i * 31), h2 = hash(salt + i * 57 + 3), h3 = hash(salt + i * 91 + 7);
      const sp = (bat ? 34 : 22) + h1 * 26, span = VW + 260;
      const gx = VW + 130 - ((tk * sp + h2 * span * 3) % span);
      const gy = (bat ? 120 : 70) + h3 * 150 + Math.sin(tk * .8 + i * 1.7) * 12 - (S.cam.y - 100) * .03;
      const cnt = bat ? 1 : 1 + ((h1 * 3) | 0);
      for (let j = 0; j < cnt; j++) {
        const x = gx + j * 16, y = gy + j * 7 * (j % 2 ? 1 : -.4);
        const s = (bat ? .9 : .7) + h3 * .45;
        const fl = Math.sin(tk * (bat ? 16 : 8) + i * 2 + j);
        if (!bat) {
          ctx.lineWidth = 1.7 * s;
          ctx.beginPath();
          ctx.moveTo(x - 9 * s, y - 2 * s - fl * 4 * s);
          ctx.quadraticCurveTo(x - 4 * s, y - 3 * s - fl * 2 * s, x, y);
          ctx.quadraticCurveTo(x + 4 * s, y - 3 * s - fl * 2 * s, x + 9 * s, y - 2 * s - fl * 4 * s);
          ctx.stroke();
        } else {
          const wy = fl * 5 * s;
          ctx.beginPath();
          ctx.moveTo(x, y - 2 * s);
          ctx.quadraticCurveTo(x - 6 * s, y - 6 * s - wy, x - 14 * s, y - 3 * s - wy);
          ctx.quadraticCurveTo(x - 11 * s, y + 1 * s - wy * .5, x - 9 * s, y + 1 * s);
          ctx.quadraticCurveTo(x - 6 * s, y - .5 * s, x - 4 * s, y + 2 * s);
          ctx.quadraticCurveTo(x - 2 * s, y + 1 * s, x, y + 3 * s);
          ctx.quadraticCurveTo(x + 2 * s, y + 1 * s, x + 4 * s, y + 2 * s);
          ctx.quadraticCurveTo(x + 6 * s, y - .5 * s, x + 9 * s, y + 1 * s);
          ctx.quadraticCurveTo(x + 11 * s, y + 1 * s - wy * .5, x + 14 * s, y - 3 * s - wy);
          ctx.quadraticCurveTo(x + 6 * s, y - 6 * s - wy, x, y - 2 * s);
          ctx.fill();
          ctx.beginPath(); ctx.moveTo(x - 2 * s, y - 2 * s); ctx.lineTo(x - 2.6 * s, y - 5 * s); ctx.lineTo(x - .6 * s, y - 3 * s);
          ctx.lineTo(x + .6 * s, y - 3 * s); ctx.lineTo(x + 2.6 * s, y - 5 * s); ctx.lineTo(x + 2 * s, y - 2 * s); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /* =====================================================================
     DAĞLAR, TEPELER, PUS
     ===================================================================== */
  /** Sivri dağ sprite'ı: aydınlık/gölge yüz, kar örtüsü, oluklar, alt pus. c = {top, bot, shadow, snow, snowLine, rim, haze, hazeA, gully} */
  function jagMtn(key, w, h, seed, c) {
    return bsprite(key, w + 8, h + 14, w / 2 + 4, h + 4, g => {
      const rnd = mrng(seed);
      const px = (rnd() - .5) * w * .22, py = -h;
      let pts = [[-w / 2, 0]];
      const sec = rnd() < .7, side = rnd() < .5 ? -1 : 1;
      const sx = px + side * w * (.2 + rnd() * .1), sy = -h * (.52 + rnd() * .18);
      const vx = px + side * w * .1, vy = -h * (.42 + rnd() * .1);
      if (sec && side < 0) { pts.push([sx, sy]); pts.push([vx, vy]); }
      pts.push([px, py]);
      if (sec && side > 0) { pts.push([vx, vy]); pts.push([sx, sy]); }
      pts.push([w / 2, 0]);
      for (let it = 0; it < 3; it++) {
        const np = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
          const m = (rnd() - .5) * len * (it === 0 ? .16 : .2);
          np.push([(a[0] + b[0]) / 2 - dy / len * m, Math.min(0, (a[1] + b[1]) / 2 + dx / len * m)]);
          np.push(b);
        }
        pts = np;
      }
      let pk = 0; for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[pk][1]) pk = i;
      const sil = new Path2D(); sil.moveTo(-w / 2 - 4, 10);
      for (const p of pts) sil.lineTo(p[0], p[1]);
      sil.lineTo(w / 2 + 4, 10); sil.closePath();
      g.fillStyle = LG(g, 0, -h, 0, 0, [[0, c.top], [1, c.bot]]); g.fill(sil);
      g.save(); g.clip(sil);
      // oluklar (yüzey dokusu)
      g.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const i = 2 + ((rnd() * (pts.length - 4)) | 0), p = pts[i];
        let x = p[0], y = p[1];
        g.beginPath(); g.moveTo(x, y);
        const dir = x < pts[pk][0] ? -1 : 1, len = h * (.2 + rnd() * .35);
        for (let s = 0; s < 5; s++) { x += dir * (2 + rnd() * 8); y += len / 5; g.lineTo(x, y); }
        g.strokeStyle = c.gully || rgba('#000000', .12); g.lineWidth = 1.5 + rnd() * 2; g.stroke();
      }
      // kar
      if (c.snowLine) {
        const sl = -h * c.snowLine;
        const sn = new Path2D(); sn.moveTo(w, -h - 30); sn.lineTo(-w, -h - 30);
        let x = -w / 2 - 4;
        sn.lineTo(x, sl);
        while (x < w / 2 + 4) {
          const step = 7 + rnd() * 9;
          x += step;
          const yy = sl + (rnd() - .5) * h * .07;
          if (rnd() < .22) { const L = h * (.06 + rnd() * .16); sn.lineTo(x - 3, yy); sn.lineTo(x, yy + L); sn.lineTo(x + 3, yy); }
          else sn.lineTo(x, yy);
        }
        sn.closePath();
        g.fillStyle = LG(g, 0, -h, 0, sl + h * .2, [[0, '#ffffff'], [1, c.snow]]); g.fill(sn);
      }
      // gölge yüz (ışık sağdan)
      const sh = new Path2D(); sh.moveTo(-w / 2 - 6, 12);
      for (let i = 0; i <= pk; i++) sh.lineTo(pts[i][0], pts[i][1]);
      let cx = pts[pk][0], cy = pts[pk][1];
      const steps = 7;
      for (let s = 1; s <= steps; s++) { cx += (rnd() - .3) * w * .045; cy = pts[pk][1] * (1 - s / steps); sh.lineTo(cx, cy + 2); }
      sh.lineTo(cx, 12); sh.closePath();
      g.fillStyle = c.shadow; g.fill(sh);
      // alt pus
      g.fillStyle = LG(g, 0, -h * .6, 0, 4, [[0, rgba(c.haze, 0)], [1, rgba(c.haze, c.hazeA)]]);
      g.fillRect(-w, -h * .6, w * 2, h * .6 + 14);
      // kenar ışığı (sağ yamaç)
      if (c.rim) {
        g.beginPath(); g.moveTo(pts[pk][0], pts[pk][1]);
        for (let i = pk + 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.strokeStyle = c.rim; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
      }
      g.restore();
    }, .7);
  }

  /** Şeker teması: katlı pasta dağı / krema dağı */
  function cakeMtn(key, w, h, v, c) {
    return bsprite(key, w + 10, h + 40, w / 2 + 5, h + 30, g => {
      const rnd = mrng(7700 + v * 31);
      const ol = c.ol;
      const frost = (x, y, tw, fcol, dripMax) => {
        const p = new Path2D();
        p.moveTo(x - tw / 2 + 10, y);
        p.lineTo(x + tw / 2 - 10, y); p.quadraticCurveTo(x + tw / 2 + 1, y, x + tw / 2 + 1, y + 10);
        let xx = x + tw / 2 + 1;
        while (xx > x - tw / 2) {
          const dw = 7 + rnd() * 6, gap = 6 + rnd() * 16, dl = 5 + rnd() * dripMax;
          const xb = xx, xa = Math.max(x - tw / 2, xx - dw);
          p.lineTo(xb, y + 10);
          if (xb - xa > 4) { p.lineTo(xb, y + 10 + dl); p.arc((xa + xb) / 2, y + 10 + dl, (xb - xa) / 2, 0, PI, false); p.lineTo(xa, y + 10); }
          xx = xa - gap;
          if (xx > x - tw / 2) p.lineTo(xx, y + 8 + rnd() * 3);
        }
        p.lineTo(x - tw / 2 - 1, y + 10); p.quadraticCurveTo(x - tw / 2 - 1, y, x - tw / 2 + 10, y); p.closePath();
        g.fillStyle = fcol; g.fill(p);
        g.lineWidth = 2; g.strokeStyle = rgba(ol, .35); g.stroke(p);
        g.fillStyle = rgba('#ffffff', .7); g.fillRect(x - tw / 2 + 12, y + 2, tw * .5, 2.2);
      };
      if (v < 2) {
        const tiers = [[w * .9, h * .36], [w * .64, h * .3], [w * .4, h * .26]];
        const cols = c.tiers[v];
        let y = 0;
        const tops = [];
        for (let i = 0; i < tiers.length; i++) {
          const tw = tiers[i][0], th = tiers[i][1], col = cols[i % cols.length];
          const p = new Path2D(); rrp(p, -tw / 2, y - th, tw, th + (i ? 6 : 26), 14);
          g.fillStyle = LG(g, -tw / 2, 0, tw / 2, 0, [[0, shade(col, -.16)], [.55, col], [1, shade(col, .14)]]); g.fill(p);
          g.lineWidth = 2; g.strokeStyle = rgba(ol, .3); g.stroke(p);
          // katman çizgileri
          g.fillStyle = rgba('#ffffff', .35); g.fillRect(-tw / 2 + 6, y - th * .45, tw - 12, 4);
          g.fillStyle = rgba(ol, .12); g.fillRect(-tw / 2 + 6, y - th * .45 + 4, tw - 12, 3);
          tops.push([y - th, tw]);
          y -= th - 4;
        }
        for (let i = 0; i < tops.length; i++) frost(0, tops[i][0], tops[i][1] + 2, c.frost[(v + i) % c.frost.length], i === 0 ? 22 : 16);
        // üstte kiraz
        const ty = tops[2][0];
        g.strokeStyle = '#5b8a2b'; g.lineWidth = 3; g.beginPath(); g.moveTo(2, ty - 14); g.quadraticCurveTo(8, ty - 30, 16, ty - 34); g.stroke();
        g.fillStyle = RG(g, -4, ty - 16, 1, 0, ty - 12, 13, [[0, '#ff8a8a'], [.5, '#e8283c'], [1, '#a5101f']]);
        g.beginPath(); g.arc(0, ty - 12, 12, 0, TAU); g.fill();
        g.fillStyle = rgba('#ffffff', .8); g.beginPath(); g.ellipse(-4, ty - 17, 3.5, 2.2, -.5, 0, TAU); g.fill();
      } else {
        // krema dağı: yuvarlak tepe + çikolata sos + krema tepeleri
        const p = new Path2D();
        p.moveTo(-w / 2, 26);
        p.bezierCurveTo(-w * .42, -h * .5, -w * .2, -h * 1.02, 0, -h);
        p.bezierCurveTo(w * .22, -h * .98, w * .4, -h * .5, w / 2, 26);
        p.closePath();
        const col = c.tiers[2][0];
        g.fillStyle = LG(g, -w / 2, 0, w / 2, 0, [[0, shade(col, -.15)], [.6, col], [1, shade(col, .15)]]); g.fill(p);
        g.save(); g.clip(p);
        // çikolata sos şeritleri
        g.fillStyle = c.choco;
        const sy0 = -h * .6;
        const cp = new Path2D(); cp.moveTo(-w, -h * 2); cp.lineTo(w, -h * 2); cp.lineTo(w, sy0);
        let xx = w / 2;
        while (xx > -w / 2) {
          const dw = 9 + rnd() * 12, gap = 4 + rnd() * 16, dl = h * (.04 + rnd() * .16);
          cp.lineTo(xx, sy0); cp.lineTo(xx, sy0 + dl); cp.arc(xx - dw / 2, sy0 + dl, dw / 2, 0, PI, false); cp.lineTo(xx - dw, sy0);
          xx -= dw + gap;
        }
        cp.lineTo(-w, sy0); cp.closePath();
        g.fill(cp);
        g.fillStyle = rgba('#ffffff', .28); g.beginPath(); g.ellipse(w * .08, -h * .86, w * .07, h * .1, -.5, 0, TAU); g.fill();
        g.restore();
        // krema topu + kiraz
        const cr = [[0, -h + 4, 20], [-4, -h - 12, 15], [2, -h - 25, 10]];
        for (const k of cr) { g.fillStyle = '#e9b8d0'; g.beginPath(); g.arc(k[0], k[1], k[2], 0, TAU); g.fill(); }
        for (const k of cr) { g.fillStyle = '#fff7fb'; g.beginPath(); g.arc(k[0] - 2, k[1] - 2, k[2] - 2.5, 0, TAU); g.fill(); }
        g.fillStyle = '#e8283c'; g.beginPath(); g.arc(4, -h - 40, 8, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(1.5, -h - 43, 2.4, 0, TAU); g.fill();
      }
      // pus
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(c.haze, c.hazeAll); g.fillRect(-w, -h * 2, w * 2, h * 3);
      g.fillStyle = LG(g, 0, -h * .5, 0, 26, [[0, rgba(c.haze, 0)], [1, rgba(c.haze, c.hazeA)]]); g.fillRect(-w, -h * .5, w * 2, h * .5 + 30);
    }, .7);
  }

  /** Dağ katmanı: kaydırılan yuvalara deterministik dağ sprite'ları, altı düz dolgu */
  function mountains(ctx, o) {
    const VW = V.VW, VH = V.VH;
    const off = S.cam.x * o.f, yb = ly(o.base, o.fy);
    const margin = o.w * o.sc1 * .6;
    const i0 = Math.floor((off - margin) / o.slot), i1 = Math.floor((off + VW + margin) / o.slot);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = i0; i <= i1; i++) {
        if ((((i % 2) + 2) % 2) !== pass) continue;
        if (o.prob && hs(i, o.salt + 5) > o.prob) continue;
        const a = hs(i, o.salt), b = hs(i, o.salt + 1), c = hs(i, o.salt + 2);
        const v = (a * o.nv) | 0;
        const sc = (o.sc0 + (o.sc1 - o.sc0) * b) * (pass ? 1 : .86);
        drawS(ctx, o.spr(v, pass), i * o.slot + (c - .5) * o.slot * .45 - off, yb + (pass ? 0 : -4), sc);
      }
    }
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(0, yb + 2, VW, VH - yb + 2); }
  }

  const hbuf = new Float32Array(1024);
  function hillY(o, wx) {
    return -o.amp * (.52 + .3 * Math.sin(wx * o.k1 + o.p) + .14 * Math.sin(wx * o.k2 + o.p * 2.7) + .06 * Math.sin(wx * o.k2 * 2.6 + 1.1));
  }
  /** Prosedürel yuvarlak tepeler + üstünde ağaç siluetleri */
  function hills(ctx, P, o) {
    const VW = V.VW, VH = V.VH;
    const off = S.cam.x * o.f, yb = ly(o.base, o.fy);
    if (o.trees) {
      const t = o.trees, sp = t.sp;
      const i0 = Math.floor((off - 90) / sp), i1 = Math.floor((off + VW + 90) / sp);
      for (let i = i0; i <= i1; i++) {
        const a = hs(i, o.salt); if (a > t.prob) continue;
        const b = hs(i, o.salt + 7), c = hs(i, o.salt + 13);
        const wx = i * sp + (b - .5) * sp * .7;
        const kind = t.kinds[(c * t.kinds.length) | 0];
        const sc = t.sc0 + (t.sc1 - t.sc0) * b;
        drawS(ctx, t.spr(kind, (a * 3) | 0), wx - off, yb + hillY(o, wx) + t.sink, sc);
      }
    }
    const step = 12, n = Math.min(1000, Math.ceil((VW + 40) / step) + 1);
    ctx.beginPath(); ctx.moveTo(-20, VH + 4);
    for (let j = 0; j < n; j++) { const sx = -20 + j * step; const y = yb + hillY(o, sx + off); hbuf[j] = y; ctx.lineTo(sx, y); }
    ctx.lineTo(-20 + (n - 1) * step, VH + 4); ctx.closePath();
    ctx.save(); ctx.translate(0, yb - o.amp);
    ctx.fillStyle = cg(ctx, P.id + ':hill' + o.salt, g => LG(g, 0, 0, 0, o.amp + 230, o.stops));
    ctx.fill(); ctx.restore();
    if (o.rim) {
      ctx.beginPath();
      for (let j = 0; j < n; j++) { const sx = -20 + j * step; if (j) ctx.lineTo(sx, hbuf[j] + 1.5); else ctx.moveTo(sx, hbuf[j] + 1.5); }
      ctx.lineWidth = o.rimW || 3; ctx.strokeStyle = o.rim; ctx.lineJoin = 'round'; ctx.stroke();
    }
    if (o.after) o.after(ctx, off, yb, o, step, n);
  }
  /** En yakın arka plan katmanı: yoğun çalı/kar yığını/pamuk şeker siluetleri (çukurlardan görünen zenginlik) */
  function bushLine(ctx, P, o) {
    const VW = V.VW, VH = V.VH;
    const off = S.cam.x * o.f, yb = ly(o.base, o.fy);
    if (yb - 60 > VH) return;
    const sp = o.sp;
    const i0 = Math.floor((off - 60) / sp), i1 = Math.floor((off + VW + 60) / sp);
    const ys = (wx) => yb + Math.sin(wx * .004 + o.p) * o.amp + Math.sin(wx * .011 + o.p * 2) * o.amp * .4;
    // gövde + gölge tonu
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const h = hs(i, o.salt), wx = i * sp + h * sp * .5, x = wx - off;
      const r = o.r0 + (o.r1 - o.r0) * hs(i, o.salt + 1);
      const y = ys(wx) - r * .35;
      if (o.crag) {
        const tip = r * (1.1 + h * .8);
        ctx.moveTo(x - r * 1.3, y + r); ctx.lineTo(x - r * .5, y - tip * .45); ctx.lineTo(x - r * .1, y - tip * .4);
        ctx.lineTo(x + r * .15, y - tip); ctx.lineTo(x + r * .55, y - tip * .5); ctx.lineTo(x + r * 1.3, y + r); ctx.closePath();
      } else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    }
    ctx.rect(-10, ys(off) + 4, VW + 20, VH);
    ctx.fillStyle = o.dark; ctx.fill();
    // aydınlık kubbeler (sivri kayalarda: ışık alan sağ yüz)
    ctx.beginPath();
    if (o.crag) {
      for (let i = i0; i <= i1; i++) {
        const h = hs(i, o.salt), wx = i * sp + h * sp * .5, x = wx - off;
        const r = o.r0 + (o.r1 - o.r0) * hs(i, o.salt + 1);
        const y = ys(wx) - r * .35, tip = r * (1.1 + h * .8);
        ctx.moveTo(x + r * .15, y - tip); ctx.lineTo(x + r * .55, y - tip * .5); ctx.lineTo(x + r * 1.3, y + r); ctx.lineTo(x + r * .6, y + r); ctx.lineTo(x + r * .3, y - tip * .3); ctx.closePath();
      }
      ctx.fillStyle = o.lit; ctx.fill();
      ctx.beginPath();
    }
    if (!o.crag) {
    for (let i = i0; i <= i1; i++) {
      const h = hs(i, o.salt), wx = i * sp + h * sp * .5, x = wx - off;
      const r = o.r0 + (o.r1 - o.r0) * hs(i, o.salt + 1);
      const y = ys(wx) - r * .35;
      ctx.moveTo(x + r * .22 + r * .62, y - r * .26); ctx.arc(x + r * .22, y - r * .26, r * .62, 0, TAU);
    }
    ctx.fillStyle = o.lit; ctx.fill();
    }
    if (o.hi && !o.crag) {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const h = hs(i, o.salt), wx = i * sp + h * sp * .5, x = wx - off;
        const r = o.r0 + (o.r1 - o.r0) * hs(i, o.salt + 1);
        const y = ys(wx) - r * .35;
        ctx.moveTo(x + r * .3 + r * .26, y - r * .55); ctx.ellipse(x + r * .3, y - r * .55, r * .26, r * .14, -.4, 0, TAU);
      }
      ctx.fillStyle = o.hi; ctx.fill();
    }
    if (o.dots) {
      for (let i = i0; i <= i1; i++) {
        const h = hs(i, o.salt + 5); if (h > .45) continue;
        const wx = i * sp + h * sp, x = wx - off, y = ys(wx) - o.r0 * .6 - hs(i, o.salt + 6) * 10;
        E(ctx, x, y, 3, 3, o.dots[(h * 9 | 0) % o.dots.length]);
      }
    }
    // alt kısmı koyulaştır (derinlik)
    ctx.save(); ctx.translate(0, yb);
    ctx.fillStyle = cg(ctx, P.id + ':bushfog', g => LG(g, 0, 0, 0, 160, [[0, rgba(o.fog, 0)], [1, rgba(o.fog, .55)]]));
    ctx.fillRect(0, 0, VW, 160);
    ctx.restore();
    if (yb + 160 < VH) { ctx.fillStyle = rgba(o.fog, .55); ctx.fillRect(0, yb + 160, VW, VH - yb - 160 + 1); }
  }
  const BUSH = {
    forest: { salt: 610, f: .38, fy: .2, base: 488, sp: 30, r0: 16, r1: 30, amp: 14, p: .7, dark: '#245a2e', lit: '#357a3c', hi: 'rgba(160,230,120,0.35)', dots: ['#ff5a6e', '#ffd84a', '#ffffff'], fog: '#0f2e1c' },
    candy: { salt: 620, f: .38, fy: .2, base: 490, sp: 30, r0: 16, r1: 30, amp: 14, p: 2.2, dark: '#c95a9c', lit: '#e47fbb', hi: 'rgba(255,230,245,0.6)', dots: ['#ff3d6a', '#3fd07a', '#ffcf3a', '#5ac8ff'], fog: '#6a1e4a' },
    snow: { salt: 630, f: .38, fy: .2, base: 492, sp: 30, r0: 16, r1: 30, amp: 14, p: 1.4, dark: '#9fb9dc', lit: '#d8e7f8', hi: 'rgba(255,255,255,0.9)', dots: null, fog: '#2a4672' },
    castle: { salt: 640, f: .38, fy: .2, base: 500, sp: 34, r0: 12, r1: 24, amp: 14, p: 3.1, dark: '#160a20', lit: '#3a1a3a', hi: null, dots: null, fog: '#07020c', crag: true }
  };
  function haze(ctx, P, y, h, a) {
    const VW = V.VW, VH = V.VH;
    if (y - h > VH) return;
    ctx.save(); ctx.translate(0, y - h);
    ctx.fillStyle = cg(ctx, P.id + ':hz' + h + ':' + a, g => LG(g, 0, 0, 0, h, [[0, rgba(P.haze, 0)], [1, rgba(P.haze, a)]]));
    ctx.fillRect(0, 0, VW, h);
    ctx.restore();
    if (y < VH) { ctx.fillStyle = rgba(P.haze, a); ctx.fillRect(0, y, VW, VH - y + 1); }
  }

  /* =====================================================================
     ARKA PLAN AĞAÇ / SİLUET SPRITE'LARI
     ===================================================================== */
  /** 3 tonlu çizgi film yaprak kümesi (daireler birleşimi) */
  function canopy(g, circles, c, olw) {
    const u = new Path2D();
    for (const k of circles) circ(u, k[0], k[1], k[2]);
    g.save();
    if (c.ol) { g.lineWidth = olw || 5; g.strokeStyle = c.ol; g.lineJoin = 'round'; g.stroke(u); }
    g.fillStyle = c.dark; g.fill(u);
    g.clip(u);
    g.fillStyle = c.mid;
    for (const k of circles) { g.beginPath(); g.arc(k[0] + k[2] * .1, k[1] - k[2] * .16, k[2] * .86, 0, TAU); g.fill(); }
    g.fillStyle = c.lit;
    for (const k of circles) { g.beginPath(); g.arc(k[0] + k[2] * .24, k[1] - k[2] * .32, k[2] * .52, 0, TAU); g.fill(); }
    if (c.hi) {
      g.fillStyle = c.hi;
      for (const k of circles) { if (k[2] < 14) continue; g.beginPath(); g.ellipse(k[0] + k[2] * .34, k[1] - k[2] * .5, k[2] * .2, k[2] * .12, -.5, 0, TAU); g.fill(); }
    }
    if (c.tex) {
      g.strokeStyle = c.tex; g.lineWidth = 1.6; g.lineCap = 'round';
      for (const k of circles) {
        for (let i = 0; i < 3; i++) {
          const a = 1 + i * 1.5 + k[0] * .1, rr = k[2] * (.45 + i * .12);
          g.beginPath(); g.arc(k[0] + Math.cos(a) * rr * .5, k[1] + Math.sin(a) * rr * .5, k[2] * .2, .4, 2.2); g.stroke();
        }
      }
    }
    g.restore();
  }
  /** Arka plan siluet ağaçları (tema + renk anahtarına göre) */
  function bgTree(id, kind, v, c) {
    const key = id + ':bt:' + kind + ':' + v + ':' + c.k;
    switch (kind) {
      case 'round': return bsprite(key, 90, 130, 45, 122, g => {
        g.fillStyle = c.trunk; g.fillRect(-4, -60, 8, 64);
        const s = .8 + v * .12;
        canopy(g, [[0, -66 * s, 26 * s], [-20 * s, -52 * s, 18 * s], [20 * s, -50 * s, 19 * s], [-8 * s, -86 * s, 18 * s], [10 * s, -84 * s, 17 * s]], c, 0);
      }, .8);
      case 'pine': return bsprite(key, 70, 150, 35, 144, g => {
        g.fillStyle = c.trunk; g.fillRect(-3, -20, 6, 24);
        const hgt = 110 + v * 14;
        const tiers = 4;
        for (let i = 0; i < tiers; i++) {
          const ty = -18 - i * hgt / (tiers + .6), tw = 30 - i * 6, th = hgt / tiers + 16;
          const p = new Path2D(); p.moveTo(0, ty - th); p.quadraticCurveTo(tw * .3, ty - th * .5, tw, ty); p.quadraticCurveTo(0, ty - 6, -tw, ty); p.quadraticCurveTo(-tw * .3, ty - th * .5, 0, ty - th); p.closePath();
          g.fillStyle = c.dark; g.fill(p);
          g.save(); g.clip(p); g.fillStyle = c.mid; g.beginPath(); g.moveTo(0, ty - th); g.lineTo(tw + 2, ty + 2); g.lineTo(2, ty + 2); g.closePath(); g.fill(); g.restore();
          if (c.snow) {
            const sp = new Path2D(); sp.moveTo(0, ty - th); sp.quadraticCurveTo(tw * .2, ty - th * .62, tw * .55, ty - th * .3);
            sp.quadraticCurveTo(tw * .3, ty - th * .26, tw * .12, ty - th * .4); sp.quadraticCurveTo(-tw * .2, ty - th * .3, -tw * .5, ty - th * .32);
            sp.quadraticCurveTo(-tw * .2, ty - th * .62, 0, ty - th); sp.closePath();
            g.fillStyle = c.snow; g.fill(sp);
          }
        }
      }, .8);
      case 'lolli': return bsprite(key, 60, 150, 30, 146, g => {
        g.fillStyle = c.trunk; g.fillRect(-2.5, -100, 5, 104);
        const r = 22 + v * 4, cy = -100 - r + 4;
        g.fillStyle = c.dark; g.beginPath(); g.arc(0, cy, r, 0, TAU); g.fill();
        g.strokeStyle = c.mid; g.lineWidth = r * .28; g.beginPath();
        for (let a = 0; a < 15; a += .25) { const rr = a / 15 * r * .9; const x = Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (a) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
        g.fillStyle = rgba('#ffffff', .35); g.beginPath(); g.ellipse(r * .35, cy - r * .4, r * .3, r * .16, -.6, 0, TAU); g.fill();
      }, .8);
      case 'cane': return bsprite(key, 60, 150, 30, 146, g => {
        const p = new Path2D(); p.moveTo(0, 4); p.lineTo(0, -96); p.arc(14, -96, 14, PI, 0, false); p.lineTo(28, -84);
        g.lineCap = 'round'; g.lineWidth = 11; g.strokeStyle = c.dark; g.stroke(p);
        g.setLineDash([7, 7]); g.lineWidth = 11; g.strokeStyle = c.mid; g.stroke(p); g.setLineDash([]);
      }, .8);
      case 'puff': return bsprite(key, 100, 150, 50, 144, g => {
        g.fillStyle = c.trunk; g.fillRect(-4, -70, 8, 74);
        const s = .85 + v * .1;
        canopy(g, [[0, -86 * s, 28 * s], [-24 * s, -70 * s, 20 * s], [24 * s, -70 * s, 21 * s], [-12 * s, -106 * s, 19 * s], [13 * s, -104 * s, 18 * s]], c, 0);
      }, .8);
      case 'dead': return bsprite(key, 90, 140, 45, 136, g => {
        g.strokeStyle = c.dark; g.lineCap = 'round'; g.lineJoin = 'round';
        const br = (x, y, a, l, w, d) => {
          const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l;
          g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
          if (d > 0) { br(x2, y2, a - .45 - v * .05, l * .68, w * .62, d - 1); br(x2, y2, a + .4, l * .62, w * .6, d - 1); }
        };
        br(0, 4, -PI / 2 + (v - 1) * .08, 48, 8, 4);
      }, .8);
      case 'tower': return bsprite(key, 70, 200, 35, 196, g => {
        const hgt = 120 + v * 26, tw = 30;
        g.fillStyle = c.dark; g.fillRect(-tw / 2, -hgt, tw, hgt + 4);
        for (let i = 0; i < 4; i++) g.fillRect(-tw / 2 - 3 + i * 9, -hgt - 8, 6, 9);
        g.fillRect(-tw / 2 - 3, -hgt - 2, tw + 6, 5);
        g.beginPath(); g.moveTo(-tw / 2 - 4, -hgt - 8); g.lineTo(0, -hgt - 48); g.lineTo(tw / 2 + 4, -hgt - 8); g.closePath(); g.fill();
        g.fillStyle = c.win;
        for (let i = 0; i < 3; i++) { if ((v + i) % 3 === 2) continue; rrp(g, -3, -hgt + 18 + i * 32, 6, 10, 3); g.beginPath(); rrp(g, -3, -hgt + 18 + i * 32, 6, 10, 3); g.fill(); }
        g.strokeStyle = c.dark; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -hgt - 48); g.lineTo(0, -hgt - 64); g.stroke();
        g.fillStyle = c.flag; g.beginPath(); g.moveTo(0, -hgt - 64); g.lineTo(14, -hgt - 60); g.lineTo(0, -hgt - 55); g.fill();
      }, .8);
    }
    return null;
  }

  /** Orman: gökyüzündeki uçan adacık (üstünde kale / ağaçlar / şelale) */
  function islandSpr(P, v) {
    return bsprite('forest:isl' + v, 260, 240, 130, 60, g => {
      const rnd = mrng(901 + v * 17);
      const W = 200 - v * 30;
      // gövde (kaya)
      const body = [];
      body.push([W / 2, 6]);
      const n = 9;
      for (let i = 1; i < n; i++) {
        const t = i / n, x = W / 2 - W * t;
        const depth = Math.pow(Math.sin(t * PI), .8) * (110 - v * 18) + (rnd() - .5) * 14;
        body.push([x + (rnd() - .5) * 8, 6 + depth]);
      }
      body.push([-W / 2, 6]);
      const bp = new Path2D(); smoothClosed(bp, body);
      g.fillStyle = LG(g, 0, 0, 0, 120, [[0, '#b98d62'], [.5, '#8f6744'], [1, '#5f4330']]); g.fill(bp);
      g.save(); g.clip(bp);
      g.fillStyle = rgba('#ffe2b0', .22); g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(10, 140); g.closePath(); g.fill();
      g.strokeStyle = rgba('#4a3020', .35); g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const y = 18 + i * 16; g.beginPath(); g.moveTo(-W / 2, y + rnd() * 6); g.quadraticCurveTo(0, y + 8 + rnd() * 6, W / 2, y + rnd() * 6); g.stroke(); }
      for (let i = 0; i < 7; i++) { E(g, (rnd() - .5) * W * .7, 20 + rnd() * 50, 5 + rnd() * 6, 3 + rnd() * 3, rgba('#d9b48a', .5)); }
      g.restore();
      // koyu kontur YOK: kalın kontur yalnızca oyun katmanında (uzak ada oynanabilir platform sanılmasın)
      g.lineWidth = 1.5; g.strokeStyle = rgba('#8a6a50', .35); g.stroke(bp);
      // sarmaşıklar
      g.strokeStyle = '#4f9a3a'; g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const x = (rnd() - .5) * W * .8, l = 16 + rnd() * 34;
        g.lineWidth = 2; g.beginPath(); g.moveTo(x, 8); g.quadraticCurveTo(x + 6, 8 + l * .5, x - 2, 8 + l); g.stroke();
        E(g, x - 2, 8 + l, 3, 2, '#6cc04a');
      }
      // çimen kapak
      const cap = new Path2D(); cap.moveTo(-W / 2 - 6, 4); cap.quadraticCurveTo(-W / 2 - 4, -6, -W / 2 + 8, -6); cap.lineTo(W / 2 - 8, -6); cap.quadraticCurveTo(W / 2 + 4, -6, W / 2 + 6, 4);
      for (let x = W / 2 + 6; x > -W / 2 - 6; x -= 12) cap.quadraticCurveTo(x - 6, 16 + rnd() * 3, x - 12, 6);
      cap.closePath();
      g.fillStyle = LG(g, 0, -6, 0, 14, [[0, '#a5e45e'], [1, '#4f9e33']]); g.fill(cap);
      g.lineWidth = 1.5; g.strokeStyle = rgba('#4f8a38', .45); g.stroke(cap);
      g.fillStyle = rgba('#e8ffc0', .7); g.fillRect(-W / 2 + 8, -5, W - 16, 2);
      // şelale
      if (v !== 2) {
        const wx = W * .32;
        g.fillStyle = LG(g, 0, 4, 0, 170, [[0, rgba('#dff6ff', .95)], [.6, rgba('#a8e0ff', .55)], [1, rgba('#a8e0ff', 0)]]);
        g.fillRect(wx - 5, 2, 10, 172);
        g.fillStyle = rgba('#ffffff', .8); g.fillRect(wx - 2, 2, 2, 120);
      }
      // üst yapı
      if (v === 0) {
        // küçük kale
        const st = '#eae4f3', sd = '#b7accb', roof = '#e0514c', rd = '#a93334';
        g.fillStyle = sd; g.fillRect(-36, -40, 72, 36); g.fillStyle = st; g.fillRect(-36, -40, 50, 36);
        for (let i = 0; i < 5; i++) { g.fillStyle = i < 3 ? st : sd; g.fillRect(-36 + i * 15, -46, 9, 7); }
        const tower = (x, w, h) => {
          g.fillStyle = sd; g.fillRect(x - w / 2, -h, w, h); g.fillStyle = st; g.fillRect(x - w / 2, -h, w * .62, h);
          g.fillStyle = rd; g.beginPath(); g.moveTo(x - w / 2 - 4, -h); g.lineTo(x, -h - w * 1.3); g.lineTo(x + w / 2 + 4, -h); g.closePath(); g.fill();
          g.fillStyle = roof; g.beginPath(); g.moveTo(x - w / 2 - 4, -h); g.lineTo(x, -h - w * 1.3); g.lineTo(x + 2, -h); g.closePath(); g.fill();
          g.fillStyle = '#4a3a66'; rrp(g, x - 3, -h + 10, 6, 10, 3); g.beginPath(); rrp(g, x - 3, -h + 10, 6, 10, 3); g.fill();
          g.strokeStyle = '#5a4a3a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, -h - w * 1.3); g.lineTo(x, -h - w * 1.3 - 12); g.stroke();
          g.fillStyle = '#e0514c'; g.beginPath(); g.moveTo(x, -h - w * 1.3 - 12); g.lineTo(x + 10, -h - w * 1.3 - 9); g.lineTo(x, -h - w * 1.3 - 6); g.fill();
        };
        tower(-38, 20, 60); tower(36, 22, 74); tower(0, 16, 52);
        g.fillStyle = '#5a4030'; g.beginPath(); g.moveTo(-8, -4); g.lineTo(-8, -18); g.arc(0, -18, 8, PI, 0); g.lineTo(8, -4); g.fill();
      } else {
        const tc = { k: 'isl', ol: null, dark: '#3f8a3e', mid: '#5aae4a', lit: '#8fd65f', hi: null };
        const trees = v === 1 ? [[-50, 1], [-20, .8], [45, 1.1]] : [[-20, 1.1], [24, .9]];
        for (const t of trees) {
          g.fillStyle = '#6b4a2c'; g.fillRect(t[0] - 3, -30 * t[1], 6, 32 * t[1]);
          canopy(g, [[t[0], -38 * t[1], 16 * t[1]], [t[0] - 11 * t[1], -30 * t[1], 11 * t[1]], [t[0] + 11 * t[1], -29 * t[1], 12 * t[1]], [t[0], -52 * t[1], 11 * t[1]]], tc, 0);
        }
      }
      // uzaklık pusu (güçlü: dağ zirveleri kadar uzakta okunmalı)
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(P.haze, .5); g.fillRect(-200, -200, 400, 400);
    }, .6);
  }
  function islands(ctx, P) {
    // küçük, yüksekte (dağ zirveleri hizası), yavaş parallax: oyun bandından uzak, platform sanılmaz
    const VW = V.VW, f = .05, slot = 720;
    const off = S.cam.x * f, yo = -(S.cam.y - 100) * .035;
    const i0 = Math.floor((off - 120) / slot), i1 = Math.floor((off + VW + 120) / slot);
    for (let i = i0; i <= i1; i++) {
      if (hs(i, 555) > .66) continue;
      const v = (hs(i, 556) * 3) | 0, sc = .28 + hs(i, 557) * .14;
      const x = i * slot + hs(i, 558) * slot * .5 - off;
      const y = 50 + hs(i, 559) * 70 + yo + Math.sin(tk * .55 + i * 1.3) * 3;
      drawS(ctx, islandSpr(P, v), x, y, sc);
    }
  }
  /** Kale teması: uzak kale siluetleri (ışıklı pencereler, bayraklar) */
  function castleSpr(key, v, c) {
    return bsprite(key, 360, 260, 180, 250, g => {
      const rnd = mrng(3300 + v * 71);
      const body = c.body, win = c.win;
      g.fillStyle = body;
      const towers = v === 0 ? [[-110, 26, 130], [-60, 34, 190], [0, 44, 230], [62, 32, 170], [120, 24, 120]]
        : v === 1 ? [[-80, 30, 160], [-20, 40, 210], [50, 30, 150], [100, 22, 110]]
          : [[-60, 38, 180], [10, 28, 140], [70, 34, 200]];
      // perde duvar
      g.fillRect(-150, -80, 300, 84);
      for (let x = -150; x < 150; x += 14) g.fillRect(x, -90, 8, 12);
      for (const t of towers) {
        const [x, w, h] = t;
        g.fillRect(x - w / 2, -h, w, h + 4);
        for (let i = 0; i < 4; i++) g.fillRect(x - w / 2 - 3 + i * (w + 6) / 4, -h - 8, (w + 6) / 4 - 4, 10);
        g.fillRect(x - w / 2 - 3, -h - 2, w + 6, 4);
        if (rnd() < .65) {
          g.beginPath(); g.moveTo(x - w / 2 - 4, -h - 4); g.lineTo(x, -h - w * 1.35); g.lineTo(x + w / 2 + 4, -h - 4); g.closePath(); g.fill();
          g.lineWidth = 1.5; g.strokeStyle = body; g.beginPath(); g.moveTo(x, -h - w * 1.35); g.lineTo(x, -h - w * 1.35 - 16); g.stroke();
          g.beginPath(); g.moveTo(x, -h - w * 1.35 - 16); g.quadraticCurveTo(x + 9, -h - w * 1.35 - 18, x + 16, -h - w * 1.35 - 12); g.lineTo(x, -h - w * 1.35 - 9); g.fill();
        }
      }
      // pencereler (sıcak ışık + hafif hale)
      for (const t of towers) {
        const [x, w, h] = t;
        for (let yy = -h + 22; yy < -20; yy += 30) {
          if (rnd() < .4) continue;
          const wx = x + (rnd() < .5 ? -w * .18 : w * .18) - 3;
          g.fillStyle = rgba(win, .25); g.beginPath(); g.arc(wx + 3, yy + 5, 9, 0, TAU); g.fill();
          g.fillStyle = win; g.beginPath(); rrp(g, wx, yy, 6, 11, 3); g.fill();
        }
      }
      for (let i = 0; i < 6; i++) { const wx = -140 + rnd() * 280, wy = -60 + rnd() * 30; g.fillStyle = win; g.beginPath(); rrp(g, wx, wy, 5, 8, 2.5); g.fill(); }
    }, .8);
  }
  function castles(ctx, P, o) {
    const VW = V.VW;
    const off = S.cam.x * o.f, yb = ly(o.base, o.fy);
    const i0 = Math.floor((off - 260) / o.slot), i1 = Math.floor((off + VW + 260) / o.slot);
    for (let i = i0; i <= i1; i++) {
      if (hs(i, o.salt) > o.prob) continue;
      const v = (hs(i, o.salt + 1) * 3) | 0, sc = o.sc0 + hs(i, o.salt + 2) * (o.sc1 - o.sc0);
      drawS(ctx, castleSpr('castle:cs' + o.salt + ':' + v, v, o.c), i * o.slot + hs(i, o.salt + 3) * o.slot * .4 - off, yb, sc);
    }
  }

  /* =====================================================================
     TEMA ARKA PLANLARI
     ===================================================================== */
  const MT = {
    forest: { top: '#9ab9e6', bot: '#b9d3f2', shadow: 'rgba(58,84,150,0.42)', snow: '#dce9fb', snowLine: .62, rim: 'rgba(255,255,255,0.55)', haze: '#cfe8ff', hazeA: .75, gully: 'rgba(60,80,140,0.14)' },
    forest2: { top: '#7fb0d8', bot: '#a9cde8', shadow: 'rgba(40,80,120,0.4)', snow: null, snowLine: 0, rim: 'rgba(255,255,255,0.4)', haze: '#cfe8ff', hazeA: .7, gully: 'rgba(40,70,110,0.16)' },
    snow: { top: '#d3e2f7', bot: '#a6bfe3', shadow: 'rgba(50,78,150,0.45)', snow: '#e6f0ff', snowLine: .72, rim: 'rgba(255,255,255,0.8)', haze: '#e1eeff', hazeA: .7, gully: 'rgba(40,70,140,0.18)' },
    snow2: { top: '#88a8d8', bot: '#6c8ec4', shadow: 'rgba(30,50,110,0.45)', snow: '#dce8fa', snowLine: .52, rim: 'rgba(255,255,255,0.6)', haze: '#d6e6fb', hazeA: .6, gully: 'rgba(20,40,100,0.2)' },
    castle: { top: '#5b2f73', bot: '#8a4677', shadow: 'rgba(25,8,45,0.5)', snow: null, snowLine: 0, rim: 'rgba(255,170,110,0.75)', haze: '#ff9868', hazeA: .55, gully: 'rgba(20,0,30,0.2)' }
  };
  const BG = {};
  BG.forest = function (ctx, P, VW) {
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .02));
    clouds(ctx, P, { salt: 101, f: .012, fy: .012, wind: 4, slot: 330, prob: .72, y0: 30, y1: 120, sc0: .42, sc1: .62, a: .8 });
    mountains(ctx, { salt: 202, f: .035, fy: .03, base: 330, slot: 230, sc0: .78, sc1: 1.15, nv: 4, w: 520,
      spr: (v, pass) => jagMtn('forest:m' + v + pass, 520, 220 + v * 14, 50 + v * 13, pass ? MT.forest : Object.assign({}, MT.forest, { top: '#b2cbec', bot: '#c6dbf3' })),
      fill: mix(MT.forest.bot, MT.forest.haze, MT.forest.hazeA) });
    haze(ctx, P, ly(330, .03), 110, .45);
    islands(ctx, P);
    clouds(ctx, P, { salt: 303, f: .045, fy: .035, wind: 8, slot: 560, prob: .55, y0: 150, y1: 230, sc0: .7, sc1: 1, a: .95 });
    const tcFar = { k: 'f1', ol: null, trunk: '#4f7a5a', dark: '#4f9a6a', mid: '#64ae78', lit: '#86c98e', hi: null };
    hills(ctx, P, { salt: 404, f: .13, fy: .07, base: 372, amp: 62, k1: .0046, k2: .013, p: 1.3,
      stops: [[0, '#8ccf86'], [.35, '#6fbc78'], [1, '#5aa877']], rim: 'rgba(226,255,190,0.7)', rimW: 2.5,
      trees: { sp: 34, prob: .62, kinds: ['round', 'round', 'pine'], sc0: .45, sc1: .7, sink: 10, spr: (k, v) => bgTree('forest', k, v, k === 'pine' ? Object.assign({}, tcFar, { k: 'f1p', dark: '#3f8a62', mid: '#55a070' }) : tcFar) } });
    haze(ctx, P, ly(392, .07), 70, .3);
    const tcNear = { k: 'f2', ol: '#24502e', trunk: '#3d3424', dark: '#2f7a40', mid: '#3f9450', lit: '#5bb062', hi: 'rgba(180,240,140,0.35)' };
    hills(ctx, P, { salt: 505, f: .25, fy: .13, base: 418, amp: 46, k1: .0062, k2: .017, p: 4.2,
      stops: [[0, '#4f9e4e'], [.4, '#3c8a45'], [1, '#2c6a3c']], rim: 'rgba(170,230,120,0.55)', rimW: 2.5,
      trees: { sp: 26, prob: .85, kinds: ['round', 'pine', 'round', 'pine', 'round'], sc0: .55, sc1: .95, sink: 16, spr: (k, v) => bgTree('forest', k, v, k === 'pine' ? Object.assign({}, tcNear, { k: 'f2p', dark: '#1f6236', mid: '#2e7a42' }) : tcNear) } });
    haze(ctx, P, ly(452, .13), 60, .22);
    bushLine(ctx, P, BUSH.forest);
    birds(ctx, 'rgba(40,60,90,0.7)', 5, 77, false);
  };
  BG.candy = function (ctx, P, VW) {
    // gökkuşağı + güneş halesi uzak gök önbelleğinde (FAR.candy / farSky)
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .02));
    clouds(ctx, P, { salt: 111, f: .012, fy: .012, wind: 4, slot: 320, prob: .72, y0: 30, y1: 120, sc0: .42, sc1: .62, a: .85 });
    const cm = { ol: '#7a2a58', haze: P.haze, hazeA: .55, hazeAll: .28, choco: '#8a4a2c',
      tiers: [['#d6a6f2', '#f6a9cf', '#b7e3f2'], ['#f6b48c', '#ffd27a', '#f6a9cf'], ['#f39cc8']], frost: ['#fff6fb', '#ffd3ea', '#fff6fb'] };
    mountains(ctx, { salt: 212, f: .035, fy: .03, base: 350, slot: 290, sc0: .55, sc1: .8, nv: 3, w: 420, prob: .85,
      spr: (v, pass) => cakeMtn('candy:cm' + v + pass, 420, 200 + v * 10, v, pass ? cm : Object.assign({}, cm, { hazeAll: .42 })),
      fill: null });
    hills(ctx, P, { salt: 313, f: .05, fy: .035, base: 360, amp: 24, k1: .006, k2: .015, p: .4,
      stops: [[0, mix('#f6a9cf', P.haze, .55)], [1, mix('#f39cc8', P.haze, .7)]], rim: rgba('#ffffff', .6), rimW: 3 });
    haze(ctx, P, ly(350, .03), 110, .45);
    clouds(ctx, P, { salt: 313, f: .05, fy: .035, wind: 7, slot: 480, prob: .6, y0: 140, y1: 240, sc0: .6, sc1: .95, a: .95, tag: 'cc',
      col: { lit: '#fff0fb', mid: '#ffd6f0', shade: '#f6b3e2', deep: '#d995e6' } });
    const tcF = { k: 'c1', ol: null, trunk: '#fff1f6', dark: '#ff7fb6', mid: '#ffffff', lit: '#ffd0e6', hi: null };
    // arka plan şekerleri oyun katmanıyla yarışmasın: küçük, pusa karışmış (soldurulmuş) renkler, kontursuz
    const cs = c => mix(c, P.haze, .3);
    hills(ctx, P, { salt: 414, f: .13, fy: .07, base: 378, amp: 58, k1: .005, k2: .012, p: 2.1,
      stops: [[0, '#bff3dc'], [.35, '#94e2c4'], [1, '#79cdb2']], rim: '#fff8fc', rimW: 6,
      trees: { sp: 46, prob: .55, kinds: ['lolli', 'cane', 'puff'], sc0: .4, sc1: .56, sink: 10,
        spr: (k, v) => bgTree('candy', k, v, k === 'cane' ? { k: 'c1c', dark: '#fff6fa', mid: cs('#ff5f8f') } : k === 'puff' ? { k: 'c1p', ol: null, trunk: '#ffe9a8', dark: '#e98fd8', mid: '#f7b2e6', lit: '#ffd8f3', hi: null } : Object.assign({}, tcF, { dark: cs(['#ff7fb6', '#8fd3ff', '#ffd36b'][v]), mid: '#fff6fa', k: 'c1' + v })) },
      after: (ctx2, off, yb, o) => candyDrips(ctx2, off, yb, o, '#fff8fc', 30, 6) });
    haze(ctx, P, ly(398, .07), 70, .4);
    const olN = mix('#8a2a62', P.haze, .5);
    hills(ctx, P, { salt: 515, f: .25, fy: .13, base: 420, amp: 44, k1: .0068, k2: .018, p: 3.3,
      stops: [[0, '#b0703f'], [.4, '#8a4a26'], [1, '#6a3418']], rim: '#ff9fcd', rimW: 8,
      trees: { sp: 34, prob: .72, kinds: ['lolli', 'puff', 'lolli', 'cane'], sc0: .5, sc1: .72, sink: 14,
        spr: (k, v) => bgTree('candy', k, v, k === 'cane' ? { k: 'c2c', dark: '#fff6fa', mid: mix('#e8283c', P.haze, .25) } : k === 'puff' ? { k: 'c2p' + v, ol: olN, trunk: '#fff1c8', dark: cs(['#c86ad6', '#59b8e6', '#ff8fb8'][v]), mid: cs(['#de8ae6', '#7fd0f2', '#ffb0cc'][v]), lit: cs(['#f2b8f2', '#b8ecff', '#ffd6e6'][v]), hi: 'rgba(255,255,255,0.35)' } : { k: 'c2l' + v, trunk: '#fff6fa', dark: mix(['#ff4f8f', '#3fb7ff', '#ffb52e'][v], P.haze, .25), mid: '#fff6fa' }) },
      after: (ctx2, off, yb, o) => candyDrips(ctx2, off, yb, o, '#ff9fcd', 24, 9) });
    haze(ctx, P, ly(455, .13), 60, .38);
    bushLine(ctx, P, BUSH.candy);
  };
  /** Şeker tepelerinin kenarından sarkan krema/çikolata damlaları */
  function candyDrips(ctx, off, yb, o, col, sp, wmax) {
    const VW = V.VW;
    ctx.fillStyle = col;
    const i0 = Math.floor((off - 20) / sp), i1 = Math.floor((off + VW + 20) / sp);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const h1 = hs(i, o.salt + 99); if (h1 > .6) continue;
      const wx = i * sp + h1 * sp * .5, x = wx - off, y = yb + hillY(o, wx) + 1;
      const w = 3 + h1 * wmax, l = 5 + hs(i, o.salt + 98) * 14;
      ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2, y + l); ctx.arc(x, y + l, w / 2, PI, 0, true); ctx.lineTo(x + w / 2, y);
    }
    ctx.fill();
  }
  BG.snow = function (ctx, P, VW) {
    stars(ctx, 50, 5150, 170, .55);
    if (!lowQ()) aurora(ctx);
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .025));
    clouds(ctx, P, { salt: 121, f: .012, fy: .012, wind: 5, slot: 380, prob: .55, y0: 60, y1: 150, sc0: .4, sc1: .6, a: .7 });
    mountains(ctx, { salt: 222, f: .03, fy: .028, base: 340, slot: 250, sc0: .82, sc1: 1.2, nv: 4, w: 560,
      spr: (v, pass) => jagMtn('snow:m' + v + pass, 560, 250 + v * 18, 70 + v * 19, pass ? MT.snow : Object.assign({}, MT.snow, { top: '#e0ebfa', bot: '#bfd2ee' })),
      fill: mix(MT.snow.bot, MT.snow.haze, MT.snow.hazeA) });
    haze(ctx, P, ly(340, .028), 110, .4);
    mountains(ctx, { salt: 232, f: .07, fy: .05, base: 372, slot: 200, sc0: .7, sc1: 1, nv: 4, w: 440,
      spr: (v, pass) => jagMtn('snow:n' + v + pass, 440, 170 + v * 12, 90 + v * 7, pass ? MT.snow2 : Object.assign({}, MT.snow2, { top: '#9cb8e0', bot: '#86a4d0' })),
      fill: mix(MT.snow2.bot, MT.snow2.haze, MT.snow2.hazeA) });
    haze(ctx, P, ly(372, .05), 80, .35);
    const tcF = { k: 's1', trunk: '#5a6f8a', dark: '#5f86b4', mid: '#769cc6', snow: '#f4f8ff' };
    hills(ctx, P, { salt: 424, f: .13, fy: .07, base: 392, amp: 50, k1: .005, k2: .013, p: .7,
      stops: [[0, '#f4f8ff'], [.3, '#dbe8f8'], [1, '#b6cbe8']], rim: '#ffffff', rimW: 2.5,
      trees: { sp: 26, prob: .62, kinds: ['pine'], sc0: .4, sc1: .7, sink: 12, spr: (k, v) => bgTree('snow', 'pine', v, tcF) } });
    haze(ctx, P, ly(410, .07), 70, .28);
    const tcN = { k: 's2', trunk: '#3a3a4a', dark: '#2b5a7c', mid: '#3d7396', snow: '#ffffff' };
    hills(ctx, P, { salt: 525, f: .25, fy: .13, base: 430, amp: 40, k1: .0066, k2: .019, p: 2.9,
      stops: [[0, '#ffffff'], [.3, '#e3eefb'], [1, '#a9c2e4']], rim: '#ffffff', rimW: 2,
      trees: { sp: 22, prob: .8, kinds: ['pine'], sc0: .55, sc1: .95, sink: 14, spr: (k, v) => bgTree('snow', 'pine', v, tcN) } });
    haze(ctx, P, ly(462, .13), 60, .2);
    bushLine(ctx, P, BUSH.snow);
    birds(ctx, 'rgba(30,50,90,0.6)', 3, 99, false);
  };
  BG.castle = function (ctx, P, VW) {
    stars(ctx, 80, 7310, 230, .9);
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .03));
    clouds(ctx, P, { salt: 131, f: .012, fy: .012, wind: 3, slot: 420, prob: .7, y0: 70, y1: 190, sc0: .55, sc1: .85, a: .85, sx: 1.8, sy: .42 });
    mountains(ctx, { salt: 242, f: .035, fy: .03, base: 352, slot: 240, sc0: .75, sc1: 1.1, nv: 4, w: 520,
      spr: (v, pass) => jagMtn('castle:m' + v + pass, 520, 200 + v * 15, 30 + v * 11, pass ? MT.castle : Object.assign({}, MT.castle, { top: '#7a4282', bot: '#a85a7c', hazeA: .65 })),
      fill: mix(MT.castle.bot, MT.castle.haze, MT.castle.hazeA) });
    haze(ctx, P, ly(352, .03), 100, .35);
    castles(ctx, P, { salt: 343, f: .075, fy: .05, base: 380, slot: 620, prob: .7, sc0: .55, sc1: .75, c: { body: '#4c2462', win: '#ffd36b' } });
    haze(ctx, P, ly(380, .05), 80, .3);
    const tcF = { k: 'k1', dark: '#331a48', win: '#ffcc5c', flag: '#c0182e' };
    hills(ctx, P, { salt: 444, f: .14, fy: .08, base: 404, amp: 56, k1: .0045, k2: .014, p: 2.2,
      stops: [[0, '#3c1f55'], [.4, '#2e1846'], [1, '#26143a']], rim: 'rgba(255,140,90,0.75)', rimW: 2.5,
      trees: { sp: 60, prob: .55, kinds: ['dead', 'tower', 'dead'], sc0: .55, sc1: .85, sink: 12, spr: (k, v) => bgTree('castle', k, v, tcF) } });
    haze(ctx, P, ly(420, .08), 70, .22);
    const tcN = { k: 'k2', dark: '#1d0e2c', win: '#ffb84a', flag: '#c0182e' };
    hills(ctx, P, { salt: 545, f: .26, fy: .14, base: 438, amp: 42, k1: .0064, k2: .02, p: 5.1,
      stops: [[0, '#24112f'], [.5, '#1b0c26'], [1, '#14081d']], rim: 'rgba(255,110,90,0.6)', rimW: 2,
      trees: { sp: 40, prob: .6, kinds: ['dead', 'dead', 'tower'], sc0: .7, sc1: 1.05, sink: 14, spr: (k, v) => bgTree('castle', k, v, tcN) } });
    haze(ctx, P, ly(470, .14), 70, .16);
    bushLine(ctx, P, BUSH.castle);
    birds(ctx, '#1a0c24', 6, 313, true);
  };

  R.drawBackground = function (ctx) {
    const L = S.L; if (!L) return;
    const P = pal();
    prepTheme(P.id);
    const VW = V.VW, VH = V.VH;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // gök gradyanı + güneş halesi/ışınları (+ sabit uzak katman) tek önbellek tuvalinden
    farSky(ctx, P, VW, VH);
    const fn = BG[P.id] || BG.forest;
    fn(ctx, P, VW, VH);
    // pus perdesi: arka plan sakinleşir, oyun katmanı öne çıkar (bkz. VEIL)
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    drawVeil(ctx, P, VW, VH);
    ctx.restore();
  };

  /* =====================================================================
     ZEMİN: dokular (desen), bloklar, tema kapakları, yüzen platformlar
     ===================================================================== */
  const GP = {
    forest: { ol: '#2b170a', deep: '#1c0d05', deepA: .62, body: '#8c5a31', rim: 'rgba(255,214,160,0.28)' },
    candy: { ol: '#5a1838', deep: '#5e1a3a', deepA: .5, body: '#f2c07c', rim: 'rgba(255,255,255,0.4)' },
    snow: { ol: '#1c2f52', deep: '#0d1d42', deepA: .58, body: '#7898bd', rim: 'rgba(220,240,255,0.45)' },
    castle: { ol: '#120818', deep: '#07030c', deepA: .62, body: '#5d4b7c', rim: 'rgba(255,170,120,0.3)' }
  };
  const patCache = {};
  function wrapDo(W, H, x, y, m, fn) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const xx = x + dx * W, yy = y + dy * H;
      if (xx > -m && xx < W + m && yy > -m && yy < H + m) fn(xx, yy);
    }
  }
  function pattern(ctx, name, w, h, fn) {
    const k = Math.min(3, G.rs());
    const key = name + ':' + k;
    let p = patCache[key];
    if (p === undefined) {
      const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d'); g.scale(cw / w, ch / h);
      try { fn(g, w, h); } catch (e) { console.error('[desen ' + name + ']', e); }
      let pat = null;
      try { pat = ctx.createPattern(c, 'repeat'); } catch (e) { pat = null; }
      p = patCache[key] = pat ? { pat, sx: w / cw, sy: h / ch, w, h } : null;
    }
    return p;
  }
  const hasDM = typeof DOMMatrix === 'function';
  function setPat(p, ox, oy) {
    if (!p || !hasDM || !p.pat.setTransform) return;
    try { p.pat.setTransform(new DOMMatrix([p.sx, 0, 0, p.sy, ox, oy])); } catch (e) { /* eski tarayıcı */ }
  }

  /* ---- desen karoları ---- */
  function tileDirt(g, W, H) {
    const rnd = mrng(11);
    g.fillStyle = '#8c5a31'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * W, y = rnd() * H, rx = 6 + rnd() * 18, ry = 4 + rnd() * 9;
      const col = rnd() < .55 ? 'rgba(108,64,30,0.5)' : 'rgba(170,114,64,0.38)';
      wrapDo(W, H, x, y, rx + 2, (xx, yy) => E(g, xx, yy, rx, ry, col));
    }
    for (let i = 0; i < 110; i++) {
      const x = rnd() * W, y = rnd() * H, s = .8 + rnd() * 1.6, col = rnd() < .6 ? 'rgba(70,40,18,0.6)' : 'rgba(214,170,120,0.5)';
      g.fillStyle = col; g.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 3; i++) {
      const x = rnd() * W, y = rnd() * H, l = 24 + rnd() * 30, a = rnd() * PI;
      wrapDo(W, H, x, y, l, (xx, yy) => {
        g.lineCap = 'round';
        g.strokeStyle = '#5e3a1b'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + Math.cos(a) * l * .5 + 8, yy + Math.sin(a) * l * .5, xx + Math.cos(a) * l, yy + Math.sin(a) * l * .7); g.stroke();
        g.strokeStyle = 'rgba(190,140,90,0.45)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(xx, yy - 1); g.quadraticCurveTo(xx + Math.cos(a) * l * .5 + 8, yy + Math.sin(a) * l * .5 - 1, xx + Math.cos(a) * l, yy + Math.sin(a) * l * .7 - 1); g.stroke();
      });
    }
    for (let i = 0; i < 11; i++) {
      const x = rnd() * W, y = rnd() * H, rx = 3 + rnd() * 6, ry = 2.4 + rnd() * 3.6, gray = rnd() < .45;
      const c0 = gray ? '#a19a92' : '#b48558', c1 = gray ? '#d2ccc4' : '#dcb388', c2 = gray ? '#5e5850' : '#5a3a1e';
      wrapDo(W, H, x, y, rx + 3, (xx, yy) => {
        E(g, xx, yy + 1, rx + 1.3, ry + 1.3, c2);
        E(g, xx, yy, rx, ry, c0);
        E(g, xx - rx * .25, yy - ry * .38, rx * .5, ry * .34, c1);
      });
    }
  }
  function tileCake(g, W, H) {
    const rnd = mrng(22);
    g.fillStyle = '#f3c27d'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * W, y = rnd() * H, r = .8 + rnd() * 2.4;
      if (y > 36 && y < 62) continue;
      E(g, x, y, r * 1.3, r, rnd() < .7 ? 'rgba(206,140,70,0.55)' : 'rgba(255,232,180,0.7)');
    }
    // krema katmanı
    const cream = new Path2D();
    cream.moveTo(0, 41);
    for (let x = 0; x <= W; x += 4) cream.lineTo(x, 41 + Math.sin(x / W * TAU * 3) * 1.6);
    for (let x = W; x >= 0; x -= 4) cream.lineTo(x, 52 + Math.sin(x / W * TAU * 4 + 1) * 1.4);
    cream.closePath();
    g.fillStyle = '#fff6fb'; g.fill(cream);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 42.5, W, 1.4);
    // reçel
    const jam = new Path2D();
    jam.moveTo(0, 52);
    for (let x = 0; x <= W; x += 4) jam.lineTo(x, 52 + Math.sin(x / W * TAU * 4 + 1) * 1.4);
    for (let x = W; x >= 0; x -= 4) jam.lineTo(x, 58.5 + Math.sin(x / W * TAU * 2 + 2) * 1.2);
    jam.closePath();
    g.fillStyle = '#e2457a'; g.fill(jam);
    g.fillStyle = 'rgba(255,140,180,0.8)'; g.fillRect(0, 53.4, W, 1.2);
    g.fillStyle = 'rgba(120,30,40,0.25)'; g.fillRect(0, 59, W, 2);
    // çikolata parçacıkları
    for (let i = 0; i < 5; i++) {
      const x = rnd() * W, y = 66 + rnd() * 24;
      wrapDo(W, H, x, y, 6, (xx, yy) => { E(g, xx, yy, 3.6, 2.6, '#5a2c16', rnd() * 0); E(g, xx - 1, yy - 1, 1.2, .8, 'rgba(255,220,190,0.6)'); });
    }
  }
  function tileIceRock(g, W, H) {
    const rnd = mrng(33);
    g.fillStyle = '#3d5a84'; g.fillRect(0, 0, W, H);
    // koyu çatlak dokusu
    for (let i = 0; i < 40; i++) E(g, rnd() * W, rnd() * H, 3 + rnd() * 8, 2 + rnd() * 4, 'rgba(25,40,70,0.35)');
    // düzensiz kaya parçaları (farklı boylar, ızgarasız)
    const rocks = [];
    for (let tries = 0; tries < 400 && rocks.length < 17; tries++) {
      const x = rnd() * W, y = rnd() * H, r = 9 + rnd() * 15;
      let ok = true;
      for (const q of rocks) {
        let dx = Math.abs(q[0] - x), dy = Math.abs(q[1] - y);
        dx = Math.min(dx, W - dx); dy = Math.min(dy, H - dy);
        if (Math.hypot(dx, dy) < (q[2] + r) * .82) { ok = false; break; }
      }
      if (ok) rocks.push([x, y, r]);
    }
    const cols = ['#7f9fc6', '#7394bd', '#8aa9cd', '#6c8db6', '#94b2d3'];
    for (const q of rocks) {
      const n = 8, pts = [];
      for (let i = 0; i < n; i++) { const a = i / n * TAU + rnd() * .3, rr = q[2] * (.82 + rnd() * .3); pts.push([Math.cos(a) * rr * 1.18, Math.sin(a) * rr * .9]); }
      const col = cols[(rnd() * cols.length) | 0];
      wrapDo(W, H, q[0], q[1], q[2] * 1.3, (xx, yy) => {
        const p = new Path2D(); smoothClosed(p, pts.map(t => [t[0] + xx, t[1] + yy]));
        g.fillStyle = col; g.fill(p);
        g.save(); g.clip(p);
        g.fillStyle = 'rgba(214,236,255,0.55)'; g.beginPath(); g.ellipse(xx - q[2] * .25, yy - q[2] * .55, q[2] * .8, q[2] * .32, -.25, 0, TAU); g.fill();
        g.fillStyle = 'rgba(20,36,70,0.32)'; g.beginPath(); g.ellipse(xx + q[2] * .3, yy + q[2] * .7, q[2] * 1.1, q[2] * .4, -.15, 0, TAU); g.fill();
        g.restore();
        g.lineWidth = 1.4; g.strokeStyle = 'rgba(22,38,72,0.7)'; g.stroke(p);
      });
    }
    // buz damarları
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      let x = rnd() * W, y = rnd() * H;
      const pts = [[x, y]];
      for (let k = 0; k < 5; k++) { x += (rnd() - .5) * 18; y += 5 + rnd() * 8; pts.push([x, y]); }
      wrapDo(W, H, pts[0][0], pts[0][1] + 20, 50, (xx, yy) => {
        const dx = xx - pts[0][0], dy = yy - 20 - pts[0][1];
        g.strokeStyle = 'rgba(170,230,255,0.32)'; g.lineWidth = 1.2;
        g.beginPath(); pts.forEach((t, j) => j ? g.lineTo(t[0] + dx, t[1] + dy) : g.moveTo(t[0] + dx, t[1] + dy)); g.stroke();
      });
    }
    for (let i = 0; i < 50; i++) { g.fillStyle = rnd() < .7 ? 'rgba(255,255,255,0.65)' : 'rgba(180,230,255,0.8)'; g.fillRect(rnd() * W, rnd() * H, 1.3, 1.3); }
  }
  function tileBrick(g, W, H) {
    const rnd = mrng(44);
    g.fillStyle = '#271c38'; g.fillRect(0, 0, W, H);
    const cols = ['#5d4b7c', '#554372', '#64537f', '#4f3f69', '#5a477a'];
    for (let r = 0; r < 4; r++) {
      const off = (r % 2) * 24;
      for (let b = -1; b < 3; b++) {
        const x = b * 48 + off, y = r * 24;
        const idx = ((b + 3) % 2 + r * 2 + (b < 0 ? 1 : 0)) % cols.length;
        const ci = cols[(idx + (b === -1 || b === 1 ? 0 : 2)) % cols.length];
        const wob = (rnd() - .5) * 1;
        const p = new Path2D(); rrp(p, x + 2, y + 2 + wob * .3, 44, 20, 3);
        g.fillStyle = ci; g.fill(p);
        g.save(); g.clip(p);
        g.fillStyle = 'rgba(160,140,200,0.35)'; g.fillRect(x, y + 2, 48, 3);
        g.fillStyle = 'rgba(15,8,25,0.35)'; g.fillRect(x, y + 18, 48, 4);
        for (let k = 0; k < 6; k++) { g.fillStyle = rnd() < .5 ? 'rgba(20,10,30,0.3)' : 'rgba(200,180,230,0.18)'; g.fillRect(x + 4 + rnd() * 38, y + 5 + rnd() * 12, 1.5, 1.5); }
        g.restore();
      }
    }
    // çatlaklar
    g.strokeStyle = 'rgba(15,8,25,0.6)'; g.lineWidth = 1;
    for (let i = 0; i < 3; i++) { let x = 10 + rnd() * 76, y = 4 + rnd() * 80; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (rnd() - .5) * 8; y += 3 + rnd() * 3; g.lineTo(x, y); } g.stroke(); }
  }
  function tileWafer(g, W, H) {
    g.fillStyle = '#d9a058'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 12) for (let x = 0; x < W; x += 12) {
      g.fillStyle = '#efc07a'; g.fillRect(x + 2.5, y + 2.5, 7, 7);
      g.fillStyle = 'rgba(255,240,200,0.8)'; g.fillRect(x + 2.5, y + 2.5, 7, 1.4);
      g.fillStyle = 'rgba(140,80,30,0.35)'; g.fillRect(x + 2.5, y + 8.1, 7, 1.4);
    }
  }
  const PATS = {
    forest: ctx => pattern(ctx, 'dirt', 128, 128, tileDirt),
    candy: ctx => pattern(ctx, 'cake', 128, 96, tileCake),
    snow: ctx => pattern(ctx, 'icerock', 128, 128, tileIceRock),
    castle: ctx => pattern(ctx, 'brick', 96, 96, tileBrick)
  };

  /* ---- seviye geometrisi: aynı yükseklikteki bitişik blokları birleştir, komşuları bul ---- */
  let geoL = null, runs = [], floats = [], gaps = [], decSkip = new WeakSet(), hazZones = [], noBlade = [];
  const TALL_DEC = { tree: 1, tree2: 1, pine: 1, pine_big: 1, lollipop: 1, candycane: 1, gumtree: 1, banner: 1, torch: 1 };
  /** Çarpışmasız ama engel/eşya sanılabilecek ön dekorlar: arka geçişte (zemin kapağının arkasında, pus tonlu) çizilir */
  const FRONT_TO_BACK = { crate: 1, barrel: 1, crystal: 1 };
  /** Ön katmanda kalan parlak şeker süsleri: küçültülmüş, koyulaştırılmış, zemine gömülü (toplanabilir eşya sanılmasın) */
  const FRONT_SUBDUE = { gumdrop: 1, candy: 1, donut: 1 };
  /** Arka dekor çizim ölçeği (level.js R(.85,1.25) üretiyor; arka katman biraz küçük → derinlik) */
  const BACK_SC = .85;
  const inZ = (zs, a, b) => { for (let i = 0; i < zs.length; i++) if (b > zs[i][0] && a < zs[i][1]) return true; return false; };
  function buildGeo(L) {
    geoL = L; runs = []; floats = []; gaps = [];
    const sol = L.solids.filter(s => !s.float).sort((a, b) => a.x - b.x);
    for (const s of sol) {
      const last = runs[runs.length - 1];
      if (last && Math.abs(last.x + last.w - s.x) < 1.5 && Math.abs(last.y - s.y) < .5) last.w = s.x + s.w - last.x;
      else runs.push({ x: s.x, y: s.y, w: s.w, bottom: s.y + s.h, cap: null, feat: null });
    }
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], a = runs[i - 1], b = runs[i + 1];
      r.lN = a && Math.abs(a.x + a.w - r.x) < 1.5 ? a : null;
      r.rN = b && Math.abs(r.x + r.w - b.x) < 1.5 ? b : null;
      r.lE = !r.lN || r.lN.y > r.y;               // sol üst köşe açıkta mı
      r.rE = !r.rN || r.rN.y > r.y;
      r.lTo = r.lN ? (r.lN.y > r.y ? r.lN.y : null) : r.bottom;   // sol duvar konturu nereye kadar
      r.rTo = r.rN ? (r.rN.y > r.y ? r.rN.y : null) : r.bottom;
      r.seed = (hash((r.x | 0) * 7 + (r.y | 0) * 13 + (L.seed | 0)) * 1e9) | 0;
    }
    // çukurlar: bitişik olmayan iki blok arası (derinlik sisi, sıvı köpüğü, duvar gölgesi için)
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1], b = runs[i], x0 = a.x + a.w;
      if (b.x - x0 > 1.5) gaps.push({ x0, x1: b.x, yb: Math.max(a.y, b.y) });
    }
    decSkip = new WeakSet();
    const boxZ = L.boxes || [];
    const zones = hazZones = [];
    for (const k of L.crush) zones.push([k.x - 40, k.x + k.w + 40]);
    for (const k of L.spikes) zones.push([k.x - 30, k.x + k.w + 30]);
    for (const k of L.saws) zones.push([k.cx - 60, k.cx + 60]);
    for (const k of L.mush) zones.push([k.x - 20, k.x + k.w + 20]);
    for (const k of L.mud) zones.push([k.x - 10, k.x + k.w + 10]);
    for (const k of L.belts) zones.push([k.x - 14, k.x + k.w + 14]);
    for (const k of L.pads) zones.push([k.x - 10, k.x + k.w + 10]);
    for (const k of boxZ) zones.push([k.x - 30, k.x + k.w + 30]);
    // uzun arka dekor (ağaç, sancak, lolipop...): tacı tehlikenin/kutunun/yüzen platformun arkasına düşmesin
    const tall = [];
    for (const k of L.crush) tall.push([k.x - 40, k.x + k.w + 40]);
    for (const k of L.spikes) tall.push([k.x - 40, k.x + k.w + 40]);
    for (const k of L.saws) tall.push([k.cx - (k.r || 28) - 40, k.cx + (k.r || 28) + 40]);
    for (const k of L.mush) tall.push([k.x - 20, k.x + k.w + 20]);
    for (const k of L.pads) tall.push([k.x - 10, k.x + k.w + 10]);
    for (const k of boxZ) tall.push([k.x - 30, k.x + k.w + 30]);
    // ön dekor dikenlerden uzak dursun (diken ekrandaki en net okunan obje olmalı)
    const spikeZ = L.spikes.map(k => [k.x - 70, k.x + k.w + 70]);
    for (const d of L.decor) {
      const def = DEC[d.type], sc = d.s || 1;
      if (d.layer === 'back' && TALL_DEC[d.type]) {
        const half = (def ? def.w * .35 : 30) * sc * BACK_SC, top = d.y - (def ? def.h : 150) * sc * BACK_SC;
        let hit = inZ(tall, d.x - half, d.x + half);
        if (!hit) for (const s of L.solids) if (s.float && s.x < d.x + half && s.x + s.w > d.x - half && s.y > top && s.y < d.y) { hit = true; break; }
        if (hit) decSkip.add(d);
      } else if (d.layer === 'back' || FRONT_TO_BACK[d.type]) {
        const half = (def ? def.w * .35 : 30) * sc;
        if (inZ(zones, d.x - half, d.x + half)) decSkip.add(d);
      } else if (inZ(spikeZ, d.x - 12, d.x + 12)) decSkip.add(d);
    }
    // kapak üstü çimen/çiçek/serpinti çizilmeyecek yerler (çamurun, pedin, bandın içinden çimen çıkmasın)
    noBlade = [];
    for (const k of L.mud) noBlade.push([k.x - 8, k.x + k.w + 8, k.y, 1]);
    for (const k of L.pads) noBlade.push([k.x + k.w / 2 - 66, k.x + k.w / 2 + 66, k.y, 1]);
    for (const k of L.belts) noBlade.push([k.x - 10, k.x + k.w + 10, k.y, 1]);
    // dikenin çevresinde iri süs (çiçek, tutam) yok — yalnızca temel çimen dokusu kalır (yumuşak bölge)
    for (const k of L.spikes) noBlade.push([k.x - 40, k.x + k.w + 40, k.y + k.h, 0]);
    // köprü tabanı (tropik) yüzen platform gibi çizilmez: drawBridges halat + tahta çizer
    for (const s of L.solids) if (s.float && !s.bridge) floats.push({ x: s.x, y: s.y, w: s.w, h: s.h, seed: (hash((s.x | 0) * 3 + (s.y | 0) * 5 + 17) * 1e9) | 0, g: null });
    geoNew(L);
  }

  /* ---- kapak üreticileri (yerel koordinat: (0,0) = blok sol-üst, çarpışma yüzeyi y=0) ---- */
  function capForest(w, lE, rE, seed) {
    const rnd = mrng(seed);
    const T = 14;
    const x0 = lE ? -5 : -1, x1 = rE ? w + 5 : w + 1;
    const p = new Path2D();
    if (lE) { p.moveTo(x0, 6); p.quadraticCurveTo(x0, -2.5, x0 + 9, -2.5); } else p.moveTo(x0, -2.5);
    if (rE) { p.lineTo(x1 - 9, -2.5); p.quadraticCurveTo(x1, -2.5, x1, 6); p.quadraticCurveTo(x1 + 1, T + 9, x1 - 9, T + 6); }
    else { p.lineTo(x1, -2.5); p.lineTo(x1, T); }
    let x = rE ? x1 - 9 : x1;
    const xe = lE ? x0 + 9 : x0;
    while (x > xe + 2) {
      const sw = Math.min(x - xe, 8 + rnd() * 13), d = 3 + rnd() * 7, nx = x - sw;
      p.bezierCurveTo(x - sw * .08, T + d * 1.3, nx + sw * .08, T + d * 1.3, nx, T + (rnd() < .3 ? 2 : 0));
      x = nx;
    }
    if (lE) { p.lineTo(x0 + 9, T + 6); p.quadraticCurveTo(x0 - 1, T + 9, x0, 6); } else p.lineTo(x0, T);
    p.closePath();
    const hi = new Path2D(); rrp(hi, x0 + 7, -1.6, Math.max(2, x1 - x0 - 14), 3, 1.5);
    const dk = new Path2D();
    let xx = x0 + 6;
    while (xx < x1 - 12) { const l = 6 + rnd() * 18; rrp(dk, xx, T - 5 + rnd() * 2, l, 2.2, 1.1); xx += l + 6 + rnd() * 20; }
    return { main: p, hi, dk, T };
  }
  const CANDY_GLAZE = [
    { k: 'pink', c: [[0, '#ffc2df'], [.3, '#ff86bf'], [1, '#e9529a']], ol: '#7a1a4a' },
    { k: 'white', c: [[0, '#ffffff'], [.4, '#fff2f8'], [1, '#f1cde0']], ol: '#8a4a6a' },
    { k: 'choco', c: [[0, '#b0744a'], [.35, '#7f4628'], [1, '#56290f']], ol: '#2e1306' },
    { k: 'mint', c: [[0, '#d6fff3'], [.35, '#94ecd2'], [1, '#5ccaa8']], ol: '#1d6652' }
  ];
  function capCandy(w, lE, rE, seed) {
    const rnd = mrng(seed);
    const T = 11;
    const x0 = lE ? -4 : -1, x1 = rE ? w + 4 : w + 1;
    const p = new Path2D(), hi = new Path2D();
    if (lE) { p.moveTo(x0, 5); p.quadraticCurveTo(x0, -3, x0 + 8, -3); } else p.moveTo(x0, -3);
    if (rE) { p.lineTo(x1 - 8, -3); p.quadraticCurveTo(x1, -3, x1, 5); } else p.lineTo(x1, -3);
    p.lineTo(x1, T);
    let x = x1;
    while (x > x0 + 1) {
      const gap = 8 + rnd() * 30;
      const nx = Math.max(x0, x - gap);
      p.quadraticCurveTo((x + nx) / 2, T + 2.5 + rnd() * 2, nx, T);
      x = nx;
      if (x - x0 < 16) break;
      const dw = 7 + rnd() * 7, dl = 3 + rnd() * (rnd() < .3 ? 24 : 11), rr = dw / 2;
      const xb = x, xa = x - dw;
      p.lineTo(xb - .5, T + dl);
      p.arc(xb - rr, T + dl, rr - .5, 0, PI, false);
      p.lineTo(xa, T);
      circ(hi, xb - rr - rr * .3, T + dl - rr * .1, Math.max(.8, rr * .3));
      x = xa;
    }
    p.lineTo(x0, T);
    p.closePath();
    let xx = x0 + 6;
    while (xx < x1 - 10) { const l = 8 + rnd() * 40; rrp(hi, xx, -1, Math.min(l, x1 - 6 - xx), 2.6, 1.3); xx += l + 6 + rnd() * 26; }
    const r0 = hash(seed);
    const gi = r0 < .4 ? 0 : r0 < .65 ? 1 : r0 < .85 ? 2 : 3;
    return { main: p, hi, T, glaze: CANDY_GLAZE[gi] };
  }
  function capSnow(w, lE, rE, seed) {
    const rnd = mrng(seed);
    const T = 13;
    const x0 = lE ? -7 : -1, x1 = rE ? w + 7 : w + 1;
    const p = new Path2D();
    if (lE) { p.moveTo(x0, 8); p.bezierCurveTo(x0 - 1, -2, x0 + 6, -5, x0 + 14, -4); } else p.moveTo(x0, -3);
    let x = lE ? x0 + 14 : x0;
    const xr = rE ? x1 - 14 : x1;
    while (x < xr - 1) {
      const sw = Math.min(xr - x, 18 + rnd() * 30), up = 1 + rnd() * 3;
      p.quadraticCurveTo(x + sw / 2, -3.5 - up * 1.5, x + sw, -3.5);
      x += sw;
    }
    if (rE) { p.bezierCurveTo(x1 - 6, -5, x1 + 1, -2, x1, 8); p.bezierCurveTo(x1 + 1, T + 10, x1 - 12, T + 8, x1 - 16, T + 3); x = x1 - 16; }
    else { p.lineTo(x1, T); x = x1; }
    const xe = lE ? x0 + 16 : x0;
    while (x > xe + 1) {
      const sw = Math.min(x - xe, 14 + rnd() * 24), d = 2 + rnd() * 5;
      p.quadraticCurveTo(x - sw / 2, T + d * 2, x - sw, T);
      x -= sw;
    }
    if (lE) p.bezierCurveTo(x0 + 12, T + 8, x0 - 1, T + 10, x0, 8); else p.lineTo(x0, T);
    p.closePath();
    const ice = new Path2D(), iceHi = new Path2D();
    let ix = x0 + 10 + rnd() * 10;
    while (ix < x1 - 10) {
      const iw = 5 + rnd() * 6, il = 7 + rnd() * (rnd() < .3 ? 20 : 9);
      ice.moveTo(ix - iw / 2, T - 1); ice.quadraticCurveTo(ix - iw * .2, T + il * .55, ix, T + il); ice.quadraticCurveTo(ix + iw * .2, T + il * .55, ix + iw / 2, T - 1); ice.closePath();
      iceHi.moveTo(ix - iw * .18, T + 2); iceHi.lineTo(ix - iw * .04, T + il * .65);
      ix += 9 + rnd() * 30;
    }
    const sh = new Path2D();
    let sx = x0 + 10;
    while (sx < x1 - 16) { const l = 10 + rnd() * 30; rrp(sh, sx, T - 3.5, Math.min(l, x1 - 8 - sx), 2.5, 1.2); sx += l + 10 + rnd() * 24; }
    return { main: p, ice, iceHi, sh, T };
  }
  function capCastle(w, lE, rE, seed) {
    const rnd = mrng(seed);
    const T = 15;
    const x0 = lE ? -4 : -2, x1 = rE ? w + 4 : w + 2;
    const slabs = new Path2D(), hi = new Path2D(), cracks = new Path2D(), moss = new Path2D(), mossHi = new Path2D();
    let x = x0;
    while (x < x1 - 1) {
      let sw = 34 + rnd() * 34; if (x1 - x - sw < 22) sw = x1 - x;
      const top = -3.5 + (rnd() - .5) * 1.4;
      rrp(slabs, x + .8, top, sw - 1.6, T + 1 - top, 4);
      hi.moveTo(x + 5, top + 1.8); hi.lineTo(x + sw - 6, top + 1.8);
      if (rnd() < .35) {
        let cx = x + 8 + rnd() * (sw - 16), cy = top + 1;
        cracks.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) { cx += (rnd() - .5) * 7; cy += 2.5 + rnd() * 2.5; cracks.lineTo(cx, cy); }
      }
      if (rnd() < .42 && sw > 30) {
        const ma = x + 4 + rnd() * 6, mb = x + sw - 4 - rnd() * 8;
        moss.moveTo(ma, T - 4);
        let mx = ma;
        while (mx < mb - 2) {
          const s = Math.min(mb - mx, 5 + rnd() * 8), d = rnd() < .25 ? 6 + rnd() * 9 : 2 + rnd() * 3;
          moss.quadraticCurveTo(mx + s / 2, T + d * 1.6, mx + s, T - 1);
          mx += s;
        }
        moss.lineTo(mb, T - 4); moss.closePath();
        mossHi.moveTo(ma + 2, T - 2.5); mossHi.lineTo(mb - 2, T - 2.5);
      }
      x += sw;
    }
    return { main: slabs, hi, cracks, moss, mossHi, T };
  }
  const CAPS = { forest: capForest, candy: capCandy, snow: capSnow, castle: capCastle };

  /* ---- kapak çizimleri ---- */
  /** Zemin/platform üst kenarı kontur kalınlığı: oyun katmanının sınırı telefonda da keskin okunsun (eskiden 2.4-2.6) */
  const CAP_LW = 3.2;
  const DRAWCAP = {
    forest(ctx, c) {
      ctx.save(); ctx.translate(0, 4); ctx.fillStyle = 'rgba(25,12,0,0.32)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'forest:cap', g => LG(g, 0, -3, 0, 26, [[0, '#b6f06a'], [.2, '#88d34c'], [.6, '#5dae38'], [1, '#3c8526']]));
      ctx.fill(c.main);
      ctx.fillStyle = 'rgba(38,92,22,0.45)'; ctx.fill(c.dk);
      ctx.fillStyle = 'rgba(236,255,180,0.8)'; ctx.fill(c.hi);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#1d4710'; ctx.stroke(c.main);
    },
    candy(ctx, c) {
      ctx.save(); ctx.translate(0, 3.5); ctx.fillStyle = 'rgba(90,20,40,0.25)'; ctx.fill(c.main); ctx.restore();
      const gz = c.glaze;
      ctx.fillStyle = cg(ctx, 'candy:glz:' + gz.k, g => LG(g, 0, -3, 0, 30, gz.c));
      ctx.fill(c.main);
      ctx.fillStyle = gz.k === 'choco' ? 'rgba(255,220,190,0.55)' : 'rgba(255,255,255,0.85)'; ctx.fill(c.hi);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = gz.ol; ctx.stroke(c.main);
    },
    snow(ctx, c) {
      ctx.fillStyle = cg(ctx, 'snow:ice', g => LG(g, 0, 10, 0, 40, [[0, '#ffffff'], [.4, '#c6ecff'], [1, '#7cc6ef']]));
      ctx.fill(c.ice);
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#2a4c7a'; ctx.lineJoin = 'round'; ctx.stroke(c.ice);
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineCap = 'round'; ctx.stroke(c.iceHi);
      ctx.save(); ctx.translate(0, 3); ctx.fillStyle = 'rgba(10,30,70,0.25)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'snow:cap', g => LG(g, 0, -6, 0, 24, [[0, '#ffffff'], [.45, '#f2f8ff'], [1, '#bcd6f2']]));
      ctx.fill(c.main);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#2a4572'; ctx.stroke(c.main);
    },
    castle(ctx, c) {
      ctx.save(); ctx.translate(0, 4); ctx.fillStyle = 'rgba(5,0,10,0.4)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'castle:cap', g => LG(g, 0, -4, 0, 16, [[0, '#b3aacb'], [.35, '#8f86ad'], [1, '#625a83']]));
      ctx.fill(c.main);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(232,226,250,0.75)'; ctx.stroke(c.hi);
      ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(30,18,44,0.75)'; ctx.stroke(c.cracks);
      ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#140a1e'; ctx.stroke(c.main);
      ctx.fillStyle = cg(ctx, 'castle:moss', g => LG(g, 0, 8, 0, 30, [[0, '#86b84a'], [1, '#3f6e24']]));
      ctx.fill(c.moss);
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#1f3a10'; ctx.stroke(c.moss);
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(200,240,140,0.6)'; ctx.stroke(c.mossHi);
    }
  };

  /* ---- gövdeye gömülü süsler (taşlar, fosiller, şekerler, ızgaralar) ---- */
  function featSpr(id, v) {
    if (FEAT_NEW[id]) return FEAT_NEW[id](v);
    return spr('ft:' + id + ':' + v, 40, 32, 20, 16, g => {
      const ol = PAL[id].ol;
      if (id === 'forest') {
        if (v === 0) { const p = new Path2D(); smoothClosed(p, [[-14, 2], [-10, -8], [2, -11], [13, -6], [15, 4], [6, 10], [-8, 9]]); olFill(g, p, '#9d978f', '#3e2a18', 3); g.save(); g.clip(p); E(g, 3, -6, 10, 4, '#cfc9c0'); E(g, -2, 7, 12, 4, '#6f6a62'); g.restore(); }
        else if (v === 1) {
          const p = new Path2D(); p.moveTo(-12, -2); p.lineTo(10, -2); p.lineTo(10, 2); p.lineTo(-12, 2); p.closePath();
          circ(p, -13, -3, 3.4); circ(p, -13, 3, 3.4); circ(p, 12, -3, 3.4); circ(p, 12, 3, 3.4);
          g.save(); g.rotate(-.35); olFill(g, p, '#efe6cf', '#4a3420', 3); g.fillStyle = 'rgba(160,140,100,0.5)'; g.fillRect(-10, 0, 18, 2); g.restore();
        } else if (v === 2) {
          // ammonit fosili: kapalı sarmal kabuk + radyal kaburgalar (eski üç açık yay Wi-Fi simgesine benziyordu)
          const A1 = TAU * 1.6, rg = a => 1.4 + 9.6 * a / A1;      // sarmal dikiş yarıçapı (içten dışa ~1.6 tur)
          const P2 = (a, r) => [Math.cos(a) * r * 1.08, Math.sin(a) * r];
          const shell = new Path2D(); shell.ellipse(0, 0, 11.9, 11, 0, 0, TAU);
          g.fillStyle = '#b8a27a'; g.fill(shell);
          g.save(); g.clip(shell); E(g, -3, -4, 8, 5, 'rgba(255,240,205,0.45)'); E(g, 3, 6, 10, 5, 'rgba(90,64,34,0.3)'); g.restore();
          g.lineJoin = 'round'; g.lineCap = 'round';
          // kaburgalar: dış kıvrımda dikişten dikişe kısa radyal çizgiler
          g.lineWidth = 1.2; g.strokeStyle = rgba('#4a3420', .55);
          for (let i = 0; i < 8; i++) {
            const a = TAU * .62 + i * (A1 - TAU * .62 - .25) / 7;
            const p0 = P2(a, rg(a - TAU) + .9), p1 = P2(a, Math.min(10.2, rg(a) - .8));
            g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
          }
          // sarmal dikiş
          g.beginPath();
          for (let i = 0; i <= 40; i++) { const a = A1 * i / 40, p = P2(a, Math.min(11, rg(a))); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
          g.lineWidth = 1.6; g.strokeStyle = rgba('#4a3420', .85); g.stroke();
          g.lineWidth = 2; g.strokeStyle = '#4a3420'; g.stroke(shell);
          E(g, -5.5, -5.8, 1.7, 1.1, 'rgba(255,248,225,0.9)', -.6);
        } else { for (let i = 0; i < 4; i++) { const x = -10 + i * 7, y = (i % 2) * 5 - 2; E(g, x, y + 1, 5, 4, '#3e2a18'); E(g, x, y, 4, 3, i % 2 ? '#a89f94' : '#b8895c'); E(g, x - 1, y - 1, 2, 1.2, '#e2d6c4'); } }
      } else if (id === 'candy') {
        if (v === 0) { const p = new Path2D(); p.moveTo(0, -9); p.quadraticCurveTo(10, 4, 9, 7); p.lineTo(-9, 7); p.quadraticCurveTo(-10, 4, 0, -9); p.closePath(); olFill(g, p, '#5c2c14', '#2a1006', 2.4); E(g, -2, -1, 2.4, 1.6, 'rgba(255,220,190,0.6)'); }
        else if (v === 1) { const p = new Path2D(); p.moveTo(0, 8); p.bezierCurveTo(-14, -2, -8, -12, 0, -5); p.bezierCurveTo(8, -12, 14, -2, 0, 8); p.closePath(); olFill(g, p, '#ff4f7f', '#7a1030', 2.6); E(g, -4, -4, 2.6, 1.6, 'rgba(255,255,255,0.75)'); }
        else if (v === 2) { const p = new Path2D(); circ(p, 0, 0, 9); olFill(g, p, '#ffd36b', '#8a5a10', 2.4); g.strokeStyle = '#ff6fa8'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 5, 0, 4.5); g.stroke(); E(g, -3, -4, 2.2, 1.3, 'rgba(255,255,255,0.8)'); }
        else { const cs = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#c08cff']; for (let i = 0; i < 6; i++) { g.save(); g.translate(-11 + i * 4.4, (i % 3) * 3 - 3); g.rotate(i * 1.1); g.fillStyle = cs[i % 5]; g.beginPath(); rrp(g, -4, -1.2, 8, 2.4, 1.2); g.fill(); g.restore(); } }
      } else if (id === 'snow') {
        if (v === 0) { const p = new Path2D(); p.moveTo(-8, 8); p.lineTo(-10, -2); p.lineTo(-4, -11); p.lineTo(2, -4); p.lineTo(6, -12); p.lineTo(11, -1); p.lineTo(8, 8); p.closePath(); olFill(g, p, '#9fe2ff', '#23507e', 2.4); g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.moveTo(-6, 4); g.lineTo(-7, -2); g.lineTo(-4, -8); g.lineTo(-3, 2); g.fill(); }
        else if (v === 1) {
          const p = new Path2D(); p.moveTo(-12, 0); p.quadraticCurveTo(-2, -9, 8, -1); p.lineTo(14, -6); p.lineTo(13, 6); p.lineTo(8, 1); p.quadraticCurveTo(-2, 9, -12, 0); p.closePath();
          olFill(g, p, '#ffb36b', '#6a3a10', 2.2); E(g, -7, -1, 1.4, 1.4, '#20140a'); E(g, -1, -3, 4, 1.4, 'rgba(255,255,255,0.5)');
          g.fillStyle = 'rgba(190,235,255,0.45)'; g.beginPath(); rrp(g, -16, -10, 34, 20, 4); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2; g.stroke();
        } else if (v === 2) { const p = new Path2D(); smoothClosed(p, [[-13, 4], [-9, -7], [3, -10], [13, -3], [12, 6], [-4, 9]]); olFill(g, p, '#5b6f8e', '#1c2f52', 2.4); E(g, 2, -5, 7, 3, '#8ea2c0'); }
        else { g.strokeStyle = '#e8f6ff'; g.lineWidth = 1.8; g.lineCap = 'round'; for (let i = 0; i < 3; i++) { const a = i * PI / 3; g.beginPath(); g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); g.lineTo(-Math.cos(a) * 9, -Math.sin(a) * 9); g.stroke(); } }
      } else {
        if (v === 0) {
          const p = new Path2D(); p.moveTo(-11, 8); p.lineTo(-11, -4); p.arc(0, -4, 11, PI, 0); p.lineTo(11, 8); p.closePath();
          olFill(g, p, '#140a1c', '#08040c', 3);
          g.save(); g.clip(p); g.fillStyle = RG(g, 0, 2, 1, 0, 2, 12, [[0, 'rgba(255,170,70,0.85)'], [1, 'rgba(255,90,40,0.1)']]); g.fillRect(-12, -16, 24, 26); g.restore();
          g.strokeStyle = '#3a3048'; g.lineWidth = 2.2; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * 5, -12); g.lineTo(i * 5, 8); g.stroke(); }
          g.strokeStyle = '#6a5e80'; g.lineWidth = 1; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * 5 - .7, -11); g.lineTo(i * 5 - .7, 7); g.stroke(); }
        } else if (v === 1) {
          const p = new Path2D(); p.moveTo(-8, 4); p.bezierCurveTo(-11, -12, 11, -12, 8, 4); p.lineTo(5, 9); p.lineTo(-5, 9); p.closePath();
          olFill(g, p, '#d8d0c0', '#2a2030', 2.4); E(g, -3.5, -1, 2.6, 3, '#2a2030'); E(g, 3.5, -1, 2.6, 3, '#2a2030'); g.fillStyle = '#2a2030'; g.fillRect(-.8, 3, 1.6, 2.5);
        } else if (v === 2) { g.strokeStyle = '#2a2236'; g.lineWidth = 5; g.beginPath(); g.arc(0, 2, 8, 0, TAU); g.stroke(); g.strokeStyle = '#7a6e8e'; g.lineWidth = 2; g.beginPath(); g.arc(0, 2, 8, 3.6, 5.4); g.stroke(); g.fillStyle = '#2a2236'; g.fillRect(-4, -10, 8, 6); }
        else { const p = new Path2D(); rrp(p, -12, -7, 24, 14, 2); olFill(g, p, '#3e3054', '#120818', 2); g.strokeStyle = 'rgba(10,4,16,0.8)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-6, -7); g.lineTo(-2, 0); g.lineTo(-5, 7); g.moveTo(-2, 0); g.lineTo(6, 2); g.stroke(); }
      }
    });
  }
  function buildFeat(r, id) {
    const rnd = mrng(r.seed + 99);
    const f = [];
    let x = 30 + rnd() * 80;
    while (x < r.w - 24) {
      if (rnd() < .7) f.push([x, 34 + rnd() * 120, (rnd() * 4) | 0, .8 + rnd() * .5, rnd() < .5]);
      x += 90 + rnd() * 170;
    }
    return f;
  }

  /* ---- yüzen platform geometrisi (yerel: (0,0) = platform sol-üst) ---- */
  function buildFloat(f, id) {
    const rnd = mrng(f.seed);
    const w = f.w, o = { cap: CAPS[id](w, true, true, f.seed), under: new Path2D(), extra: null, D: 30 };
    if (FLOAT_NEW[id]) { FLOAT_NEW[id](f, o, rnd); return o; }
    if (id === 'forest' || id === 'tropic') {
      const D = 24 + Math.min(62, w * .25);
      const pts = [[w - 2, 3]];
      const n = Math.max(4, Math.round(w / 20));
      for (let i = 1; i < n; i++) {
        const t = i / n, x = w - 2 - (w - 4) * t;
        const prof = Math.pow(Math.sin(t * PI), .7);
        pts.push([x + (rnd() - .5) * 5, 6 + prof * D + (rnd() - .5) * 7 + (Math.abs(t - .5) < .08 ? 10 : 0)]);
      }
      pts.push([2, 3]);
      const p = o.under; p.moveTo(0, 0); p.lineTo(w, 0); smoothOpen(p, pts, false); p.closePath();
      const roots = new Path2D(), leaves = [];
      for (let i = 0; i < 2 + w / 70; i++) {
        const t = .2 + rnd() * .6, x = w * t, by = 6 + Math.pow(Math.sin(t * PI), .7) * D - 4, l = 10 + rnd() * 22;
        roots.moveTo(x, by); roots.quadraticCurveTo(x + (rnd() - .5) * 14, by + l * .6, x + (rnd() - .5) * 8, by + l);
        if (rnd() < .6) leaves.push([x + (rnd() - .5) * 6, by + l * (.5 + rnd() * .4)]);
      }
      o.extra = { roots, leaves };
      o.D = D + 12;
    } else if (id === 'candy') {
      rrp(o.under, 0, 1, w, 27, 6);
      const cream = new Path2D();
      cream.moveTo(1, 12); for (let x = 1; x <= w - 1; x += 6) cream.lineTo(x, 12 + Math.sin(x * .3) * 1.2);
      for (let x = w - 1; x >= 1; x -= 6) cream.lineTo(x, 17 + Math.sin(x * .25 + 1) * 1.2);
      cream.closePath();
      o.extra = { cream };
      o.D = 30;
    } else if (id === 'snow') {
      rrp(o.under, 0, 0, w, 30, 6);
      const fac = new Path2D();
      for (let x = 10 + rnd() * 20; x < w - 16; x += 26 + rnd() * 34) { fac.moveTo(x, 4); fac.lineTo(x + 8 + rnd() * 6, 27); fac.lineTo(x + 18 + rnd() * 6, 27); fac.lineTo(x + 9, 4); fac.closePath(); }
      const ice = new Path2D(), iceHi = new Path2D();
      for (let x = 8 + rnd() * 10; x < w - 8; x += 12 + rnd() * 26) {
        const iw = 5 + rnd() * 5, il = 6 + rnd() * 16;
        ice.moveTo(x - iw / 2, 28); ice.quadraticCurveTo(x - iw * .2, 28 + il * .55, x, 28 + il); ice.quadraticCurveTo(x + iw * .2, 28 + il * .55, x + iw / 2, 28); ice.closePath();
        iceHi.moveTo(x - iw * .18, 30); iceHi.lineTo(x - iw * .04, 28 + il * .6);
      }
      o.extra = { fac, ice, iceHi };
      o.D = 34;
    } else {
      const p = o.under;
      p.moveTo(2, 0); p.lineTo(w - 2, 0); p.lineTo(w - 4, 24); p.lineTo(w - 16, 24); p.lineTo(w - 18, 36);
      p.lineTo(w / 2 + 16, 36); p.quadraticCurveTo(w / 2 + 12, 50, w / 2, 50); p.quadraticCurveTo(w / 2 - 12, 50, w / 2 - 16, 36);
      p.lineTo(18, 36); p.lineTo(16, 24); p.lineTo(4, 24); p.closePath();
      const lines = new Path2D();
      lines.moveTo(5, 24); lines.lineTo(w - 5, 24); lines.moveTo(19, 36); lines.lineTo(w - 19, 36);
      for (let x = 30 + rnd() * 20; x < w - 30; x += 40 + rnd() * 16) { lines.moveTo(x, 24); lines.lineTo(x, 36); }
      lines.moveTo(w / 2 - 6, 36); lines.lineTo(w / 2 - 6, 49); lines.moveTo(w / 2 + 6, 36); lines.lineTo(w / 2 + 6, 49);
      o.extra = { lines };
      o.D = 50;
    }
    return o;
  }

  /* ---- ana zemin çizimi ---- */
  function drawGround(ctx, P, vx0, vx1, vy0, vy1) {
    const id = P.id, gp = GP[id];
    const pt = PATS[id](ctx);
    const depth = cg(ctx, id + ':depth', g => LG(g, 0, 0, 0, 330, [[0, rgba(gp.deep, 0)], [.1, rgba(gp.deep, .04)], [.55, rgba(gp.deep, gp.deepA * .7)], [1, rgba(gp.deep, gp.deepA)]]));
    const side = cg(ctx, id + ':side', g => LG(g, 0, 0, 22, 0, [[0, rgba(gp.deep, .55)], [1, rgba(gp.deep, 0)]]));
    const ao = cg(ctx, id + ':ao', g => LG(g, 0, 0, 34, 0, [[0, rgba(gp.deep, .5)], [1, rgba(gp.deep, 0)]]));
    const yMax = vy1 + 4;
    const vis = [];
    for (const r of runs) if (r.x < vx1 + 10 && r.x + r.w > vx0 - 10 && r.y < yMax) vis.push(r);
    // 1) gövdeler
    for (const r of vis) {
      const x0 = Math.max(r.x, vx0 - 12), x1 = Math.min(r.x + r.w, vx1 + 12);
      const yB = Math.min(r.bottom, yMax);
      if (yB <= r.y + 4) continue;
      const lx0 = x0 - r.x, lw = x1 - x0, lh = yB - r.y;
      ctx.save();
      ctx.translate(r.x, r.y);
      if (pt) { if (id === 'candy') setPat(pt, 0, 2); else setPat(pt, -(r.x % pt.w), -(r.y % pt.h)); ctx.fillStyle = pt.pat; }
      else ctx.fillStyle = gp.body;
      ctx.fillRect(lx0, 4, lw, lh - 4);
      if (!r.feat) r.feat = buildFeat(r, id);
      for (const f of r.feat) {
        if (f[0] < lx0 - 24 || f[0] > lx0 + lw + 24 || r.y + f[1] > yMax + 20) continue;
        drawS(ctx, featSpr(id, f[2]), f[0], f[1], f[3], f[4]);
      }
      ctx.fillStyle = depth; ctx.fillRect(lx0, 0, lw, Math.min(330, lh));
      if (lh > 330) { ctx.fillStyle = rgba(gp.deep, gp.deepA); ctx.fillRect(lx0, 330, lw, lh - 330); }
      // açık duvarlarda iç gölge, iç köşede ortam gölgesi
      if (r.lTo != null && r.x >= x0 - 1) { ctx.fillStyle = side; ctx.fillRect(0, 0, 22, Math.min(lh, r.lTo - r.y)); }
      else if (r.lN && r.x >= x0 - 1) { ctx.fillStyle = ao; ctx.fillRect(0, 0, 34, lh); }
      if (r.x + r.w <= x1 + 1) {
        ctx.save(); ctx.translate(r.w, 0); ctx.scale(-1, 1);
        if (r.rTo != null) { ctx.fillStyle = side; ctx.globalAlpha = .7; ctx.fillRect(0, 0, 22, Math.min(lh, r.rTo - r.y)); }
        else if (r.rN) { ctx.fillStyle = ao; ctx.fillRect(0, 0, 34, lh); }
        ctx.restore();
      }
      ctx.restore();
    }
    // 2) kapaklar
    const drawCap = DRAWCAP[id];
    for (const r of vis) {
      if (!r.cap) r.cap = CAPS[id](r.w, r.lE, r.rE, r.seed);
      ctx.save(); ctx.translate(r.x, r.y);
      drawCap(ctx, r.cap);
      ctx.restore();
    }
    // 3) açık duvar konturları + kenar ışığı
    ctx.lineCap = 'butt';
    for (const r of vis) {
      const T = r.cap ? r.cap.T : 12;
      if (r.lTo != null && r.x > vx0 - 8) {
        const y1 = Math.min(r.lTo, yMax);
        if (y1 > r.y + T) {
          ctx.strokeStyle = gp.ol; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(r.x, r.y + T - 2); ctx.lineTo(r.x, y1 + (r.lN ? 2 : 0)); ctx.stroke();
        }
      }
      if (r.rTo != null && r.x + r.w < vx1 + 8) {
        const y1 = Math.min(r.rTo, yMax);
        if (y1 > r.y + T) {
          ctx.strokeStyle = gp.rim; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r.x + r.w - 3.2, r.y + T + 4); ctx.lineTo(r.x + r.w - 3.2, y1 - 2); ctx.stroke();
          ctx.strokeStyle = gp.ol; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(r.x + r.w, r.y + T - 2); ctx.lineTo(r.x + r.w, y1 + (r.rN ? 2 : 0)); ctx.stroke();
        }
      }
    }
    // 4) kapak üstü ayrıntılar
    for (const r of vis) capTop(ctx, id, r.x, r.y, r.w, Math.max(r.x, vx0 - 20), Math.min(r.x + r.w, vx1 + 20), r.seed);
  }

  /* ---- kapak üstü ayrıntılar: çimen yaprakları, çiçekler, şeker serpintisi, kar parıltısı, yosun ---- */
  function bladeSpr(v) {
    return spr('blade' + v, 30, 18, 15, 14, g => {
      const rnd = mrng(500 + v * 7);
      const n = 5 + v;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const x = -11 + (22 / (n - 1)) * i + (rnd() - .5) * 3, hgt = 6 + rnd() * 7 + (i === (n >> 1) ? 3 : 0), lean = (rnd() - .5) * 6;
          const p = new Path2D(); p.moveTo(x - 2.2, 2); p.quadraticCurveTo(x - 1 + lean * .3, -hgt * .5, x + lean, -hgt); p.quadraticCurveTo(x + 1 + lean * .3, -hgt * .5, x + 2.2, 2); p.closePath();
          if (pass === 0) { g.lineWidth = 1.9; g.strokeStyle = '#2a5c18'; g.lineJoin = 'round'; g.stroke(p); }
          else { g.fillStyle = i % 2 ? '#8fd64e' : '#a8e85e'; g.fill(p); g.fillStyle = 'rgba(230,255,170,0.7)'; g.fillRect(x - .4 + lean * .3, -hgt * .6, .8, hgt * .4); }
        }
      }
      g.fillStyle = '#88d34c'; g.fillRect(-13, 0, 26, 4);
    });
  }
  function flowerSpr(v) {
    return spr('cflow' + v, 16, 22, 8, 18, g => {
      const cols = ['#ff5a6e', '#ffd84a', '#ffffff', '#b78cff', '#6fc8ff'];
      g.strokeStyle = '#2d6a1c'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(1.5, -5, 0, -10); g.stroke();
      E(g, 2.5, -4, 2.6, 1.2, '#4ea52e', -.5);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; E(g, Math.cos(a) * 3, -11 + Math.sin(a) * 3, 2.4, 2.4, '#3a2a1a'); }
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; E(g, Math.cos(a) * 3, -11 + Math.sin(a) * 3, 1.9, 1.9, cols[v % 5]); }
      E(g, 0, -11, 1.7, 1.7, v % 5 === 1 ? '#ff8a2a' : '#ffd23f');
    });
  }
  function sprinkleSpr(v) {
    return spr('sprk' + v, 12, 12, 6, 6, g => {
      const cs = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#c08cff', '#ffffff', '#ff9a3c'];
      g.rotate(v * .9 + .3);
      g.fillStyle = 'rgba(80,20,40,0.35)'; g.beginPath(); rrp(g, -3.6, -.6, 7.2, 2.6, 1.3); g.fill();
      g.fillStyle = cs[v % cs.length]; g.beginPath(); rrp(g, -3.5, -1.3, 7, 2.6, 1.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(-2.5, -1, 4, .8);
    });
  }
  function tuftSpr(id, v) {
    return spr('tuft:' + id + v, 26, 16, 13, 12, g => {
      const rnd = mrng(600 + v);
      if (id === 'castle') {
        for (let i = 0; i < 6; i++) {
          const x = -8 + i * 3.2, hgt = 4 + rnd() * 7;
          g.strokeStyle = i % 2 ? '#6c9a3a' : '#88b84a'; g.lineWidth = 1.6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, 2); g.quadraticCurveTo(x + (rnd() - .5) * 4, -hgt * .5, x + (rnd() - .5) * 5, -hgt); g.stroke();
        }
        E(g, 0, 1.5, 9, 2.5, '#4e7a2a');
      } else if (id === 'snow') {
        const p = new Path2D(); p.moveTo(-9, 2); p.quadraticCurveTo(-7, -5, 0, -5); p.quadraticCurveTo(8, -5, 9, 2); p.closePath();
        olFill(g, p, '#ffffff', '#2a4572', 2);
        E(g, -2, -3, 4, 1.2, 'rgba(255,255,255,1)');
      }
    });
  }
  /** x bir "çimen yok" bölgesinde mi (yalnızca bu yüzeyin hizasındaki nesneler: ry ile) */
  function bladeBlocked(x, ry, soft) {
    for (let i = 0; i < noBlade.length; i++) { const z = noBlade[i]; if ((z[3] || soft) && x > z[0] && x < z[1] && Math.abs(z[2] - ry) < 3) return true; }
    return false;
  }
  function capTop(ctx, id, rx, ry, rw, x0, x1, seed) {
    if (x1 <= x0) return;
    // bu yüzeyde çamur/ped/bant var mı (yoksa her yaprak için bölge taraması yapma)
    let nb = false;
    for (let i = 0; i < noBlade.length; i++) { const z = noBlade[i]; if (z[1] > x0 && z[0] < x1 && Math.abs(z[2] - ry) < 3) { nb = true; break; } }
    if (CAPTOP_NEW[id]) { CAPTOP_NEW[id](ctx, rx, ry, rw, x0, x1, nb); return; }
    if (id === 'forest') {
      const st = 13;
      const i0 = Math.ceil(x0 / st), i1 = Math.floor(x1 / st);
      for (let i = i0; i <= i1; i++) {
        const h = hs(i, 1717), x = i * st + h * 5;
        if (x < rx + 6 || x > rx + rw - 6) continue;
        if (nb && bladeBlocked(x, ry)) continue;
        drawS(ctx, bladeSpr((h * 3) | 0), x, ry - 1.5, .8 + h * .35, h > .5);
      }
      const fs = 64;
      for (let i = Math.ceil(x0 / fs); i <= Math.floor(x1 / fs); i++) {
        const h = hs(i, 1818); if (h > .38) continue;
        const x = i * fs + h * 40; if (x < rx + 10 || x > rx + rw - 10) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        drawS(ctx, flowerSpr((h * 13) | 0), x, ry - 1, .9 + h);
      }
    } else if (id === 'candy') {
      const st = 9;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 2727); if (h > .55) continue;
        const x = i * st + h * 5; if (x < rx + 4 || x > rx + rw - 4) continue;
        if (nb && bladeBlocked(x, ry)) continue;
        drawS(ctx, sprinkleSpr((h * 7 * 3) | 0), x, ry + 1.5 + hs(i, 2728) * 6, .9);
      }
    } else if (id === 'snow') {
      const st = 70;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 3737); const x = i * st + h * 40; if (x < rx + 8 || x > rx + rw - 8) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        if (h < .45) drawS(ctx, tuftSpr('snow', 0), x, ry - 2, .7 + h);
        const tw = Math.sin(tk * 2.5 + h * 30);
        if (tw > .55) {
          ctx.globalAlpha = (tw - .55) * 2.2;
          drawS(ctx, sparkleSpr(), x + 14, ry + 2 + h * 4, .5 + (tw - .55));
          ctx.globalAlpha = 1;
        }
      }
    } else {
      const st = 58;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 4747); if (h > .4) continue;
        const x = i * st + h * 30; if (x < rx + 8 || x > rx + rw - 8) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        drawS(ctx, tuftSpr('castle', (h * 5) | 0), x, ry - 2.5, .8 + h * .6);
      }
    }
  }
  function sparkleSpr() {
    return spr('sparkle', 24, 24, 12, 12, g => {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); sparkPath(g, 0, 0, 11); g.fill();
    });
  }

  /* ---- yüzen platform çizimi ---- */
  function drawFloats(ctx, P, vx0, vx1, vy0, vy1) {
    const id = P.id, gp = GP[id];
    for (const f of floats) {
      if (f.x > vx1 + 10 || f.x + f.w < vx0 - 10 || f.y > vy1 + 10 || f.y + 80 < vy0) continue;
      if (!f.g) f.g = buildFloat(f, id);
      const o = f.g;
      ctx.save(); ctx.translate(f.x, f.y);
      // gölge (aşağıda zemin varsa yumuşak)
      if (DFLOAT_NEW[id]) DFLOAT_NEW[id](ctx, f, o, gp);
      else if (id === 'forest') {
        const pt = PATS.forest(ctx);
        if (pt) { setPat(pt, -(f.x % 128), -(f.y % 128)); ctx.fillStyle = pt.pat; } else ctx.fillStyle = gp.body;
        ctx.fill(o.under);
        ctx.fillStyle = cg(ctx, 'forest:fdepth', g => LG(g, 0, 0, 0, 90, [[0, 'rgba(28,13,5,0.05)'], [.6, 'rgba(28,13,5,0.45)'], [1, 'rgba(28,13,5,0.7)']]));
        ctx.fill(o.under);
        ctx.save(); ctx.clip(o.under); ctx.scale(f.w, 1);
        ctx.fillStyle = cg(ctx, 'forest:flight', g => LG(g, 0, 0, 1, 0, [[0, 'rgba(20,8,0,0.18)'], [.45, 'rgba(255,220,170,0)'], [1, 'rgba(255,220,170,0.26)']]));
        ctx.fillRect(0, -4, 1, o.D + 30); ctx.restore();
        ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = gp.ol; ctx.stroke(o.under);
        ctx.lineCap = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#4a2d14'; ctx.stroke(o.extra.roots);
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(200,150,100,0.5)'; ctx.stroke(o.extra.roots);
        for (const l of o.extra.leaves) { E(ctx, l[0] + 2, l[1], 3.4, 1.8, '#1d4710', .5); E(ctx, l[0] + 2, l[1] - .4, 2.6, 1.2, '#6cc04a', .5); }
      } else if (id === 'candy') {
        const pt = pattern(ctx, 'wafer', 24, 24, tileWafer);
        if (pt) { setPat(pt, 0, 2); ctx.fillStyle = pt.pat; } else ctx.fillStyle = '#e7b56c';
        ctx.fill(o.under);
        ctx.fillStyle = '#ff9cc6'; ctx.fill(o.extra.cream);
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(2, 12.2, f.w - 4, 1.2);
        ctx.fillStyle = cg(ctx, 'candy:fshade', g => LG(g, 0, 0, 0, 30, [[0, 'rgba(120,50,20,0)'], [.6, 'rgba(120,50,20,0.1)'], [1, 'rgba(120,50,20,0.38)']]));
        ctx.fill(o.under);
        ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#6a3410'; ctx.stroke(o.under);
      } else if (id === 'snow') {
        ctx.fillStyle = cg(ctx, 'snow:icefill', g => LG(g, 0, 0, 0, 32, [[0, 'rgba(214,244,255,0.95)'], [.5, 'rgba(140,210,245,0.9)'], [1, 'rgba(84,160,220,0.95)']]));
        ctx.fill(o.under);
        ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fill(o.extra.fac);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(5, 6, Math.max(0, f.w - 10), 2);
        ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#23466f'; ctx.stroke(o.under);
        ctx.fillStyle = cg(ctx, 'snow:ice2', g => LG(g, 0, 26, 0, 50, [[0, '#ffffff'], [.4, '#c6ecff'], [1, '#7cc6ef']]));
        ctx.fill(o.extra.ice);
        ctx.lineWidth = 1.3; ctx.strokeStyle = '#2a4c7a'; ctx.stroke(o.extra.ice);
        ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineCap = 'round'; ctx.stroke(o.extra.iceHi);
      } else {
        const pt = PATS.castle(ctx);
        if (pt) { setPat(pt, -(f.x % 96), -(f.y % 96)); ctx.fillStyle = pt.pat; } else ctx.fillStyle = gp.body;
        ctx.fill(o.under);
        ctx.fillStyle = cg(ctx, 'castle:fshade', g => LG(g, 0, 0, 0, 52, [[0, 'rgba(255,200,170,0.08)'], [.5, 'rgba(5,0,10,0.12)'], [1, 'rgba(5,0,10,0.45)']]));
        ctx.fill(o.under);
        ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(10,4,16,0.7)'; ctx.stroke(o.extra.lines);
        ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = gp.ol; ctx.stroke(o.under);
      }
      DRAWCAP[id](ctx, o.cap);
      ctx.restore();
      capTop(ctx, id, f.x, f.y, f.w, Math.max(f.x, vx0 - 20), Math.min(f.x + f.w, vx1 + 20), f.seed);
    }
  }

  /** Çukurların dibine doğru koyulaşan derinlik sisi (dünya koordinatında, zeminlerin arkasında) */
  const ABYSS = { forest: '#04110c', candy: '#2e0822', snow: '#081634', castle: '#05010a' };
  /** Çukurlar: iki blok arasındaki boşlukta, alçak kenarın biraz altından sıvıya doğru hızla koyulaşan derinlik
      (arka plan boşluktan kesintisiz "vadi" gibi görünmesin) + iki duvar boyunca iç gölge. Önbellekli gradyanlar,
      görünür çukur başına birkaç fillRect. */
  function drawAbyss(ctx, L, P, vx0, vx1, vy0, vy1) {
    const col = ABYSS[P.id] || '#000000';
    const liq = L.liq, yL = liq + 10;
    if (vy1 < 200) return;
    const gA = cg(ctx, P.id + ':pitA', g => LG(g, 0, 0, 0, 60, [[0, rgba(col, 0)], [.35, rgba(col, .3)], [1, rgba(col, .64)]]));
    const gB = cg(ctx, P.id + ':pitB', g => LG(g, 0, 0, 0, 1, [[0, rgba(col, .64)], [1, rgba(col, .93)]]));
    const wl = cg(ctx, P.id + ':pitW', g => LG(g, 0, 0, 18, 0, [[0, rgba(col, .55)], [1, rgba(col, 0)]]));
    for (const gp of gaps) {
      if (gp.x1 < vx0 || gp.x0 > vx1) continue;
      const y0 = gp.yb + 6;
      if (y0 > vy1) continue;
      const gx = gp.x0 - 3, gw = gp.x1 - gp.x0 + 6;
      ctx.save(); ctx.translate(gx, y0);
      ctx.fillStyle = gA; ctx.fillRect(0, 0, gw, 60);
      const hB = yL - y0 - 60;
      if (hB > 1) { ctx.save(); ctx.translate(0, 60); ctx.scale(1, hB); ctx.fillStyle = gB; ctx.fillRect(0, 0, gw, 1); ctx.restore(); }
      ctx.restore();
      if (vy1 > yL) { ctx.fillStyle = rgba(col, .93); ctx.fillRect(gx, yL, gw, vy1 - yL); }
      // duvar dibi gölgeleri (çukur içine doğru)
      const hw = Math.min(vy1, yL) - y0;
      if (hw > 0) {
        const ww = Math.min(18, (gp.x1 - gp.x0) / 2);
        ctx.save(); ctx.translate(gp.x0, y0); ctx.fillStyle = wl; ctx.fillRect(0, 0, ww, hw); ctx.restore();
        ctx.save(); ctx.translate(gp.x1, y0); ctx.scale(-1, 1); ctx.fillStyle = wl; ctx.fillRect(0, 0, ww, hw); ctx.restore();
      }
    }
  }

  /* =====================================================================
     SIVI: su / çikolata / buzlu su / lav
     ===================================================================== */
  const LQ = {
    water: { top: '#74d8ff', mid: '#2b9ee4', deep: '#14559c', back: '#1f7cc4', foam: '#f2fcff', glint: '#ffffff' },
    chocolate: { top: '#9a5a30', mid: '#62301a', deep: '#341406', back: '#4a220c', foam: '#d9a07a', glint: '#ffe0c4' },
    icewater: { top: '#b4f0ff', mid: '#5bbbe8', deep: '#2a6aa6', back: '#3f93c9', foam: '#ffffff', glint: '#ffffff' },
    lava: { top: '#ffe873', mid: '#ff7a1a', deep: '#b31d0b', back: '#d43a10', foam: '#fff7b8', glint: '#fff6c0' }
  };
  function waveY(x, k) {
    return k ? Math.sin(x * .028 - tk * 1.7) * 3 + Math.sin(x * .061 + tk * 1.1) * 1.4
      : Math.sin(x * .034 + tk * 2.1) * 2.4 + Math.sin(x * .013 - tk * 1.3) * 2.2;
  }
  function iceChunkSpr(v) {
    return spr('icechunk' + v, 60, 30, 30, 14, g => {
      const rnd = mrng(800 + v);
      const pts = []; const n = 7;
      for (let i = 0; i < n; i++) { const a = PI + i / (n - 1) * PI; pts.push([Math.cos(a) * (16 + rnd() * 8), Math.sin(a) * (6 + rnd() * 5) - 1]); }
      pts.push([20, 4]); pts.push([-20, 4]);
      const p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (const q of pts) p.lineTo(q[0], q[1]); p.closePath();
      olFill(g, p, '#e8f8ff', '#2a5480', 2.4);
      g.save(); g.clip(p); g.fillStyle = 'rgba(140,210,245,0.6)'; g.fillRect(-30, 0, 60, 10); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(-12, -6, 12, 2); g.restore();
    });
  }
  function drawLiquid(ctx, L, vx0, vx1, vy1) {
    const y0 = L.liq; if (vy1 < y0 - 12) return;
    const name = L.theme.id === 'tropic' ? 'sea' : L.theme.liquid, c = LQ[name] || LQ.water;
    if (LIQ_NEW[name]) { liquidNew(ctx, L, name, vx0, vx1, vy1); return; }
    const st = 16;
    const x0 = Math.floor((vx0 - 20) / st) * st, x1 = vx1 + 20, yb = vy1 + 12;
    ctx.save();
    // arka dalga
    ctx.beginPath(); ctx.moveTo(x0, yb);
    for (let x = x0; x <= x1 + st; x += st) ctx.lineTo(x, y0 - 6 + waveY(x, 1));
    ctx.lineTo(x1 + st, yb); ctx.closePath();
    ctx.fillStyle = rgba(c.back, name === 'lava' ? .85 : .6); ctx.fill();
    // lav ısı parıltısı (yukarı doğru)
    if (name === 'lava') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.translate(0, y0 - 90);
      ctx.fillStyle = cg(ctx, 'lq:heat', g => LG(g, 0, 0, 0, 96, [[0, 'rgba(255,90,20,0)'], [.7, 'rgba(255,110,30,0.16)'], [1, 'rgba(255,170,60,0.4)']]));
      ctx.fillRect(x0, 0, x1 - x0 + st, 96);
      ctx.restore();
    }
    // ön yüzey
    ctx.beginPath(); ctx.moveTo(x0, yb);
    for (let x = x0; x <= x1 + st; x += st) ctx.lineTo(x, y0 + waveY(x, 0));
    ctx.lineTo(x1 + st, yb); ctx.closePath();
    ctx.save(); ctx.translate(0, y0 - 6);
    ctx.fillStyle = cg(ctx, 'lq:' + name, g => LG(g, 0, 0, 0, 110, name === 'lava'
      ? [[0, rgba(c.top, 1)], [.12, rgba('#ffb12e', 1)], [.4, rgba(c.mid, 1)], [1, rgba(c.deep, 1)]]
      : name === 'chocolate'
        ? [[0, rgba(c.top, .96)], [.14, rgba(c.mid, .97)], [1, rgba(c.deep, 1)]]
        : [[0, rgba(c.top, .62)], [.14, rgba(c.mid, .74)], [.5, rgba(c.mid, .88)], [1, rgba(c.deep, .97)]]));
    ctx.fill(); ctx.restore();
    // köpük çizgisi
    ctx.beginPath();
    for (let x = x0; x <= x1 + st; x += st) { const y = y0 + waveY(x, 0); if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = rgba(c.foam, .92); ctx.stroke();
    ctx.beginPath();
    for (let x = x0; x <= x1 + st; x += st) { const y = y0 + 7 + waveY(x + 40, 0) * .6; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.lineWidth = 2; ctx.strokeStyle = rgba(c.foam, .22); ctx.stroke();
    // tür ayrıntıları
    if (name === 'water' || name === 'icewater') {
      const sp = 44;
      ctx.fillStyle = c.glint;
      for (let i = Math.floor(x0 / sp); i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, 71), a = Math.sin(tk * 2.2 + h * 30);
        if (a < .25) continue;
        const x = i * sp + h * 30, y = y0 + 10 + hs(i, 72) * 64;
        if (y > yb) continue;
        ctx.globalAlpha = (a - .25) * (1 - (y - y0) / 110) * .9;
        ctx.beginPath(); rrp(ctx, x, y, 5 + h * 12, 1.8, .9); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (name === 'icewater') {
        const sp2 = 230;
        for (let i = Math.floor((x0 - 60) / sp2); i <= Math.ceil((x1 + 60) / sp2); i++) {
          const h = hs(i, 73); if (h > .65) continue;
          const x = i * sp2 + h * 90 + Math.sin(tk * .4 + h * 9) * 8;
          const y = y0 + waveY(x, 0) - 1 + Math.sin(tk * 1.6 + h * 5) * 1.2;
          ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(tk * .9 + h * 7) * .06);
          drawS(ctx, iceChunkSpr((h * 3) | 0), 0, 0, .7 + h * .6);
          ctx.restore();
        }
      }
    } else if (name === 'chocolate') {
      const sp = 70;
      for (let i = Math.floor(x0 / sp); i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, 81), per = 2.2 + h * 2.4, ph = ((tk + h * 9) % per) / per;
        const x = i * sp + h * 40, y = y0 + waveY(x, 0);
        if (ph < .78) {
          const r = 1.5 + 6 * ph / .78;
          ctx.fillStyle = '#7a4222'; ctx.beginPath(); ctx.arc(x, y + 1, r, PI, 0); ctx.fill();
          ctx.strokeStyle = 'rgba(40,16,4,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.fillStyle = 'rgba(255,224,196,0.7)'; ctx.beginPath(); ctx.arc(x - r * .35, y - r * .45, r * .25, 0, TAU); ctx.fill();
        } else {
          const q = (ph - .78) / .22;
          ctx.strokeStyle = rgba('#e2ad84', .8 * (1 - q)); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(x, y + 1, 4 + q * 10, 1.5 + q * 2.5, 0, 0, TAU); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,214,180,0.16)';
      const sp2 = 140;
      for (let i = Math.floor(x0 / sp2) - 1; i <= Math.ceil(x1 / sp2); i++) {
        const h = hs(i, 82), x = i * sp2 + ((tk * 9 + h * 100) % sp2);
        E(ctx, x, y0 + 14 + h * 26, 24 + h * 20, 2.6, 'rgba(255,214,180,0.16)');
      }
    } else if (name === 'lava') {
      const sp = 96;
      for (let i = Math.floor(x0 / sp) - 1; i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, 91), x = i * sp + ((tk * 6 + h * 200) % sp);
        E(ctx, x, y0 + 8 + h * 10, 14 + h * 18, 3 + h * 2, 'rgba(120,16,4,0.42)');
        E(ctx, x + 22, y0 + 26 + h * 30, 18 + h * 12, 3, 'rgba(130,20,6,0.3)');
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sp2 = 78;
      for (let i = Math.floor(x0 / sp2); i <= Math.ceil(x1 / sp2); i++) {
        const h = hs(i, 92), per = 1.6 + h * 2.2, ph = ((tk + h * 7) % per) / per;
        const x = i * sp2 + h * 50, y = y0 + waveY(x, 0);
        if (ph < .7) {
          const r = 2 + 6 * ph / .7;
          ctx.fillStyle = 'rgba(255,240,140,0.85)'; ctx.beginPath(); ctx.arc(x, y + 1, r, PI, 0); ctx.fill();
        } else {
          const q = (ph - .7) / .3;
          ctx.fillStyle = rgba('#ffe066', 1 - q);
          for (let k = 0; k < 3; k++) {
            const vx = (k - 1) * 30 + (h - .5) * 20, vy = -90 - k * 20;
            const t = q * .5;
            ctx.beginPath(); ctx.arc(x + vx * t, y + vy * t + 300 * t * t, 1.8 * (1 - q) + .6, 0, TAU); ctx.fill();
          }
        }
      }
      ctx.restore();
    }
    // çukur duvarlarına vuran köpük dudağı (sıvı artık zeminin arkasında: yalnızca çukurlarda görünür)
    const lava = name === 'lava';
    if (lava) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; }
    for (const gp of gaps) {
      if (gp.x1 < vx0 - 20 || gp.x0 > vx1 + 20) continue;
      for (let s = 0; s < 2; s++) {
        const wx = s ? gp.x1 - 1 : gp.x0 + 1, dir = s ? -1 : 1;
        const bob = Math.sin(tk * 3.1 + wx * .05) * 1.2;
        const y = y0 + waveY(wx, 0) - 1 + bob;
        ctx.fillStyle = rgba(c.foam, lava ? .55 : .9);
        ctx.beginPath(); ctx.ellipse(wx + dir * 4, y, 9, 3.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(c.foam, lava ? .4 : .75);
        const b1 = (tk * 1.7 + wx * .013) % 1, b2 = (tk * 1.3 + wx * .021 + .5) % 1;
        ctx.beginPath(); ctx.arc(wx + dir * (11 + b1 * 6), y - 2 - b1 * 3, 2.2 * (1 - b1) + .4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(wx + dir * (6 + b2 * 9), y + 1 - b2 * 2, 1.6 * (1 - b2) + .4, 0, TAU); ctx.fill();
      }
    }
    if (lava) ctx.restore();
    ctx.restore();
  }

  /* =====================================================================
     TEHLİKELER VE SEVİYE OBJELERİ
     ===================================================================== */
  const MET = {
    lit: '#eef2f8', mid: '#a7b0c0', dark: '#5d6678', deep: '#353c4c', ol: '#151922'
  };
  /** Tek diken birimi (36 px); orijin: birimin sol-alt köşesi (zemin hizası) */
  // Not: yalnızca GÖRSEL büyütüldü — çarpışma kutusu (level.js: 26 yüksek, 36'nın katı geniş) aynı.
  function spikeSpr() {
    return spr('spike2', 42, 48, 3, 43, g => {
      const T = -39;   // uç yüksekliği (görsel)
      const whole = new Path2D(); whole.moveTo(2.5, 1); whole.quadraticCurveTo(12, -11, 18, T); whole.quadraticCurveTo(24, -11, 33.5, 1); whole.closePath();
      const L = new Path2D(); L.moveTo(2.5, 1); L.quadraticCurveTo(12, -11, 18, T); L.lineTo(18, 1); L.closePath();
      const Rt = new Path2D(); Rt.moveTo(18, T); Rt.quadraticCurveTo(24, -11, 33.5, 1); Rt.lineTo(18, 1); Rt.closePath();
      g.lineJoin = 'round';
      g.lineWidth = 6.4; g.strokeStyle = MET.ol; g.stroke(whole);   // kalın dış hat: telefonda uzaktan okunsun
      // koyu çelik (açık gri metal açık mavi gökyüzü / karda kayboluyordu)
      g.fillStyle = LG(g, 3, 0, 18, 0, [[0, '#6f7a8e'], [.6, '#b9c2d2'], [1, '#d9dfea']]); g.fill(L);
      g.fillStyle = LG(g, 18, 0, 33, 0, [[0, '#3b4354'], [1, '#1d222d']]); g.fill(Rt);
      g.save(); g.clip(whole);
      // kırmızı tehlike ucu (üst ~%45)
      g.fillStyle = LG(g, 0, T, 0, -14, [[0, '#ffb09a'], [.3, '#ff3a3a'], [.8, '#d0101e'], [1, 'rgba(150,8,18,0)']]); g.fillRect(0, T - 4, 18, 30);
      g.fillStyle = LG(g, 0, T, 0, -14, [[0, '#e03a3a'], [.45, '#a00a16'], [1, 'rgba(80,0,8,0)']]); g.fillRect(18, T - 4, 18, 30);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, -5, 40, 7);
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(9, -5); g.quadraticCurveTo(13.6, -13, 16.6, -31); g.stroke();
      g.lineWidth = 2.8; g.strokeStyle = MET.ol; g.stroke(whole);
    });
  }
  function spikeSmallSpr() {
    return spr('spikeS2', 20, 30, 10, 26, g => {
      const p = new Path2D(); p.moveTo(-7.5, 1); p.quadraticCurveTo(-2, -7, 0, -23); p.quadraticCurveTo(2, -7, 7.5, 1); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = MET.ol; g.stroke(p);
      g.fillStyle = LG(g, -7, 0, 7, 0, [[0, '#6f7a8e'], [.48, '#c9d0dc'], [.52, '#3b4354'], [1, '#1d222d']]); g.fill(p);
      g.save(); g.clip(p); g.fillStyle = LG(g, 0, -23, 0, -11, [[0, '#ff4a4a'], [1, 'rgba(180,10,20,0)']]); g.fillRect(-8, -24, 16, 13); g.restore();
    });
  }
  /** Taban plakası (sarı-siyah tehlike şeritli), genişlik başına önbellek */
  function spikePlateSpr(pw) {
    pw = Math.round(pw);
    return spr('spkpl' + pw, pw + 6, 15, 3, 3, g => {
      const p = new Path2D(); rrp(p, 0, 0, pw, 10, 3.5);
      g.fillStyle = LG(g, 0, 0, 0, 10, [[0, '#7c8597'], [.45, '#4c5466'], [1, '#262b38']]); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = '#ffcc22'; g.fillRect(0, 3.2, pw, 4.4);
      g.fillStyle = '#17141c';
      for (let x = -8; x < pw + 8; x += 9) { g.beginPath(); g.moveTo(x, 7.6); g.lineTo(x + 4.5, 7.6); g.lineTo(x + 8.9, 3.2); g.lineTo(x + 4.4, 3.2); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(3, 1, pw - 6, 1.3);
      g.restore();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = MET.ol; g.stroke(p);
    });
  }
  function drawSpikes(ctx, L, vx0, vx1) {
    const big = spikeSpr(), sm = spikeSmallSpr();
    const halo = G.glowSprite('rgba(255,60,40,0.55)', 40);
    for (const s of L.spikes) {
      if (s.x > vx1 + 40 || s.x + s.w < vx0 - 40) continue;
      const gy = s.y + s.h, n = Math.max(1, Math.round(s.w / 36)), cx = s.x + s.w / 2;
      // arkada yumuşak kırmızı hale (önbellekli sprite, nabız) + altta koyu gölge
      ctx.save();
      ctx.globalAlpha = .36 + .12 * Math.sin(tk * 4 + s.x * .01);
      ctx.drawImage(halo.c, cx - s.w / 2 - 30, gy - 70, s.w + 60, 80);
      ctx.restore();
      E(ctx, cx, gy + 1, s.w / 2 + 14, 4.5, 'rgba(0,0,0,0.32)');
      for (let i = 0; i <= n; i++) drawS(ctx, sm, s.x + i * 36, gy - 1);
      for (let i = 0; i < n; i++) drawS(ctx, big, s.x + i * 36, gy - 1);
      // taban plakası (hitbox'tan 6'şar birim geniş)
      drawS(ctx, spikePlateSpr(s.w + 12), s.x - 6, gy - 5);
    }
  }

  /** Ezici başlığı (dişler dahil). Orijin: dişlerin alt ucu (öldüren bölgenin alt kenarı), yatay merkez. */
  function crushHeadSpr(id, w) {
    const W = Math.round(w) + 12, H = 92;
    const stone = id === 'forest' || id === 'castle' || id === 'desert' || id === 'tropic';
    return spr('crh:' + (stone ? 's' : 'm') + W, W + 10, H + 10, (W + 10) / 2, H + 4, g => {
      const ol = '#120e18';
      // dişler
      const n = Math.max(3, Math.round(W / 15)), tw = W / n;
      const teeth = new Path2D();
      for (let i = 0; i < n; i++) { const x = -W / 2 + i * tw; teeth.moveTo(x + 1, -16); teeth.quadraticCurveTo(x + tw * .38, -6, x + tw / 2, 1); teeth.quadraticCurveTo(x + tw * .62, -6, x + tw - 1, -16); teeth.closePath(); }
      g.lineJoin = 'round'; g.lineWidth = 5.2; g.strokeStyle = ol; g.stroke(teeth);
      g.fillStyle = LG(g, -W / 2, 0, W / 2, 0, [[0, '#dfe5ee'], [.5, '#9aa3b4'], [1, '#596274']]); g.fill(teeth);
      g.save(); g.clip(teeth); g.fillStyle = LG(g, 0, -9, 0, 1, [[0, 'rgba(220,30,40,0)'], [1, '#e8202e']]); g.fillRect(-W, -10, W * 2, 12); g.restore();
      // gövde
      const b = new Path2D(); rrp(b, -W / 2, -H, W, H - 14, 8);
      g.fillStyle = stone ? LG(g, 0, -H, 0, -14, [[0, '#b6aec4'], [.5, '#8a829e'], [1, '#5d5674']]) : LG(g, 0, -H, 0, -14, [[0, '#d2d8e2'], [.45, '#98a1b2'], [1, '#596274']]);
      g.fill(b);
      g.save(); g.clip(b);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-W / 2, -H, W * .45, H);
      g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(W * .2, -H, W * .3, H);
      // uyarı şeridi
      const sy = -H * .5 - 8, sh = 15;
      g.fillStyle = '#ffcc22'; g.fillRect(-W / 2, sy, W, sh);
      g.fillStyle = '#17141c';
      for (let x = -W / 2 - 20; x < W / 2 + 10; x += 14) { g.beginPath(); g.moveTo(x, sy + sh); g.lineTo(x + 7, sy + sh); g.lineTo(x + 7 + sh, sy); g.lineTo(x + sh, sy); g.closePath(); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-W / 2, sy, W, 2);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-W / 2, sy + sh - 2, W, 2);
      g.strokeStyle = ol; g.lineWidth = 2; g.beginPath(); g.moveTo(-W / 2, sy); g.lineTo(W / 2, sy); g.moveTo(-W / 2, sy + sh); g.lineTo(W / 2, sy + sh); g.stroke();
      if (stone) {
        g.strokeStyle = 'rgba(30,20,40,0.55)'; g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(-W * .3, -H + 4); g.lineTo(-W * .22, -H + 14); g.lineTo(-W * .28, -H + 22); g.moveTo(W * .25, -22); g.lineTo(W * .18, -30); g.lineTo(W * .26, -38); g.stroke();
        // demir kuşak
        g.fillStyle = '#3a3646'; g.fillRect(-W / 2, -H + 6, W, 7); g.fillRect(-W / 2, -24, W, 7);
        for (let x = -W / 2 + 6; x < W / 2 - 3; x += 12) { E(g, x, -H + 9.5, 1.8, 1.8, '#9a94aa'); E(g, x, -20.5, 1.8, 1.8, '#9a94aa'); }
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.4; g.beginPath(); rrp(g, -W / 2 + 4, -H + 4, W - 8, H - 22, 5); g.stroke();
        for (const cx of [-W / 2 + 8, W / 2 - 8]) for (const cy of [-H + 8, -22]) { E(g, cx, cy, 2.6, 2.6, '#2a303c'); E(g, cx - .6, cy - .6, 1, 1, '#ffffff'); }
      }
      // kızgın gözler
      const ey = -H + 26;
      for (const sx of [-1, 1]) {
        const ex = sx * Math.min(12, W * .18);
        g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(ex, ey, 5.5, 4.5, 0, 0, TAU); g.fill();
        g.fillStyle = '#14101c'; g.beginPath(); g.arc(ex - sx * 1, ey + 1, 2.4, 0, TAU); g.fill();
        g.strokeStyle = '#14101c'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(ex - sx * 7, ey - 8); g.lineTo(ex + sx * 3, ey - 4); g.stroke();
      }
      g.restore();
      g.lineWidth = 4.2; g.strokeStyle = ol; g.stroke(b);
    });
  }
  function chainSpr() {
    return spr('chain', 16, 26, 8, 0, g => {
      // dikey halka (önde) + yan halka
      g.lineWidth = 4.4; g.strokeStyle = '#141018';
      g.beginPath(); g.ellipse(0, 6.5, 4.4, 7.5, 0, 0, TAU); g.stroke();
      g.lineWidth = 2.6; g.strokeStyle = '#8a8f9c'; g.stroke();
      g.lineWidth = 1; g.strokeStyle = '#e2e6ee'; g.beginPath(); g.ellipse(0, 6.5, 4.4, 7.5, 0, 3.6, 4.6); g.stroke();
      g.fillStyle = '#141018'; g.fillRect(-2.2, 12.5, 4.4, 14);
      g.fillStyle = '#6a6f7c'; g.fillRect(-1.1, 13, 2.2, 13);
    });
  }
  function drawCrush(ctx, L, vx0, vx1, vy0) {
    const id = pal().id;
    const ch = chainSpr();
    for (const k of L.crush) {
      if (k.x > vx1 + 40 || k.x + k.w < vx0 - 40) continue;
      const cx = k.x + k.w / 2, bot = k.y + k.h, ground = bot + 26;
      // zemindeki gölge (oyuncu okuyabilsin)
      const shd = G.glowSprite('rgba(10,0,16,0.55)', 32);
      ctx.drawImage(shd.c, cx - k.w / 2 - 16, ground - 6, k.w + 32, 13);
      // TEHLİKE İPUCU: zeminde nabız atan kırmızı bant + dişlerin altındaki boşlukta akan "kay →" okları
      // (ezici sabittir, altından KAYARAK geçilir; okunaklılık: tehlike dili kırmızı, geçiş yönü sarı)
      {
        const pulse = .55 + .45 * Math.sin(tk * 5 + k.x * .02);
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.globalAlpha = .22 + .18 * pulse; ctx.fillStyle = '#ff2a2a';
        ctx.beginPath(); rrp(ctx, k.x - 10, ground - 4, k.w + 20, 4.5, 2); ctx.fill();
        const off = (tk * 36) % 22, ay = ground - 12;
        ctx.beginPath();
        for (let x = k.x - 14 + off; x < k.x + k.w + 6; x += 22) { ctx.moveTo(x - 4, ay - 5); ctx.lineTo(x + 2, ay); ctx.lineTo(x - 4, ay + 5); }
        ctx.globalAlpha = (.45 + .4 * pulse) * .6; ctx.strokeStyle = '#3a1a00'; ctx.lineWidth = 6; ctx.stroke();   // koyu taban
        ctx.globalAlpha = .45 + .4 * pulse; ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 3.2; ctx.stroke();        // sarı ok
        ctx.restore();
      }
      // zincir(ler): tavan braketinden ekran dışına
      const chains = k.w > 70 ? [cx - k.w * .28, cx + k.w * .28] : [cx];
      const top = Math.min(k.y - 6, vy0 - 30);
      for (const x of chains) for (let y = k.y - 22; y > top - 26; y -= 24) drawS(ctx, ch, x, y);
      // braket
      ctx.save(); ctx.translate(cx, k.y);
      ctx.beginPath(); rrp(ctx, -k.w / 2 - 7, -6, k.w + 14, 20, 5);
      ctx.fillStyle = cg(ctx, 'crush:br', g => LG(g, 0, -6, 0, 14, [[0, '#6c7386'], [1, '#2c3140']])); ctx.fill();
      ctx.lineWidth = 2.6; ctx.strokeStyle = '#120e18'; ctx.stroke();
      for (let x = -k.w / 2 - 1; x <= k.w / 2 + 1; x += Math.max(10, (k.w + 2) / 3)) { E(ctx, x, 4, 2, 2, '#1a1e28'); E(ctx, x - .5, 3.5, .8, .8, '#e2e6ee'); }
      // piston mili
      const sw = Math.max(14, k.w * .34), ht = bot - 92 + 4 - (k.y + 14);
      if (ht > 0) {
        ctx.save(); ctx.translate(-sw / 2, 14); ctx.scale(sw, 1);
        ctx.fillStyle = cg(ctx, 'crush:shaft', g => LG(g, 0, 0, 1, 0, [[0, '#3c4252'], [.3, '#c9d0dc'], [.45, '#f4f7fb'], [.7, '#8c95a6'], [1, '#353b4a']]));
        ctx.fillRect(0, 0, 1, ht);
        ctx.restore();
        ctx.strokeStyle = '#120e18'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-sw / 2, 14); ctx.lineTo(-sw / 2, 14 + ht); ctx.moveTo(sw / 2, 14); ctx.lineTo(sw / 2, 14 + ht); ctx.stroke();
        for (let y = 30; y < ht - 6; y += 46) { ctx.fillStyle = 'rgba(20,16,30,0.5)'; ctx.fillRect(-sw / 2, 14 + y, sw, 3); }
      }
      ctx.restore();
      // başlık
      drawS(ctx, crushHeadSpr(id, k.w), cx, bot);
      // yanıp sönen uyarı lambası
      const on = Math.sin(tk * 7 + k.x * .01) > 0;
      const ly2 = bot - 92 + 12, lx = cx + k.w / 2 - 2;
      E(ctx, lx, ly2, 5, 5, '#120e18');
      E(ctx, lx, ly2, 3.6, 3.6, on ? '#ff3a3a' : '#7a1218');
      if (on) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .8;
        drawS(ctx, G.glowSprite('rgba(255,60,50,0.9)', 18), lx, ly2);
        ctx.restore();
      }
    }
  }

  /** Dönen testere bıçağı */
  function sawBladeSpr() {
    return spr('sawb', 76, 76, 38, 38, g => {
      const R0 = 28, n = 18, step = TAU / n;
      const p = new Path2D();
      for (let i = 0; i < n; i++) {
        const a = i * step;
        const v = [Math.cos(a) * (R0 - 4), Math.sin(a) * (R0 - 4)];
        const t = [Math.cos(a + step * .72) * (R0 + 5), Math.sin(a + step * .72) * (R0 + 5)];
        if (i) p.lineTo(v[0], v[1]); else p.moveTo(v[0], v[1]);
        p.lineTo(t[0], t[1]);
      }
      p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 5.4; g.strokeStyle = MET.ol; g.stroke(p);
      g.fillStyle = RG(g, -8, -8, 2, 0, 0, R0 + 5, [[0, '#ffffff'], [.35, '#d3d9e3'], [.75, '#9aa3b4'], [1, '#606a7c']]); g.fill(p);
      // kırmızı tehlike halkası (dişlerin dibinde): testere uzaktan "tehlike" diye okunsun
      g.strokeStyle = 'rgba(232,32,46,0.85)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R0 - 5.5, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(40,46,60,0.55)'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, R0 - 9, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2.2; g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, R0 - 13, 3.6, 4.6); g.stroke();
      g.beginPath(); g.arc(0, 0, R0 - 13, .5, 1.5); g.stroke();
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + .5; E(g, Math.cos(a) * 13, Math.sin(a) * 13, 3.4, 3.4, '#2a303c'); E(g, Math.cos(a) * 13 + .8, Math.sin(a) * 13 + .8, 1.6, 1.6, '#6a7386'); }
      E(g, 0, 0, 8, 8, '#2a303c'); E(g, 0, 0, 5.5, 5.5, '#c81e2a'); E(g, -1.4, -1.4, 2, 2, '#ff9a9a');
    });
  }
  function drawSaws(ctx, L, vx0, vx1) {
    const bl = sawBladeSpr();
    for (const s of L.saws) {
      if (s.cx < vx0 - 70 || s.cx > vx1 + 70) continue;
      const px = s.px != null ? s.px : s.cx, py = s.py != null ? s.py : s.cy;
      const top = s.cy - s.amp - s.r - 12, bot = s.cy + 80;
      // evre (game.js ile aynı: seviye saati S.lt): phs −1 tepe … +1 dip; dphs > 0 → bıçak aşağı iniyor
      const lt = (S.lt || 0) * s.sp + s.ph, phs = Math.sin(lt), dphs = Math.cos(lt);
      const lowK = (phs + 1) * .5;
      // TEHLİKE İPUCU: inişte (ve dipteyken) rayın alt yarısı kırmızı yanar, zeminde tehlike halkası belirir; çıkışta hızla söner
      const warn = dphs > 0 ? .25 + .75 * lowK : Math.max(0, lowK - .4) * 1.2;
      if (warn > .02) {
        const pulse = .7 + .3 * Math.sin(tk * 9);
        ctx.save();
        ctx.globalAlpha = warn;
        ctx.translate(s.cx - 22, s.cy - s.amp - s.r); ctx.scale(44, bot - 4 - (s.cy - s.amp - s.r));
        ctx.fillStyle = cg(ctx, 'saw:warn2', g => LG(g, 0, 0, 0, 1, [[0, 'rgba(255,40,40,0)'], [.45, 'rgba(255,40,40,0.3)'], [1, 'rgba(255,70,40,0.7)']]));
        ctx.fillRect(0, 0, 1, 1);
        ctx.restore();
        ctx.save(); ctx.globalAlpha = warn * pulse;
        E(ctx, s.cx, bot - 2, s.r + 20, 6.5, 'rgba(255,40,40,0.4)');
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,80,60,0.95)'; ctx.beginPath(); ctx.ellipse(s.cx, bot - 2, s.r + 20, 6.5, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.translate(s.cx, 0);
      // ray plakası
      ctx.beginPath(); rrp(ctx, -9, top, 18, bot - top + 2, 7);
      ctx.save(); ctx.translate(-9, 0); ctx.scale(18, 1);
      ctx.fillStyle = cg(ctx, 'saw:rail', g => LG(g, 0, 0, 1, 0, [[0, '#2c3140'], [.3, '#8a93a6'], [.5, '#c9d0dc'], [.75, '#5a6274'], [1, '#262b38']]));
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 2.6; ctx.strokeStyle = MET.ol; ctx.stroke();
      ctx.beginPath(); rrp(ctx, -3, top + 10, 6, bot - top - 20, 3); ctx.fillStyle = '#0c0e14'; ctx.fill();
      for (let y = top + 14; y < bot - 10; y += 26) { E(ctx, -6, y, 1.6, 1.6, '#1a1e28'); E(ctx, 6, y + 13, 1.6, 1.6, '#1a1e28'); }
      // üst gövde
      ctx.beginPath(); rrp(ctx, -15, top - 12, 30, 20, 6);
      ctx.fillStyle = '#ffcc22'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#17141c';
      for (let x = -30; x < 20; x += 10) { ctx.beginPath(); ctx.moveTo(x, top + 8); ctx.lineTo(x + 5, top + 8); ctx.lineTo(x + 25, top - 12); ctx.lineTo(x + 20, top - 12); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      ctx.beginPath(); rrp(ctx, -15, top - 12, 30, 20, 6);
      ctx.lineWidth = 2.6; ctx.strokeStyle = MET.ol; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-11, top - 10, 22, 1.6);
      // taban
      ctx.beginPath(); ctx.moveTo(-22, bot + 3); ctx.lineTo(-13, bot - 12); ctx.lineTo(13, bot - 12); ctx.lineTo(22, bot + 3); ctx.closePath();
      ctx.fillStyle = '#4a5162'; ctx.fill(); ctx.lineWidth = 2.6; ctx.strokeStyle = MET.ol; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-12, bot - 10, 24, 2);
      // taşıyıcı
      ctx.beginPath(); rrp(ctx, -11, py - 9, 22, 18, 5); ctx.fillStyle = '#3c4252'; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = MET.ol; ctx.stroke();
      ctx.restore();
      // bıçak + hareket bulanıklığı (hız: seviye saatinden — game.js ile aynı evre)
      const vy = dphs * s.amp * s.sp;
      const ang = tk * 13;
      ctx.save();
      ctx.globalAlpha = .16; ctx.translate(px, py - vy * .045); ctx.rotate(ang - .5); ctx.drawImage(bl.c, -38, -38, 76, 76); ctx.restore();
      ctx.save();
      ctx.globalAlpha = .3; ctx.translate(px, py - vy * .022); ctx.rotate(ang - .25); ctx.drawImage(bl.c, -38, -38, 76, 76); ctx.restore();
      ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.drawImage(bl.c, -38, -38, 76, 76); ctx.restore();
      ctx.save(); ctx.globalAlpha = .25; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, s.r + 2, ang * 2, ang * 2 + 1.4); ctx.stroke(); ctx.restore();
    }
  }

  /** Zıplatan mantar — DOST nesne dili: yeşil/turkuaz (kırmızı yalnızca tehlikeler için), kalın dış hat */
  function mushSpr() {
    return spr('mush2', 80, 46, 40, 38, g => {
      const ol = '#0a3a1e';
      const st = new Path2D(); st.moveTo(-10, 2); st.quadraticCurveTo(-13, -6, -8, -13); st.lineTo(8, -13); st.quadraticCurveTo(13, -6, 10, 2); st.closePath();
      g.fillStyle = LG(g, -11, 0, 11, 0, [[0, '#d6c9a0'], [.4, '#fff9e6'], [1, '#c6b58a']]); g.fill(st);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = ol; g.stroke(st);
      E(g, -4, -6, 1.5, 3, 'rgba(255,255,255,0.7)');
      const cap = new Path2D(); cap.moveTo(-34, -9); cap.bezierCurveTo(-36, -25, -18, -31, 0, -31); cap.bezierCurveTo(18, -31, 36, -25, 34, -9); cap.quadraticCurveTo(0, -3, -34, -9); cap.closePath();
      g.fillStyle = LG(g, 0, -10, 0, -4, [[0, '#e6ffd0'], [1, '#9ad08a']]); g.beginPath(); g.ellipse(0, -8, 30, 4.5, 0, 0, TAU); g.fill();
      g.fillStyle = RG(g, -10, -26, 2, 0, -16, 40, [[0, '#b6ff9a'], [.45, '#3ad65e'], [1, '#117a3a']]); g.fill(cap);
      g.save(); g.clip(cap);
      const spots = [[-20, -18, 5.5, 3.8], [-1, -25, 6.5, 3.6], [18, -18, 5.4, 3.8], [-8, -12.5, 3.4, 2.2], [9, -12, 3, 2], [28, -12, 2.6, 2.2], [-29, -12, 2.6, 2.4]];
      for (const s of spots) { E(g, s[0] + .6, s[1] + 1, s[2], s[3], 'rgba(10,80,30,0.35)'); E(g, s[0], s[1], s[2], s[3], '#fbfff4'); E(g, s[0] - s[2] * .3, s[1] - s[3] * .35, s[2] * .4, s[3] * .3, '#ffffff'); }
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.arc(0, -4, 28, 3.6, 4.2); g.stroke();
      g.restore();
      g.lineWidth = 3.4; g.strokeStyle = ol; g.stroke(cap);
    });
  }
  function drawMush(ctx, L, vx0, vx1) {
    const sp = mushSpr();
    for (const m of L.mush) {
      if (m.x > vx1 + 40 || m.x + m.w < vx0 - 40) continue;
      const f = m.sq > 0 ? clamp(m.sq / .3, 0, 1) : 0;
      const b = Math.cos((1 - f) * PI * 3) * f;
      const br = 1 + Math.sin(tk * 3 + m.x * .01) * .025;
      const sy = (1 - .34 * b) * br, sx = (1 + .24 * b) / Math.sqrt(br);
      const cx = m.x + m.w / 2;
      E(ctx, cx, m.y + 1, 26, 4, 'rgba(0,0,0,0.25)');
      ctx.save(); ctx.translate(cx, m.y + 1); ctx.scale(sx, sy);
      ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
      ctx.restore();
    }
  }

  /** Hız pedi: parlak yeşil hızlandırıcı plaka (yürüyen banttan ayrı görsel dil: bant koyu kauçuk + makara) */
  function padSpr() {
    return spr('pad2', 136, 26, 68, 10, g => {
      const b = new Path2D(); rrp(b, -62, -7, 124, 16, 6);
      g.lineJoin = 'round'; g.lineWidth = 5.4; g.strokeStyle = '#06301e'; g.stroke(b);
      g.fillStyle = LG(g, 0, -7, 0, 9, [[0, '#8dffd0'], [.3, '#2ee59d'], [1, '#0a7a4a']]); g.fill(b);
      // ok yuvası (koyu kanal)
      g.beginPath(); rrp(g, -54, -4, 108, 10, 4); g.fillStyle = '#063a24'; g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-52, -4, 104, 2);
      g.fillStyle = 'rgba(230,255,240,0.75)'; g.fillRect(-56, -5.6, 112, 1.4);
      for (const x of [-58.5, 58.5]) { E(g, x, 1, 2, 2, '#06301e'); E(g, x - .5, .5, .8, .8, '#d8ffe8'); }
    });
  }
  /** Tek büyük ok (konturlu chevron), önbellekli; lit = yanık (beyaz-sarı) / sönük */
  function padArrowSpr(lit) {
    return spr(lit ? 'padArL' : 'padArD', 22, 22, 11, 11, g => {
      const p = new Path2D(); p.moveTo(-6, -7); p.lineTo(3, 0); p.lineTo(-6, 7);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = 7.4; g.strokeStyle = lit ? '#1a3a10' : '#04241a'; g.stroke(p);
      g.lineWidth = 4.2; g.strokeStyle = lit ? '#fff6a0' : '#5fd296'; g.stroke(p);
      if (lit) { g.lineWidth = 1.4; g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(-5, -5.4); g.lineTo(1.4, -.4); g.stroke(); }
    });
  }
  function drawPads(ctx, L, vx0, vx1) {
    const ps = padSpr(), aL = padArrowSpr(true), aD = padArrowSpr(false);
    const gl = G.glowSprite('rgba(80,255,170,0.8)', 40), sp = sparkleSpr();
    for (const p of L.pads) {
      if (p.x > vx1 + 30 || p.x + p.w < vx0 - 30) continue;
      const cx = p.x + p.w / 2, y = p.y;
      // üstte yeşil hale
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .4 + .15 * Math.sin(tk * 6 + p.x);
      ctx.drawImage(gl.c, cx - 70, y - 30, 140, 38);
      ctx.restore();
      drawS(ctx, ps, cx, y);
      // 3 büyük ok, sırayla yanar (soldan sağa akan ışık)
      const ph = (tk * 4.2 + p.x * .003) % 3;
      for (let i = 0; i < 3; i++) {
        const ax = cx - 32 + i * 32, d = Math.abs(((ph - i) % 3 + 3) % 3);
        const on = d < 1 ? 1 - d : 0;
        drawS(ctx, aD, ax, y + 1);
        if (on > 0) { ctx.globalAlpha = on; drawS(ctx, aL, ax, y + 1, 1 + on * .12); ctx.globalAlpha = 1; }
      }
      // yukarı süzülen parıltılar
      for (let k = 0; k < 4; k++) {
        const h = hs(k, (p.x | 0) + 31), q = (tk * (.7 + h * .4) + h) % 1;
        ctx.globalAlpha = Math.sin(q * PI) * .9;
        drawS(ctx, sp, cx - 48 + k * 32 + (h - .5) * 14, y - 6 - q * 34, .32 + h * .18);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Yürüyen bant */
  function drawBelts(ctx, L, vx0, vx1) {
    for (const b of L.belts) {
      if (b.x > vx1 + 30 || b.x + b.w < vx0 - 30) continue;
      const y = b.y, x0 = b.x, x1 = b.x + b.w;
      ctx.save();
      // gövde
      ctx.beginPath(); rrp(ctx, x0 - 6, y - 5, b.w + 12, 15, 7.5);
      ctx.save(); ctx.translate(0, y - 5);
      ctx.fillStyle = cg(ctx, 'belt:body', g => LG(g, 0, 0, 0, 15, [[0, '#4a4f5c'], [.25, '#2a2e38'], [1, '#14161c']]));
      ctx.fill(); ctx.restore();
      ctx.lineWidth = 3.2; ctx.strokeStyle = MET.ol; ctx.stroke();
      // kayan diş izleri
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y - 5, b.w, 15); ctx.clip();
      // kauçuk bant: kayan diş izleri ve enine kaburgalar (sarı chevron YOK — hız pedinin dili)
      const off = (tk * 120) % 14;
      ctx.fillStyle = 'rgba(160,170,190,0.35)';
      for (let x = x0 - 14 + off; x < x1; x += 14) ctx.fillRect(x, y - 4.5, 6, 2);
      ctx.fillStyle = 'rgba(120,128,146,0.38)';
      for (let x = x0 - 14 + off; x < x1 + 2; x += 14) ctx.fillRect(x + 3, y - 1, 2.2, 8.5);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = x0 - 14 + off; x < x1 + 2; x += 14) ctx.fillRect(x + 5.2, y - 1, 1.2, 8.5);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x0, y - 4, b.w, 1.2);
      // makaralar
      const ang = tk * 9;
      for (const rx of [x0 + 1, x1 - 1]) {
        E(ctx, rx, y + 2.5, 8.5, 8.5, MET.ol);
        E(ctx, rx, y + 2.5, 7, 7, '#9aa3b4');
        E(ctx, rx, y + 2.5, 3, 3, '#2a303c');
        ctx.strokeStyle = '#3a4152'; ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) { const a = ang + i * TAU / 3; ctx.beginPath(); ctx.moveTo(rx + Math.cos(a) * 3, y + 2.5 + Math.sin(a) * 3); ctx.lineTo(rx + Math.cos(a) * 6.5, y + 2.5 + Math.sin(a) * 6.5); ctx.stroke(); }
      }
      ctx.restore();
    }
  }

  /** Çamur birikintisi (temaya göre renk) */
  /** Çamur: zemine GÖMÜLÜ, koyu ve ıslak parlak birikinti (eski açık kahve bant kök/kütük gibi okunuyordu).
      Yüzey çarpışma hizasının ~4 birim üstünde (ayaklar hafif batar); gövde kapağı (çimeni) örter. */
  const MUD = {
    forest: { a: '#5b3315', b: '#2e1606', hi: 'rgba(255,240,220,0.45)', bub: '#6e4220', ol: '#1a0b02' },
    candy: { a: '#d07e2a', b: '#7a380a', hi: 'rgba(255,244,210,0.65)', bub: '#e3973f', ol: '#3a1804' },   // yapışkan karamel (çikolata kaplama kapağından ayrışsın)
    snow: { a: '#6e5a50', b: '#33251f', hi: 'rgba(255,255,255,0.62)', bub: '#86706a', ol: '#1e1210' },   // kirli kar çamuru (kahve: her temada aynı "yavaşlatır" dili)
    castle: { a: '#4a3a64', b: '#1c1430', hi: 'rgba(225,205,255,0.42)', bub: '#5c4a7c', ol: '#0c0614' }
  };
  const mudGeo = new WeakMap();
  function mudGeom(m) {
    const rnd = mrng((m.x | 0) * 7 + 3);
    const w = m.w, D = 26, LIP = 6;
    // yüzey noktaları: alçak, hafif dalgalı; arada küçük çamur tümsekleri
    const top = [[-9, 1], [-3, -3.4]];
    let x = 4;
    while (x < w - 6) {
      const seg = 16 + rnd() * 24, lump = rnd() < .2;
      top.push([x + seg * .5, lump ? -6.8 - rnd() * 2.4 : -3.4 - rnd() * 1.4]);
      x += seg;
    }
    top.push([w + 3, -3.4]); top.push([w + 9, 1]);
    const p = new Path2D(); smoothOpen(p, top);
    // sağ uç → ıslak, dalgalı alt kenar (kapak saçaklarını örter; kök gibi sarkan damla YOK)
    p.quadraticCurveTo(w + 10, 9, w + 2, 13);
    x = w + 2;
    while (x > -2) {
      const nx = Math.max(-2, x - (12 + rnd() * 20));
      p.quadraticCurveTo((x + nx) / 2, D + (rnd() - .35) * 6, nx, D - 4 + rnd() * 5);
      x = nx;
    }
    p.quadraticCurveTo(-10, 9, -9, 1); p.closePath();
    const topL = new Path2D(); smoothOpen(topL, top);
    // parlak yüzey bandı (sıvının üst yüzü, sığ açıdan): üst çizgi + LIP aşağıdaki paralel çizgi
    const surf = new Path2D(); smoothOpen(surf, top);
    const low = top.slice().reverse().map(q => [q[0], q[1] + LIP * (q[0] < -4 || q[0] > w + 4 ? .4 : 1)]);
    smoothOpen(surf, low, false); surf.closePath();
    const lip = new Path2D(); smoothOpen(lip, top.map(q => [q[0], q[1] + LIP * (q[0] < -4 || q[0] > w + 4 ? .4 : 1)]));
    // yüzeyde ıslak yansımalar + parlak noktalar
    const hi = new Path2D();
    let hx = 8;
    while (hx < w - 18) { const l = 20 + rnd() * 54; rrp(hi, hx, -2.2, Math.min(l, w - 10 - hx), 2.2, 1.1); hx += l + 12 + rnd() * 34; }
    for (let k = 0; k < w / 60; k++) { const ex = 12 + rnd() * (w - 24); circ(hi, ex, -.6 + rnd(), 1 + rnd() * .7); }
    // ön yüzde koyu girdaplar
    const dk = new Path2D();
    for (let k = 0; k < w / 30; k++) { const ex = 8 + rnd() * (w - 16), ey = 8 + rnd() * 9; dk.moveTo(ex + 7, ey); dk.ellipse(ex, ey, 4 + rnd() * 7, 1.5, 0, 0, TAU); }
    // uçlardaki sıçrama lekeleri (çimenin üstünde)
    const spl = new Path2D();
    for (const sd of [-1, 1]) {
      const bx = sd < 0 ? -8 : w + 8;
      for (let k = 0; k < 3; k++) { const ex = bx + sd * (6 + k * 7 + rnd() * 4), r = 2.8 - k * .6 + rnd() * .8; spl.moveTo(ex + r * 1.4, -1.8); spl.ellipse(ex, -1.8 - rnd() * 1.5, r * 1.4, r * .8, 0, 0, TAU); }
    }
    return { p, topL, surf, lip, hi, dk, spl, D };
  }
  function drawMud(ctx, L, vx0, vx1) {
    const id = pal().id;
    mudList(ctx, L.mud, MUD[id] || MUD.forest, id, vx0, vx1);
  }
  /** Çamur/bataklık kum listesi (c = renk seti, id = gradyan önbellek anahtarı) */
  function mudList(ctx, list, c, id, vx0, vx1) {
    for (const m of list) {
      if (m.x > vx1 + 30 || m.x + m.w < vx0 - 30) continue;
      let gm = mudGeo.get(m);
      if (!gm) { gm = mudGeom(m); mudGeo.set(m, gm); }
      ctx.save(); ctx.translate(m.x, m.y);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.fillStyle = c.a; ctx.fill(gm.spl);
      ctx.lineWidth = 1.6; ctx.strokeStyle = c.ol; ctx.stroke(gm.spl);
      // koyu ön yüz (ıslak toprak); alt kenarda ince yarı saydam çizgi — sert kütük konturu yok
      ctx.fillStyle = cg(ctx, 'mud3:' + id, g => LG(g, 0, 0, 0, 26, [[0, c.b], [1, shade(c.b, -.25)]]));
      ctx.fill(gm.p);
      ctx.fillStyle = rgba(c.ol, .32); ctx.fill(gm.dk);
      ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(c.ol, .5); ctx.stroke(gm.p);
      // parlak yüzey bandı
      ctx.fillStyle = cg(ctx, 'mudS:' + id, g => LG(g, 0, -7, 0, 4, [[0, shade(c.a, .22)], [1, c.a]]));
      ctx.fill(gm.surf);
      ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(c.ol, .55); ctx.stroke(gm.lip);
      ctx.fillStyle = c.hi; ctx.fill(gm.hi);
      ctx.lineWidth = 2.8; ctx.strokeStyle = c.ol; ctx.stroke(gm.topL);
      // seyrek, iri kabarcıklar + belirgin "plop" halkası
      const sp = 48;
      for (let i = 0; i < m.w / sp; i++) {
        const h = hs(i + (m.x | 0), 61), per = 1.8 + h * 1.8, ph = ((tk + h * 6) % per) / per;
        const x = i * sp + 12 + h * 22; if (x > m.w - 10) continue;
        const r0 = 3.5 + h * 4.5, by = -1.5;
        if (ph < .7) {
          const r = r0 * (.35 + .65 * ph / .7);
          ctx.fillStyle = c.bub; ctx.beginPath(); ctx.arc(x, by, r, PI, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = c.ol; ctx.lineWidth = 1.5; ctx.stroke();
          E(ctx, x - r * .35, by - r * .5, r * .32, r * .2, c.hi);
        } else {
          const q = (ph - .7) / .3;
          ctx.strokeStyle = rgba('#ffffff', .65 * (1 - q)); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(x, by, r0 * (.8 + q * 1.6), 1.3 + q * 2, 0, 0, TAU); ctx.stroke();
          ctx.fillStyle = rgba(c.a, 1 - q);
          for (let k = -1; k <= 1; k += 2) { ctx.beginPath(); ctx.arc(x + k * (3 + q * 8), by - 3 - Math.sin(q * PI) * 9, 1.9, 0, TAU); ctx.fill(); }
        }
      }
      ctx.restore();
    }
  }

  /** Eşya kutusu: kalın koyu dış hat, doygun kırmızı-turuncu gövde, altın çerçeve bandı, büyük "?" — telefonda uzaktan okunsun
      (çarpışma kutusu 32×32 aynı; görsel 34×34 + kontur) */
  function boxSpr() {
    return spr('ibox3', 58, 58, 29, 29, g => {
      const p = new Path2D(); rrp(p, -17, -17, 34, 34, 7);
      g.lineJoin = 'round'; g.lineWidth = 5.6; g.strokeStyle = '#2a0408'; g.stroke(p);
      g.fillStyle = LG(g, 0, -17, 0, 17, [[0, '#ffb08a'], [.26, '#ff5a3c'], [.6, '#e8202e'], [1, '#8e0a1c']]); g.fill(p);
      g.save(); g.clip(p);
      // sağ-alt iç gölge + üst parlama
      g.fillStyle = 'rgba(70,0,12,0.32)'; g.beginPath(); g.moveTo(17, -17); g.lineTo(17, 17); g.lineTo(-17, 17); g.lineTo(-12, 12); g.lineTo(12, 12); g.lineTo(12, -12); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(-6, -11.5, 10, 4.2, -.35, 0, TAU); g.fill();
      // altın çerçeve bandı
      g.lineWidth = 2.6; g.strokeStyle = '#ffd23f'; g.beginPath(); rrp(g, -13, -13, 26, 26, 4.5); g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); rrp(g, -13.6, -13.6, 27.2, 27.2, 5); g.stroke();
      g.restore();
      g.lineWidth = 3.4; g.strokeStyle = '#2a0408'; g.stroke(p);
      // altın köşe perçinleri
      for (const [x, y] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
        E(g, x, y, 2.8, 2.8, '#2a0408'); E(g, x, y, 1.9, 1.9, '#ffd23f'); E(g, x - .5, y - .6, .75, .65, '#fff6c0');
      }
      G.text(g, '?', 0, 1.5, 27, '#ffffff', { stroke: '#4a0610', lw: 5.6, shadowCol: 'rgba(60,0,10,0.55)' });
    });
  }
  /** Kutu etrafındaki genişleyen altın nabız halkası (önbellekli) */
  function boxRingSpr() {
    return spr('iboxring', 80, 80, 40, 40, g => {
      g.lineWidth = 3; g.strokeStyle = '#ffd23f'; g.beginPath(); rrp(g, -30, -30, 60, 60, 12); g.stroke();
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke();
    });
  }
  const boxGnd = new WeakMap();   // kutu → altındaki zemin y (statik; bir kez hesaplanır)
  function boxGroundY(b, cx) {
    let gy = boxGnd.get(b);
    if (gy === undefined) {
      gy = null;
      try { if (FM.game && typeof FM.game.groundY === 'function') gy = FM.game.groundY(cx, b.y + b.h); } catch (e) { gy = null; }
      if (gy != null && gy - (b.y + b.h) > 120) gy = null;
      boxGnd.set(b, gy);
    }
    return gy;
  }
  function drawBoxes(ctx, L, vx0, vx1) {
    const bs = boxSpr(), pi = S.player ? S.player.idx : 0;
    const halo = G.glowSprite('rgba(255,140,80,0.9)', 40), ring = boxRingSpr(), sp = sparkleSpr();
    for (const b of L.boxes) {
      if (b.x > vx1 + 40 || b.x + b.w < vx0 - 40) continue;
      const bob = Math.sin(tk * 2.6 + b.x * .01);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + bob * 3.5;
      const cd = b.cd && b.cd[pi] > 0;
      // zemin gölgesi (kutu havada: gölge onu yere bağlar, yükseklik okunur)
      const gy = boxGroundY(b, cx);
      if (gy != null) E(ctx, cx, gy + 1, 16 - bob * 1.5, 3.8 - bob * .4, cd ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.28)');
      if (cd) {
        ctx.save(); ctx.globalAlpha = .18;
        drawS(ctx, bs, cx, cy, .92);
        ctx.restore();
        continue;
      }
      // sıcak hale (lighter) — nabız
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .34 + .18 * Math.sin(tk * 4 + b.x);
      ctx.drawImage(halo.c, cx - 46, cy - 46, 92, 92);
      ctx.restore();
      // genişleyen altın halka (1.5 sn'de bir)
      const rq = ((tk * .68) + hash((b.x | 0) + 7)) % 1;
      if (rq < .55) { const q = rq / .55; ctx.globalAlpha = (1 - q) * .75; drawS(ctx, ring, cx, cy, .62 + q * .55); ctx.globalAlpha = 1; }
      // gövde: nabız + hafif sallanma
      const pulse = 1 + Math.sin(tk * 4 + b.x) * .05;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.sin(tk * 1.8 + b.x) * .06);
      drawS(ctx, bs, 0, 0, pulse);
      ctx.restore();
      // yörüngede dönen parıltı + köşede ara sıra çakan yıldız
      const oa = tk * 2.4 + b.x * .01;
      ctx.globalAlpha = .9; drawS(ctx, sp, cx + Math.cos(oa) * 24, cy + Math.sin(oa) * 12 - 2, .42 + .1 * Math.sin(oa * 2));
      const ph = (tk * .9 + hash(b.x | 0)) % 2.2;
      if (ph < .4) { ctx.globalAlpha = Math.sin(ph / .4 * PI); drawS(ctx, sp, cx + 14, cy - 14, .7); }
      ctx.globalAlpha = 1;
    }
  }

  /** Dönen altın (klan maçası amblemli): koyu kalın kenar + parlak doygun altın + net amblem (telefonda okunsun) */
  function coinSpr(edge) {
    return spr(edge ? 'coinE2' : 'coin2', 32, 32, 16, 16, g => {
      if (edge) {
        g.fillStyle = '#3e2002'; g.beginPath(); g.arc(0, 0, 13.2, 0, TAU); g.fill();
        g.fillStyle = '#d08a1a'; g.beginPath(); g.arc(0, 0, 11.2, 0, TAU); g.fill();
        g.fillStyle = '#ffd650'; g.beginPath(); g.arc(0, 0, 11.2, PI * 1.15, PI * 1.85); g.lineTo(0, 0); g.closePath(); g.fill();
        return;
      }
      g.fillStyle = '#3e2002'; g.beginPath(); g.arc(0, 0, 13.2, 0, TAU); g.fill();
      g.fillStyle = RG(g, -4, -5, 1, 0, 0, 12, [[0, '#fffbd8'], [.3, '#ffe655'], [.78, '#f5ac18'], [1, '#c87a10']]); g.beginPath(); g.arc(0, 0, 11.4, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(150,84,6,0.95)'; g.lineWidth = 1.8; g.beginPath(); g.arc(0, 0, 8.3, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(255,255,225,0.9)'; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, 9.4, 3.4, 4.9); g.stroke();
      const sp = new Path2D(); spadePath(sp, .6, 1.1, 4.9); g.fillStyle = 'rgba(255,250,200,0.75)'; g.fill(sp);
      const sp2 = new Path2D(); spadePath(sp2, 0, .5, 4.9); g.fillStyle = '#b86a08'; g.fill(sp2);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(-4.8, -5.4, 3.2, 1.7, -.7, 0, TAU); g.fill();
    });
  }
  function drawCoins(ctx, L, vx0, vx1, vy0, vy1) {
    const face = coinSpr(false), edge = coinSpr(true);
    const bit = S.player ? 1 << S.player.idx : 1;
    const gl = G.glowSprite('rgba(255,215,80,0.7)', 18);
    for (const co of L.coins) {
      if (co.got & bit) continue;
      if (co.x < vx0 - 20 || co.x > vx1 + 20 || co.y < vy0 - 20 || co.y > vy1 + 20) continue;
      const y = co.y + (co.drop ? 0 : Math.sin(tk * 3 + co.x * .05) * 1.6);
      const c = Math.cos(tk * 3.4 + co.x * .021);
      const sx = Math.max(.12, Math.abs(c));
      // düşen altın (Altın Avı): ömrünün son 3 sn'sinde yanıp söner, değeri ≥3 ise iri
      const dA = co.drop && co.t < 3 ? .3 + .7 * Math.abs(Math.cos(tk * (5 + (3 - co.t) * 3))) : 1, dS = co.drop && co.v >= 3 ? 1.3 : 1;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 * dA; drawS(ctx, gl, co.x, y, dS * 1.15); ctx.restore();
      ctx.save(); ctx.translate(co.x, y); if (dS !== 1) ctx.scale(dS, dS); ctx.globalAlpha = dA;
      ctx.save(); ctx.translate((1 - sx) * 2.8 * (c >= 0 ? 1 : -1), 0); ctx.scale(sx, 1); ctx.drawImage(edge.c, -16, -16, 32, 32); ctx.restore();
      ctx.scale(sx, 1); ctx.drawImage(face.c, -16, -16, 32, 32);
      ctx.restore();
      const ph = (tk * .8 + hash(co.x | 0) * 3) % 2.4;
      if (ph < .35) { ctx.globalAlpha = Math.sin(ph / .35 * PI); drawS(ctx, sparkleSpr(), co.x + 6, y - 7, .5); ctx.globalAlpha = 1; }
    }
  }

  /* =====================================================================
     BAŞLANGIÇ KAPISI & BİTİŞ TAKI (klan teması: siyah-kırmızı-beyaz, maça)
     ===================================================================== */
  function emblem(g, x, y, r) {
    const hx = new Path2D(); hexPath(hx, x, y, r + 4);
    g.fillStyle = '#c0182e'; g.fill(hx); g.lineWidth = 3; g.strokeStyle = '#140a0c'; g.stroke(hx);
    const hi = new Path2D(); hexPath(hi, x, y, r);
    g.fillStyle = LG(g, 0, y - r, 0, y + r, [[0, '#ffffff'], [1, '#e2e2ea']]); g.fill(hi);
    const sp = new Path2D(); spadePath(sp, x, y + r * .04, r * .62);
    g.fillStyle = '#121216'; g.fill(sp);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x - r * .22, y - r * .2, r * .12, r * .2, .5, 0, TAU); g.fill();
  }
  function post(g, x, top, w, striped) {
    const p = new Path2D(); rrp(p, x - w / 2, top, w, -top + 4, 4);
    g.fillStyle = LG(g, x - w / 2, 0, x + w / 2, 0, [[0, '#3c3c48'], [.35, '#5c5c6c'], [1, '#121218']]); g.fill(p);
    g.save(); g.clip(p);
    if (striped) {
      for (let y = top; y < 0; y += 24) { g.fillStyle = ((y - top) / 24) % 2 ? '#f2f2f6' : '#141418'; g.fillRect(x - w / 2, y, w, 12); g.fillStyle = ((y - top) / 24) % 2 ? '#141418' : '#f2f2f6'; g.fillRect(x - w / 2, y + 12, w, 12); }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w * .15, top, w * .35, -top);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x - w / 2 + 2, top, 3, -top);
    } else {
      for (let y = top + 18; y < -10; y += 30) { g.fillStyle = '#c0182e'; g.fillRect(x - w / 2, y, w, 7); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x - w / 2, y, w, 1.5); }
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x - w / 2 + 2, top, 3, -top);
    }
    g.restore();
    g.lineWidth = 2.6; g.strokeStyle = '#08080c'; g.stroke(p);
    // taban
    const b = new Path2D(); rrp(b, x - w / 2 - 6, -10, w + 12, 14, 4);
    g.fillStyle = '#2a2a34'; g.fill(b); g.stroke(b);
    // tepe topuzu
    g.fillStyle = RG(g, x - 3, top - 9, 1, x, top - 6, 9, [[0, '#fff3a8'], [.5, '#ffd23f'], [1, '#b8860b']]); g.beginPath(); g.arc(x, top - 6, 8, 0, TAU); g.fill();
    g.lineWidth = 2.2; g.stroke();
  }
  function startGateSpr() {
    // tabela 30 birim yukarıda: geri sayımda üst üste duran yarışçıların isim plakaları 'FUAT MOREL' yazısını kapatmasın
    return spr('sgate2', 290, 300, 145, 292, g => {
      const W = 236, H = -198;
      post(g, -112, H + 6, 16, false); post(g, 112, H + 6, 16, false);
      // flamalar
      for (const sx of [-1, 1]) {
        const x = sx * 112;
        g.strokeStyle = '#141418'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, H - 4); g.lineTo(x, H - 40); g.stroke();
        const f = new Path2D(); f.moveTo(x, H - 40); f.quadraticCurveTo(x + sx * 14, H - 36, x + sx * 26, H - 33); f.lineTo(x, H - 24); f.closePath();
        g.fillStyle = '#c0182e'; g.fill(f); g.lineWidth = 1.6; g.strokeStyle = '#3a0408'; g.stroke(f);
      }
      // afiş
      const b = new Path2D(); rrp(b, -W / 2, H - 4, W, 46, 10);
      g.fillStyle = '#1a0a0e'; g.beginPath(); rrp(g, -W / 2 + 3, H, W, 46, 10); g.fill();
      g.fillStyle = LG(g, 0, H - 4, 0, H + 42, [[0, '#2a2a34'], [.5, '#141418'], [1, '#08080c']]); g.fill(b);
      g.lineWidth = 3; g.strokeStyle = '#c0182e'; g.beginPath(); rrp(g, -W / 2 + 4, H, W - 8, 38, 8); g.stroke();
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); rrp(g, -W / 2 + 8, H + 4, W - 16, 30, 6); g.stroke();
      g.lineWidth = 3; g.strokeStyle = '#000000'; g.stroke(b);
      G.text(g, 'FUAT MOREL', 0, H + 20, 27, '#ffffff', { stroke: '#000000', lw: 6, shadowCol: '#c0182e' });
      emblem(g, 0, H - 22, 17);
    });
  }
  function finishGateSpr() {
    return spr('fgate', 340, 300, 170, 290, g => {
      const W = 290, H = -214;
      post(g, -136, H + 10, 20, true); post(g, 136, H + 10, 20, true);
      // afiş
      const b = new Path2D(); rrp(b, -W / 2, H - 6, W, 62, 12);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); rrp(g, -W / 2 + 4, H - 2, W, 62, 12); g.fill();
      g.fillStyle = '#141418'; g.fill(b);
      g.save(); g.clip(b);
      const sq = 9;
      for (let row = 0; row < 2; row++) for (let i = 0; i < W / sq + 1; i++) {
        const yt = H - 6 + row * sq, yb = H + 56 - sq - row * sq + sq;
        g.fillStyle = (i + row) % 2 ? '#f4f4f8' : '#141418';
        g.fillRect(-W / 2 + i * sq, yt, sq, sq);
        g.fillStyle = (i + row + 1) % 2 ? '#f4f4f8' : '#141418';
        g.fillRect(-W / 2 + i * sq, yb - sq, sq, sq);
      }
      g.fillStyle = LG(g, 0, H + 12, 0, H + 38, [[0, '#2a2a34'], [1, '#0c0c10']]); g.fillRect(-W / 2, H + 12, W, 26);
      g.restore();
      g.lineWidth = 3.4; g.strokeStyle = '#000000'; g.stroke(b);
      g.lineWidth = 2; g.strokeStyle = '#c0182e'; g.beginPath(); g.moveTo(-W / 2 + 6, H + 12); g.lineTo(W / 2 - 6, H + 12); g.moveTo(-W / 2 + 6, H + 38); g.lineTo(W / 2 - 6, H + 38); g.stroke();
      G.text(g, 'FİNİŞ', 0, H + 26, 30, '#ffd23f', { stroke: '#000000', lw: 6, shadowCol: '#c0182e' });
      // defne dalları (amblemin iki yanında altın yapraklar)
      const ecy = H - 30;
      for (const sx of [-1, 1]) {
        g.strokeStyle = '#8a5a10'; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath(); g.arc(0, ecy, 31, sx < 0 ? PI * .62 : PI * .38, sx < 0 ? PI * 1.28 : -PI * .28, sx > 0); g.stroke();
        for (let i = 0; i < 6; i++) {
          const a = sx < 0 ? PI * .66 + i * .2 : PI * .34 - i * .2;
          const x = Math.cos(a) * 31, y = ecy + Math.sin(a) * 31;
          const rot = a + PI / 2 + sx * .5;
          E(g, x, y, 6.4, 3.2, '#3a2404', rot);
          E(g, x, y, 5.2, 2.2, i % 2 ? '#ffd23f' : '#ffe680', rot);
        }
      }
      emblem(g, 0, ecy, 21);
    });
  }
  function clanFlagSpr() {
    return spr('clanflag', 50, 84, 25, 2, g => {
      const w = 44, h = 66, x0 = -22;
      const p = new Path2D(); p.moveTo(x0, 0); p.lineTo(x0 + w, 0); p.lineTo(x0 + w, h + 12); p.lineTo(0, h); p.lineTo(x0, h + 12); p.closePath();
      g.fillStyle = '#141418'; g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x0, 0, 14, h + 12);
      g.fillStyle = '#c0182e';
      g.beginPath(); g.moveTo(x0, 22); g.lineTo(x0 + 13, 47); g.lineTo(x0, 72); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x0 + w, 22); g.lineTo(x0 + w - 13, 47); g.lineTo(x0 + w, 72); g.closePath(); g.fill();
      g.fillStyle = '#ffd23f'; g.fillRect(x0, 0, w, 3);
      g.restore();
      const hx = new Path2D(); hexPath(hx, 0, 42, 11.5);
      g.fillStyle = '#ffffff'; g.fill(hx);
      const sp = new Path2D(); spadePath(sp, 0, 42.5, 7); g.fillStyle = '#121216'; g.fill(sp);
      g.lineJoin = 'round'; g.lineWidth = 2.2; g.strokeStyle = '#000000'; g.stroke(p);
    });
  }
  /** Dalgalanan bayrak: sprite'ı yatay şeritler halinde kaydırarak çizer (üstten asılı) */
  function wavingFlag(ctx, s, x, y, sc, t, amp) {
    const rows = 14, c = s.c, srcH = c.height / rows, dh = s.h / rows * sc;
    for (let i = 0; i < rows; i++) {
      const fy = (i + .5) / rows;
      const dx = Math.sin(t * 3.2 - fy * 4.2) * amp * fy * sc;
      const sy = Math.min(c.height - srcH, i * srcH);
      ctx.drawImage(c, 0, sy, c.width, srcH, x - s.ox * sc + dx, y + i * dh, s.w * sc, dh + .7);
    }
  }
  function flagPole(ctx, x, gy, h, t, sc) {
    sc = sc || 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#08080c'; ctx.lineWidth = 6 * sc; ctx.beginPath(); ctx.moveTo(x, gy + 2); ctx.lineTo(x, gy - h); ctx.stroke();
    ctx.strokeStyle = '#6a6a78'; ctx.lineWidth = 3 * sc; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - h); ctx.stroke();
    ctx.strokeStyle = '#08080c'; ctx.lineWidth = 5 * sc; ctx.beginPath(); ctx.moveTo(x - 26 * sc, gy - h + 6 * sc); ctx.lineTo(x + 26 * sc, gy - h + 6 * sc); ctx.stroke();
    ctx.strokeStyle = '#8a6a2a'; ctx.lineWidth = 2.4 * sc; ctx.stroke();
    E(ctx, x, gy - h - 3 * sc, 5 * sc, 5 * sc, '#08080c'); E(ctx, x, gy - h - 3 * sc, 3.6 * sc, 3.6 * sc, '#ffd23f');
    ctx.restore();
    wavingFlag(ctx, clanFlagSpr(), x, gy - h + 8 * sc, sc, t, 5);
  }
  function drawStart(ctx, L, vx0, vx1) {
    const gx = (L.start || 60) + 70, gy = L.startY != null ? L.startY : 460;
    if (gx + 160 < vx0 || gx - 160 > vx1) return;
    drawS(ctx, startGateSpr(), gx, gy);
  }
  function drawStartLine(ctx, L, vx0, vx1) {
    const lx = (L.start || 60) + 80, gy = L.startY != null ? L.startY : 460;
    if (lx + 40 < vx0 || lx - 40 > vx1) return;
    lineStrip(ctx, lx, gy);
  }
  /** Zemine boyanmış dama şeridi: 3 sütun × 4 sıra, ~24 birim geniş, kapak yüzeyinden aşağı (önbellekli sprite) */
  function lineStripSpr() {
    return spr('lstrip', 34, 44, 17, 5, g => {
      const s = 8, cols = 3, rows = 4, x0 = -12, y0 = -3;
      g.fillStyle = '#08080c'; g.beginPath(); rrp(g, x0 - 2, y0 - 2, cols * s + 4, rows * s + 4, 3); g.fill();
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) { g.fillStyle = (c + r) % 2 ? '#16161c' : '#f6f6fa'; g.fillRect(x0 + c * s, y0 + r * s, s, s); }
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x0, y0, cols * s, 1.4);
      g.fillStyle = LG(g, 0, y0 + 14, 0, y0 + rows * s, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']]); g.fillRect(x0, y0 + 14, cols * s, rows * s - 14);
    });
  }
  function lineStrip(ctx, x, gy) { drawS(ctx, lineStripSpr(), x, gy); }
  // bitiş şeridi: ilk yarışçı geçince kopar; seviye değişince yeniden gerilir
  let tapeL = null, tapeT = -1;
  function drawFinishTape(ctx, L, ex, gy) {
    if (tapeL !== L) { tapeL = L; tapeT = -1; }
    const broke = S.racers && S.racers.some(r => r && r.finished);
    if (broke && tapeT < 0) tapeT = tk;
    const y = gy - 50, xa = ex - 128, xb = ex + 128;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const band = (draw) => {
      ctx.lineWidth = 6.5; ctx.strokeStyle = '#3a0408'; draw();
      ctx.lineWidth = 4.2; ctx.strokeStyle = '#e8283c'; draw();
      ctx.setLineDash([7, 9]); ctx.lineWidth = 4.2; ctx.strokeStyle = '#ffffff'; draw(); ctx.setLineDash([]);
    };
    if (!broke) {
      const sag = 9 + Math.sin(tk * 2.2) * 2;
      band(() => { ctx.beginPath(); ctx.moveTo(xa, y); ctx.quadraticCurveTo(ex, y + sag * 2, xb, y); ctx.stroke(); });
    } else {
      const k = clamp((tk - tapeT) / .6, 0, 1);   // kopma anından sonra sarkma
      for (const s of [-1, 1]) {
        const px = s < 0 ? xa : xb, len = 95;
        const sw = Math.sin(tk * 3.4 + s) * 6 * (1 - .4 * k);
        const tx = px - s * len * (1 - k * .82) + sw, ty = y + 8 + k * 64;
        band(() => { ctx.beginPath(); ctx.moveTo(px, y); ctx.quadraticCurveTo(px - s * len * .45, y + 22 + k * 8, tx, ty); ctx.stroke(); });
      }
    }
    ctx.restore();
  }
  // ilk yarışçı bitişi geçerken konfeti (render-fx parçacıkları; FM.fx core.js'ten)
  FM.on && FM.on('finish', d => {
    try {
      const L = S.L; if (!L || !FM.fx || typeof FM.fx.confetti !== 'function') return;
      if (!d || (d.place !== 1 && d.r !== S.player)) return;
      const gy = L.finY != null ? L.finY : 460;
      FM.fx.confetti(L.end, gy - 150, d.place === 1 ? 40 : 24, 380);
    } catch (e) { /* görsel süs: hata oyunu durdurmasın */ }
  });
  function drawFinish(ctx, L, vx0, vx1) {
    const ex = L.end, gy = L.finY != null ? L.finY : 460;
    if (ex + 260 < vx0 || ex - 260 > vx1) return;
    flagPole(ctx, ex - 196, gy, 150, tk, 1);
    flagPole(ctx, ex + 196, gy, 150, tk + 1.3, 1);
    drawS(ctx, finishGateSpr(), ex, gy);
    // yanıp sönen ampuller
    const W = 290, H = -214, n = 15;
    for (let i = 0; i < n; i++) {
      const x = ex - W / 2 + 14 + i * (W - 28) / (n - 1), y = gy + H + 60;
      const on = ((tk * 5 + i) % 3) < 1.6;
      E(ctx, x, y, 4, 4, '#08080c');
      E(ctx, x, y, 2.8, 2.8, on ? '#fff6b0' : '#8a6a20');
      if (on) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .7; drawS(ctx, G.glowSprite('rgba(255,220,90,0.8)', 12), x, y); ctx.restore(); }
    }
  }
  function drawFinishLine(ctx, L, vx0, vx1) {
    const ex = L.end, gy = L.finY != null ? L.finY : 460;
    if (ex + 160 < vx0 || ex - 160 > vx1) return;
    // direkler arasında yarı saydam, yavaşça dalgalanan dikey dama perdesi (çizginin düzlemi)
    const top = gy - 214 + 56, s = 8, rows = Math.ceil((gy - top) / s);
    ctx.save();
    ctx.globalAlpha = .22;
    for (let r = 0; r < rows; r++) {
      const y = top + r * s, wv = Math.sin(tk * 2.1 - r * .45) * 2.2 * (r / rows);
      for (let c = 0; c < 3; c++) { ctx.fillStyle = (c + r) % 2 ? '#141418' : '#ffffff'; ctx.fillRect(ex - 12 + c * s + wv, y, s, Math.min(s, gy - y)); }
    }
    ctx.restore();
    lineStrip(ctx, ex, gy);
    drawFinishTape(ctx, L, ex, gy);
  }

  /* =====================================================================
     DEKOR SPRITE'LARI (FM.DECOR'daki tüm tipler)
     Orijin: taban noktası (zemin hizası, yatay merkez). y<0 yukarı.
     ===================================================================== */
  const OLF = '#2a1a0c', OLC = '#5a1838', OLS = '#1c2f52', OLK = '#120818';
  function flame(ctx, x, y, s, t, seed) {
    const f1 = Math.sin(t * 13 + seed) * .5 + Math.sin(t * 21.7 + seed * 2.3) * .5;
    const f2 = Math.sin(t * 17.3 + seed * 1.7);
    const h = (24 + f1 * 3.5) * s, w = 9.5 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .5 + f1 * .08;
    const gl = G.glowSprite('rgba(255,140,40,0.85)', 46);
    ctx.drawImage(gl.c, x - 46 * s, y - h * .45 - 46 * s, 92 * s, 92 * s);
    ctx.restore();
    ctx.beginPath(); dropPath(ctx, x, y, w, h, f2 * 3.2 * s); ctx.fillStyle = '#ff4f18'; ctx.fill();
    ctx.lineWidth = 1.6 * s; ctx.strokeStyle = 'rgba(120,20,0,0.6)'; ctx.stroke();
    ctx.beginPath(); dropPath(ctx, x, y - 1 * s, w * .68, h * .76, f2 * 2.2 * s); ctx.fillStyle = '#ffa526'; ctx.fill();
    ctx.beginPath(); dropPath(ctx, x, y - 2 * s, w * .38, h * .5, f2 * 1.2 * s); ctx.fillStyle = '#fff3a8'; ctx.fill();
  }
  const TREE_C = [
    { ol: OLF, dark: '#2c7630', mid: '#43a03c', lit: '#7ccb4e', hi: 'rgba(232,255,176,0.7)', tex: 'rgba(22,66,22,0.32)' },
    { ol: OLF, dark: '#276a38', mid: '#3a9046', lit: '#6cc05a', hi: 'rgba(214,255,176,0.6)', tex: 'rgba(18,58,28,0.32)' },
    { ol: OLF, dark: '#4f8222', mid: '#7cae2c', lit: '#bde05a', hi: 'rgba(255,255,196,0.7)', tex: 'rgba(56,76,18,0.32)' }
  ];
  function trunk(g, top, wb, wt, ol, c0, c1, c2) {
    const p = new Path2D();
    p.moveTo(-wb - 8, 3); p.quadraticCurveTo(-wb - 2, 0, -wb, -6); p.quadraticCurveTo(-wt - 1, top * .5, -wt, top);
    p.lineTo(wt, top); p.quadraticCurveTo(wt + 1, top * .5, wb, -6); p.quadraticCurveTo(wb + 2, 0, wb + 9, 3); p.closePath();
    g.fillStyle = LG(g, -wb, 0, wb, 0, [[0, c0], [.55, c1], [1, c2]]); g.fill(p);
    g.save(); g.clip(p);
    g.strokeStyle = 'rgba(40,20,5,0.4)'; g.lineWidth = 1.4; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const x = -wb * .6 + i * wb * .4; g.beginPath(); g.moveTo(x, -4); g.quadraticCurveTo(x + 2, top * .5, x - 1, top + 4); g.stroke(); }
    g.restore();
    g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = ol; g.stroke(p);
  }
  const DEC = {
    /* ---------------- ORMAN ---------------- */
    tree: { w: 180, h: 200, base: 6, nv: 3, draw(g, v) {
      trunk(g, -78, 13, 8, OLF, '#5a3518', '#9a6a3c', '#4a2a12');
      g.strokeStyle = OLF; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(-4, -60); g.quadraticCurveTo(-22, -70, -30, -86); g.stroke();
      g.strokeStyle = '#7a4e28'; g.lineWidth = 3.6; g.stroke();
      const s = [1, .92, 1.06][v];
      const cs = [[0, -118, 46], [-38, -100, 32], [38, -98, 34], [-22, -146, 32], [22, -148, 30], [0, -90, 34], [-50, -122, 22], [52, -124, 22]].map(k => [k[0] * s, k[1] * s, k[2] * s]);
      canopy(g, cs, TREE_C[v], 6);
      if (v === 1) for (const a of [[-26, -110], [18, -128], [34, -104], [-6, -140], [-42, -126]]) { E(g, a[0], a[1], 5, 5, OLF); E(g, a[0], a[1], 3.8, 3.8, '#ef3b3b'); E(g, a[0] - 1.2, a[1] - 1.4, 1.2, 1, '#ffd0d0'); }
    } },
    tree2: { w: 130, h: 230, base: 6, nv: 3, draw(g, v) {
      trunk(g, -34, 9, 6, OLF, '#5a3518', '#8a5a30', '#4a2a12');
      const tiers = 5, top = -210 + v * 14;
      const dk = ['#1d5a36', '#22603c', '#2a6a30'][v], md = ['#2b7c48', '#31834c', '#3a8a3c'][v], lt = ['#4fa860', '#56ad64', '#64b552'][v];
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const ty = -26 - (1 - t) * 0 - t * (-top - 70), tw = 56 - t * 34, th = 62 - t * 16;
        const yb = -26 - i * ((-top - 60) / tiers);
        const p = new Path2D();
        p.moveTo(0, yb - th);
        p.quadraticCurveTo(tw * .35, yb - th * .55, tw, yb);
        const n = 4;
        for (let k = 0; k < n; k++) { const x0 = tw - (2 * tw) * k / n, x1 = tw - (2 * tw) * (k + 1) / n; p.quadraticCurveTo((x0 + x1) / 2, yb + 9, x1, yb); }
        p.quadraticCurveTo(-tw * .35, yb - th * .55, 0, yb - th);
        p.closePath();
        g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = OLF; g.stroke(p);
        g.fillStyle = dk; g.fill(p);
        g.save(); g.clip(p);
        g.fillStyle = md; g.beginPath(); g.moveTo(0, yb - th); g.lineTo(tw + 4, yb + 10); g.lineTo(-tw * .2, yb + 10); g.closePath(); g.fill();
        g.fillStyle = lt; g.beginPath(); g.moveTo(1, yb - th + 4); g.lineTo(tw * .9, yb + 2); g.lineTo(tw * .35, yb + 2); g.closePath(); g.fill();
        g.restore();
        void ty;
      }
      E(g, 0, top + 8, 3, 3, 'rgba(255,255,200,0.6)');
    } },
    bush: { w: 110, h: 70, base: 4, nv: 3, draw(g, v) {
      const c = TREE_C[v];
      canopy(g, [[0, -24, 24], [-24, -16, 17], [24, -16, 18], [-12, -36, 15], [13, -35, 14], [-38, -9, 10], [38, -9, 10]], c, 6);
      g.fillStyle = 'rgba(30,60,20,0.35)'; g.fillRect(-44, -4, 88, 4);
      if (v !== 2) for (const a of [[-18, -24], [8, -30], [22, -18], [-4, -14], [-30, -14]]) { E(g, a[0], a[1], 3.6, 3.6, OLF); E(g, a[0], a[1], 2.6, 2.6, v ? '#7a5cff' : '#ff3b5a'); E(g, a[0] - .8, a[1] - .9, .8, .7, '#ffffff'); }
      else for (let i = 0; i < 4; i++) { const x = -24 + i * 16, y = -26 + (i % 2) * 8; for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; E(g, x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.8, 1.8, '#ffffff'); } E(g, x, y, 1.5, 1.5, '#ffd23f'); }
    } },
    rock_big: { w: 130, h: 90, base: 4, nv: 2, draw(g, v) {
      const p = new Path2D();
      smoothClosed(p, v ? [[-50, 3], [-52, -22], [-36, -50], [-6, -62], [24, -56], [46, -34], [52, -6], [44, 4]] : [[-46, 3], [-50, -26], [-30, -54], [4, -60], [36, -46], [50, -18], [46, 4]]);
      g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = OLF; g.stroke(p);
      g.fillStyle = LG(g, -40, -60, 40, 0, [[0, '#c7c2bb'], [.5, '#9a948c'], [1, '#6a645d']]); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(-10, -60); g.lineTo(40, -50); g.lineTo(10, -20); g.lineTo(-20, -30); g.closePath(); g.fill();
      g.fillStyle = 'rgba(40,30,20,0.25)'; g.beginPath(); g.moveTo(-52, -20); g.lineTo(-20, -30); g.lineTo(-6, 4); g.lineTo(-52, 4); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,30,20,0.55)'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(-20, -30); g.lineTo(-12, -16); g.lineTo(-16, -4); g.moveTo(-20, -30); g.lineTo(10, -20); g.lineTo(30, -26); g.stroke();
      // yosun
      const m = new Path2D(); m.moveTo(-40, -44); m.quadraticCurveTo(-14, -70, 24, -58); m.quadraticCurveTo(30, -50, 22, -48);
      m.quadraticCurveTo(18, -40, 14, -46); m.quadraticCurveTo(0, -48, -8, -44); m.quadraticCurveTo(-12, -34, -16, -42); m.quadraticCurveTo(-30, -40, -40, -44); m.closePath();
      g.fillStyle = '#5aa83a'; g.fill(m); g.fillStyle = 'rgba(200,255,140,0.6)'; g.fillRect(-20, -58, 24, 2.4);
      g.restore();
      g.lineWidth = 3; g.strokeStyle = OLF; g.stroke(p);
    } },
    flower: { w: 46, h: 48, base: 3, nv: 5, draw(g, v) {
      const cols = [['#ff4d6a', '#ff9aaa'], ['#ffcf3a', '#fff0a0'], ['#a77cff', '#d8c4ff'], ['#ffffff', '#ffffff'], ['#ff8a3a', '#ffc79a']][v];
      const fl = [[-8, -30, 1], [7, -22, .85], [-1, -14, .7]];
      for (const f of fl) {
        g.strokeStyle = OLF; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(f[0] * .4, 1); g.quadraticCurveTo(f[0] * .8 + 3, f[1] * .5, f[0], f[1]); g.stroke();
        g.strokeStyle = '#3f9a2a'; g.lineWidth = 1.8; g.stroke();
      }
      for (const lf of [[-6, -8, -.8], [6, -10, .7]]) { E(g, lf[0], lf[1], 6, 2.8, OLF, lf[2]); E(g, lf[0], lf[1], 4.8, 1.9, '#5cbf3a', lf[2]); }
      for (const f of fl) {
        const r = 5.2 * f[2];
        for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; E(g, f[0] + Math.cos(a) * r, f[1] + Math.sin(a) * r, r * .78, r * .78, OLF); }
        for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; E(g, f[0] + Math.cos(a) * r, f[1] + Math.sin(a) * r, r * .6, r * .6, cols[0]); E(g, f[0] + Math.cos(a) * r * .8, f[1] + Math.sin(a) * r * .8 - r * .15, r * .25, r * .2, cols[1]); }
        E(g, f[0], f[1], r * .55, r * .55, OLF); E(g, f[0], f[1], r * .42, r * .42, '#ffcc22'); E(g, f[0] - r * .12, f[1] - r * .15, r * .15, r * .12, '#fff7c0');
      }
    } },
    grass: { w: 48, h: 34, base: 3, nv: 3, draw(g, v) {
      const rnd = mrng(70 + v);
      const n = 9;
      const bl = [];
      for (let i = 0; i < n; i++) bl.push([-15 + i * 30 / (n - 1) + (rnd() - .5) * 3, 10 + rnd() * 16 + (Math.abs(i - 4) < 2 ? 5 : 0), (rnd() - .5) * 12 + (i - 4) * 1.4]);
      for (let pass = 0; pass < 2; pass++) for (const b of bl) {
        const p = new Path2D(); p.moveTo(b[0] - 3, 2); p.quadraticCurveTo(b[0] - 1 + b[2] * .3, -b[1] * .55, b[0] + b[2], -b[1]); p.quadraticCurveTo(b[0] + 1 + b[2] * .3, -b[1] * .5, b[0] + 3, 2); p.closePath();
        if (!pass) { g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLF; g.stroke(p); }
        else { g.fillStyle = LG(g, 0, -b[1], 0, 2, [[0, '#b4ee66'], [1, '#4f9e30']]); g.fill(p); }
      }
    } },
    mushroom_s: { w: 46, h: 36, base: 3, nv: 2, draw(g, v) {
      const m = (x, h, r, c1, c2) => {
        const st = new Path2D(); st.moveTo(x - r * .3, 1); st.lineTo(x - r * .25, -h); st.lineTo(x + r * .25, -h); st.lineTo(x + r * .3, 1); st.closePath();
        g.lineWidth = 2.6; g.strokeStyle = OLF; g.stroke(st); g.fillStyle = '#f6ead2'; g.fill(st);
        const cp = new Path2D(); cp.moveTo(x - r, -h + 2); cp.bezierCurveTo(x - r, -h - r * 1.1, x + r, -h - r * 1.1, x + r, -h + 2); cp.quadraticCurveTo(x, -h - 2, x - r, -h + 2); cp.closePath();
        g.stroke(cp); g.fillStyle = LG(g, 0, -h - r, 0, -h, [[0, c1], [1, c2]]); g.fill(cp);
        // beneksiz: kırmızı-beyaz benek yalnızca zıplatan oyun mantarına (mushSpr) ait
        g.save(); g.clip(cp); E(g, x - r * .35, -h - r * .5, r * .42, r * .16, 'rgba(255,240,215,0.45)', -.3); E(g, x + r * .2, -h + 1, r * 1.1, r * .22, 'rgba(60,30,10,0.22)'); g.restore();
      };
      if (v) { m(-7, 10, 9, '#c58a4a', '#8a5426'); m(8, 6, 6.5, '#d99a5a', '#9a5e2a'); }
      else { m(-6, 11, 10, '#a58ac8', '#6a4f94'); m(9, 6, 6.5, '#e0a25a', '#a8662a'); }
    } },
    rock: { w: 44, h: 30, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); smoothClosed(p, v ? [[-16, 3], [-17, -8], [-6, -16], [8, -15], [17, -6], [15, 3]] : [[-14, 3], [-14, -9], [-2, -14], [12, -10], [15, 3]]);
      g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = OLF; g.stroke(p);
      g.fillStyle = LG(g, -10, -15, 10, 3, [[0, '#cbc6be'], [1, '#77716a']]); g.fill(p);
      g.save(); g.clip(p); g.fillStyle = 'rgba(255,255,255,0.35)'; E(g, 2, -11, 8, 3, 'rgba(255,255,255,0.35)'); g.restore();
      for (let i = 0; i < 3; i++) { g.strokeStyle = '#4f9e30'; g.lineWidth = 1.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(-14 + i * 3, 2); g.lineTo(-17 + i * 4, -5 - i); g.stroke(); }
    } },
    sign: { w: 60, h: 66, base: 4, nv: 1, noFlip: true, draw(g) {
      const post = new Path2D(); rrp(post, -4, -46, 8, 50, 2);
      g.lineWidth = 3; g.strokeStyle = OLF; g.fillStyle = '#8a5a2e'; g.fill(post); g.stroke(post);
      const b = new Path2D(); b.moveTo(-24, -54); b.lineTo(16, -54); b.lineTo(27, -43); b.lineTo(16, -32); b.lineTo(-24, -32); b.closePath();
      g.fillStyle = LG(g, 0, -54, 0, -32, [[0, '#d7a466'], [1, '#a46e36']]); g.fill(b);
      g.save(); g.clip(b); g.strokeStyle = 'rgba(90,50,20,0.4)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-24, -43); g.lineTo(27, -43); g.stroke(); g.restore();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLF; g.stroke(b);
      const a = new Path2D(); a.moveTo(-14, -45.5); a.lineTo(4, -45.5); a.lineTo(4, -50); a.lineTo(13, -43); a.lineTo(4, -36); a.lineTo(4, -40.5); a.lineTo(-14, -40.5); a.closePath();
      g.fillStyle = '#c0182e'; g.fill(a); g.lineWidth = 1.4; g.strokeStyle = '#4a0a10'; g.stroke(a);
      E(g, -20, -50, 1.3, 1.3, '#3a2410'); E(g, -20, -36, 1.3, 1.3, '#3a2410');
    } },

    /* ---------------- ŞEKER ---------------- */
    lollipop: { w: 90, h: 190, base: 4, nv: 3, draw(g, v) {
      const st = new Path2D(); rrp(st, -3.5, -110, 7, 114, 3);
      g.lineWidth = 3; g.strokeStyle = OLC; g.stroke(st); g.fillStyle = LG(g, -4, 0, 4, 0, [[0, '#e6dce4'], [.5, '#ffffff'], [1, '#c9bfd0']]); g.fill(st);
      const r = 34, cy = -110 - r + 6;
      const d = new Path2D(); circ(d, 0, cy, r);
      g.lineWidth = 6; g.strokeStyle = OLC; g.stroke(d);
      const cA = ['#ff3d7f', '#ffffff', '#36b8ff'][v], cB = ['#ffffff', '#ff5fa2', '#ffffff'][v];
      g.fillStyle = cA; g.fill(d);
      g.save(); g.clip(d);
      if (v === 1) {
        const rb = ['#ff4f6a', '#ff9a3c', '#ffe066', '#6fdc8c', '#4fb8ff', '#a87cff'];
        for (let i = 0; i < 12; i++) { g.fillStyle = rb[i % 6]; g.beginPath(); g.moveTo(0, cy); g.arc(0, cy, r + 2, i / 12 * TAU, (i + 1) / 12 * TAU); g.closePath(); g.fill(); }
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(0, cy, 8 + i * 8, 0, TAU); g.stroke(); }
      } else {
        g.strokeStyle = cB; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath();
        for (let a = 0; a < 17; a += .2) { const rr = a / 17 * r * 1.05; const x = Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (a) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.arc(6, cy + 6, r, 0, TAU); g.arc(0, cy, r, 0, TAU, true); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-12, cy - 14, 11, 6, -.7, 0, TAU); g.fill();
      g.restore();
      g.lineWidth = 3; g.strokeStyle = OLC; g.stroke(d);
      // kurdele
      const bw = ['#3fd0a0', '#ff5fa2', '#ffcf3a'][v];
      for (const sx of [-1, 1]) { const p = new Path2D(); p.moveTo(0, -112); p.quadraticCurveTo(sx * 12, -122, sx * 16, -110); p.quadraticCurveTo(sx * 10, -104, 0, -110); p.closePath(); g.fillStyle = bw; g.fill(p); g.lineWidth = 2; g.strokeStyle = OLC; g.stroke(p); }
      E(g, 0, -111, 3.2, 3, OLC); E(g, 0, -111, 2.2, 2, bw);
    } },
    candycane: { w: 80, h: 160, base: 4, nv: 2, draw(g, v) {
      const p = new Path2D(); p.moveTo(0, 2); p.lineTo(0, -112); p.arc(18, -112, 18, PI, 0, false); p.lineTo(36, -98);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = 19; g.strokeStyle = OLC; g.stroke(p);
      g.lineWidth = 14; g.strokeStyle = '#fff8fb'; g.stroke(p);
      g.setLineDash([9, 9]); g.lineDashOffset = 0; g.lineWidth = 14; g.lineCap = 'butt'; g.strokeStyle = v ? '#2fbf6a' : '#e8283c'; g.stroke(p); g.setLineDash([]);
      g.lineCap = 'round';
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.75)';
      const h = new Path2D(); h.moveTo(-3.5, -6); h.lineTo(-3.5, -112); h.arc(18, -112, 21.5, PI, PI * 1.45, false); g.stroke(h);
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.12)';
      const sh = new Path2D(); sh.moveTo(4, -2); sh.lineTo(4, -110); g.stroke(sh);
    } },
    cupcake: { w: 90, h: 120, base: 4, nv: 3, draw(g, v) {
      const wc = ['#7fd0ff', '#ffb0d0', '#ffd36b'][v], wd = shade(wc, -.25);
      const wr = new Path2D(); wr.moveTo(-24, 2); wr.lineTo(24, 2); wr.lineTo(31, -38); wr.lineTo(-31, -38); wr.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLC; g.fillStyle = wc; g.fill(wr);
      g.save(); g.clip(wr);
      for (let i = -7; i <= 7; i++) { g.fillStyle = i % 2 ? wd : shade(wc, .2); g.beginPath(); g.moveTo(i * 4, 3); g.lineTo(i * 5 + 2.5, -40); g.lineTo(i * 5 + 5, -40); g.lineTo(i * 4 + 3.4, 3); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(8, -40, 30, 44);
      g.restore(); g.stroke(wr);
      const fc = ['#ffffff', '#ff7fb6', '#8a4a2c'][v], fd = ['#f0d6e6', '#e25a98', '#5e2e16'][v];
      const fr = [[0, -44, 34, 14], [0, -60, 26, 13], [0, -74, 17, 11], [2, -86, 9, 8]];
      for (const f of fr) { g.lineWidth = 6; g.strokeStyle = OLC; g.beginPath(); g.ellipse(f[0], f[1], f[2], f[3], 0, 0, TAU); g.stroke(); }
      for (const f of fr) { g.fillStyle = fd; g.beginPath(); g.ellipse(f[0], f[1], f[2], f[3], 0, 0, TAU); g.fill(); g.fillStyle = fc; g.beginPath(); g.ellipse(f[0] - 2, f[1] - 2.5, f[2] - 3, f[3] - 3, 0, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.6)'; for (const f of fr) { g.beginPath(); g.ellipse(f[0] - f[2] * .45, f[1] - f[3] * .45, f[2] * .22, f[3] * .2, -.4, 0, TAU); g.fill(); }
      const cs = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#c08cff'];
      const rnd = mrng(90 + v);
      for (let i = 0; i < 14; i++) { const a = rnd() * TAU, rr = rnd(); const f = fr[(rnd() * 3) | 0]; g.save(); g.translate(f[0] + Math.cos(a) * f[2] * .7 * rr, f[1] + Math.sin(a) * f[3] * .6 * rr); g.rotate(rnd() * 3); g.fillStyle = cs[i % 5]; g.beginPath(); rrp(g, -3, -1, 6, 2.2, 1.1); g.fill(); g.restore(); }
      g.strokeStyle = '#4a7a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(2, -100); g.quadraticCurveTo(6, -112, 12, -114); g.stroke();
      E(g, 2, -98, 8, 8, OLC); g.fillStyle = RG(g, -1, -101, 1, 2, -98, 8, [[0, '#ff9a9a'], [.5, '#e8283c'], [1, '#9a0d1c']]); g.beginPath(); g.arc(2, -98, 6.6, 0, TAU); g.fill();
      E(g, -.5, -101, 2, 1.4, 'rgba(255,255,255,0.85)');
    } },
    gumtree: { w: 150, h: 190, base: 5, nv: 3, draw(g, v) {
      const tr = new Path2D(); rrp(tr, -7, -86, 14, 90, 5);
      g.lineWidth = 3; g.strokeStyle = OLC; g.fillStyle = '#f6e3c0'; g.fill(tr);
      g.save(); g.clip(tr); g.strokeStyle = '#e8283c'; g.lineWidth = 5; for (let y = -96; y < 10; y += 14) { g.beginPath(); g.moveTo(-10, y); g.lineTo(10, y + 10); g.stroke(); } g.restore();
      g.stroke(tr);
      const pal3 = [
        { ol: OLC, dark: '#e06cc0', mid: '#f59ad6', lit: '#ffd0ee', hi: 'rgba(255,255,255,0.6)' },
        { ol: OLC, dark: '#5aa8e6', mid: '#8acbff', lit: '#cdeaff', hi: 'rgba(255,255,255,0.6)' },
        { ol: OLC, dark: '#e6a03a', mid: '#ffc85e', lit: '#ffe9a8', hi: 'rgba(255,255,255,0.6)' }
      ][v];
      canopy(g, [[0, -112, 38], [-32, -96, 26], [32, -94, 27], [-18, -136, 26], [20, -138, 24], [-44, -116, 18], [44, -118, 18], [0, -86, 24]], pal3, 6);
      const cs = ['#ff3d6a', '#3fd07a', '#ffcf3a', '#7a6cff', '#ff8a2a'];
      const rnd = mrng(300 + v);
      for (let i = 0; i < 9; i++) {
        const x = (rnd() - .5) * 80, y = -100 - rnd() * 50, c = cs[i % 5];
        g.fillStyle = OLC; g.beginPath(); g.arc(x, y, 5.6, PI, 0); g.lineTo(x + 5.6, y + 2); g.lineTo(x - 5.6, y + 2); g.fill();
        g.fillStyle = c; g.beginPath(); g.arc(x, y, 4.4, PI, 0); g.lineTo(x + 4.4, y + 1); g.lineTo(x - 4.4, y + 1); g.fill();
        E(g, x - 1.5, y - 2, 1.4, 1, 'rgba(255,255,255,0.8)');
      }
    } },
    gumdrop: { w: 44, h: 40, base: 3, nv: 4, draw(g, v) {
      const c = ['#ff3d6a', '#3fd07a', '#ffa22a', '#9a6cff'][v];
      const p = new Path2D(); p.moveTo(-15, 2); p.bezierCurveTo(-16, -22, 16, -22, 15, 2); p.quadraticCurveTo(0, 5, -15, 2); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLC;
      g.fillStyle = RG(g, -4, -14, 1, 0, -6, 20, [[0, shade(c, .5)], [.5, c], [1, shade(c, -.3)]]); g.fill(p); g.stroke(p);
      const rnd = mrng(40 + v);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 16; i++) { const a = PI + rnd() * PI, r = rnd() * 12; g.fillRect(Math.cos(a) * r - .7, -6 + Math.sin(a) * r * .9 - .7, 1.4, 1.4); }
      E(g, -6, -11, 3.6, 2.2, 'rgba(255,255,255,0.7)', -.5);
    } },
    sprinkle: { w: 50, h: 22, base: 3, nv: 2, draw(g, v) {
      const cs = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#c08cff', '#ffffff', '#ff9a3c'];
      const rnd = mrng(55 + v);
      for (let i = 0; i < 11; i++) {
        const x = (rnd() - .5) * 36, y = -2 - rnd() * 6 - (Math.abs(x) < 8 ? 3 : 0);
        g.save(); g.translate(x, y); g.rotate(rnd() * PI);
        g.fillStyle = OLC; g.beginPath(); rrp(g, -4.6, -2, 9.2, 4, 2); g.fill();
        g.fillStyle = cs[i % 7]; g.beginPath(); rrp(g, -3.8, -1.3, 7.6, 2.6, 1.3); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(-2.6, -1, 4, .8);
        g.restore();
      }
      if (v) { const p = new Path2D(); p.moveTo(10, 0); p.bezierCurveTo(-1, -6, 4, -15, 10, -9); p.bezierCurveTo(16, -15, 21, -6, 10, 0); p.closePath(); g.lineWidth = 2.4; g.strokeStyle = OLC; g.stroke(p); g.fillStyle = '#ff4f7f'; g.fill(p); E(g, 7, -9, 1.6, 1, 'rgba(255,255,255,0.8)'); }
    } },
    candy: { w: 58, h: 30, base: 3, nv: 3, draw(g, v) {
      const c = ['#ff3d6a', '#36b8ff', '#ffcf3a'][v], c2 = ['#ffffff', '#ffffff', '#ff5fa2'][v];
      g.save(); g.translate(0, -9); g.rotate(-.12);
      for (const sx of [-1, 1]) {
        const w = new Path2D(); w.moveTo(sx * 10, -3); w.lineTo(sx * 24, -9); w.quadraticCurveTo(sx * 21, 0, sx * 24, 9); w.lineTo(sx * 10, 3); w.closePath();
        g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLC; g.stroke(w); g.fillStyle = c; g.fill(w);
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(sx * 12, -1); g.lineTo(sx * 21, -5); g.moveTo(sx * 12, 1); g.lineTo(sx * 21, 5); g.stroke();
      }
      const b = new Path2D(); b.ellipse(0, 0, 12, 8.5, 0, 0, TAU);
      g.lineWidth = 2.8; g.strokeStyle = OLC; g.stroke(b); g.fillStyle = c; g.fill(b);
      g.save(); g.clip(b); g.strokeStyle = c2; g.lineWidth = 3.4; for (let x = -14; x < 16; x += 7) { g.beginPath(); g.moveTo(x, 9); g.lineTo(x + 8, -9); g.stroke(); } g.restore();
      E(g, -4, -4, 4, 1.8, 'rgba(255,255,255,0.7)', -.2);
      g.lineWidth = 2.8; g.strokeStyle = OLC; g.stroke(b);
      g.restore();
    } },
    donut: { w: 50, h: 50, base: 3, nv: 3, draw(g, v) {
      const cy = -19, R0 = 18, r = 6;
      const d = new Path2D(); circ(d, 0, cy, R0);
      g.lineWidth = 5; g.strokeStyle = OLC; g.stroke(d);
      g.fillStyle = RG(g, -5, cy - 6, 2, 0, cy, R0, [[0, '#f6c27a'], [1, '#c47a34']]); g.fill(d);
      const fc = ['#ff7fb6', '#8a4a2c', '#fff6fb'][v];
      const f = new Path2D(); f.moveTo(-R0 + 1, cy + 2);
      const n = 9;
      for (let i = 0; i <= n; i++) { const a = PI + i / n * PI; f.lineTo(Math.cos(a) * (R0 - 1), cy + Math.sin(a) * (R0 - 1)); }
      for (let i = 0; i <= 6; i++) { const x = R0 - 2 - i * (2 * R0 - 4) / 6; f.quadraticCurveTo(x + 3, cy + 6 + (i % 2) * 5, x, cy + 3); }
      f.closePath();
      g.save(); g.clip(d); g.fillStyle = fc; g.fill(f); g.restore();
      const hole = new Path2D(); circ(hole, 0, cy, r);
      g.fillStyle = '#8a4a1a'; g.fill(hole); g.lineWidth = 2.4; g.strokeStyle = OLC; g.stroke(hole);
      E(g, -1, cy - 1, r - 2, r - 2, '#5a2a0a');
      const cs = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#ffffff'];
      const rnd = mrng(60 + v);
      for (let i = 0; i < 10; i++) { const a = PI + .3 + rnd() * (PI - .6), rr = r + 3 + rnd() * (R0 - r - 6); g.save(); g.translate(Math.cos(a) * rr, cy + Math.sin(a) * rr); g.rotate(rnd() * 3); g.fillStyle = cs[i % 5]; g.fillRect(-2.5, -.9, 5, 1.8); g.restore(); }
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-8, cy - 10, 5, 2.4, -.6, 0, TAU); g.fill();
      g.lineWidth = 2.6; g.strokeStyle = OLC; g.stroke(d);
    } },

    /* ---------------- KAR ---------------- */
    pine: { w: 110, h: 170, base: 5, nv: 3, draw(g, v) { snowPine(g, v, 1); } },
    pine_big: { w: 150, h: 250, base: 5, nv: 2, draw(g, v) { snowPine(g, v, 1.45); } },
    snowman: { w: 90, h: 130, base: 4, nv: 2, draw(g, v) {
      const ball = (y, r) => { const p = new Path2D(); circ(p, 0, y, r); return p; };
      const bs = [ball(-22, 24), ball(-58, 18), ball(-86, 13)];
      for (const b of bs) { g.lineWidth = 6; g.strokeStyle = OLS; g.stroke(b); }
      for (let i = 0; i < 3; i++) {
        const y = [-22, -58, -86][i], r = [24, 18, 13][i];
        g.fillStyle = RG(g, -r * .35, y - r * .4, 1, 0, y, r, [[0, '#ffffff'], [.6, '#eef5ff'], [1, '#b8cfec']]); g.fill(bs[i]);
      }
      // kollar
      g.strokeStyle = '#5a3a1e'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-16, -62); g.lineTo(-38, -76); g.moveTo(-30, -71); g.lineTo(-34, -82); g.moveTo(16, -60); g.lineTo(38, -70); g.moveTo(31, -67); g.lineTo(38, -60); g.stroke();
      // atkı
      const sc = v ? '#3a8ad8' : '#e8283c';
      g.fillStyle = sc; g.beginPath(); rrp(g, -15, -76, 30, 7, 3.5); g.fill(); g.lineWidth = 2; g.strokeStyle = OLS; g.stroke();
      g.beginPath(); rrp(g, 5, -74, 8, 20, 3); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(-12, -75, 2, 5); g.fillRect(-4, -75, 2, 5); g.fillRect(6, -63, 6, 2);
      // yüz
      E(g, -4.5, -89, 1.8, 1.8, '#151820'); E(g, 4.5, -89, 1.8, 1.8, '#151820');
      g.fillStyle = '#ff8a2a'; g.beginPath(); g.moveTo(0, -86.5); g.lineTo(13, -84); g.lineTo(0, -82.5); g.closePath(); g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#8a3a0a'; g.stroke();
      for (let i = 0; i < 5; i++) E(g, -6 + i * 3, -79 + Math.sin(i / 4 * PI) * 2, 1, 1, '#151820');
      for (let i = 0; i < 3; i++) { E(g, 0, -64 + i * 9 - (i > 0 ? 0 : 0), 2.2, 2.2, '#151820'); }
      E(g, 0, -30, 2.4, 2.4, '#151820'); E(g, 0, -18, 2.4, 2.4, '#151820');
      // şapka
      g.fillStyle = '#20222c'; g.beginPath(); rrp(g, -15, -100, 30, 4, 2); g.fill();
      g.beginPath(); rrp(g, -10, -118, 20, 19, 2); g.fill();
      g.fillStyle = v ? '#3a8ad8' : '#e8283c'; g.fillRect(-10, -104, 20, 3.5);
      g.lineWidth = 2; g.strokeStyle = OLS; g.beginPath(); rrp(g, -15, -100, 30, 4, 2); g.stroke(); g.beginPath(); rrp(g, -10, -118, 20, 19, 2); g.stroke();
      E(g, -12, -30, 4, 6, 'rgba(255,255,255,0.8)', .4);
    } },
    iceblock: { w: 90, h: 80, base: 4, nv: 2, draw(g, v) {
      const p = new Path2D(); rrp(p, -30, -58, 60, 60, 7);
      g.fillStyle = LG(g, -30, -58, 30, 2, [[0, 'rgba(225,248,255,0.95)'], [.5, 'rgba(150,215,245,0.9)'], [1, 'rgba(90,165,220,0.95)']]); g.fill(p);
      g.save(); g.clip(p);
      if (v) {
        // içinde donmuş balık
        const f = new Path2D(); f.moveTo(-14, -26); f.quadraticCurveTo(0, -38, 12, -28); f.lineTo(20, -36); f.lineTo(19, -18); f.lineTo(12, -24); f.quadraticCurveTo(0, -14, -14, -26); f.closePath();
        g.globalAlpha = .75; g.fillStyle = '#ffa24a'; g.fill(f); g.lineWidth = 1.6; g.strokeStyle = '#7a3a10'; g.stroke(f); E(g, -8, -27, 1.6, 1.6, '#20140a'); g.globalAlpha = 1;
      } else {
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-10, -58); g.lineTo(-2, -30); g.lineTo(-12, -6); g.moveTo(-2, -30); g.lineTo(16, -20); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.moveTo(-30, -58); g.lineTo(-6, -58); g.lineTo(-30, -20); g.closePath(); g.fill();
      g.fillStyle = 'rgba(30,80,140,0.25)'; g.beginPath(); g.moveTo(30, -40); g.lineTo(30, 2); g.lineTo(-4, 2); g.closePath(); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(-24, -53, 18, 3); g.fillRect(-24, -48, 3, 14);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLS; g.stroke(p);
      const sn = new Path2D(); sn.moveTo(-33, -54); sn.quadraticCurveTo(-30, -66, -14, -63); sn.quadraticCurveTo(0, -70, 14, -63); sn.quadraticCurveTo(32, -66, 33, -54); sn.quadraticCurveTo(20, -50, 10, -55); sn.quadraticCurveTo(0, -48, -10, -55); sn.quadraticCurveTo(-24, -50, -33, -54); sn.closePath();
      g.fillStyle = '#ffffff'; g.fill(sn); g.lineWidth = 2.4; g.stroke(sn);
    } },
    snowtuft: { w: 50, h: 28, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); p.moveTo(-18, 2); p.quadraticCurveTo(-18, -8, -8, -9); p.quadraticCurveTo(-2, -15, 6, -10); p.quadraticCurveTo(18, -10, 18, 2); p.closePath();
      if (v) { g.strokeStyle = '#5a3a1e'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(2, -8); g.lineTo(6, -22); g.moveTo(4.5, -16); g.lineTo(10, -20); g.moveTo(3, -13); g.lineTo(-3, -18); g.stroke(); }
      else { for (let i = 0; i < 4; i++) { g.strokeStyle = '#6a8a4a'; g.lineWidth = 1.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(-6 + i * 4, -6); g.lineTo(-8 + i * 5, -16 - (i % 2) * 3); g.stroke(); } }
      g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLS; g.stroke(p);
      g.fillStyle = LG(g, 0, -14, 0, 2, [[0, '#ffffff'], [1, '#c4d9f2']]); g.fill(p);
      E(g, -4, -8, 6, 1.8, 'rgba(255,255,255,1)');
    } },
    crystal: { w: 50, h: 56, base: 3, nv: 2, draw(g, v) {
      // soluk buz/lavanta (doygun camgöbeği kristal elmas para birimine benziyordu)
      const cA = v ? '#ddd2f0' : '#d6ebf7', cB = v ? '#a593c8' : '#94b4cf';
      const pr = (x, w, h, a) => {
        g.save(); g.translate(x, 2); g.rotate(a);
        const p = new Path2D(); p.moveTo(-w / 2, 0); p.lineTo(-w / 2, -h + w * .6); p.lineTo(0, -h); p.lineTo(w / 2, -h + w * .6); p.lineTo(w / 2, 0); p.closePath();
        g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLS; g.stroke(p);
        g.fillStyle = LG(g, -w / 2, 0, w / 2, 0, [[0, cA], [.5, shade(cA, .4)], [.51, cB], [1, shade(cB, -.2)]]); g.fill(p);
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(-w / 2 + 2, -h + w * .7, 2, h * .55);
        g.restore();
      };
      pr(-9, 9, 26, -.35); pr(10, 9, 24, .38); pr(1, 12, 40, 0);
      E(g, 0, 1, 16, 3, 'rgba(255,255,255,0.8)');
    } },
    rock_snow: { w: 54, h: 40, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); smoothClosed(p, v ? [[-20, 3], [-21, -10], [-8, -20], [10, -19], [21, -8], [19, 3]] : [[-18, 3], [-18, -12], [-4, -18], [14, -13], [19, 3]]);
      g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = OLS; g.stroke(p);
      g.fillStyle = LG(g, -10, -18, 10, 3, [[0, '#8a9cb8'], [1, '#4c5e7c']]); g.fill(p);
      g.save(); g.clip(p);
      const sn = new Path2D(); sn.moveTo(-26, -8); sn.quadraticCurveTo(-18, -12, -12, -8); sn.quadraticCurveTo(-6, -4, 0, -9); sn.quadraticCurveTo(8, -6, 14, -10); sn.quadraticCurveTo(20, -6, 26, -9); sn.lineTo(26, -30); sn.lineTo(-26, -30); sn.closePath();
      g.fillStyle = '#ffffff'; g.fill(sn);
      g.fillStyle = 'rgba(160,190,230,0.6)'; g.fillRect(-26, -10, 52, 2);
      g.restore();
      g.lineWidth = 2.6; g.strokeStyle = OLS; g.stroke(p);
    } },
    lantern: { w: 50, h: 90, base: 4, nv: 1, noFlip: true, draw(g) {
      const post = new Path2D(); rrp(post, -3, -62, 6, 66, 2);
      g.lineWidth = 2.6; g.strokeStyle = OLS; g.fillStyle = '#5a3a24'; g.fill(post); g.stroke(post);
      g.lineWidth = 3; g.strokeStyle = OLS; g.beginPath(); g.moveTo(0, -60); g.quadraticCurveTo(12, -64, 14, -56); g.stroke();
      g.strokeStyle = '#2a2a34'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(14, -56); g.lineTo(14, -51); g.stroke();
      // fener gövdesi (camlı kutu)
      const b = new Path2D(); rrp(b, 6.5, -51, 15, 18, 3);
      g.fillStyle = LG(g, 0, -51, 0, -33, [[0, '#fff0b0'], [1, '#ffb84a']]); g.fill(b);
      g.lineWidth = 2.2; g.strokeStyle = '#1e1e28'; g.stroke(b);
      g.lineWidth = 1.4; g.beginPath(); g.moveTo(9.5, -50); g.lineTo(9.5, -34); g.moveTo(18.5, -50); g.lineTo(18.5, -34); g.stroke();
      g.fillStyle = '#2a2a34'; g.beginPath(); g.moveTo(5, -51); g.lineTo(14, -57); g.lineTo(23, -51); g.closePath(); g.fill();
      g.fillRect(6, -34, 16, 3);
      // karlı çatı
      E(g, 14, -55, 9, 3, '#ffffff');
      E(g, 0, -63, 5, 2.4, '#ffffff');
    } },

    /* ---------------- KALE ---------------- */
    banner: { w: 70, h: 150, base: 4, nv: 1, noFlip: true, draw(g) {
      const p = new Path2D(); rrp(p, -3, -136, 6, 140, 2);
      g.lineWidth = 2.6; g.strokeStyle = OLK; g.fillStyle = LG(g, -3, 0, 3, 0, [[0, '#4a3a2a'], [.5, '#8a6a4a'], [1, '#3a2a1a']]); g.fill(p); g.stroke(p);
      const b = new Path2D(); rrp(b, -10, -6, 20, 10, 3); g.fillStyle = '#3a3448'; g.fill(b); g.stroke(b);
    } },
    torch: { w: 50, h: 110, base: 4, nv: 1, noFlip: true, draw(g) {
      const st = new Path2D(); st.moveTo(-10, 3); st.lineTo(-3, -6); st.lineTo(-3, -64); st.lineTo(3, -64); st.lineTo(3, -6); st.lineTo(10, 3); st.closePath();
      g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLK; g.fillStyle = LG(g, -6, 0, 6, 0, [[0, '#3a3448'], [.5, '#6a6280'], [1, '#2a2436']]); g.fill(st); g.stroke(st);
      const bowl = new Path2D(); bowl.moveTo(-13, -72); bowl.lineTo(13, -72); bowl.quadraticCurveTo(10, -60, 0, -60); bowl.quadraticCurveTo(-10, -60, -13, -72); bowl.closePath();
      g.fillStyle = LG(g, -13, 0, 13, 0, [[0, '#4a4258'], [.4, '#8a82a0'], [1, '#2a2436']]); g.fill(bowl); g.stroke(bowl);
      g.fillStyle = '#ffb84a'; g.beginPath(); g.ellipse(0, -72, 12, 2.6, 0, 0, TAU); g.fill(); g.lineWidth = 1.6; g.stroke();
      for (const x of [-9, 0, 9]) { E(g, x, -66, 1.4, 1.4, '#c9c2dc'); }
    } },
    pillar: { w: 80, h: 170, base: 4, nv: 2, draw(g, v) {
      const top = v ? -110 : -140;
      const base = new Path2D(); rrp(base, -26, -14, 52, 18, 3);
      const col = new Path2D(); col.moveTo(-18, -14); col.lineTo(-18, top + 10);
      if (v) { col.lineTo(-10, top + 2); col.lineTo(-4, top + 12); col.lineTo(4, top - 2); col.lineTo(10, top + 8); col.lineTo(18, top + 4); }
      else col.lineTo(18, top + 10);
      col.lineTo(18, -14); col.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLK;
      g.fillStyle = LG(g, -18, 0, 18, 0, [[0, '#6c6488'], [.4, '#b4acc8'], [1, '#4a4264']]); g.fill(col);
      g.save(); g.clip(col); for (let x = -12; x <= 12; x += 8) { g.fillStyle = 'rgba(30,20,50,0.3)'; g.fillRect(x - 1, top, 2.4, -top); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 1.4, top, 1.4, -top); }
      g.strokeStyle = 'rgba(20,10,30,0.6)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-18, top + 40); g.lineTo(-6, top + 50); g.lineTo(-10, top + 64); g.stroke(); g.restore();
      g.stroke(col);
      g.fillStyle = LG(g, 0, -14, 0, 4, [[0, '#9a92b4'], [1, '#4a4264']]); g.fill(base); g.stroke(base);
      if (!v) { const cap = new Path2D(); rrp(cap, -26, top - 4, 52, 16, 3); g.fillStyle = LG(g, 0, top - 4, 0, top + 12, [[0, '#b4acc8'], [1, '#5c5478']]); g.fill(cap); g.stroke(cap); }
      // sarmaşık
      g.strokeStyle = '#4a7a2a'; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(-18, -20); g.bezierCurveTo(-4, -40, -22, -60, -6, -84); g.stroke();
      for (const l of [[-12, -34], [-16, -56], [-8, -74]]) { E(g, l[0], l[1], 4, 2.2, '#5a9a34', .6); }
    } },
    statue: { w: 90, h: 180, base: 4, nv: 1, noFlip: true, draw(g) {
      const ped = new Path2D(); rrp(ped, -28, -34, 56, 38, 4);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLK;
      g.fillStyle = LG(g, 0, -34, 0, 4, [[0, '#9a92b4'], [1, '#4a4264']]); g.fill(ped); g.stroke(ped);
      g.fillStyle = '#5c5478'; g.fillRect(-24, -26, 48, 3);
      const st = '#8a84a2', sd = '#5c5678', lt = '#b8b2cc';
      const body = new Path2D();
      body.moveTo(-16, -34); body.lineTo(-18, -78); body.quadraticCurveTo(-20, -100, -8, -104); body.lineTo(8, -104); body.quadraticCurveTo(20, -100, 18, -78); body.lineTo(16, -34); body.closePath();
      g.fillStyle = LG(g, -18, 0, 18, 0, [[0, sd], [.45, lt], [1, sd]]); g.fill(body); g.stroke(body);
      // kask
      const head = new Path2D(); head.moveTo(-11, -104); head.quadraticCurveTo(-12, -128, 0, -130); head.quadraticCurveTo(12, -128, 11, -104); head.closePath();
      g.fillStyle = LG(g, -11, 0, 11, 0, [[0, sd], [.5, lt], [1, sd]]); g.fill(head); g.stroke(head);
      g.fillStyle = '#2a2436'; g.fillRect(-8, -118, 16, 3); g.fillRect(-1, -126, 2, 18);
      g.strokeStyle = '#c0182e'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -130); g.quadraticCurveTo(10, -144, 18, -134); g.stroke();
      // kalkan
      const sh = new Path2D(); sh.moveTo(-26, -92); sh.lineTo(-6, -92); sh.lineTo(-6, -70); sh.quadraticCurveTo(-8, -56, -16, -50); sh.quadraticCurveTo(-24, -56, -26, -70); sh.closePath();
      g.lineWidth = 3; g.strokeStyle = OLK; g.fillStyle = st; g.fill(sh); g.stroke(sh);
      const sp = new Path2D(); spadePath(sp, -16, -74, 7); g.fillStyle = '#3a3448'; g.fill(sp);
      // kılıç
      g.fillStyle = lt; g.beginPath(); g.moveTo(12, -40); g.lineTo(16, -40); g.lineTo(15, -96); g.lineTo(14, -100); g.lineTo(13, -96); g.closePath(); g.fill(); g.lineWidth = 2; g.stroke();
      g.fillStyle = sd; g.fillRect(6, -44, 16, 4); g.strokeRect(6, -44, 16, 4);
      g.fillStyle = 'rgba(80,140,50,0.75)'; E(g, -18, -36, 9, 3, 'rgba(80,140,50,0.75)'); E(g, 8, -105, 6, 2, 'rgba(80,140,50,0.6)');
    } },
    barrel: { w: 50, h: 54, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); p.moveTo(-14, 2); p.quadraticCurveTo(-19, -18, -14, -38); p.lineTo(14, -38); p.quadraticCurveTo(19, -18, 14, 2); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLK;
      g.fillStyle = LG(g, -18, 0, 18, 0, [[0, '#5a3418'], [.4, '#a8703c'], [1, '#4a2a12']]); g.fill(p);
      g.save(); g.clip(p);
      g.strokeStyle = 'rgba(40,20,5,0.45)'; g.lineWidth = 1.4; for (const x of [-8, -2, 4, 10]) { g.beginPath(); g.moveTo(x * .8, 2); g.quadraticCurveTo(x * 1.1, -18, x * .8, -38); g.stroke(); }
      for (const y of [-31, -7]) { g.fillStyle = '#3a3448'; g.fillRect(-20, y, 40, 5); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-20, y, 40, 1.4); }
      g.restore(); g.stroke(p);
      g.fillStyle = '#7a4a22'; g.beginPath(); g.ellipse(0, -38, 14, 3.4, 0, 0, TAU); g.fill(); g.stroke();
      if (v) { E(g, 0, -38, 9, 2, 'rgba(120,200,60,0.8)'); }
    } },
    crate: { w: 50, h: 48, base: 3, nv: 2, draw(g, v) {
      const s = v ? 30 : 34;
      const p = new Path2D(); rrp(p, -s / 2, -s, s, s + 2, 2);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLK;
      g.fillStyle = LG(g, 0, -s, 0, 2, [[0, '#c48a4a'], [1, '#7a4a20']]); g.fill(p);
      g.save(); g.clip(p);
      g.strokeStyle = 'rgba(50,25,5,0.45)'; g.lineWidth = 1.2; for (let y = -s + 8; y < 0; y += 8) { g.beginPath(); g.moveTo(-s / 2, y); g.lineTo(s / 2, y); g.stroke(); }
      g.lineWidth = 5; g.strokeStyle = '#8a5a2a'; g.beginPath(); g.moveTo(-s / 2 + 3, -3); g.lineTo(s / 2 - 3, -s + 3); g.stroke();
      g.lineWidth = 1.2; g.strokeStyle = OLK; g.beginPath(); g.moveTo(-s / 2 + 1, -5); g.lineTo(s / 2 - 5, -s + 1); g.moveTo(-s / 2 + 5, -1); g.lineTo(s / 2 - 1, -s + 5); g.stroke();
      g.restore();
      g.lineWidth = 3; g.strokeStyle = OLK; g.stroke(p);
      g.lineWidth = 2; g.strokeRect(-s / 2 + 3, -s + 3, s - 6, s - 4);
      for (const [x, y] of [[-s / 2 + 4, -s + 4], [s / 2 - 4, -s + 4], [-s / 2 + 4, -3], [s / 2 - 4, -3]]) E(g, x, y, 1.3, 1.3, '#2a2030');
    } },
    skull: { w: 50, h: 30, base: 3, nv: 2, draw(g, v) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (v) { g.lineWidth = 6; g.strokeStyle = OLK; g.beginPath(); g.moveTo(-18, 0); g.lineTo(10, -4); g.moveTo(-14, -6); g.lineTo(14, 1); g.stroke(); g.lineWidth = 3.4; g.strokeStyle = '#e8e0cc'; g.stroke(); }
      const p = new Path2D(); p.moveTo(-8, 0); p.bezierCurveTo(-13, -10, -10, -20, 0, -20); p.bezierCurveTo(10, -20, 13, -10, 8, 0); p.lineTo(5, 2); p.lineTo(-5, 2); p.closePath();
      g.lineWidth = 2.6; g.strokeStyle = OLK; g.fillStyle = LG(g, -10, -20, 10, 2, [[0, '#f6f0e0'], [1, '#b8ae96']]); g.fill(p); g.stroke(p);
      E(g, -4, -9, 3, 3.4, '#1a1020'); E(g, 4, -9, 3, 3.4, '#1a1020');
      g.fillStyle = '#1a1020'; g.beginPath(); g.moveTo(0, -5); g.lineTo(-1.5, -2); g.lineTo(1.5, -2); g.closePath(); g.fill();
      g.strokeStyle = OLK; g.lineWidth = 1; g.beginPath(); g.moveTo(-3, 2); g.lineTo(-3, -.5); g.moveTo(0, 2); g.lineTo(0, -.5); g.moveTo(3, 2); g.lineTo(3, -.5); g.stroke();
      E(g, -5, -15, 2.4, 1.4, 'rgba(255,255,255,0.7)', -.4);
    } },
    weed: { w: 48, h: 42, base: 3, nv: 2, draw(g, v) {
      const rnd = mrng(120 + v);
      g.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const x = -12 + i * 3.4, h = 12 + rnd() * 18, lean = (rnd() - .5) * 14;
        g.strokeStyle = OLK; g.lineWidth = 3.2; g.beginPath(); g.moveTo(x, 2); g.quadraticCurveTo(x + lean * .3, -h * .5, x + lean, -h); g.stroke();
        g.strokeStyle = i % 2 ? '#8a8a3a' : '#a8a050'; g.lineWidth = 1.6; g.stroke();
      }
      const fl = v ? '#b86ad8' : '#d8506a';
      for (const f of [[-6, -26], [6, -22], [0, -32]]) {
        E(g, f[0], f[1], 4.4, 4.4, OLK);
        for (let k = 0; k < 7; k++) { const a = -PI + k / 6 * PI; g.strokeStyle = fl; g.lineWidth = 1.4; g.beginPath(); g.moveTo(f[0], f[1]); g.lineTo(f[0] + Math.cos(a) * 5.5, f[1] + Math.sin(a) * 5.5); g.stroke(); }
        E(g, f[0], f[1] + 1.4, 3, 2.4, '#5a7a2a');
      }
    } }
  };
  function snowPine(g, v, k) {
    const tiers = 4 + (k > 1.2 ? 1 : 0), H = 150 * k;
    trunk(g, -26 * k, 8 * k, 6 * k, OLS, '#3a2414', '#6a4424', '#2a180a');
    const dk = ['#1d4f5a', '#1f5a48', '#24485e'][v % 3], md = ['#2a6e72', '#2e7a5e', '#336680'][v % 3], lt = ['#3f8f8a', '#44996e', '#4a85a0'][v % 3];
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const yb = -22 * k - i * (H - 50 * k) / tiers, tw = (48 - t * 30) * k, th = (58 - t * 14) * k;
      const p = new Path2D();
      p.moveTo(0, yb - th);
      p.quadraticCurveTo(tw * .35, yb - th * .5, tw, yb);
      const n = 4;
      for (let q = 0; q < n; q++) { const x0 = tw - (2 * tw) * q / n, x1 = tw - (2 * tw) * (q + 1) / n; p.quadraticCurveTo((x0 + x1) / 2, yb + 8 * k, x1, yb); }
      p.quadraticCurveTo(-tw * .35, yb - th * .5, 0, yb - th);
      p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = OLS; g.stroke(p);
      g.fillStyle = dk; g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = md; g.beginPath(); g.moveTo(0, yb - th); g.lineTo(tw + 4, yb + 10); g.lineTo(-tw * .15, yb + 10); g.closePath(); g.fill();
      g.fillStyle = lt; g.beginPath(); g.moveTo(1, yb - th + 4); g.lineTo(tw * .9, yb + 2); g.lineTo(tw * .4, yb + 2); g.closePath(); g.fill();
      // kar
      const sn = new Path2D();
      sn.moveTo(0, yb - th - 1);
      sn.quadraticCurveTo(tw * .3, yb - th * .55, tw * .78, yb - th * .14);
      sn.quadraticCurveTo(tw * .55, yb - th * .05, tw * .4, yb - th * .2);
      sn.quadraticCurveTo(tw * .15, yb - th * .08, -tw * .1, yb - th * .24);
      sn.quadraticCurveTo(-tw * .4, yb - th * .06, -tw * .72, yb - th * .16);
      sn.quadraticCurveTo(-tw * .3, yb - th * .55, 0, yb - th - 1);
      sn.closePath();
      g.fillStyle = '#ffffff'; g.fill(sn);
      g.fillStyle = 'rgba(160,200,240,0.6)'; g.beginPath(); g.moveTo(-tw * .72, yb - th * .16); g.quadraticCurveTo(-tw * .3, yb - th * .55, 0, yb - th); g.lineTo(-tw * .1, yb - th * .24); g.quadraticCurveTo(-tw * .4, yb - th * .06, -tw * .72, yb - th * .16); g.fill();
      g.restore();
      g.lineWidth = 2.4; g.strokeStyle = OLS; g.stroke(p);
    }
    const sx = 0, sy = -22 * k - (tiers - 1) * (H - 50 * k) / tiers - (58 - 14) * k - 6;
    if (v === 2) { g.fillStyle = '#ffd23f'; g.beginPath(); sparkPath(g, sx, sy, 7 * k); g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#8a5a10'; g.stroke(); }
  }
  /** Dekor sprite'ı (varyant önbellekli) */
  /** mode: undefined = normal, 'b' = arka katman (tema pusu ile tonlanmış, derinlik), 'f' = bastırılmış ön süs (koyu ton) */
  const BACK_TINT = { forest: [null, .3], candy: [null, .3], snow: [null, .3], castle: ['#7a3e6e', .3] };
  function decorSpr(type, v, mode) {
    const d = DEC[type];
    if (!mode) return spr('dc:' + type + ':' + v, d.w, d.h, d.w / 2, d.h - d.base, g => d.draw(g, v));
    const P = pal(), bt = BACK_TINT[P.id] || BACK_TINT.forest;
    return spr('dc' + mode + ':' + P.id + ':' + type + ':' + v, d.w, d.h, d.w / 2, d.h - d.base, g => {
      d.draw(g, v);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = mode === 'b' ? rgba(bt[0] || P.haze, bt[1]) : 'rgba(50,12,34,0.22)';
      g.fillRect(-d.w * 1.5, -d.h * 2, d.w * 3, d.h * 3);
      g.globalCompositeOperation = 'source-over';
    });
  }
  /** Animasyonlu dekor ekleri */
  function decorAnim(ctx, d, sc, flip) {
    const t = tk, sd = (Math.abs(d.seed | 0) % 997) * .01, y0 = d.y + 2;
    switch (d.type) {
      case 'torch': flame(ctx, d.x, y0 - 72 * sc, sc * 1.05, t, sd); break;
      case 'lantern': {
        const x = d.x + 14 * sc * (flip ? -1 : 1), y = y0 - 42 * sc;
        const f = .8 + Math.sin(t * 9 + sd) * .08 + Math.sin(t * 23 + sd) * .05;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 * f;
        const gl = G.glowSprite('rgba(255,190,90,0.85)', 40);
        ctx.drawImage(gl.c, x - 40 * sc, y - 40 * sc, 80 * sc, 80 * sc);
        ctx.restore();
        ctx.save(); ctx.translate(x, y + 6 * sc); ctx.beginPath(); dropPath(ctx, 0, 0, 3.4 * sc, 10 * sc * f, Math.sin(t * 11 + sd)); ctx.fillStyle = '#fff2a0'; ctx.fill(); ctx.restore();
        break;
      }
      // kristal: parıltı/hale YOK (elmas para birimine benziyordu)
      case 'banner': wavingFlag(ctx, clanFlagSpr(), d.x, y0 - 132 * sc, sc * 1.05, t + sd, 5); break;
      default: if (DANIM_NEW[d.type]) DANIM_NEW[d.type](ctx, d, sc, flip, t, sd);
    }
  }
  const ANIMATED = { torch: 1, lantern: 1, banner: 1 };
  function drawDecor(ctx, L, layer, vx0, vx1) {
    const D = L.decor, back = layer === 'back';
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      const f2b = !!FRONT_TO_BACK[d.type];
      // engel/eşya sanılabilecek ön dekor (sandık, fıçı, kristal) arka geçişte, zemin kapağının arkasında çizilir
      if (back ? (d.layer !== 'back' && !f2b) : (d.layer !== 'front' || f2b)) continue;
      const def = DEC[d.type]; if (!def || decSkip.has(d)) continue;
      const sub = !back && FRONT_SUBDUE[d.type];
      const sc = (d.s || 1) * (back && d.layer === 'back' ? BACK_SC : sub ? .7 : 1);
      const half = def.w * sc * .5 + 10;
      if (d.x + half < vx0 || d.x - half > vx1) continue;
      const v = Math.floor(hash(d.seed | 0) * def.nv) % def.nv;
      const flip = !!d.flip && !def.noFlip;
      drawS(ctx, decorSpr(d.type, v, back ? 'b' : sub ? 'f' : undefined), d.x, d.y + (sub ? 6 : 2), sc, flip);
      if (ANIMATED[d.type]) decorAnim(ctx, d, sc, flip);
    }
  }

  /* =====================================================================
     ÖN PLAN: ortam parçacıkları (kendi listemiz, ekran içinde sarmalanan, parallax'lı) + ön tutamlar
     ===================================================================== */
  const amb = [];
  const AMB_N = { forest: 30, candy: 30, snow: 56, castle: 38 };
  function ambInit(id) {
    amb.length = 0;
    const n = Math.round((AMB_N[id] || 30) * (lowQ() ? .5 : 1));
    const rnd = mrng(4242 + id.length * 77);
    for (let i = 0; i < n; i++) {
      const p = { x: rnd() * 3000, y: rnd() * 1200, z: .72 + rnd() * .7, ph: rnd() * TAU, rot: rnd() * TAU, vr: (rnd() - .5) * 3, k: 0, s: 1, c: 0, vx: 0, vy: 0 };
      if (AMB_NEW[id]) AMB_NEW[id](p, i, rnd);
      else if (id === 'forest') {
        if (i % 3 === 0) { p.k = 1; p.vx = -18 - rnd() * 22; p.vy = 16 + rnd() * 16; p.s = .8 + rnd() * .5; p.c = (rnd() * 3) | 0; p.vr = (rnd() - .5) * 4; }
        else { p.k = 2; p.vx = -6 + rnd() * 4; p.vy = -4 - rnd() * 6; p.s = .8 + rnd() * 1.2; }
      } else if (id === 'candy') {
        if (i % 2) { p.k = 3; p.vx = -10 - rnd() * 10; p.vy = 18 + rnd() * 20; p.c = (rnd() * 7) | 0; p.vr = (rnd() - .5) * 6; }
        else { p.k = 4; p.vx = -4; p.vy = -3 - rnd() * 4; p.s = .45 + rnd() * .5; }
      } else if (id === 'snow') { p.k = 5; p.vx = -14 - rnd() * 18; p.vy = 24 + rnd() * 30; p.s = .8 + rnd() * 2.2; }
      else {
        if (i % 4) { p.k = 6; p.vx = 4 + rnd() * 12; p.vy = -18 - rnd() * 26; p.s = .8 + rnd() * 1.4; }
        else { p.k = 7; p.vx = -8; p.vy = 10 + rnd() * 10; p.s = 1 + rnd(); }
      }
      amb.push(p);
    }
  }
  function ambUpdate(dt) {
    for (let i = 0; i < amb.length; i++) { const p = amb[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.ph += dt; p.rot += p.vr * dt; }
  }
  function leafSpr(c) {
    return spr('leaf' + c, 18, 12, 9, 6, g => {
      const col = ['#6cc04a', '#b8d84a', '#e0a83a'][c];
      const p = new Path2D(); p.moveTo(-7, 0); p.quadraticCurveTo(0, -6, 7, 0); p.quadraticCurveTo(0, 6, -7, 0); p.closePath();
      g.lineWidth = 2; g.strokeStyle = '#2a4a12'; g.stroke(p); g.fillStyle = col; g.fill(p);
      g.strokeStyle = 'rgba(40,70,20,0.6)'; g.lineWidth = .8; g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.stroke();
    });
  }
  function flakeSpr() {
    return spr('flake', 16, 16, 8, 8, g => {
      g.fillStyle = RG(g, 0, 0, 0, 0, 0, 7, [[0, 'rgba(255,255,255,1)'], [.45, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]);
      g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
    });
  }
  function drawAmbient(ctx) {
    const VW = V.VW, VH = V.VH, cam = S.cam;
    const W = VW + 80, H = VH + 80;
    const cols = ['#ff4f7f', '#5ac8ff', '#ffe066', '#7be495', '#c08cff', '#ffffff', '#ff9a3c'];
    for (let i = 0; i < amb.length; i++) {
      const p = amb[i];
      const sx = ((p.x + Math.sin(p.ph * .9 + i) * 14 - cam.x * p.z) % W + W) % W - 40;
      const sy = ((p.y - cam.y * p.z * .7) % H + H) % H - 40;
      const x = cam.x + sx, y = cam.y + sy;
      const far = p.z > 1.2 ? .55 : 1;
      switch (p.k) {
        case 1: {
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.scale(p.s * p.z, p.s * p.z * (.6 + .4 * Math.abs(Math.sin(p.ph * 2.5))));
          ctx.globalAlpha = .9 * far; ctx.drawImage(leafSpr(p.c).c, -9, -6, 18, 12); ctx.restore();
          break;
        }
        case 2: case 4: {
          const tw = .5 + .5 * Math.sin(p.ph * 2 + i);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (.25 + tw * .45) * far;
          const gl = G.glowSprite(p.k === 2 ? 'rgba(255,250,190,0.9)' : 'rgba(255,255,255,0.95)', 8);
          const r = 8 * p.s * p.z;
          ctx.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
          ctx.restore();
          if (p.k === 4 && tw > .85) { ctx.globalAlpha = (tw - .85) * 6 * far; drawS(ctx, sparkleSpr(), x, y, .4 * p.z); ctx.globalAlpha = 1; }
          break;
        }
        case 3: {
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.globalAlpha = .9 * far;
          const k = p.z;
          ctx.fillStyle = cols[p.c]; ctx.beginPath(); rrp(ctx, -3.5 * k, -1.2 * k, 7 * k, 2.4 * k, 1.2 * k); ctx.fill();
          ctx.restore();
          break;
        }
        case 5: {
          const r = p.s * p.z * 1.6;
          ctx.globalAlpha = (p.z > 1.2 ? .55 : .9);
          ctx.drawImage(flakeSpr().c, x - r, y - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 6: {
          const fl = .6 + .4 * Math.sin(p.ph * 9 + i * 3);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = fl * .8 * far;
          const gl = G.glowSprite('rgba(255,140,50,0.95)', 10);
          const r = 9 * p.s * p.z;
          ctx.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
          ctx.fillStyle = '#fff0a0'; ctx.fillRect(x - .9, y - .9, 1.8, 1.8);
          ctx.restore();
          break;
        }
        case 7: {
          ctx.globalAlpha = .45 * far; ctx.fillStyle = '#c8b8d8';
          ctx.fillRect(x - p.s, y - p.s * .6, p.s * 2, p.s * 1.2);
          ctx.globalAlpha = 1;
          break;
        }
        default: ambDraw(ctx, p, x, y, far, i);
      }
    }
    ctx.globalAlpha = 1;
  }
  /** Ayakların önüne düşen küçük ön tutamlar */
  function fgTuftSpr(id, v) {
    if (FGT_NEW[id]) return FGT_NEW[id](v);
    return spr('fg:' + id + v, 34, 22, 17, 16, g => {
      const rnd = mrng(1900 + v * 13);
      if (id === 'forest' || id === 'castle') {
        const n = 6;
        for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
          const x = -10 + i * 4 + (rnd() - .5) * 2, h = 7 + rnd() * 7, lean = (rnd() - .5) * 8;
          const p = new Path2D(); p.moveTo(x - 2.2, 4); p.quadraticCurveTo(x - 1 + lean * .3, -h * .5, x + lean, -h); p.quadraticCurveTo(x + 1 + lean * .3, -h * .5, x + 2.2, 4); p.closePath();
          if (!pass) { g.lineWidth = 2.2; g.strokeStyle = id === 'forest' ? '#1d4710' : '#1f2a10'; g.stroke(p); }
          else { g.fillStyle = id === 'forest' ? (i % 2 ? '#9be056' : '#6fbf3e') : (i % 2 ? '#8a9a4a' : '#6a7a34'); g.fill(p); }
        }
      } else if (id === 'snow') {
        const p = new Path2D(); p.moveTo(-12, 4); p.quadraticCurveTo(-11, -4, -4, -4); p.quadraticCurveTo(1, -9, 6, -4); p.quadraticCurveTo(12, -3, 12, 4); p.closePath();
        g.lineWidth = 2; g.strokeStyle = '#2a4572'; g.stroke(p); g.fillStyle = LG(g, 0, -8, 0, 4, [[0, '#ffffff'], [1, '#d4e6f8']]); g.fill(p);
        E(g, -3, -4, 4, 1.2, '#ffffff');
      } else {
        const p = new Path2D(); p.moveTo(-9, 4); p.quadraticCurveTo(-10, -3, -3, -4); p.quadraticCurveTo(0, -11, 4, -5); p.quadraticCurveTo(10, -4, 9, 4); p.closePath();
        g.lineWidth = 2; g.strokeStyle = '#7a1a4a'; g.stroke(p); g.fillStyle = v % 2 ? '#fff6fb' : '#ffb3d6'; g.fill(p);
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(-4, -3, 5, 1.4);
        if (v === 0) { E(g, 1, -9, 3.2, 3.2, '#7a1a4a'); E(g, 1, -9, 2.4, 2.4, '#e8283c'); }
      }
    });
  }
  function drawFgTufts(ctx, P, vx0, vx1) {
    const id = P.id, st = 150;
    if (id in FGT_NEW && !FGT_NEW[id]) return;   // uzay/şehir: ön tutam yok
    for (const r of runs) {
      if (r.x > vx1 || r.x + r.w < vx0) continue;
      const a = Math.max(r.x + 14, vx0), b = Math.min(r.x + r.w - 14, vx1);
      for (let i = Math.ceil(a / st); i <= Math.floor(b / st); i++) {
        const h = hs(i, 9191); if (h > .5) continue;
        const x = i * st + h * 60; if (x < r.x + 14 || x > r.x + r.w - 14) continue;
        let bad = false;
        for (const z of hazZones) if (x > z[0] - 10 && x < z[1] + 10) { bad = true; break; }
        if (bad) continue;
        drawS(ctx, fgTuftSpr(id, (h * 6) | 0), x, r.y + 5, .9 + h * .5, h > .25);
      }
    }
  }

  /* ==== YENİ TEMALAR BAŞLANGIÇ ==== */
  /* =====================================================================
     YENİ TEMALAR: Çöl Tapınağı, Uzay İstasyonu, Gece Şehri, Tropik Ada
     + yeni seviye öğeleri: buz, bataklık kum, yuvarlanan kaya, rüzgâr bacası / gayzer, ışınlanma kapısı,
       düşük yerçekimi, trambolin, sallanan köprü, eleme kapısı, meteor uyarı gölgesi, düşen altın.
     Aynı teknikler: pahalı her şey sprite/desen/Path2D önbelleğinde; sıcak döngüde shadowBlur/filter yok.
     ===================================================================== */
  PAL.forest.sunFy = .02; PAL.candy.sunFy = .02; PAL.snow.sunFy = .025; PAL.castle.sunFy = .03;
  Object.assign(PAL, {
    desert: {
      id: 'desert', ol: '#3a1e0a', sunFy: .02,
      sky: [[0, '#3f7ccc'], [.3, '#74abdc'], [.56, '#bcd6de'], [.78, '#f4dcaa'], [1, '#ffe9bf']],
      haze: '#f4d9a8',
      sun: { x: .76, y: 92, r: 40, core: '#ffffff', mid: '#fff7d6', edge: '#ffd77a', halo: '#fff1c4', rays: '#fff6dc', raysA: .26, add: false },
      cloud: { lit: '#fffaf0', mid: '#fbeedc', shade: '#ecd3b4', deep: '#d8b48e' }
    },
    space: {
      id: 'space', ol: '#0a0820', sunFy: .01,
      sky: [[0, '#03021a'], [.35, '#0b0932'], [.68, '#1c1356'], [1, '#2e1d74']],
      haze: '#36277a',
      sun: { x: .13, y: 70, r: 13, core: '#ffffff', mid: '#e6f3ff', edge: '#8cc4ff', halo: '#7f9cff', rays: '#b4c8ff', raysA: .16, add: true },
      cloud: { lit: '#8a6ad8', mid: '#5a3aa8', shade: '#3a2278', deep: '#24144e', inv: true }
    },
    city: {
      id: 'city', ol: '#0a0618', sunFy: .015,
      sky: [[0, '#050720'], [.3, '#10144a'], [.6, '#2c1f68'], [.83, '#82387e'], [1, '#e2608a']],
      haze: '#6e3586',
      sun: { x: .8, y: 84, r: 27, core: '#fffef6', mid: '#f4f0dc', edge: '#d6cfb4', halo: '#b8c4ff', rays: '#dfe4ff', raysA: 0, add: false, moon: true },
      cloud: { lit: '#7e4e9e', mid: '#56367c', shade: '#3a225e', deep: '#221340', inv: true }
    },
    tropic: {
      id: 'tropic', ol: '#163a2a', sunFy: .02,
      sky: [[0, '#1170d2'], [.3, '#35a0ea'], [.6, '#88d2f5'], [.84, '#cdf0fb'], [1, '#effbff']],
      haze: '#c4ecf8',
      sun: { x: .3, y: 80, r: 38, core: '#fffef4', mid: '#fff6be', edge: '#ffdc6e', halo: '#fff8da', rays: '#fffbe8', raysA: .3, add: false },
      cloud: { lit: '#ffffff', mid: '#f0f8ff', shade: '#cfe3f5', deep: '#a8c6e6' }
    }
  });
  /** render-world bu temayı tam çizebiliyor mu (game.readyThemes rastgele/demo havuzu için) */
  R.themeReady = id => !!(PAL[id] && BG[id] && PATS[id] && CAPS[id]);

  /* ---------- gökyüzü: güneş halesi/ışınları (önbelleğe) + disk (canlı, keskin) ---------- */
  function sunGlow(g, P, x, y) {
    const s = P.sun, r = s.r;
    const halo = bsprite(P.id + ':halo', r * 14, r * 14, r * 7, r * 7, h => {
      h.fillStyle = RG(h, 0, 0, 0, 0, 0, r * 7, [[0, rgba(s.halo, .95)], [.1, rgba(s.halo, .6)], [.3, rgba(s.halo, .2)], [.6, rgba(s.halo, .06)], [1, rgba(s.halo, 0)]]);
      h.fillRect(-r * 7, -r * 7, r * 14, r * 14);
    }, .3);
    g.save();
    if (s.add) g.globalCompositeOperation = 'lighter';
    drawS(g, halo, x, y);
    if (s.raysA > 0 && !lowQ()) {
      const rays = bsprite(P.id + ':rays', 1000, 1000, 500, 500, h => {
        h.fillStyle = RG(h, 0, 0, 0, 0, 0, 500, [[0, rgba(s.rays, .9)], [.18, rgba(s.rays, .45)], [.55, rgba(s.rays, .12)], [1, rgba(s.rays, 0)]]);
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * TAU + (i % 3) * .07, w = i % 2 ? .05 : .09;
          h.beginPath(); h.moveTo(0, 0); h.arc(0, 0, 500, a - w, a + w); h.closePath(); h.fill();
        }
      }, .25);
      g.globalAlpha = s.raysA * .92; g.translate(x, y); g.rotate(.21);
      g.drawImage(rays.c, -500, -500, 1000, 1000);
    }
    g.restore();
  }
  function sunDisk(ctx, P, x, y) {
    const s = P.sun, r = s.r;
    if (s.moon) {
      drawS(ctx, bsprite(P.id + ':moon', r * 2 + 20, r * 2 + 20, r + 10, r + 10, g => {
        g.fillStyle = rgba(s.halo, .35); g.beginPath(); g.arc(0, 0, r + 7, 0, TAU); g.fill();
        g.fillStyle = RG(g, -r * .35, -r * .35, 0, 0, 0, r, [[0, s.core], [.6, s.mid], [1, s.edge]]);
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
        g.save(); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
        const cr = [[-.35, -.2, .22], [.25, .3, .17], [.32, -.38, .12], [-.1, .45, .1], [-.5, .28, .08], [.05, -.05, .09]];
        for (const c of cr) { E(g, c[0] * r + 1, c[1] * r + 1, c[2] * r, c[2] * r * .9, 'rgba(255,255,255,0.35)'); E(g, c[0] * r, c[1] * r, c[2] * r, c[2] * r * .9, 'rgba(150,140,120,0.35)'); }
        g.fillStyle = 'rgba(70,60,120,0.18)'; g.beginPath(); g.arc(r * .5, r * .2, r * 1.05, 0, TAU); g.fill();
        g.restore();
      }, 1), x, y);
      return;
    }
    drawS(ctx, bsprite(P.id + ':sun', r * 2 + 16, r * 2 + 16, r + 8, r + 8, g => {
      g.fillStyle = rgba(s.halo, .5); g.beginPath(); g.arc(0, 0, r + 6, 0, TAU); g.fill();
      g.fillStyle = RG(g, -r * .3, -r * .3, 0, 0, 0, r, [[0, s.core], [.55, s.mid], [1, s.edge]]);
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      if (!s.add) { g.fillStyle = rgba('#ffffff', .55); g.beginPath(); g.ellipse(-r * .32, -r * .36, r * .34, r * .2, -.6, 0, TAU); g.fill(); }
    }, 1), x, y);
  }
  /** Temaya özel SABİT uzak katmanlar (önbellek tuvaline bir kez çizilir; sabit konumlu) */
  const FAR = {
    candy(g, P, VW) {
      const cx = VW * .3, cy = 500, cols = ['#ff5e86', '#ffa64d', '#ffe066', '#7fe39a', '#6ec8ff', '#b892ff'];
      g.save(); g.globalAlpha = .3; g.lineWidth = 12;
      for (let i = 0; i < cols.length; i++) { g.strokeStyle = cols[i]; g.beginPath(); g.arc(cx, cy, 360 - i * 11.5, PI * 1.02, PI * 1.98); g.stroke(); }
      g.restore();
    },
    space(g, P, VW, VH) {
      const rnd = mrng(777);
      g.save(); g.globalCompositeOperation = 'lighter';
      // samanyolu bandı
      g.save(); g.translate(VW * .52, 150); g.rotate(-.22); g.scale(1, .13);
      g.fillStyle = RG(g, 0, 0, 0, 0, 0, VW * .62, [[0, 'rgba(200,190,255,0.16)'], [.5, 'rgba(150,140,255,0.07)'], [1, 'rgba(120,100,255,0)']]);
      g.fillRect(-VW * .62, -VW * .62, VW * 1.24, VW * 1.24); g.restore();
      // nebula bulutları
      const blobs = [[.2, 150, 250, '#7a2aff', .22], [.47, 105, 190, '#ff3aa8', .12], [.7, 200, 300, '#2ab8ff', .15], [.92, 90, 170, '#9a4aff', .18], [.36, 260, 220, '#2a6aff', .12]];
      for (const b of blobs) {
        const x = VW * b[0];
        g.fillStyle = RG(g, x, b[1], 0, x, b[1], b[2], [[0, rgba(b[3], b[4])], [.5, rgba(b[3], b[4] * .45)], [1, rgba(b[3], 0)]]);
        g.fillRect(x - b[2], b[1] - b[2], b[2] * 2, b[2] * 2);
      }
      const wc = ['#b06aff', '#5ad0ff', '#ff6ac8'];
      for (let i = 0; i < 16; i++) {
        const x = rnd() * VW, y = 50 + rnd() * 270;
        g.save(); g.translate(x, y); g.rotate(-.5 + rnd() * .4); g.scale(1, .22 + rnd() * .1);
        g.fillStyle = RG(g, 0, 0, 0, 0, 0, 130, [[0, rgba(wc[i % 3], .13)], [1, rgba(wc[i % 3], 0)]]);
        g.fillRect(-130, -130, 260, 260); g.restore();
      }
      g.restore();
      // sabit yıldız tozu
      for (let i = 0; i < 340; i++) {
        const x = rnd() * VW, y = rnd() * VH * .88 - 30;
        g.globalAlpha = .12 + rnd() * .55; g.fillStyle = rnd() < .25 ? '#bcd4ff' : '#ffffff';
        const s = rnd() < .9 ? .8 : 1.5; g.fillRect(x, y, s, s);
      }
      g.globalAlpha = 1;
    },
    city(g, P, VW, VH) {
      const rnd = mrng(661);
      for (let i = 0; i < 70; i++) { g.globalAlpha = .1 + rnd() * .4; g.fillStyle = '#ffffff'; g.fillRect(rnd() * VW, rnd() * VH * .45, 1, 1); }
      g.globalAlpha = 1;
      // şehir ışıklarının ufuktaki pembe parıltısı
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = LG(g, 0, 250, 0, VH, [[0, 'rgba(255,90,160,0)'], [.6, 'rgba(255,100,150,0.14)'], [1, 'rgba(255,140,120,0.22)']]);
      g.fillRect(0, 250, VW, VH - 250); g.restore();
    }
  };
  const farC = { key: '', c: null, pad: 44 };
  /** Gök gradyanı + güneş halesi/ışınları + temaya özel sabit uzak katman: ekran boyutlu tek önbellek tuvali
      (karede 1 drawImage; eskiden tam ekran gradyan + ~800 px hale + 1000 px dönen ışınlar ayrı ayrı dolduruluyordu) */
  function farSky(ctx, P, VW, VH) {
    const pad = farC.pad, k = clamp(Math.min(G.rs(), 1.5), .5, 1.5);
    const key = P.id + ':' + Math.round(VW) + 'x' + Math.round(VH) + '@' + k + (lowQ() ? 'L' : '');
    if (farC.key !== key || !farC.c) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(VW * k)); c.height = Math.max(1, Math.ceil((VH + pad * 2) * k));
      const g = c.getContext('2d');
      g.scale(c.width / VW, c.height / (VH + pad * 2)); g.translate(0, pad);
      g.fillStyle = LG(g, 0, 0, 0, VH, P.sky); g.fillRect(0, -pad, VW, VH + pad * 2);
      try { if (FAR[P.id]) FAR[P.id](g, P, VW, VH); sunGlow(g, P, VW * P.sun.x, P.sun.y); }
      catch (e) { console.error('[uzak gök]', e); }
      farC.c = c; farC.key = key;
    }
    const yo = clamp(-(S.cam.y - 100) * (P.sunFy || .02), -pad, pad);
    ctx.drawImage(farC.c, 0, -pad + yo, VW + .5, VH + pad * 2);
  }

  /* ---------- ortak: palmiye, kaktüs (dekor + arka plan siluetleri) ---------- */
  /** Palmiye: taban (0,0), yükseklik H, eğim lean (−..+), c = {trunk, trunkD, ring, leaf, leafD, leafL, ol, nut} */
  function palmDraw(g, H, lean, c, v) {
    const tx = lean * H, ty = -H, wb = H * .05 + 3.5, wt = H * .03 + 2.2;
    const p = new Path2D();
    p.moveTo(-wb, 2); p.quadraticCurveTo(tx * .15 - wb * .7, ty * .55, tx - wt, ty);
    p.lineTo(tx + wt, ty); p.quadraticCurveTo(tx * .15 + wb * .7, ty * .55, wb, 2); p.closePath();
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (c.ol) { g.lineWidth = 3; g.strokeStyle = c.ol; g.stroke(p); }
    g.fillStyle = c.trunkD ? LG(g, -wb, 0, wb, 0, [[0, c.trunkD], [.5, c.trunk], [1, c.trunkD]]) : c.trunk; g.fill(p);
    if (c.ring) {
      g.save(); g.clip(p); g.strokeStyle = c.ring; g.lineWidth = 1.5;
      for (let i = 1; i < 14; i++) {
        const t = i / 14, x = 2 * (1 - t) * t * tx * .15 + t * t * tx, y = 2 * (1 - t) * t * ty * .55 + t * t * ty, w = wb + (wt - wb) * t + 1;
        g.beginPath(); g.moveTo(x - w, y + 1); g.quadraticCurveTo(x, y + 3.5, x + w, y + 1); g.stroke();
      }
      g.restore();
    }
    const n = 7, Lf = H * (.46 + (v || 0) * .03);
    const angs = [-2.95, -2.45, -1.95, -1.25, -.62, -.12, .32];
    const leaves = [];
    for (let i = 0; i < n; i++) {
      const a = angs[i] + (v || 0) * .05, dx = Math.cos(a), dy = Math.sin(a);
      const ex = tx + dx * Lf, ey = ty + dy * Lf * .55 + Lf * .42;
      const cx = tx + dx * Lf * .5, cy = ty + dy * Lf * .5 - Lf * .16;
      const nx = -(ey - ty), ny = ex - tx, nl = Math.hypot(nx, ny) || 1, wd = Lf * .17;
      const lf = new Path2D();
      lf.moveTo(tx, ty); lf.quadraticCurveTo(cx + nx / nl * wd, cy + ny / nl * wd, ex, ey);
      lf.quadraticCurveTo(cx - nx / nl * wd * .5, cy - ny / nl * wd * .5, tx, ty); lf.closePath();
      leaves.push([lf, cx, cy, ex, ey, i]);
    }
    for (const L2 of leaves) { if (c.ol) { g.lineWidth = 2.6; g.strokeStyle = c.ol; g.stroke(L2[0]); } }
    for (const L2 of leaves) {
      g.fillStyle = L2[5] % 2 ? c.leaf : (c.leafL || c.leaf); g.fill(L2[0]);
      if (c.leafD) { g.strokeStyle = c.leafD; g.lineWidth = 1.3; g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(L2[1], L2[2], L2[3], L2[4]); g.stroke(); }
    }
    if (c.nut) for (const o of [[-4, 5], [4, 6], [0, 9]]) { E(g, tx + o[0], ty + o[1], 4.4, 4.4, c.ol || c.nut); E(g, tx + o[0], ty + o[1], 3.4, 3.4, c.nut); }
  }
  /** Saguaro kaktüsü: taban (0,0), yükseklik H */
  function saguaro(g, H, c, v) {
    const p = new Path2D(), w = H * .09 + 4;
    rrp(p, -w, -H, w * 2, H + 2, w);
    const a1 = -H * (.55 + (v % 2) * .08), a2 = -H * (.7 - (v % 2) * .1);
    rrp(p, -w * 3.2, a1, w * 1.5, H * .36, w * .75); rrp(p, -w * 3.2, a1 + H * .28, w * 3, w * 1.4, w * .7);
    if (v !== 1) { rrp(p, w * 1.7, a2, w * 1.5, H * .3, w * .75); rrp(p, -w * .5, a2 + H * .24, w * 3.6, w * 1.4, w * .7); }
    if (c.ol) { g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = c.ol; g.stroke(p); }
    g.fillStyle = c.body; g.fill(p);
    if (c.lit) {
      g.save(); g.clip(p);
      g.strokeStyle = c.rib; g.lineWidth = 1.3;
      for (let x = -w * 3; x < w * 3.5; x += w * .55) { g.beginPath(); g.moveTo(x, -H); g.lineTo(x, 2); g.stroke(); }
      g.fillStyle = c.lit; g.fillRect(-w * .55, -H, w * .45, H); g.fillRect(-w * 2.9, a1, w * .4, H * .34); if (v !== 1) g.fillRect(w * 2, a2, w * .4, H * .28);
      g.restore();
    }
  }

  /* =====================================================================
     ÇÖL TAPINAĞI — arka plan
     ===================================================================== */
  const DS = {
    far: { lit: '#f2cfa2', shade: '#d6a882', line: 'rgba(150,100,70,0.2)', cap: '#ffe7a8', haze: '#f4d9a8', hazeA: .32 },
    far2: { lit: '#f3dcbb', shade: '#e2c0a0', line: 'rgba(150,100,70,0.12)', cap: '#fff0c8', haze: '#f4d9a8', hazeA: .5 }
  };
  function pyrSpr(key, v, c) {
    return bsprite(key, 540, 270, 270, 262, g => {
      const pyr = (cx, w, h) => {
        const ax = cx + w * .04, ay = -h, rb = cx - w * .1;
        const sh = new Path2D(); sh.moveTo(cx - w / 2, 0); sh.lineTo(ax, ay); sh.lineTo(rb, 0); sh.closePath();
        const lt = new Path2D(); lt.moveTo(rb, 0); lt.lineTo(ax, ay); lt.lineTo(cx + w / 2, 0); lt.closePath();
        g.fillStyle = c.shade; g.fill(sh); g.fillStyle = c.lit; g.fill(lt);
        g.strokeStyle = c.line; g.lineWidth = 1.2;
        for (let y = -h + 10; y < 0; y += 9) {
          const t = -y / h, xl = cx - w / 2 + (ax - (cx - w / 2)) * t, xr = cx + w / 2 + (ax - (cx + w / 2)) * t;
          g.beginPath(); g.moveTo(xl, y); g.lineTo(xr, y); g.stroke();
        }
        g.fillStyle = c.cap; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + w * .045, ay + h * .09); g.lineTo(ax - w * .04, ay + h * .09); g.closePath(); g.fill();
        g.strokeStyle = rgba('#fff6e0', .55); g.lineWidth = 1.4; g.beginPath(); g.moveTo(ax, ay); g.lineTo(rb, 0); g.stroke();
      };
      if (v === 0) { pyr(-40, 330, 200); pyr(150, 170, 92); }
      else if (v === 1) { pyr(-140, 200, 112); pyr(30, 300, 176); pyr(190, 150, 80); }
      else if (v === 2) {
        const m = new Path2D(); m.moveTo(-220, 0); m.lineTo(-170, -118); m.lineTo(-150, -132); m.lineTo(90, -136); m.lineTo(118, -120); m.lineTo(150, -60); m.lineTo(210, 0); m.closePath();
        g.fillStyle = c.shade; g.fill(m);
        g.save(); g.clip(m);
        g.fillStyle = c.lit; g.beginPath(); g.moveTo(-60, -140); g.lineTo(130, -140); g.lineTo(220, 0); g.lineTo(-10, 0); g.closePath(); g.fill();
        g.strokeStyle = c.line; g.lineWidth = 2;
        for (let y = -120; y < 0; y += 16) { g.beginPath(); g.moveTo(-230, y); g.quadraticCurveTo(0, y + 4, 230, y - 2); g.stroke(); }
        g.restore();
      } else {
        // tapınak kalıntısı: basamaklı kaide + sütunlar + kırık alınlık
        g.fillStyle = c.shade; g.fillRect(-200, -22, 400, 22); g.fillRect(-180, -38, 360, 18); g.fillRect(-160, -50, 320, 14);
        g.fillStyle = c.lit; g.fillRect(-10, -22, 210, 22); g.fillRect(0, -38, 180, 18); g.fillRect(10, -50, 150, 14);
        for (let i = 0; i < 7; i++) {
          if (i === 5) continue;
          const x = -140 + i * 46, h = i === 2 ? 70 : 120;
          g.fillStyle = c.shade; g.fillRect(x - 9, -50 - h, 18, h); g.fillStyle = c.lit; g.fillRect(x, -50 - h, 9, h);
          g.fillStyle = c.cap; g.fillRect(x - 12, -56 - h, 24, 7);
        }
        g.fillStyle = c.shade; g.beginPath(); g.moveTo(-160, -176); g.lineTo(60, -176); g.lineTo(40, -194); g.lineTo(-120, -200); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(c.haze, c.hazeA); g.fillRect(-270, -270, 540, 280);
    }, .7);
  }
  function desSil(kind, v, col) {
    const key = 'desert:sil:' + kind + v + col;
    if (kind === 'palm') return bsprite(key, 120, 150, 60, 146, g => palmDraw(g, 104 + v * 12, (v - 1) * .1, { trunk: col, leaf: col, leafD: shade(col, -.18), ol: null }, v), .8);
    if (kind === 'obel') return bsprite(key, 40, 150, 20, 146, g => {
      const h = 112 + v * 12;
      g.fillStyle = col; g.beginPath(); g.moveTo(-9, 2); g.lineTo(-6, -h); g.lineTo(0, -h - 12); g.lineTo(6, -h); g.lineTo(9, 2); g.closePath(); g.fill();
      g.fillStyle = rgba('#fff0c8', .28); g.beginPath(); g.moveTo(0, -h - 12); g.lineTo(6, -h); g.lineTo(9, 2); g.lineTo(2, 2); g.closePath(); g.fill();
    }, .8);
    if (kind === 'cact') return bsprite(key, 70, 110, 35, 106, g => saguaro(g, 64 + v * 12, { body: col }, v), .8);
    return bsprite(key, 100, 90, 50, 86, g => {
      const p = new Path2D(); p.moveTo(-34, 2); p.quadraticCurveTo(-30, -30, -16, -40); p.quadraticCurveTo(-22, -58, -10, -66 - v * 6); p.quadraticCurveTo(8, -72 - v * 6, 12, -56); p.quadraticCurveTo(26, -44, 20, -24); p.quadraticCurveTo(34, -12, 38, 2); p.closePath();
      g.fillStyle = col; g.fill(p);
      g.save(); g.clip(p); g.strokeStyle = shade(col, -.15); g.lineWidth = 2; for (let y = -60; y < 0; y += 12) { g.beginPath(); g.moveTo(-40, y); g.lineTo(40, y + 3); g.stroke(); } g.restore();
    }, .8);
  }
  /** Ufukta titreyen sıcak hava (birkaç ince yarı saydam şerit) */
  function heatShimmer(ctx, y) {
    if (lowQ()) return;
    const VW = V.VW;
    ctx.save(); ctx.fillStyle = '#fff4dc';
    for (let k = 0; k < 4; k++) {
      ctx.globalAlpha = .07 + .05 * Math.sin(tk * 1.7 + k * 1.9);
      const yy = y - 14 + k * 9 + Math.sin(tk * 2.3 + k) * 1.5;
      ctx.fillRect(0, yy, VW, 2.2);
    }
    ctx.restore();
  }
  Object.assign(BUSH, {
    desert: { salt: 650, f: .38, fy: .2, base: 498, sp: 38, r0: 12, r1: 24, amp: 12, p: 1.9, dark: '#9e5c2c', lit: '#c98244', hi: null, dots: null, fog: '#3a1a06', crag: true },
    tropic: { salt: 680, f: .38, fy: .2, base: 494, sp: 30, r0: 15, r1: 28, amp: 13, p: 2.6, dark: '#1f6a4a', lit: '#2f8c52', hi: 'rgba(190,255,150,0.35)', dots: ['#ff5a8a', '#ffd84a', '#ff8a3a', '#ffffff'], fog: '#06302a' }
  });
  BG.desert = function (ctx, P, VW) {
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .02));
    clouds(ctx, P, { salt: 141, f: .012, fy: .012, wind: 3, slot: 470, prob: .5, y0: 40, y1: 130, sc0: .55, sc1: .85, a: .6, sx: 1.9, sy: .36 });
    mountains(ctx, { salt: 252, f: .03, fy: .028, base: 352, slot: 300, sc0: .62, sc1: .95, nv: 4, w: 540, prob: .92,
      spr: (v, pass) => pyrSpr('desert:py' + v + pass, v, pass ? DS.far : DS.far2), fill: mix(DS.far.shade, P.haze, .45) });
    haze(ctx, P, ly(352, .028), 90, .5);
    heatShimmer(ctx, ly(356, .028));
    hills(ctx, P, { salt: 454, f: .1, fy: .06, base: 386, amp: 46, k1: .0042, k2: .011, p: 1.7,
      stops: [[0, '#f4d39a'], [.4, '#e6b878'], [1, '#d6a264']], rim: 'rgba(255,248,220,0.9)', rimW: 2.5,
      trees: { sp: 96, prob: .34, kinds: ['palm', 'palm', 'obel'], sc0: .38, sc1: .58, sink: 8, spr: (k, v) => desSil(k, v, '#c2946a') } });
    haze(ctx, P, ly(404, .06), 70, .3);
    hills(ctx, P, { salt: 555, f: .22, fy: .12, base: 428, amp: 40, k1: .0058, k2: .016, p: 4.6,
      stops: [[0, '#e9ad68'], [.4, '#d49252'], [1, '#b4743e']], rim: 'rgba(255,230,176,0.85)', rimW: 2.5,
      trees: { sp: 74, prob: .42, kinds: ['cact', 'cact', 'rock'], sc0: .55, sc1: .82, sink: 10, spr: (k, v) => desSil(k, v, '#94603a') } });
    haze(ctx, P, ly(462, .12), 60, .2);
    bushLine(ctx, P, BUSH.desert);
    birds(ctx, 'rgba(70,40,20,0.7)', 3, 151, false);
  };

  /* =====================================================================
     UZAY İSTASYONU — arka plan
     ===================================================================== */
  let _lt = null;
  const withLights = s => { if (!s.lights) s.lights = _lt || []; _lt = null; return s; };
  /** Sabit aralıklı siluet katmanı (+ yanıp sönen ikaz ışıkları: sprite.lights yerel koordinatta) */
  function silLayer(ctx, o) {
    const VW = V.VW, VH = V.VH;
    const off = S.cam.x * o.f, yb = ly(o.base, o.fy), m = (o.w || 400) * o.sc1 * .6;
    const i0 = Math.floor((off - m) / o.slot), i1 = Math.floor((off + VW + m) / o.slot);
    const lit = o.lights && !lowQ();
    for (let i = i0; i <= i1; i++) {
      if (hs(i, o.salt) > o.prob) continue;
      const v = (hs(i, o.salt + 1) * o.nv) | 0, sc = o.sc0 + (o.sc1 - o.sc0) * hs(i, o.salt + 2);
      const x = i * o.slot + (hs(i, o.salt + 3) - .5) * o.slot * .3 - off;
      const s = o.spr(v);
      drawS(ctx, s, x, yb, sc);
      if (lit && s.lights) {
        for (let j = 0; j < s.lights.length; j++) {
          const L2 = s.lights[j], ph = (tk * (L2[3] || .7) + hs(i * 7 + j, o.salt + 9) * 2) % 1.4;
          if (ph > .32) continue;
          const a = Math.sin(ph / .32 * PI), lx = x + L2[0] * sc, lyy = yb + L2[1] * sc;
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .85;
          drawS(ctx, G.glowSprite(L2[2] || 'rgba(255,60,60,0.95)', 10), lx, lyy, .9 + sc * .4);
          ctx.restore();
          ctx.globalAlpha = a; ctx.fillStyle = '#ffffff'; ctx.fillRect(lx - 1, lyy - 1, 2, 2); ctx.globalAlpha = 1;
        }
      }
    }
    if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(0, yb + 1, VW, VH - yb + 2); }
    return yb;
  }
  const SP = {
    far: { body: '#251f58', dark: '#1a1544', lit: '#3a3478', panel: '#2a4a9a', win: '#8fe8ff', haze: '#36277a', hazeA: .35 },
    mid: { body: '#1c1846', dark: '#120f30', lit: '#36306e', panel: '#2a58b8', win: '#a8f2ff', haze: '#36277a', hazeA: .12 }
  };
  function stationSpr(key, v, c) {
    return withLights(bsprite(key, 440, 260, 220, 256, g => {
      const lights = [];
      const mod = (x, y, w, h, r) => { g.fillStyle = c.body; g.beginPath(); rrp(g, x, y, w, h, r); g.fill(); g.fillStyle = c.lit; g.fillRect(x + r * .4, y + 2, w - r * .8, 3); };
      const wins = (x, y, n, sp) => { g.fillStyle = c.win; for (let i = 0; i < n; i++) if ((i * 7 + v) % 3) g.fillRect(x + i * sp, y, 4, 3); };
      const truss = (x0, y0, x1, y1) => { g.strokeStyle = c.dark; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.lineWidth = 1; g.strokeStyle = c.lit; g.beginPath(); g.moveTo(x0, y0 - 2); g.lineTo(x1, y1 - 2); g.stroke(); };
      const panel = (x, y, w, h) => {
        g.fillStyle = c.panel; g.fillRect(x, y, w, h);
        g.strokeStyle = rgba('#0a0a2a', .6); g.lineWidth = 1;
        for (let xx = x + 8; xx < x + w; xx += 8) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); }
        g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
        g.fillStyle = 'rgba(180,220,255,0.25)'; g.fillRect(x, y, w, 2);
      };
      // zemin kaidesi
      g.fillStyle = c.dark; g.fillRect(-200, -26, 400, 30);
      if (v === 0) {
        truss(-180, -120, 180, -120);
        panel(-200, -150, 70, 26); panel(130, -150, 70, 26); panel(-200, -114, 70, 26); panel(130, -114, 70, 26);
        g.fillStyle = c.body; g.beginPath(); g.arc(0, -120, 44, 0, TAU); g.fill();
        g.fillStyle = c.lit; g.beginPath(); g.arc(-8, -128, 30, PI * 1.1, PI * 1.6); g.lineTo(-8, -128); g.fill();
        g.fillStyle = c.win; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.fillRect(Math.cos(a) * 30 - 2, -120 + Math.sin(a) * 30 - 2, 4, 4); }
        mod(-24, -80, 48, 56, 8); wins(-16, -60, 5, 7);
        g.fillStyle = c.dark; g.fillRect(-3, -200, 6, 40); lights.push([0, -202, 'rgba(255,60,60,0.95)', .8]);
        lights.push([-200, -152, 'rgba(120,255,160,0.95)', .55], [200, -152, 'rgba(255,60,60,0.95)', .62]);
      } else if (v === 1) {
        mod(-22, -210, 44, 190, 10); wins(-14, -190, 4, 8); wins(-14, -150, 4, 8); wins(-14, -110, 4, 8);
        g.strokeStyle = c.body; g.lineWidth = 9; g.beginPath(); g.ellipse(0, -160, 96, 24, 0, PI, TAU); g.stroke();
        g.lineWidth = 9; g.beginPath(); g.ellipse(0, -160, 96, 24, 0, 0, PI); g.stroke();
        g.strokeStyle = c.lit; g.lineWidth = 2; g.beginPath(); g.ellipse(0, -162, 96, 24, 0, PI * 1.1, PI * 1.9); g.stroke();
        mod(60, -90, 90, 36, 14); wins(72, -76, 8, 9);
        mod(-150, -70, 90, 40, 16); wins(-138, -54, 8, 9);
        g.fillStyle = c.dark; g.fillRect(-2, -248, 4, 40); lights.push([0, -250, 'rgba(255,60,60,0.95)', .7], [96, -160, 'rgba(255,255,255,0.95)', 1.1]);
      } else {
        for (let i = 0; i < 4; i++) { mod(-190 + i * 92, -78 - (i % 2) * 14, 84, 52 + (i % 2) * 14, 18); wins(-178 + i * 92, -60 - (i % 2) * 10, 7, 9); }
        truss(-150, -110, 150, -110);
        // çanak anten
        g.save(); g.translate(120, -150); g.rotate(-.5);
        g.fillStyle = c.body; g.beginPath(); g.ellipse(0, 0, 34, 12, 0, 0, PI); g.fill();
        g.fillStyle = c.lit; g.beginPath(); g.ellipse(0, 0, 34, 4, 0, 0, TAU); g.fill();
        g.strokeStyle = c.dark; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -22); g.stroke();
        g.restore();
        g.fillStyle = c.dark; g.fillRect(116, -146, 8, 40);
        g.fillStyle = c.body; g.beginPath(); g.arc(-110, -100, 30, PI, 0); g.fill();
        g.fillStyle = rgba(c.win, .35); g.beginPath(); g.arc(-110, -100, 24, PI, 0); g.fill();
        lights.push([120, -176, 'rgba(255,60,60,0.95)', .9], [-190, -96, 'rgba(120,255,160,0.95)', .6]);
      }
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(c.haze, c.hazeA); g.fillRect(-220, -260, 440, 270);
      _lt = lights;
    }, .7));
  }
  /** Yakın ufuk siluetleri: direkler, tanklar, kubbeler */
  function spaceSil(kind, v) {
    const key = 'space:sil:' + kind + v, col = '#120f2c', rim = 'rgba(110,220,255,0.55)';
    return withLights(bsprite(key, 120, 170, 60, 166, g => {
      const lights = [];
      g.fillStyle = col;
      if (kind === 'mast') {
        const h = 120 + v * 14;
        g.fillRect(-3, -h, 6, h + 2); g.strokeStyle = col; g.lineWidth = 2;
        for (let y = -h + 10; y < -10; y += 16) { g.beginPath(); g.moveTo(-14, y + 14); g.lineTo(14, y); g.moveTo(14, y + 14); g.lineTo(-14, y); g.stroke(); }
        g.fillRect(-16, -18, 32, 20);
        g.fillStyle = rim; g.fillRect(2, -h, 1.5, h - 20);
        lights.push([0, -h - 2, 'rgba(255,60,60,0.95)', .75]);
      } else if (kind === 'tank') {
        g.beginPath(); rrp(g, -30, -70, 60, 72, 28); g.fill();
        g.fillRect(-36, -16, 72, 18);
        g.fillStyle = rim; g.fillRect(18, -60, 2, 40);
        lights.push([0, -72, 'rgba(120,255,160,0.95)', .5]);
      } else {
        g.beginPath(); g.arc(0, 0, 48, PI, 0); g.fill();
        g.fillStyle = 'rgba(140,220,255,0.18)'; g.beginPath(); g.arc(0, 0, 40, PI, 0); g.fill();
        g.strokeStyle = 'rgba(140,220,255,0.35)'; g.lineWidth = 1.2; for (let a = 1; a < 6; a++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(PI + a * PI / 6) * 40, Math.sin(PI + a * PI / 6) * 40); g.stroke(); }
        g.strokeStyle = rim; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 48, PI * 1.55, PI * 1.95); g.stroke();
        lights.push([0, -50, 'rgba(255,60,60,0.95)', .65]);
      }
      _lt = lights;
    }, .8));
  }
  function planet(ctx, P) {
    const VW = V.VW;
    const s = bsprite('space:planet', 320, 200, 160, 100, g => {
      const R0 = 64;
      const ring = (front) => {
        g.save(); g.beginPath(); if (front) g.rect(-170, 0, 340, 100); else g.rect(-170, -100, 340, 100); g.clip();
        g.save(); g.rotate(-.32);
        g.strokeStyle = 'rgba(255,214,170,0.75)'; g.lineWidth = 8; g.beginPath(); g.ellipse(0, 0, 128, 26, 0, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(200,150,220,0.55)'; g.lineWidth = 5; g.beginPath(); g.ellipse(0, 0, 112, 22, 0, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(255,240,220,0.45)'; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 140, 29, 0, 0, TAU); g.stroke();
        g.restore(); g.restore();
      };
      ring(false);
      g.save(); g.beginPath(); g.arc(0, 0, R0, 0, TAU); g.clip();
      g.fillStyle = LG(g, 0, -R0, 0, R0, [[0, '#ffb98a'], [.25, '#e8806a'], [.45, '#f6c49a'], [.6, '#c45a6a'], [.8, '#8a3a7a'], [1, '#4a2060']]); g.fillRect(-R0, -R0, R0 * 2, R0 * 2);
      g.strokeStyle = 'rgba(255,230,200,0.25)'; g.lineWidth = 3;
      for (let y = -50; y < 60; y += 14) { g.beginPath(); g.moveTo(-R0, y); g.quadraticCurveTo(0, y + 6, R0, y - 3); g.stroke(); }
      E(g, 18, 16, 12, 6, 'rgba(160,50,70,0.55)');
      g.fillStyle = RG(g, -24, -24, 4, 0, 0, R0 * 1.15, [[0, 'rgba(255,255,255,0.18)'], [.55, 'rgba(0,0,0,0)'], [1, 'rgba(10,0,30,0.7)']]); g.fillRect(-R0, -R0, R0 * 2, R0 * 2);
      g.restore();
      ring(true);
    }, .8);
    const x = VW * .64 - S.cam.x * .004, y = ly(150, .012);
    drawS(ctx, s, x, y, 1);
    const m = bsprite('space:moon2', 40, 40, 20, 20, g => {
      g.fillStyle = RG(g, -5, -5, 1, 0, 0, 13, [[0, '#e8e4f4'], [1, '#8a84a8']]); g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill();
      E(g, 4, 3, 3, 2.6, 'rgba(90,80,120,0.4)'); E(g, -4, 5, 2, 1.8, 'rgba(90,80,120,0.4)');
    }, 1);
    drawS(ctx, m, VW * .64 + 170 - S.cam.x * .005, ly(92, .012), 1);
  }
  /** Ara sıra kayan yıldız (ucuz: tek çizgi) */
  function shootingStar(ctx, salt) {
    if (lowQ()) return;
    const per = 5.5, n = Math.floor(tk / per), q = (tk % per) / .7;
    if (q > 1) return;
    const VW = V.VW, x0 = VW * (.2 + hash(n * 31 + salt) * .7), y0 = 30 + hash(n * 17 + salt) * 120;
    const x = x0 - q * 260, y = y0 + q * 110;
    ctx.save(); ctx.globalAlpha = Math.sin(q * PI) * .9;
    ctx.strokeStyle = cg(ctx, 'sstar', g => LG(g, 0, 0, 70, 0, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(160,200,255,0)']]));
    ctx.translate(x, y); ctx.rotate(Math.atan2(-110, 260));
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(70, 0); ctx.stroke();
    ctx.restore();
  }
  BG.space = function (ctx, P, VW) {
    stars(ctx, 70, 9151, 300, .95);
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .01));
    planet(ctx, P);
    shootingStar(ctx, 41);
    silLayer(ctx, { salt: 262, f: .035, fy: .03, base: 374, slot: 420, prob: .8, sc0: .55, sc1: .78, nv: 3, w: 440, lights: true,
      spr: v => stationSpr('space:st' + v, v, SP.far), fill: '#1f1a4c' });
    haze(ctx, P, ly(374, .03), 90, .45);
    silLayer(ctx, { salt: 363, f: .11, fy: .07, base: 414, slot: 330, prob: .85, sc0: .72, sc1: .95, nv: 3, w: 440, lights: true,
      spr: v => stationSpr('space:sn' + v, (v + 1) % 3, SP.mid), fill: '#161236' });
    haze(ctx, P, ly(414, .07), 60, .3);
    hills(ctx, P, { salt: 565, f: .24, fy: .13, base: 450, amp: 14, k1: .004, k2: .011, p: 2.2,
      stops: [[0, '#241f4c'], [.5, '#17133a'], [1, '#0e0b26']], rim: 'rgba(110,220,255,0.75)', rimW: 2,
      trees: { sp: 70, prob: .5, kinds: ['mast', 'tank', 'dome', 'mast'], sc0: .6, sc1: .9, sink: 4, spr: (k, v) => spaceSil(k, v) },
      after: (ctx2, off, yb) => {
        // yakın siluetlerin ikaz ışıkları (hills ağaç yuvalarıyla aynı hesap)
        if (lowQ()) return;
        const sp = 70, i0 = Math.floor((off - 90) / sp), i1 = Math.floor((off + VW + 90) / sp);
        const o = { amp: 14, k1: .004, k2: .011, p: 2.2 };
        for (let i = i0; i <= i1; i++) {
          const a = hs(i, 565); if (a > .5) continue;
          const b = hs(i, 572), c = hs(i, 578), kind = ['mast', 'tank', 'dome', 'mast'][(c * 4) | 0];
          const s = spaceSil(kind, (a * 3) | 0); if (!s.lights) continue;
          const sc = .6 + .3 * b, wx = i * sp + (b - .5) * sp * .7, gy = yb + hillY(o, wx) + 4;
          for (const L2 of s.lights) {
            const ph = (tk * L2[3] + a * 3) % 1.3; if (ph > .3) continue;
            ctx2.save(); ctx2.globalCompositeOperation = 'lighter'; ctx2.globalAlpha = Math.sin(ph / .3 * PI);
            drawS(ctx2, G.glowSprite(L2[2], 10), wx - off + L2[0] * sc, gy + L2[1] * sc, 1); ctx2.restore();
          }
        }
      } });
    haze(ctx, P, ly(470, .13), 60, .25);
  };

  /* =====================================================================
     GECE ŞEHRİ — arka plan
     ===================================================================== */
  const CT = {
    far: { body: '#2c2362', win: '#b9a4ff', winA: .45, neon: null, haze: '#6e3586', hazeA: .3, top: 'rgba(255,120,190,0.35)' },
    mid: { body: '#170f38', win: '#ffd27a', winB: '#9fe6ff', winA: .9, neon: ['#ff4fa8', '#39e6ff', '#ffe14a', '#7dff6a'], haze: '#6e3586', hazeA: .06, top: 'rgba(255,95,162,0.55)' }
  };
  const NEON_TXT = ['ÇAY', 'BÜFE', 'OTEL', 'SİNEMA', 'DÖNER', 'BAR'];
  function skySpr(key, v, c) {
    return withLights(bsprite(key, 340, 330, 170, 326, g => {
      const rnd = mrng(5100 + v * 97 + (c.neon ? 7 : 0)), lights = [];
      const nb = 3 + (v % 3);
      let x = -160;
      const bl = [];
      for (let i = 0; i < nb && x < 150; i++) {
        const w = 44 + rnd() * 50, h = 90 + rnd() * 190 * (i === 1 ? 1.15 : .85);
        bl.push([x, w, h]); x += w + rnd() * 8 - 2;
      }
      for (const b of bl) {
        const [bx, w, h] = b;
        g.fillStyle = c.body; g.fillRect(bx, -h, w, h + 4);
        const roof = rnd();
        if (roof < .3) { g.beginPath(); g.moveTo(bx + 4, -h); g.lineTo(bx + w / 2, -h - 26); g.lineTo(bx + w - 4, -h); g.fill(); }
        else if (roof < .55) { g.fillRect(bx + w * .3, -h - 10, w * .4, 10); }
        g.fillStyle = c.top; g.fillRect(bx + w - 3, -h, 3, h);
        // pencereler
        const cols = Math.max(2, Math.floor((w - 8) / 9)), rows = Math.floor((h - 16) / 12);
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          const q = rnd(); if (q > (c.neon ? .42 : .3)) continue;
          g.globalAlpha = c.winA * (.55 + rnd() * .45);
          g.fillStyle = c.winB && rnd() < .3 ? c.winB : c.win;
          g.fillRect(bx + 5 + k * 9, -h + 10 + r * 12, 5, 6);
        }
        g.globalAlpha = 1;
        if (rnd() < .55) { g.fillStyle = c.body; g.fillRect(bx + w * .5 - 1, -h - (roof < .3 ? 26 : 10) - 30, 2.4, 30); lights.push([bx + w * .5, -h - (roof < .3 ? 26 : 10) - 31, 'rgba(255,50,60,0.95)', .5 + rnd() * .4]); }
      }
      // neon tabela (yalnızca orta katman)
      if (c.neon) {
        const b = bl[(v % bl.length)], col = c.neon[v % 4], txt = NEON_TXT[v % NEON_TXT.length];
        const tw = Math.min(b[1] - 6, 14 + txt.length * 9), tx = b[0] + b[1] / 2, ty = -b[2] * .55;
        g.save();
        g.shadowColor = col; g.shadowBlur = 12;
        g.strokeStyle = col; g.lineWidth = 2.4; g.beginPath(); rrp(g, tx - tw / 2, ty - 10, tw, 20, 4); g.stroke();
        g.font = 'bold ' + Math.min(13, (tw - 6) / txt.length * 1.5) + 'px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = shade(col, .55); g.fillText(txt, tx, ty + 1);
        g.restore();
        // vinç (bazı varyantlarda)
        if (v % 4 === 3) {
          g.strokeStyle = c.body; g.lineWidth = 3; const cx = 120;
          g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, -260); g.moveTo(cx - 70, -250); g.lineTo(cx + 40, -250); g.moveTo(cx, -280); g.lineTo(cx - 70, -250); g.moveTo(cx, -280); g.lineTo(cx + 40, -250); g.stroke();
          g.lineWidth = 1; for (let y = -250; y < 0; y += 14) { g.beginPath(); g.moveTo(cx - 5, y); g.lineTo(cx + 5, y + 14); g.stroke(); }
          g.beginPath(); g.moveTo(cx - 52, -250); g.lineTo(cx - 52, -190); g.stroke(); g.fillStyle = c.body; g.fillRect(cx - 58, -190, 12, 9);
          lights.push([cx, -282, 'rgba(255,50,60,0.95)', .6], [cx - 70, -252, 'rgba(255,200,60,0.95)', .9]);
        }
      }
      if (c.hazeA) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = rgba(c.haze, c.hazeA); g.fillRect(-170, -330, 340, 340); }
      _lt = lights;
    }, .8));
  }
  function roofSpr(v) {
    return bsprite('city:roof' + v, 320, 140, 160, 136, g => {
      const rnd = mrng(7300 + v * 31), col = '#0b0719', rim = 'rgba(255,95,162,0.6)';
      g.fillStyle = col;
      let x = -160;
      while (x < 160) {
        const w = 60 + rnd() * 70, h = 20 + rnd() * 34;
        g.fillRect(x, -h, w + 1, h + 4);
        g.fillStyle = rim; g.fillRect(x, -h, w, 1.6); g.fillStyle = col;
        const q = rnd();
        if (q < .3) { // su deposu
          const tx = x + w * .5; g.fillRect(tx - 1.5 - 10, -h - 22, 3, 22); g.fillRect(tx - 1.5 + 10, -h - 22, 3, 22);
          g.beginPath(); rrp(g, tx - 16, -h - 52, 32, 32, 4); g.fill(); g.beginPath(); g.moveTo(tx - 18, -h - 52); g.lineTo(tx, -h - 64); g.lineTo(tx + 18, -h - 52); g.fill();
          g.fillStyle = rim; g.fillRect(tx + 13, -h - 50, 1.5, 28); g.fillStyle = col;
        } else if (q < .55) { g.fillRect(x + 10, -h - 14, 22, 14); g.fillRect(x + w - 30, -h - 10, 18, 10); }
        else if (q < .7) { g.fillRect(x + w * .4, -h - 40, 2, 40); g.fillRect(x + w * .4 - 8, -h - 34, 18, 2); }
        x += w;
      }
    }, .8);
  }
  function searchlights(ctx) {
    if (lowQ()) return;
    const VW = V.VW;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gr = cg(ctx, 'city:beam', g => LG(g, 0, 0, 0, -560, [[0, 'rgba(190,200,255,0.15)'], [1, 'rgba(190,200,255,0)']]));
    for (let k = 0; k < 2; k++) {
      const x = VW * (.18 + k * .55) - S.cam.x * .03 % (VW * 1.4), y = ly(400, .05);
      const xx = ((x % (VW + 300)) + VW + 300) % (VW + 300) - 150;
      ctx.save(); ctx.translate(xx, y); ctx.rotate(Math.sin(tk * .22 + k * 2.4) * .55);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-58, -560); ctx.lineTo(58, -560); ctx.lineTo(5, 0); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  BG.city = function (ctx, P, VW) {
    stars(ctx, 36, 6161, 200, .7);
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .015));
    clouds(ctx, P, { salt: 161, f: .012, fy: .012, wind: 4, slot: 480, prob: .55, y0: 70, y1: 170, sc0: .55, sc1: .85, a: .55, sx: 2, sy: .38 });
    searchlights(ctx);
    silLayer(ctx, { salt: 272, f: .03, fy: .025, base: 372, slot: 250, prob: 1, sc0: .8, sc1: 1.08, nv: 4, w: 340, lights: true,
      spr: v => skySpr('city:f' + v, v, CT.far), fill: '#2c2362' });
    haze(ctx, P, ly(372, .025), 110, .5);
    silLayer(ctx, { salt: 373, f: .09, fy: .06, base: 410, slot: 220, prob: .96, sc0: .78, sc1: 1.02, nv: 4, w: 340, lights: true,
      spr: v => skySpr('city:m' + v, v + 4, CT.mid), fill: '#170f38' });
    haze(ctx, P, ly(410, .06), 70, .28);
    const yb = silLayer(ctx, { salt: 474, f: .22, fy: .12, base: 448, slot: 300, prob: 1, sc0: .9, sc1: 1.1, nv: 3, w: 320, spr: v => roofSpr(v), fill: '#0b0719' });
    ctx.save(); ctx.translate(0, yb);
    ctx.fillStyle = cg(ctx, 'city:rooffog', g => LG(g, 0, 0, 0, 160, [[0, 'rgba(5,3,14,0)'], [1, 'rgba(5,3,14,0.6)']]));
    ctx.fillRect(0, 0, VW, 160); ctx.restore();
  };

  /* =====================================================================
     TROPİK ADA — arka plan
     ===================================================================== */
  const TR = {
    far: { sand: '#f2e2b6', jungle: ['#4c9a86', '#5aac90', '#76c4a2'], palm: '#3f8a78', foam: 'rgba(255,255,255,0.7)', haze: '#c4ecf8', hazeA: .42 },
    mid: { sand: '#f6e2a8', jungle: ['#2e8a52', '#3fa45e', '#62c46e'], palm: '#2a7a48', foam: 'rgba(255,255,255,0.9)', haze: '#c4ecf8', hazeA: .14, detail: true }
  };
  function isleSpr(key, v, c) {
    return bsprite(key, 400, 200, 200, 176, g => {
      const rnd = mrng(8100 + v * 53 + (c.detail ? 5 : 0));
      const W = 260 - v * 40;
      // su altı gölgesi + köpük
      E(g, 0, 6, W * .56, 9, 'rgba(10,80,120,0.25)');
      // kumsal
      g.fillStyle = c.sand; g.beginPath(); g.ellipse(0, 0, W * .52, 14, 0, PI, TAU); g.fill();
      g.fillRect(-W * .52, -1, W * 1.04, 4);
      // orman tepesi
      const circles = [];
      const n = 6 + v;
      for (let i = 0; i < n; i++) { const t = i / (n - 1), bell = Math.sin(t * PI); circles.push([-W * .38 + W * .76 * t, -8 - bell * (34 + rnd() * 18), 20 + bell * 18 + rnd() * 6]); }
      const sil = new Path2D(); for (const k of circles) circ(sil, k[0], k[1], k[2]);
      g.save(); g.beginPath(); g.rect(-W, -200, W * 2, 196); g.clip();
      g.fillStyle = c.jungle[0]; g.fill(sil);
      g.clip(sil);
      g.fillStyle = c.jungle[1]; for (const k of circles) { g.beginPath(); g.arc(k[0] + k[2] * .12, k[1] - k[2] * .18, k[2] * .8, 0, TAU); g.fill(); }
      if (c.detail) { g.fillStyle = c.jungle[2]; for (const k of circles) { g.beginPath(); g.arc(k[0] + k[2] * .25, k[1] - k[2] * .34, k[2] * .45, 0, TAU); g.fill(); } }
      g.restore();
      // palmiyeler
      const np = 2 + (v === 0 ? 2 : 1);
      for (let i = 0; i < np; i++) {
        const px = -W * .42 + rnd() * W * .84, ph = 60 + rnd() * 40;
        g.save(); g.translate(px, -4);
        palmDraw(g, ph, (px < 0 ? -1 : 1) * (.08 + rnd() * .12), c.detail ? { trunk: '#a8865a', trunkD: '#7a5a38', ring: 'rgba(80,50,20,0.35)', leaf: c.palm, leafL: shade(c.palm, .2), leafD: shade(c.palm, -.3), ol: null, nut: '#6a4a24' } : { trunk: c.palm, leaf: c.palm, leafD: shade(c.palm, -.12), ol: null }, i % 3);
        g.restore();
      }
      if (v === 1 && c.detail) {
        // deniz feneri
        g.fillStyle = '#f4f0e8'; g.beginPath(); g.moveTo(W * .3, -6); g.lineTo(W * .3 + 6, -78); g.lineTo(W * .3 + 18, -78); g.lineTo(W * .3 + 24, -6); g.closePath(); g.fill();
        g.fillStyle = '#e8484a'; g.fillRect(W * .3 + 3, -50, 19, 9); g.fillRect(W * .3 + 6, -76, 13, 8);
        g.fillStyle = '#3a3a4a'; g.beginPath(); g.moveTo(W * .3 + 4, -84); g.lineTo(W * .3 + 12, -96); g.lineTo(W * .3 + 20, -84); g.fill();
        g.fillStyle = '#ffe680'; g.fillRect(W * .3 + 7, -84, 10, 6);
      }
      g.fillStyle = c.foam; g.beginPath(); g.ellipse(0, 1, W * .54, 3, 0, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(c.haze, c.hazeA); g.fillRect(-200, -200, 400, 210);
    }, .75);
  }
  function seaBand(ctx, P, sy) {
    const VW = V.VW, VH = V.VH;
    if (sy > VH) return;
    ctx.save(); ctx.translate(0, sy);
    ctx.fillStyle = cg(ctx, 'tropic:sea', g => LG(g, 0, 0, 0, 230, [[0, '#9fe0f2'], [.05, '#4ec0e6'], [.35, '#1f96d6'], [1, '#0c62a8']]));
    ctx.fillRect(0, 0, VW, Math.min(230, VH - sy + 2));
    ctx.restore();
    if (sy + 230 < VH) { ctx.fillStyle = '#0c62a8'; ctx.fillRect(0, sy + 230, VW, VH - sy - 229); }
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(0, sy, VW, 1.4);
    // güneş yansıması + dalga ışıltıları
    const sx = VW * P.sun.x;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#fff6d0';
    for (let i = 0; i < 26; i++) {
      const h1 = hash(i * 13 + 5), d = h1 * 120, w = (24 - d * .12) * (.5 + hash(i * 7) * .8);
      const a = Math.sin(tk * (2 + h1 * 3) + i * 2.3);
      if (a < .1) continue;
      ctx.globalAlpha = a * (.55 - d / 300);
      ctx.fillRect(sx - w / 2 + (hash(i * 3 + 1) - .5) * (20 + d * .5) + Math.sin(tk + i) * 3, sy + 4 + d, w, 1.6);
    }
    ctx.globalAlpha = .35; ctx.fillStyle = '#ffffff';
    const off = S.cam.x * .06;
    for (let i = 0; i < 18; i++) {
      const h1 = hash(i * 29 + 77), d = 8 + h1 * 110, x = ((hash(i * 41) * (VW + 100) - off * (1 + d / 60) + tk * 4) % (VW + 100) + VW + 100) % (VW + 100) - 50;
      const a = Math.sin(tk * 1.4 + i * 1.7); if (a < .2) continue;
      ctx.globalAlpha = (a - .2) * .5; ctx.fillRect(x, sy + d, 10 + d * .15, 1.2);
    }
    ctx.restore();
  }
  function sailboat(ctx, sy) {
    const VW = V.VW, span = VW + 300;
    const x = span - ((tk * 7 + S.cam.x * .03) % span) - 150, y = sy + 5;
    drawS(ctx, bsprite('tropic:boat', 40, 44, 20, 38, g => {
      g.fillStyle = '#5a4030'; g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.lineTo(10, 5); g.lineTo(-10, 5); g.closePath(); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-1, -2); g.lineTo(-1, -32); g.lineTo(-13, -3); g.closePath(); g.fill();
      g.fillStyle = '#ffe8e8'; g.beginPath(); g.moveTo(1, -2); g.lineTo(1, -28); g.lineTo(11, -3); g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(196,236,248,0.35)'; g.fillRect(-20, -40, 40, 50);
    }, .8), x, y + Math.sin(tk * 1.6) * .8, .8);
  }
  BG.tropic = function (ctx, P, VW) {
    sunDisk(ctx, P, VW * P.sun.x, ly(P.sun.y, .02));
    clouds(ctx, P, { salt: 171, f: .012, fy: .012, wind: 5, slot: 340, prob: .62, y0: 40, y1: 120, sc0: .45, sc1: .66, a: .9 });
    const sy = ly(296, .03);
    seaBand(ctx, P, sy);
    sailboat(ctx, sy);
    clouds(ctx, P, { salt: 373, f: .04, fy: .03, wind: 7, slot: 430, prob: .62, y0: 150, y1: 240, sc0: .6, sc1: .9, a: .92 });
    silLayer(ctx, { salt: 282, f: .035, fy: .03, base: 298, slot: 420, prob: .78, sc0: .45, sc1: .66, nv: 3, w: 400, spr: v => isleSpr('tropic:if' + v, v, TR.far) });
    silLayer(ctx, { salt: 384, f: .11, fy: .065, base: 352, slot: 470, prob: .85, sc0: .95, sc1: 1.25, nv: 3, w: 400, spr: v => isleSpr('tropic:im' + v, v, TR.mid) });
    // yakın deniz: dalga sırtları
    const ny = ly(392, .12);
    if (ny < V.VH) {
      ctx.save(); ctx.translate(0, ny);
      ctx.fillStyle = cg(ctx, 'tropic:near', g => LG(g, 0, 0, 0, 140, [[0, 'rgba(14,110,170,0.0)'], [.25, 'rgba(10,90,150,0.55)'], [1, 'rgba(4,50,90,0.85)']]));
      ctx.fillRect(0, 0, VW, 140); ctx.restore();
      if (ny + 140 < V.VH) { ctx.fillStyle = 'rgba(4,50,90,0.85)'; ctx.fillRect(0, ny + 140, VW, V.VH - ny - 139); }
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const off = S.cam.x * .3;
      for (let r = 0; r < 3; r++) {
        const yy = ny + 18 + r * 22, sp = 90 - r * 10;
        ctx.globalAlpha = .55 - r * .12;
        ctx.beginPath();
        for (let i = Math.floor((off - sp) / sp); i <= Math.ceil((off + VW + sp) / sp); i++) {
          const h1 = hs(i, 900 + r); if (h1 > .6) continue;
          const x = i * sp + h1 * 40 - off + Math.sin(tk * .9 + i) * 6, w = 18 + h1 * 26, b = Math.sin(tk * 1.8 + i * 2 + r) * 1.5;
          ctx.moveTo(x, yy + b); ctx.quadraticCurveTo(x + w / 2, yy - 4 + b, x + w, yy + b);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    birds(ctx, 'rgba(40,64,96,0.75)', 4, 191, false);
  };

  /* =====================================================================
     ZEMİN: yeni desenler, kapaklar, gömülü süsler, yüzen platformlar
     ===================================================================== */
  Object.assign(GP, {
    desert: { ol: '#3e1f08', deep: '#2a1204', deepA: .55, body: '#d29a5c', rim: 'rgba(255,236,190,0.35)' },
    space: { ol: '#070814', deep: '#04040e', deepA: .6, body: '#353d56', rim: 'rgba(120,230,255,0.4)' },
    city: { ol: '#0a0612', deep: '#05030a', deepA: .6, body: '#4a3448', rim: 'rgba(255,120,190,0.3)' },
    tropic: { ol: '#2c1c0a', deep: '#1a1206', deepA: .5, body: '#d9b67a', rim: 'rgba(255,246,210,0.35)' }
  });
  function tileSandstone(g, W, H) {
    const rnd = mrng(55);
    g.fillStyle = '#8a582a'; g.fillRect(0, 0, W, H);
    const cols = ['#d9a566', '#cf9a5a', '#e2b072', '#c98f52', '#d8a262', '#d09c5e'];
    let ci = 0;
    for (let r = 0; r < 3; r++) {
      const off = (r % 2) * 32;
      for (let b = -1; b < 3; b++) {
        const x = b * 64 + off, y = r * 32, col = cols[(ci++ * 5 + r) % cols.length];
        const p = new Path2D(); rrp(p, x + 1.6, y + 1.6, 60.8, 28.8, 4);
        g.fillStyle = col; g.fill(p);
        g.save(); g.clip(p);
        g.fillStyle = 'rgba(255,236,190,0.4)'; g.fillRect(x, y + 1.5, 64, 3);
        g.fillStyle = 'rgba(110,60,20,0.28)'; g.fillRect(x, y + 25, 64, 6);
        for (let k = 0; k < 12; k++) { g.fillStyle = rnd() < .5 ? 'rgba(120,70,30,0.35)' : 'rgba(255,240,200,0.35)'; g.fillRect(x + 4 + rnd() * 56, y + 5 + rnd() * 20, 1.5, 1.5); }
        for (let k = 0; k < 2; k++) E(g, x + 8 + rnd() * 48, y + 8 + rnd() * 14, 2 + rnd() * 3, 1.4 + rnd() * 1.6, 'rgba(120,70,30,0.3)');
        g.restore();
      }
    }
    // oyma hiyeroglifler (birkaç taşta)
    g.lineCap = 'round'; g.lineJoin = 'round';
    const glyph = (x, y, k) => {
      const dk = 'rgba(105,58,22,0.42)', lt = 'rgba(255,232,186,0.32)';
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? dk : lt; g.lineWidth = 1.6;
        const o = pass ? 0 : .9;
        g.beginPath();
        if (k === 0) { g.ellipse(x + o, y - 4 + o, 3, 4, 0, 0, TAU); g.moveTo(x + o, y + o); g.lineTo(x + o, y + 9 + o); g.moveTo(x - 5 + o, y + 2 + o); g.lineTo(x + 5 + o, y + 2 + o); }
        else if (k === 1) { g.ellipse(x + o, y + o, 6, 3, 0, 0, TAU); g.moveTo(x - 6 + o, y + 4 + o); g.lineTo(x - 2 + o, y + 8 + o); g.moveTo(x + 1 + o, y + 3 + o); g.lineTo(x + 2 + o, y + 9 + o); }
        else { g.moveTo(x - 7 + o, y + o); for (let i = 0; i < 4; i++) g.lineTo(x - 7 + i * 4 + 2 + o, y + (i % 2 ? -2 : 2) + o); g.moveTo(x - 7 + o, y + 5 + o); for (let i = 0; i < 4; i++) g.lineTo(x - 7 + i * 4 + 2 + o, y + 5 + (i % 2 ? -2 : 2) + o); }
        g.stroke();
      }
    };
    glyph(22, 46, 0); glyph(100, 14, 1); glyph(62, 80, 2); glyph(118, 78, 0);
  }
  function tileMetal(g, W, H) {
    const rnd = mrng(66);
    g.fillStyle = '#1a1e2e'; g.fillRect(0, 0, W, H);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const x = c * 64, y = r * 64, k = r * 2 + c;
      const p = new Path2D(); rrp(p, x + 1.5, y + 1.5, 61, 61, 5);
      g.fillStyle = LG(g, x, y, x + 40, y + 64, [[0, ['#4a5574', '#434d6a', '#4e5878', '#465070'][k]], [1, ['#2c334a', '#283044', '#2e354c', '#2a3146'][k]]]); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = 'rgba(190,210,255,0.22)'; g.fillRect(x, y + 2, 64, 2); g.fillRect(x + 2, y, 2, 64);
      g.fillStyle = 'rgba(0,0,10,0.3)'; g.fillRect(x, y + 59, 64, 4);
      if (k === 1) { g.fillStyle = '#0e1220'; for (let i = 0; i < 5; i++) { g.beginPath(); rrp(g, x + 14, y + 14 + i * 8, 36, 4, 2); g.fill(); } g.fillStyle = 'rgba(160,190,255,0.2)'; for (let i = 0; i < 5; i++) g.fillRect(x + 15, y + 18 + i * 8, 34, 1); }
      else if (k === 2) { g.save(); g.beginPath(); g.rect(x + 6, y + 26, 52, 12); g.clip(); g.fillStyle = '#a8862e'; g.fillRect(x + 6, y + 26, 52, 12); g.fillStyle = '#2a2a34'; for (let s = -10; s < 60; s += 10) { g.beginPath(); g.moveTo(x + s, y + 38); g.lineTo(x + s + 5, y + 38); g.lineTo(x + s + 17, y + 26); g.lineTo(x + s + 12, y + 26); g.closePath(); g.fill(); } g.restore(); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 6, y + 38, 52, 1.5); }
      else if (k === 3) { g.strokeStyle = 'rgba(10,14,30,0.6)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 32, y + 6); g.lineTo(x + 32, y + 58); g.moveTo(x + 6, y + 32); g.lineTo(x + 58, y + 32); g.stroke(); }
      for (let q = 0; q < 6; q++) { g.fillStyle = 'rgba(10,12,24,0.25)'; g.fillRect(x + 6 + rnd() * 50, y + 6 + rnd() * 50, 2 + rnd() * 6, 1); }
      g.restore();
      for (const [bx, by] of [[x + 7, y + 7], [x + 57, y + 7], [x + 7, y + 57], [x + 57, y + 57]]) { E(g, bx, by + .6, 2.4, 2.4, '#0c0f1a'); E(g, bx, by, 2, 2, '#8a96b4'); E(g, bx - .5, by - .6, .8, .7, '#e0e8ff'); }
    }
  }
  function tileCityBrick(g, W, H) {
    const rnd = mrng(77);
    g.fillStyle = '#1c1220'; g.fillRect(0, 0, W, H);
    const cols = ['#5a3848', '#4e3040', '#64404e', '#553444', '#5c3a4a'];
    for (let r = 0; r < 8; r++) {
      const off = (r % 2) * 12;
      for (let b = -1; b < 5; b++) {
        const x = b * 24 + off, y = r * 12;
        g.fillStyle = cols[((r * 7 + b * 3) % 5 + 5) % 5]; g.fillRect(x + 1, y + 1, 22, 10);
        g.fillStyle = 'rgba(255,170,200,0.12)'; g.fillRect(x + 1, y + 1, 22, 1.6);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 1, y + 9, 22, 2);
      }
    }
    // akıntı lekeleri + boru
    for (let i = 0; i < 4; i++) { const x = rnd() * W, l = 20 + rnd() * 40; g.fillStyle = 'rgba(10,6,14,0.22)'; g.fillRect(x, rnd() * H, 3 + rnd() * 4, l); }
    g.fillStyle = '#2e2a38'; g.fillRect(70, 0, 7, H); g.fillStyle = 'rgba(180,170,210,0.3)'; g.fillRect(71, 0, 1.6, H);
    for (const y of [20, 68]) { g.fillStyle = '#3e3a4c'; g.fillRect(67, y, 13, 5); }
  }
  function tileTropic(g, W, H) {
    const rnd = mrng(88);
    g.fillStyle = '#dcb97c'; g.fillRect(0, 0, W, H);
    // tabakalar
    for (let k = 0; k < 5; k++) {
      const y0 = k * 26 + 6;
      g.fillStyle = k % 2 ? 'rgba(170,120,60,0.28)' : 'rgba(255,236,190,0.3)';
      g.beginPath(); g.moveTo(0, y0);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, y0 + Math.sin(x / W * TAU * 2 + k) * 3);
      for (let x = W; x >= 0; x -= 8) g.lineTo(x, y0 + 9 + Math.sin(x / W * TAU * 2 + k + 1) * 3);
      g.closePath(); g.fill();
    }
    for (let i = 0; i < 90; i++) { g.fillStyle = rnd() < .6 ? 'rgba(130,90,40,0.45)' : 'rgba(255,248,220,0.6)'; g.fillRect(rnd() * W, rnd() * H, 1.4, 1.4); }
    for (let i = 0; i < 9; i++) {
      const x = rnd() * W, y = rnd() * H, rx = 3 + rnd() * 5, ry = 2.4 + rnd() * 3, col = ['#b8a890', '#9a8a78', '#c8b8a0'][i % 3];
      wrapDo(W, H, x, y, rx + 3, (xx, yy) => { E(g, xx, yy + 1, rx + 1.2, ry + 1.2, '#6a5030'); E(g, xx, yy, rx, ry, col); E(g, xx - rx * .25, yy - ry * .38, rx * .5, ry * .34, 'rgba(255,255,255,0.5)'); });
    }
    for (let i = 0; i < 4; i++) {
      const x = 10 + rnd() * (W - 20), y = 10 + rnd() * (H - 20);
      g.save(); g.translate(x, y); g.rotate(rnd() * TAU);
      g.fillStyle = '#6a4a2a'; g.beginPath(); g.moveTo(0, -5); g.quadraticCurveTo(5, -4, 5, 3); g.lineTo(-5, 3); g.quadraticCurveTo(-5, -4, 0, -5); g.fill();
      g.fillStyle = i % 2 ? '#ffd6d0' : '#fff2e0'; g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(4, -3, 4, 2); g.lineTo(-4, 2); g.quadraticCurveTo(-4, -3, 0, -4); g.fill();
      g.strokeStyle = 'rgba(160,100,80,0.6)'; g.lineWidth = .8; g.beginPath(); for (let a = -2; a <= 2; a++) { g.moveTo(0, 2); g.lineTo(a * 1.6, -3); } g.stroke();
      g.restore();
    }
  }
  Object.assign(PATS, {
    desert: ctx => pattern(ctx, 'sandstone', 128, 96, tileSandstone),
    space: ctx => pattern(ctx, 'metal', 128, 128, tileMetal),
    city: ctx => pattern(ctx, 'citybrick', 96, 96, tileCityBrick),
    tropic: ctx => pattern(ctx, 'tropicsoil', 128, 128, tileTropic)
  });
  /* ---- kapaklar ---- */
  function capSpace(w, lE, rE, seed) {
    const rnd = mrng(seed), T = 12;
    const x0 = lE ? -3 : -1, x1 = rE ? w + 3 : w + 1;
    const main = new Path2D(); rrp(main, x0, -3, x1 - x0, T + 3, 3);
    const seams = new Path2D(), bolts = new Path2D();
    for (let x = x0 + 40 + rnd() * 24; x < x1 - 14; x += 56 + rnd() * 20) { seams.moveTo(x, -2); seams.lineTo(x, T - 1); circ(bolts, x - 5, 3, 1.3); circ(bolts, x + 5, 3, 1.3); }
    const neon = new Path2D(); neon.moveTo(x0 + 5, T - 3.2); neon.lineTo(x1 - 5, T - 3.2);
    return { main, seams, bolts, neon, T, col: hash(seed) < .7 ? '#5ff0ff' : '#ff6ad8' };
  }
  function capCity(w, lE, rE, seed) {
    const rnd = mrng(seed), T = 14;
    const x0 = lE ? -5 : -1, x1 = rE ? w + 5 : w + 1;
    const main = new Path2D(); rrp(main, x0, -3.5, x1 - x0, T + 3.5, 2.5);
    const seams = new Path2D(), stains = new Path2D(), gravel = new Path2D();
    for (let x = x0 + 30 + rnd() * 20; x < x1 - 10; x += 36 + rnd() * 18) { seams.moveTo(x, -3); seams.lineTo(x, 5); }
    for (let x = x0 + 8; x < x1 - 8; x += 14 + rnd() * 30) { const l = 6 + rnd() * 16; rrp(stains, x, 5 + rnd() * 2, 2.4, l * .5, 1); }
    for (let x = x0 + 4; x < x1 - 4; x += 5 + rnd() * 9) circ(gravel, x, -2.6 + rnd() * 1.2, .9 + rnd() * .9);
    return { main, seams, stains, gravel, T };
  }
  Object.assign(CAPS, {
    desert: capSnow,   // yumuşak, kenarlardan taşan kum yığıntısı (aynı geometri, kum renkleri; buz sarkıtları çizilmez)
    space: capSpace,
    city: capCity,
    tropic: capForest
  });
  Object.assign(DRAWCAP, {
    desert(ctx, c) {
      ctx.save(); ctx.translate(0, 3); ctx.fillStyle = 'rgba(70,30,5,0.28)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'desert:cap', g => LG(g, 0, -6, 0, 24, [[0, '#fff2cc'], [.35, '#f6d898'], [1, '#d9a95e']]));
      ctx.fill(c.main);
      ctx.fillStyle = 'rgba(176,112,48,0.35)'; ctx.fill(c.sh);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#7a4818'; ctx.stroke(c.main);
    },
    space(ctx, c) {
      ctx.save(); ctx.translate(0, 3); ctx.fillStyle = 'rgba(0,0,10,0.4)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'space:cap', g => LG(g, 0, -3, 0, 12, [[0, '#d6e0f4'], [.3, '#98a4c0'], [1, '#4a5474']]));
      ctx.fill(c.main);
      ctx.lineCap = 'butt'; ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(14,18,34,0.7)'; ctx.stroke(c.seams);
      ctx.fillStyle = '#1a2036'; ctx.fill(c.bolts);
      // neon kenar şeridi (yumuşak hale + parlak çekirdek)
      ctx.lineCap = 'round';
      ctx.lineWidth = 6; ctx.strokeStyle = rgba(c.col, .28); ctx.stroke(c.neon);
      ctx.lineWidth = 2.4; ctx.strokeStyle = c.col; ctx.stroke(c.neon);
      ctx.lineWidth = .9; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke(c.neon);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#070814'; ctx.stroke(c.main);
    },
    city(ctx, c) {
      ctx.save(); ctx.translate(0, 4); ctx.fillStyle = 'rgba(5,0,10,0.4)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'city:cap', g => LG(g, 0, -4, 0, 14, [[0, '#b0aac4'], [.3, '#8a84a2'], [.75, '#5e5878'], [1, '#3e3a54']]));
      ctx.fill(c.main);
      ctx.fillStyle = 'rgba(20,14,30,0.3)'; ctx.fill(c.stains);
      ctx.lineCap = 'butt'; ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(20,14,34,0.65)'; ctx.stroke(c.seams);
      ctx.fillStyle = '#4a4560'; ctx.fill(c.gravel);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#0a0612'; ctx.stroke(c.main);
    },
    tropic(ctx, c) {
      ctx.save(); ctx.translate(0, 4); ctx.fillStyle = 'rgba(40,25,0,0.3)'; ctx.fill(c.main); ctx.restore();
      ctx.fillStyle = cg(ctx, 'tropic:cap', g => LG(g, 0, -3, 0, 26, [[0, '#d8ff7a'], [.2, '#9ae650'], [.6, '#56c040'], [1, '#2e8a34']]));
      ctx.fill(c.main);
      ctx.fillStyle = 'rgba(30,100,30,0.45)'; ctx.fill(c.dk);
      ctx.fillStyle = 'rgba(244,255,190,0.85)'; ctx.fill(c.hi);
      ctx.lineJoin = 'round'; ctx.lineWidth = CAP_LW; ctx.strokeStyle = '#1a4a14'; ctx.stroke(c.main);
    }
  });
  /** Zemin gövdesine gömülü süsler (yeni temalar) */
  const FEAT_NEW = {
    desert: v => spr('ft:desert:' + v, 40, 32, 20, 16, g => {
      const ol = '#4a2a10';
      if (v === 0) { const p = new Path2D(); p.ellipse(0, 1, 9, 7, 0, 0, TAU); olFill(g, p, '#3e5a6a', ol, 2.4); g.strokeStyle = '#2a3a44'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 8); g.stroke(); for (const s of [-1, 1]) { g.strokeStyle = ol; g.lineWidth = 1.6; g.beginPath(); g.moveTo(s * 7, -2); g.lineTo(s * 12, -5); g.moveTo(s * 7, 3); g.lineTo(s * 12, 5); g.stroke(); } E(g, -3, -3, 2.2, 1.4, 'rgba(180,230,255,0.5)'); }
      else if (v === 1) { const p = new Path2D(); p.moveTo(-12, -2); p.lineTo(10, -2); p.lineTo(10, 2); p.lineTo(-12, 2); p.closePath(); circ(p, -13, -3, 3.4); circ(p, -13, 3, 3.4); circ(p, 12, -3, 3.4); circ(p, 12, 3, 3.4); g.save(); g.rotate(.3); olFill(g, p, '#f2e8d0', ol, 3); g.restore(); }
      else if (v === 2) { const p = new Path2D(); p.moveTo(-10, 8); p.lineTo(-10, -6); p.quadraticCurveTo(0, -12, 10, -6); p.lineTo(10, 8); p.closePath(); olFill(g, p, '#b07a3e', ol, 2.4); g.strokeStyle = 'rgba(90,50,20,0.7)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(0, -1, 3, 4, 0, 0, TAU); g.moveTo(0, 3); g.lineTo(0, 8); g.moveTo(-4, 5); g.lineTo(4, 5); g.stroke(); }
      else { for (let i = 0; i < 4; i++) { const x = -10 + i * 7, y = (i % 2) * 5 - 2; E(g, x, y + 1, 5, 4, ol); E(g, x, y, 4, 3, i % 2 ? '#c8a070' : '#e0b880'); E(g, x - 1, y - 1, 2, 1.2, '#f6e2c0'); } }
    }),
    space: v => spr('ft:space:' + v, 40, 32, 20, 16, g => {
      const ol = '#070814';
      if (v === 0) { const p = new Path2D(); rrp(p, -13, -7, 26, 14, 3); olFill(g, p, '#20263a', ol, 2.2); g.fillStyle = '#0a0d18'; for (let i = 0; i < 4; i++) g.fillRect(-10 + i * 6, -4, 3, 8); }
      else if (v === 1) { const p = new Path2D(); circ(p, 0, 0, 8); olFill(g, p, '#3a4460', ol, 2.4); E(g, 0, 0, 4, 4, '#ff5a5a'); E(g, -1.2, -1.2, 1.4, 1.2, '#ffd0d0'); }
      else if (v === 2) { g.lineCap = 'round'; g.strokeStyle = ol; g.lineWidth = 6; g.beginPath(); g.moveTo(-15, 4); g.quadraticCurveTo(0, -10, 15, 2); g.stroke(); g.strokeStyle = '#3a6ad8'; g.lineWidth = 3.4; g.stroke(); g.strokeStyle = '#d84a6a'; g.lineWidth = 3.4; g.beginPath(); g.moveTo(-15, 8); g.quadraticCurveTo(0, -4, 15, 7); g.stroke(); }
      else { const p = new Path2D(); rrp(p, -9, -9, 18, 18, 2); olFill(g, p, '#4a5472', ol, 2.2); g.fillStyle = '#e8b22a'; g.fillRect(-6, -6, 12, 12); g.fillStyle = ol; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 0, 1); }
    }),
    city: v => spr('ft:city:' + v, 40, 32, 20, 16, g => {
      const ol = '#0a0612';
      if (v === 0) { const p = new Path2D(); rrp(p, -12, -8, 24, 16, 2); olFill(g, p, '#3a3448', ol, 2.2); g.strokeStyle = '#18141f'; g.lineWidth = 1.4; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-10, i * 4); g.lineTo(10, i * 4); g.stroke(); } }
      else if (v === 1) { g.fillStyle = 'rgba(255,90,170,0.55)'; g.font = 'bold 13px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('FM', 0, 1); g.strokeStyle = 'rgba(80,220,255,0.5)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-12, 8); g.quadraticCurveTo(0, 12, 12, 7); g.stroke(); }
      else if (v === 2) { const p = new Path2D(); circ(p, 0, 0, 8); olFill(g, p, '#2e2a38', ol, 2.2); g.strokeStyle = '#6a6480'; g.lineWidth = 1.6; for (let a = 0; a < 3; a++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a * 2.1) * 6, Math.sin(a * 2.1) * 6); g.stroke(); } }
      else { const p = new Path2D(); rrp(p, -4, -12, 8, 24, 2); olFill(g, p, '#4a4458', ol, 2); g.fillStyle = '#6a6480'; g.fillRect(-6, -4, 12, 4); }
    }),
    tropic: v => spr('ft:tropic:' + v, 40, 32, 20, 16, g => {
      const ol = '#4a3214';
      if (v === 0) { g.save(); g.rotate(-.3); const p = new Path2D(); p.moveTo(0, -9); p.bezierCurveTo(9, -8, 11, 6, 0, 8); p.bezierCurveTo(-11, 6, -9, -8, 0, -9); olFill(g, p, '#ffcfb8', ol, 2.2); g.strokeStyle = 'rgba(170,90,70,0.6)'; g.lineWidth = 1; for (let a = -2; a <= 2; a++) { g.beginPath(); g.moveTo(0, 7); g.lineTo(a * 3, -7); g.stroke(); } g.restore(); }
      else if (v === 1) { g.lineCap = 'round'; g.strokeStyle = ol; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 8); g.lineTo(0, -4); g.moveTo(0, 2); g.lineTo(-7, -6); g.moveTo(0, 0); g.lineTo(7, -8); g.stroke(); g.strokeStyle = '#ff7a8a'; g.lineWidth = 3; g.stroke(); }
      else if (v === 2) { g.save(); g.rotate(.5); const p = new Path2D(); rrp(p, -4, -10, 8, 20, 3); olFill(g, p, 'rgba(120,200,160,0.85)', ol, 2); g.fillStyle = '#8a5a2a'; g.fillRect(-2.5, -13, 5, 4); g.fillStyle = '#fff8e0'; g.fillRect(-2.5, -4, 5, 7); g.restore(); }
      else { for (let i = 0; i < 4; i++) { const x = -10 + i * 7, y = (i % 2) * 5 - 2; E(g, x, y + 1, 5, 4, ol); E(g, x, y, 4, 3, i % 2 ? '#b8a890' : '#d0c4b0'); E(g, x - 1, y - 1, 2, 1.2, '#fff'); } }
    })
  };
  /* ---- yüzen platformlar (uzay: hover plaka, şehir: çelik kiriş) ---- */
  const FLOAT_NEW = {
    space(f, o) { rrp(o.under, 0, 0, f.w, 20, 6); o.extra = { th: [] }; for (let x = 22; x < f.w - 12; x += Math.max(40, (f.w - 44) / Math.max(1, Math.round((f.w - 44) / 60)))) o.extra.th.push(x); if (!o.extra.th.length) o.extra.th.push(f.w / 2); o.D = 24; },
    city(f, o) {
      const w = f.w; rrp(o.under, 0, 0, w, 22, 2);
      const holes = new Path2D(), truss = new Path2D();
      for (let x = 10; x < w - 10; x += 24) { truss.moveTo(x, 18); truss.lineTo(x + 12, 6); truss.lineTo(x + 24 > w - 6 ? w - 6 : x + 24, 18); }
      for (let x = 14; x < w - 8; x += 24) circ(holes, x, 12, 2.2);
      o.extra = { holes, truss }; o.D = 24;
    }
  };
  const DFLOAT_NEW = {
    desert(ctx, f, o, gp) {
      const pt = PATS.desert(ctx);
      if (pt) { setPat(pt, -(f.x % 128), -(f.y % 96)); ctx.fillStyle = pt.pat; } else ctx.fillStyle = gp.body;
      ctx.fill(o.under);
      ctx.fillStyle = cg(ctx, 'desert:fshade', g => LG(g, 0, 0, 0, 52, [[0, 'rgba(255,230,180,0.08)'], [.5, 'rgba(60,25,0,0.12)'], [1, 'rgba(60,25,0,0.45)']]));
      ctx.fill(o.under);
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(70,35,10,0.6)'; ctx.stroke(o.extra.lines);
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = gp.ol; ctx.stroke(o.under);
    },
    tropic(ctx, f, o, gp) {
      const pt = PATS.tropic(ctx);
      if (pt) { setPat(pt, -(f.x % 128), -(f.y % 128)); ctx.fillStyle = pt.pat; } else ctx.fillStyle = gp.body;
      ctx.fill(o.under);
      ctx.fillStyle = cg(ctx, 'tropic:fdepth', g => LG(g, 0, 0, 0, 90, [[0, 'rgba(40,24,6,0.04)'], [.6, 'rgba(40,24,6,0.38)'], [1, 'rgba(40,24,6,0.62)']]));
      ctx.fill(o.under);
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = gp.ol; ctx.stroke(o.under);
      ctx.lineCap = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#2a6a20'; ctx.stroke(o.extra.roots);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(170,240,120,0.6)'; ctx.stroke(o.extra.roots);
      for (const l of o.extra.leaves) { E(ctx, l[0] + 2, l[1], 4, 2, '#1a4a14', .5); E(ctx, l[0] + 2, l[1] - .4, 3.2, 1.4, '#7ad04a', .5); E(ctx, l[0] - 2, l[1] + 3, 2, 2, '#ff6a8a'); }
    },
    space(ctx, f, o) {
      // itici alevleri (alt), sonra gövde
      const fl = .75 + .25 * Math.sin(tk * 30 + f.x);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const x of o.extra.th) {
        ctx.globalAlpha = .75;
        drawS(ctx, G.glowSprite('rgba(90,200,255,0.9)', 18), x, 26, 1 + fl * .2);
        ctx.fillStyle = 'rgba(200,245,255,0.9)'; ctx.beginPath(); dropPath(ctx, x, 20, 4, -(12 + fl * 8), 0); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = cg(ctx, 'space:fbody', g => LG(g, 0, 0, 0, 20, [[0, '#7a86a4'], [.4, '#4a5474'], [1, '#232a40']]));
      ctx.fill(o.under);
      for (const x of o.extra.th) { ctx.fillStyle = '#141a2a'; ctx.beginPath(); rrp(ctx, x - 7, 16, 14, 6, 2); ctx.fill(); }
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(95,240,255,0.3)'; ctx.beginPath(); ctx.moveTo(6, 15); ctx.lineTo(f.w - 6, 15); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = '#8af6ff'; ctx.stroke();
      ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = '#070814'; ctx.stroke(o.under);
    },
    city(ctx, f, o) {
      ctx.fillStyle = cg(ctx, 'city:fbeam', g => LG(g, 0, 0, 0, 22, [[0, '#e88a3a'], [.45, '#c4602a'], [1, '#7a3416']]));
      ctx.fill(o.under);
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(60,20,6,0.55)'; ctx.lineJoin = 'round'; ctx.stroke(o.extra.truss);
      ctx.fillStyle = '#2a1006'; ctx.fill(o.extra.holes);
      ctx.fillStyle = 'rgba(255,220,170,0.4)'; ctx.fillRect(3, 14, f.w - 6, 1.4);
      ctx.lineWidth = 2.6; ctx.strokeStyle = '#1a0a04'; ctx.stroke(o.under);
    }
  };
  /* ---- kapak üstü ayrıntılar ---- */
  function pebbleSpr(id, v) {
    return spr('peb:' + id + v, 20, 12, 10, 8, g => {
      const c = id === 'desert' ? ['#c4884a', '#e6b47a', '#6a3a14'] : ['#6a6480', '#9a94b0', '#1a1424'];
      E(g, 0, 1, 5 + v, 3.2, c[2]); E(g, 0, 0, 4.2 + v, 2.6, c[0]); E(g, -1, -1, 2 + v * .5, 1.2, c[1]);
      if (v) { E(g, 6, 1.5, 2.6, 2, c[2]); E(g, 6, 1, 2, 1.5, c[0]); }
    });
  }
  function dryTuftSpr(v) {
    return spr('drytuft' + v, 30, 22, 15, 18, g => {
      const rnd = mrng(700 + v);
      g.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 7; i++) {
        const x = -8 + i * 2.6, h = 6 + rnd() * 9, lean = (rnd() - .5) * 10;
        g.strokeStyle = pass ? (i % 2 ? '#d8b064' : '#c09048') : '#5a3410'; g.lineWidth = pass ? 1.3 : 2.6;
        g.beginPath(); g.moveTo(x, 2); g.quadraticCurveTo(x + lean * .3, -h * .5, x + lean, -h); g.stroke();
      }
    });
  }
  function ledSpr(col) {
    return spr('led' + col, 12, 8, 6, 4, g => { E(g, 0, 0, 4, 2.6, '#0a0d18'); E(g, 0, -.2, 2.8, 1.6, col); E(g, -.8, -.8, 1, .6, '#ffffff'); });
  }
  const CAPTOP_NEW = {
    desert(ctx, rx, ry, rw, x0, x1, nb) {
      const st = 62;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 5151); if (h > .42) continue;
        const x = i * st + h * 30; if (x < rx + 10 || x > rx + rw - 10) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        if (h < .16) drawS(ctx, dryTuftSpr(((h * 13) | 0) % 3), x, ry - 2, .8 + h * 2, h > .08);
        else drawS(ctx, pebbleSpr('desert', (h * 7 | 0) % 2), x, ry - 2.5, .8 + h * .5);
      }
    },
    space(ctx, rx, ry, rw, x0, x1) {
      const st = 96;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 6161), x = i * st + h * 20; if (x < rx + 10 || x > rx + rw - 10) continue;
        const on = Math.sin(tk * 3 + h * 20) > .2;
        drawS(ctx, ledSpr(on ? (h < .5 ? '#5ff0ff' : '#ffd23f') : '#2a3450'), x, ry + 5);
      }
    },
    city(ctx, rx, ry, rw, x0, x1, nb) {
      const st = 84;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 7171); if (h > .35) continue;
        const x = i * st + h * 40; if (x < rx + 10 || x > rx + rw - 10) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        if (h < .12) { E(ctx, x, ry - 2, 14, 1.6, 'rgba(120,200,255,0.35)'); E(ctx, x - 4, ry - 2.4, 5, .7, 'rgba(255,140,210,0.6)'); }
        else drawS(ctx, pebbleSpr('city', (h * 7 | 0) % 2), x, ry - 3, .8);
      }
    },
    tropic(ctx, rx, ry, rw, x0, x1, nb) {
      const st = 14;
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        const h = hs(i, 1717), x = i * st + h * 5;
        if (x < rx + 6 || x > rx + rw - 6) continue;
        if (nb && bladeBlocked(x, ry)) continue;
        drawS(ctx, bladeSpr((h * 3) | 0), x, ry - 1.5, .85 + h * .35, h > .5);
      }
      const fs = 70;
      for (let i = Math.ceil(x0 / fs); i <= Math.floor(x1 / fs); i++) {
        const h = hs(i, 1919); if (h > .34) continue;
        const x = i * fs + h * 40; if (x < rx + 10 || x > rx + rw - 10) continue;
        if (nb && bladeBlocked(x, ry, true)) continue;
        drawS(ctx, hibiscusSpr((h * 9 | 0) % 3), x, ry - 1, .9 + h);
      }
    }
  };
  function hibiscusSpr(v) {
    return spr('hibis' + v, 20, 24, 10, 20, g => {
      const col = ['#ff4a6a', '#ff8ac0', '#ffb43a'][v];
      g.strokeStyle = '#2d6a1c'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(1.5, -5, 0, -10); g.stroke();
      E(g, 3, -5, 3, 1.3, '#3a9a2a', -.5);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU - PI / 2; E(g, Math.cos(a) * 3.4, -12 + Math.sin(a) * 3.4, 3.2, 3.2, '#5a1a2a'); }
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU - PI / 2; E(g, Math.cos(a) * 3.4, -12 + Math.sin(a) * 3.4, 2.6, 2.6, col); }
      E(g, 0, -12, 1.6, 1.6, '#ffe066'); g.strokeStyle = '#ffe066'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -12); g.lineTo(3, -16); g.stroke();
    });
  }
  /* ---- ön tutamlar ---- */
  const FGT_NEW = {
    desert: v => dryTuftSpr(v % 3),
    tropic: v => fgTuftSpr('forest', v),
    space: null, city: null
  };
  Object.assign(ABYSS, { desert: '#2a1204', space: '#04030e', city: '#05030c', tropic: '#022838' });
  Object.assign(MUD, {
    desert: { a: '#b8803e', b: '#6a3e14', hi: 'rgba(255,240,210,0.5)', bub: '#c89050', ol: '#3a1e06' },
    space: { a: '#3a3a52', b: '#16162a', hi: 'rgba(170,220,255,0.45)', bub: '#4a4a68', ol: '#06060e' },
    city: { a: '#2e2a38', b: '#121018', hi: 'rgba(255,150,220,0.45)', bub: '#3e3a4a', ol: '#06040a' },
    tropic: { a: '#6a4a26', b: '#3a240c', hi: 'rgba(255,240,210,0.5)', bub: '#7a5a32', ol: '#1e1004' }
  });
  /** Bataklık kum renkleri (çamurdan açık, kum tonlu, ortası koyu) */
  const QSAND = { a: '#d6a462', b: '#8e5a26', hi: 'rgba(255,246,214,0.6)', bub: '#e6bc7c', ol: '#4a280a' };

  /* =====================================================================
     SIVILAR: bataklık kum (akan kum), plazma, neon zehir, deniz
     ===================================================================== */
  Object.assign(LQ, {
    quicksand: { top: '#e8c07a', mid: '#b98444', deep: '#5e3816', back: '#9a6a34', foam: '#f6dca6', glint: '#fff2d0' },
    plasma: { top: '#f2c6ff', mid: '#9a4dff', deep: '#1c0858', back: '#6a2ad8', foam: '#efd8ff', glint: '#ffffff' },
    neon: { top: '#eaff8a', mid: '#3ee86a', deep: '#063a26', back: '#1aa84a', foam: '#f2ffb8', glint: '#ffffff' },
    sea: { top: '#8af4f0', mid: '#1ebcd8', deep: '#0a5698', back: '#18a2c8', foam: '#ffffff', glint: '#ffffff' }
  });
  const LIQ_NEW = { quicksand: 1, plasma: 1, neon: 1, sea: 1 };
  function liquidNew(ctx, L, name, vx0, vx1, vy1) {
    const y0 = L.liq, c = LQ[name], hot = name === 'plasma' || name === 'neon';
    const st = 16, x0 = Math.floor((vx0 - 20) / st) * st, x1 = vx1 + 20, yb = vy1 + 12;
    const slow = name === 'quicksand';
    const wv = (x, k) => slow ? Math.sin(x * .018 + tk * .7) * 1.6 + Math.sin(x * .05 - tk * .4) * .8 : waveY(x, k);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x0, yb);
    for (let x = x0; x <= x1 + st; x += st) ctx.lineTo(x, y0 - 6 + wv(x, 1));
    ctx.lineTo(x1 + st, yb); ctx.closePath();
    ctx.fillStyle = rgba(c.back, slow ? .9 : hot ? .8 : .6); ctx.fill();
    if (hot) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(0, y0 - 90);
      ctx.fillStyle = cg(ctx, 'lq:heat:' + name, g => LG(g, 0, 0, 0, 96, [[0, rgba(c.mid, 0)], [.7, rgba(c.mid, .14)], [1, rgba(c.top, .34)]]));
      ctx.fillRect(x0, 0, x1 - x0 + st, 96); ctx.restore();
    }
    ctx.beginPath(); ctx.moveTo(x0, yb);
    for (let x = x0; x <= x1 + st; x += st) ctx.lineTo(x, y0 + wv(x, 0));
    ctx.lineTo(x1 + st, yb); ctx.closePath();
    ctx.save(); ctx.translate(0, y0 - 6);
    ctx.fillStyle = cg(ctx, 'lq:' + name, g => LG(g, 0, 0, 0, 110, slow
      ? [[0, rgba(c.top, 1)], [.14, rgba(c.mid, 1)], [1, rgba(c.deep, 1)]]
      : hot ? [[0, rgba(c.top, .95)], [.12, rgba(c.mid, .92)], [.5, rgba(shade(c.mid, -.4), .95)], [1, rgba(c.deep, 1)]]
        : [[0, rgba(c.top, .7)], [.14, rgba(c.mid, .8)], [.5, rgba(c.mid, .9)], [1, rgba(c.deep, .97)]]));
    ctx.fill(); ctx.restore();
    // yüzey çizgisi
    ctx.beginPath();
    for (let x = x0; x <= x1 + st; x += st) { const y = y0 + wv(x, 0); if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = rgba(c.foam, .92);
    if (hot) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 7; ctx.strokeStyle = rgba(c.mid, .35); ctx.stroke(); ctx.restore(); ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(c.foam, .95); }
    ctx.stroke();
    if (name === 'quicksand') {
      // yavaş dönen girdaplar + batan kum çizgileri
      ctx.lineCap = 'round';
      const sp = 150;
      for (let i = Math.floor(x0 / sp) - 1; i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, 83), cx = i * sp + h * 80, cy = y0 + 12 + h * 16;
        for (let k = 0; k < 3; k++) {
          const a = tk * (.6 + h * .4) + k * 2.1, rx = 14 + k * 9;
          ctx.strokeStyle = rgba(k ? '#6e4216' : '#f2d29a', .45 - k * .1); ctx.lineWidth = 2.2 - k * .4;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * .22, 0, a, a + 2); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255,236,190,0.22)';
      const sp2 = 120;
      for (let i = Math.floor(x0 / sp2) - 1; i <= Math.ceil(x1 / sp2); i++) {
        const h = hs(i, 84), x = i * sp2 + ((tk * 5 + h * 100) % sp2);
        E(ctx, x, y0 + 30 + h * 30, 22 + h * 16, 2.2, 'rgba(255,236,190,0.18)');
      }
    } else if (hot) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sp = 74;
      for (let i = Math.floor(x0 / sp); i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, name === 'plasma' ? 93 : 94), per = 1.4 + h * 2, ph = ((tk + h * 7) % per) / per;
        const x = i * sp + h * 50, y = y0 + waveY(x, 0);
        if (ph < .7) { const r = 1.5 + 5 * ph / .7; ctx.fillStyle = rgba(c.top, .8); ctx.beginPath(); ctx.arc(x, y + 1, r, PI, 0); ctx.fill(); }
        else {
          const q = (ph - .7) / .3; ctx.fillStyle = rgba(c.foam, 1 - q);
          for (let k = 0; k < 3; k++) { const t = q * .5; ctx.beginPath(); ctx.arc(x + (k - 1) * 26 * t * 2, y - 70 * t + 260 * t * t, 1.6 * (1 - q) + .6, 0, TAU); ctx.fill(); }
        }
      }
      if (name === 'plasma' && !lowQ()) {
        // elektrik arkları (kısa, titrek)
        const sp2 = 210;
        ctx.strokeStyle = 'rgba(200,240,255,0.85)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'miter';
        for (let i = Math.floor(x0 / sp2); i <= Math.ceil(x1 / sp2); i++) {
          const h = hs(i, 95), on = ((tk * 2.2 + h * 5) % 2.4) < .18; if (!on) continue;
          const x = i * sp2 + h * 120, y = y0 + 14 + h * 20, seed = (tk * 30) | 0;
          ctx.beginPath(); ctx.moveTo(x, y);
          for (let k = 1; k <= 6; k++) ctx.lineTo(x + k * 9, y + (hash(seed + k * 7 + i) - .5) * 14);
          ctx.stroke();
        }
      }
      ctx.restore();
    } else {
      // deniz: ışıltılar + köpük kıvrımları
      ctx.fillStyle = c.glint;
      const sp = 44;
      for (let i = Math.floor(x0 / sp); i <= Math.ceil(x1 / sp); i++) {
        const h = hs(i, 71), a = Math.sin(tk * 2.2 + h * 30); if (a < .25) continue;
        const x = i * sp + h * 30, y = y0 + 10 + hs(i, 72) * 64; if (y > yb) continue;
        ctx.globalAlpha = (a - .25) * (1 - (y - y0) / 110) * .9;
        ctx.beginPath(); rrp(ctx, x, y, 5 + h * 12, 1.8, .9); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      const sp2 = 90;
      for (let i = Math.floor(x0 / sp2) - 1; i <= Math.ceil(x1 / sp2); i++) {
        const h = hs(i, 74), per = 2.4 + h * 1.6, ph = ((tk + h * 9) % per) / per, x = i * sp2 + h * 50 + ph * 30, y = y0 + waveY(x, 0) + 1;
        ctx.globalAlpha = Math.sin(ph * PI) * .9;
        ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.quadraticCurveTo(x, y - 4, x + 10, y); ctx.quadraticCurveTo(x + 13, y + 2, x + 9, y + 3); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // çukur duvarlarına vuran dudak
    if (hot) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; }
    for (const gp of gaps) {
      if (gp.x1 < vx0 - 20 || gp.x0 > vx1 + 20) continue;
      for (let s = 0; s < 2; s++) {
        const wx = s ? gp.x1 - 1 : gp.x0 + 1, dir = s ? -1 : 1;
        const y = y0 + wv(wx, 0) - 1 + (slow ? 0 : Math.sin(tk * 3.1 + wx * .05) * 1.2);
        ctx.fillStyle = rgba(c.foam, hot ? .55 : .9);
        ctx.beginPath(); ctx.ellipse(wx + dir * 4, y, 9, slow ? 3 : 3.6, 0, 0, TAU); ctx.fill();
        if (!slow) {
          ctx.fillStyle = rgba(c.foam, hot ? .4 : .75);
          const b1 = (tk * 1.7 + wx * .013) % 1;
          ctx.beginPath(); ctx.arc(wx + dir * (11 + b1 * 6), y - 2 - b1 * 3, 2.2 * (1 - b1) + .4, 0, TAU); ctx.fill();
        }
      }
    }
    if (hot) ctx.restore();
    ctx.restore();
  }

  /* =====================================================================
     DEKOR (yeni temalar)
     ===================================================================== */
  const OLD_ = '#3a1e0a', OLP = '#0a0c1e', OLN = '#0c0818', OLT = '#1e3a14';
  Object.assign(DEC, {
    /* ---- ÇÖL ---- */
    obelisk: { w: 60, h: 210, base: 5, nv: 2, noFlip: true, draw(g, v) {
      const h = v ? 150 : 180;
      const p = new Path2D(); p.moveTo(-14, 2); p.lineTo(-10, -h); p.lineTo(0, -h - 18); p.lineTo(10, -h); p.lineTo(14, 2); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLD_;
      g.fillStyle = LG(g, -14, 0, 14, 0, [[0, '#b8804a'], [.5, '#e6b878'], [.52, '#c48c50'], [1, '#9a6434']]); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(-10, -h); g.lineTo(0, -h - 18); g.lineTo(10, -h); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(0, -h - 18); g.lineTo(-4, -h - 4); g.lineTo(-8, -h); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(100,55,20,0.65)'; g.lineWidth = 1.5; g.lineCap = 'round';
      for (let y = -h + 16; y < -24; y += 22) {
        g.beginPath(); g.ellipse(0, y, 3.4, 2.2, 0, 0, TAU); g.moveTo(-5, y + 7); g.lineTo(5, y + 7); g.moveTo(0, y + 4); g.lineTo(0, y + 12); g.stroke();
      }
      g.restore();
      g.stroke(p);
      const b = new Path2D(); rrp(b, -20, -10, 40, 12, 2); g.fillStyle = LG(g, 0, -10, 0, 2, [[0, '#e0b070'], [1, '#9a6434']]); g.fill(b); g.stroke(b);
    } },
    temple_pillar: { w: 80, h: 180, base: 4, nv: 2, draw(g, v) {
      const top = v ? -112 : -146;
      const col = new Path2D(); col.moveTo(-15, -14); col.lineTo(-13, top + 14);
      if (v) { col.lineTo(-6, top + 4); col.lineTo(0, top + 12); col.lineTo(7, top); col.lineTo(13, top + 8); } else col.lineTo(13, top + 14);
      col.lineTo(15, -14); col.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLD_;
      g.fillStyle = LG(g, -15, 0, 15, 0, [[0, '#a8743e'], [.45, '#f0c888'], [1, '#8a5a2a']]); g.fill(col);
      g.save(); g.clip(col);
      for (let y = top + 20; y < -14; y += 26) { g.fillStyle = 'rgba(90,50,15,0.35)'; g.fillRect(-16, y, 32, 2); }
      g.fillStyle = '#3a9aa8'; g.fillRect(-16, top + 28, 32, 5); g.fillStyle = '#c84a3a'; g.fillRect(-16, top + 33, 32, 3);
      g.restore(); g.stroke(col);
      if (!v) {
        const cap = new Path2D(); cap.moveTo(-15, top + 14); cap.quadraticCurveTo(-28, top + 4, -24, top - 6); cap.lineTo(24, top - 6); cap.quadraticCurveTo(28, top + 4, 15, top + 14); cap.closePath();
        g.fillStyle = LG(g, 0, top - 6, 0, top + 14, [[0, '#f6d49a'], [1, '#a8743e']]); g.fill(cap); g.stroke(cap);
        g.strokeStyle = '#3a9aa8'; g.lineWidth = 2; for (let x = -16; x <= 16; x += 8) { g.beginPath(); g.moveTo(x * .9, top + 10); g.lineTo(x * 1.3, top - 4); g.stroke(); }
        const ab = new Path2D(); rrp(ab, -28, top - 14, 56, 9, 2); g.fillStyle = '#c8945a'; g.fill(ab); g.lineWidth = 3; g.strokeStyle = OLD_; g.stroke(ab);
      }
      const base = new Path2D(); rrp(base, -24, -14, 48, 16, 3); g.fillStyle = LG(g, 0, -14, 0, 2, [[0, '#e6be80'], [1, '#8a5a2a']]); g.fill(base); g.stroke(base);
    } },
    cactus_big: { w: 100, h: 160, base: 4, nv: 2, draw(g, v) {
      saguaro(g, 120 + v * 14, { body: '#4f9a4a', lit: 'rgba(190,240,140,0.5)', rib: 'rgba(30,80,30,0.45)', ol: '#1e3e12' }, v);
      if (!v) for (const f of [[0, -134], [-29, -84]]) { E(g, f[0], f[1], 5, 3.4, '#1e3e12'); E(g, f[0], f[1] - .5, 4, 2.6, '#ff5a7a'); E(g, f[0], f[1] - 1, 1.4, 1.2, '#ffe066'); }
    } },
    sphinx: { w: 170, h: 110, base: 4, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLD_;
      const ped = new Path2D(); rrp(ped, -76, -20, 152, 22, 3);
      g.fillStyle = LG(g, 0, -20, 0, 2, [[0, '#e6be80'], [1, '#9a6434']]); g.fill(ped); g.stroke(ped);
      const body = new Path2D();
      body.moveTo(-62, -20); body.quadraticCurveTo(-66, -48, -40, -52); body.lineTo(18, -52); body.quadraticCurveTo(26, -52, 28, -46); body.lineTo(60, -40); body.quadraticCurveTo(70, -36, 68, -20); body.closePath();
      g.fillStyle = LG(g, 0, -56, 0, -20, [[0, '#f0c888'], [1, '#b07a42']]); g.fill(body); g.stroke(body);
      const head = new Path2D(); head.moveTo(10, -50); head.lineTo(6, -84); head.quadraticCurveTo(22, -100, 38, -84); head.lineTo(34, -50); head.closePath();
      g.fillStyle = '#3a8aa0'; g.fill(head); g.stroke(head);
      g.save(); g.clip(head); g.fillStyle = '#ffd24a'; for (let y = -84; y < -50; y += 7) g.fillRect(4, y, 40, 3); g.restore(); g.stroke(head);
      const face = new Path2D(); rrp(face, 15, -82, 14, 22, 5); g.fillStyle = '#e0aa6a'; g.fill(face); g.lineWidth = 2; g.stroke(face);
      E(g, 19, -74, 1.6, 1.2, '#2a1606'); E(g, 25, -74, 1.6, 1.2, '#2a1606'); g.fillStyle = '#7a4a1e'; g.fillRect(19, -66, 7, 1.6);
      g.lineWidth = 2; g.strokeStyle = 'rgba(90,50,15,0.6)'; g.beginPath(); g.moveTo(40, -22); g.lineTo(40, -38); g.moveTo(-40, -22); g.quadraticCurveTo(-46, -34, -38, -44); g.stroke();
      g.fillStyle = 'rgba(255,240,200,0.4)'; g.fillRect(-40, -50, 56, 3);
    } },
    cactus_s: { w: 46, h: 46, base: 3, nv: 3, draw(g, v) {
      const p = new Path2D(); p.ellipse(0, -12, 11, 13, 0, 0, TAU); if (v === 2) { p.moveTo(-8, -6); p.ellipse(-12, -6, 6, 7, 0, 0, TAU); }
      olFill(g, p, '#5aa850', '#1e3e12', 2.6);
      g.save(); g.clip(p); g.strokeStyle = 'rgba(30,80,30,0.5)'; g.lineWidth = 1.2; for (let x = -9; x <= 9; x += 4.5) { g.beginPath(); g.moveTo(x, -26); g.quadraticCurveTo(x * 1.2, -12, x, 2); g.stroke(); } g.fillStyle = 'rgba(200,250,150,0.45)'; g.fillRect(-5, -24, 3, 20); g.restore();
      g.strokeStyle = '#fff6d0'; g.lineWidth = .9; for (let i = 0; i < 9; i++) { const a = i * .7, x = Math.cos(a) * 9, y = -12 + Math.sin(a) * 11; g.beginPath(); g.moveTo(x, y); g.lineTo(x * 1.25, y + (y + 12) * .25); g.stroke(); }
      if (v !== 1) { E(g, 0, -26, 4.6, 3, '#1e3e12'); E(g, 0, -26.4, 3.6, 2.2, v ? '#ffd24a' : '#ff6a9a'); }
    } },
    urn: { w: 44, h: 54, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); p.moveTo(-6, -38); p.lineTo(6, -38); p.quadraticCurveTo(4, -32, 12, -26); p.quadraticCurveTo(20, -12, 8, 2); p.lineTo(-8, 2); p.quadraticCurveTo(-20, -12, -12, -26); p.quadraticCurveTo(-4, -32, -6, -38); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 2.8; g.strokeStyle = OLD_;
      g.fillStyle = LG(g, -16, 0, 16, 0, [[0, '#8a4a22'], [.45, '#d2804a'], [1, '#7a3c18']]); g.fill(p);
      g.save(); g.clip(p); g.fillStyle = '#2a1608'; g.fillRect(-20, -22, 40, 3); g.fillRect(-20, -10, 40, 2);
      g.strokeStyle = '#2a1608'; g.lineWidth = 1.4; g.beginPath(); for (let x = -16; x < 16; x += 5) { g.moveTo(x, -18); g.lineTo(x + 2.5, -14); g.lineTo(x + 5, -18); } g.stroke(); g.restore();
      g.stroke(p);
      E(g, 0, -38, 7, 2.2, OLD_); if (v) { g.strokeStyle = 'rgba(40,20,5,0.8)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(8, -30); g.lineTo(4, -22); g.lineTo(9, -16); g.stroke(); }
      E(g, -6, -26, 2.4, 4, 'rgba(255,220,180,0.45)');
    } },
    bones: { w: 56, h: 30, base: 3, nv: 2, draw(g, v) {
      g.lineCap = 'round';
      const bone = (x0, y0, x1, y1) => { for (let pass = 0; pass < 2; pass++) { g.strokeStyle = pass ? '#f2e8d0' : OLD_; g.lineWidth = pass ? 3.2 : 6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); for (const [x, y] of [[x0, y0], [x1, y1]]) { E(g, x, y - 1.5, pass ? 2.6 : 3.8, pass ? 2.6 : 3.8, pass ? '#f2e8d0' : OLD_); E(g, x, y + 1.5, pass ? 2.6 : 3.8, pass ? 2.6 : 3.8, pass ? '#f2e8d0' : OLD_); } } };
      if (v) { // kaburga
        g.strokeStyle = OLD_; g.lineWidth = 5; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-6 + i * 7, 0, 10 - i, PI * 1.05, PI * 1.85); g.stroke(); }
        g.strokeStyle = '#f2e8d0'; g.lineWidth = 2.6; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-6 + i * 7, 0, 10 - i, PI * 1.05, PI * 1.85); g.stroke(); }
        bone(-18, 0, 18, -1);
      } else { bone(-16, -2, 12, -6); bone(-8, 0, 18, 0); }
    } },
    dry_bush: { w: 54, h: 40, base: 3, nv: 2, draw(g, v) {
      const rnd = mrng(150 + v);
      g.lineCap = 'round';
      const br = (x, y, a, l, w, d) => { const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); if (d > 0) { br(x2, y2, a - .5 - rnd() * .3, l * .7, w * .7, d - 1); br(x2, y2, a + .45 + rnd() * .3, l * .66, w * .7, d - 1); } };
      g.strokeStyle = OLD_; br(0, 2, -PI / 2, 12, 4.4, 3); br(-2, 2, -PI / 2 - .7, 10, 3.6, 2); br(2, 2, -PI / 2 + .7, 10, 3.6, 2);
      g.strokeStyle = '#b8864a';
      const rr = mrng(150 + v);
      const br2 = (x, y, a, l, w, d) => { const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); if (d > 0) { br2(x2, y2, a - .5 - rr() * .3, l * .7, w * .7, d - 1); br2(x2, y2, a + .45 + rr() * .3, l * .66, w * .7, d - 1); } };
      br2(0, 2, -PI / 2, 12, 2, 3); br2(-2, 2, -PI / 2 - .7, 10, 1.6, 2); br2(2, 2, -PI / 2 + .7, 10, 1.6, 2);
    } },
    /* ---- UZAY ---- */
    antenna: { w: 60, h: 190, base: 4, nv: 2, noFlip: true, draw(g, v) {
      const h = v ? 130 : 165;
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = OLP; g.lineWidth = 5; g.beginPath(); g.moveTo(-12, 0); g.lineTo(0, -h); g.lineTo(12, 0); g.moveTo(0, -h); g.lineTo(0, -h - 14); g.stroke();
      g.strokeStyle = '#8a96b8'; g.lineWidth = 2.4; g.stroke();
      g.strokeStyle = '#5a6488'; g.lineWidth = 1.4; g.beginPath();
      for (let y = -12; y > -h + 10; y -= 16) { const w = 12 * (1 + y / h); g.moveTo(-w, y); g.lineTo(w * .8, y - 16); g.moveTo(w, y); g.lineTo(-w * .8, y - 16); }
      g.stroke();
      for (const y of [-h * .45, -h * .75]) { g.strokeStyle = OLP; g.lineWidth = 4; g.beginPath(); g.moveTo(-16, y); g.lineTo(16, y); g.stroke(); g.strokeStyle = '#b4c0e0'; g.lineWidth = 1.8; g.stroke(); }
      const b = new Path2D(); rrp(b, -18, -8, 36, 10, 2); olFill(g, b, '#3a4462', OLP, 2.4);
      E(g, 0, -h - 15, 4.4, 4.4, OLP); E(g, 0, -h - 15, 3, 3, '#ff4a4a');
    } },
    fuel_tank: { w: 90, h: 120, base: 4, nv: 2, draw(g, v) {
      const h = v ? 70 : 92;
      const p = new Path2D(); rrp(p, -28, -h, 56, h + 2, 26);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLP;
      g.fillStyle = LG(g, -28, 0, 28, 0, [[0, '#5a6688'], [.35, '#dfe6f6'], [.6, '#a8b4d0'], [1, '#3a4462']]); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = v ? '#ff6a3a' : '#3ac8ff'; g.fillRect(-30, -h * .55, 60, 12);
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-30, -h * .55, 60, 2);
      g.fillStyle = OLP; g.font = 'bold 9px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(v ? 'O₂' : 'H₂', 0, -h * .55 + 6.5);
      g.restore(); g.stroke(p);
      for (const x of [-20, 20]) { const l = new Path2D(); rrp(l, x - 4, -8, 8, 10, 1); olFill(g, l, '#2a3250', OLP, 2); }
      g.strokeStyle = OLP; g.lineWidth = 5; g.beginPath(); g.moveTo(24, -h * .3); g.quadraticCurveTo(40, -h * .3, 40, 0); g.stroke(); g.strokeStyle = '#8a96b8'; g.lineWidth = 2.4; g.stroke();
    } },
    sat_dish: { w: 100, h: 110, base: 4, nv: 2, draw(g, v) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      const st = new Path2D(); st.moveTo(-14, 2); st.lineTo(-4, -40); st.lineTo(4, -40); st.lineTo(14, 2); st.closePath(); olFill(g, st, '#4a5474', OLP, 2.6);
      g.save(); g.translate(0, -52); g.rotate(v ? -.75 : -.5);
      const d = new Path2D(); d.moveTo(-36, 0); d.quadraticCurveTo(0, 30, 36, 0); d.closePath();
      g.lineWidth = 3; g.strokeStyle = OLP; g.fillStyle = LG(g, 0, 0, 0, 16, [[0, '#f0f4ff'], [1, '#8a96b8']]); g.fill(d); g.stroke(d);
      E(g, 0, 0, 36, 4, '#c8d2ea'); g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 36, 4, 0, 0, TAU); g.stroke();
      g.strokeStyle = OLP; g.lineWidth = 3; g.beginPath(); g.moveTo(-20, 1); g.lineTo(0, -26); g.lineTo(20, 1); g.stroke(); g.strokeStyle = '#a8b4d0'; g.lineWidth = 1.4; g.stroke();
      E(g, 0, -27, 4, 4, OLP); E(g, 0, -27, 2.6, 2.6, '#5ff0ff');
      g.restore();
    } },
    reactor: { w: 110, h: 130, base: 4, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round';
      const base = new Path2D(); rrp(base, -44, -24, 88, 26, 4); olFill(g, base, '#3a4462', OLP, 3);
      g.fillStyle = '#e8b22a'; g.fillRect(-40, -18, 80, 6); g.fillStyle = OLP; for (let x = -40; x < 40; x += 10) { g.beginPath(); g.moveTo(x, -12); g.lineTo(x + 5, -12); g.lineTo(x + 10, -18); g.lineTo(x + 5, -18); g.closePath(); g.fill(); }
      const core = new Path2D(); rrp(core, -20, -100, 40, 78, 10);
      g.fillStyle = LG(g, -20, 0, 20, 0, [[0, '#2a6ad8'], [.5, '#c8f6ff'], [1, '#2a4ab8']]); g.fill(core);
      g.save(); g.clip(core); g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; for (let y = -94; y < -22; y += 10) { g.beginPath(); g.moveTo(-20, y); g.lineTo(20, y + 4); g.stroke(); } g.restore();
      g.lineWidth = 3; g.strokeStyle = OLP; g.stroke(core);
      for (const y of [-100, -64, -28]) { const r = new Path2D(); rrp(r, -26, y - 4, 52, 9, 3); olFill(g, r, '#5a6688', OLP, 2.4); }
      const cap = new Path2D(); cap.moveTo(-18, -104); cap.quadraticCurveTo(0, -122, 18, -104); cap.closePath(); olFill(g, cap, '#8a96b8', OLP, 2.6);
    } },
    sci_crate: { w: 50, h: 48, base: 3, nv: 2, draw(g, v) {
      const s = v ? 30 : 34;
      const p = new Path2D(); rrp(p, -s / 2, -s, s, s + 2, 4);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLP;
      g.fillStyle = LG(g, 0, -s, 0, 2, [[0, '#7a86a8'], [1, '#3a4462']]); g.fill(p);
      g.save(); g.clip(p); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(-s / 2, -s, s, 2.4);
      g.fillStyle = '#20263a'; g.fillRect(-s / 2 + 4, -s * .55, s - 8, 5); g.fillStyle = v ? '#ffd23f' : '#5ff0ff'; g.fillRect(-s / 2 + 6, -s * .55 + 1.5, (s - 12) * .6, 2);
      g.restore(); g.stroke(p);
      for (const [x, y] of [[-s / 2 + 4, -s + 4], [s / 2 - 4, -s + 4], [-s / 2 + 4, -3], [s / 2 - 4, -3]]) E(g, x, y, 1.4, 1.4, OLP);
    } },
    cables: { w: 60, h: 24, base: 3, nv: 2, draw(g, v) {
      g.lineCap = 'round';
      const cols = v ? ['#d84a6a', '#e8b22a'] : ['#3a6ad8', '#5ac86a'];
      for (let k = 0; k < 2; k++) {
        const pth = new Path2D(); pth.moveTo(-26, 0); pth.bezierCurveTo(-14, -14 - k * 4, -4, 6, 6, -6 - k * 3); pth.bezierCurveTo(14, -16, 20, 2, 26, -1);
        g.strokeStyle = OLP; g.lineWidth = 6; g.stroke(pth); g.strokeStyle = cols[k]; g.lineWidth = 3.4; g.stroke(pth);
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.stroke(pth);
      }
      const box = new Path2D(); rrp(box, 18, -8, 12, 9, 2); olFill(g, box, '#4a5474', OLP, 2);
    } },
    floor_lamp: { w: 40, h: 60, base: 3, nv: 1, noFlip: true, draw(g) {
      const st = new Path2D(); rrp(st, -3, -30, 6, 32, 2); olFill(g, st, '#4a5474', OLP, 2.4);
      const b = new Path2D(); rrp(b, -10, -4, 20, 6, 2); olFill(g, b, '#3a4462', OLP, 2.4);
      const h = new Path2D(); h.moveTo(-9, -30); h.lineTo(-6, -42); h.lineTo(6, -42); h.lineTo(9, -30); h.closePath(); olFill(g, h, '#2a3250', OLP, 2.4);
      g.fillStyle = '#c8f6ff'; g.fillRect(-7, -33, 14, 3);
    } },
    canister: { w: 34, h: 50, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); rrp(p, -9, -34, 18, 36, 7);
      g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLP;
      g.fillStyle = LG(g, -9, 0, 9, 0, v ? [[0, '#a83a2a'], [.4, '#ff8a6a'], [1, '#7a2418']] : [[0, '#2a8a5a'], [.4, '#7affb8'], [1, '#1a5a3a']]); g.fill(p); g.stroke(p);
      const c = new Path2D(); rrp(c, -4, -40, 8, 7, 2); olFill(g, c, '#8a96b8', OLP, 2);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-5, -28, 2.4, 22);
    } },
    /* ---- ŞEHİR ---- */
    streetlamp: { w: 70, h: 190, base: 4, nv: 1, draw(g) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      const pole = new Path2D(); pole.moveTo(0, 0); pole.lineTo(0, -150); pole.quadraticCurveTo(0, -166, 18, -166); pole.lineTo(24, -166);
      g.strokeStyle = OLN; g.lineWidth = 7; g.stroke(pole); g.strokeStyle = '#4a4a62'; g.lineWidth = 3.6; g.stroke(pole);
      g.strokeStyle = 'rgba(200,190,255,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-1, -6); g.lineTo(-1, -148); g.stroke();
      const h = new Path2D(); h.moveTo(10, -168); h.lineTo(34, -168); h.lineTo(30, -160); h.lineTo(14, -160); h.closePath(); olFill(g, h, '#3a3a52', OLN, 2.6);
      g.fillStyle = '#fff2b0'; g.fillRect(15, -161, 14, 2.4);
      const b = new Path2D(); rrp(b, -8, -12, 16, 14, 3); olFill(g, b, '#3a3a52', OLN, 2.6);
    } },
    neon_sign: { w: 110, h: 150, base: 4, nv: 3, noFlip: true, draw(g, v) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const x of [-30, 30]) { g.strokeStyle = OLN; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, -86); g.stroke(); g.strokeStyle = '#4a4a62'; g.lineWidth = 3; g.stroke(); }
      const b = new Path2D(); rrp(b, -46, -136, 92, 52, 6); olFill(g, b, '#1a1230', OLN, 3);
      const col = ['#ff4fa8', '#39e6ff', '#ffe14a'][v], txt = ['ÇAY', 'BÜFE', 'OTEL'][v];
      g.save(); g.shadowColor = col; g.shadowBlur = 10;
      g.strokeStyle = col; g.lineWidth = 2.6; g.beginPath(); rrp(g, -40, -130, 80, 40, 4); g.stroke();
      g.font = '24px ' + FM.FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 2; g.strokeStyle = col; g.strokeText(txt, 0, -108); g.fillStyle = shade(col, .6); g.fillText(txt, 0, -108);
      g.restore();
    } },
    water_tower: { w: 100, h: 170, base: 4, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = OLN; g.lineWidth = 5; g.beginPath(); g.moveTo(-30, 2); g.lineTo(-24, -78); g.moveTo(30, 2); g.lineTo(24, -78); g.moveTo(-28, -30); g.lineTo(26, -60); g.moveTo(28, -30); g.lineTo(-26, -60); g.stroke();
      g.strokeStyle = '#5a5470'; g.lineWidth = 2.4; g.stroke();
      const t = new Path2D(); rrp(t, -36, -138, 72, 62, 6); g.lineWidth = 3; g.strokeStyle = OLN;
      g.fillStyle = LG(g, -36, 0, 36, 0, [[0, '#4a2e22'], [.45, '#9a6a4a'], [1, '#3a2218']]); g.fill(t);
      g.save(); g.clip(t); g.strokeStyle = 'rgba(30,15,8,0.6)'; g.lineWidth = 1.2; for (let x = -30; x < 36; x += 8) { g.beginPath(); g.moveTo(x, -138); g.lineTo(x, -76); g.stroke(); } g.fillStyle = '#2a2a3a'; g.fillRect(-38, -124, 76, 4); g.fillRect(-38, -92, 76, 4); g.restore();
      g.stroke(t);
      const r = new Path2D(); r.moveTo(-40, -136); r.lineTo(0, -160); r.lineTo(40, -136); r.closePath(); olFill(g, r, '#3a3448', OLN, 3);
    } },
    crane: { w: 140, h: 220, base: 4, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      const yel = '#e8b22a';
      const lat = (x0, y0, x1, y1, w) => {
        g.strokeStyle = OLN; g.lineWidth = 4; g.beginPath(); g.moveTo(x0 - w, y0); g.lineTo(x1 - w, y1); g.moveTo(x0 + w, y0); g.lineTo(x1 + w, y1); g.stroke();
        g.strokeStyle = yel; g.lineWidth = 2; g.stroke();
      };
      lat(0, 0, 0, -190, 6);
      g.strokeStyle = yel; g.lineWidth = 1.2; g.beginPath(); for (let y = 0; y > -190; y -= 12) { g.moveTo(-6, y); g.lineTo(6, y - 12); } g.stroke();
      g.strokeStyle = OLN; g.lineWidth = 6; g.beginPath(); g.moveTo(-40, -190); g.lineTo(64, -190); g.stroke(); g.strokeStyle = yel; g.lineWidth = 3; g.stroke();
      g.strokeStyle = OLN; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -214); g.lineTo(64, -190); g.moveTo(0, -214); g.lineTo(-40, -190); g.moveTo(0, -214); g.lineTo(0, -190); g.stroke();
      g.beginPath(); g.moveTo(48, -190); g.lineTo(48, -120); g.stroke();
      const hk = new Path2D(); rrp(hk, 42, -122, 12, 8, 2); olFill(g, hk, yel, OLN, 2);
      const cw = new Path2D(); rrp(cw, -42, -196, 16, 14, 2); olFill(g, cw, '#5a5470', OLN, 2);
      const cab = new Path2D(); rrp(cab, 6, -186, 16, 12, 2); olFill(g, cab, yel, OLN, 2); g.fillStyle = '#9fe6ff'; g.fillRect(10, -184, 8, 5);
    } },
    trash_can: { w: 40, h: 48, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D(); p.moveTo(-12, -30); p.lineTo(12, -30); p.lineTo(10, 2); p.lineTo(-10, 2); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLN;
      g.fillStyle = LG(g, -12, 0, 12, 0, v ? [[0, '#2a5a3a'], [.45, '#5aa070'], [1, '#1a3a24']] : [[0, '#4a4a5a'], [.45, '#9a9ab0'], [1, '#30303e']]); g.fill(p);
      g.save(); g.clip(p); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.4; for (let x = -8; x <= 8; x += 4) { g.beginPath(); g.moveTo(x, -28); g.lineTo(x * .85, 0); g.stroke(); } g.restore();
      g.stroke(p);
      const lid = new Path2D(); rrp(lid, -14, -35, 28, 6, 2); olFill(g, lid, v ? '#3a7a4a' : '#6a6a80', OLN, 2.4);
      if (!v) { E(g, 9, -36, 4, 2, '#e8e0cc'); }
    } },
    hydrant: { w: 34, h: 44, base: 3, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round';
      const b = new Path2D(); rrp(b, -8, -26, 16, 28, 4); olFill(g, b, '#e0303a', OLN, 2.6);
      const t = new Path2D(); t.moveTo(-9, -26); t.quadraticCurveTo(0, -38, 9, -26); t.closePath(); olFill(g, t, '#c42030', OLN, 2.6);
      for (const s of [-1, 1]) { const n = new Path2D(); rrp(n, s > 0 ? 7 : -13, -20, 6, 8, 2); olFill(g, n, '#c42030', OLN, 2.2); }
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(-5, -24, 2.4, 22);
      const f = new Path2D(); rrp(f, -11, -3, 22, 5, 2); olFill(g, f, '#a8182a', OLN, 2.2);
    } },
    traffic_cone: { w: 30, h: 38, base: 3, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round';
      const p = new Path2D(); p.moveTo(-3, -28); p.lineTo(3, -28); p.lineTo(9, -2); p.lineTo(-9, -2); p.closePath(); olFill(g, p, '#ff7a1a', OLN, 2.4);
      g.save(); g.clip(p); g.fillStyle = '#ffffff'; g.fillRect(-10, -19, 20, 4); g.fillRect(-10, -10, 20, 3); g.restore();
      const b = new Path2D(); rrp(b, -13, -3, 26, 5, 1.5); olFill(g, b, '#e05a10', OLN, 2.2);
    } },
    ac_unit: { w: 50, h: 40, base: 3, nv: 1, draw(g) {
      const p = new Path2D(); rrp(p, -18, -26, 36, 28, 3);
      g.lineJoin = 'round'; g.lineWidth = 2.6; g.strokeStyle = OLN;
      g.fillStyle = LG(g, 0, -26, 0, 2, [[0, '#c8c8d8'], [1, '#7a7a90']]); g.fill(p); g.stroke(p);
      g.fillStyle = '#2a2a3a'; g.beginPath(); g.arc(-4, -12, 10, 0, TAU); g.fill();
      g.strokeStyle = '#8a8aa0'; g.lineWidth = 1.2; for (let a = 0; a < 3; a++) { g.beginPath(); g.moveTo(-4, -12); g.lineTo(-4 + Math.cos(a * 2.1) * 8, -12 + Math.sin(a * 2.1) * 8); g.stroke(); }
      g.fillStyle = '#5a5a70'; for (let y = -22; y < -2; y += 4) g.fillRect(9, y, 7, 1.6);
    } },
    /* ---- TROPİK ---- */
    palm: { w: 200, h: 220, base: 5, nv: 3, draw(g, v) {
      palmDraw(g, 130 + v * 12, (v - 1) * .12 + .06, { trunk: '#b08a5a', trunkD: '#7a5a34', ring: 'rgba(70,40,15,0.45)', leaf: '#3aa84a', leafL: '#5cc85a', leafD: '#1e6a2a', ol: OLT, nut: '#6a4a24' }, v);
    } },
    palm_big: { w: 250, h: 290, base: 5, nv: 2, draw(g, v) {
      palmDraw(g, 190 + v * 16, v ? -.14 : .12, { trunk: '#b08a5a', trunkD: '#7a5a34', ring: 'rgba(70,40,15,0.45)', leaf: '#34a046', leafL: '#5ccc5c', leafD: '#1a5e26', ol: OLT, nut: '#6a4a24' }, v + 1);
    } },
    tiki: { w: 50, h: 130, base: 4, nv: 2, noFlip: true, draw(g, v) {
      g.lineJoin = 'round';
      const p = new Path2D(); rrp(p, -15, -104, 30, 106, 6);
      g.lineWidth = 3; g.strokeStyle = OLT;
      g.fillStyle = LG(g, -15, 0, 15, 0, [[0, '#6a4224'], [.5, '#b0804a'], [1, '#5a3418']]); g.fill(p); g.stroke(p);
      const face = (y, k) => {
        g.fillStyle = '#2a1608'; E(g, -6, y, 4.4, k ? 3 : 4.4, '#2a1608'); E(g, 6, y, 4.4, k ? 3 : 4.4, '#2a1608');
        E(g, -6, y - .6, 2, 2, '#ffe066'); E(g, 6, y - .6, 2, 2, '#ffe066');
        g.fillRect(-2, y + 4, 4, 9);
        g.beginPath(); rrp(g, -10, y + 15, 20, k ? 6 : 9, 3); g.fill();
        g.fillStyle = '#f4f0e0'; for (let x = -8; x < 8; x += 4) g.fillRect(x + .6, y + 15.6, 2.6, 3);
      };
      face(-86, v); face(-44, 1 - v);
      g.fillStyle = v ? '#e8484a' : '#3ab8a8'; g.fillRect(-15, -62, 30, 5); g.fillStyle = '#ffd24a'; g.fillRect(-15, -22, 30, 4);
      const top = new Path2D(); top.moveTo(-20, -104); top.lineTo(0, -122); top.lineTo(20, -104); top.closePath(); olFill(g, top, '#4a8a3a', OLT, 2.6);
    } },
    beach_hut: { w: 150, h: 140, base: 4, nv: 1, noFlip: true, draw(g) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const x of [-46, 46]) { const l = new Path2D(); rrp(l, x - 4, -60, 8, 62, 2); olFill(g, l, '#8a5a30', OLT, 2.6); }
      const wall = new Path2D(); rrp(wall, -44, -64, 88, 42, 3);
      g.lineWidth = 3; g.strokeStyle = OLT; g.fillStyle = LG(g, -44, 0, 44, 0, [[0, '#a8783e'], [.5, '#d8aa6a'], [1, '#9a6a34']]); g.fill(wall);
      g.save(); g.clip(wall); g.strokeStyle = 'rgba(80,45,15,0.5)'; g.lineWidth = 1.4; for (let x = -40; x < 44; x += 7) { g.beginPath(); g.moveTo(x, -64); g.lineTo(x, -22); g.stroke(); } g.restore();
      g.stroke(wall);
      g.fillStyle = '#3a2210'; g.beginPath(); rrp(g, -10, -56, 20, 34, 3); g.fill();
      g.fillStyle = '#ffe9a0'; g.beginPath(); rrp(g, 20, -54, 14, 12, 2); g.fill(); g.lineWidth = 2; g.strokeStyle = OLT; g.stroke();
      const roof = new Path2D(); roof.moveTo(-64, -58); roof.lineTo(0, -118); roof.lineTo(64, -58); roof.quadraticCurveTo(0, -48, -64, -58); roof.closePath();
      g.fillStyle = LG(g, 0, -118, 0, -54, [[0, '#f0d08a'], [1, '#b8904a']]); g.lineWidth = 3; g.strokeStyle = OLT; g.fill(roof); g.stroke(roof);
      g.save(); g.clip(roof); g.strokeStyle = 'rgba(120,80,30,0.55)'; g.lineWidth = 1.4; for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(0, -118); g.lineTo(i * 11, -50); g.stroke(); } g.restore();
      g.strokeStyle = '#d8b06a'; g.lineWidth = 2; for (let x = -60; x < 62; x += 5) { g.beginPath(); g.moveTo(x, -56 + Math.abs(x) * -.02); g.lineTo(x + 1, -48); g.stroke(); }
      const fl = new Path2D(); rrp(fl, -56, -24, 112, 6, 2); olFill(g, fl, '#9a6a34', OLT, 2.4);
    } },
    shell: { w: 30, h: 22, base: 3, nv: 2, draw(g, v) {
      const p = new Path2D();
      if (v) { p.moveTo(-10, 0); p.quadraticCurveTo(-8, -14, 2, -14); p.quadraticCurveTo(12, -12, 10, 0); p.closePath(); }
      else { p.moveTo(0, 0); p.lineTo(-10, -2); p.quadraticCurveTo(-10, -16, 0, -16); p.quadraticCurveTo(10, -16, 10, -2); p.closePath(); }
      olFill(g, p, v ? '#ffd0e0' : '#fff0d8', '#6a3a2a', 2.2);
      g.save(); g.clip(p); g.strokeStyle = v ? 'rgba(200,90,120,0.6)' : 'rgba(200,120,70,0.6)'; g.lineWidth = 1.2;
      for (let a = -2; a <= 2; a++) { g.beginPath(); g.moveTo(0, 0); g.lineTo(a * 5, -16); g.stroke(); } g.restore();
      E(g, -3, -10, 2.4, 1.2, 'rgba(255,255,255,0.7)');
    } },
    starfish: { w: 32, h: 22, base: 3, nv: 2, draw(g, v) {
      g.save(); g.translate(0, -6); g.scale(1, .55); g.rotate(v * .3);
      const p = new Path2D();
      for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 5 : 13; if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r); else p.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      p.closePath();
      g.lineJoin = 'round'; olFill(g, p, v ? '#ff8a4a' : '#ff5a6a', '#6a1a1a', 3.6);
      g.fillStyle = 'rgba(255,240,200,0.8)'; for (let i = 0; i < 5; i++) { const a = -PI / 2 + i * TAU / 5; E(g, Math.cos(a) * 6, Math.sin(a) * 6, 1.3, 1.3, 'rgba(255,240,200,0.85)'); }
      g.restore();
    } },
    beach_grass: { w: 48, h: 40, base: 3, nv: 2, draw(g, v) {
      const rnd = mrng(190 + v);
      g.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 8; i++) {
        const x = -12 + i * 3.4, h = 14 + rnd() * 18, lean = (rnd() - .3) * 16;
        g.strokeStyle = pass ? (i % 2 ? '#8ad04a' : '#b8e070') : OLT; g.lineWidth = pass ? 1.8 : 3.4;
        g.beginPath(); g.moveTo(x, 2); g.quadraticCurveTo(x + lean * .3, -h * .5, x + lean, -h); g.stroke();
      }
    } },
    coconut: { w: 36, h: 24, base: 3, nv: 2, draw(g, v) {
      for (const [x, s] of v ? [[-6, 1], [7, .85]] : [[0, 1.1]]) {
        const p = new Path2D(); p.ellipse(x, -8 * s, 8 * s, 7.4 * s, 0, 0, TAU);
        olFill(g, p, '#6a4424', '#2a1606', 2.4);
        E(g, x - 2.6 * s, -11 * s, 2.6 * s, 1.6 * s, 'rgba(255,220,180,0.45)');
        E(g, x + 2 * s, -6 * s, 1, 1, '#2a1606'); E(g, x + 4.2 * s, -7.4 * s, 1, 1, '#2a1606');
      }
    } }
  });
  Object.assign(TALL_DEC, { obelisk: 1, temple_pillar: 1, cactus_big: 1, antenna: 1, streetlamp: 1, neon_sign: 1, water_tower: 1, crane: 1, palm: 1, palm_big: 1, tiki: 1 });
  Object.assign(FRONT_TO_BACK, { sci_crate: 1, urn: 1, canister: 1, trash_can: 1, ac_unit: 1 });
  Object.assign(BACK_TINT, { desert: [null, .26], space: ['#36277a', .3], city: ['#3a2a6a', .32], tropic: [null, .26] });
  Object.assign(ANIMATED, { antenna: 1, reactor: 1, floor_lamp: 1, streetlamp: 1, neon_sign: 1, tiki: 1 });
  /** Yeni dekorların animasyonlu ekleri (ışıklar; hepsi önbellekli parıltı sprite'ı ile) */
  const DANIM_NEW = {
    antenna(ctx, d, sc, flip, t, sd) {
      const h = (hash(d.seed | 0) * 2 | 0) ? 130 : 165;   // decorSpr varyantı ile aynı (nv 2)
      const on = ((t * .9 + sd) % 1.2) < .25; if (!on) return;
      glowAt(ctx, d.x, d.y + 2 - (h + 15) * sc, 'rgba(255,60,60,0.95)', 16 * sc, .9);
    },
    reactor(ctx, d, sc, flip, t, sd) { glowAt(ctx, d.x, d.y + 2 - 60 * sc, 'rgba(110,200,255,0.8)', 46 * sc, .45 + .2 * Math.sin(t * 3 + sd)); },
    floor_lamp(ctx, d, sc) { glowAt(ctx, d.x, d.y + 2 - 30 * sc, 'rgba(160,240,255,0.85)', 22 * sc, .55); },
    streetlamp(ctx, d, sc, flip, t, sd) {
      const dir = flip ? -1 : 1, x = d.x + 22 * sc * dir, y = d.y + 2 - 160 * sc;
      const f = .85 + .15 * Math.sin(t * 13 + sd) * (Math.sin(t * .7 + sd) > .9 ? 1 : 0);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .22 * f;
      ctx.fillStyle = cg(ctx, 'lampcone', g => LG(g, 0, 0, 0, 160, [[0, 'rgba(255,240,170,0.9)'], [1, 'rgba(255,240,170,0)']]));
      ctx.translate(x, y); ctx.scale(sc, sc); ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(44, 160); ctx.lineTo(-44, 160); ctx.closePath(); ctx.fill();
      ctx.restore();
      glowAt(ctx, x, y + 2 * sc, 'rgba(255,235,160,0.95)', 26 * sc, .7 * f);
    },
    neon_sign(ctx, d, sc, flip, t, sd) {
      const v = Math.floor(hash(d.seed | 0) * 3) % 3, col = ['rgba(255,79,168,0.8)', 'rgba(57,230,255,0.8)', 'rgba(255,225,74,0.8)'][v];
      const fl = Math.sin(t * 1.3 + sd * 7) > .94 ? .25 : 1;   // ara sıra cızırdayan neon
      glowAt(ctx, d.x, d.y + 2 - 110 * sc, col, 60 * sc, .38 * fl);
    },
    tiki(ctx, d, sc, flip, t, sd) { flame(ctx, d.x, d.y + 2 - 122 * sc, sc * .8, t, sd); }
  };
  function glowAt(ctx, x, y, col, r, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(a, 0, 1);
    const gl = G.glowSprite(col, 24); ctx.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  /* =====================================================================
     ORTAM PARÇACIKLARI (yeni temalar)
     ===================================================================== */
  Object.assign(AMB_N, { desert: 40, space: 34, city: 30, tropic: 30 });
  const AMB_NEW = {
    desert(p, i, rnd) { if (i % 3) { p.k = 8; p.vx = -90 - rnd() * 80; p.vy = 6 + rnd() * 8; p.s = .6 + rnd() * 1.2; } else { p.k = 2; p.vx = -10; p.vy = -3; p.s = .5 + rnd() * .5; } },
    space(p, i, rnd) { p.k = 9; p.c = i % 3; p.vx = -4 + rnd() * 8; p.vy = -6 - rnd() * 10; p.s = .5 + rnd() * .9; },
    city(p, i, rnd) { if (i % 2) { p.k = 10; p.vx = -30; p.vy = 380 + rnd() * 120; p.s = .7 + rnd() * .6; } else { p.k = 9; p.c = 3 + (i % 4 ? 0 : 1); p.vx = -6; p.vy = -4 - rnd() * 6; p.s = .5 + rnd() * .6; } },
    tropic(p, i, rnd) { if (i % 3 === 0) { p.k = 1; p.vx = -24 - rnd() * 20; p.vy = 12 + rnd() * 14; p.s = .8 + rnd() * .5; p.c = 0; p.vr = (rnd() - .5) * 4; } else { p.k = 2; p.vx = -5; p.vy = -4 - rnd() * 5; p.s = .7 + rnd() * .9; } }
  };
  const MOTE_COL = ['rgba(150,220,255,0.95)', 'rgba(210,150,255,0.95)', 'rgba(255,255,255,0.95)', 'rgba(255,110,190,0.9)', 'rgba(110,240,255,0.9)'];
  function ambDraw(ctx, p, x, y, far2, i) {
    switch (p.k) {
      case 8: {
        ctx.globalAlpha = .5 * far2; ctx.fillStyle = '#f6dca8';
        ctx.fillRect(x, y, 10 * p.s * p.z, 1.2 * p.z);
        ctx.globalAlpha = 1;
        break;
      }
      case 9: {
        const tw = .5 + .5 * Math.sin(p.ph * 2.2 + i);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (.25 + tw * .5) * far2;
        const gl = G.glowSprite(MOTE_COL[p.c], 8), r = 7 * p.s * p.z;
        ctx.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
        ctx.restore();
        break;
      }
      case 10: {
        ctx.globalAlpha = .28 * far2; ctx.strokeStyle = '#b8c4ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 1.6, y + 14 * p.s); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  /* =====================================================================
     YENİ SEVİYE ÖĞELERİ
     ===================================================================== */
  /** buildGeo sonrası: yeni öğelerin çevresinde dekor/ön tutam/çimen yok */
  function geoNew(L) {
    if (!L.lowg) return;
    for (const k of L.quicksand) { hazZones.push([k.x - 14, k.x + k.w + 14]); noBlade.push([k.x - 10, k.x + k.w + 10, k.y, 1]); }
    for (const k of L.ice) noBlade.push([k.x - 4, k.x + k.w + 4, k.y, 1]);
    for (const k of L.vents) { hazZones.push([k.x - 20, k.x + k.w + 20]); noBlade.push([k.x - 14, k.x + k.w + 14, k.y, 1]); }
    for (const k of L.tramp) { hazZones.push([k.x - 20, k.x + k.w + 20]); noBlade.push([k.x - 6, k.x + k.w + 6, k.y, 1]); }
    for (const k of L.boulders) hazZones.push([k.x1 - 30, k.x1 + 110]);
    for (const k of L.gates) hazZones.push([k.x - 80, k.x + 80]);
    for (const k of L.portals) { hazZones.push([k.bx - 40, k.bx + 40]); }
  }
  /* ---- buz plakası ---- */
  function drawIce(ctx, L, vx0, vx1) {
    for (const s of L.ice) {
      if (s.x > vx1 + 20 || s.x + s.w < vx0 - 20) continue;
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.beginPath(); rrp(ctx, -2, -4.5, s.w + 4, 10, 4.5);
      ctx.fillStyle = cg(ctx, 'ice:plate', g => LG(g, 0, -5, 0, 6, [[0, 'rgba(255,255,255,0.97)'], [.35, 'rgba(206,242,255,0.95)'], [1, 'rgba(120,196,240,0.92)']]));
      ctx.fill();
      ctx.lineJoin = 'round'; ctx.lineWidth = 2.8; ctx.strokeStyle = '#27579a'; ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = 10 + hash(s.x | 0) * 20; x < s.w - 6; x += 34 + hash((x | 0) + 9) * 30) { ctx.moveTo(x, 4); ctx.lineTo(x + 8, -3); ctx.moveTo(x + 6, 4); ctx.lineTo(x + 10, -1); }
      ctx.stroke();
      // kayan parlama
      const gx = ((tk * 90 + s.x) % (s.w + 80)) - 40;
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(gx, 6); ctx.lineTo(gx + 10, -5); ctx.lineTo(gx + 18, -5); ctx.lineTo(gx + 8, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(2, -3.2, s.w - 4, 1.2);
      ctx.restore();
      const sp = 70;
      for (let i = 0; i < s.w / sp; i++) {
        const h = hs(i, (s.x | 0) + 3), tw = Math.sin(tk * 2.6 + h * 30); if (tw < .6) continue;
        ctx.globalAlpha = (tw - .6) * 2.4; drawS(ctx, sparkleSpr(), s.x + i * sp + 12 + h * 40, s.y - 2, .45 + (tw - .6)); ctx.globalAlpha = 1;
      }
    }
  }
  /* ---- bataklık kum: çamur geometrisi + kum renkleri + dönen girdap ---- */
  function drawQuicksand(ctx, L, vx0, vx1) {
    if (!L.quicksand.length) return;
    mudList(ctx, L.quicksand, QSAND, 'qs', vx0, vx1);
    ctx.save(); ctx.lineCap = 'round';
    for (const m of L.quicksand) {
      if (m.x > vx1 + 30 || m.x + m.w < vx0 - 30) continue;
      const n = Math.max(1, Math.round(m.w / 110));
      for (let i = 0; i < n; i++) {
        const cx = m.x + (i + .5) * m.w / n, cy = m.y + 4;
        for (let k = 0; k < 3; k++) {
          const a = -tk * (1.1 + k * .3) + k * 2 + i, rx = 10 + k * 9;
          ctx.strokeStyle = k === 0 ? 'rgba(255,236,190,0.75)' : 'rgba(255,226,170,0.5)'; ctx.lineWidth = 2.2 - k * .4;
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, 2.4 + k * .8, 0, a, a + 2.4); ctx.stroke();
        }
        E(ctx, cx, cy, 5, 1.6, 'rgba(60,30,6,0.55)');
      }
    }
    ctx.restore();
  }
  /* ---- yuvarlanan kaya + tapınak kapısı ---- */
  function boulderDoorSpr() {
    return spr('bdoor', 172, 170, 50, 156, g => {
      const ol = OLD_;
      g.lineJoin = 'round';
      // arka cephe (uzak düzlem: hafif pus)
      const wall = new Path2D(); wall.moveTo(-44, 2); wall.lineTo(-44, -110); wall.lineTo(-30, -126); wall.lineTo(100, -126); wall.lineTo(114, -110); wall.lineTo(114, 2); wall.closePath();
      g.fillStyle = LG(g, 0, -126, 0, 2, [[0, '#d8ac72'], [1, '#a8743e']]); g.fill(wall);
      g.save(); g.clip(wall); g.strokeStyle = 'rgba(110,60,20,0.35)'; g.lineWidth = 1.4;
      for (let y = -110; y < 0; y += 18) { g.beginPath(); g.moveTo(-50, y); g.lineTo(120, y); g.stroke(); for (let x = -40 + ((y / 18) % 2) * 20; x < 120; x += 40) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 18); g.stroke(); } }
      g.restore();
      g.lineWidth = 2.4; g.strokeStyle = rgba(ol, .7); g.stroke(wall);
      // karanlık ağız
      const hole = new Path2D(); hole.moveTo(-8, 2); hole.lineTo(-8, -66); hole.quadraticCurveTo(30, -94, 68, -66); hole.lineTo(68, 2); hole.closePath();
      g.fillStyle = RG(g, 30, -30, 4, 30, -30, 70, [[0, '#120602'], [.7, '#2a1406'], [1, '#4a2a10']]); g.fill(hole);
      // sütunlar + lento
      for (const x of [-22, 70]) {
        const p = new Path2D(); rrp(p, x, -84, 16, 86, 3);
        g.fillStyle = LG(g, x, 0, x + 16, 0, [[0, '#b07a42'], [.5, '#f0c888'], [1, '#9a6434']]); g.fill(p);
        g.lineWidth = 2.6; g.strokeStyle = ol; g.stroke(p);
        g.fillStyle = '#3a9aa8'; g.fillRect(x, -70, 16, 4); g.fillStyle = '#c84a3a'; g.fillRect(x, -66, 16, 3);
      }
      const lin = new Path2D(); rrp(lin, -30, -100, 120, 18, 3);
      g.fillStyle = LG(g, 0, -100, 0, -82, [[0, '#f6d49a'], [1, '#b07a42']]); g.fill(lin); g.lineWidth = 2.6; g.strokeStyle = ol; g.stroke(lin);
      // kanatlı güneş kursu
      E(g, 30, -91, 6, 6, ol); E(g, 30, -91, 4.6, 4.6, '#ffd24a');
      g.fillStyle = '#3a9aa8'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(30 + s * 6, -93); g.quadraticCurveTo(30 + s * 22, -98, 30 + s * 34, -92); g.lineTo(30 + s * 6, -88); g.closePath(); g.fill(); }
    });
  }
  function boulderSpr() {
    return spr('boulder', 72, 72, 36, 36, g => {
      const p = new Path2D(); smoothClosed(p, [[-29, -6], [-22, -24], [-4, -31], [16, -26], [29, -10], [28, 12], [14, 27], [-8, 30], [-26, 18]]);
      g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = OLD_; g.stroke(p);
      g.fillStyle = RG(g, -10, -12, 2, 0, 0, 34, [[0, '#f0c888'], [.5, '#c48c50'], [1, '#7a4a20']]); g.fill(p);
      g.save(); g.clip(p);
      g.strokeStyle = 'rgba(90,50,18,0.6)'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); for (let a = 0; a < 9; a += .35) { const r = 2 + a * 2.1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (a) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
      g.strokeStyle = 'rgba(60,30,8,0.55)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(10, -24); g.lineTo(14, -12); g.lineTo(22, -8); g.moveTo(-20, 14); g.lineTo(-10, 18); g.stroke();
      E(g, -12, -16, 9, 5, 'rgba(255,240,200,0.45)', -.5);
      g.restore();
    });
  }
  function drawBoulderDoors(ctx, L, vx0, vx1) {
    if (!L.boulders.length) return;
    const ds = boulderDoorSpr();
    for (const b of L.boulders) {
      if (b.x1 - 60 > vx1 || b.x1 + 130 < vx0) continue;
      const sh = b.st === 1 ? Math.sin(tk * 70) * 2 * (.4 + b.k) : 0;
      drawS(ctx, ds, b.x1 + sh, b.y + 2);
      if (b.st === 1) {
        // içeride kırmızı parlayan gözler + toz
        glowAt(ctx, b.x1 + 22, b.y - 44, 'rgba(255,60,30,0.9)', 14, .4 + .5 * b.k);
        glowAt(ctx, b.x1 + 38, b.y - 44, 'rgba(255,60,30,0.9)', 14, .4 + .5 * b.k);
        for (let i = 0; i < 4; i++) {
          const q = (tk * 2.2 + i * .25) % 1, x = b.x1 - 6 + i * 22 + q * 6 * (i - 1.5), y = b.y - 3 - q * 18;
          E(ctx, x, y, 5 + q * 9, 3 + q * 6, rgba('#e8c48a', .55 * (1 - q)));
        }
        const d = (tk * 3) % 1; E(ctx, b.x1 + 30 + sh * 3, b.y - 100 + d * 90, 1.6, 2.4, rgba('#c8945a', .8 * (1 - d)));
      }
    }
  }
  function drawBoulders(ctx, L, vx0, vx1) {
    if (!L.boulders.length) return;
    const bs = boulderSpr();
    for (const b of L.boulders) {
      if (b.x0 - 80 > vx1 || b.x1 + 130 < vx0) continue;
      // yol izi (kayanın geçeceği oluk): yarışçıya önceden yolu gösterir
      ctx.fillStyle = 'rgba(70,35,8,0.18)'; ctx.fillRect(b.x0, b.y - 2.2, b.x1 - b.x0, 2.2);
      if (b.st === 0) continue;
      const r = b.r;
      // TEHLİKE İPUCU: uyarıda (st 1) ve yuvarlanırken kayanın önündeki yol kırmızıya döner, sola akan oklar "kaya geliyor" der
      {
        const wa = b.st === 1 ? .6 + .4 * b.k : Math.max(0, 1 - b.k * 1.1);   // uyarı 0.8 sn: hemen güçlü başlar
        if (wa > .02) {
          const xa = Math.max(b.x0, vx0 - 20), xb = Math.min(b.st === 2 ? b.bx - r : b.x1, vx1 + 20);
          if (xb > xa) {
            const pulse = .6 + .4 * Math.sin(tk * 8);
            ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.globalAlpha = wa * (.3 + .25 * pulse); ctx.fillStyle = '#ff2a2a'; ctx.fillRect(xa, b.y - 4, xb - xa, 4);
            const off = (tk * 110) % 56;
            ctx.beginPath();
            for (let x = b.x1 - off; x > xa - 10; x -= 56) { if (x > xb + 10) continue; ctx.moveTo(x + 7, b.y - 18); ctx.lineTo(x, b.y - 11); ctx.lineTo(x + 7, b.y - 4); }
            ctx.globalAlpha = wa * .75; ctx.strokeStyle = '#3a0a00'; ctx.lineWidth = 6.6; ctx.stroke();
            ctx.globalAlpha = wa * (.75 + .25 * pulse); ctx.strokeStyle = '#ff9a3a'; ctx.lineWidth = 3.4; ctx.stroke();
            ctx.restore();
          }
        }
      }
      if (b.st === 1) {
        ctx.save(); ctx.beginPath(); ctx.rect(b.x1 - 9, b.y - 70, 78, 72); ctx.clip();
        ctx.translate(b.bx, b.by); ctx.rotate(-(b.rot || 0)); ctx.drawImage(bs.c, -36 * r / 30, -36 * r / 30, 72 * r / 30, 72 * r / 30);
        ctx.restore();
        ctx.save(); ctx.globalAlpha = .55 * (1 - b.k); ctx.fillStyle = '#120602'; ctx.beginPath(); ctx.arc(b.bx, b.by, r + 1, 0, TAU); ctx.fill(); ctx.restore();
        continue;
      }
      const end = b.k > .9 ? (b.k - .9) / .1 : 0;
      E(ctx, b.bx, b.y + 1, r * .95 * (1 - end * .5), 5, 'rgba(0,0,0,0.3)');
      // arkasında toz (sağda: kaya sola yuvarlanır)
      for (let i = 0; i < 4; i++) {
        const q = (tk * 3 + i * .25) % 1;
        E(ctx, b.bx + r * (.6 + i * .45) + q * 12, b.y - 4 - q * 10 - i * 2, 5 + q * 10, 3 + q * 6, rgba('#e8c48a', (.5 - i * .1) * (1 - q)));
      }
      ctx.save(); ctx.globalAlpha = 1 - end;
      ctx.translate(b.bx, b.by); ctx.rotate(-(b.rot || 0)); const s = r / 30 * (1 + end * .15);
      ctx.drawImage(bs.c, -36 * s, -36 * s, 72 * s, 72 * s);
      ctx.restore();
      if (end > 0) {
        for (let i = 0; i < 6; i++) {
          const a = -PI * .1 - i * PI / 6.5, d = end * (22 + i * 4);
          const x = b.bx + Math.cos(a) * d, y = b.by + Math.sin(a) * d + end * end * 30;
          ctx.fillStyle = rgba(i % 2 ? '#c48c50' : '#8a5a2a', 1 - end); ctx.beginPath(); ctx.arc(x, y, 5 - i * .4, 0, TAU); ctx.fill();
        }
      }
    }
  }
  /* ---- rüzgâr bacası (şehir) ve gayzer (tropik) ---- */
  function grateSpr(w) {
    w = Math.round(w);
    return spr('grate' + w, w + 20, 26, w / 2 + 10, 14, g => {
      const b = new Path2D(); rrp(b, -w / 2 - 6, -10, w + 12, 14, 3);
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = OLN;
      g.fillStyle = LG(g, 0, -10, 0, 4, [[0, '#8a8aa4'], [1, '#3a3a52']]); g.fill(b); g.stroke(b);
      g.fillStyle = '#0a0812'; g.beginPath(); rrp(g, -w / 2, -7, w, 8, 2); g.fill();
      g.fillStyle = '#6a6a84'; for (let x = -w / 2 + 4; x < w / 2 - 2; x += 7) g.fillRect(x, -7, 2.4, 8);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-w / 2 - 4, -9, w + 8, 1.4);
    });
  }
  function geyserSpr() {
    return spr('geyser', 130, 44, 65, 32, g => {
      const p = new Path2D(); p.moveTo(-58, 4); p.quadraticCurveTo(-50, -10, -30, -14); p.quadraticCurveTo(-14, -22, 0, -18); p.quadraticCurveTo(16, -22, 30, -14); p.quadraticCurveTo(50, -10, 58, 4); p.closePath();
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#1e2a2a';
      g.fillStyle = LG(g, 0, -22, 0, 4, [[0, '#8a9a96'], [.5, '#5a6a68'], [1, '#3a4644']]); g.fill(p); g.stroke(p);
      g.save(); g.clip(p);
      for (const s of [[-36, -6, 9], [34, -5, 8], [-16, -14, 6], [18, -13, 6]]) { E(g, s[0], s[1], s[2], s[2] * .6, 'rgba(200,220,215,0.35)'); }
      E(g, -40, 0, 8, 3, 'rgba(80,140,60,0.7)'); E(g, 44, 1, 7, 3, 'rgba(80,140,60,0.7)');
      g.restore();
      E(g, 0, -15, 16, 5, '#0a1a22'); E(g, 0, -16, 12, 3, '#1a4a5a');
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.4; g.beginPath(); g.ellipse(0, -15, 16, 5, 0, PI * 1.1, PI * 1.9); g.stroke();
    });
  }
  function drawVents(ctx, L, vx0, vx1) {
    for (const v of L.vents) {
      if (v.x > vx1 + 40 || v.x + v.w < vx0 - 40) continue;
      const cx = v.x + v.w / 2;
      if (v.kind === 'lift') {
        // yükselen hava sütunu
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.save(); ctx.translate(v.x, v.y - v.h); ctx.scale(v.w, v.h);
        ctx.fillStyle = cg(ctx, 'vent:col', g => LG(g, 0, 1, 0, 0, [[0, 'rgba(160,230,255,0.28)'], [.5, 'rgba(160,230,255,0.1)'], [1, 'rgba(160,230,255,0)']]));
        ctx.fillRect(0, 0, 1, 1); ctx.restore();
        ctx.strokeStyle = 'rgba(220,245,255,0.8)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const n = Math.max(3, Math.round(v.w / 16));
        for (let i = 0; i < n; i++) {
          const h1 = hs(i, (v.x | 0) + 5), sp = 320 + h1 * 160;
          for (let k = 0; k < 2; k++) {
            const q = ((tk * sp / v.h) + h1 + k * .5) % 1, yy = v.y - 8 - q * v.h, x = v.x + (i + .5) * v.w / n + Math.sin(tk * 4 + i + q * 6) * 4;
            ctx.globalAlpha = Math.sin(q * PI) * .7; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy - 18 - h1 * 14); ctx.stroke();
          }
        }
        ctx.restore();
        // uçuşan kâğıtlar
        for (let k = 0; k < 2; k++) {
          const q = ((tk * .55) + k * .5 + hash(v.x | 0)) % 1, x = cx + Math.sin(tk * 3 + k * 2) * v.w * .3, yy = v.y - 10 - q * v.h;
          ctx.save(); ctx.globalAlpha = Math.sin(q * PI); ctx.translate(x, yy); ctx.rotate(tk * 5 + k); ctx.fillStyle = k ? '#f4f0e0' : '#ffd0e0'; ctx.fillRect(-4, -3, 8, 6); ctx.restore();
        }
        drawS(ctx, grateSpr(v.w), cx, v.y + 1);
        // yukarı ok işaretleri (okunabilirlik)
        const a = .5 + .4 * Math.sin(tk * 5 + v.x);
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let k = 0; k < 2; k++) { const yy = v.y - 34 - k * 14 - ((tk * 30) % 14); ctx.beginPath(); ctx.moveTo(cx - 9, yy + 7); ctx.lineTo(cx, yy); ctx.lineTo(cx + 9, yy + 7); ctx.stroke(); }
        ctx.restore();
      } else {
        // gayzer
        let u = (S.lt + v.ph) % v.per; if (u < 0) u += v.per;
        const shake = !v.act && v.k > 0 ? Math.sin(tk * 60) * 1.4 * v.k : 0;
        if (v.act) {
          const rise = clamp(u / .16, 0, 1), fall = clamp((v.on - u) / .25, 0, 1), hh = v.h * rise * (.35 + .65 * fall);
          const cw = v.w * .62 * (.7 + .3 * fall), top = v.y - 14 - hh;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(cx - cw * .45, v.y - 12);
          for (let yy = v.y - 12; yy > top; yy -= 14) ctx.lineTo(cx - cw / 2 + Math.sin(yy * .06 + tk * 14) * 3, yy);
          ctx.lineTo(cx, top - 8);
          for (let yy = top; yy < v.y - 12; yy += 14) ctx.lineTo(cx + cw / 2 + Math.sin(yy * .07 - tk * 13) * 3, yy);
          ctx.lineTo(cx + cw * .45, v.y - 12); ctx.closePath();
          ctx.save(); ctx.translate(0, top); ctx.scale(1, Math.max(1, hh) / 100);
          ctx.fillStyle = cg(ctx, 'geyser:col', g => LG(g, 0, 0, 0, 100, [[0, 'rgba(230,250,255,0.75)'], [.5, 'rgba(190,240,255,0.85)'], [1, 'rgba(240,252,255,0.95)']]));
          ctx.fill(); ctx.restore();
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(60,150,200,0.6)'; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(cx - cw * .18, top + 6, 3, hh - 10);
          // tepe köpüğü + damlalar
          for (let k = 0; k < 7; k++) {
            const a = k / 6 * PI, r = cw * .5 + Math.sin(tk * 10 + k) * 4;
            E(ctx, cx + Math.cos(a + PI) * r * .9, top + Math.sin(a + PI) * 8, 8, 7, 'rgba(250,254,255,0.92)');
          }
          for (let k = 0; k < 8; k++) {
            const q = (tk * 1.6 + k * .125) % 1, dir = k % 2 ? 1 : -1;
            const x = cx + dir * (cw * .4 + q * 40 + k * 3), y = top + q * 60 * (q + .2) - 10 + q * q * 90;
            ctx.fillStyle = rgba('#e8fbff', 1 - q); ctx.beginPath(); ctx.arc(x, y, 2.4 * (1 - q) + .8, 0, TAU); ctx.fill();
          }
          ctx.restore();
        } else if (v.k > 0) {
          // fışkırma öncesi: kabarcıklar + buhar (uyarı)
          for (let k = 0; k < 5; k++) {
            const q = (tk * 2.4 + k * .2) % 1, x = cx + (hash(k * 7 + (v.x | 0)) - .5) * 20, y = v.y - 16 - q * 30 * v.k;
            E(ctx, x, y, (5 + q * 10) * v.k, (4 + q * 8) * v.k, rgba('#ffffff', .55 * (1 - q) * v.k));
          }
        } else {
          const q = (tk * .8 + hash(v.x | 0)) % 1;
          E(ctx, cx + Math.sin(tk) * 4, v.y - 18 - q * 22, 5 + q * 8, 4 + q * 6, rgba('#ffffff', .3 * (1 - q)));
        }
        drawS(ctx, geyserSpr(), cx + shake, v.y + 2);
        if (!v.act && v.k > 0) {
          for (let k = 0; k < 3; k++) {
            const q = (tk * 6 + k * .33) % 1;
            ctx.fillStyle = rgba('#d8f6ff', .9 * (1 - q)); ctx.beginPath(); ctx.arc(cx - 6 + k * 6, v.y - 16 - q * 8, 2.4, 0, TAU); ctx.fill();
          }
          // İPUCU (ağzın ÜSTÜNE): genişleyen turkuaz halkalar + nabız atan yukarı ok ("fışkıracak, fırlatır")
          ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (let k = 0; k < 2; k++) {
            const q = (tk * 1.8 + k * .5) % 1;
            ctx.globalAlpha = (1 - q) * .9 * v.k; ctx.lineWidth = 3 - q * 1.2; ctx.strokeStyle = '#8af4ff';
            ctx.beginPath(); ctx.ellipse(cx, v.y - 13, 12 + q * 40, 4 + q * 10, 0, 0, TAU); ctx.stroke();
          }
          const ay = v.y - 46 - Math.sin(tk * 7) * 3;
          ctx.beginPath(); ctx.moveTo(cx - 10, ay + 8); ctx.lineTo(cx, ay); ctx.lineTo(cx + 10, ay + 8);
          ctx.globalAlpha = v.k * .7; ctx.strokeStyle = '#0a2a3a'; ctx.lineWidth = 7; ctx.stroke();
          ctx.globalAlpha = v.k * (.65 + .35 * Math.sin(tk * 7)); ctx.strokeStyle = '#e0fcff'; ctx.lineWidth = 3.6; ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
  /* ---- ışınlanma kapıları (uzay) ---- */
  function portalRing(ctx, x, y, r, h, c1, c2, spin, key) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55 + .15 * Math.sin(tk * 4 + x);
    ctx.drawImage(G.glowSprite(c1, 24).c, x - r * 2.4, y - h * 1.7, r * 4.8, h * 3.4);
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(r / 30, h / 30);
    ctx.fillStyle = cg(ctx, 'portal:in:' + key, g => RG(g, 0, 0, 0, 0, 0, 28, [[0, 'rgba(255,255,255,0.95)'], [.25, rgba(c2, .9)], [.7, rgba(shade(c2, -.45), .9)], [1, rgba(shade(c2, -.7), .95)]]));
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba('#ffffff', .5); ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const a = spin * tk + k * TAU / 3; ctx.beginPath(); ctx.arc(0, 0, 18, a, a + 1.4); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 9, -a * 1.3, -a * 1.3 + 1.6); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = shade(c2, -.6); ctx.beginPath(); ctx.arc(0, 0, 29, 0, TAU); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = c2; ctx.stroke();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(0, 0, 29, -2.4 + tk * spin * .5, -1.2 + tk * spin * .5); ctx.stroke();
    for (let k = 0; k < 6; k++) { const a = tk * spin * 1.4 + k * TAU / 6; E(ctx, Math.cos(a) * 29, Math.sin(a) * 29, 2.2, 2.2, '#ffffff'); }
    ctx.restore();
  }
  function drawPortals(ctx, L, vx0, vx1) {
    for (const p of L.portals) {
      const by = p.by - 40;
      if (Math.max(p.ax, p.bx) + 60 < vx0 || Math.min(p.ax, p.bx) - 60 > vx1) continue;
      // bağlantı yayı (noktalı, akan)
      const mx = (p.ax + p.bx) / 2, my = Math.min(p.ay, by) - 130;
      ctx.save();
      for (let i = 1; i < 30; i++) {
        const t = (i + (tk * 2.2) % 1) / 30, u = 1 - t;
        const x = u * u * p.ax + 2 * u * t * mx + t * t * p.bx, y = u * u * p.ay + 2 * u * t * my + t * t * by;
        if (x < vx0 - 10 || x > vx1 + 10) continue;
        ctx.globalAlpha = .35 + .3 * Math.sin(t * PI); ctx.fillStyle = t < .5 ? '#d08aff' : '#6af6e6';
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU); ctx.fill();
      }
      ctx.restore();
      portalRing(ctx, p.ax, p.ay, p.r || 22, p.h || 38, 'rgba(190,90,255,0.9)', '#b05aff', 2.2, 'a');
      // B: zeminde kaide + turkuaz çıkış
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(p.bx, p.by + 1, 30, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a4462'; ctx.beginPath(); rrp(ctx, p.bx - 26, p.by - 6, 52, 8, 3); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#070814'; ctx.stroke();
      ctx.fillStyle = '#5ff0e6'; ctx.fillRect(p.bx - 20, p.by - 4, 40, 2);
      portalRing(ctx, p.bx, by, p.r || 22, p.h || 38, 'rgba(70,240,220,0.9)', '#3ee8d8', -2, 'b');
      // A'nın üstünde zıpla işareti
      const a = .55 + .35 * Math.sin(tk * 5);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#f2d8ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const yy = p.ay - (p.h || 38) - 16 - Math.sin(tk * 5) * 3;
      ctx.beginPath(); ctx.moveTo(p.ax - 8, yy + 6); ctx.lineTo(p.ax, yy); ctx.lineTo(p.ax + 8, yy + 6); ctx.stroke();
      ctx.restore();
    }
  }
  /* ---- düşük yerçekimi bölgesi ---- */
  function drawLowG(ctx, L, vx0, vx1, vy0, vy1) {
    for (const z of L.lowg) {
      if (z.x > vx1 || z.x + z.w < vx0) continue;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.save(); ctx.translate(z.x, vy0); ctx.scale(z.w, vy1 - vy0);
      ctx.fillStyle = cg(ctx, 'lowg:col', g => LG(g, 0, 0, 1, 0, [[0, 'rgba(170,110,255,0)'], [.05, 'rgba(170,110,255,0.2)'], [.18, 'rgba(140,100,255,0.07)'], [.82, 'rgba(140,100,255,0.07)'], [.95, 'rgba(170,110,255,0.2)'], [1, 'rgba(170,110,255,0)']]));
      ctx.fillRect(0, 0, 1, 1); ctx.restore();
      const n = Math.round(z.w / 34), H = vy1 - vy0 + 60;
      const gl = G.glowSprite('rgba(200,160,255,0.95)', 8);
      for (let i = 0; i < n; i++) {
        const h1 = hs(i, (z.x | 0) + 11), h2 = hs(i, (z.x | 0) + 12);
        const y = vy1 + 20 - ((tk * (26 + h1 * 30) + h2 * 900) % H), x = z.x + h1 * z.w + Math.sin(tk * 1.3 + i) * 8;
        ctx.globalAlpha = .45 + .4 * Math.sin(tk * 3 + i);
        const r = 3 + h2 * 4; ctx.drawImage(gl.c, x - r, y - r, r * 2, r * 2);
        if (h2 > .7) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - .8, y - .8, 1.6, 1.6); }
      }
      ctx.restore();
      // kenar çizgileri (bölge sınırı)
      ctx.save(); ctx.strokeStyle = 'rgba(200,160,255,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([10, 12]); ctx.lineDashOffset = -tk * 30;
      ctx.beginPath(); ctx.moveTo(z.x, vy0); ctx.lineTo(z.x, vy1); ctx.moveTo(z.x + z.w, vy0); ctx.lineTo(z.x + z.w, vy1); ctx.stroke();
      ctx.restore();
    }
  }
  /* ---- trambolin (şehir çatısı) ---- */
  function drawTramp(ctx, L, vx0, vx1) {
    for (const t of L.tramp) {
      if (t.x > vx1 + 40 || t.x + t.w < vx0 - 40) continue;
      const f = t.sq > 0 ? clamp(t.sq / .35, 0, 1) : 0, b = Math.cos((1 - f) * PI * 3) * f;
      const x0 = t.x, x1 = t.x + t.w, top = t.y - 22, dip = 9 * b, cx = (x0 + x1) / 2;
      E(ctx, cx, t.y + 1, t.w / 2 + 6, 4, 'rgba(0,0,0,0.3)');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // bacaklar
      for (const lx of [x0 + 6, x1 - 6]) { ctx.strokeStyle = OLN; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(lx, top + 2); ctx.lineTo(lx + (lx < cx ? -5 : 5), t.y); ctx.stroke(); ctx.strokeStyle = '#8a8aa4'; ctx.lineWidth = 3; ctx.stroke(); }
      // yaylar
      ctx.strokeStyle = '#c8c8dc'; ctx.lineWidth = 1.4;
      for (let x = x0 + 8; x < x1 - 6; x += 8) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + 2, top + 3 + dip * Math.sin((x - x0) / t.w * PI) * .9); ctx.stroke(); }
      // mat
      ctx.beginPath(); ctx.moveTo(x0 + 4, top + 2); ctx.quadraticCurveTo(cx, top + 2 + dip * 2, x1 - 4, top + 2);
      ctx.lineWidth = 5; ctx.strokeStyle = '#141420'; ctx.stroke(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(160,170,255,0.5)'; ctx.stroke();
      // kenar pedi (turkuaz-sarı: dost nesne dili, kırmızı yok)
      for (let i = 0; i < 2; i++) {
        const px = i ? x1 - 10 : x0 - 2;
        ctx.fillStyle = OLN; ctx.beginPath(); rrp(ctx, px - 2, top - 5, 16, 10, 3.5); ctx.fill();
        ctx.fillStyle = i ? '#ffd23f' : '#3fe0ff'; ctx.beginPath(); rrp(ctx, px, top - 3, 12, 6, 2.5); ctx.fill();
      }
      ctx.fillStyle = OLN; ctx.fillRect(x0 + 10, top - 3, t.w - 20, 6);
      ctx.fillStyle = '#4a86ff'; ctx.fillRect(x0 + 10, top - 1.5, t.w - 20, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x0 + 12, top - 1.5, t.w - 24, 1);
      // yukarı ok
      const a = .45 + .4 * Math.sin(tk * 6 + t.x);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 3.4;
      for (let k = 0; k < 2; k++) { const yy = top - 16 - k * 11 - Math.sin(tk * 6) * 2; ctx.beginPath(); ctx.moveTo(cx - 9, yy + 7); ctx.lineTo(cx, yy); ctx.lineTo(cx + 9, yy + 7); ctx.stroke(); }
      ctx.restore();
    }
  }
  /* ---- sallanan halat köprü (tropik) ---- */
  function drawBridges(ctx, L, vx0, vx1) {
    for (const br of L.bridges) {
      if (br.x - 30 > vx1 || br.x + br.w + 30 < vx0) continue;
      const x0 = br.x - 10, x1 = br.x + br.w + 10, w = x1 - x0, y = br.y;
      const sway = Math.sin(tk * 1.6 + br.x * .01) * 1.2;
      const sag = t => Math.sin(t * PI) * (3 + sway);
      // korkuluk halatları + dikey bağlar
      ctx.lineCap = 'round';
      const rail = t => y - 40 + Math.sin(t * PI) * (12 + sway * 2);
      ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let x = x0 + 16; x < x1 - 8; x += 26) { const t = (x - x0) / w; ctx.moveTo(x, rail(t)); ctx.lineTo(x, y + sag(t)); }
      ctx.stroke();
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? '#c8a06a' : '#3a2410'; ctx.lineWidth = pass ? 2 : 4.4;
        ctx.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16; const xx = x0 + t * w; if (i) ctx.lineTo(xx, rail(t)); else ctx.moveTo(xx, rail(t)); } ctx.stroke();
        ctx.beginPath(); for (let i = 0; i <= 16; i++) { const t = i / 16; const xx = x0 + t * w; if (i) ctx.lineTo(xx, y + 9 + sag(t)); else ctx.moveTo(xx, y + 9 + sag(t)); } ctx.stroke();
      }
      // tahtalar
      for (let x = x0 + 2; x < x1 - 4; x += 15) {
        const t = (x + 6 - x0) / w, yy = y - 2 + sag(t), h1 = hash((x | 0) * 3);
        ctx.save(); ctx.translate(x + 6.5, yy + 4); ctx.rotate((h1 - .5) * .06 + Math.cos(t * PI) * .04);
        ctx.fillStyle = '#2a1606'; ctx.beginPath(); rrp(ctx, -7.5, -5, 15, 10, 2); ctx.fill();
        ctx.fillStyle = h1 < .5 ? '#b0804a' : '#9a6a3a'; ctx.beginPath(); rrp(ctx, -6, -3.6, 12, 7, 1.5); ctx.fill();
        ctx.fillStyle = 'rgba(255,230,180,0.45)'; ctx.fillRect(-5, -3, 10, 1.4);
        ctx.restore();
      }
      // direkler
      for (const px of [x0 - 4, x1 + 4]) {
        ctx.fillStyle = '#2a1606'; ctx.beginPath(); rrp(ctx, px - 5.5, y - 48, 11, 70, 3); ctx.fill();
        ctx.fillStyle = LG(ctx, px - 4, 0, px + 4, 0, [[0, '#7a5028'], [.5, '#b0804a'], [1, '#6a4420']]); ctx.beginPath(); rrp(ctx, px - 4, y - 46.5, 8, 67, 2.5); ctx.fill();
        ctx.strokeStyle = '#d8b07a'; ctx.lineWidth = 1.4; for (const yy of [y - 40, y - 36, y + 6, y + 10]) { ctx.beginPath(); ctx.moveTo(px - 5, yy); ctx.lineTo(px + 5, yy + 2); ctx.stroke(); }
      }
    }
  }
  /* ---- eleme kapısı ---- */
  function gateNumSpr(n, st) {
    return spr('gateN' + n + st, 56, 56, 28, 28, g => {
      const col = st === 2 ? '#e8283c' : st === 1 ? '#2ee86a' : '#8a8aa0', ol = st === 2 ? '#4a0610' : st === 1 ? '#063a1a' : '#2a2a38';
      E(g, 0, 1.5, 22, 22, 'rgba(0,0,0,0.35)');
      E(g, 0, 0, 22, 22, ol); E(g, 0, 0, 19, 19, col);
      E(g, -5, -8, 9, 5, 'rgba(255,255,255,0.35)');
      G.text(g, String(n), 0, 2, 26, '#ffffff', { stroke: ol, lw: 5, shadowCol: 'rgba(0,0,0,0.3)' });
    });
  }
  function drawGates(ctx, L, vx0, vx1) {
    for (const gt of L.gates) {
      if (gt.x - 90 > vx1 || gt.x + 90 < vx0) continue;
      const st = gt.done ? 2 : gt.off ? 0 : 1, x = gt.x, y = gt.y;
      const col = st === 2 ? '#e8283c' : st === 1 ? '#2ee86a' : '#8a8aa0';
      ctx.save();
      if (st === 0) ctx.globalAlpha = .55;
      const H = 150, half = 62;
      // kemer
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x - half, y - H + 30); ctx.quadraticCurveTo(x, y - H - 34, x + half, y - H + 30);
      ctx.lineWidth = 16; ctx.strokeStyle = '#141020'; ctx.stroke();
      ctx.lineWidth = 11; ctx.strokeStyle = '#4a4660'; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
      // sütunlar
      for (const s of [-1, 1]) {
        const px = x + s * half;
        ctx.fillStyle = '#141020'; ctx.beginPath(); rrp(ctx, px - 11, y - H + 20, 22, H - 18, 5); ctx.fill();
        ctx.fillStyle = cg(ctx, 'gate:pil', g => LG(g, -9, 0, 9, 0, [[0, '#3a3650'], [.45, '#8a86a4'], [1, '#2a2638']]));
        ctx.save(); ctx.translate(px, 0); ctx.beginPath(); rrp(ctx, -9, y - H + 22, 18, H - 22, 4); ctx.fill(); ctx.restore();
        // ışık dizisi (sırayla yanar)
        for (let k = 0; k < 5; k++) {
          const ly2 = y - 22 - k * 22, on = st === 1 ? ((tk * 6 - k) % 5 + 5) % 5 < 1.2 : st === 2;
          E(ctx, px, ly2, 4.4, 4.4, '#0a0812'); E(ctx, px, ly2, 3.2, 3.2, on ? col : shade(col, -.55));
          if (on) glowAt(ctx, px, ly2, st === 2 ? 'rgba(255,40,60,0.9)' : 'rgba(60,255,120,0.9)', 12, .7);
        }
        ctx.fillStyle = '#141020'; ctx.beginPath(); rrp(ctx, px - 14, y - 6, 28, 8, 2); ctx.fill();
      }
      // kapandıysa parmaklık
      if (st === 2) {
        ctx.strokeStyle = 'rgba(30,10,16,0.85)'; ctx.lineWidth = 4;
        ctx.beginPath(); for (let bx = x - half + 18; bx < x + half - 8; bx += 16) { ctx.moveTo(bx, y - H + 14); ctx.lineTo(bx, y - 2); } ctx.stroke();
        ctx.strokeStyle = 'rgba(232,40,60,0.6)'; ctx.lineWidth = 1.4; ctx.stroke();
      } else if (st === 1) {
        // geçiş çizgisi (zeminde parlak)
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .3 * Math.sin(tk * 6);
        ctx.fillStyle = 'rgba(80,255,140,0.5)'; ctx.fillRect(x - 4, y - H + 30, 8, H - 30);
        ctx.restore();
      }
      drawS(ctx, gateNumSpr(gt.n + 1, st), x, y - H - 6);
      ctx.restore();
    }
  }
  /* ---- meteor uyarı gölgesi (Kaos): yerde büyüyen kırmızı halka — YEDEK (render-fx R.meteorFx yoksa) ---- */
  function drawMeteorWarn(ctx, vx0, vx1) {
    if (R.meteorFx) return;   // render-fx meteoru (yer uyarısı dahil) çiziyorsa çift halka olmasın; bu yalnızca yedek
    const E2 = S.ents; if (!E2 || !E2.length) return;
    for (const e of E2) {
      if (e.type !== 'meteor' || !(e.t > 0) || e.x < vx0 - 80 || e.x > vx1 + 80) continue;
      const q = clamp(1 - e.t / (e.max || 1), 0, 1), R0 = e.r || 62, rr = R0 * (.3 + .7 * q), x = e.x, y = e.y;
      const pulse = .5 + .5 * Math.sin(tk * (10 + q * 16));
      ctx.save();
      ctx.fillStyle = rgba('#ff2a1a', .1 + .2 * q); ctx.beginPath(); ctx.ellipse(x, y - 1, rr, rr * .26, 0, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = rgba('#ff3a2a', .55 + .4 * pulse); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,90,70,0.45)'; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -tk * 20;
      ctx.beginPath(); ctx.ellipse(x, y - 1, R0, R0 * .26, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = rgba('#ffe0d0', .7 + .3 * pulse); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      const k = 9 + 5 * q; ctx.beginPath(); ctx.moveTo(x - k, y - 1 - k * .26); ctx.lineTo(x + k, y - 1 + k * .26); ctx.moveTo(x + k, y - 1 - k * .26); ctx.lineTo(x - k, y - 1 + k * .26); ctx.stroke();
      ctx.restore();
      glowAt(ctx, x, y - 4, 'rgba(255,60,30,0.9)', 26 + 30 * q, .25 + .35 * q * pulse);
    }
  }
  /* ==== YENİ TEMALAR SON ==== */

  /* =====================================================================
     API
     ===================================================================== */
  let errN = 0;
  function safe(fn, a, b, c, d, e, f, h) {
    try { fn(a, b, c, d, e, f, h); }
    catch (err) { if (errN++ < 12) console.error('[render-world]', err); }
  }
  R.drawWorldBack = function (ctx) {
    const L = S.L; if (!L) return;
    const P = pal();
    prepTheme(P.id);
    if (geoL !== L) buildGeo(L);
    const VW = V.VW, VH = V.VH;
    const vx0 = S.cam.x - 30, vx1 = S.cam.x + VW + 30, vy0 = S.cam.y - 30, vy1 = S.cam.y + VH + 30;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    safe(drawAbyss, ctx, L, P, vx0, vx1, vy0, vy1);
    // sıvı zeminin ARKASINDA: yalnızca çukurlarda görünür (bloklar suya batmış gibi durmasın)
    safe(drawLiquid, ctx, L, vx0, vx1, vy1);
    const nw = !!L.lowg;   // yeni öğe dizileri (eski kayıtlı/harici seviye nesnelerinde olmayabilir)
    if (nw && L.lowg.length) safe(drawLowG, ctx, L, vx0, vx1, vy0, vy1);
    safe(drawDecor, ctx, L, 'back', vx0, vx1);
    if (nw) { safe(drawBoulderDoors, ctx, L, vx0, vx1); safe(drawGates, ctx, L, vx0, vx1); }
    safe(drawStart, ctx, L, vx0, vx1);
    safe(drawFinish, ctx, L, vx0, vx1);
    safe(drawGround, ctx, P, vx0, vx1, vy0, vy1);
    safe(drawFloats, ctx, P, vx0, vx1, vy0, vy1);
    if (nw) { safe(drawBridges, ctx, L, vx0, vx1); safe(drawIce, ctx, L, vx0, vx1); }
    safe(drawStartLine, ctx, L, vx0, vx1);
    safe(drawFinishLine, ctx, L, vx0, vx1);
    safe(drawMud, ctx, L, vx0, vx1);
    if (nw) safe(drawQuicksand, ctx, L, vx0, vx1);
    safe(drawBelts, ctx, L, vx0, vx1);
    safe(drawPads, ctx, L, vx0, vx1);
    safe(drawMush, ctx, L, vx0, vx1);
    if (nw) { safe(drawTramp, ctx, L, vx0, vx1); safe(drawVents, ctx, L, vx0, vx1); }
    safe(drawSpikes, ctx, L, vx0, vx1);
    safe(drawCrush, ctx, L, vx0, vx1, vy0);
    safe(drawSaws, ctx, L, vx0, vx1);
    if (nw) { safe(drawBoulders, ctx, L, vx0, vx1); safe(drawPortals, ctx, L, vx0, vx1); }
    safe(drawDecor, ctx, L, 'front', vx0, vx1);
    safe(drawBoxes, ctx, L, vx0, vx1);
    safe(drawCoins, ctx, L, vx0, vx1, vy0, vy1);
    safe(drawMeteorWarn, ctx, vx0, vx1);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  R.drawWorldFront = function (ctx) {
    const L = S.L; if (!L) return;
    const P = pal();
    prepTheme(P.id);
    if (geoL !== L) buildGeo(L);
    const vx0 = S.cam.x - 30, vx1 = S.cam.x + V.VW + 30;
    ctx.save();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    safe(drawFgTufts, ctx, P, vx0, vx1);
    safe(drawAmbient, ctx);
    ctx.restore();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };
  /** Diğer modüller için küçük yardımcılar (isteğe bağlı kullanım) */
  R.worldPalette = function () { return pal(); };
  R.drawClanFlag = function (ctx, x, y, sc, t) { wavingFlag(ctx, clanFlagSpr(), x, y, sc || 1, t == null ? tk : t, 5); };

  // geliştirici modu kancası (yalnızca ?dev=1): dekor galerisi / test için
  if (FM.DEV) R._worldDev = { DEC, decorSpr, decorAnim, flame, wavingFlag, clanFlagSpr };

  R.updaters.push(function (dt) {
    tk += dt;
    if (!S.L) return;
    prepTheme(pal().id);
    ambUpdate(dt);
  });
})(window.FM);

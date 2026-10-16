/* FUAT MOREL — gfx.js : tüm renderer dosyalarının ortak kullandığı çizim yardımcıları. */
'use strict';
(function (FM) {
  FM.FONT_H = '"Lilita One", "Arial Black", Impact, sans-serif';   // başlık / sayılar
  FM.FONT_B = '"Fredoka", "Trebuchet MS", Arial, sans-serif';       // gövde metni
  FM.R = FM.R || {};            // renderer fonksiyonları buraya eklenir
  FM.R.updaters = FM.R.updaters || [];   // her karede çağrılan (dt) => void animasyon güncelleyicileri

  const gfx = FM.gfx = {};
  const cache = new Map();
  /** Önbellekli sprite. w,h mantıksal boyut; ox,oy orijin (çizimin bağlantı noktası); fn(g) mantıksal koordinatta çizer.
      Ekran ölçeği (FM.view.S) değişince önbellek otomatik yenilenir. key benzersiz olmalı. */
  gfx.sprite = function (key, w, h, ox, oy, fn) {
    const k = gfx.rs();
    let s = cache.get(key);
    if (!s || s.k !== k) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
      const g = c.getContext('2d');
      g.scale(k, k); g.translate(ox, oy);
      try { fn(g); } catch (e) { console.error('[sprite ' + key + ']', e); }
      s = { c, w, h, ox, oy, k };
      cache.set(key, s);
    }
    return s;
  };
  /** Sprite'ı (x,y) bağlantı noktasına çizer. sc ölçek, flip yatay ayna. */
  gfx.draw = function (ctx, s, x, y, sc = 1, flip = false) {
    if (!flip) { ctx.drawImage(s.c, x - s.ox * sc, y - s.oy * sc, s.w * sc, s.h * sc); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
    ctx.drawImage(s.c, -s.ox * sc, -s.oy * sc, s.w * sc, s.h * sc); ctx.restore();
  };
  /** Sprite çözünürlük ölçeği: ekran ölçeği (en fazla 3, 0.25 adımlarla).
      Histerezis: ekran ölçeği biraz küçülünce (ör. iPhone Safari araç çubuğu açılıp kapanınca) mevcut çözünürlük korunur —
      biraz büyük sprite'ı küçülterek çizmek keskin kalır ve tüm sprite'ların yeniden çizilmesinden (takılma) kaçınılır.
      Ölçek büyüyünce ya da %20'den fazla küçülünce (kalite 'düşük', uyarlanır çözünürlük) yenilenir. */
  let rsCur = 0;
  gfx.rs = function () {
    const want = Math.min(3, Math.max(1, Math.round((FM.view.S || 1) * 4) / 4));
    if (!(rsCur && want <= rsCur && want >= rsCur * .8)) rsCur = want;
    return rsCur;
  };
  gfx.clearCache = function () { cache.clear(); };

  gfx.E = function (g, x, y, rx, ry, col, rot = 0) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, 6.2832); g.fill(); };
  gfx.poly = function (g, col, pts) { g.fillStyle = col; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
  gfx.rr = function (g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); } };
  /** Kalın konturlu oyun yazısı */
  gfx.text = function (g, s, x, y, size, col, opt) {
    opt = opt || {};
    g.font = `${opt.weight || ''} ${size}px ${opt.font || FM.FONT_H}`.trim();
    g.textAlign = opt.align || 'center'; g.textBaseline = opt.base || 'middle';
    g.lineJoin = 'round';
    if (opt.shadow !== false) { g.fillStyle = opt.shadowCol || 'rgba(0,0,0,.35)'; g.fillText(s, x, y + Math.max(2, size / 12)); }
    if (opt.stroke !== false) { g.lineWidth = opt.lw || Math.max(3, size / 5); g.strokeStyle = opt.stroke || '#2a1606'; g.strokeText(s, x, y); }
    g.fillStyle = col; g.fillText(s, x, y);
  };
  /** Hex renk karıştırma / aydınlatma (f>0 açar, f<0 koyulaştırır) */
  gfx.shade = function (hex, f) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  };
  gfx.mix = function (a, b, t) {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const r = Math.round((x >> 16 & 255) + ((y >> 16 & 255) - (x >> 16 & 255)) * t), g = Math.round((x >> 8 & 255) + ((y >> 8 & 255) - (x >> 8 & 255)) * t), bl = Math.round((x & 255) + ((y & 255) - (x & 255)) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  };
  gfx.rgba = function (hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  /** Yumuşak ışık sprite'ı (radyal gradyan), 'lighter' karışımla parlama için */
  gfx.glowSprite = function (col, r) {
    return gfx.sprite('glow:' + col + ':' + r, r * 2, r * 2, r, r, g => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(-r, -r, r * 2, r * 2);
    });
  };
})(window.FM);

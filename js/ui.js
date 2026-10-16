/* =====================================================================
   FUAT MOREL — ui.js
   Tüm DOM arayüzü: üst çubuk, ana menü (logo + karakter vitrini),
   karakterler, mağaza, görevler, klan, ayarlar, nasıl oynanır,
   duraklatma, sonuç paneli, final ekranı, bildirimler, "telefonu çevir"
   katmanı ve dokunmatik kontroller.
   Sözleşme: docs/CONTRACT.md — global olarak yalnızca FM.ui eklenir.
   Diğer modüllerin (FM.meta, FM.audio, FM.R.*) fonksiyonları her zaman
   typeof kontrolüyle çağrılır; yoksa makul bir yedek davranış gösterilir.
   ===================================================================== */
'use strict';
(function (FM) {
  const root = document.getElementById('ui');
  if (!root) { console.warn('[ui] #ui kökü bulunamadı'); return; }
  const S = FM.S;
  const UI = FM.ui = FM.ui || {};

  /* =====================================================================
     0) KÜÇÜK YARDIMCILAR
     ===================================================================== */
  const clamp = FM.clamp || ((v, a, b) => v < a ? a : v > b ? b : v);
  const esc = s => (FM.esc ? FM.esc(s == null ? '' : s) : String(s == null ? '' : s));
  const up = s => String(s == null ? '' : s).toLocaleUpperCase('tr-TR');
  const dpr = () => clamp(window.devicePixelRatio || 1, 1, 2);
  const nowMs = () => (window.performance && performance.now) ? performance.now() : Date.now();
  const FONT_H = FM.FONT_H || '"Lilita One", "Arial Black", Impact, sans-serif';
  const FONT_B = FM.FONT_B || '"Fredoka", "Trebuchet MS", Arial, sans-serif';
  const TAU = Math.PI * 2;

  function fmtN(n) {
    n = Math.round(+n || 0);
    const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−' : '') + s;
  }
  function fmtSigned(n) {
    n = Math.round(+n || 0);
    if (n === 0) return '0';
    return (n > 0 ? '+' : '−') + fmtN(Math.abs(n));
  }
  function fmtTime(t) {
    if (!(t > 0)) return '—';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const p = v => (v < 10 ? '0' : '') + v;
    return p(h) + ':' + p(m) + ':' + p(s);
  }
  /** Oynama süresi: "12 sa 30 dk" (FM.meta.fmtDur ile aynı biçim). Veri yoksa tire. */
  function fmtPlay(sec) {
    if (sec == null || sec === '' || !isFinite(+sec) || +sec < 0) return '—';
    try { if (FM.meta && typeof FM.meta.fmtDur === 'function') return FM.meta.fmtDur(+sec); } catch (e) { /* yedek */ }
    sec = Math.floor(+sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
    if (h > 0) return h + ' sa' + (m ? ' ' + m + ' dk' : '');
    if (m > 0) return m + ' dk';
    return sec + ' sn';
  }
  /** Satırlarda kompakt süre: "12 sa" (≥1 saat) · "45 dk" · "30 sn". Tam metin (12 sa 30 dk) profil sayfasında. */
  function fmtPlayShort(sec) {
    if (sec == null || sec === '' || !isFinite(+sec) || +sec < 0) return '—';
    sec = Math.floor(+sec);
    if (sec >= 3600) return Math.floor(sec / 3600) + ' sa';
    if (sec >= 60) return Math.floor(sec / 60) + ' dk';
    return sec + ' sn';
  }
  /** Son görülme: "az önce" (<1 dk) · "5 dk önce" · "2 sa önce" · "dün" · "3 gün önce" · "2 ay önce" (ms zaman damgasından) */
  function fmtAgo(ms) {
    if (!(+ms > 0)) return 'bilinmiyor';
    const d = Math.max(0, (Date.now() - +ms) / 1000);
    if (d < 60) return 'az önce';
    if (d < 3600) return Math.floor(d / 60) + ' dk önce';
    if (d < 86400) return Math.floor(d / 3600) + ' sa önce';
    if (d < 172800) return 'dün';
    if (d < 86400 * 60) return Math.floor(d / 86400) + ' gün önce';
    return Math.floor(d / 86400 / 30) + ' ay önce';
  }
  function fmtDate(ms) {
    if (!(+ms > 0)) return '—';
    try { return new Date(+ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return '—'; }
  }
  function click() { try { if (FM.audio && typeof FM.audio.click === 'function') FM.audio.click(); } catch (e) { /* ses yok */ } }
  function sfx(name) { try { if (FM.audio && typeof FM.audio.play === 'function') FM.audio.play(name); } catch (e) { /* ses yok */ } }
  /* ---------- ayarlar (tanımsız = varsayılan; eski kayıtlar yeni anahtarları bilmez) ---------- */
  const SET_DEF = { haptic: true, shake: true, aimAssist: true, notify: false, lefty: false, btnSize: 'M' };
  function setting(k) {
    const s = (FM.save && FM.save.settings) || {};
    const v = s[k];
    return v === undefined || v === null ? SET_DEF[k] : v;
  }
  /* ---------- titreşim: FM.haptic(kind) — yalnızca ARAYÜZ tetikler (olaylar aşağıda) ---------- */
  const HAP = {
    pick: [14], ready: [20, 45, 34], hit: [28], death: [70, 45, 110], tap: [8], win: [34, 55, 34, 55, 120],
    count: [14], aim: [5]
  };
  function vibrate(p) {
    try {
      const ua = navigator.userActivation;
      if (setting('haptic') === false) return false;
      if (navigator.vibrate && (!ua || ua.hasBeenActive)) return !!navigator.vibrate(p);
    } catch (e) { /* titreşim yok */ }
    return false;
  }
  FM.haptic = function (kind) { return vibrate(HAP[kind] || HAP.tap); };
  function buzz(ms) { vibrate(ms); }
  /** Öğe tam ekranı destekleniyor mu? (iPhone Safari'de yok: düğmeyi hiç gösterme) */
  function fsOK() {
    try {
      const d = document, el = d.documentElement;
      if (!(el.requestFullscreen || el.webkitRequestFullscreen)) return false;
      if (d.fullscreenEnabled === false && !d.webkitFullscreenEnabled) return false;
      return true;
    } catch (e) { return false; }
  }
  function isIOS() {
    try { const ua = navigator.userAgent || ''; return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch (e) { return false; }
  }
  /** iPhone/iPad'de Safari SEKMESİNDE miyiz (ana ekran uygulaması değil)? Orada öğe tam ekranı yok: tek yol Ana Ekrana Ekle. */
  function iosTab() { return isIOS() && !isStandalone() && !fsOK(); }
  function isStandalone() {
    try { return !!(navigator.standalone || (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches))); } catch (e) { return false; }
  }
  function lsGet(k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (window.localStorage) localStorage.setItem(k, v); } catch (e) { /* özel sekme vb. */ } }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || root).querySelectorAll(sel)); }
  function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }   // yalnızca çizim çeşitliliği için (sosyal veri UYDURMAZ)

  /* =====================================================================
     1) SVG İKON KÜTÜPHANESİ (kalın dış hatlı "oyun" ikonları)
        tür: f = dolu (currentColor) + koyu kontur, s = çizgi (konturlu),
             d = koyu dolgu detay, ds = koyu çizgi detay, a = vurgu dolgusu,
             sa = vurgu renkli çizgi (konturlu)
     ===================================================================== */
  const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  const ell = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;
  function starPath(cx, cy, ro, ri, n) {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ' ' + (cy + Math.sin(a) * r).toFixed(2);
    }
    return d + 'z';
  }
  function gearPath() {
    const n = 8, st = TAU / n, ro = 10.6, ri = 7.9;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = i * st - Math.PI / 2;
      const pts = [[ri, a - st * .42], [ro, a - st * .2], [ro, a + st * .2], [ri, a + st * .42]];
      for (let j = 0; j < 4; j++) {
        const x = 12 + Math.cos(pts[j][1]) * pts[j][0], y = 12 + Math.sin(pts[j][1]) * pts[j][0];
        d += (i === 0 && j === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      }
    }
    return d + 'z';
  }
  const SPADE = 'M12 1.6C10.3 4.6 7.4 6.9 5.2 8.9 3.6 10.4 2.6 11.9 2.6 13.9c0 2.7 2.2 4.6 4.7 4.6 1.6 0 2.9-.7 3.8-1.8-.3 1.7-1 3-2.3 4.3h6.4c-1.3-1.3-2-2.6-2.3-4.3.9 1.1 2.2 1.8 3.8 1.8 2.5 0 4.7-1.9 4.7-4.6 0-2-1-3.5-2.6-5C16.6 6.9 13.7 4.6 12 1.6z';
  const ICO = {
    back: [['f', 'M11.8 3.2 2.8 12l9 8.8v-5.3h8.9V8.5h-8.9z']],
    play: [['f', 'M7.2 3.9c0-1.1 1.2-1.7 2.1-1.1l11.2 7.9c.8.6.8 1.8 0 2.4L9.3 21c-.9.6-2.1 0-2.1-1.1z']],
    pause: [['f', 'M5.2 3.6h4.3c.6 0 1 .4 1 1v14.8c0 .6-.4 1-1 1H5.2c-.6 0-1-.4-1-1V4.6c0-.6.4-1 1-1z'], ['f', 'M14.5 3.6h4.3c.6 0 1 .4 1 1v14.8c0 .6-.4 1-1 1h-4.3c-.6 0-1-.4-1-1V4.6c0-.6.4-1 1-1z']],
    home: [['f', 'M12 2.6 1.9 11.4h2.9v9.4h5.6v-5.7h3.2v5.7h5.6v-9.4h2.9z']],
    gear: [['f', gearPath()], ['d', circ(12, 12, 3.3)]],
    user: [['f', circ(12, 7.3, 4.6)], ['f', 'M3 21.4c.3-5 4.2-8 9-8s8.7 3 9 8z']],
    users: [['f', circ(16.4, 7, 3.2)], ['f', 'M15.2 12.5c3.9-.7 7 1.7 7.3 5.6h-6.1c-.2-2.3-.5-4-1.2-5.6z'], ['f', circ(8.4, 8, 3.7)], ['f', 'M1.6 20.2c.3-4 3-6.6 6.8-6.6s6.5 2.6 6.8 6.6z']],
    bag: [['s', 'M8.6 9.4V7.2a3.4 3.4 0 0 1 6.8 0v2.2'], ['f', 'M4.4 8.4h15.2l-1.2 11.8a1.8 1.8 0 0 1-1.8 1.6H7.4a1.8 1.8 0 0 1-1.8-1.6z'], ['d', circ(8.6, 11.6, 1.15)], ['d', circ(15.4, 11.6, 1.15)]],
    scroll: [['f', 'M6 2.6h12a2 2 0 0 1 2 2v14.8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2z'], ['ds', 'M7.3 8.5l1.6 1.6 2.8-3.1M13.4 8.9h3.8M7.3 14.7l1.6 1.6 2.8-3.1M13.4 15.1h3.8', 'stroke-width="2.1"']],
    spade: [['f', SPADE]],
    help: [['f', circ(12, 12, 10)], ['ds', 'M9.1 9.3a2.9 2.9 0 1 1 4.2 2.6c-.8.4-1.3 1-1.3 1.9v.5', 'stroke-width="2.7"'], ['d', circ(12, 17.5, 1.55)]],
    lock: [['s', 'M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4'], ['f', 'M5.6 9.8h12.8c.9 0 1.6.7 1.6 1.6v8c0 .9-.7 1.6-1.6 1.6H5.6c-.9 0-1.6-.7-1.6-1.6v-8c0-.9.7-1.6 1.6-1.6z'], ['d', 'M12 12.6a1.7 1.7 0 0 1 .9 3.1v1.9h-1.8v-1.9a1.7 1.7 0 0 1 .9-3.1z']],
    check: [['s', 'M4.6 12.6l4.9 4.9L19.6 6.8']],
    close: [['s', 'M6.5 6.5l11 11M17.5 6.5l-11 11']],
    star: [['f', starPath(12, 12.8, 10.8, 5, 5)]],
    gift: [['a', 'M12 7.6C10.3 3.6 6.3 2.9 5.8 5.2c-.4 2.1 2.7 2.7 6.2 2.4z'], ['a', 'M12 7.6c1.7-4 5.7-4.7 6.2-2.4.4 2.1-2.7 2.7-6.2 2.4z'], ['f', 'M4.6 11.4h14.8v8.3c0 .8-.6 1.4-1.4 1.4H6c-.8 0-1.4-.6-1.4-1.4z'], ['f', 'M3.2 7.5h17.6v4H3.2z'], ['a', 'M10.5 7.5h3v13.6h-3z']],
    music: [['s', 'M9.5 17V5.4l10-2.2v11.6'], ['f', ell(6.9, 17.1, 2.9, 2.4)], ['f', ell(16.9, 14.9, 2.9, 2.4)]],
    sound: [['f', 'M3.4 9h3.9l5.2-4.4v14.8L7.3 15H3.4c-.5 0-.9-.4-.9-.9V9.9c0-.5.4-.9.9-.9z'], ['s', 'M15.8 8.6a4.8 4.8 0 0 1 0 6.8M18.6 5.8a8.8 8.8 0 0 1 0 12.4']],
    shake: [['s', 'M1.8 8.6v6.8M22.2 8.6v6.8'], ['f', 'M6 4.5h12c.9 0 1.6.7 1.6 1.6v11.8c0 .9-.7 1.6-1.6 1.6H6c-.9 0-1.6-.7-1.6-1.6V6.1c0-.9.7-1.6 1.6-1.6z'], ['ds', 'M7.4 12.6l1.6-2.4 1.9 3.6 2-4.4 2 4.4 1.7-2.6 1 1.4', 'stroke-width="1.9"']],
    sparkle: [['f', 'M10 2.4l1.9 5.6 5.6 1.9-5.6 1.9L10 17.4l-1.9-5.6-5.6-1.9 5.6-1.9z'], ['f', 'M18 13.2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z']],
    full: [['s', 'M4 9.2V4h5.2M14.8 4H20v5.2M20 14.8V20h-5.2M9.2 20H4v-5.2']],
    reset: [['s', 'M19.4 13.2a7.5 7.5 0 1 1-2.6-6.8'], ['f', 'M20.8 3.1v7.1h-7.1z']],
    keyboard: [['f', 'M3.2 6h17.6c.9 0 1.7.8 1.7 1.7v8.6c0 .9-.8 1.7-1.7 1.7H3.2c-.9 0-1.7-.8-1.7-1.7V7.7C1.5 6.8 2.3 6 3.2 6z'], ['d', 'M4.6 8.6h2.1v2H4.6zM8.2 8.6h2.1v2H8.2zM11.8 8.6h2.1v2h-2.1zM15.4 8.6h2.1v2h-2.1zM18.4 8.6h1.4v2h-1.4zM6.4 13.2h11.2v2H6.4z']],
    hand: [['f', 'M8.6 11.4V4.6a1.7 1.7 0 0 1 3.4 0v5.6l5.4 1a2.5 2.5 0 0 1 2 2.8l-.7 4.9a3.4 3.4 0 0 1-3.4 2.9h-4.6a4 4 0 0 1-3.1-1.5L4.2 15.6a1.6 1.6 0 0 1 2.3-2.2z']],
    up: [['f', 'M12 2.4 2.8 12.2h5.5v8.8h7.4v-8.8h5.5z']],
    down: [['f', 'M12 21.6l9.2-9.8h-5.5V3H8.3v8.8H2.8z']],
    bolt: [['f', 'M13.8 1.6 4 13.8h6.4L9.2 22.4l10.8-12.6h-6.6z']],
    chevL: [['s', 'M15 4.5 7.5 12l7.5 7.5']],
    chevR: [['s', 'M9 4.5l7.5 7.5L9 19.5']],
    trophy: [['s', 'M6.6 6.4H3.7c0 3.3 1.6 5.4 4.2 5.8M17.4 6.4h2.9c0 3.3-1.6 5.4-4.2 5.8'], ['f', 'M6 3h12v4.8a6 6 0 0 1-12 0z'], ['f', 'M10.4 13.4h3.2v3.6h-3.2z'], ['f', 'M7.2 17h9.6c.6 0 1 .4 1 1v2.6H6.2V18c0-.6.4-1 1-1z']],
    crown: [['f', 'M3 7.6l4.4 3.9L12 3.6l4.6 7.9L21 7.6l-1.9 11.6H4.9z'], ['d', circ(12, 14.6, 1.6)]],
    chest: [['f', 'M3.4 11h17.2v8.1c0 .9-.7 1.6-1.6 1.6H5c-.9 0-1.6-.7-1.6-1.6z'], ['f', 'M3.4 11V8.7c0-2.6 2.1-4.7 4.7-4.7h7.8c2.6 0 4.7 2.1 4.7 4.7V11z'], ['ds', 'M3.6 11h16.8M7.6 4.4v16.2M16.4 4.4v16.2', 'stroke-width="1.5"'], ['a', 'M10.1 9.2h3.8v5h-3.8z']],
    calendar: [['f', 'M4.6 4.4h14.8c.9 0 1.6.7 1.6 1.6v13.4c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6z'], ['a', 'M3 6c0-.9.7-1.6 1.6-1.6h14.8c.9 0 1.6.7 1.6 1.6v3.4H3z'], ['s', 'M8 2.4v3.8M16 2.4v3.8'], ['d', 'M6.4 12.2h2.4v2.2H6.4zM10.8 12.2h2.4v2.2h-2.4zM15.2 12.2h2.4v2.2h-2.4zM6.4 16.2h2.4v2.2H6.4zM10.8 16.2h2.4v2.2h-2.4z']],
    flag: [['s', 'M5.4 21.6V3'], ['f', 'M6 3.4h13l-2.8 4.2 2.8 4.2H6z']],
    box: [['f', 'M3.4 6.6 12 2.6l8.6 4v10.6L12 21.4l-8.6-4.2z'], ['ds', 'M3.6 6.8 12 10.6l8.4-3.8M12 10.6v10.6', 'stroke-width="1.6"'], ['a', 'M6.2 11.2c0-1.4 1.1-2.2 2.3-1.7 1.1.5 1.5 1.5 1.1 2.4-.3.6-.9.9-1.2 1.4v.7'], ['d', circ(8.3, 16, .9)]],
    pad: [['f', 'M2.6 15.2h18.8c.6 0 1.1.5 1.1 1.1v2.3c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1v-2.3c0-.6.5-1.1 1.1-1.1z'], ['sa', 'M4.8 5.6l3.6 3.6-3.6 3.6M10.2 5.6l3.6 3.6-3.6 3.6M15.6 5.6l3.6 3.6-3.6 3.6']],
    mush: [['f', 'M9.2 12h5.6l.8 7.6c.1.9-.6 1.6-1.5 1.6h-4.4c-.9 0-1.6-.7-1.5-1.6z'], ['a', 'M2.4 12.6C2.4 7.2 6.7 3.2 12 3.2s9.6 4 9.6 9.4z'], ['f', circ(8, 8.4, 1.7)], ['f', circ(14.8, 6.8, 1.3)], ['f', circ(17.2, 10.2, 1.1)]],
    belt: [['f', 'M5.6 7.6h12.8a4.4 4.4 0 0 1 0 8.8H5.6a4.4 4.4 0 0 1 0-8.8z'], ['d', circ(5.8, 12, 1.6)], ['d', circ(10, 12, 1.6)], ['d', circ(14.2, 12, 1.6)], ['d', circ(18.3, 12, 1.6)], ['sa', 'M8 4.4h8.6M13.6 2.2l3 2.2-3 2.2']],
    mud: [['a', 'M2.4 16c0-2.6 2.4-3.8 4.6-3.3.9-2.3 3-3.5 5.4-3.1s4 2.1 4.3 4.1c2.4-.4 4.9.6 4.9 2.9 0 2.2-2.2 3.4-5 3.4H7.2c-2.6 0-4.8-1.3-4.8-4z'], ['f', circ(8.4, 15.4, 1.1)], ['f', circ(14.6, 14.2, .9)], ['f', circ(17.4, 16.6, .8)]],
    info: [['f', circ(12, 12, 10)], ['d', circ(12, 7.4, 1.6)], ['d', 'M10.6 10.4h2.8v7.4h-2.8z']],
    door: [['f', 'M5 2.8h10.4c.6 0 1 .4 1 1v16.4c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1V3.8c0-.6.4-1 1-1z'], ['d', circ(13, 12.4, 1.1)], ['sa', 'M14.6 12h7M19 9.4l2.6 2.6-2.6 2.6']],
    fire: [['a', 'M12 2c1 3.6 5.8 5.6 5.8 11.2a5.8 5.8 0 0 1-11.6 0c0-2.8 1.4-4.6 2.8-5.8.2 1.6.8 2.6 1.8 3.2C10.4 7.6 11 4.6 12 2z'], ['f', 'M12 12.6c.6 1.8 2.8 2.6 2.8 5a2.8 2.8 0 0 1-5.6 0c0-1.6 1.2-2.6 2.8-5z']],
    medal: [['sa', 'M8 2.4l4 7 4-7'], ['f', circ(12, 15, 6.4)], ['d', starPath(12, 15.4, 3.6, 1.6, 5)]],
    xp: [['f', 'M12 1.8l8.8 5.1v10.2L12 22.2l-8.8-5.1V6.9z'], ['ds', 'M7.6 9l3.4 6M11 9l-3.4 6M13 15V9h2.6a1.9 1.9 0 0 1 0 3.8H13', 'stroke-width="1.9"']],
    battery: [['f', 'M3.2 7.4h14.6c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H3.2c-.9 0-1.6-.7-1.6-1.6V9c0-.9.7-1.6 1.6-1.6z'], ['f', 'M19.4 10h2.2v4h-2.2z'], ['a', 'M4 9.8h3.3v4.4H4zM8.6 9.8h3.3v4.4H8.6zM13.2 9.8h3.3v4.4h-3.3z']],
    wind: [['s', 'M3 9h11.4a3 3 0 1 0-3-3M3 13.2h15.2a3 3 0 1 1-3 3M3 17.4h6.4']],
    shirt: [['f', 'M8.2 3 3 5.6l1.9 4.8 2.4-.9v11.2h9.4V9.5l2.4.9L21 5.6 15.8 3c-.6 1.6-2.1 2.6-3.8 2.6S8.8 4.6 8.2 3z']],
    pad2: [['f', 'M7 6.6h10c2.8 0 4.6 2.7 5 6.3.3 2.9-.6 4.7-2.2 4.7-1.4 0-2.3-1.2-3.3-2.7H7.5c-1 1.5-1.9 2.7-3.3 2.7-1.6 0-2.5-1.8-2.2-4.7.4-3.6 2.2-6.3 5-6.3z'], ['d', 'M6.2 9.6h1.6v1.5h1.5v1.6H7.8v1.5H6.2v-1.5H4.7v-1.6h1.5z'], ['a', circ(16.4, 10.4, 1.2)], ['a', circ(18.6, 12.6, 1.2)]],
    chart: [['f', 'M3.5 14h3.6v6.5H3.5zM10.2 10.5h3.6v10h-3.6zM16.9 6.5h3.6v14h-3.6z'], ['sa', 'M3.4 10.4 9 5.6l3.4 2.6 6.8-5.2M15.6 3h3.6v3.6']],
    copy: [['f', 'M8.4 2.6h10.2c1 0 1.8.8 1.8 1.8v11.4h-3V5.6H8.4z'], ['f', 'M4.6 7.4h10.2c1 0 1.8.8 1.8 1.8v10.4c0 1-.8 1.8-1.8 1.8H4.6c-1 0-1.8-.8-1.8-1.8V9.2c0-1 .8-1.8 1.8-1.8z']],
    share: [['s', 'M5 12.6v6.2c0 1 .8 1.8 1.8 1.8h10.4c1 0 1.8-.8 1.8-1.8v-6.2'], ['f', 'M12 1.8l6 6h-4v7.4h-4V7.8H6z']],
    smile: [['a', circ(12, 12, 9.8)], ['d', ell(8.7, 9.6, 1.4, 1.8)], ['d', ell(15.3, 9.6, 1.4, 1.8)], ['ds', 'M7.4 13.6c1.1 2.3 2.7 3.5 4.6 3.5s3.5-1.2 4.6-3.5', 'stroke-width="2.3"']],
    wifi: [['s', 'M2.6 9.2a13.4 13.4 0 0 1 18.8 0M5.9 12.6a8.6 8.6 0 0 1 12.2 0M9.2 16a3.9 3.9 0 0 1 5.6 0'], ['f', circ(12, 19.4, 1.9)]],
    halo: [['sa','M6.5 4.2c0-1 2.5-1.8 5.5-1.8s5.5.8 5.5 1.8-2.5 1.8-5.5 1.8-5.5-.8-5.5-1.8z'], ['f', circ(12, 14, 7.6)], ['d', circ(9.4, 13, 1.1)], ['d', circ(14.6, 13, 1.1)], ['ds', 'M9.2 16.6c1.6 1.4 4 1.4 5.6 0', 'stroke-width="1.8"']],
    aim: [['s', 'M12 2.6v4.8M12 16.6v4.8M2.6 12h4.8M16.6 12h4.8'], ['s', 'M12 6.8a5.2 5.2 0 1 0 .01 0z']],
    shieldL: [['f', 'M12 2.2 3.6 5.2v6.2c0 5 3.5 8.6 8.4 10.4 4.9-1.8 8.4-5.4 8.4-10.4V5.2z'], ['d', starPath(12, 12.4, 4.6, 2, 5)]],
    clock: [['f', circ(12, 12, 9.8)], ['ds', 'M12 6.4V12l3.8 2.3', 'stroke-width="2.3"']],
    bell: [['f', 'M12 2.4c-3.5 0-6.2 2.7-6.2 6.2v4.2L3.6 16v1.8h16.8V16l-2.2-3.2V8.6c0-3.5-2.7-6.2-6.2-6.2z'], ['f', 'M9.4 19.4a2.6 2.6 0 0 0 5.2 0z']],
    plug: [['f', 'M8 2.6h2.4v5H8zM13.6 2.6H16v5h-2.4z'], ['f', 'M5.6 7.4h12.8v4.2a6.4 6.4 0 0 1-12.8 0z'], ['f', 'M10.8 16.6h2.4v4.6h-2.4z']]
  };
  /* emoji -> vektör ikon (görev / geliştirme / ödül satırları) */
  const EMO = {
    '🪙': ['r', 'coin'], '💰': ['r', 'coin'], '👛': ['r', 'coin'], '💎': ['r', 'gem'], '🏆': ['r', 'trophy'], '👑': ['r', 'crown'],
    '🏁': ['r', 'flag'], '🧨': ['r', 'dyn'], '🪚': ['r', 'saw'], '🚀': ['r', 'mis'], '🛡': ['r', 'shield'],
    '🎈': ['r', 'balloon'], '💥': ['r', 'x_boom'], '☠': ['r', 'x_boom'], '🕸': ['r', 'net'], '🧲': ['r', 'mag'],
    '❄': ['r', 'ice'], '🦑': ['r', 'ink'], '👟': ['r', 'speed'], '🪤': ['r', 'trap'], '🌩': ['r', 'bolt'], '⏱': ['r', 'clock'],
    '🚪': ['r', 'x_gate'], '☄': ['r', 'x_meteor'],
    '🥇': ['m', 1], '🥈': ['m', 2], '🥉': ['m', 3], '🏅': ['m', 4],
    '⏩': ['s', 'pad', 'c-steel'], '📦': ['s', 'box', 'c-wood'], '🍄': ['s', 'mush', 'c-mush'], '🎁': ['s', 'gift', 'c-gift'],
    '⚡': ['s', 'bolt', 'c-gold'], '🌟': ['s', 'star', 'c-gold'], '⭐': ['s', 'star', 'c-gold'], '✨': ['s', 'sparkle', 'c-gold'],
    '🔥': ['s', 'fire', 'c-fire'], '📅': ['s', 'calendar', 'c-white'], '📋': ['s', 'scroll', 'c-white'], '🧰': ['s', 'chest', 'c-wood'],
    '🔋': ['s', 'battery', 'c-green'], '🎒': ['s', 'bag', 'c-orange'], '💨': ['s', 'wind', 'c-cyan'], '🧗': ['s', 'up', 'c-cyan'],
    '🦘': ['s', 'up', 'c-orange'], '⬆': ['s', 'up', 'c-green'], '⬇': ['s', 'down', 'c-blue'], '🎭': ['s', 'user', 'c-purple'],
    '😇': ['s', 'halo', 'c-gold'], '🏃': ['s', 'wind', 'c-white'], '♠': ['s', 'spade', 'c-red'],
    '👕': ['s', 'shirt', 'c-blue'], '🎮': ['s', 'pad2', 'c-purple'], '📈': ['s', 'chart', 'c-green']
  };
  function svg(name, cls, title) {
    const parts = ICO[name];
    if (!parts) return '';
    let s = '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
    if (title) s += '<title>' + esc(title) + '</title>';
    for (const p of parts) {
      const t = p[0], d = p[1], ex = p[2] || '';
      if (t === 'f') s += '<path class="i-f" d="' + d + '" ' + ex + '/>';
      else if (t === 's') s += '<path class="i-so" d="' + d + '"/><path class="i-s" d="' + d + '" ' + ex + '/>';
      else if (t === 'sa') s += '<path class="i-so" d="' + d + '"/><path class="i-sa" d="' + d + '" ' + ex + '/>';
      else if (t === 'd') s += '<path class="i-d" d="' + d + '" ' + ex + '/>';
      else if (t === 'ds') s += '<path class="i-ds" d="' + d + '" ' + (ex || 'stroke-width="2"') + '/>';
      else if (t === 'a') s += '<path class="i-a" d="' + d + '" ' + ex + '/>';
    }
    return s + '</svg>';
  }

  /* =====================================================================
     2) GÖRSEL KAYNAKLAR (render-hud ikonları, render-chars portreleri)
     ===================================================================== */
  const ICON_RES = [32, 48, 64, 96, 128, 192];
  function iconPx(css) { const want = css * dpr(); for (const r of ICON_RES) if (r >= want) return r; return 192; }
  function iconSrc(name, css) {
    const R = FM.R;
    if (!R || typeof R.iconURL !== 'function') return '';
    try { return R.iconURL(name, iconPx(css || 32)) || ''; } catch (e) { return ''; }
  }
  /** Oyun ikonu (<img>); yoksa CSS/SVG yedek */
  function gi(name, css, cls) {
    const R = FM.R;
    const known = !(R && Array.isArray(R.ICONS)) || R.ICONS.indexOf(name) >= 0;
    const src = known ? iconSrc(name, css) : '';
    cls = 'gi ' + (cls || '');
    if (src) return '<img class="' + cls + '" src="' + src + '" alt="" draggable="false">';
    if (name === 'coin') return '<i class="' + cls + ' fb-coin"></i>';
    if (name === 'gem') return '<i class="' + cls + ' fb-gem"></i>';
    if (FM.ITEMS && FM.ITEMS[name]) return '<i class="' + cls + ' fb-emo">' + esc(FM.ITEMS[name].ic) + '</i>';
    const map = { trophy: 'trophy', crown: 'crown', flag: 'flag', clock: 'calendar' };
    return '<i class="' + cls + ' fb-svg">' + svg(map[name] || (ICO[name] ? name : 'star')) + '</i>';
  }
  const coinI = (css, cls) => gi('coin', css || 32, cls);
  const gemI = (css, cls) => gi('gem', css || 32, cls);
  const trophyI = (css, cls) => gi('trophy', css || 32, cls);
  /** Görev/geliştirme ikon alanı: ikon adı, eşya anahtarı veya emoji olabilir */
  function anyIcon(ic, css, cls) {
    const R = FM.R;
    const names = (R && R.ICONS) || [];
    if (ic && typeof ic === 'string') {
      const m = EMO[ic] || EMO[ic.replace(/\uFE0F/g, '')];
      if (m) {
        if (m[0] === 'r') return gi(m[1], css, cls);
        if (m[0] === 'm') return '<i class="gi fb-svg fb-medal ' + (cls || '') + '">' + placeBadge(m[1]) + '</i>';
        return '<i class="gi fb-svg ' + m[2] + ' ' + (cls || '') + '">' + svg(m[1]) + '</i>';
      }
    }
    if (ic && (names.indexOf(ic) >= 0 || (FM.ITEMS && FM.ITEMS[ic]))) return gi(ic, css, cls);
    if (ic && ICO[ic]) return '<i class="gi fb-svg ' + (cls || '') + '">' + svg(ic) + '</i>';
    if (ic && typeof ic === 'string' && ic.length <= 4) return '<i class="gi fb-emo ' + (cls || '') + '">' + esc(ic) + '</i>';
    return '<i class="gi fb-svg ' + (cls || '') + '">' + svg('star') + '</i>';
  }
  function portraitSrc(id, css, opts) {
    const R = FM.R;
    if (!R || typeof R.portraitURL !== 'function') return '';
    const px = Math.round(clamp(css * dpr(), 32, 512) / 16) * 16;
    try { return R.portraitURL(id, px, opts || {}) || ''; } catch (e) { return ''; }
  }
  function chBg(id) { const c = FM.CH[id]; return (c && c.col2) || '#5b2a86'; }
  /** Karakter portresi <img>; yoksa harfli yuvarlak yedek */
  function pt(id, css, opts, cls) {
    opts = opts || {};
    const o = { bg: opts.bg === undefined ? chBg(id) : opts.bg };
    if (opts.skin && opts.skin !== 'klasik') o.skin = opts.skin;
    if (opts.hat && opts.hat !== 'none') o.hat = opts.hat;
    if (opts.expr) o.expr = opts.expr;
    if (opts.ring === false) o.ring = false;
    if (!o.bg) delete o.bg;
    const src = portraitSrc(id, css, o);
    if (src) return '<img class="pt ' + (cls || '') + '" src="' + src + '" alt="' + esc(id) + '" draggable="false">';
    return '<span class="pt pt-fb ' + (cls || '') + '" style="--pc:' + esc(chBg(id)) + '">' + esc(up(String(id || '?').charAt(0))) + '</span>';
  }

  /* =====================================================================
     3) META ADAPTÖRLERİ (FM.meta yoksa güvenli yedekler)
     ===================================================================== */
  const hasMeta = name => !!(FM.meta && typeof FM.meta[name] === 'function');
  function mcall(name) {
    if (!hasMeta(name)) return undefined;
    try { return FM.meta[name].apply(FM.meta, Array.prototype.slice.call(arguments, 1)); }
    catch (e) { console.error('[ui] meta.' + name, e); return undefined; }
  }
  const sv = () => FM.save || {};
  function coins() { const v = mcall('coins'); return typeof v === 'number' ? v : (+sv().coins || 0); }
  function gems() { const v = mcall('gems'); return typeof v === 'number' ? v : (+sv().gems || 0); }
  function levelInfo() {
    const v = mcall('levelInfo');
    if (v && typeof v === 'object') {
      const need = Math.max(1, +v.need || 1), xp = Math.max(0, +v.xp || 0);
      let pct = xp / need * 100;
      if (!(pct >= 0)) pct = +v.pct || 0;
      return { level: Math.max(1, +v.level || 1), xp, need, pct: clamp(pct, 0, 100) };
    }
    const level = Math.max(1, +sv().level || 1), xp = Math.max(0, +sv().xp || 0), need = 100 + (level - 1) * 60;
    return { level, xp, need, pct: clamp(xp / need * 100, 0, 100) };
  }
  function missions() { const v = mcall('missions'); return Array.isArray(v) ? v.filter(Boolean) : []; }
  function claimable() { return missions().filter(m => m.done && !m.claimed).length; }
  function daily() { const v = mcall('daily'); return v && typeof v === 'object' ? v : null; }
  function dailyReady() { const d = daily(); return !!(d && d.ready); }
  function upgrades(ch) { const v = mcall('upgrades', ch); return Array.isArray(v) ? v.filter(Boolean) : null; }
  function abLevel(ch) { const v = mcall('mods', ch); return Math.max(1, (v && +v.abLv) || 1); }
  function trophies(id) { const t = sv().trophies || {}; return typeof t[id] === 'number' ? t[id] : 0; }
  const COS = FM.COSMETICS || { skins: [], trails: [], plates: [] };
  const cosList = type => COS[type] || [];
  const cosItem = (type, id) => cosList(type).find(x => x.id === id) || null;
  // Mağaza 2.0 türleri: kayıt alanı ve varsayılan (meta yoksa yedek)
  const COS_EQ = { trails: 'trail', plates: 'plate', hats: 'hat', wins: 'win', deaths: 'death' };
  const COS_DEF = { skins: 'klasik', trails: 'dust', plates: 'basic', hats: 'none', wins: 'none', deaths: 'none' };
  const RAR = FM.RARITY || { c: { n: 'Sıradan', col: '#9aa3b2' }, r: { n: 'Nadir', col: '#4fb3ff' }, e: { n: 'Destansı', col: '#c084fc' }, l: { n: 'Efsanevi', col: '#ffb020' } };
  function owns(type, id, ch) {
    const v = mcall('owns', type, id, ch);
    if (typeof v === 'boolean') return v;
    const it = cosItem(type, id);
    if (it && !it.price) return true;
    const o = sv().owned || {};
    if (type === 'skins') return ((o.skins || {})[ch] || []).indexOf(id) >= 0;
    return (o[type] || []).indexOf(id) >= 0;
  }
  function equipped(type, ch) {
    const v = mcall('equipped', type, ch);
    if (typeof v === 'string' && v) return v;
    const e = sv().equipped || {};
    if (type === 'skins') return (e.skin || {})[ch] || 'klasik';
    return (COS_EQ[type] && e[COS_EQ[type]]) || COS_DEF[type] || 'none';
  }
  function equip(type, id, ch) {
    if (hasMeta('equip')) { mcall('equip', type, id, ch); return; }
    const e = sv().equipped; if (!e) return;
    if (type === 'skins') { e.skin = e.skin || {}; e.skin[ch] = id; } else if (COS_EQ[type]) e[COS_EQ[type]] = id;
    FM.persist(); FM.emit('meta:change', {});
  }
  /** Mağaza öğesi görünümü (FM.meta.cosmetic; yoksa katalogdan): {id, n, d, type, price, base, off, cur, rar, rarN, rarCol, owned, equipped, can, typeOne} */
  function cosView(type, id, ch) {
    let v = mcall('cosmetic', type, id, ch);
    if (!v || typeof v !== 'object') {
      const it = cosItem(type, id); if (!it) return null;
      const rar = RAR[it.rar] ? it.rar : 'c';
      v = Object.assign({}, it, { type, price: +it.price || 0, base: +it.price || 0, off: 0, cur: it.cur === 'gems' ? 'gems' : 'coins', rar, rarN: RAR[rar].n, rarCol: RAR[rar].col, owned: owns(type, id, ch), equipped: equipped(type, ch) === id });
      v.can = v.owned || curAmt(v.cur) >= v.price;
    }
    if (!v.typeOne) v.typeOne = (mcall('cosTypes') || []).reduce((a, t) => (t.type === type ? t.one : a), '') || '';
    return v;
  }
  function buyCos(type, id, ch) {
    if (hasMeta('buyCosmetic')) return !!mcall('buyCosmetic', type, id, ch);
    const it = cosItem(type, id), s = sv();
    if (!it || (+s.coins || 0) < it.price) return false;
    s.coins -= it.price;
    const o = s.owned;
    if (type === 'skins') { o.skins[ch] = o.skins[ch] || ['klasik']; o.skins[ch].push(id); } else (o[type] = o[type] || []).push(id);
    FM.persist(); FM.emit('meta:change', {});
    return true;
  }
  function priceOf(u) {
    if (!u) return { cur: 'coins', n: 0 };
    if (u.cost && typeof u.cost === 'object') return u.cost.gems ? { cur: 'gems', n: +u.cost.gems } : { cur: 'coins', n: +u.cost.coins || 0 };
    return { cur: u.cur === 'gems' ? 'gems' : 'coins', n: +u.cost || 0 };
  }
  const canAfford = p => (p.cur === 'gems' ? gems() : coins()) >= p.n;
  function rewardChips(rw, css) {
    if (!rw || typeof rw !== 'object') return '';
    let h = '';
    if (rw.coins) h += '<span class="rw">' + coinI(css || 20) + '<b>' + fmtN(rw.coins) + '</b></span>';
    if (rw.gems) h += '<span class="rw">' + gemI(css || 20) + '<b>' + fmtN(rw.gems) + '</b></span>';
    if (rw.xp) h += '<span class="rw rw-xp"><i class="xp-pill">XP</i><b>' + fmtN(rw.xp) + '</b></span>';
    return h;
  }

  /* =====================================================================
     4) TUVAL SANATI: logo, klan bayrağı, kaide, iz önizlemesi
     ===================================================================== */
  const SPADE2D = (typeof Path2D === 'function') ? new Path2D(SPADE) : null;
  /** cx,cy merkezli h yüksekliğinde maça yolu (ctx dönüşümü ayarlanır; fn içinde k = ölçek) */
  function withSpade(g, cx, cy, h, rot, fn) {
    if (!SPADE2D) return;
    const k = h / 19.4;
    g.save(); g.translate(cx, cy); if (rot) g.rotate(rot); g.scale(k, k); g.translate(-12, -11.3);
    try { fn(SPADE2D, k); } finally { g.restore(); }
  }
  function fitCanvas(cv) {
    // düzen boyutu (dönüşümlerden etkilenmez: giriş animasyonundaki ölçek tuvali bulanıklaştırmasın)
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (cw < 4 || ch < 4) return null;
    const d = dpr(), w = Math.round(cw * d), h = Math.round(ch * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { cw, ch, d, w, h };
  }
  function lg(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]); return gr; }
  function rg(g, x0, y0, r0, x1, y1, r1, stops) { const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1); for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]); return gr; }
  function sparkle4(g, x, y, r, col) {
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x + r * .14, y - r * .14, x + r, y); g.quadraticCurveTo(x + r * .14, y + r * .14, x, y + r);
    g.quadraticCurveTo(x - r * .14, y + r * .14, x - r, y); g.quadraticCurveTo(x - r * .14, y - r * .14, x, y - r);
    g.fillStyle = col || '#ffffff'; g.fill();
  }
  let offCv = null;
  function offscreen(w, h) {
    if (!offCv) offCv = document.createElement('canvas');
    if (offCv.width !== w || offCv.height !== h) { offCv.width = w; offCv.height = h; }
    const o = offCv.getContext('2d'); o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, w, h);
    return offCv;
  }

  /* ---------- LOGO ---------- */
  const LOGO_W = 620, LOGO_H = 300;
  function logoWord(g, k, ox, oy, txt, x, y, size, pal, rot) {
    g.save();
    g.setTransform(k, 0, 0, k, ox, oy); g.translate(x, y); g.rotate(rot);
    g.font = size + 'px ' + FONT_H; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineCap = 'round';
    // yumuşak alt gölge
    g.fillStyle = 'rgba(8,0,24,.45)'; g.strokeStyle = 'rgba(8,0,24,.45)'; g.lineWidth = size * .36;
    g.strokeText(txt, 3, size * .17); g.fillText(txt, 3, size * .17);
    // 3B kalınlık (ekstrüzyon)
    g.strokeStyle = '#140724'; g.fillStyle = '#140724'; g.lineWidth = size * .3;
    for (let i = 10; i >= 1; i--) { const dy = i * size * .009; g.strokeText(txt, 0, dy); }
    g.strokeStyle = pal.side; g.lineWidth = size * .17;
    for (let i = 8; i >= 1; i--) { const dy = i * size * .009; g.strokeText(txt, 0, dy); }
    // dış hat + iç kenar
    g.strokeStyle = '#140724'; g.lineWidth = size * .3; g.strokeText(txt, 0, 0);
    g.strokeStyle = pal.rim; g.lineWidth = size * .15; g.strokeText(txt, 0, 0);
    g.restore();
    // dolgu + parlak üst yarı (offscreen, yalnızca harflerin içinde)
    const off = offscreen(g.canvas.width, g.canvas.height), o = off.getContext('2d');
    o.setTransform(k, 0, 0, k, ox, oy); o.translate(x, y); o.rotate(rot);
    o.font = size + 'px ' + FONT_H; o.textAlign = 'center'; o.textBaseline = 'alphabetic';
    o.fillStyle = lg(o, 0, -size * .74, 0, size * .02, pal.fill);
    o.fillText(txt, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    o.fillStyle = lg(o, 0, -size * .8, 0, -size * .36, [0, 'rgba(255,255,255,.85)', 1, 'rgba(255,255,255,.08)']);
    o.beginPath(); o.ellipse(0, -size * .62, size * 3.2, size * .3, 0, 0, TAU); o.fill();
    o.fillStyle = lg(o, 0, -size * .22, 0, size * .04, [0, 'rgba(0,0,0,0)', 1, pal.shade]);
    o.fillRect(-size * 4, -size * .22, size * 8, size * .3);
    // ince parlak üst kenar çizgisi
    o.globalCompositeOperation = 'source-over';
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(off, 0, 0); g.restore();
  }
  function drawLogo(cv) {
    const f = fitCanvas(cv); if (!f) return;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, f.w, f.h);
    const k = Math.min(f.w / LOGO_W, f.h / LOGO_H);
    const ox = (f.w - LOGO_W * k) / 2, oy = (f.h - LOGO_H * k) / 2;
    g.setTransform(k, 0, 0, k, ox, oy);
    g.lineJoin = 'round'; g.lineCap = 'round';
    // arka ışıma
    g.fillStyle = rg(g, 300, 140, 10, 300, 150, 300, [0, 'rgba(255,170,60,.30)', .5, 'rgba(150,70,255,.16)', 1, 'rgba(0,0,0,0)']);
    g.fillRect(0, 0, LOGO_W, LOGO_H);
    // ışın demeti (maçanın arkasında)
    g.save(); g.translate(118, 140); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 150, a, a + TAU / 34); g.closePath();
      g.fillStyle = 'rgba(255,200,120,.07)'; g.fill();
    }
    g.restore();
    // maça amblemi
    const scx = 118, scy = 142, sh = 232, srot = -.2;
    withSpade(g, scx + 6, scy + 12, sh, srot, (p, s) => { g.fillStyle = 'rgba(8,0,24,.5)'; g.lineWidth = 16 / s; g.strokeStyle = 'rgba(8,0,24,.5)'; g.stroke(p); g.fill(p); });
    withSpade(g, scx, scy, sh, srot, (p, s) => {
      g.lineJoin = 'round';
      g.lineWidth = 22 / s; g.strokeStyle = '#140724'; g.stroke(p);
      g.lineWidth = 12 / s; g.strokeStyle = lg(g, 0, 2, 0, 22, [0, '#fff3b0', .35, '#ffd23f', .7, '#f0a20f', 1, '#a85f00']); g.stroke(p);
      g.lineWidth = 3.2 / s; g.strokeStyle = '#140724'; g.stroke(p);
      g.fillStyle = rg(g, 9, 9, .5, 12, 12, 14, [0, '#ff6e7e', .45, '#e0243a', .85, '#9c0d24', 1, '#5c0414']); g.fill(p);
      g.save(); g.clip(p);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(9, 8.6, 4.2, 2.4, -.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(7.6, 10.6, 1.1, .7, -.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(15, 17.5, 6, 3, -.3, 0, TAU); g.fill();
      g.restore();
    });
    // kelimeler
    logoWord(g, k, ox, oy, 'FUAT', 352, 110, 112, { fill: [0, '#fffbd8', .35, '#ffe24a', .7, '#ffb21a', 1, '#ff8000'], rim: '#b85a00', side: '#7a3400', shade: 'rgba(160,60,0,.35)' }, -.04);
    logoWord(g, k, ox, oy, 'MOREL', 344, 216, 118, { fill: [0, '#ffe3e3', .3, '#ff6d5c', .66, '#e8263a', 1, '#a30f27'], rim: '#6a0618', side: '#3e020c', shade: 'rgba(60,0,10,.4)' }, -.04);
    // alt kurdele
    g.setTransform(k, 0, 0, k, ox, oy);
    const bx = 352, by = 262, bw = 268, bh = 34;
    const tail = (dir) => {
      const x0 = bx + dir * (bw / 2 - 12);
      g.beginPath();
      g.moveTo(x0, by - bh / 2 + 8); g.lineTo(x0 + dir * 46, by - bh / 2 + 8); g.lineTo(x0 + dir * 34, by + 6); g.lineTo(x0 + dir * 46, by + bh / 2 + 8); g.lineTo(x0, by + bh / 2 + 8); g.closePath();
      g.fillStyle = '#7a0c20'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#140724'; g.stroke();
    };
    tail(-1); tail(1);
    g.beginPath(); g.moveTo(bx - bw / 2, by - bh / 2); g.lineTo(bx + bw / 2, by - bh / 2); g.lineTo(bx + bw / 2, by + bh / 2); g.lineTo(bx - bw / 2, by + bh / 2); g.closePath();
    g.fillStyle = lg(g, 0, by - bh / 2, 0, by + bh / 2, [0, '#3a3440', .5, '#17141c', 1, '#050407']); g.fill();
    g.lineWidth = 4.5; g.strokeStyle = '#140724'; g.stroke();
    g.lineWidth = 1.6; g.strokeStyle = '#e0243a'; g.strokeRect(bx - bw / 2 + 4, by - bh / 2 + 4, bw - 8, bh - 8);
    g.font = '21px ' + FONT_H; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText('KLAN KOŞUSU', bx, by + 1.5);
    g.fillStyle = '#ffffff'; g.fillText('KLAN KOŞUSU', bx, by + 1.5);
    for (const sx of [-1, 1]) withSpade(g, bx + sx * 104, by + 1, 17, 0, (p) => { g.fillStyle = '#e0243a'; g.fill(p); });
    // parıltılar
    g.globalCompositeOperation = 'lighter';
    const sp = [[548, 52, 15], [214, 44, 10], [580, 168, 9], [66, 66, 8], [260, 236, 7]];
    for (const s of sp) { g.fillStyle = 'rgba(255,230,160,.25)'; g.beginPath(); g.arc(s[0], s[1], s[2] * 1.3, 0, TAU); g.fill(); sparkle4(g, s[0], s[1], s[2], '#fffbe8'); }
    g.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------- KLAN BAYRAĞI ---------- */
  function drawFlag(cv) {
    const f = fitCanvas(cv); if (!f) return;
    const g = cv.getContext('2d');
    const W = 200, H = 300, k = Math.min(f.w / W, f.h / H);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, f.w, f.h);
    g.setTransform(k, 0, 0, k, (f.w - W * k) / 2, (f.h - H * k) / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const L = 32, Rr = 168, T = 30, B = 268, notch = 236, cx = 100;
    const banner = () => { g.beginPath(); g.moveTo(L, T); g.lineTo(Rr, T); g.lineTo(Rr, B); g.lineTo(cx, notch); g.lineTo(L, B); g.closePath(); };
    // gölge
    g.save(); g.translate(5, 8); banner(); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill(); g.restore();
    // kumaş
    banner(); g.fillStyle = lg(g, 0, T, 0, B, [0, '#2b2830', .5, '#151319', 1, '#08070a']); g.fill();
    g.save(); banner(); g.clip();
    // kırmızı üçgenler (yanlarda)
    const tri = (x0, tipX) => { g.beginPath(); g.moveTo(x0, 82); g.lineTo(tipX, 160); g.lineTo(x0, 238); g.closePath(); };
    for (const s of [[L, 86], [Rr, 114]]) {
      tri(s[0], s[1]); g.fillStyle = lg(g, s[0], 0, s[1], 0, [0, '#ff3048', 1, '#a30f27']); g.fill();
      g.lineWidth = 3; g.strokeStyle = '#0a0508'; g.stroke();
    }
    // kumaş kıvrımları
    for (let i = 0; i < 6; i++) {
      const x = L + 10 + i * 24;
      g.fillStyle = lg(g, x, 0, x + 24, 0, [0, 'rgba(255,255,255,0)', .5, 'rgba(255,255,255,.07)', 1, 'rgba(0,0,0,.12)']);
      g.fillRect(x, T, 24, B - T);
    }
    // üst siyah bölgenin alt çizgisi (altın şerit)
    g.fillStyle = lg(g, 0, 60, 0, 68, [0, '#ffe58a', 1, '#c07a0c']); g.fillRect(L, 62, Rr - L, 5);
    g.restore();
    // altıgen
    const hx = cx, hy = 160, hr = 44;
    const hexP = (r) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; const x = hx + Math.cos(a) * r, y = hy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    hexP(hr + 4); g.fillStyle = '#0a0508'; g.fill();
    hexP(hr); g.fillStyle = lg(g, 0, hy - hr, 0, hy + hr, [0, '#ffffff', .6, '#f1eef5', 1, '#cfc8da']); g.fill();
    g.lineWidth = 2.4; g.strokeStyle = '#ffd23f'; hexP(hr - 3.5); g.stroke();
    withSpade(g, hx, hy + 1, 54, 0, (p, s) => {
      g.fillStyle = lg(g, 0, 2, 0, 22, [0, '#3a3440', 1, '#050407']); g.fill(p);
      g.save(); g.clip(p); g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.ellipse(9, 8.4, 3.6, 2, -.6, 0, TAU); g.fill(); g.restore();
    });
    // kenar şeridi + dış hat
    banner(); g.lineWidth = 9; g.strokeStyle = '#0a0508'; g.stroke();
    banner(); g.lineWidth = 4; g.strokeStyle = lg(g, 0, T, 0, B, [0, '#ffe58a', .5, '#f0b020', 1, '#a86400']); g.stroke();
    // püsküller
    for (const p of [[L, B], [Rr, B]]) {
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0], p[1] + 12); g.lineWidth = 2.5; g.strokeStyle = '#a86400'; g.stroke();
      g.beginPath(); g.moveTo(p[0] - 5, p[1] + 12); g.lineTo(p[0] + 5, p[1] + 12); g.lineTo(p[0] + 3, p[1] + 26); g.lineTo(p[0] - 3, p[1] + 26); g.closePath();
      g.fillStyle = '#f0b020'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0508'; g.stroke();
    }
    // direk
    g.beginPath(); if (g.roundRect) g.roundRect(18, 16, 164, 16, 8); else g.rect(18, 16, 164, 16);
    g.fillStyle = lg(g, 0, 16, 0, 32, [0, '#fff1b0', .45, '#f0b020', 1, '#8a4f00']); g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#0a0508'; g.stroke();
    for (const x of [16, 184]) {
      g.beginPath(); g.arc(x, 24, 10, 0, TAU); g.fillStyle = rg(g, x - 3, 20, 1, x, 24, 10, [0, '#fff6c8', .5, '#f0b020', 1, '#8a4f00']); g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#0a0508'; g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------- VİTRİN KAİDESİ ---------- */
  const pedCache = new Map();
  function pedestal(W, H, d) {
    const key = W + 'x' + H + '@' + d;
    let c = pedCache.get(key);
    if (c) return c;
    if (pedCache.size > 8) pedCache.clear();
    c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * d)); c.height = Math.max(1, Math.round(H * d));
    const g = c.getContext('2d'); g.scale(d, d);
    const cx = W / 2, cy = H * .82, rx = Math.min(W * .42, H * .34), ry = rx * .26, dep = ry * .8;
    // yere vuran ışık
    g.fillStyle = rg(g, cx, cy + dep, 4, cx, cy + dep, rx * 1.5, [0, 'rgba(255,190,90,.38)', .5, 'rgba(140,70,255,.18)', 1, 'rgba(0,0,0,0)']);
    g.beginPath(); g.ellipse(cx, cy + dep, rx * 1.5, ry * 2.1, 0, 0, TAU); g.fill();
    // yan yüz
    const side = () => { g.beginPath(); g.moveTo(cx - rx, cy); g.lineTo(cx - rx, cy + dep); g.ellipse(cx, cy + dep, rx, ry, 0, Math.PI, 0, true); g.lineTo(cx + rx, cy); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI, false); g.closePath(); };
    side(); g.fillStyle = lg(g, cx - rx, 0, cx + rx, 0, [0, '#1d0d3a', .2, '#3c1f74', .5, '#5a33a8', .8, '#3c1f74', 1, '#1d0d3a']); g.fill();
    // altın bant
    g.save(); side(); g.clip();
    g.beginPath(); g.ellipse(cx, cy + dep * .55, rx + 2, ry, 0, 0, Math.PI); g.lineWidth = Math.max(2, dep * .22); g.strokeStyle = lg(g, cx - rx, 0, cx + rx, 0, [0, '#8a4f00', .5, '#ffd23f', 1, '#8a4f00']); g.stroke();
    g.restore();
    side(); g.lineWidth = Math.max(2, rx * .03); g.strokeStyle = '#12061f'; g.stroke();
    // üst yüz
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.fillStyle = rg(g, cx - rx * .2, cy - ry * .5, 2, cx, cy, rx, [0, '#9a74ff', .45, '#6a40d8', 1, '#2e1466']); g.fill();
    g.lineWidth = Math.max(3, rx * .05); g.strokeStyle = '#12061f'; g.stroke();
    g.beginPath(); g.ellipse(cx, cy, rx - rx * .06, ry - rx * .06 * .26, 0, 0, TAU); g.lineWidth = Math.max(1.5, rx * .025); g.strokeStyle = lg(g, cx - rx, 0, cx + rx, 0, [0, '#ffe58a', .5, '#fff8d8', 1, '#f0a20f']); g.stroke();
    // yassı maça amblemi
    g.save(); g.translate(cx, cy); g.scale(1, .26); g.globalAlpha = .38;
    withSpade(g, 0, 0, rx * 1.05, 0, (p) => { g.fillStyle = '#1d0b40'; g.fill(p); });
    g.restore();
    pedCache.set(key, c);
    return c;
  }

  /* ---------- İZ (TRAIL) ÖNİZLEMESİ ---------- */
  function heartPath(g, x, y, r) {
    g.beginPath(); g.moveTo(x, y + r * .9);
    g.bezierCurveTo(x - r * 1.4, y - r * .1, x - r * .7, y - r * 1.2, x, y - r * .45);
    g.bezierCurveTo(x + r * .7, y - r * 1.2, x + r * 1.4, y - r * .1, x, y + r * .9); g.closePath();
  }
  function starP(g, x, y, ro, ri, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.closePath();
  }
  function drawTrail(cv, id) {
    const f = fitCanvas(cv); if (!f) return;
    const g = cv.getContext('2d');
    g.setTransform(f.d, 0, 0, f.d, 0, 0); g.clearRect(0, 0, f.cw, f.ch);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const W = f.cw, H = f.ch;
    const tr = cosItem('trails', id) || { colors: [] };
    const cols = tr.colors && tr.colors.length ? tr.colors : ['#ffffff'];
    const P0 = [W * .06, H * .78], P1 = [W * .42, H * .98], P2 = [W * .74, H * .42];
    const at = t => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
    const OUT = '#1a0b2e';
    const base = Math.min(W, H);
    if (id === 'none') {
      g.globalAlpha = .55; g.setLineDash([base * .06, base * .05]); g.lineWidth = base * .035; g.strokeStyle = '#c9b8ee';
      g.beginPath(); g.moveTo(P0[0], P0[1]); g.quadraticCurveTo(P1[0], P1[1], P2[0], P2[1]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    } else if (id === 'rainbow') {
      const n = cols.length, bw = base * .055;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * bw;
        g.beginPath(); g.moveTo(P0[0], P0[1] + off); g.quadraticCurveTo(P1[0], P1[1] + off, P2[0], P2[1] + off);
        g.lineWidth = bw + (i === 0 || i === n - 1 ? 3 : 0); g.strokeStyle = (i === 0 || i === n - 1) ? OUT : cols[i]; g.stroke();
      }
      for (let i = 0; i < n; i++) { const off = (i - (n - 1) / 2) * bw; g.beginPath(); g.moveTo(P0[0], P0[1] + off); g.quadraticCurveTo(P1[0], P1[1] + off, P2[0], P2[1] + off); g.lineWidth = bw * .92; g.strokeStyle = cols[i]; g.stroke(); }
      g.globalAlpha = .35; g.beginPath(); g.moveTo(P0[0], P0[1] - bw * 2.3); g.quadraticCurveTo(P1[0], P1[1] - bw * 2.3, P2[0], P2[1] - bw * 2.3); g.lineWidth = bw * .4; g.strokeStyle = '#fff'; g.stroke(); g.globalAlpha = 1;
    } else {
      const N = id === 'dust' ? 9 : 11;
      for (let i = 0; i < N; i++) {
        const t = .06 + i / (N - 1) * .86, p = at(t), s = base * (.04 + t * .085);
        const col = cols[i % cols.length], j = hashStr(id + i) - .5;
        const x = p[0] + j * base * .06, y = p[1] + (hashStr(i + id) - .5) * base * .1;
        g.globalAlpha = .35 + t * .65;
        if (id === 'dust') {
          g.beginPath(); g.arc(x, y, s * 1.15, 0, TAU); g.fillStyle = rg(g, x - s * .3, y - s * .4, s * .1, x, y, s * 1.15, [0, '#ffffff', .7, col, 1, 'rgba(200,180,160,.6)']); g.fill();
        } else if (id === 'fire') {
          g.save(); g.translate(x, y); g.rotate(-.9 + j);
          g.beginPath(); g.moveTo(0, -s * 1.7); g.bezierCurveTo(s * 1.1, -s * .4, s * 1.1, s * .9, 0, s); g.bezierCurveTo(-s * 1.1, s * .9, -s * 1.1, -s * .4, 0, -s * 1.7); g.closePath();
          g.lineWidth = 2.4; g.strokeStyle = '#5a0a00'; g.stroke(); g.fillStyle = lg(g, 0, -s * 1.7, 0, s, [0, '#ffe14d', .5, '#ffb020', 1, '#ff4d1a']); g.fill();
          g.beginPath(); g.ellipse(0, s * .3, s * .38, s * .55, 0, 0, TAU); g.fillStyle = '#fff3a0'; g.fill();
          g.restore();
        } else if (id === 'stars') {
          starP(g, x, y, s * 1.25, s * .55, j * 2); g.lineWidth = 2.4; g.strokeStyle = '#6a4200'; g.stroke(); g.fillStyle = lg(g, 0, y - s, 0, y + s, [0, '#fff6b0', 1, col]); g.fill();
        } else if (id === 'hearts') {
          heartPath(g, x, y, s * 1.1); g.lineWidth = 2.4; g.strokeStyle = '#6a0a24'; g.stroke(); g.fillStyle = lg(g, 0, y - s, 0, y + s, [0, '#ffc2d0', 1, col]); g.fill();
        } else if (id === 'spades') {
          withSpade(g, x, y, s * 2.3, j, (pp, k) => { g.lineWidth = 2.4 / k; g.strokeStyle = col === '#111111' ? '#e0243a' : OUT; g.stroke(pp); g.fillStyle = col; g.fill(pp); });
        } else {
          g.beginPath(); g.arc(x, y, s, 0, TAU); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
    // koşan karakter (portre topu)
    const R = FM.R, id2 = sv().selChar || 'TAFTAF';
    const r = base * .2, hx = P2[0] + r * .55, hy = P2[1] - r * .25;
    g.beginPath(); g.arc(hx, hy, r + 2.5, 0, TAU); g.fillStyle = OUT; g.fill();
    if (R && typeof R.portrait === 'function') {
      try { const pc = R.portrait(id2, Math.round(r * 2 * f.d), { bg: chBg(id2), ring: false }); g.drawImage(pc, hx - r, hy - r, r * 2, r * 2); } catch (e) { /* portre yok */ }
    } else { g.beginPath(); g.arc(hx, hy, r, 0, TAU); g.fillStyle = chBg(id2); g.fill(); }
    if (id === 'none') {
      g.beginPath(); g.arc(W * .38, H * .56, base * .16, 0, TAU); g.lineWidth = base * .045; g.strokeStyle = '#ff4d5e'; g.stroke();
      g.beginPath(); g.moveTo(W * .38 - base * .11, H * .56 + base * .11); g.lineTo(W * .38 + base * .11, H * .56 - base * .11); g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* =====================================================================
     5) KARAKTER VİTRİNİ (canlı tuval; yalnızca görünürken çizilir)
     ===================================================================== */
  const shows = [];
  let showRaf = 0, showLast = 0;
  function attachShowcase(cv) {
    const at = n => cv.getAttribute(n) || '';
    const sc = { cv, g: cv.getContext('2d'), id: at('data-showcase') || 'TAFTAF', skin: at('data-skin') || 'klasik', cheer: +(at('data-cheer') || 0), zoom: clamp(+(at('data-zoom') || 1) || 1, .6, 1.5), hop: 0, chk: 0, cw: 0, ch: 0, t0: nowMs() / 1000,
      // Mağaza 2.0 canlı önizleme: şapka, plaka (takma adla), iz, kutlama, ölüm efekti
      hat: at('data-hat'), plate: at('data-plate'), nick: at('data-nick'), trail: at('data-trail'), win: at('data-win'), death: at('data-death'), parts: [], acc: 0, dieT: 0, died: false };
    cv.addEventListener('pointerdown', () => { if (sc.trail || sc.win || sc.death) return; sc.cheer = 1.6; sc.hop = 1; click(); });
    shows.push(sc);
    startShowLoop();
  }
  /* ---- önizleme parçacıkları (yalnızca mağaza/vitrin tuvalinde; render-chars glifleriyle) ---- */
  const PV_MAX = 48;
  function pvPush(sc, p) { if (sc.parts.length >= PV_MAX) sc.parts.shift(); p.max = p.life; sc.parts.push(p); }
  function fxOf(type, id) { const it = cosItem(type, id); return it && it.fx && it.fx.k ? it.fx : null; }
  function trailOf(id) { const it = cosItem('trails', id); return it && it.k && id !== 'none' ? { k: it.k, cols: it.colors && it.colors.length ? it.colors : ['#ffffff'] } : null; }
  const GLYPH_OF = { puff: 'puff', heart: 'heart', leaf: 'leaf', flame: 'flame', ice: 'ice', bubble: 'bubble', star: 'star', note: 'note', bolt: 'bolt', pixel: 'pixel', spade: 'spade', galaxy: 'galaxy', coin: 'coin', conf: 'conf', firework: 'star', twinkle: 'twinkle', ghost: 'ghost', vortex: 'star' };
  function pvTrail(sc, cx, fy, s, tr) {
    const c = tr.cols[(Math.random() * tr.cols.length) | 0], k = GLYPH_OF[tr.k] || 'dot';
    if (tr.k === 'ribbon') return;
    const up = tr.k === 'puff' ? 0 : 20 * s;
    pvPush(sc, { k, x: cx - 10 * s + (Math.random() - .5) * 8 * s, y: fy - up - Math.random() * 14 * s, vx: -(50 + Math.random() * 40) * s, vy: (tr.k === 'puff' ? -20 : tr.k === 'heart' || tr.k === 'bubble' || tr.k === 'note' ? -40 : -10) * s + (Math.random() - .5) * 30 * s, g: (tr.k === 'leaf' || tr.k === 'coin' || tr.k === 'pixel' ? 120 : tr.k === 'ice' ? 40 : 0) * s, life: .7 + Math.random() * .4, c, s: (tr.k === 'puff' ? 7 : 4.5) * s * (.8 + Math.random() * .5), rot: Math.random() * 6, vr: (Math.random() - .5) * 6 });
  }
  function pvBurst(sc, cx, cy, s, fx, kind) {
    const cols = fx.cols || ['#ffffff'], k = GLYPH_OF[fx.k] || 'star', n = kind === 'death' ? 16 : 14;
    const vortex = fx.k === 'vortex', ghost = fx.k === 'ghost';
    if (ghost) { pvPush(sc, { k: 'ghost', x: cx, y: cy, vx: 0, vy: -45 * s, g: 0, life: 1.4, c: cols[0], s: 11 * s, rot: 0, vr: 0, wob: 1 }); return; }
    if (fx.k === 'firework') { const bx = cx + (Math.random() - .5) * 60 * s, by = cy - 50 * s - Math.random() * 30 * s; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, v = (60 + Math.random() * 60) * s; pvPush(sc, { k: i % 2 ? 'star' : 'twinkle', x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 90 * s, life: .6 + Math.random() * .4, c: cols[i % cols.length], s: 3.6 * s, rot: a, vr: 3 }); } return; }
    for (let i = 0; i < n; i++) {
      const a = vortex ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - .5) * (fx.k === 'conf' ? 1.6 : 2.6), v = (vortex ? 0 : 70 + Math.random() * 110) * s;
      const d = vortex ? (40 + Math.random() * 30) * s : 0, life = .55 + Math.random() * .5;
      pvPush(sc, { k, x: cx + Math.cos(a) * d + (Math.random() - .5) * 20 * s, y: cy + Math.sin(a) * d, vx: vortex ? -Math.cos(a) * d / life : Math.cos(a) * v, vy: vortex ? -Math.sin(a) * d / life : Math.sin(a) * v, g: (vortex ? 0 : fx.k === 'heart' || fx.k === 'note' || fx.k === 'bubble' || fx.k === 'flame' ? -40 : 160) * s, life, c: cols[i % cols.length], s: (fx.k === 'puff' ? 7 : fx.k === 'twinkle' ? 6 : 4) * s * (.8 + Math.random() * .5), rot: Math.random() * 6, vr: (Math.random() - .5) * 8 });
    }
  }
  function pvDraw(sc, g, dt) {
    const R = FM.R, L = sc.parts;
    if (!L.length) return;
    const glyph = R && typeof R.glyph === 'function' ? R.glyph : null;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt; if (p.life <= 0) { L.splice(i, 1); continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.life / p.max, a = Math.min(1, p.life / .3) * Math.min(1, (p.max - p.life) / .08 + .2);
      g.globalAlpha = Math.max(0, Math.min(1, a));
      const sz = p.k === 'ghost' ? p.s * (1 + (1 - k) * .3) : p.s * (p.k === 'puff' ? 1 + (1 - k) * .6 : (.55 + .45 * k));
      const x = p.wob ? p.x + Math.sin((p.max - p.life) * 5) * 6 : p.x;
      if (glyph) glyph(g, p.k, x, p.y, sz, p.c, p.k === 'ghost' ? Math.sin((p.max - p.life) * 3) * .15 : p.rot);
      else { g.fillStyle = p.c; g.beginPath(); g.arc(x, p.y, sz * .6, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  function stopShowcases() { shows.length = 0; }
  function startShowLoop() {
    if (showRaf || !shows.length) return;
    showLast = nowMs();
    showRaf = requestAnimationFrame(showLoop);
  }
  function showLoop(ts) {
    showRaf = 0;
    if (!shows.length || document.hidden) return;
    const t = ts / 1000, dt = clamp((ts - showLast) / 1000, 0, .1); showLast = ts;
    for (let i = shows.length - 1; i >= 0; i--) {
      const sc = shows[i];
      if (!sc.cv.isConnected) { shows.splice(i, 1); continue; }
      try { drawShow(sc, t, dt); } catch (e) { if (!drawShow.err) { drawShow.err = 1; console.error('[ui vitrin]', e); } }
    }
    if (shows.length) showRaf = requestAnimationFrame(showLoop);
  }
  function drawShow(sc, t, dt) {
    const cv = sc.cv;
    if (--sc.chk <= 0) {
      sc.chk = 40;
      const f = fitCanvas(cv);
      if (!f) { sc.cw = 0; return; }
      sc.cw = f.cw; sc.ch = f.ch; sc.d = f.d;
    }
    if (!sc.cw) return;
    const g = sc.g, W = sc.cw, H = sc.ch, d = sc.d;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(d, 0, 0, d, 0, 0);
    g.drawImage(pedestal(Math.round(W), Math.round(H), d), 0, 0, W, H);
    const cx = W / 2, footY = H * .82;
    const scale = Math.min(H * .52 / 70, W * .52 / 48) * (sc.zoom || 1);
    if (sc.hop > 0) sc.hop = Math.max(0, sc.hop - dt * 2.6);
    const hopY = sc.hop > 0 ? -Math.sin((1 - sc.hop) * Math.PI) * H * .09 : 0;
    // gölge
    const sk = 1 - Math.min(.5, -hopY / (H * .2));
    const R = FM.R;
    // Mağaza 2.0 önizleme modları: iz (koşar), kutlama (poz + parçacık), ölüm efekti (puf döngüsü)
    let pose, hidden = false;
    const tr = sc.trail ? trailOf(sc.trail) : null, wfx = sc.win ? fxOf('wins', sc.win) : null, dfx = sc.death ? fxOf('deaths', sc.death) : null;
    const bodyY = footY + hopY - 28 * scale;
    if (dfx) {
      sc.dieT += dt; if (sc.dieT >= 3) { sc.dieT = 0; sc.died = false; }
      if (sc.dieT >= 1.7 && !sc.died) { sc.died = true; pvBurst(sc, cx, bodyY, scale, dfx, 'death'); }
      hidden = sc.dieT >= 1.7 && sc.dieT < 2.55;
      pose = sc.dieT >= 1.45 && sc.dieT < 1.7 ? { st: 'stun', t, ph: t * 2, expr: 'o' } : { st: 'idle', t, ph: t * 2 };
    } else if (wfx || sc.win) {
      const it = cosItem('wins', sc.win), ps = it && it.pose ? it.pose : 'cheer';
      pose = { st: ps, t, ph: t * 7 };
      sc.acc += dt;
      if (wfx && sc.acc > (wfx.k === 'firework' ? .6 : .85)) { sc.acc = 0; pvBurst(sc, cx, footY + hopY - 40 * scale, scale, wfx, 'win'); }
    } else if (sc.trail) {
      pose = { st: 'run', t, ph: t * 9, speed: 1.1 };
      if (tr) { sc.acc += dt * (tr.k === 'flame' ? 22 : tr.k === 'puff' ? 10 : 7); while (sc.acc >= 1) { sc.acc -= 1; pvTrail(sc, cx, footY, scale, tr); } }
    } else if (sc.cheer > 0) { sc.cheer -= dt; pose = { st: 'cheer', t, ph: t * 7, expr: 'h' }; }
    else pose = { st: 'idle', t, ph: t * 2 };
    if (!hidden) { g.fillStyle = 'rgba(10,0,30,.45)'; g.beginPath(); g.ellipse(cx, footY, 20 * scale * sk, 5 * scale * sk, 0, 0, TAU); g.fill(); }
    // gökkuşağı kurdelesi (iz önizlemesi): karakterin arkasında
    if (tr && tr.k === 'ribbon' && R && typeof R.glyph === 'function') {
      const n = tr.cols.length, bw = 3.2 * scale;
      for (let i = 0; i < n; i++) { g.lineWidth = bw; g.lineCap = 'round'; g.strokeStyle = tr.cols[i]; g.beginPath(); const oy = (i - n / 2) * bw; g.moveTo(cx - 12 * scale, footY - 22 * scale + oy); g.quadraticCurveTo(cx - 60 * scale, footY - 30 * scale + oy + Math.sin(t * 6) * 8 * scale, cx - 110 * scale, footY - 10 * scale + oy + Math.sin(t * 6 + 1) * 10 * scale); g.stroke(); }
    }
    if (sc.trail || dfx) pvDraw(sc, g, dt);      // iz/ölüm parçacıkları karakterin arkasında
    if (!hidden) {
      if (R && typeof R.drawCharacter === 'function') {
        R.drawCharacter(g, sc.id, cx, footY + hopY, scale, pose, { skin: sc.skin, hat: sc.hat || null });
      } else if (R && typeof R.portrait === 'function') {
        const s = Math.min(W, H) * .55; g.drawImage(R.portrait(sc.id, Math.round(s * d), { bg: chBg(sc.id) }), cx - s / 2, footY - s * 1.05, s, s);
      }
    }
    if (!sc.trail && !dfx) pvDraw(sc, g, dt);    // kutlama parçacıkları karakterin önünde
    // isim plakası (oyuncunun TAKMA ADIYLA), kafanın üstünde; yüksek şapkalarda yukarı kayar
    if (sc.plate && !hidden && R && typeof R.drawPlate === 'function') {
      let up = 0;
      try { const hi = sc.hat && typeof R.hatInfo === 'function' ? R.hatInfo(sc.hat) : null; if (hi && hi.slot === 'head') up = Math.max(0, (hi.up || 0) - 8); } catch (e) { up = 0; }
      const flipUp = pose.st === 'flip' ? 24 * scale : 0;
      const ps = scale * .62, py = Math.max(20 * ps + 6, footY + hopY - (70 + up) * scale - flipUp + Math.sin(t * 2.2) * 1.5);   // sahnenin üstünden taşmasın
      try { R.drawPlate(g, sc.plate, sc.nick || 'Sen', cx, py, ps, true); } catch (e) { /* plaka çizilemedi */ }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) startShowLoop(); });

  /** Yerleşimden sonra tuval sanatlarını çiz ve vitrinleri bağla */
  function mountArt(el) {
    for (const cv of $$('canvas[data-art]', el)) {
      const a = cv.getAttribute('data-art');
      try {
        if (a === 'logo') drawLogo(cv);
        else if (a === 'flag') drawFlag(cv);
        else if (a === 'trail') drawTrail(cv, cv.getAttribute('data-id'));
        else if (a === 'cos') drawCosIcon(cv);
      } catch (e) { console.error('[ui sanat ' + a + ']', e); }
    }
    for (const cv of $$('canvas[data-showcase]', el)) attachShowcase(cv);
  }
  /** Mağaza kartı ikonu (render-chars önbellekli kozmetik ikonu) */
  function drawCosIcon(cv) {
    const R = FM.R, f = fitCanvas(cv); if (!f) return;
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, f.w, f.h);
    if (!R || typeof R.cosmeticIcon !== 'function') return;
    const px = Math.round(clamp(Math.min(f.w, f.h), 24, 320) / 8) * 8;
    const ic = R.cosmeticIcon(cv.getAttribute('data-type'), cv.getAttribute('data-id'), px, { nick: myNick(), char: cv.getAttribute('data-ch') || selChar() });
    if (ic) g.drawImage(ic, (f.w - Math.min(f.w, f.h)) / 2, (f.h - Math.min(f.w, f.h)) / 2, Math.min(f.w, f.h), Math.min(f.w, f.h));
  }
  function redrawArt() {
    for (const cv of $$('canvas[data-art]')) {
      const a = cv.getAttribute('data-art');
      try { if (a === 'logo') drawLogo(cv); else if (a === 'flag') drawFlag(cv); else if (a === 'trail') drawTrail(cv, cv.getAttribute('data-id')); else if (a === 'cos') drawCosIcon(cv); } catch (e) { /* yok say */ }
    }
    for (const sc of shows) sc.chk = 0;
  }
  try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => setTimeout(redrawArt, 30)); } catch (e) { /* yok say */ }

  /* =====================================================================
     6) KATMANLAR VE DURUM
     ===================================================================== */
  root.innerHTML = '';
  root.classList.add('fm-ui');
  // ortak SVG gradyanları (ikonlar url(#...) ile kullanır)
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('class', 'fm-defs'); defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true');
  defs.innerHTML =
    '<defs>' +
    '<linearGradient id="fmGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6b8"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#e88a00"/></linearGradient>' +
    '<linearGradient id="fmSilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#d9e2ee"/><stop offset="1" stop-color="#8a97ad"/></linearGradient>' +
    '<linearGradient id="fmBronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe0c0"/><stop offset=".5" stop-color="#e8954e"/><stop offset="1" stop-color="#9a4f16"/></linearGradient>' +
    '<linearGradient id="fmRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a88"/><stop offset=".5" stop-color="#e0243a"/><stop offset="1" stop-color="#8a0a20"/></linearGradient>' +
    '<linearGradient id="fmPurple" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b8ff"/><stop offset=".5" stop-color="#9b5cff"/><stop offset="1" stop-color="#5a24c0"/></linearGradient>' +
    '<linearGradient id="fmCyan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e0fbff"/><stop offset=".5" stop-color="#5ee0ff"/><stop offset="1" stop-color="#1f8fd6"/></linearGradient>' +
    '</defs>';
  root.appendChild(defs);
  function layer(cls) { const d = document.createElement('div'); d.className = 'ly ' + cls; root.appendChild(d); return d; }
  const Ls = {
    scr: layer('ly-scr'),       // menü ekranları
    race: layer('ly-race'),     // duraklatma düğmesi + dokunmatik kontroller
    res: layer('ly-res'),       // tur sonucu paneli
    fin: layer('ly-fin'),       // final ekranı
    mdl: layer('ly-mdl'),       // modallar (duraklatma, onay, günlük ödül)
    notes: layer('ly-notes on'),// kayan bildirimler
    rot: layer('ly-rot')        // telefonu yan çevir
  };
  const st = {
    view: 'none', screen: null,
    tabs: { shop: 'vitrin', missions: 'daily', help: 'controls' }, shopSel: {},
    cview: null, modal: null, onOk: null, pausedByRot: false, dailyShown: false,
    lastMatch: { rounds: 3 }, flashKey: null, resData: null, quitArm: 0, lastCur: null, devForce: false,
    mpEmo: {}, mpCode: '', fakeLobby: null, nickThen: null, mpRaced: false, imp: null,
    cd: null, lbTab: 'set', bestT: {}, fakeNet: null, hintShown: false, rejoining: false
  };
  function showLayer(name, on) { Ls[name].classList.toggle('on', !!on); }
  function selChar() { const s = sv(); return FM.CH[s.selChar] ? s.selChar : 'TAFTAF'; }
  function roundsSel() { const r = +sv().rounds; return [1, 3, 5].indexOf(r) >= 0 ? r : 3; }

  /* =====================================================================
     7) ORTAK PARÇALAR: kurdele başlık, panel, sekmeler, rozetler, çubuklar
     ===================================================================== */
  function ribbon(txt, cls) {
    const tail = side => '<svg class="rb-tail rb-' + side + '" viewBox="0 0 44 40" preserveAspectRatio="none" aria-hidden="true"><path class="rb-tp" d="M29.5 1H2l9 19.5L2 39h27.5z"/><path class="rb-fold" d="M29.5 28.6H44L29.5 39z"/></svg>';
    return '<div class="ribbon ' + (cls || '') + '">' + tail('l') + '<span class="rb-band"><span class="rb-t">' + txt + '</span></span>' + tail('r') + '</div>';
  }
  function panel(title, inner, cls, rcls) {
    return '<div class="body"><div class="pnl ' + (cls || '') + '">' + ribbon(title, rcls) + '<div class="pnl-in">' + inner + '</div></div></div>';
  }
  function tabsBar(scr, list, cur, extra) {
    let h = '<div class="tabs" role="tablist">';
    for (const t of list) {
      h += '<button class="tab ' + (t[0] === cur ? 'on' : '') + '" role="tab" data-act="tab" data-s="' + scr + '" data-t="' + t[0] + '">' +
        (t[2] ? svg(t[2]) : '') + '<span>' + t[1] + '</span>' + (t[3] ? '<i class="badge sm">' + t[3] + '</i>' : '') + '</button>';
    }
    return h + (extra || '') + '</div>';
  }
  const ROLE_CLS = { 'Lider': 'rl-lead', 'Görevli': 'rl-off', 'Üye Alım Görevlisi': 'rl-rec', 'Üye': 'rl-mem' };
  function roleBadge(role) {
    role = role || 'Üye';
    const c = ROLE_CLS[role] || 'rl-mem';
    return '<span class="role ' + c + '">' + (c === 'rl-lead' ? svg('crown') : c === 'rl-off' ? svg('star') : c === 'rl-rec' ? svg('users') : svg('spade')) + '<span>' + esc(role) + '</span></span>';
  }
  function pips(lv, max) {
    let h = '<span class="pips">';
    for (let i = 0; i < max; i++) h += '<i class="' + (i < lv ? 'on' : '') + '"></i>';
    return h + '</span>';
  }
  function priceBtn(act, attrs, p, extraCls) {
    const ok = canAfford(p);
    return '<button class="btn sm b-green buy ' + (ok ? '' : 'poor ') + (extraCls || '') + '" data-act="' + act + '" ' + attrs + '>' +
      (p.cur === 'gems' ? gemI(28, 'bi') : coinI(28, 'bi')) + '<b>' + fmtN(p.n) + '</b></button>';
  }
  function emptyBox(icon, title, text) {
    return '<div class="empty"><span class="em-ic">' + svg(icon || 'info') + '</span><b>' + title + '</b>' + (text ? '<span>' + text + '</span>' : '') + '</div>';
  }
  function placeBadge(n) {
    const cls = n === 1 ? 'pb-1' : n === 2 ? 'pb-2' : n === 3 ? 'pb-3' : 'pb-n';
    return '<span class="pbadge ' + cls + '"><b>' + n + '</b></span>';
  }

  /* =====================================================================
     8) ÜST ÇUBUK
     ===================================================================== */
  function topbar(sub) {
    const li = levelInfo(), dr = dailyReady();
    return '<header class="tb">' +
      (sub ? '<button class="rbtn b-purple tb-back" data-act="back" aria-label="Geri" title="Geri (Esc)">' + svg('back') + '</button>' : '') +
      '<div class="tb-lv" title="Seviye ' + li.level + '">' +
        '<span class="lv-badge">' + svg('star', 'gold') + '<b>' + li.level + '</b></span>' +
        '<span class="lv-info"><span class="lv-top"><span class="lv-t">SEVİYE ' + li.level + '</span><span class="lv-x">' + fmtN(li.xp) + ' / ' + fmtN(li.need) + ' XP</span></span>' +
        '<span class="bar bar-xp"><i style="width:' + li.pct.toFixed(1) + '%"></i></span></span>' +
      '</div>' +
      '<div class="cur cur-coin" data-cur="coins" title="Altın">' + coinI(48, 'cur-ic') + '<b>' + fmtN(coins()) + '</b></div>' +
      '<div class="cur cur-gem" data-cur="gems" title="Elmas">' + gemI(48, 'cur-ic') + '<b>' + fmtN(gems()) + '</b></div>' +
      '<div class="tb-sp"></div>' +
      (!sub && st.screen === 'menu' ? onlinePillHtml() : '') +
      (dr ? '<button class="rbtn b-red tb-gift" data-act="daily" aria-label="Günlük ödül" title="Günlük ödül hazır!">' + svg('gift') + '<i class="dot"></i></button>' : '') +
      (sub ? '' : fsOK() ? '<button class="rbtn b-steel tb-full" data-act="full" aria-label="Tam ekran" title="Tam ekran">' + svg('full') + '</button>'
        : iosTab() ? '<button class="rbtn b-gold tb-full tb-iosfull" data-act="iosfull" aria-label="Tam ekran" title="Tam ekran">' + svg('full') + '</button>' : '') +
      (st.screen === 'settings' ? '' : '<button class="rbtn b-steel tb-set" data-act="go" data-to="settings" aria-label="Ayarlar" title="Ayarlar">' + svg('gear') + '</button>') +
    '</header>';
  }

  /* =====================================================================
     9) ANA MENÜ
     ===================================================================== */
  function showcaseBlock(id, skin) {
    const ch = FM.CH[id] || {};
    return '<div class="show">' +
      '<div class="sh-stage">' +
        '<div class="sh-rays"></div><div class="sh-glow"></div>' +
        '<canvas class="sh-cv" data-showcase="' + esc(id) + '" data-skin="' + esc(skin) + '" data-hat="' + esc(equipped('hats', id)) + '" data-cheer="1.1" aria-label="' + esc(id) + '"></canvas>' +
        '<button class="rbtn b-dark sh-arr sh-al" data-act="cyc" data-d="-1" aria-label="Önceki karakter">' + svg('chevL') + '</button>' +
        '<button class="rbtn b-dark sh-arr sh-ar" data-act="cyc" data-d="1" aria-label="Sonraki karakter">' + svg('chevR') + '</button>' +
        '<div class="sh-tr" title="Kupa">' + trophyI(48, 'sh-tri') + '<b>' + fmtN(trophies(id)) + '</b></div>' +
      '</div>' +
      '<div class="sh-info">' +
        '<div class="sh-name">' + esc(id) + '</div>' +
        '<div class="sh-meta">' + roleBadge(ch.role) + '<span class="sh-sp">' + esc(ch.species || '') + '</span></div>' +
        '<div class="sh-ab"><span class="ab-ic">' + svg('bolt') + '</span><span class="ab-n">' + esc(ch.ab || '') + '</span><span class="ab-lv">SV. ' + abLevel(id) + '</span></div>' +
      '</div>' +
    '</div>';
  }
  function renderMenu() {
    const id = selChar(), skin = equipped('skins', id), rounds = roundsSel();
    const cl = mcall('claimable');
    const badge = typeof cl === 'number' ? cl : claimable() + (dailyReady() ? 1 : 0);
    const tiles = [
      ['chars', 'Karakterler', 'user', 'b-blue'], ['shop', 'Mağaza', 'bag', 'b-orange'], ['missions', 'Görevler', 'scroll', 'b-green', badge],
      ['clan', 'Klan', 'spade', 'b-red'], ['help', 'Nasıl Oynanır', 'help', 'b-purple'], ['settings', 'Ayarlar', 'gear', 'b-steel']
    ];
    let th = '';
    tiles.forEach((t, i) => {
      th += '<button class="btn tile ' + t[3] + '" data-act="go" data-to="' + t[0] + '" style="--d:' + (.18 + i * .05).toFixed(2) + 's">' +
        '<span class="t-ic">' + svg(t[2]) + '</span><span class="t-lb">' + t[1] + '</span>' + (t[4] ? '<i class="badge">' + t[4] + '</i>' : '') + '</button>';
    });
    void rounds;
    const inR = mpInRoom();
    const rj = !inR && !mpBusy() ? rejoinData() : null;
    return '<div class="mm">' +
      '<section class="mm-l">' +
        '<div class="logo-wrap"><canvas class="logo" data-art="logo" aria-label="Fuat Morel"></canvas></div>' +
        '<div class="play-row">' +
          '<span class="play-wrap"><span class="pl-glow"></span><button class="btn b-gold btn-play" data-act="play"><span class="shine"></span><span class="pl-ic">' + svg('play') + '</span><span class="pl-t">OYNA</span></button></span>' +
          (rj
            ? '<span class="rj-wrap"><button class="btn b-green btn-friends rj" data-act="rejoin"><span class="bf-ic">' + svg('door') + '</span><span class="bf-t"><b>ODAYA GERİ DÖN</b><em>' + esc(rj.code) + ' · ' + ((+rj.mins || 0) < 1 ? 'az önce' : Math.round(+rj.mins) + ' dk önce') + '</em></span></button>' +
              '<button class="rbtn b-steel rj-x" data-act="rejoinx" aria-label="Odayı unut" title="Odayı unut">' + svg('close') + '</button></span>'
            : '<button class="btn b-green btn-friends' + (!inR && friendsBtnSub().indexOf('açık oda') > 0 ? ' has-rooms' : '') + '" data-act="' + (inR ? 'golobby' : 'go') + '" data-to="friends"><span class="bf-ic">' + svg('users') + '</span><span class="bf-t"><b>ARKADAŞLARLA</b><em>' + (inR ? 'Odaya dön' : friendsBtnSub()) + '</em></span></button>') +
        '</div>' +
        '<nav class="tiles">' + th + '</nav>' +
      '</section>' +
      '<section class="mm-r">' + showcaseBlock(id, skin) + '</section>' +
      (touchMode ? '' : '<div class="mm-hint"><kbd>Enter</kbd> oyna · <kbd>Esc</kbd> geri</div>') +
    '</div>';
  }

  /* =====================================================================
     10) KARAKTERLER
     ===================================================================== */
  const STATS = [['Hız', 'bolt'], ['Zıplama', 'up'], ['Güç Dolumu', 'sparkle']];
  function upgRow(u, ch) {
    const max = Math.max(1, +u.max || 1), lv = clamp(+u.lv || 0, 0, max), p = priceOf(u);
    const curTxt = (u.cur && u.cur !== 'coins' && u.cur !== 'gems') ? '<em class="u-cur">' + esc(u.cur) + '</em>' : '';
    return '<div class="ur" data-k="up:' + esc(u.key) + '">' +
      '<span class="ur-ic">' + anyIcon(u.icon, 40) + '</span>' +
      '<span class="ur-m"><b>' + esc(u.n || u.key) + '</b>' + curTxt + '<span class="ur-d">' + esc(u.desc || '') + '</span>' + pips(lv, max) + '</span>' +
      (lv >= max ? '<span class="maxed">MAKS</span>' : priceBtn('upg', 'data-key="' + esc(u.key) + '" data-ch="' + esc(ch) + '"', p)) +
    '</div>';
  }
  function renderChars() {
    const sel = selChar();
    const v = FM.CH[st.cview] ? st.cview : sel; st.cview = v;
    const ch = FM.CH[v] || {};
    const skinEq = equipped('skins', v);
    let cards = '';
    FM.ORDER.forEach((id, i) => {
      const c = FM.CH[id] || {};
      cards += '<button class="cc ' + (id === sel ? 'is-sel ' : '') + (id === v ? 'is-view' : '') + '" data-act="cview" data-id="' + esc(id) + '" data-k="cc:' + esc(id) + '" style="--d:' + (i * .035).toFixed(3) + 's;--cc:' + esc(c.col2 || '#5b2a86') + '">' +
        '<span class="cc-pt">' + pt(id, 112, { skin: equipped('skins', id), hat: equipped('hats', id) }) + '</span>' +
        '<span class="cc-n">' + esc(id) + '</span>' +
        '<span class="cc-tr">' + trophyI(24, 'cc-tri') + '<b>' + fmtN(trophies(id)) + '</b></span>' +
        (id === sel ? '<span class="cc-tag">' + svg('check') + 'SEÇİLİ</span>' : '') +
      '</button>';
    });
    // özel güç geliştirmeleri
    const ups = upgrades(v);
    let upH = '', footUp = '';
    if (ups === null) upH = '<div class="ab-lvl"><span>Güç seviyesi</span>' + pips(abLevel(v), 5) + '<b>SV. ' + abLevel(v) + '</b></div>';
    else {
      const cu = ups.filter(u => u.scope === 'char');
      upH = cu.length ? cu.map(u => upgRow(u, v)).join('') : '<div class="ab-lvl"><span>Güç seviyesi</span>' + pips(abLevel(v), 5) + '<b>SV. ' + abLevel(v) + '</b></div>';
      // kısa ekranda (telefon) güç yükseltmesi alt çubukta, SEÇ düğmesinin yanında da görünür (kaydırmadan)
      const fu = cu[0];
      if (fu) {
        const fmax = Math.max(1, +fu.max || 1), flv = clamp(+fu.lv || 0, 0, fmax), fp = priceOf(fu);
        footUp = flv >= fmax
          ? '<span class="maxed foot-up">' + svg('bolt') + ' GÜÇ MAKS</span>'
          : '<button class="btn b-green buy foot-up ' + (canAfford(fp) ? '' : 'poor') + '" data-act="upg" data-key="' + esc(fu.key) + '" data-ch="' + esc(v) + '" title="' + esc(fu.n || 'Özel güç') + '">' +
            svg('bolt', 'fu-ic') + '<span class="fu-t">GÜÇ SV.' + (flv + 1) + '</span>' + (fp.cur === 'gems' ? gemI(28, 'bi') : coinI(28, 'bi')) + '<b>' + fmtN(fp.n) + '</b></button>';
      }
    }
    // görünümler
    let sk = '';
    for (const s of cosList('skins')) {
      const own = owns('skins', s.id, v), eq = skinEq === s.id;
      sk += '<button class="sk ' + (eq ? 'eq ' : '') + (own ? 'own' : '') + '" data-act="skin" data-id="' + esc(s.id) + '" data-ch="' + esc(v) + '" data-k="sk:' + esc(s.id) + '" title="' + esc(s.n) + '">' +
        '<span class="sk-pt">' + pt(v, 80, { skin: s.id }) + '</span>' +
        '<span class="sk-n">' + esc(s.n) + '</span>' +
        (eq ? '<span class="sk-s s-eq">' + svg('check') + '</span>' : own ? '<span class="sk-s s-own">KUŞAN</span>' : '<span class="sk-s s-pr">' + curIcon(cosCur('skins', s.id), 20, 'bi') + fmtN(s.price) + '</span>') +
      '</button>';
    }
    let stats = '';
    STATS.forEach((s, i) => { stats += '<div class="stt"><span class="st-ic">' + svg(s[1]) + '</span><span class="st-l">' + s[0] + '</span><span class="bar bar-st" style="--d:' + (.2 + i * .1) + 's"><i></i></span><b>10</b></div>'; });
    const det =
      '<div class="cd-head">' +
        '<div class="cd-stage"><div class="sh-rays sm"></div><canvas class="cd-cv" data-showcase="' + esc(v) + '" data-skin="' + esc(skinEq) + '" data-hat="' + esc(equipped('hats', v)) + '" data-zoom="1.2" data-cheer="' + (st.cheerNext ? 1.4 : 0) + '"></canvas></div>' +
        '<div class="cd-id">' +
          '<div class="cd-name">' + esc(v) + '</div>' +
          '<div class="cd-meta">' + roleBadge(ch.role) + '<span class="cd-sp">' + esc(ch.species || '') + '</span></div>' +
          '<div class="cd-tr">' + trophyI(32, 'cd-tri') + '<b>' + fmtN(trophies(v)) + '</b><span>kupa</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="cd-sec cd-ab"><h4>' + svg('bolt') + 'ÖZEL GÜÇ</h4>' +
        '<div class="ab-box"><div class="ab-title">' + esc(ch.ab || '') + '</div><p>' + esc(ch.d || '') + '</p>' + upH + '</div></div>' +
      '<div class="cd-sec"><h4>' + svg('sparkle') + 'GÖRÜNÜMLER</h4><div class="skins">' + sk + '</div></div>' +
      '<div class="cd-sec"><h4>' + svg('star') + 'İSTATİSTİKLER <span class="eq-tag">HERKES EŞİT</span></h4><div class="stats">' + stats + '</div>' +
        '<p class="eq-note">Tüm karakterlerin hızı, zıplaması ve güç dolumu aynıdır. Fark yaratan; özel güç, görünüm ve senin becerin!</p></div>';
    st.cheerNext = false;
    return panel('KARAKTERLER',
      '<div class="ch-wrap">' +
        '<div class="ch-grid">' + cards + '</div>' +
        '<div class="ch-det">' +
          '<div class="cd-scroll scroll" data-sk="chars-det">' + det + '</div>' +
          '<div class="cd-foot">' + (v === sel
            ? '<div class="btn b-steel btn-sel is-static">' + svg('check') + '<span>SEÇİLİ</span></div>'
            : '<button class="btn b-green btn-sel" data-act="select" data-id="' + esc(v) + '">' + svg('check') + '<span>SEÇ</span></button>') +
            footUp +
          '</div>' +
        '</div>' +
      '</div>', 'pnl-chars');
  }

  /* =====================================================================
     11) MAĞAZA
     ===================================================================== */
  function cosState(type, id, ch, price) {
    const eq = equipped(type, ch) === id, own = owns(type, id, ch);
    if (eq) return '<span class="tag-eq">' + svg('check') + 'KUŞANILDI</span>';
    if (own) return '<button class="btn sm b-blue" data-act="equip" data-type="' + type + '" data-id="' + esc(id) + '" data-ch="' + esc(ch) + '">KUŞAN</button>';
    return priceBtn('buycos', 'data-type="' + type + '" data-id="' + esc(id) + '" data-ch="' + esc(ch) + '"', { cur: cosCur(type, id), n: price });
  }
  /** Kozmetiğin para birimi (elmaslı kozmetikler: meta.currency / COSMETICS.cur) */
  function cosCur(type, id) {
    const c = mcall('currency', type, id);
    if (c === 'gems' || c === 'coins') return c;
    const it = cosItem(type, id);
    return it && it.cur === 'gems' ? 'gems' : 'coins';
  }
  const curAmt = cur => (cur === 'gems' ? gems() : coins());
  const curIcon = (cur, css, cls) => (cur === 'gems' ? gemI(css, cls) : coinI(css, cls));
  /** Hazine paketleri için büyüyen altın yığını / sandık kompozisyonu */
  function packArt(i) {
    const c = k => coinI(64, 'pa-c pa-c' + k);
    if (i <= 0) return '<span class="pa pa0">' + c(1) + c(2) + c(3) + '</span>';
    if (i === 1) return '<span class="pa pa1"><i class="gi fb-svg c-wood pa-chest">' + svg('chest') + '</i>' + c(1) + c(2) + c(3) + '</span>';
    return '<span class="pa pa2"><i class="gi fb-svg c-wood pa-chest">' + svg('chest') + '</i>' + c(1) + c(2) + c(3) + c(4) + c(5) + gemI(64, 'pa-g') + '</span>';
  }
  /* ---------- Mağaza 2.0: sekmeler, nadirlik, kartlar, canlı önizleme, günün vitrini ---------- */
  const SHOP_TABS = [['vitrin', 'Vitrin', 'gift'], ['skins', 'Görünüm', 'user'], ['hats', 'Aksesuar', 'crown'], ['trails', 'İz', 'sparkle'], ['plates', 'Plaka', 'flag'], ['wins', 'Kutlama', 'trophy'], ['deaths', 'Ölüm Efekti', 'fire'], ['up', 'Geliştirme', 'bolt']];
  const COS_TABS = { vitrin: 1, skins: 1, hats: 1, trails: 1, plates: 1, wins: 1, deaths: 1 };
  const TYPE_ONE = { skins: 'Görünüm', hats: 'Aksesuar', trails: 'İz', plates: 'Plaka', wins: 'Kutlama', deaths: 'Ölüm Efekti' };
  function rarPill(v, cls) { return '<span class="rar rar-' + esc(v.rar) + ' ' + (cls || '') + '" style="--rc:' + esc(v.rarCol) + '">' + esc(v.rarN) + '</span>'; }
  function priceChip(v) {
    const ok = curAmt(v.cur) >= v.price;
    return '<span class="pchip ' + (ok ? '' : 'poor') + '">' + (v.off ? '<s>' + fmtN(v.base) + '</s>' : '') + curIcon(v.cur, 22, 'bi') + '<b>' + fmtN(v.price) + '</b></span>';
  }
  function cosCard(v, ch, sel, o) {
    o = o || {};
    const cls = 'it it-cos rar-' + esc(v.rar) + (v.equipped ? ' is-eq' : '') + (v.owned ? ' is-own' : '') + (sel ? ' is-sel' : '') + (o.feat ? ' it-feat' : '');
    return '<button class="' + cls + '" style="--rc:' + esc(v.rarCol) + ';--d:' + (o.d || 0) + 's" data-act="shopsel" data-type="' + esc(v.type) + '" data-id="' + esc(v.id) + '" data-k="cos:' + esc(v.type) + ':' + esc(v.id) + '" aria-label="' + esc(v.n) + '">' +
      (v.off ? '<i class="it-off">-%' + (+v.off || 0) + '</i>' : '') +
      (o.typeTag ? '<em class="it-type">' + esc(v.typeOne || '') + '</em>' : '') +
      '<span class="ic-wrap"><canvas data-art="cos" data-type="' + esc(v.type) + '" data-id="' + esc(v.id) + '" data-ch="' + esc(ch) + '"></canvas></span>' +
      '<span class="it-n">' + esc(v.n) + '</span>' +
      rarPill(v, 'sm') +
      '<span class="it-st">' + (v.equipped ? '<span class="tag-eq">' + svg('check') + 'KUŞANILDI</span>' : v.owned ? '<span class="tag-own">' + svg('check') + 'SAHİP</span>' : priceChip(v)) + '</span>' +
    '</button>';
  }
  function cosAction(v, ch) {
    const at = 'data-type="' + esc(v.type) + '" data-id="' + esc(v.id) + '" data-ch="' + esc(ch) + '"';
    if (v.equipped) return '<span class="tag-eq big">' + svg('check') + 'KUŞANILDI</span>';
    if (v.owned) return '<button class="btn b-blue" data-act="shopeq" ' + at + '>' + svg('check') + '<span>KUŞAN</span></button>';
    const ok = curAmt(v.cur) >= v.price;
    return '<button class="btn b-green buy ' + (ok ? '' : 'poor') + '" data-act="shopbuy" ' + at + '>' + (v.off ? '<s class="was">' + fmtN(v.base) + '</s>' : '') + curIcon(v.cur, 28, 'bi') + '<b>' + fmtN(v.price) + '</b></button>' +
      (ok ? '' : '<span class="shp-need">' + curIcon(v.cur, 18, 'bi') + '<span>' + fmtN(v.price - curAmt(v.cur)) + ' daha gerek</span></span>');
  }
  /** Sol pano: canlı önizleme tuvali (seçili karakter + seçili/kuşanılan süsler, plakada takma ad) + öğe bilgisi ve eylem */
  function shopPreview(tab, v, ch) {
    const type = v ? v.type : tab;
    const skin = type === 'skins' && v ? v.id : equipped('skins', ch), hat = type === 'hats' && v ? v.id : equipped('hats', ch), plate = type === 'plates' && v ? v.id : equipped('plates', ch);
    const trail = type === 'trails' && v ? v.id : '', win = type === 'wins' && v ? v.id : '', death = type === 'deaths' && v ? v.id : '';
    const attrs = ' data-skin="' + esc(skin) + '" data-hat="' + esc(hat) + '" data-plate="' + esc(plate) + '" data-nick="' + esc(myNick()) + '" data-trail="' + esc(trail) + '" data-win="' + esc(win) + '" data-death="' + esc(death) + '"';
    const info = !v ? '<div class="shp-info"><div class="shp-n">Mağaza</div><div class="shp-d">Bir ürüne dokun, üstünde dene.</div></div>' :
      '<div class="shp-info rar-' + esc(v.rar) + '" style="--rc:' + esc(v.rarCol) + '">' +
        '<div class="shp-top">' + rarPill(v) + '<span class="shp-type">' + esc(v.typeOne || '') + '</span>' + (v.off ? '<b class="shp-deal">BUGÜN -%' + (+v.off || 0) + '</b>' : '') + '</div>' +
        '<div class="shp-n">' + esc(v.n) + '</div>' +
        '<div class="shp-d">' + esc(v.d || '') + '</div>' +
        '<div class="shp-act">' + cosAction(v, ch) + '</div>' +
      '</div>';
    return '<div class="shp-pv"><div class="shp-stage"><div class="sh-rays sm"></div><canvas class="shp-cv" data-showcase="' + esc(ch) + '"' + attrs + ' data-zoom="1.05" aria-label="Önizleme"></canvas>' +
      '<button class="btn sm b-purple shp-ch" data-act="go" data-to="chars" title="Karakter değiştir">' + svg('user') + '<span>' + esc(ch) + '</span></button></div>' + info + '</div>';
  }
  function shopList(tab, ch) {
    if (tab === 'vitrin') {
      const d = mcall('dailyShop', ch);
      return { list: d && Array.isArray(d.items) ? d.items.filter(Boolean) : [], reset: d && typeof d.resetsIn === 'number' ? d.resetsIn / 1000 : secsToReset() };
    }
    let list = mcall('cosmetics', tab, ch);
    list = Array.isArray(list) ? list.filter(Boolean).map(x => Object.assign({ type: tab }, x)) : cosList(tab).map(x => cosView(tab, x.id, ch)).filter(Boolean);
    return { list, reset: 0 };
  }
  function shopSelection(tab, list) {
    const key = st.shopSel[tab];
    let v = key ? list.find(x => x.type + ':' + x.id === key) : null;
    if (!v) v = (tab === 'vitrin' ? null : list.find(x => x.equipped)) || list[0] || null;
    return v;
  }
  function renderShop() {
    const tab = st.tabs.shop, ch = selChar();
    const tabs = SHOP_TABS.slice();
    if (hasMeta('packs')) tabs.push(['packs', 'Hazine', 'chest']);
    let body = '', head = '';
    if (COS_TABS[tab]) {
      const L = shopList(tab, ch), list = L.list;
      for (const v of list) if (!v.typeOne) v.typeOne = TYPE_ONE[v.type] || '';
      const sel = shopSelection(tab, list);
      const cards = list.map((v, i) => cosCard(v, ch, !!sel && sel.id === v.id && sel.type === v.type, { feat: tab === 'vitrin' && i === 0, typeTag: tab === 'vitrin', d: (i * .035).toFixed(3) })).join('');
      const extra = tab === 'vitrin'
        ? '<div class="vit-head">' + svg('gift', 'vit-ic') + '<span class="vit-t">GÜNÜN VİTRİNİ</span><span class="vit-sub">Herkese aynı 6 ürün · biri indirimli</span><span class="vit-cd">' + svg('clock') + '<span>Yenilenir</span><b data-reset>' + fmtClock(L.reset) + '</b></span></div>'
        : tab === 'skins' ? '<div class="shop-head sh-cos">' + pt(ch, 40, { skin: equipped('skins', ch), hat: equipped('hats', ch) }, 'sh-mini') + '<span><b>' + esc(ch) + '</b> için görünümler</span><span class="sh-col">' + collectionTxt() + '</span></div>'
        : '<div class="shop-head sh-cos"><span>' + esc(TYPE_ONE[tab] || '') + ' seç, karakterinin üstünde canlı gör.</span><span class="sh-col">' + collectionTxt() + '</span></div>';
      body = '<div class="shp">' + shopPreview(tab, sel, ch) +
        '<div class="shp-list scroll" data-sk="shop-' + tab + '">' + extra + '<div class="sgrid sg-cos' + (tab === 'vitrin' ? ' sg-vit' : '') + '">' + (cards || emptyBox('bag', 'Burada henüz ürün yok', tab === 'vitrin' ? 'Yarın tekrar bak.' : '')) + '</div></div></div>';
      return panel('MAĞAZA', tabsBar('shop', tabs, tab) + body, 'pnl-shop', 'rb-gold');
    }
    if (tab === 'up') {
      const all = upgrades(ch);
      if (all === null) body = emptyBox('bolt', 'Geliştirmeler hazırlanıyor', 'Biraz sonra tekrar bak.');
      else {
        const list = all.filter(u => u.scope === 'char').concat(all.filter(u => u.scope !== 'char'));
        head = '<div class="shop-head">' + svg('info', 'sh-info-ic') + '<span>Geliştirmeler botlara da aynen yansır: yarış <b>her zaman adil</b>, fark senin becerin!</span></div>';
        if (!list.length) body = emptyBox('bolt', 'Henüz geliştirme yok');
        else list.forEach((u, i) => {
          const max = Math.max(1, +u.max || 1), lv = clamp(+u.lv || 0, 0, max), p = priceOf(u);
          const curTxt = (u.cur && u.cur !== 'coins' && u.cur !== 'gems') ? '<em class="u-cur">' + esc(u.cur) + '</em>' : '';
          body += '<div class="it it-up ' + (lv >= max ? 'is-max' : '') + '" data-k="up:' + esc(u.key) + '" style="--d:' + (i * .04).toFixed(2) + 's">' +
            '<div class="it-pv">' + (u.scope === 'char' ? '<span class="it-ch">' + pt(ch, 72, {}) + '</span>' : '') + anyIcon(u.icon, 96, 'pv-ic') + (u.scope === 'char' ? '<span class="it-badge">' + esc(ch) + (u.sub ? ' · ' + esc(u.sub) : '') + '</span>' : '') + '</div>' +
            '<div class="it-n">' + esc(u.n || u.key) + '</div>' + curTxt +
            '<div class="it-d">' + esc(u.desc || '') + '</div>' +
            '<div class="it-lv">' + pips(lv, max) + '<span>SV. ' + lv + '/' + max + '</span></div>' +
            (u.next ? '<div class="it-next">Sonraki: <b>' + esc(u.next) + '</b></div>' : '') +
            (Array.isArray(u.options) ? '<div class="st-opts">' + u.options.map(o =>
              '<button class="st-o ' + (o.selected ? 'on ' : '') + (o.owned ? '' : 'locked') + '" data-act="startitem" data-item="' + esc(o.item) + '" title="' + esc(o.n) + (o.owned ? '' : ' (kilitli)') + '" aria-label="' + esc(o.n) + '">' +
                gi(o.item, 40, 'st-gi') + (o.owned ? '' : '<i class="st-lock">' + svg('lock') + '</i>') + '</button>').join('') + '</div>' : '') +
            '<div class="it-f">' + (lv >= max ? '<span class="maxed">MAKS</span>' : priceBtn('upg', 'data-key="' + esc(u.key) + '" data-ch="' + esc(ch) + '"', p)) + '</div>' +
          '</div>';
        });
      }
    } else {
      const packs = mcall('packs');
      head = '<div class="shop-head">' + gemI(40, 'sh-mini') + '<span>Elmaslarını bozdur, kesene <b>altın</b> doldur!</span></div>';
      if (!Array.isArray(packs) || !packs.length) body = emptyBox('chest', 'Hazine kapalı');
      else packs.forEach((pk, i) => {
        body += '<div class="it it-pack" data-k="pack:' + esc(pk.id) + '" style="--d:' + (i * .05).toFixed(2) + 's">' +
          '<div class="it-pv pv-pack pk-' + i + '"><span class="pk-rays"></span>' + packArt(i) + '</div>' +
          '<div class="it-n">' + esc(pk.n) + '</div>' +
          '<div class="pk-amt">' + coinI(32, 'bi') + '<b>' + fmtN(pk.coins) + '</b></div>' +
          '<div class="it-d">' + fmtN(pk.gems) + ' elmas karşılığında</div>' +
          '<div class="it-f">' + priceBtn('pack', 'data-id="' + esc(pk.id) + '"', { cur: 'gems', n: +pk.gems || 0 }) + '</div>' +
        '</div>';
      });
    }
    return panel('MAĞAZA',
      tabsBar('shop', tabs, tab) + head +
      '<div class="tab-body scroll" data-sk="shop-' + tab + '"><div class="sgrid sg-' + tab + '">' + body + '</div></div>', 'pnl-shop', 'rb-gold');
  }
  function collectionTxt() {
    const c = mcall('collection');
    return c && typeof c === 'object' ? svg('bag') + '<span>Koleksiyon <b>' + fmtN(c.owned) + '/' + fmtN(c.total) + '</b></span>' : '';
  }

  /* =====================================================================
     12) GÖREVLER + 7 GÜNLÜK GİRİŞ ÖDÜLÜ
     ===================================================================== */
  function secsToReset() {
    const v = mcall('dailyResetIn');
    if (typeof v === 'number' && v >= 0) return v / 1000;
    const n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return (m - n) / 1000;
  }
  function missionRow(m, i) {
    const goal = Math.max(1, +m.goal || 1), prog = clamp(+m.prog || 0, 0, goal), pct = prog / goal * 100;
    const state = m.claimed ? 'claimed' : m.done ? 'done' : '';
    let right;
    if (m.claimed) right = '<span class="ms-ok">' + svg('check') + 'ALINDI</span>';
    else if (m.done) right = '<button class="btn sm b-green ms-claim" data-act="claim" data-id="' + esc(m.id) + '">AL</button>';
    else right = '<span class="ms-pct">%' + Math.floor(pct) + '</span>';
    let tag = '';
    if (m.kind === 'daily' && m.diffName) tag = '<em class="ms-tag d' + (m.bonus ? 'b' : (+m.diff || 0)) + '">' + esc(m.diffName) + '</em>';
    else if (m.kind === 'ach' && m.tiers > 1) {
      tag = '<em class="ms-tier" title="Kademe">';
      const doneT = (+m.tier || 0) + (m.maxed ? 1 : 0);
      for (let k = 0; k < m.tiers; k++) tag += '<i class="' + (k < doneT ? 'on' : '') + '"></i>';
      tag += '</em>';
    }
    let rr = '';
    if (m.rerollable && !m.done && hasMeta('rerollMission')) {
      const cost = +mcall('rerollCost') || 0;
      rr = '<button class="rbtn b-steel ms-rr" data-act="reroll" data-id="' + esc(m.id) + '" data-cost="' + cost + '" title="Görevi değiştir' + (cost ? ' (' + cost + ' elmas)' : ' (ücretsiz)') + '" aria-label="Görevi değiştir">' + svg('reset') + (cost ? '<i class="rr-c">' + cost + '</i>' : '') + '</button>';
    }
    return '<div class="ms ' + state + (m.bonus ? ' bonus' : '') + '" data-k="ms:' + esc(m.id) + '" style="--d:' + (i * .04).toFixed(2) + 's">' +
      '<span class="ms-ic">' + anyIcon(m.icon, 44) + '</span>' +
      '<span class="ms-mid"><span class="ms-th"><b class="ms-t">' + esc(m.title || '') + '</b>' + tag + rr + '</span><span class="ms-d">' + esc(m.desc || '') + '</span>' +
        '<span class="bar bar-ms"><i style="width:' + pct.toFixed(1) + '%"></i><em>' + fmtN(prog) + ' / ' + fmtN(goal) + '</em></span></span>' +
      '<span class="ms-r"><span class="ms-rw">' + rewardChips(m.reward, 22) + '</span>' + right + '</span>' +
    '</div>';
  }
  function dailyTable() {
    const m = FM.meta || {};
    if (Array.isArray(m.DAILY) && m.DAILY.length >= 7) return m.DAILY;
    const v = mcall('dailyRewards');
    return Array.isArray(v) && v.length >= 7 ? v : null;
  }
  function dailyCal() {
    const d = daily();
    if (!d) return emptyBox('calendar', 'Günlük ödül yakında', 'Her gün giriş yap, ödülleri topla!');
    const streak = Math.max(0, +d.streak || 0);
    let today = d.day != null ? clamp((+d.day | 0) - 1, 0, 6) : (d.ready ? streak % 7 : (streak + 6) % 7);
    const table = Array.isArray(d.rewards) && d.rewards.length >= 7 ? d.rewards : dailyTable();
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const got = i < today || (i === today && !d.ready);
      const isToday = i === today;
      const rw = (table && table[i]) || (isToday ? d.reward : null);
      let ic, val;
      if (rw && typeof rw === 'object') {
        if (rw.icon === '🧰' && rw.coins) { ic = svg('chest', 'dc-chest'); val = fmtN(rw.coins); }
        else if (rw.gems && !rw.coins) { ic = gemI(56, 'dc-gi'); val = fmtN(rw.gems); }
        else if (rw.coins) { ic = coinI(56, 'dc-gi'); val = fmtN(rw.coins) + (rw.gems ? ' +' + fmtN(rw.gems) + '<i class="mini-gem">' + gemI(20) + '</i>' : ''); }
        else if (rw.xp) { ic = '<i class="xp-big">XP</i>'; val = fmtN(rw.xp); }
        else { ic = svg('chest', 'dc-chest'); val = '?'; }
      } else { ic = svg('chest', 'dc-chest'); val = i === 6 ? 'BÜYÜK' : '?'; }
      cells += '<div class="dc ' + (got ? 'got ' : '') + (isToday && d.ready ? 'today ' : '') + (i === 6 ? 'big' : '') + '" style="--d:' + (i * .05).toFixed(2) + 's">' +
        '<span class="dc-d">GÜN ' + (i + 1) + '</span><span class="dc-ic">' + ic + '</span><span class="dc-v">' + val + '</span>' +
        (got ? '<span class="dc-ok">' + svg('check') + '</span>' : '') + '</div>';
    }
    return '<div class="dcal">' + cells + '</div>' +
      '<div class="dc-foot"><span class="dc-streak">' + svg('fire') + 'Seri: <b>' + streak + '</b> gün</span>' +
      (d.ready ? '<button class="btn b-gold dc-claim" data-act="claimDaily">' + svg('gift') + '<span>ÖDÜLÜ AL</span></button>'
               : '<span class="dc-wait">Yeni ödül: <b data-reset>' + fmtClock(secsToReset()) + '</b></span>') + '</div>';
  }
  function renderMissions() {
    const tab = st.tabs.missions;
    const all = missions();
    const dl = all.filter(m => m.kind === 'daily'), ac = all.filter(m => m.kind !== 'daily');
    const cD = dl.filter(m => m.done && !m.claimed).length, cA = ac.filter(m => m.done && !m.claimed).length;
    const order = m => (m.done && !m.claimed ? 0 : !m.done ? 1 : 2);
    const list = (tab === 'daily' ? dl : ac).slice().sort((a, b) => order(a) - order(b));
    const extra = tab === 'daily' ? '<span class="reset-chip">' + svg('calendar') + 'Yenilenme <b data-reset>' + fmtClock(secsToReset()) + '</b></span>' : '';
    let rows = '';
    if (!hasMeta('missions')) rows = emptyBox('scroll', 'Görevler hazırlanıyor', 'Birkaç yarış koş, görevler burada belirecek.');
    else if (!list.length) rows = emptyBox('check', tab === 'daily' ? 'Bugünlük görev yok' : 'Başarım bulunamadı');
    else list.forEach((m, i) => { rows += missionRow(m, i); });
    return panel('GÖREVLER',
      '<div class="ms-wrap">' +
        '<div class="ms-left">' + tabsBar('missions', [['daily', 'Günlük', 'calendar', cD], ['ach', 'Başarımlar', 'medal', cA]], tab, extra) +
          '<div class="tab-body scroll" data-sk="ms-' + tab + '"><div class="ms-list">' + rows + '</div></div></div>' +
        '<div class="ms-right"><div class="dly-card"><h3>' + svg('gift') + '7 GÜNLÜK GİRİŞ ÖDÜLÜ</h3>' + dailyCal() + '</div></div>' +
      '</div>', 'pnl-ms', 'rb-green');
  }

  /* 13) KLAN ve ÇEVRİMİÇİ ekranları: aşağıda 15c bölümünde (gerçek varlık verisi) */

  /* =====================================================================
     14) AYARLAR
     ===================================================================== */
  const KEYS = [
    [['Boşluk', '↑', 'W'], 'Zıpla', 'Havada tekrar bas: çift zıplama. Duvara basılı tut: tırmanma.'],
    [['↓', 'S'], 'Kay / Yere çakıl', 'Yerde kayarsın, havadayken hızla yere çakılırsın.'],
    [['E', 'Shift'], 'Eşya kullan', 'Basılı tut + ok tuşlarıyla yönü seç, bırakınca atılır.'],
    [['Q', 'F'], 'Özel güç', 'Güç dolunca basılı tut + ok tuşlarıyla yönü seç, bırak.'],
    [['Esc', 'P'], 'Duraklat', 'Yarışı durdurur, ayarlara ulaşırsın.']
  ];
  function keysList() {
    let h = '<div class="keys">';
    for (const k of KEYS) h += '<div class="kr"><span class="kk">' + k[0].map(x => '<kbd>' + esc(x) + '</kbd>').join('') + '</span><span class="kt"><b>' + k[1] + '</b><span>' + k[2] + '</span></span></div>';
    return h + '</div>';
  }
  function touchList() {
    return '<div class="tlist">' +
      '<div class="tl"><span class="tl-b tl-jump">' + svg('up') + '</span><span><b>ZIPLA</b> sol alt köşede. Basılı tutarsan duvara tırmanırsın.</span></div>' +
      '<div class="tl"><span class="tl-b tl-slide">' + svg('down') + '</span><span><b>KAY</b> ZIPLA’nın hemen sağında. Havadayken yere çakılırsın.</span></div>' +
      '<div class="tl"><span class="tl-b tl-item">' + gi('box', 32) + '</span><span><b>EŞYA</b> sağ alt köşede. Dokun: kullan. Yönlü eşyada (testere, dinamit…) <b>basılı tut, sürükle, bırak</b>: o yöne atılır.</span></div>' +
      '<div class="tl"><span class="tl-b tl-pow">' + svg('bolt') + '</span><span><b>GÜÇ</b> EŞYA’nın solunda; <b>HAZIR!</b> yanınca dokun ya da yönlüyse sürükleyip bırak.</span></div>' +
    '</div>';
  }
  function sliderRow(key, label, icon) {
    const s = sv().settings || {};
    const v = Math.round(clamp(s[key] != null ? +s[key] : (key === 'music' ? .6 : .8), 0, 1) * 100);
    return '<div class="srow"><span class="s-ic">' + svg(icon) + '</span><span class="s-l">' + label + '</span>' +
      '<input class="rng" type="range" min="0" max="100" step="1" value="' + v + '" data-set="' + key + '" aria-label="' + label + '" style="--v:' + v + '%">' +
      '<b class="s-v" data-v="' + key + '">' + v + '</b></div>';
  }
  function toggleRow(key, label, icon, act, tip) {
    const on = !!setting(key);
    return '<div class="srow"><span class="s-ic">' + svg(icon) + '</span><span class="s-l">' + label + '</span>' +
      '<button class="tgl ' + (on ? 'on' : '') + '" data-act="' + (act || 'tgl') + '" data-set="' + key + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '"><i></i><span class="tg-on">AÇIK</span><span class="tg-off">KAPALI</span></button></div>' +
      (tip ? '<p class="set-tip">' + tip + '</p>' : '');
  }
  function segRow(key, label, icon, opts) {
    const cur = String(setting(key));
    return '<div class="srow"><span class="s-ic">' + svg(icon) + '</span><span class="s-l">' + label + '</span><span class="seg">' +
      opts.map(o => '<button class="' + (cur === o[0] ? 'on' : '') + '" data-act="segset" data-set="' + key + '" data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</span></div>';
  }
  /** Bildirim izni durumu (tarayıcıdan): 'granted' | 'denied' | 'default' | 'none' */
  function notifPerm() { try { return ('Notification' in window) ? Notification.permission : 'none'; } catch (e) { return 'none'; } }
  function renderSettings() {
    const s = sv().settings || {};
    const q = s.quality === 'low' ? 'low' : 'high';
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const sound = '<div class="set-card"><h4>' + svg('sound') + 'SES</h4>' + sliderRow('music', 'Müzik', 'music') + sliderRow('sfx', 'Efektler', 'sound') + '</div>';
    const view = '<div class="set-card"><h4>' + svg('sparkle') + 'GÖRÜNTÜ</h4>' +
        '<div class="srow"><span class="s-ic">' + svg('sparkle') + '</span><span class="s-l">Grafik kalitesi</span><span class="seg">' +
          '<button class="' + (q === 'high' ? 'on' : '') + '" data-act="q" data-v="high">Yüksek</button><button class="' + (q === 'low' ? 'on' : '') + '" data-act="q" data-v="low">Düşük</button></span></div>' +
        (touchMode ? '<p class="set-tip">Telefon ısınır ya da oyun takılırsa <b>Düşük</b> seç.</p>' : '') +
        (fsOK() ? '<div class="srow"><span class="s-ic">' + svg('full') + '</span><span class="s-l">Tam ekran</span><button class="btn sm b-blue" data-act="full">' + (fs ? 'KAPAT' : 'AÇ') + '</button></div>'
          : iosTab() ? '<div class="srow"><span class="s-ic">' + svg('full') + '</span><span class="s-l">Tam ekran (iPhone)</span><button class="btn sm b-gold" data-act="iosfull">NASIL?</button></div>' : '') +
        toggleRow('shake', 'Ekran sarsıntısı', 'shake') +
      '</div>';
    // oyun hissi: dokunmatik düzen + titreşim + nişan yardımı
    const canVib = touchMode || (typeof navigator !== 'undefined' && !!navigator.vibrate);
    const ctl = '<div class="set-card"><h4>' + svg('pad2') + 'KONTROLLER</h4>' +
        (touchMode ? segRow('btnSize', 'Düğme boyutu', 'hand', [['S', 'Küçük'], ['M', 'Orta'], ['L', 'Büyük']]) +
          toggleRow('lefty', 'Solak düzen', 'hand', 'tgl', 'Açınca ZIPLA/KAY sağa, EŞYA/GÜÇ sola geçer.') : '') +
        (canVib ? toggleRow('haptic', 'Titreşim', 'wind') : '') +
        toggleRow('aimAssist', 'Nişan yardımı', 'aim', 'tgl', 'Yönlü atışlarda yönünü en yakın hedefe hafifçe çeker.') +
      '</div>';
    const perm = notifPerm(), nOn = !!setting('notify') && perm === 'granted';
    const notif = '<div class="set-card"><h4>' + svg('bell') + 'BİLDİRİMLER</h4>' +
        '<div class="srow"><span class="s-ic">' + svg('bell') + '</span><span class="s-l">Arkadaş bildirimleri</span>' +
          '<button class="tgl ' + (nOn ? 'on' : '') + '" data-act="tglnotify" role="switch" aria-checked="' + nOn + '" aria-label="Bildirimler"><i></i><span class="tg-on">AÇIK</span><span class="tg-off">KAPALI</span></button></div>' +
        '<p class="set-tip">Arkadaşın çevrimiçi olunca ya da lobi kurunca haber verilir. <b>Bildirimler oyun açıkken ya da arka plandayken gelir.</b>' +
          (perm === 'denied' ? ' <span class="tip-bad">Tarayıcı bildirim iznini kapatmış: adres çubuğundaki kilit simgesinden izin ver.</span>' : perm === 'none' ? ' <span class="tip-bad">Bu tarayıcı bildirimleri desteklemiyor.</span>' : '') + '</p>' +
      '</div>';
    const prof = '<div class="set-card"><h4>' + svg('user') + 'PROFİL</h4>' +
        '<div class="srow"><span class="s-ic">' + svg('user') + '</span><span class="s-l">Takma ad</span><b class="s-nick">' + esc(myNick()) + '</b><button class="btn sm b-purple" data-act="nick">DEĞİŞTİR</button></div>' +
      '</div>';
    const save = '<div class="set-card"><h4>' + svg('chest') + 'KAYIT KODU</h4>' +
        '<p class="set-tip">İlerlemen bu cihazda otomatik kaydedilir. Başka cihaza geçerken kodla taşı.</p>' +
        '<div class="srow sv-row"><button class="btn sm b-blue" data-act="svexp">' + svg('share') + '<span>KODUMU AL</span></button><button class="btn sm b-green" data-act="svimp">' + svg('down') + '<span>KOD GİR</span></button></div>' +
      '</div>';
    // telefonda en önemli ayarlar (kontroller, kalite, tam ekran) üstte; klavye kısayolları yalnızca klavyeli cihazda
    const left = (touchMode ? ctl : '') + prof + notif + save + pwaCard() + (touchMode ? view + sound : sound + view) +
      '<div class="set-card danger"><h4>' + svg('reset') + 'İLERLEME</h4><div class="srow"><span class="s-l s-wide">Tüm ilerlemeni sil ve baştan başla.</span><button class="btn sm b-red" data-act="reset">SIFIRLA</button></div></div>';
    const right = touchMode
      ? '<div class="set-card ctl-card"><h4>' + svg('hand') + 'DOKUNMATİK</h4>' + touchList() + '</div>'
      : '<div class="set-card ctl-card"><h4>' + svg('keyboard') + 'KLAVYE</h4>' + keysList() + '<h4 class="h-touch">' + svg('hand') + 'DOKUNMATİK</h4>' + touchList() + '</div>' + ctl;
    return panel('AYARLAR', '<div class="set-wrap"><div class="set-col scroll" data-sk="set-l">' + left + '</div><div class="set-col scroll" data-sk="set-r">' + right + '</div></div>', 'pnl-set', 'rb-steel');
  }

  /* =====================================================================
     15) NASIL OYNANIR
     ===================================================================== */
  const MAPEL = [
    ['box', 'Eşya Kutusu', 'İçinden rastgele bir eşya çıkar. Her yarışçı için ayrı dolar.', 0],
    ['coin', 'Altın', 'Yolda topla; yarış sonunda cüzdanına eklenir.', 1],
    ['pad', 'Hız Pedi', 'Üstünden geçince bir süre çok hızlı koşarsın.', 0],
    ['mush', 'Zıplatan Mantar', 'Basınca seni yükseklere fırlatır.', 0],
    ['belt', 'Yürüyen Bant', 'Seni ileri doğru taşır.', 0],
    ['mud', 'Çamur', 'Yavaşlatır; üstünden zıplayarak geç.', 0],
    ['x_spikes', 'Dikenler', 'Değersen ölür, son güvenli noktada doğarsın.', 1],
    ['x_crush', 'Ezici', 'Üstünden atlanmaz: altından kayarak geç (kaymayı basılı tut).', 1],
    ['saw', 'Testere Makinesi', 'Ray üstünde iner çıkar, zamanlamanı iyi ayarla.', 1],
    ['x_lava', 'Sıvılar', 'Su, çikolata, buzlu su ya da lav: düşen yeniden doğar.', 1],
    ['flag', 'Bitiş Çizgisi', 'İlk geçen kazanır. Yavaş kalanlar için süre sınırı var.', 1]
  ];
  function renderHelp() {
    const tab = st.tabs.help;
    const tabs = [['controls', 'Kontroller', touchMode ? 'hand' : 'keyboard'], ['items', 'Eşyalar', 'box'], ['powers', 'Özel Güçler', 'bolt'], ['map', 'Harita', 'flag']];
    let body = '';
    if (tab === 'controls') {
      const pts = (FM.PTS || [10, 6, 3, 1]), trp = (FM.TROPHY || [30, 12, -5, -15]);
      let sc = '';
      for (let i = 0; i < 4; i++) sc += '<div class="pr">' + placeBadge(i + 1) + '<b>+' + pts[i] + '</b><span>puan</span><em class="' + (trp[i] < 0 ? 'neg' : '') + '">' + trophyI(20, 'bi') + fmtSigned(trp[i]) + '</em></div>';
      const score = '<h4' + (touchMode ? '' : ' class="h-touch"') + '>' + svg('trophy') + 'PUANLAMA</h4><div class="prs">' + sc + '</div>' +
        '<p class="tip">Maç birkaç turdan oluşur; turlarda toplanan puanlar en çok olan şampiyon olur. Kupalar karakterine yazılır.</p>';
      body = touchMode
        // telefonda klavye kartı yok: dokunmatik kontroller solda, puanlama sağda (kaydırmadan görünür)
        ? '<div class="help-grid hg-2">' +
            '<div class="set-card"><h4>' + svg('hand') + 'DOKUNMATİK</h4>' + touchList() + '</div>' +
            '<div class="set-card">' + score + '</div>' +
          '</div>'
        : '<div class="help-grid hg-2">' +
            '<div class="set-card"><h4>' + svg('keyboard') + 'KLAVYE</h4>' + keysList() + '</div>' +
            '<div class="set-card"><h4>' + svg('hand') + 'DOKUNMATİK</h4>' + touchList() + score + '</div>' +
          '</div>';
    } else if (tab === 'items') {
      let h = '';
      Object.keys(FM.ITEMS || {}).forEach((k, i) => {
        const it = FM.ITEMS[k];
        h += '<div class="hi" style="--d:' + (i * .03).toFixed(2) + 's;--ic:' + esc(it.col || '#fff') + '"><span class="hi-ic">' + gi(k, 56) + '</span><span class="hi-m"><b>' + esc(it.n) + '</b><span>' + esc(it.d) + '</span></span></div>';
      });
      body = '<div class="help-grid hg-items">' + h + '</div>';
    } else if (tab === 'powers') {
      let h = '';
      FM.ORDER.forEach((id, i) => {
        const c = FM.CH[id] || {};
        h += '<div class="hp" style="--d:' + (i * .04).toFixed(2) + 's">' + pt(id, 72, {}, 'hp-pt') + '<span class="hp-m"><span class="hp-t"><b>' + esc(id) + '</b><em>' + esc(c.ab || '') + '</em></span><span class="hp-d">' + esc(c.d || '') + '</span></span></div>';
      });
      body = '<div class="help-grid hg-pow">' + h + '</div>';
    } else {
      let h = '';
      MAPEL.forEach((m, i) => {
        h += '<div class="hi hm" style="--d:' + (i * .03).toFixed(2) + 's"><span class="hi-ic">' + (m[3] ? gi(m[0], 56) : '<i class="gi fb-svg map-svg ms-' + m[0] + '">' + svg(m[0]) + '</i>') + '</span><span class="hi-m"><b>' + m[1] + '</b><span>' + m[2] + '</span></span></div>';
      });
      body = '<div class="help-grid hg-items">' + h + '</div>';
    }
    return panel('NASIL OYNANIR', tabsBar('help', tabs, tab) + '<div class="tab-body scroll" data-sk="help-' + tab + '">' + body + '</div>', 'pnl-help', 'rb-purple');
  }

  /* =====================================================================
     15b) TEK OYUNCULU KURULUM (mod + harita + tur + rakip) ve ARKADAŞLARLA ekranları
     ===================================================================== */
  const MODES = () => (Array.isArray(FM.MODES) && FM.MODES.length ? FM.MODES : [{ id: 'classic', n: 'Klasik Yarış', ic: '🏁', d: 'Bitişe ilk varan kazanır.' }]);
  function modeOf(id) { return MODES().find(m => m.id === id) || MODES()[0]; }
  function mapList() { return ['random'].concat((FM.THEMES || []).map(t => t.id)); }
  function themeOf(id) { return (FM.THEMES || []).find(t => t.id === id) || null; }
  function mapName(id) { const t = themeOf(id); return t ? t.n : 'Rastgele'; }
  function mapMech(id) { const t = themeOf(id); return t ? (t.mech || '') : 'Her tur farklı bir harita'; }
  function mapBg(id) {
    const t = themeOf(id);
    if (!t || !Array.isArray(t.sky)) return '--m1:#ff5a6e;--m2:#8a4dff;--m3:#3fb0ff';
    return '--m1:' + esc(t.sky[0]) + ';--m2:' + esc(t.sky[1]) + ';--m3:' + esc(t.sky[2]);
  }
  const firstSentence = s => { s = String(s || ''); const i = s.indexOf('. '); return i > 0 ? s.slice(0, i + 1) : s; };
  function soloSel() {
    const s = sv();
    return { mode: modeOf(s.mode).id, map: mapList().indexOf(s.map) >= 0 ? s.map : 'random', rounds: roundsSel(), rivals: clamp(Math.round(+s.rivals || 3), 1, 9) };
  }
  function renderSolo() {
    const o = soloSel();
    let mh = '';
    MODES().forEach((m, i) => {
      mh += '<button class="mcard ' + (m.id === o.mode ? 'on' : '') + '" data-act="smode" data-v="' + esc(m.id) + '" style="--d:' + (i * .04).toFixed(2) + 's">' +
        '<span class="mc-ic">' + anyIcon(m.ic, 40) + '</span><span class="mc-m"><b>' + esc(m.n) + '</b><span>' + esc(firstSentence(m.d)) + '</span></span>' +
        (m.id === o.mode ? '<i class="mc-ck">' + svg('check') + '</i>' : '') + '</button>';
    });
    let ph = '';
    mapList().forEach((id, i) => {
      ph += '<button class="mapc ' + (id === o.map ? 'on ' : '') + (id === 'random' ? 'rnd' : '') + '" data-act="smap" data-v="' + esc(id) + '" style="' + mapBg(id) + ';--d:' + (i * .03).toFixed(2) + 's">' +
        '<i class="mp-hill"></i>' + (id === 'random' ? '<i class="mp-q">?</i>' : '') + '<b>' + esc(mapName(id)) + '</b></button>';
    });
    let rd = '';
    for (const n of [1, 3, 5]) rd += '<button class="rd ' + (n === o.rounds ? 'on' : '') + '" data-act="rounds" data-n="' + n + '" aria-label="' + n + ' tur">' + n + '</button>';
    return panel('TEK OYUNCULU',
      '<div class="so-wrap">' +
        '<div class="so-col so-c1"><h4 class="so-h">' + svg('flag') + 'MOD</h4><div class="so-modes scroll" data-sk="so-m">' + mh + '</div></div>' +
        '<div class="so-col so-c2"><h4 class="so-h">' + svg('star') + 'HARİTA</h4><div class="so-maps">' + ph + '</div><p class="so-mech">' + svg('info') + '<span>' + esc(mapMech(o.map)) + '</span></p></div>' +
        '<div class="so-col so-side">' +
          '<div class="so-opt"><span class="so-l">TUR</span><span class="rd-o">' + rd + '</span></div>' +
          '<div class="so-opt"><span class="so-l">RAKİP</span><span class="stp"><button class="rd" data-act="rivals" data-d="-1" aria-label="Azalt">−</button><b class="stp-v">' + o.rivals + '</b><button class="rd" data-act="rivals" data-d="1" aria-label="Artır">+</button></span></div>' +
          '<span class="so-pt">' + pt(selChar(), 64, { skin: equipped('skins', selChar()) }) + '<em>' + esc(selChar()) + '</em></span>' +
          '<button class="btn b-gold btn-go" data-act="solostart"><span class="shine"></span>' + svg('play') + '<span>BAŞLA</span></button>' +
        '</div>' +
      '</div>', 'pnl-solo', 'rb-gold');
  }

  /* ---------- çok oyunculu yardımcılar (FM.net / FM.netgame yoksa güvenli) ---------- */
  function NET() { try { return FM.net && typeof FM.net.available === 'function' && FM.net.available() ? FM.net : null; } catch (e) { return null; } }
  function NGM() { return FM.netgame || null; }
  function ncall(name) {
    const n = NET(); if (!n || typeof n[name] !== 'function') return undefined;
    try { return n[name].apply(n, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.error('[ui] net.' + name, e); return undefined; }
  }
  function gcall(name) {
    const g = NGM(); if (!g || typeof g[name] !== 'function') return undefined;
    try { return g[name].apply(g, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.error('[ui] netgame.' + name, e); return undefined; }
  }
  function mpInRoom() { return !!(ncall('inRoom')); }
  function mpBusy() { return !!(ncall('busy')); }
  function mpHost() { return !!(ncall('isHost')); }
  /** Son 15 dk içinde girilen oda (sayfa yenilenince geri dönmek için): {code, mins, nick} | null */
  function rejoinData() { const v = gcall('rejoinInfo'); return v && typeof v === 'object' && v.code ? v : null; }
  /** Ağ maçı ekranda mı (duraklatma yok, odadan ayrıl menüsü) */
  function mpLive() { return !!(S.netRole && gcall('live')); }
  function mpActive() { return !!gcall('active'); }
  function myNick() { return ncall('nick') || sv().nick || selChar(); }
  function normCfg(c) {
    const g = NGM();
    if (g && typeof g.normCfg === 'function') { try { return g.normCfg(c); } catch (e) { /* aşağıdaki yedek */ } }
    c = c || {};
    return { mode: modeOf(c.mode).id, map: mapList().indexOf(c.map) >= 0 ? c.map : 'random', rounds: +c.rounds || 3, bots: c.bots !== false, fill: +c.fill || 4, autoNext: 8 };
  }
  function lastCfg() {
    let c = null;
    try { c = JSON.parse(lsGet('fm-mpcfg') || 'null'); } catch (e) { c = null; }
    if (!c || typeof c !== 'object') c = gcall('defaultCfg') || { mode: sv().mode || 'classic', map: 'random', rounds: 3, bots: true };
    return normCfg(c);
  }
  /** Açık odalar: çevrimiçi listesinde oda kodu yayınlayanlar koda göre gruplanır (link gerekmez; herkes görür). */
  function roomList() {
    const me = myPid(), mine = mpInRoom() ? ncall('code') : null, by = {};
    for (const p of onlineList()) {
      if (!p || p.me || p.pid === me || !p.code || p.code === mine || p.st === 'away') continue;
      const r = by[p.code] || (by[p.code] = { code: p.code, ps: [], n: 0, max: 10, lobby: false });
      r.ps.push(p); r.n = Math.max(r.n, (p.n | 0) || r.ps.length); r.max = (p.max | 0) || r.max;
      if (p.st === 'lobby') r.lobby = true;
    }
    return Object.keys(by).map(k => by[k]).filter(r => r.n < r.max).sort((a, b) => (b.lobby - a.lobby) || (b.n - a.n));
  }
  function roomRow(r, i) {
    const names = r.ps.map(p => p.nick || p.char).slice(0, 3).join(', ') + (r.ps.length > 3 ? ' +' + (r.ps.length - 3) : '');
    const pts = r.ps.slice(0, 3).map(p => '<span class="frr-pt">' + pt(FM.CH[p.char] ? p.char : 'TAFTAF', 40, { skin: p.skin, hat: p.hat }) + '</span>').join('');
    const sub = (r.lobby ? 'Lobide' : 'Yarışta · sonraki turda katılırsın') + ' · ' + r.n + '/' + r.max;
    return '<div class="fr-room' + (r.lobby ? ' lob' : ' race') + '" style="--d:' + (i * .05).toFixed(2) + 's">' +
      '<span class="frr-pts">' + pts + '</span>' +
      '<span class="frr-tx"><b>' + esc(names) + '</b><span><i class="on-dot on"></i>' + esc(sub) + '</span></span>' +
      '<button class="btn sm b-green frr-go" data-act="joinroom" data-code="' + esc(r.code) + '">' + svg('play') + '<span>KATIL</span></button>' +
    '</div>';
  }
  function roomsHtml() {
    const rooms = roomList();
    return rooms.length ? rooms.map(roomRow).join('')
      : '<div class="fr-empty">' + svg('users') + '<span>Şu an açık oda yok. <b>ODA KUR</b>, arkadaşların burada görüp tek dokunuşla katılsın.</span></div>';
  }
  function renderFriends() {
    if (!NET()) return panel('ARKADAŞLARLA', emptyBox('info', 'Bu tarayıcı çok oyunculuyu desteklemiyor', 'Oyunu Chrome ya da Safari ile aç.'), 'pnl-fr', 'rb-green');
    const nR = roomList().length;
    return panel('ARKADAŞLARLA',
      '<div class="fr-wrap fr-wrap2">' +
        '<div class="frc frc-rooms">' +
          '<b class="frc-t">AÇIK ODALAR<em class="fr-cnt' + (nR ? ' on' : '') + '">' + nR + '</em></b>' +
          '<div class="fr-rl scroll" data-sk="fr-rooms">' + roomsHtml() + '</div>' +
        '</div>' +
        '<div class="fr-side">' +
          '<div class="frc frc-host">' +
            '<b class="frc-t">' + svg('crown', 'gold') + 'ODA KUR</b>' +
            '<span class="frc-d">Odan herkesin listesinde görünür, <b>link atman gerekmez</b>. 10 kişiye kadar!</span>' +
            '<button class="btn b-gold frc-btn" data-act="mpcreate">' + svg('users') + '<span>ODA KUR</span></button>' +
          '</div>' +
          '<div class="frc frc-join">' +
            '<b class="frc-t">' + svg('door') + 'KODLA KATIL</b>' +
            '<div class="code-in"><input class="cin" type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="60" placeholder="KOD" aria-label="Oda kodu" data-enter="mpjoin" value="' + esc(st.mpCode || '') + '">' +
            '<button class="btn b-blue frc-btn" data-act="mpjoin">' + svg('play') + '<span>KATIL</span></button></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="fr-nick"><span class="frn-pt">' + pt(selChar(), 48, { skin: equipped('skins', selChar()) }) + '</span><span class="frn-l">Takma adın</span><b class="frn-n">' + esc(myNick()) + '</b>' +
        '<button class="btn sm b-purple" data-act="nick">DEĞİŞTİR</button></div>',
      'pnl-fr', 'rb-green');
  }
  /** Ana menüdeki ARKADAŞLARLA düğmesi: açık oda sayısını canlı göster */
  function friendsBtnSub() { const n = NET() ? roomList().length : 0; return n ? n + ' açık oda · Katıl' : 'Oda kur · Katıl'; }
  function updateRoomsBadge() {
    const b = $('.btn-friends:not(.rj)'); if (!b || b.getAttribute('data-act') !== 'go') return;
    const em = $('.bf-t em', b), t = friendsBtnSub();
    if (em && em.textContent !== t) em.textContent = t;
    b.classList.toggle('has-rooms', t.indexOf('açık oda') > 0);
  }
  function updateRoomsList() {
    const box = $('.fr-rl'), cnt = $('.fr-cnt'); if (!box) return;
    const h = roomsHtml(); if (box.getAttribute('data-h') !== h) { box.setAttribute('data-h', h); box.innerHTML = h; }
    if (cnt) { const n = roomList().length; cnt.textContent = n; cnt.classList.toggle('on', n > 0); }
  }

  /* ---------- LOBİ (üst çubuksuz tam ekran; parçalar ayrı ayrı ve yalnızca değişince yenilenir) ---------- */
  const PCOL = ['#ffd23f', '#ff5a6e', '#4fb3ff', '#5ee07a', '#c084fc', '#ff9f43', '#22d3e6', '#ff6ec7', '#a3e635', '#f2f2f7'];
  function pColor(i) { const R = FM.R; return (R && Array.isArray(R.PLAYER_COLORS) && R.PLAYER_COLORS[i % 10]) || PCOL[i % 10]; }
  const EMOJIS = ['👍', '😂', '😎', '😡', '🔥', '💀', '👋', 'GG'];
  function lobbyData() {
    if (st.fakeLobby) return st.fakeLobby;
    if (!NET()) return null;
    const lob = ncall('lobby') || null, pl = ncall('players') || [], stt = ncall('status') || {};
    return { lob, pl: Array.isArray(pl) ? pl.filter(Boolean) : [], stt };
  }
  /** Ping çubukları: sen ↔ o oyuncu gidiş-dönüş (doğrudan bağlantıda gerçek eşler arası süre). link 'p2p' → DOĞRUDAN rozeti */
  function pingHtml(ms, link) {
    const lv = ms == null ? 0 : ms <= 80 ? 3 : ms <= 160 ? 2 : 1;
    if (link === 'p2p') return '<span class="p2p" title="Doğrudan bağlantı (sunucusuz)">DOĞRUDAN</span>' + pingHtml(ms);
    return '<span class="png l' + lv + '"><i></i><i></i><i></i>' + (ms != null ? '<em>' + Math.round(ms / 10) * 10 + '</em>' : '') + '</span>';
  }
  function renderLobby() {
    return '<div class="lb">' +
      '<div class="lb-top">' +
        '<button class="rbtn b-red lb-back" data-act="lbleave" aria-label="Odadan ayrıl" title="Odadan ayrıl">' + svg('back') + '</button>' +
        '<div class="lb-code" data-act="copylink" title="Linki kopyala"></div>' +
        '<button class="btn b-green lb-share" data-act="share">' + svg('share') + '<span>LİNKİ PAYLAŞ</span></button>' +
        '<button class="rbtn b-steel lb-copy" data-act="copylink" aria-label="Linki kopyala" title="Linki kopyala">' + svg('copy') + '</button>' +
        '<div class="tb-sp"></div>' +
        '<div class="lb-conn"></div>' +
      '</div>' +
      '<div class="lb-main">' +
        '<div class="pnl lb-pl"><div class="lb-pl-in scroll" data-sk="lb-pl"></div></div>' +
        '<div class="pnl lb-set"></div>' +
      '</div>' +
      '<div class="lb-foot"></div>' +
      '<div class="lb-cd" aria-live="polite"></div>' +
      '<div class="emo lb-emo">' + EMOJIS.map(e => '<button class="emo-b" data-act="emo" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>' +
    '</div>';
  }
  function lobbyCode(d) {
    const code = String((d.lob && d.lob.code) || ncall('code') || '·····');
    return '<span class="lc-l">ODA KODU</span><b class="lc-c">' + code.split('').map(c => '<i>' + esc(c) + '</i>').join('') + '</b>';
  }
  function lobbyConn(d) {
    const s = d.stt || {};
    const ok = s.conn === 'open', wait = s.conn === 'connecting' || s.conn === 'reconnecting';
    const txt = ok ? 'Bağlı' + (s.rtt != null ? ' · ' + Math.round(s.rtt) + ' ms' : '') : (ncall('statusText') || (wait ? 'Bağlanıyor…' : 'Bağlantı yok'));
    const cnt = d.pl.filter(p => !p.off).length;
    return '<span class="lcn ' + (ok ? 'ok' : wait ? 'wait' : 'bad') + '">' + svg('wifi') + '<span>' + esc(txt) + '</span></span>' +
      '<span class="lct">' + svg('users') + '<b>' + cnt + '</b><em>/' + ((d.lob && d.lob.max) || 10) + '</em></span>';
  }
  function lobbyPlayers(d) {
    const cfg = normCfg(d.lob && d.lob.cfg);
    const list = d.pl.slice(0, 10);
    const t = nowMs();
    let h = '';
    list.forEach((p, i) => {
      const ch = FM.CH[p.char] ? p.char : 'TAFTAF';
      const dim = p.off || (!p.alive && !p.me);
      const em = st.mpEmo[p.pid];
      const rdyTag = '<span class="pc-tag t-rdy">' + svg('check') + 'HAZIR</span>';
      const right = p.host
        ? '<span class="pc-tags"><span class="pc-tag t-host">EV SAHİBİ</span>' + (p.ready && !dim ? '<i class="pc-ck" title="Hazır">' + svg('check') + '</i>' : '') + '</span>'
        : p.ready ? rdyTag : '<span class="pc-tag t-wait">BEKLİYOR</span>';
      h += '<div class="pc ' + (p.me ? 'me ' : '') + (dim ? 'off ' : '') + (p.host ? 'host ' : '') + (p.ready && !dim ? 'rdy' : '') + '" style="--pc:' + pColor(i) + '">' +
        '<span class="pc-pt">' + pt(ch, 48, { skin: p.skin }) + (p.host ? '<i class="pc-crown">' + svg('crown', 'gold') + '</i>' : '') + '</span>' +
        '<span class="pc-m"><b class="pc-n"><span>' + esc(p.nick || ch) + '</span>' + (p.me ? '<em class="you">SEN</em>' : '') + '</b>' +
          '<span class="pc-c">' + esc(ch) + (p.waiting ? ' · izliyor' : '') + (dim ? ' · bağlantı yok' : '') + '</span></span>' +
        '<span class="pc-r">' + right + pingHtml(p.ping, p.me ? null : p.link) + '</span>' +
        (em && t - em.t < 3200 ? '<span class="pc-emo">' + esc(em.e) + '</span>' : '') +
      '</div>';
    });
    const n = list.length;
    const bots = cfg.bots ? clamp((cfg.fill || 4) - n, 0, 10 - n) : 0;
    for (let i = 0; i < bots; i++) h += '<div class="pc bot"><span class="pc-pt">' + svg('user') + '</span><span class="pc-m"><b class="pc-n"><span>Bot</span></b><span class="pc-c">Yarışta boş yeri doldurur</span></span></div>';
    for (let i = n + bots; i < 10; i++) h += '<div class="pc slot" data-act="share" role="button" tabindex="0"><span class="pc-pt">' + svg('users') + '</span><span class="pc-m"><b class="pc-n"><span>Boş yer</span></b><span class="pc-c">Dokun, arkadaşını davet et</span></span></div>';
    return h;
  }
  /** Sağ panel: iki sekme — ODA AYARLARI / ÇEVRİMİÇİ (arkadaşlar; KATIL / DAVET) */
  function lobbyFriendRows(d) {
    const inRoom = {}; d.pl.forEach(p => { inRoom[p.pid] = 1; });
    const myCode = String((d.lob && d.lob.code) || '');
    return people().filter(p => !p.me && p.online && !inRoom[p.pid] && !(p.st === 'lobby' && p.code && p.code === myCode));
  }
  function lobbySet(d) {
    const host = !!(d.lob && d.lob.isHost);
    const fr = lobbyFriendRows(d);
    const tabs = '<div class="ls-tabs" role="tablist">' +
      '<button class="ls-tab ' + (st.lbTab !== 'fr' ? 'on' : '') + '" role="tab" data-act="lbtab" data-t="set">' + svg('gear') + '<span>AYARLAR</span></button>' +
      '<button class="ls-tab ' + (st.lbTab === 'fr' ? 'on' : '') + '" role="tab" data-act="lbtab" data-t="fr"><i class="on-dot ' + (fr.length ? 'on' : '') + '"></i><span>ÇEVRİMİÇİ</span>' + (fr.length ? '<i class="badge sm">' + fr.length + '</i>' : '') + '</button></div>';
    if (st.lbTab === 'fr') {
      let rows = '';
      for (const p of fr) {
        const ch = FM.CH[p.char] ? p.char : 'TAFTAF';
        rows += '<div class="fo" data-act="prof" data-pid="' + esc(p.pid) + '" role="button"><span class="fo-pt">' + pt(ch, 40, { skin: p.skin }) + '<i class="on-dot ' + dotCls(p) + '"></i></span>' +
          '<span class="fo-m"><b>' + esc(p.nick || ch) + '</b>' + statusLine(p) + '</span>' +
          (joinable(p) ? '<button class="btn sm b-blue fo-b" data-act="joinroom" data-code="' + esc(p.code) + '">KATIL</button>'
            : '<button class="btn sm b-green fo-b" data-act="invite" data-nick="' + esc(p.nick || ch) + '">' + svg('share') + '<span>DAVET</span></button>') + '</div>';
      }
      if (!fr.length) rows = '<div class="fo-empty">' + svg('users') + '<b>Şu an çevrimiçi arkadaşın yok</b><span>Odan açıkken arkadaşların ÇEVRİMİÇİ listesinde odanı görür. Linki de paylaşabilirsin.</span></div>';
      return tabs + '<div class="fo-list scroll" data-sk="lb-fr">' + rows + '</div>' +
        '<button class="btn b-green fo-share" data-act="share">' + svg('share') + '<span>LİNKİ PAYLAŞ</span></button>';
    }
    const cfg = normCfg(d.lob && d.lob.cfg);
    const m = modeOf(cfg.mode);
    const arr = k => host
      ? ['<button class="rbtn b-dark ls-a" data-act="lcfg" data-k="' + k + '" data-d="-1" aria-label="Önceki">' + svg('chevL') + '</button>', '<button class="rbtn b-dark ls-a" data-act="lcfg" data-k="' + k + '" data-d="1" aria-label="Sonraki">' + svg('chevR') + '</button>']
      : ['', ''];
    const a = arr('mode'), b = arr('map');
    let rd = '';
    for (const n of [1, 3, 5]) rd += '<button class="rd ' + (n === cfg.rounds ? 'on' : '') + '" ' + (host ? 'data-act="lcfg" data-k="rounds" data-v="' + n + '"' : 'disabled') + ' aria-label="' + n + ' tur">' + n + '</button>';
    return tabs + (host ? '' : '<p class="ls-note">Ayarları ev sahibi seçer</p>') +
      '<div class="ls-row"><span class="ls-l">MOD</span>' + a[0] + '<span class="ls-v">' + anyIcon(m.ic, 32, 'ls-ic') + '<b>' + esc(m.n) + '</b></span>' + a[1] + '</div>' +
      '<p class="ls-d">' + esc(firstSentence(m.d)) + '</p>' +
      '<div class="ls-row"><span class="ls-l">HARİTA</span>' + b[0] + '<span class="ls-v ls-map ' + (cfg.map === 'random' ? 'rnd' : '') + '" style="' + mapBg(cfg.map) + '"><b>' + esc(mapName(cfg.map)) + '</b></span>' + b[1] + '</div>' +
      '<p class="ls-d">' + esc(mapMech(cfg.map)) + '</p>' +
      '<div class="ls-row ls-2"><span class="ls-l">TUR</span><span class="rd-o">' + rd + '</span>' +
        '<span class="ls-l ls-bl">BOT</span><button class="tgl ' + (cfg.bots ? 'on' : '') + '" ' + (host ? 'data-act="lcfg" data-k="bots"' : 'disabled') + ' role="switch" aria-checked="' + !!cfg.bots + '" aria-label="Botlar"><i></i><span class="tg-on">AÇIK</span><span class="tg-off">KAPALI</span></button></div>';
  }
  /** Otomatik başlama geri sayımı (5..1): FM.netgame.countdown() ya da son 'mp:countdown' olayı */
  function curCd(d) {
    if (d && d.cd !== undefined) return d.cd;
    const v = gcall('countdown');
    if (typeof v === 'number') return v;
    const c = st.cd;
    return c && c.left != null && nowMs() - c.t < 2500 ? c.left : null;
  }
  function lobbyCd(d) {
    const n = curCd(d);
    if (n != null) return '<div class="cd-in" data-n="' + n + '"><span class="cd-t">Herkes hazır!</span><b class="cd-n">' + n + '</b><span class="cd-s">Yarış başlıyor…</span></div>';
    const c = st.cd;
    if (c && c.msg && nowMs() - c.t < 3200) return '<div class="cd-in cd-x"><span class="cd-t">Geri sayım iptal edildi</span><span class="cd-s">' + esc(c.msg) + '</span></div>';
    return '';
  }
  function lobbyFoot(d) {
    const host = !!(d.lob && d.lob.isHost);
    const me = d.pl.find(p => p.me) || {};
    const humans = d.pl.filter(p => !p.off);
    const rdy = humans.filter(p => p.ready).length;
    const cd = curCd(d);
    const ch = FM.CH[me.char] ? me.char : selChar();
    let info;
    if (cd != null) info = '<b>' + cd + '</b> sn sonra başlıyor';
    else if (humans.length && rdy === humans.length) info = '<b>Herkes hazır!</b>';
    else info = '<b>' + rdy + '/' + humans.length + '</b> hazır<br>Herkes hazır olunca başlar';
    let h = '<button class="rbtn b-orange lf-emo" data-act="lbemo" aria-label="Emoji gönder" title="Emoji gönder">' + svg('smile') + '</button>' +
      '<button class="btn b-blue lf-ch" data-act="chpick"><span class="lf-pt">' + pt(ch, 44, { skin: me.skin || equipped('skins', ch) }) + '</span><span class="lf-ct"><em>KARAKTER</em><b>' + esc(ch) + '</b></span></button>' +
      '<div class="tb-sp"></div>' +
      '<span class="lf-info ' + (cd != null ? 'cd' : '') + '">' + info + '</span>' +
      '<button class="btn ' + (me.ready ? 'b-steel on' : 'b-green') + ' lf-rdy" data-act="lbready">' + svg('check') + '<span>' + (me.ready ? 'HAZIRSIN' : 'HAZIRIM') + '</span></button>';
    if (host) h += '<button class="btn b-gold lf-go" data-act="lbstart"><span class="shine"></span>' + svg('play') + '<span>HEMEN BAŞLAT</span></button>';
    return h;
  }
  function updateLobby(force) {
    if (st.view !== 'menu' || st.screen !== 'lobby') return;
    const d = lobbyData(); if (!d) return;
    const parts = [['.lb-code', lobbyCode], ['.lb-conn', lobbyConn], ['.lb-pl-in', lobbyPlayers], ['.lb-set', lobbySet], ['.lb-foot', lobbyFoot], ['.lb-cd', lobbyCd]];
    for (const p of parts) {
      const el = $(p[0], Ls.scr); if (!el) continue;
      let h = '';
      try { h = p[1](d); } catch (e) { console.error('[ui lobi]', e); continue; }
      if (force || el._h !== h) {
        const keep = el.querySelector ? el.querySelector('[data-sk]') : null, sc = keep ? keep.scrollTop : 0;
        el._h = h; el.innerHTML = h;
        if (keep) { const k2 = el.querySelector('[data-sk]'); if (k2) k2.scrollTop = sc; }
      }
    }
    const pl = $('.lb-pl-in', Ls.scr); if (pl) syncHint(pl);
  }

  /* =====================================================================
     15c) ÇEVRİMİÇİ + KLAN + PROFİL KARTLARI
          Yalnızca GERÇEK varlık verisi (FM.net.online / FM.net.profiles / FM.meta.card). Hiçbir sosyal veri uydurulmaz:
          veri yoksa boş durum gösterilir.
     ===================================================================== */
  const LG_FALLBACK = [
    { id: 'bronz', n: 'Bronz', col: '#d98a4a', min: 0 }, { id: 'gumus', n: 'Gümüş', col: '#c9d4e4', min: 300 },
    { id: 'altin', n: 'Altın', col: '#ffd23f', min: 800 }, { id: 'elmas', n: 'Elmas', col: '#5ee0ff', min: 1600 },
    { id: 'efsane', n: 'Efsane', col: '#ff5ad2', min: 3000 }
  ];
  /** Kupaya göre lig {id, n, col, min, next, nextN, idx, pct}: FM.meta.league varsa o, yoksa kupadan hesapla */
  function leagueOf(tr, lg) {
    const v = mcall('league', +tr || 0);
    if (v && typeof v === 'object' && v.n) return v;
    let i = 0;
    for (let j = 1; j < LG_FALLBACK.length; j++) if ((+tr || 0) >= LG_FALLBACK[j].min) i = j;
    const k = lg ? LG_FALLBACK.findIndex(x => x.id === lg) : -1;
    if (k >= 0) i = k;
    const L = LG_FALLBACK[i], N = LG_FALLBACK[i + 1] || null;
    return { id: L.id, n: L.n, col: L.col, min: L.min, next: N ? N.min : null, nextN: N ? N.n : null, idx: i, pct: N ? clamp(((+tr || 0) - L.min) / (N.min - L.min), 0, 1) : 1 };
  }
  function lgBadge(L, cls) {
    return '<span class="lg ' + (cls || '') + '" style="--lg:' + esc(L.col) + '" title="' + esc(L.n) + ' Ligi">' + svg('shieldL') + '<b>' + esc(L.n) + '</b></span>';
  }
  const myPid = () => (st.fakeNet ? 'me0' : String(ncall('pid') || ''));
  const onlineList = () => { const v = st.fakeNet ? st.fakeNet.online : ncall('online'); return Array.isArray(v) ? v.filter(p => p && p.pid) : []; };
  const profileList = () => { const v = st.fakeNet ? st.fakeNet.profiles : ncall('profiles'); return Array.isArray(v) ? v.filter(p => p && p.pid) : []; };
  function myCard() { const c = mcall('card'); return c && typeof c === 'object' ? c : null; }
  function stText(p) {
    if (!p.online) return 'çevrimdışı';
    switch (p.st) {
      case 'lobby': return 'Lobide' + (p.n ? ' · ' + (p.n | 0) + '/' + ((p.max | 0) || 10) : '');
      case 'race': return 'Yarışta';
      case 'solo': return 'Tek başına oynuyor';
      case 'away': return 'Uzakta';
      default: return 'Menüde';
    }
  }
  /** Açık lobisi olan, katılınabilecek oyuncu mu */
  const joinable = p => !!(p && !p.me && p.online && p.st === 'lobby' && p.code && p.open !== false && !((p.n | 0) >= ((p.max | 0) || 10)));
  /** Bilinen herkes: ben (FM.meta.card, her zaman en üstte) + profil kartları + kartı henüz gelmemiş çevrimiçi olanlar */
  function people() {
    const me = myPid(), onl = {}, out = [], seen = {};
    for (const o of onlineList()) onl[o.pid] = o;
    const mc = myCard() || {};
    const mo = onl[me];
    const self = { pid: me || 'me', me: true, online: !!mo, st: (mo && mo.st) || (mpInRoom() ? 'lobby' : 'menu'), nick: myNick(), char: mc.char || selChar(), skin: mc.skin || equipped('skins', selChar()),
      lvl: mc.lvl, tr: mc.tr != null ? mc.tr : undefined, play: mc.play, races: mc.races, wins: mc.wins, kills: mc.kills, best: mc.best, since: mc.since, lg: mc.lg };
    if (self.tr === undefined) { let t = 0; for (const id of FM.ORDER) t += trophies(id); self.tr = t; }
    if (self.lvl === undefined) self.lvl = levelInfo().level;
    if (self.play === undefined) { const pt0 = mcall('playTime'); if (typeof pt0 === 'number') self.play = pt0; }
    out.push(self); seen[self.pid] = 1;
    for (const p of profileList()) {
      if (seen[p.pid] || p.pid === me) continue;
      seen[p.pid] = 1;
      const o = onl[p.pid];
      out.push(Object.assign({}, p, { me: false, online: !!(o || p.online), st: (o && o.st) || p.st || 'menu', code: o && o.code, n: o && o.n, max: o && o.max, open: o && o.open, nick: (o && o.nick) || p.nick, char: (o && o.char) || p.char }));
    }
    for (const o of onlineList()) {
      if (seen[o.pid] || o.me || o.pid === me) continue;
      seen[o.pid] = 1;
      out.push({ pid: o.pid, me: false, online: true, st: o.st, nick: o.nick, char: o.char, code: o.code, n: o.n, max: o.max, open: o.open });
    }
    const rank = p => (p.me ? 0 : joinable(p) ? 1 : p.online && p.st !== 'away' ? 2 : p.online ? 3 : 4);
    return out.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || (a.p.online ? 0 : (+b.p.ls || 0) - (+a.p.ls || 0)) || (+b.p.tr || 0) - (+a.p.tr || 0) || a.i - b.i).map(x => x.p);
  }
  function dotCls(p) { return !p.online ? '' : p.st === 'away' ? 'away' : 'on'; }
  /** Durum satırı: yalnızca FM.net online === true bildirirse yeşil "Çevrimiçi"; yoksa tam son görülme (data-ls: canlı güncellenir) */
  function statusLine(p) {
    if (p.me) return p.online ? '<span class="cm-st on">Çevrimiçi · sen</span>' : '<span class="cm-st">Şu an oyundasın</span>';
    if (p.online) return '<span class="cm-st ' + (p.st === 'away' ? 'away' : 'on') + '">' + (p.st === 'away' ? '' : 'Çevrimiçi · ') + esc(stText(p)) + '</span>';
    return '<span class="cm-st" data-ls="' + (+p.ls > 0 ? Math.round(+p.ls) : 0) + '">son görülme: ' + esc(fmtAgo(p.ls)) + '</span>';
  }
  function personRow(p, i) {
    const L = leagueOf(p.tr, p.lg), ch = FM.CH[p.char] ? p.char : 'TAFTAF';
    return '<div class="cm ' + (p.me ? 'me ' : '') + (p.online ? 'is-on ' : 'is-off ') + '" data-act="prof" data-pid="' + esc(p.pid) + '" role="button" style="--d:' + (Math.min(i, 8) * .04).toFixed(2) + 's">' +
      '<span class="cm-pt">' + pt(ch, 64, { skin: p.skin }) + '<i class="on-dot ' + dotCls(p) + '"></i></span>' +
      '<span class="cm-id"><b><span class="cm-n">' + esc(p.nick || ch) + '</span>' + (p.me ? '<em class="you">SEN</em>' : '') + '</b>' + statusLine(p) + '</span>' +
      '<span class="cm-lgc">' + (p.tr != null ? lgBadge(L, 'sm') : '') + '</span>' +
      '<span class="cm-play" title="Oynama süresi: ' + esc(fmtPlay(p.play)) + '">' + svg('clock', 'cm-ci') + '<b>' + esc(fmtPlayShort(p.play)) + '</b></span>' +
      '<span class="cm-tr" title="Toplam kupa">' + trophyI(32, 'cm-tri') + '<b>' + (p.tr != null ? fmtN(p.tr) : '—') + '</b></span>' +
      (joinable(p) ? '<button class="btn sm b-green cm-join" data-act="joinroom" data-code="' + esc(p.code) + '">KATIL</button>' : '<span class="cm-chev">' + svg('chevR') + '</span>') +
    '</div>';
  }
  function renderOnline() {
    const all = people().filter(p => p.online || p.me), others = all.filter(p => !p.me);
    let rows = '';
    all.forEach((p, i) => { rows += personRow(p, i); });
    if (!others.length) rows += '<div class="onl-empty">' + emptyBox('users', 'Şu an kimse çevrimiçi değil', 'Arkadaşların oyunu açınca burada görünür. Birini çağırmak için ARKADAŞLARLA › oda kur, linki paylaş.') + '</div>';
    const open = others.filter(joinable).length;
    return panel('ÇEVRİMİÇİ',
      '<div class="onl-wrap">' +
        '<div class="onl-sum"><span class="on-dot on big"></span><b>' + others.length + '</b><span>arkadaşın çevrimiçi' + (open ? ' · <em>' + open + ' açık lobi</em>' : '') + '</span>' +
          '<button class="btn sm b-green" data-act="go" data-to="friends">' + svg('users') + '<span>ODA KUR</span></button></div>' +
        '<div class="cl-list"><div class="cl-hd cl-hd2"><span>Oyuncu</span><span>Lig</span><span>Süre</span><span>Kupa</span></div>' +
        '<div class="scroll cl-rows" data-sk="online">' + rows + '</div></div>' +
      '</div>', 'pnl-onl', 'rb-green');
  }
  function renderClan() {
    const ppl = people(), me = ppl.find(p => p.me) || ppl[0];
    const onlN = ppl.filter(p => p.online).length, others = ppl.filter(p => !p.me);
    const totTr = ppl.reduce((s, p) => s + (+p.tr || 0), 0), totPlay = ppl.reduce((s, p) => s + (+p.play || 0), 0);
    const L = leagueOf(me.tr, me.lg);
    let rows = '';
    ppl.forEach((p, i) => { rows += personRow(p, i); });
    if (!others.length) rows += '<div class="onl-empty">' + emptyBox('users', 'Henüz kimse görünmüyor', 'Arkadaşların oyunu açınca burada görünür.') + '</div>';
    const prog = L.next != null
      ? '<span class="cs cs-lg"><span class="cs-lgh">' + lgBadge(L) + '</span><span class="bar bar-lg"><i style="width:' + Math.round((L.pct || 0) * 100) + '%"></i></span><em>' + fmtN(Math.max(0, L.next - (+me.tr || 0))) + ' kupa daha: ' + esc(L.nextN || 'sonraki lig') + '</em></span>'
      : '<span class="cs cs-lg"><span class="cs-lgh">' + lgBadge(L) + '</span><em>En yüksek lig!</em></span>';
    const side =
      '<div class="cl-side">' +
        '<div class="cl-flag"><div class="cl-glow"></div><canvas data-art="flag" aria-label="Klan bayrağı"></canvas></div>' +
        '<div class="cl-name">FUAT MOREL</div>' +
        '<div class="cl-tag">' + svg('spade') + 'Kırmızı-siyah maçanın klanı</div>' +
        '<div class="cl-stats">' +
          '<span class="cs">' + trophyI(32, 'cs-i') + '<b>' + fmtN(totTr) + '</b><em>Toplam Kupa</em></span>' +
          '<span class="cs">' + svg('users', 'cs-i') + '<b>' + ppl.length + '</b><em>Oyuncu</em></span>' +
          '<span class="cs"><i class="on-dot on big"></i><b>' + onlN + '</b><em>Çevrimiçi</em></span>' +
          '<span class="cs">' + svg('clock', 'cs-i') + '<b>' + esc(fmtPlay(totPlay)) + '</b><em>Birlikte oynanan</em></span>' +
          prog +
        '</div>' +
      '</div>';
    return panel('KLAN',
      '<div class="cl-wrap">' + side +
        '<div class="cl-list"><div class="cl-hd cl-hd2"><span>Oyuncu</span><span>Lig</span><span>Süre</span><span>Kupa</span></div>' +
        '<div class="scroll cl-rows" data-sk="clan">' + rows + '</div></div>' +
      '</div>', 'pnl-clan', 'rb-dark');
  }
  /** Oyuncu ayrıntı sayfası: oynama süresi, kupa, lig, yarış/birincilik, en çok oynanan karakter, "Sana karşı" */
  function openProfile(pid) {
    const p = people().find(x => x.pid === pid);
    if (!p) return;
    const L = leagueOf(p.tr, p.lg), ch = FM.CH[p.char] ? p.char : 'TAFTAF';
    const best = FM.CH[p.best] ? p.best : null;
    let h2h = null;
    if (!p.me) { const all = st.fakeNet ? st.fakeNet.h2h : mcall('h2h'); h2h = all && all[p.pid] ? all[p.pid] : null; }
    const cell = (ic, lbl, val) => '<div class="pf-c"><span class="pf-ci">' + ic + '</span><em>' + lbl + '</em><b>' + val + '</b></div>';
    const wr = (+p.races > 0 && p.wins != null) ? ' <small>(%' + Math.round((+p.wins || 0) / p.races * 100) + ')</small>' : '';
    openModal('prof',
      '<div class="pnl pnl-prof">' + ribbon(esc(up(p.nick || ch)), p.online ? 'rb-green' : 'rb-dark') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="pf-body">' +
          '<div class="pf-l"><span class="pf-pt">' + pt(ch, 120, { skin: p.skin }) + '<i class="on-dot big2 ' + dotCls(p) + '"></i></span>' +
            lgBadge(L) + statusLine(p).replace('cm-st', 'pf-st') +
            (p.me ? '<em class="you">SEN</em>' : '') + '</div>' +
          '<div class="pf-r"><div class="pf-g">' +
            cell(svg('clock'), 'Oynama süresi', esc(fmtPlay(p.play))) +
            cell(trophyI(28), 'Toplam kupa', p.tr != null ? fmtN(p.tr) : '—') +
            cell(svg('star', 'gold'), 'Seviye', p.lvl != null ? fmtN(p.lvl) : '—') +
            cell(svg('flag'), 'Yarış', p.races != null ? fmtN(p.races) : '—') +
            cell(svg('crown', 'gold'), 'Birincilik', p.wins != null ? fmtN(p.wins) + wr : '—') +
            cell(best ? pt(best, 36, {}) : svg('user'), 'En çok oynadığı', best ? esc(best) : '—') +
          '</div>' +
          (p.since ? '<div class="pf-since">İlk oynama: ' + esc(fmtDate(p.since)) + '</div>' : '') +
          (h2h ? '<div class="pf-h2h"><span>Sana karşı</span><b class="w">' + (h2h.w | 0) + '</b><i>–</i><b class="l">' + (h2h.l | 0) + '</b><em>sen ' + (h2h.w | 0) + ' kez, ' + esc(p.nick || ch) + ' ' + (h2h.l | 0) + ' kez önde bitirdi</em></div>'
                      : (!p.me ? '<div class="pf-h2h none"><span>Sana karşı</span><em>Henüz aynı yarışta olmadınız</em></div>' : '')) +
          '</div>' +
        '</div>' +
        '<div class="cf-btns">' + (joinable(p) ? '<button class="btn b-green cf-ok" data-act="joinroom" data-code="' + esc(p.code) + '">' + svg('play') + '<span>LOBİYE KATIL</span></button>' : '<button class="btn b-steel" data-act="mclose">KAPAT</button>') + '</div>' +
      '</div>');
  }
  function joinCode(code) {
    code = String(code || '').trim();
    if (!code) return;
    if (st.modal === 'prof') closeModalHard();
    if (mpInRoom() && ncall('code') === code) { showScreen('lobby'); return; }
    if (st.view !== 'menu') { note({ title: 'Yarış sürüyor', sub: 'Yarıştan sonra katılabilirsin.', icon: svg('info'), cls: 'n-tip', ms: 1800 }); return; }
    const go = () => withNick(() => mpJoin(code));
    if (mpInRoom()) confirmBox({ title: 'ODA DEĞİŞTİR', rcls: 'rb-purple', art: '<div class="cf-art cf-warn">' + svg('door') + '</div>', text: 'Odandan ayrılıp <b>' + esc(code) + '</b> odasına katılmak ister misin?', ok: svg('play') + '<span>KATIL</span>', okCls: 'b-green', onOk: () => { setTimeout(go, 0); return true; } });
    else go();
  }
  /** Menüdeki ÇEVRİMİÇİ düğmesinin sayısını yerinde güncelle (tüm menüyü yeniden çizmeden) */
  function updateOnlinePill() {
    const el = $('.tb-onl', Ls.scr); if (!el) return;
    const n = onlineList().filter(p => !p.me && p.pid !== myPid()).length;
    el.classList.toggle('has', n > 0);
    const b = $('.onl-n', el); if (b) b.textContent = '(' + n + ')';
    const d = $('.on-dot', el); if (d) d.classList.toggle('on', n > 0);
  }
  function onlinePillHtml() {
    const n = onlineList().filter(p => !p.me && p.pid !== myPid()).length;
    return '<button class="btn sm b-green tb-onl ' + (n > 0 ? 'has' : '') + '" data-act="go" data-to="online" aria-label="Çevrimiçi arkadaşlar" title="Çevrimiçi arkadaşlar"><i class="on-dot ' + (n > 0 ? 'on' : '') + '"></i><span class="onl-t">ÇEVRİMİÇİ</span><b class="onl-n">(' + n + ')</b></button>';
  }

  /* ---------- arkadaş bildirimleri (§8.4): uygulama içi kart + (arka plandayken, izin varsa) sistem bildirimi ---------- */
  function friendNote(kind, p) {
    if (!p || p.me || (p.pid && p.pid === myPid())) return;
    const nick = p.nick || p.char || 'Arkadaşın';
    const lob = kind === 'lobby' && p.code;
    const title = lob ? nick + ' oda kurdu!' : nick + ' oyuna girdi!';
    const sub = lob ? 'Lobide · ' + ((p.n | 0) || 1) + '/' + ((p.max | 0) || 10) + ' — katıl, birlikte yarışın' : stText(Object.assign({ online: true }, p));
    if (document.hidden) { sysNotify(title + (lob ? ' Katılmak için dokun.' : ''), p); return; }
    const canJoin = lob && st.view === 'menu' && !mpInRoom();
    const race = st.view === 'race';
    if (!race) FM.haptic('pick');   // yarışta titreşim yok (oyun titreşimleriyle karışmasın); küçük ve kısa bildirim
    note({ title, sub: race ? '' : sub, icon: pt(FM.CH[p.char] ? p.char : 'TAFTAF', 48, {}, 'n-pt'), cls: 'n-friend' + (lob ? ' n-lobby' : '') + (race ? ' n-mini' : ''), ms: race ? 2600 : lob ? 7000 : 4200,
      btn: canJoin ? '<button class="btn sm b-green n-btn" data-act="joinroom" data-code="' + esc(p.code) + '">KATIL</button>' : '' });
  }
  function sysNotify(body, p) {
    try {
      if (!setting('notify') || notifPerm() !== 'granted') return false;
      const code = p && p.code ? String(p.code) : '';
      const abs = u => { try { return new URL(u, location.href).href; } catch (e) { return u; } };
      const opts = { body, icon: abs('icons/icon-192.png'), badge: abs('icons/favicon-64.png'), tag: 'fm-' + (code ? 'lobi-' : 'cevrimici-') + ((p && p.pid) || 'x'), renotify: true, data: { code, pid: p && p.pid } };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification('Fuat Morel', opts)).catch(() => { try { new Notification('Fuat Morel', opts); } catch (e) { /* yok say */ } });
      } else new Notification('Fuat Morel', opts);
      return true;
    } catch (e) { return false; }
  }
  /** Ayarlar › Bildirimler anahtarı: açarken (kullanıcı hareketiyle) izin iste */
  function toggleNotify(el) {
    const on = !!setting('notify') && notifPerm() === 'granted';
    const paint2 = v => { setSetting('notify', v); if (el && el.isConnected) { el.classList.toggle('on', v); el.setAttribute('aria-checked', String(v)); } };
    if (on) { paint2(false); return; }
    const perm = notifPerm();
    if (perm === 'none') { note({ title: 'Bildirim desteklenmiyor', sub: 'Bu tarayıcı bildirim gösteremiyor.', icon: svg('bell'), cls: 'n-err', ms: 2600 }); refreshSoon(); return; }
    if (perm === 'denied') { note({ title: 'Bildirim izni kapalı', sub: 'Tarayıcı ayarlarından bu site için izin ver.', icon: svg('bell'), cls: 'n-err', ms: 3200 }); refreshSoon(); return; }
    const done = r => {
      if (r === 'granted') { paint2(true); note({ title: 'Bildirimler açık', sub: 'Arkadaşın çevrimiçi olunca haber verilecek.', icon: svg('bell'), cls: 'n-ok', ms: 2400 }); }
      else { paint2(false); note({ title: 'İzin verilmedi', sub: 'Bildirimler kapalı kaldı.', icon: svg('bell'), cls: 'n-err', ms: 2400 }); }
      refreshSoon();
    };
    if (perm === 'granted') { done('granted'); return; }
    try {
      const r = Notification.requestPermission(done);
      if (r && typeof r.then === 'function') r.then(done, () => done('denied'));
    } catch (e) { done('denied'); }
  }

  const SCREENS = { menu: renderMenu, chars: renderChars, shop: renderShop, missions: renderMissions, clan: renderClan, settings: renderSettings, help: renderHelp, solo: renderSolo, friends: renderFriends, lobby: renderLobby, online: renderOnline };
  const NO_TB = { lobby: 1 };

  /* =====================================================================
     16) EKRAN ÇİZİMİ / GEZİNME
     ===================================================================== */
  let ticker = 0;
  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      const els = $$('[data-reset]');
      if (!els.length) { stopTicker(); return; }
      const txt = fmtClock(secsToReset());
      for (const el of els) el.textContent = txt;
    }, 1000);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = 0; } }

  /* ---------- kaydırma ipucu: taşan alanın alt kenarında zıplayan ok (alan bir kez kaydırılınca bir daha çıkmaz) ---------- */
  const scrolledOnce = {};
  function hintKey(el) { return el.getAttribute('data-sk') || el.className.split(' ')[0] || 'x'; }
  function syncHint(el) {
    const h = el._hint;
    if (!h || !h.isConnected) return;
    const max = el.scrollHeight - el.clientHeight;
    const on = max > 12 && el.scrollTop < max - 12 && !scrolledOnce[hintKey(el)] && el.clientHeight > 40;
    // alt kenarın ortasında, kenarı ikiye bölerek: sağa yaslı değerlerin (fiyat, puan) ve sola yaslı yazıların üstüne binmesin
    if (on) { h.style.left = (el.offsetLeft + el.clientWidth / 2) + 'px'; h.style.top = (el.offsetTop + el.clientHeight) + 'px'; }
    h.classList.toggle('on', on);
  }
  function scrollHints(box) {
    if (!box) return;
    const els = $$('.scroll', box);
    for (const el of els) {
      if (!el._hint) {
        const h = document.createElement('i');
        h.className = 'sc-hint'; h.setAttribute('aria-hidden', 'true'); h.innerHTML = svg('chevR');
        el.parentNode.insertBefore(h, el.nextSibling);
        el._hint = h;
        el.addEventListener('scroll', () => { if (el.scrollTop > 10) scrolledOnce[hintKey(el)] = true; syncHint(el); }, { passive: true });
      }
      syncHint(el);
    }
    // giriş animasyonları (ölçek) bitince taşmayı yeniden ölç
    clearTimeout(scrollHints.t);
    scrollHints.t = setTimeout(() => { for (const el of els) if (el.isConnected) syncHint(el); }, 700);
  }
  function cssKey(k) { return (window.CSS && CSS.escape) ? CSS.escape(k) : String(k).replace(/["\\]/g, '\\$&'); }

  function paint(anim) {
    const name = st.screen;
    if (!SCREENS[name]) return;
    const keep = {};
    if (!anim) for (const el of $$('[data-sk]', Ls.scr)) keep[el.getAttribute('data-sk')] = el.scrollTop;
    stopShowcases();
    let html = '';
    try { html = SCREENS[name](); }
    catch (e) { console.error('[ui ekran ' + name + ']', e); html = '<div class="body">' + emptyBox('info', 'Bir şeyler ters gitti', 'Menüye dönüp tekrar dene.') + '</div>'; }
    Ls.scr.classList.toggle('no-anim', !anim);
    Ls.scr.innerHTML = '<div class="scr scr-' + name + (name === 'menu' ? '' : ' sub') + '">' + (NO_TB[name] ? '' : topbar(name !== 'menu')) + html + '</div>';
    if (name === 'lobby') updateLobby(true);
    for (const el of $$('[data-sk]', Ls.scr)) { const k = el.getAttribute('data-sk'); if (keep[k]) el.scrollTop = keep[k]; }
    mountArt(Ls.scr);
    scrollHints(Ls.scr);
    if (st.flashKey) {
      const el = Ls.scr.querySelector('[data-k="' + cssKey(st.flashKey) + '"]');
      if (el) el.classList.add('flash');
      st.flashKey = null;
    }
    // üst çubuktaki para değişimini say
    const c = coins(), g = gems();
    if (st.lastCur) {
      if (st.lastCur.c !== c) bumpCur('coins', st.lastCur.c, c);
      if (st.lastCur.g !== g) bumpCur('gems', st.lastCur.g, g);
    }
    st.lastCur = { c, g };
    if (name === 'missions' || (name === 'shop' && st.tabs.shop === 'vitrin')) startTicker(); else stopTicker();
  }
  function bumpCur(cur, from, to) {
    const pill = $('.cur[data-cur="' + cur + '"]');
    if (!pill) return;
    const b = pill.querySelector('b');
    if (b) countUp(b, from, to, 650, fmtN);
    pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
  }
  function showScreen(name) {
    if (!SCREENS[name]) name = 'menu';
    if (name !== 'chars') st.cview = null;
    st.view = 'menu'; st.screen = name;
    setNotesPos();
    hideRaceLayer(); clearResults(); clearFinal();
    if (st.modal && st.modal !== 'daily' && st.modal !== 'mperr') closeModalHard();
    showLayer('scr', true);
    paint(true);
    syncIab();
  }
  function goBack() {
    if (st.screen === 'lobby') { ACT.lbleave(); return; }
    if (st.screen && st.screen !== 'menu') showScreen('menu');
  }
  let rfr = 0;
  function refreshSoon() {
    if (rfr) return;
    rfr = requestAnimationFrame(() => { rfr = 0; refreshNow(); });
  }
  function refreshNow() {
    if (st.view === 'menu' && st.screen) paint(false);
    if (st.modal === 'daily') { const el = $('.dly', Ls.mdl); if (el) el.innerHTML = dailyCal(); }
  }
  function updateShowcaseOnly() {
    const box = $('.mm-r', Ls.scr);
    if (!box) { paint(false); return; }
    stopShowcases();
    const id = selChar();
    box.innerHTML = showcaseBlock(id, equipped('skins', id));
    box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');
    mountArt(box);
  }

  /* =====================================================================
     17) MODALLAR (onay, günlük ödül, duraklatma)
     ===================================================================== */
  function openModal(kind, html, lock) {
    st.modal = kind;
    Ls.mdl.innerHTML = '<div class="mdl-bg" ' + (lock ? '' : 'data-act="mclose"') + '></div><div class="mdl mdl-' + kind + '">' + html + '</div>';
    showLayer('mdl', true);
    mountArt(Ls.mdl);
  }
  function closeModalHard() { st.modal = null; st.onOk = null; showLayer('mdl', false); Ls.mdl.innerHTML = ''; }
  function closeModal() {
    if (st.modal === 'pause') { resumeGame(); return; }
    closeModalHard();
  }
  function okModal(btn) {
    const fn = st.onOk;
    let r;
    if (typeof fn === 'function') { try { r = fn(btn); } catch (e) { console.error('[ui onay]', e); } }
    if (r !== false) closeModalHard();
  }
  function confirmBox(o) {
    openModal('confirm',
      '<div class="pnl pnl-sm">' + ribbon(o.title, o.rcls || 'rb-red') +
        '<div class="cf-body">' + (o.art || '') + '<p class="cf-t">' + o.text + '</p></div>' +
        '<div class="cf-btns"><button class="btn b-steel" data-act="mclose">' + (o.cancel || 'VAZGEÇ') + '</button>' +
        '<button class="btn ' + (o.okCls || 'b-green') + ' cf-ok" data-act="mok">' + o.ok + '</button></div>' +
      '</div>');
    st.onOk = o.onOk;
  }
  function openDaily() {
    openModal('daily',
      '<div class="pnl pnl-daily">' + ribbon('GÜNLÜK ÖDÜL', 'rb-gold') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<p class="dly-sub">Her gün giriş yap, seriyi bozma: 7. gün büyük ödül!</p>' +
        '<div class="dly">' + dailyCal() + '</div>' +
      '</div>');
    startTicker();
  }

  /* ---------- duraklatma ---------- */
  /** Duraklatma yalnızca geri sayım ve yarışta açılabilir: 'end' modunda (1.5 sn) kürsüye geçiş zamanlayıcısı
      duraklamayı beklemez; orada açılan duraklatma sonraki turu kilitliyordu. */
  function canPause() { return S.mode === 'count' || S.mode === 'race'; }
  function pauseHtml() {
    const th = S.L && S.L.theme ? S.L.theme.n : '';
    // çok oyunculu: duraklatma yok, yarış sürer → küçük menü (yarışa dön, sesler, odadan ayrıl)
    if (mpLive()) return '<div class="pnl pnl-pause pz-mp">' + ribbon('MENÜ', 'rb-purple') +
      '<div class="pz-sub">' + svg('users') + 'YARIŞ SÜRÜYOR · TUR ' + (S.round || 1) + ' / ' + (S.ROUNDS || 1) + '</div>' +
      '<button class="btn b-green btn-big pz-go" data-act="resume">' + svg('play') + '<span>YARIŞA DÖN</span></button>' +
      '<div class="pz-set">' + sliderRow('music', 'Müzik', 'music') + sliderRow('sfx', 'Efektler', 'sound') + '</div>' +
      '<button class="btn b-red pz-quit" data-act="quit" data-t="ODADAN AYRIL">' + svg('door') + '<span class="q-t">ODADAN AYRIL</span></button>' +
    '</div>';
    return '<div class="pnl pnl-pause">' + ribbon('DURAKLATILDI', 'rb-purple') +
      '<div class="pz-sub">' + svg('flag') + 'TUR ' + (S.round || 1) + ' / ' + (S.ROUNDS || 1) + (th ? ' · ' + esc(th) : '') + '</div>' +
      '<button class="btn b-green btn-big pz-go" data-act="resume">' + svg('play') + '<span>DEVAM</span></button>' +
      '<div class="pz-set">' + sliderRow('music', 'Müzik', 'music') + sliderRow('sfx', 'Efektler', 'sound') + toggleRow('shake', 'Sarsıntı', 'shake') + (touchMode ? toggleRow('haptic', 'Titreşim', 'wind') : '') + '</div>' +
      '<button class="btn b-red pz-quit" data-act="quit">' + svg('home') + '<span class="q-t">MENÜYE DÖN</span></button>' +
    '</div>';
  }
  function openPause() {
    if (!mpLive()) S.paused = true;          // ağ yarışında simülasyon durmaz (main.js), oyun durumunu da değiştirme
    releaseAllTouch();
    st.quitArm = 0;
    openModal('pause', pauseHtml(), true);
  }
  function resumeGame() {
    if (Ls.rot.classList.contains('on')) return;     // telefon hâlâ dik
    closeModalHard();
    S.paused = false;
    st.pausedByRot = false;
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* yok say */ }
  }
  function doQuit() {
    closeModalHard();
    S.paused = false;
    releaseAllTouch();
    if (FM.game && typeof FM.game.quitRace === 'function') FM.game.quitRace();
    else showScreen('menu');
  }

  /* =====================================================================
     18) YARIŞ KATMANI: duraklatma düğmesi + dokunmatik kontroller
     ===================================================================== */
  // ?touch=0/1 her şeyi ezer; ?mobile=1 (sözleşme: masaüstünde telefon düzeni) dokunmatik düzeni de açar.
  // maxTouchPoints tek başına sayılmaz (dokunmatik ekranlı dizüstüler fareyle oynar; ilk dokunuşta setTouch(true) devreye girer).
  let touchMode = (function () {
    const P = FM.params || {};
    if (P.touch != null) return P.touch === '1';
    if (P.mobile === '1') return true;
    try { return !!((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window)); } catch (e) { return false; }
  })();
  FM.isTouch = touchMode;
  const aimMark = '<i class="tb-can" aria-hidden="true">' + svg('aim') + '</i><span class="tb-aim" aria-hidden="true"><i class="am-ln"></i><i class="am-hd"></i></span>';
  Ls.race.innerHTML =
    '<button class="rbtn b-purple pz-btn" data-act="pause" aria-label="Duraklat" title="Duraklat (Esc)">' + svg('pause') + '</button>' +
    '<div class="tc">' +
      '<div class="tbtn tb-slide" data-tc="slide" role="button" aria-label="Kay"><span class="tb-in">' + svg('down', 'tb-ico') + '<b>KAY</b></span></div>' +
      '<div class="tbtn tb-item" data-tc="item" role="button" aria-label="Eşya"><span class="tb-in"><span class="tb-itm"></span><b class="tb-lb">EŞYA</b></span>' + aimMark + '</div>' +
      '<div class="tbtn tb-power" data-tc="power" role="button" aria-label="Özel güç"><span class="tb-ring"></span><span class="tb-in"><span class="tb-pp"></span><b class="tb-lb">GÜÇ</b></span>' + aimMark + '</div>' +
      '<div class="tbtn tb-jump" data-tc="jump" role="button" aria-label="Zıpla"><span class="tb-in">' + svg('up', 'tb-ico') + '<b>ZIPLA</b></span></div>' +
      '<div class="tc-hint" aria-hidden="true"><span class="th-t">Basılı tut, sürükle, bırak!</span></div>' +
      '<div class="tc-cancel" aria-hidden="true"><span>✕</span><b>İPTAL</b></div>' +
    '</div>' +
    '<button class="rbtn b-orange emo-btn" data-act="emotog" aria-label="Emoji gönder" title="Emoji gönder">' + svg('smile') + '</button>' +
    '<div class="emo emo-race">' + ['👍', '😂', '😎', '😡', '🔥', '💀', '👋', 'GG'].map(e => '<button class="emo-b" data-act="emo" data-e="' + e + '">' + e + '</button>').join('') + '</div>' +
    '<button class="btn b-gold sp-skip" data-act="skipres">' + svg('flag') + '<span>SONUÇLARA GEÇ</span></button>';
  // emoji düğmeleri: başka parmak ZIPLA'ya basılıyken 'click' gelmez → pointerup ile çalıştır
  Ls.race.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    const el = e.target && e.target.closest ? e.target.closest('[data-act="emotog"],[data-act="emo"]') : null;
    if (!el || !Ls.race.contains(el)) return;
    st.emT = nowMs(); click();
    try { ACT[el.getAttribute('data-act')](el); } catch (err) { console.error('[ui emoji]', err); }
  });
  // Duraklat: başka bir parmak ZIPLA/KAY'a basılıyken tarayıcı ikinci parmak için 'click' üretmez → pointerup ile de aç
  const pzEl = Ls.race.querySelector('.pz-btn');
  if (pzEl) pzEl.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse' || st.modal === 'pause') return;
    if (!canPause()) return;
    st.pzT = nowMs(); click(); openPause();
  });
  const TC = { jump: new Set(), slide: new Set(), item: new Set(), power: new Set() };
  const tcEls = {};
  for (const el of $$('.tbtn', Ls.race)) {
    const k = el.getAttribute('data-tc');
    tcEls[k] = el;
    el.addEventListener('pointerdown', tcDown);
    el.addEventListener('pointerup', tcUp);
    el.addEventListener('pointercancel', tcUp);
    el.addEventListener('pointerleave', tcUp);
    el.addEventListener('lostpointercapture', tcUp);
    if (k === 'item' || k === 'power') el.addEventListener('pointermove', aimMove);
  }
  Ls.race.addEventListener('contextmenu', e => e.preventDefault());
  function raceInput() { return (S.mode === 'race' || S.mode === 'count') && !S.paused; }

  /* ---------- yönlü atış (EŞYA / GÜÇ): bas → sürükle → bırak ----------
     FM.game.aimable(kind) false (ya da yok) → eskisi gibi basınca hemen kullanılır.
     true → basınca FM.input.aim = 'item'|'ab'; parmağın bastığı noktaya göre yönü (ax, ay birim vektör) güncellenir;
     ~18 px'ten az hareket = ölü bölge (0, 0 = varsayılan yön). Bırakınca use/ab = true, aim = null (ax, ay son yönü tutar).
     Nişan parmağı PENCERE düzeyinde izlenir: parmak düğmeden çıksa, tarayıcı yakalamayı bıraksa (pointerleave /
     lostpointercapture) ya da sistemi bir hareket kesse (pointercancel) bile atış KAYBOLMAZ — son yönde atılır
     (önceden düğmeden taşan sürüklemede eşya elde kalıyordu). Bir anda tek nişan; ZIPLA/KAY'a başka parmakla basmak serbest. */
  const AIM_DEAD = 18, AIM_MAX = 110;
  const AIM = { k: null, id: -1, x0: 0, y0: 0, el: null, ax: 0, ay: 0, dz: true, tc: null };
  function aimWinMove(e) { if (AIM.k && e.pointerId === AIM.id) aimTrack(e); }
  function aimWinUp(e) { if (AIM.k && e.pointerId === AIM.id) aimRelease(e.pointerId); }
  function aimListen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    window[f]('pointermove', aimWinMove, true); window[f]('pointerup', aimWinUp, true); window[f]('pointercancel', aimWinUp, true);
  }
  /** Nişan parmağı kalktı (nerede olursa olsun): düğmenin basılı durumunu temizle ve son yönde at */
  function aimRelease(pid) {
    const k = AIM.tc, el = AIM.el, set = k && TC[k];
    if (set) { set.delete(pid); if (!set.size && el) el.classList.remove('down'); }
    const cancel = AIM.cancel;
    aimEnd(!cancel);
    if (cancel) { FM.haptic('tap'); sfx('back'); }
  }
  /* İPTAL bölgesi: nişan alırken düğmenin yukarısında belirir; parmak orada kalkarsa eşya/güç kullanılmaz (elde kalır). */
  function cancelEl() { return $('.tc-cancel', Ls.race); }
  function cancelShow(on) {
    const c = cancelEl(); if (!c) return;
    if (!on) { c.classList.remove('on', 'hot'); AIM.cancel = false; return; }
    const b = AIM.el && AIM.el.getBoundingClientRect(), host = Ls.race.getBoundingClientRect(); if (!b) return;
    const sz = Math.max(58, b.width * .78), cx = b.left + b.width / 2 - host.left, top = Math.max(8, b.top - host.top - sz * 2.35);
    c.style.width = c.style.height = sz + 'px';
    c.style.left = (cx - sz / 2) + 'px'; c.style.top = top + 'px';
    c.classList.add('on'); c.classList.remove('hot'); AIM.cancel = false;
  }
  function cancelHit(e) {
    const c = cancelEl(); if (!c || !c.classList.contains('on')) return false;
    const r = c.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), rad = r.width * .62;
    return dx * dx + dy * dy < rad * rad;
  }
  function aimable(kind) {
    try { return !!(FM.game && typeof FM.game.aimable === 'function' && FM.game.aimable(kind)); } catch (e) { return false; }
  }
  function aimVis(on) {
    const el = AIM.el; if (!el) return;
    el.classList.toggle('aiming', !!on);
    if (!on) { el.classList.remove('dz', 'armed'); el.style.removeProperty('--a'); el.style.removeProperty('--len'); }
  }
  function aimStart(el, kind, e) {
    const I = FM.input; if (!I) return false;
    AIM.k = kind; AIM.id = e.pointerId; AIM.x0 = e.clientX; AIM.y0 = e.clientY; AIM.el = el; AIM.ax = 0; AIM.ay = 0; AIM.dz = true; AIM.tc = el.getAttribute('data-tc');
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* yakalama yok: pencere dinleyicileri yine izler */ }
    aimListen(true);
    cancelShow(true);
    I.aim = kind; I.ax = 0; I.ay = 0;
    el.classList.add('aiming', 'dz'); el.classList.remove('armed');
    el.style.setProperty('--len', '0px');
    FM.haptic('aim');
    aimHintDone();
    return true;
  }
  function aimMove(e) { if (AIM.k && e.pointerId === AIM.id && e.currentTarget === AIM.el) aimTrack(e); }
  function aimTrack(e) {
    const I = FM.input; if (!I || !AIM.el) return;
    const hot = cancelHit(e);
    if (hot !== !!AIM.cancel) { AIM.cancel = hot; const c = cancelEl(); if (c) c.classList.toggle('hot', hot); if (hot) FM.haptic('aim'); }
    const dx = e.clientX - AIM.x0, dy = e.clientY - AIM.y0, d = Math.sqrt(dx * dx + dy * dy);
    const el = AIM.el;
    if (d < AIM_DEAD) {
      if (!AIM.dz) { AIM.dz = true; el.classList.add('dz'); el.classList.remove('armed'); }
      AIM.ax = 0; AIM.ay = 0; I.ax = 0; I.ay = 0;
      return;
    }
    if (AIM.dz) { AIM.dz = false; el.classList.remove('dz'); el.classList.add('armed'); FM.haptic('aim'); }
    AIM.ax = Math.round(dx / d * 100) / 100; AIM.ay = Math.round(dy / d * 100) / 100;
    I.ax = AIM.ax; I.ay = AIM.ay;
    el.style.setProperty('--a', (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + 'deg');
    el.style.setProperty('--len', (14 + Math.min(AIM_MAX, d - AIM_DEAD) * .8).toFixed(0) + 'px');
  }
  /** Nişanı bitir: fire = true → bırakıldı (ateş), false → iptal */
  function aimEnd(fire) {
    if (!AIM.k) return;
    const I = FM.input, kind = AIM.k;
    if (I) {
      if (fire && raceInput()) { I.ax = AIM.ax; I.ay = AIM.ay; if (kind === 'item') I.use = true; else I.ab = true; FM.haptic('tap'); }
      else { I.ax = 0; I.ay = 0; }
      I.aim = null;
    }
    aimVis(false);
    aimListen(false);
    cancelShow(false);
    AIM.k = null; AIM.id = -1; AIM.el = null; AIM.ax = 0; AIM.ay = 0; AIM.tc = null;
  }
  function tcDown(e) {
    const el = e.currentTarget, k = el.getAttribute('data-tc'), set = TC[k];
    if (!set) return;
    if (e.cancelable) e.preventDefault();
    if (e.pointerType === 'touch' && !touchMode) setTouch(true);
    const first = set.size === 0;
    set.add(e.pointerId);
    el.classList.add('down');
    if (!first || !raceInput()) return;
    const I = FM.input; if (!I) return;
    if (k === 'jump') { I.jp = true; I.jh = true; buzz(8); }
    else if (k === 'slide') { I.dp = true; I.dh = true; buzz(8); }
    else {
      const kind = k === 'item' ? 'item' : 'ab', P = S.player;
      // GÜÇ: yalnızca dolunca nişan alınır (dolmamışsa basış eskisi gibi motora gider → "hazır değil" geri bildirimi)
      const ready = kind === 'item' ? !!(P && P.item) : !!(P && (+P.charge || 0) >= 100);
      if (ready && aimable(kind)) {
        if (!AIM.k) aimStart(el, kind, e);
        return;                                  // nişan sürerken ikinci nişan düğmesi yok sayılır
      }
      if (kind === 'item') I.use = true; else I.ab = true;
      buzz(kind === 'ab' ? 18 : 8);
    }
  }
  function tcUp(e) {
    const el = e.currentTarget, k = el.getAttribute('data-tc'), set = TC[k];
    if (!set || !set.has(e.pointerId)) return;
    if (AIM.k && AIM.el === el && e.pointerId === AIM.id) {
      // nişan parmağı: düğmeden çıkmak / yakalamanın düşmesi atışı bitirmez (pencere izler); kalkınca ya da iptalde son yönde at
      if (e.type === 'pointerleave' || e.type === 'lostpointercapture') return;
      aimRelease(e.pointerId); return;
    }
    set.delete(e.pointerId);
    if (set.size) return;
    el.classList.remove('down');
    const I = FM.input; if (!I) return;
    if (k === 'jump') I.jh = false;
    else if (k === 'slide') I.dh = false;
  }
  function releaseAllTouch() {
    aimEnd(false);
    for (const k in TC) { TC[k].clear(); if (tcEls[k]) tcEls[k].classList.remove('down'); }
    const I = FM.input; if (I) { I.jh = false; I.dh = false; }
  }
  function setTouch(v) {
    touchMode = !!v; FM.isTouch = touchMode;
    root.classList.toggle('is-touch', touchMode);
    Ls.race.classList.toggle('touch', touchMode);
    checkRotate();
  }

  /* ---------- ilk yönlü atış ipucu: "Basılı tut, sürükle, bırak!" (bir kez; FM.save.seen + yedek localStorage) ---------- */
  function seenGet(k) { try { const s = FM.save && FM.save.seen; if (s && s[k]) return true; } catch (e) { /* yok say */ } return !!lsGet('fm-seen-' + k); }
  function seenSet(k) {
    try { if (FM.save) { FM.save.seen = FM.save.seen || {}; FM.save.seen[k] = 1; if (typeof FM.persist === 'function') FM.persist(); } } catch (e) { /* yok say */ }
    lsSet('fm-seen-' + k, '1');
  }
  let hintT = 0;
  function aimHint() {
    if (seenGet('aimHint') || st.hintShown) return;
    const h = $('.tc-hint', Ls.race); if (!h) return;
    st.hintShown = true;
    h.classList.add('on');
    clearTimeout(hintT);
    hintT = setTimeout(() => { h.classList.remove('on'); seenSet('aimHint'); }, 4600);
  }
  function aimHintDone() {
    const h = $('.tc-hint', Ls.race);
    if (h && h.classList.contains('on')) { h.classList.remove('on'); clearTimeout(hintT); }
    seenSet('aimHint');
  }

  /** EŞYA / GÜÇ düğmesinin MANTIKSAL tuval birimindeki dikdörtgeni {x, y, w, h} (render-hud'un uçan eşya hedefi); görünmüyorsa null */
  UI.slotRect = function (kind) {
    const el = (kind === 'ab' || kind === 'power') ? tcEls.power : kind === 'item' ? tcEls.item : null;
    const V = FM.view;
    if (!el || !V || !(V.S > 0) || !touchMode || st.view !== 'race' || !Ls.race.classList.contains('live') || Ls.race.classList.contains('spec') || Ls.rot.classList.contains('on')) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    const k = (V.dpr || 1) / V.S;
    return { x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k };
  };
  /** Eşya yuvaya uçup vardı (hud:arrive) → düğme zıplar */
  function bumpSlot(kind) {
    const el = kind === 'ab' ? tcEls.power : tcEls.item;
    if (!el) return;
    el.classList.remove('arrive'); void el.offsetWidth; el.classList.add('arrive');
  }

  let tcRaf = 0;
  const tcS = { item: undefined, pct: -1, full: null, ch: null, show: null, pz: null, lefty: null, bs: null };
  function startTcLoop() { if (!tcRaf) tcRaf = requestAnimationFrame(tcLoop); }
  /** Düğme boyutu (S/M/L) ve solak düzen ayarlarını katmana uygula */
  function applyTcPrefs() {
    const bs = String(setting('btnSize') || 'M').toUpperCase(), lf = !!setting('lefty');
    if (bs !== tcS.bs) { tcS.bs = bs; Ls.race.classList.toggle('bs-s', bs === 'S'); Ls.race.classList.toggle('bs-l', bs === 'L'); }
    if (lf !== tcS.lefty) { tcS.lefty = lf; Ls.race.classList.toggle('lefty', lf); }
  }
  function tcLoop() {
    tcRaf = 0;
    if (st.view !== 'race') return;
    const P = S.player;
    const mpl = mpLive();
    const live = (S.mode === 'race' || S.mode === 'count') && (!S.paused || st.devForce || mpl);
    if (live !== tcS.show) { tcS.show = live; Ls.race.classList.toggle('live', live); if (!live) releaseAllTouch(); }
    // elenen / geç katılan izleyici: kontroller gizli; tek oyunculuda "Sonuçlara geç"
    const spec = !!(P && (P.ghost || P.out)) && S.mode === 'race';
    if (spec !== tcS.spec) { tcS.spec = spec; Ls.race.classList.toggle('spec', spec); if (spec) releaseAllTouch(); }
    const mpc = !!(mpl && S.netRole);
    if (mpc !== tcS.mp) { tcS.mp = mpc; Ls.race.classList.toggle('mp', mpc); if (!mpc) Ls.race.classList.remove('emo-open'); }
    if (touchMode && P) {
      applyTcPrefs();
      const it = P.item && FM.ITEMS && FM.ITEMS[P.item] ? P.item : null;
      if (it !== tcS.item) {
        tcS.item = it;
        const box = $('.tb-itm', Ls.race), lb = $('.tb-lb', tcEls.item);
        if (box) box.innerHTML = it ? gi(it, 80, 'tb-gi') : '<i class="tb-empty">' + svg('box') + '</i>';
        if (lb) lb.textContent = it ? up(FM.ITEMS[it].n || 'EŞYA') : 'EŞYA';
        tcEls.item.classList.toggle('has', !!it);
        tcEls.item.style.setProperty('--ic', it ? (FM.ITEMS[it].col || '#ffd23f') : '#ffd23f');
        const ca = !!it && aimable('item');
        tcEls.item.classList.toggle('can-aim', ca);
        if (it) { tcEls.item.classList.remove('pop'); void tcEls.item.offsetWidth; tcEls.item.classList.add('pop'); }
        if (it && ca && !AIM.k) aimHint();
      }
      const pct = Math.round(clamp(+P.charge || 0, 0, 100));
      if (pct !== tcS.pct) { tcS.pct = pct; tcEls.power.style.setProperty('--p', String(pct)); }
      const full = pct >= 100;
      if (full !== tcS.full) {
        tcS.full = full; tcEls.power.classList.toggle('full', full);
        const lb = $('.tb-lb', tcEls.power); if (lb) lb.textContent = full ? 'HAZIR!' : 'GÜÇ';
      }
      if (P.id !== tcS.ch) {
        tcS.ch = P.id; const b = $('.tb-pp', Ls.race); if (b) b.innerHTML = pt(P.id, 72, { ring: false });
        tcEls.power.classList.toggle('can-aim', aimable('ab'));
      }
    }
    tcRaf = requestAnimationFrame(tcLoop);
  }
  function enterRace(fresh) {
    st.view = 'race';
    if (fresh === true && st.modal === 'pause') S.paused = false;   // yeni tur: önceki turdan kalmış duraklatma kilitlemesin
    closeModalHard();
    setNotesPos();
    stopShowcases(); stopTicker();
    showLayer('scr', false); Ls.scr.innerHTML = '';
    clearResults(); clearFinal();
    tcS.item = undefined; tcS.pct = -1; tcS.full = null; tcS.ch = null; tcS.show = null; tcS.spec = null; tcS.mp = null; tcS.lefty = null; tcS.bs = null;
    Ls.race.classList.remove('emo-open', 'spec');
    releaseAllTouch();
    applyTcPrefs();
    Ls.race.classList.toggle('touch', touchMode);
    showLayer('race', true);
    startTcLoop();
    checkRotate();
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* yok say */ }
  }
  function hideRaceLayer() { showLayer('race', false); Ls.race.classList.remove('live'); tcS.show = null; releaseAllTouch(); }

  /* =====================================================================
     19) TUR SONUCU PANELİ (kürsü sahnesinin sağında)
     ===================================================================== */
  const PLACE_TXT = ['BİRİNCİ!', 'İKİNCİ!', 'ÜÇÜNCÜ', 'DÖRDÜNCÜ'];
  function countUp(el, from, to, dur, fmt) {
    const t0 = nowMs(); fmt = fmt || fmtN;
    const step = () => {
      if (!el.isConnected) return;
      const k = clamp((nowMs() - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
      else { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    };
    requestAnimationFrame(step);
  }
  function runCountUps(box, base) {
    const still = root.classList.contains('dev-still');
    $$('[data-cu]', box).forEach((b, i) => {
      const to = +b.getAttribute('data-cu') || 0, sign = b.hasAttribute('data-sign'), pre = b.getAttribute('data-pre') || '';
      const f = v => (sign ? fmtSigned(v) : pre + fmtN(v));
      if (still) { b.textContent = f(to); return; }
      b.textContent = f(0);
      setTimeout(() => { if (b.isConnected) countUp(b, 0, to, 750, f); }, (base || 650) + i * 230);
    });
  }
  function lastRewards(res) {
    const lr = FM.meta && FM.meta.lastRewards;
    if (lr && typeof lr === 'object') return lr;
    const p = res && res.player;
    return { coins: (p && p.coins) || 0, gems: 0, xp: 0, lines: [], levelUp: false, missionsDone: [] };
  }
  function confetti(n) {
    const cols = ['#ff3b3b', '#ffd23f', '#3ddc84', '#3b82f6', '#a855f7', '#ff8fc8', '#ffffff', '#e0243a'];
    let h = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < n; i++) {
      const H = k => (FM.hash ? FM.hash(i * 97 + k * 7919 + 13) : Math.random());
      const x = (H(1) * 100).toFixed(1), d = (H(2) * 2.4).toFixed(2), dur = (2.6 + H(3) * 2.2).toFixed(2);
      const w = (.5 + H(4) * .7).toFixed(2), r = (H(5) * 360) | 0, sw = ((H(6) - .5) * 14).toFixed(1);
      h += '<i style="left:' + x + '%;--c:' + cols[i % cols.length] + ';--w:' + w + 'rem;--r:' + r + 'deg;--sw:' + sw + 'rem;animation-delay:' + d + 's;animation-duration:' + dur + 's"></i>';
    }
    return h + '</div>';
  }
  function showResults(res) {
    res = res || S.lastResult;
    if (!res) return;
    st.view = 'results'; st.resData = res;
    if (st.modal === 'pause') S.paused = false;   // savunma: kürsü asla donuk kalmasın
    setNotesPos(); dropCelebrations();
    stopShowcases(); stopTicker();
    closeModalHard(); hideRaceLayer(); clearFinal();
    showLayer('scr', false); Ls.scr.innerHTML = '';
    const rk = (res.ranking || []).filter(Boolean);
    const P = res.player || S.player;
    const pr = res.playerRank != null ? res.playerRank : rk.indexOf(P);
    const fin = !!(P && P.finished);
    const rw = lastRewards(res);
    const td = res.trophyDelta != null ? +res.trophyDelta : (P && +P.td) || 0;
    const mp = !!res.mp, spect = !!res.spectator;
    let rows = '';
    rk.forEach((r, i) => {
      // ağda aynı karakteri seçen iki oyuncu olabilir: "SEN" yalnızca kendi yarışçım
      const me = mp ? (r === P || r.ctrl === 'local') : (r === P || (P && r.id === P.id && !r.bot));
      const tcol = res.mode === 'coins' ? '<span class="rr-t rr-co">' + coinI(16, 'bi') + (r.coins | 0) + '</span>'
        : '<span class="rr-t">' + (r.finished ? fmtTime(r.ftime) : r.off ? 'koptu' : (r.out || r.elim) ? 'elendi' : '—') + '</span>';
      rows += '<div class="rr ' + (me ? 'me ' : '') + (r.off ? 'off ' : '') + 'p' + (i + 1) + '" style="--d:' + (.25 + Math.min(i, 6) * .07).toFixed(2) + 's">' +
        '<span class="rr-pl">' + placeBadge(i + 1) + '</span>' +
        '<span class="rr-pt">' + pt(r.id, 56, { skin: r.skin }) + '</span>' +
        '<span class="rr-n">' + esc(r.name || r.id) + (me ? '<em class="you">SEN</em>' : '') + '</span>' +
        tcol +
        '<span class="rr-p">+' + (r.rp || 0) + '</span>' +
        '<span class="rr-tot">' + (r.total || 0) + '</span>' +
      '</div>';
    });
    let lines = '';
    if (Array.isArray(rw.lines) && rw.lines.length) {
      // telefonda satırlar iki sütunlu: değer kısa yazılır ("+96") ve birimi küçük ikonla gösterilir
      lines = '<div class="rl">' + rw.lines.slice(0, 8).map(l => {
        const full = String(l.s || (l.v != null ? (typeof l.v === 'number' ? fmtSigned(l.v) : l.v) : ''));
        const short = typeof l.v === 'number' ? fmtSigned(l.v) : full;
        const cur = l.cur || 'coins';
        const ci = cur === 'gems' ? gemI(20, 'rl-ci') : cur === 'xp' ? '<i class="xp-pill rl-ci">XP</i>' : cur === 'trophy' ? trophyI(20, 'rl-ci') : coinI(20, 'rl-ci');
        return '<span class="rl-i rl-' + esc(cur) + '" title="' + esc((l.t || '') + ': ' + full) + '">' + (l.icon ? anyIcon(l.icon, 24, 'rl-ic') : '') +
          '<span class="rl-t">' + esc(l.t || '') + '</span><b><em class="rl-full">' + esc(full) + '</em><em class="rl-short">' + esc(short) + '</em></b>' + ci + '</span>';
      }).join('') + '</div>';
    }
    let ms = '';
    const md = Array.isArray(rw.missionsDone) ? rw.missionsDone : [];
    if (md.length) ms = '<div class="rm"><span class="rm-h">' + svg('check') + 'Tamamlanan görevler</span>' + md.slice(0, 4).map(m => '<span class="rm-i">' + (m && m.icon ? anyIcon(m.icon, 20, 'rm-ic') : '') + esc((m && (m.title || m.n)) || String(m)) + '</span>').join('') + '</div>';
    const li = levelInfo();
    const lvUp = rw.levelUp && rw.kind !== 'match' ? '<div class="lvup"><span class="lvup-burst"></span>' + svg('star', 'gold lvup-star') + '<b class="lvup-n">' + (typeof rw.levelUp === 'number' ? rw.levelUp : li.level) + '</b><span class="lvup-t"><b>SEVİYE ATLADIN!</b><span>Yeni ödüller seni bekliyor</span></span></div>' : '';
    // lige yükseldin (FM.meta.lastRewards.league {id, n, col, up})
    const lgR = rw.league && rw.league.up ? rw.league : null;
    const lgUp = lgR ? '<div class="lvup lg-up" style="--lg:' + esc(lgR.col || '#ffd23f') + '"><span class="lvup-burst"></span><i class="lg-big">' + svg('shieldL') + '</i><span class="lvup-t"><b>LİGE YÜKSELDİN!</b><span>' + esc(lgR.n || '') + ' Ligi</span></span></div>' : '';
    const last = !!res.last || (res.round >= res.rounds);
    st.resLast = last;
    const elimd = !!(P && (P.out || P.elim) && !P.finished);
    const head = spect ? 'İZLEDİN' : fin ? (PLACE_TXT[pr] || (pr + 1) + '.') : elimd ? 'ELENDİN' : 'BİTİREMEDİN';
    const mdn = res.mode && res.mode !== 'classic' ? modeOf(res.mode).n : '';
    const theme = (res.theme && res.theme.n ? res.theme.n : '') + (mdn ? ' · ' + mdn : '');
    const many = rk.length > 4;
    // izleyici bu turda ödül almadı: ödül kartları yerine bilgi
    const mid = spect
      ? '<div class="res-mid scroll"><div class="res-spec">' + svg('users') + '<b>Bu turu izledin</b><span>Sonraki turda sen de yarışacaksın.</span></div></div>'
      : null;
    Ls.res.innerHTML =
      '<div class="res">' +
        '<div class="pnl pnl-res">' + ribbon('TUR ' + (res.round || 1) + ' / ' + (res.rounds || 1), pr === 0 && fin ? 'rb-gold' : 'rb-purple') +
          '<div class="res-in">' +
            '<div class="res-head p' + (fin ? pr + 1 : 0) + '"><span class="rh-pl">' + (pr >= 0 && !spect ? (pr + 1) + '.' : '—') + '</span><span class="rh-t"><b>' + head + '</b><span>' + esc(theme) + '</span></span></div>' +
            '<div class="res-tbl' + (many ? ' many' : '') + '"><div class="rr rr-h"><span></span><span></span><span>Yarışçı</span><span>' + (res.mode === 'coins' ? 'Altın' : 'Süre') + '</span><span>Puan</span><span>Toplam</span></div>' +
              (many ? '<div class="rr-sc scroll" data-sk="rr-sc">' + rows + '</div>' : rows) + '</div>' +
            (mid || ('<div class="res-mid scroll">' +
              '<div class="rws">' +
                '<div class="rwc c-coin">' + coinI(48, 'rwc-i') + '<b data-cu="' + (+rw.coins || 0) + '" data-pre="+">0</b><span>Altın</span></div>' +
                '<div class="rwc c-xp"><i class="xp-big">XP</i><b data-cu="' + (+rw.xp || 0) + '" data-pre="+">0</b><span>Deneyim</span></div>' +
                '<div class="rwc c-gem">' + gemI(48, 'rwc-i') + '<b data-cu="' + (+rw.gems || 0) + '" data-pre="+">0</b><span>Elmas</span></div>' +
                '<div class="rwc c-tr ' + (td < 0 ? 'neg' : '') + '">' + trophyI(48, 'rwc-i') + '<b data-cu="' + td + '" data-sign>0</b><span>Kupa</span></div>' +
              '</div>' + lvUp + lgUp + lines + ms +
            '</div>')) +
            '<div class="res-foot">' + resFoot(mp, last) + '</div>' +
          '</div>' +
        '</div>' +
        (rw.levelUp || lgR ? confetti(touchMode ? 14 : 26) : '') +
      '</div>';
    showLayer('res', true);
    runCountUps(Ls.res, 900);
    scrollHints(Ls.res);
    calmLater(Ls.res);
    // kalabalık tabloda kendi satırım görünsün
    const sc = $('.rr-sc', Ls.res), meRow = sc && $('.rr.me', sc);
    if (sc && meRow) sc.scrollTop = Math.max(0, meRow.offsetTop - sc.clientHeight / 2 + meRow.offsetHeight / 2);
    if (mp) mpTick();
  }
  /** Sonuç paneli alt düğmeleri. Çok oyunculuda "SONRAKİ TUR" yalnızca ev sahibinde; diğerlerinde "Sonraki tur 5…" (autoLeft, herkeste doğru) */
  function resFoot(mp, last) {
    if (!mp) return '<button class="rbtn b-steel res-home" data-act="resquit" aria-label="Menüye dön" title="Menüye dön">' + svg('home') + '</button>' +
      '<button class="btn b-gold btn-next" data-act="next"><span>' + (last ? 'FİNAL' : 'SONRAKİ TUR') + '</span>' + svg('play') + '</button>';
    const al = gcall('autoLeft');
    const lbl = last ? 'Final' : 'Sonraki tur';
    return '<button class="rbtn b-steel res-home" data-act="mpleave" aria-label="Odadan ayrıl" title="Odadan ayrıl">' + svg('door') + '</button>' +
      (mpHost()
        ? '<button class="btn b-gold btn-next" data-act="next"><span>' + (last ? 'FİNAL' : 'SONRAKİ TUR') + '</span>' + (al != null ? '<em class="auto" data-auto>' + al + '</em>' : '') + svg('play') + '</button>'
        : al != null
          ? '<div class="btn b-steel btn-next wait is-static nxt"><span>' + lbl + ' <b class="nxt-n">' + al + '</b>…</span></div>'
          : '<div class="btn b-steel btn-next wait is-static"><span>EV SAHİBİ BEKLENİYOR</span><i class="dots"><i></i><i></i><i></i></i></div>');
  }
  /** Çok oyunculu sonuç/final ekranında otomatik ilerleme geri sayımı (herkeste) */
  let mpTickT = 0;
  function mpTick() {
    clearInterval(mpTickT);
    mpTickT = setInterval(() => {
      if (st.view !== 'results' && st.view !== 'final') { clearInterval(mpTickT); mpTickT = 0; return; }
      if (st.view === 'results') {
        const f = $('.res-foot', Ls.res);
        if (f) { const h = resFoot(true, !!st.resLast); if (f._h !== h) { f._h = h; f.innerHTML = h; } }
      } else {
        const f = $('.fin-btns', Ls.fin);
        if (f && st.finData && st.finData.mp) { const h = finBtns(true); if (f._h !== h) { f._h = h; f.innerHTML = h; } }
      }
    }, 400);
  }
  /** Telefonda sonsuz CSS animasyonları (konfeti, dönen ışınlar, nabız) birkaç saniye sonra dursun: GPU/pil */
  function calmLater(layer) {
    if (!touchMode || root.classList.contains('dev-still')) return;
    const box = layer.firstElementChild;
    if (!box) return;
    setTimeout(() => { if (box.isConnected) box.classList.add('calm'); }, 8000);
    setTimeout(() => { if (!box.isConnected) return; const c = box.querySelector('.confetti'); if (c) c.remove(); }, 11000);
  }
  function clearResults() { showLayer('res', false); Ls.res.innerHTML = ''; }

  /* =====================================================================
     20) FİNAL (maç sonu) EKRANI
     ===================================================================== */
  function showFinal(d) {
    d = d || {};
    const standings = (Array.isArray(d.standings) && d.standings.length ? d.standings : (S.racers || []).slice().sort((a, b) => (b.total || 0) - (a.total || 0))).filter(Boolean);
    if (!standings.length) { showScreen('menu'); return; }
    st.finData = d;
    const P = d.player || S.player;
    const isMe = d.mp ? (r => !!r.me) : (r => r === P || (P && r.id === P.id && !r.bot));
    const win = standings[0];
    const champ = d.champion != null ? !!d.champion : isMe(win);
    const myPlace = Math.max(0, standings.findIndex(isMe)) + 1;
    st.view = 'final';
    setNotesPos();
    stopShowcases(); stopTicker(); closeModalHard(); hideRaceLayer(); clearResults();
    showLayer('scr', false); Ls.scr.innerHTML = '';
    let rows = '';
    standings.forEach((r, i) => {
      const me = isMe(r);
      rows += '<div class="fr ' + (me ? 'me ' : '') + 'p' + (i + 1) + '" style="--d:' + (.5 + i * .12).toFixed(2) + 's">' +
        '<span class="rr-pl">' + placeBadge(i + 1) + '</span>' + '<span class="rr-pt">' + pt(r.id, 64, { skin: r.skin }) + '</span>' +
        '<span class="fr-n">' + esc(r.name || r.id) + (me ? '<em class="you">SEN</em>' : '') + '</span>' +
        '<span class="fr-k" title="Patlatılan rakip">' + (r.kills ? gi('x_boom', 24, 'fr-ki') + r.kills : '') + '</span>' +
        '<span class="fr-tot"><b>' + (r.total || 0) + '</b><em>puan</em></span>' +
      '</div>';
    });
    const awH = awardsHtml(standings, isMe);
    Ls.fin.innerHTML =
      '<div class="fin ' + (champ ? 'win' : 'lose') + (awH ? ' has-aw' : '') + '">' +
        '<div class="fin-hero">' +
          '<div class="fin-rays"></div>' +
          '<div class="fin-pt">' + svg('crown', 'gold fin-crown') + pt(win.id, 220, { skin: win.skin, expr: 'h' }, 'fin-img') + '</div>' +
          '<div class="fin-title">' + (champ ? 'ŞAMPİYON!' : 'MAÇ BİTTİ') + '</div>' +
          '<div class="fin-sub">' + (champ ? 'Klanın en hızlısı sensin, <b>' + esc(win.name || win.id) + '</b>!' : 'Şampiyon <b>' + esc(win.name || win.id) + '</b> · Sen <b>' + myPlace + '.</b> oldun') + '</div>' +
          awH +
        '</div>' +
        '<div class="pnl fin-pnl">' + ribbon('TOPLAM PUAN', champ ? 'rb-gold' : 'rb-red') +
          '<div class="fin-in"><div class="fin-rows' + (standings.length > 4 ? ' scroll' : '') + '" data-sk="fin-rows">' + rows + '</div>' + (d.mp && !st.mpRaced ? '' : finRewards()) +
          '<div class="fin-btns">' + finBtns(!!d.mp) + '</div></div>' +
        '</div>' +
        (champ ? confetti(touchMode ? 22 : 60) : '') +
      '</div>';
    showLayer('fin', true);
    calmLater(Ls.fin);
    scrollHints(Ls.fin);
    if (d.mp) mpTick();
  }
  function clearFinal() { showLayer('fin', false); Ls.fin.innerHTML = ''; }
  /** Final alt düğmeleri. Ağda: ev sahibinde LOBİYE DÖN, herkeste "Lobiye dönülüyor… N" (otomatik; menüye atılmaz) */
  function finBtns(mp) {
    if (!mp) return '<button class="btn b-steel" data-act="menu">' + svg('home') + '<span>MENÜ</span></button>' +
      '<button class="btn b-green btn-again" data-act="replay">' + svg('reset') + '<span>TEKRAR OYNA</span></button>';
    const al = gcall('autoLeft');
    return '<button class="btn b-steel" data-act="mpleave">' + svg('door') + '<span>AYRIL</span></button>' +
      (mpHost()
        ? '<button class="btn b-green btn-again" data-act="tolobby">' + svg('users') + '<span>LOBİYE DÖN</span>' + (al != null ? '<em class="auto" data-auto>' + al + '</em>' : '') + '</button>'
        : '<div class="btn b-steel btn-again wait is-static"><span>' + (al != null ? 'Lobiye dönülüyor <b class="nxt-n">' + al + '</b>…' : 'Lobiye dönülecek') + '</span><i class="dots"><i></i><i></i><i></i></i></div>');
  }

  /* ---------- maç sonu eğlenceli ödüller (final sıralamasındaki / yarışçı verilerinden; veri yoksa ödül atlanır) ---------- */
  const racerKey = r => (r && (r.pid || (r.id + ':' + (r.idx == null ? '' : r.idx)))) || '';
  /** Her turun sonunda en hızlı bitiş süresini yarışçıya göre biriktir ("Roket") */
  function trackRound(res) {
    const rk = res && res.ranking;
    if (!Array.isArray(rk)) return;
    for (const r of rk) {
      if (!r || !r.finished || !(+r.ftime > 0)) continue;
      const k = racerKey(r), cur = st.bestT[k];
      if (!cur || r.ftime < cur) st.bestT[k] = +r.ftime;
    }
  }
  function funAwards(stn) {
    const rows = stn.filter(Boolean);
    if (rows.length < 2) return [];
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const out = [];
    const best = (key, dir, min) => {
      let w = null, wv = null, n = 0, all = [];
      for (const r of rows) {
        const v = num(typeof key === 'function' ? key(r) : r[key]);
        if (v == null) continue;
        all.push(v);
        if (wv == null || (dir > 0 ? v > wv : v < wv)) { w = r; wv = v; }
      }
      if (!w || all.length < 2) return null;
      void n;
      if (min != null && (dir > 0 ? wv < min : wv > min)) return null;
      return { w, v: wv, all };
    };
    let a = best('kills', 1, 1);
    if (a) out.push({ k: 'kill', ic: gi('x_boom', 40), t: 'EN ÇOK AVLAYAN', w: a.w, v: a.v + ' rakip' });
    a = best('coins', 1, 1);
    if (a) out.push({ k: 'coin', ic: coinI(40), t: 'ALTIN AVCISI', w: a.w, v: fmtN(a.v) + ' altın' });
    a = best('deaths', -1, null);
    if (a && Math.max.apply(null, a.all) > a.v) out.push({ k: 'life', ic: '<i class="gi fb-svg c-gold">' + svg('halo') + '</i>', t: 'ÖLÜMSÜZ', w: a.w, v: a.v === 0 ? 'hiç ölmedi' : a.v + ' ölüm' });
    a = best(r => (st.bestT[racerKey(r)] > 0 ? st.bestT[racerKey(r)] : null), -1, null);
    if (a) out.push({ k: 'rocket', ic: gi('mis', 40), t: 'ROKET', w: a.w, v: fmtTime(a.v) + ' en hızlı tur' });
    return out;
  }
  function awardsHtml(stn, isMe) {
    let aw = [];
    try { aw = funAwards(stn); } catch (e) { console.error('[ui ödüller]', e); }
    if (!aw.length) return '';
    return '<div class="fin-aw">' + aw.map((x, i) =>
      '<div class="fa fa-' + x.k + (isMe(x.w) ? ' me' : '') + '" style="--d:' + (1.3 + i * .18).toFixed(2) + 's"><span class="fa-ic">' + x.ic + '</span>' +
        '<span class="fa-m"><em>' + x.t + '</em><b>' + esc(x.w.name || x.w.id) + (isMe(x.w) ? ' <i class="you">SEN</i>' : '') + '</b><span>' + esc(x.v) + '</span></span>' +
        '<span class="fa-pt">' + pt(x.w.id, 44, { skin: x.w.skin }) + '</span></div>').join('') + '</div>';
  }
  function finRewards() {
    const mr = FM.meta && FM.meta.lastMatchRewards;
    if (!mr || typeof mr !== 'object') return '';
    const tot = mr.total || mr.matchTotals || null;
    let h = '<div class="fin-rw"><span class="fw-h">' + svg('gift') + 'Maç ödülü</span><span class="fw-c">' + rewardChips({ coins: mr.coins, gems: mr.gems, xp: mr.xp }, 24) + '</span></div>';
    if (tot) h += '<div class="fin-rw tot"><span class="fw-h">' + svg('chest') + 'Bu maçta toplam</span><span class="fw-c">' + rewardChips({ coins: tot.coins, gems: tot.gems, xp: tot.xp }, 24) + '</span></div>';
    if (mr.levelUp) h += '<div class="fin-rw lv"><span class="fw-h">' + svg('star', 'gold') + 'Seviye ' + mr.levelUp + ' oldun!</span></div>';
    return h;
  }

  /* =====================================================================
     21) BİLDİRİMLER
     ===================================================================== */
  /* İki kanal: kutlama bildirimleri (görev / seviye) sıraya girer ve aynı anda yalnızca biri görünür;
     geri bildirimler (satın alındı, yetersiz altın...) hemen çıkar ve bir öncekinin yerini alır.
     Konum görünüme göre değişir: menüde sağ üst, yarışta üst orta, kürsüde sol üst (sonuç paneli sağda),
     finalde sol alt (şampiyon başlığı ve puan tablosu kapanmasın). */
  const noteQ = [];
  let noteCel = null, noteFb = null;
  function setNotesPos() {
    const v = st.view;
    Ls.notes.classList.toggle('np-menu', v === 'menu');
    Ls.notes.classList.toggle('np-res', v === 'results' || v === 'busy');
    Ls.notes.classList.toggle('np-fin', v === 'final');
  }
  function dropNote(el, fast) {
    if (!el || el._gone) return;
    el._gone = true;
    el.classList.add('out');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (noteCel === el) { noteCel = null; nextNote(); }
      if (noteFb === el) noteFb = null;
    }, fast ? 260 : 420);
  }
  function nextNote() { if (!noteCel && noteQ.length) showNote(noteQ.shift(), true); }
  function showNote(o, cel) {
    setNotesPos();
    const el = document.createElement('div');
    el.className = 'note ' + (o.cls || '') + (st.view === 'race' ? ' in-race' : '');
    el.innerHTML = '<span class="n-ic">' + (o.icon || svg('star')) + '</span><span class="n-tx"><b>' + esc(o.title || '') + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</span>' +
      (o.rw ? '<span class="n-rw">' + rewardChips(o.rw, 20) + '</span>' : '') + (o.btn || '');
    Ls.notes.appendChild(el);
    if (cel) noteCel = el;
    else { if (noteFb) dropNote(noteFb, true); noteFb = el; }
    // oyun içi / kürsü / finalde kutlamalar kısa sürsün (ekranı uzun süre kapatmasın)
    const ms = cel && st.view !== 'menu' ? Math.min(o.ms || 3200, 2600) : (o.ms || 3200);
    setTimeout(() => dropNote(el), ms);
    return el;
  }
  function note(o) {
    o = o || {};
    const cel = /\bn-(ms|lv)\b/.test(o.cls || '');
    if (cel && noteCel) { noteQ.push(o); if (noteQ.length > 6) noteQ.shift(); return null; }
    return showNote(o, cel);
  }
  /** Sonuç paneli görevleri ve seviye atlamayı zaten gösterir: bekleyen/görünen kutlamaları kaldır */
  function dropCelebrations() { noteQ.length = 0; if (noteCel) dropNote(noteCel, true); }
  /** Ödül ikonlarını butondan üst çubuktaki keseye uçur */
  function flyReward(fromEl, rw) {
    if (!fromEl || !rw || typeof Element === 'undefined' || !Element.prototype.animate) return;
    const a = fromEl.getBoundingClientRect();
    const jobs = [];
    if (rw.coins) jobs.push(['coins', 'coin', Math.min(8, 3 + Math.round(rw.coins / 60))]);
    if (rw.gems) jobs.push(['gems', 'gem', Math.min(5, 2 + rw.gems)]);
    for (const j of jobs) {
      const pill = $('.cur[data-cur="' + j[0] + '"]');
      if (!pill) continue;
      const b = pill.getBoundingClientRect();
      for (let i = 0; i < j[2]; i++) {
        const w = document.createElement('div');
        w.className = 'fly'; w.innerHTML = gi(j[1], 32);
        w.style.left = (a.left + a.width / 2) + 'px'; w.style.top = (a.top + a.height / 2) + 'px';
        root.appendChild(w);
        const dx = b.left + 18 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
        const sx = (Math.random() - .5) * 120, sy = -40 - Math.random() * 70;
        const anim = w.animate([
          { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
          { transform: 'translate(calc(-50% + ' + sx + 'px),calc(-50% + ' + sy + 'px)) scale(1.15)', opacity: 1, offset: .3 },
          { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(.7)', opacity: 1 }
        ], { duration: 620 + i * 70, easing: 'cubic-bezier(.5,0,.4,1)', delay: i * 45, fill: 'forwards' });
        anim.onfinish = () => { if (w.parentNode) w.parentNode.removeChild(w); const p2 = $('.cur[data-cur="' + j[0] + '"]'); if (p2) { p2.classList.remove('bump'); void p2.offsetWidth; p2.classList.add('bump'); } };
      }
    }
  }

  /* =====================================================================
     22) "TELEFONU YAN ÇEVİR" KATMANI
     ===================================================================== */
  Ls.rot.innerHTML =
    '<div class="rot-in">' +
      '<div class="rot-ph"><svg viewBox="0 0 120 120" aria-hidden="true"><g class="rot-g"><rect x="38" y="14" width="44" height="80" rx="9" class="ph-b"/><rect x="43" y="24" width="34" height="58" rx="3" class="ph-s"/><circle cx="60" cy="88" r="2.6" class="ph-d"/></g>' +
      '<path class="rot-arr" d="M98 66a40 40 0 0 1-34 40"/><path class="rot-ah" d="M62 98l2 9 9-3"/></svg></div>' +
      '<b>Telefonu yan çevir</b><span>Fuat Morel yatay ekranda oynanır.</span>' +
      // Android: tam ekran + yatay kilit, otomatik döndürme kapalı olsa bile yataya geçirebilir
      (fsOK() && window.screen && screen.orientation && typeof screen.orientation.lock === 'function'
        ? '<button class="btn b-gold rot-go" data-act="rotfull">' + svg('full') + '<span>YATAY OYNA</span></button>' : '') +
      '<em class="rot-tip">' + (isIOS() ? 'Ekran dönmüyorsa Denetim Merkezi\'nden döndürme kilidini kapat.' : 'Ekran dönmüyorsa otomatik döndürmeyi aç.') + '</em>' +
    '</div>';
  function checkRotate() {
    const need = touchMode && window.innerHeight > window.innerWidth * 1.05;
    Ls.rot.classList.toggle('on', need);
    if (need) {
      if ((S.mode === 'race' || S.mode === 'count') && !S.paused && !mpLive()) { S.paused = true; st.pausedByRot = true; releaseAllTouch(); }
      else if (mpLive()) releaseAllTouch();
    } else if (st.pausedByRot) {
      st.pausedByRot = false;
      if (canPause() && st.modal !== 'pause') openPause();
      else if (st.modal !== 'pause') S.paused = false;
    }
  }

  /* =====================================================================
     22b) ARKADAŞLARLA: takma ad, oda kur/katıl, bekleme/hata pencereleri, paylaşım,
          karakter seçici, kayıt kodu, uygulama-içi tarayıcı bandı
     ===================================================================== */
  function withNick(fn) {
    if (sv().nickSet === true || !NET()) { fn(); return; }
    openNick(fn);
  }
  function openNick(then) {
    st.nickThen = typeof then === 'function' ? then : null;
    const ch = selChar();
    const cur = sv().nickSet === true ? myNick() : (sv().nick || ch);
    openModal('nick',
      '<div class="pnl pnl-sm pnl-nick">' + ribbon('TAKMA ADIN', 'rb-gold') +
        '<div class="nk-body"><span class="nk-pt">' + pt(ch, 96, { skin: equipped('skins', ch) }) + '</span>' +
          '<div class="nk-r"><p class="nk-t">Arkadaşların seni bu adla görecek.</p>' +
          '<input class="nk-in" type="text" maxlength="14" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" data-enter="nickok" aria-label="Takma ad" placeholder="' + esc(ch) + '" value="' + esc(cur) + '">' +
          '<span class="nk-h">En çok 14 harf</span></div></div>' +
        '<div class="cf-btns"><button class="btn b-steel" data-act="mclose">VAZGEÇ</button><button class="btn b-green cf-ok" data-act="nickok">' + svg('check') + '<span>TAMAM</span></button></div>' +
      '</div>');
    if (!touchMode) setTimeout(() => { const i = $('.nk-in', Ls.mdl); if (i) { try { i.focus(); i.select(); } catch (e) { /* yok say */ } } }, 60);
  }
  function nickOk() {
    const i = $('.nk-in', Ls.mdl);
    let v = (i && i.value || '').replace(/\s+/g, ' ').trim();
    if (!v) v = selChar();
    let ok = ncall('setNick', v);
    if (!ok) { const s = sv(); s.nick = v.slice(0, 14); s.nickSet = true; if (typeof FM.persist === 'function') FM.persist(); }
    const then = st.nickThen; st.nickThen = null;
    closeModalHard();
    if (st.view === 'menu' && (st.screen === 'friends' || st.screen === 'settings')) refreshSoon();
    if (then) then();
    else note({ title: 'Takma ad kaydedildi', sub: myNick(), icon: svg('user'), cls: 'n-ok', ms: 1500 });
  }
  function openWait(title, sub) {
    openModal('mpwait',
      '<div class="pnl pnl-sm pnl-wait">' + ribbon(title, 'rb-purple') +
        '<div class="cf-body"><div class="spin" aria-hidden="true"><i></i></div><p class="cf-t">' + sub + '</p></div>' +
        '<div class="cf-btns"><button class="btn b-steel" data-act="mpcancel">VAZGEÇ</button></div>' +
      '</div>', true);
  }
  const ERR_T = { badcode: 'KOD HATALI', noroom: 'ODA BULUNAMADI', full: 'ODA DOLU', ver: 'YENİ SÜRÜM VAR', conn: 'BAĞLANTI YOK', nows: 'DESTEKLENMİYOR', dup: 'BAŞKA SEKMEDE AÇIK', kicked: 'ODADAN ÇIKARILDIN' };
  function openErr(code, msg) {
    const ver = code === 'ver';
    const ic = code === 'full' ? 'users' : code === 'conn' ? 'wifi' : code === 'kicked' ? 'door' : ver ? 'reset' : 'info';
    openModal('mperr',
      '<div class="pnl pnl-sm pnl-err">' + ribbon(ERR_T[code] || 'BİR SORUN VAR', 'rb-red') +
        '<div class="cf-body"><div class="cf-art cf-warn">' + svg(ic) + '</div><p class="cf-t">' + esc(msg || 'Bir sorun oluştu, tekrar dene.') + '</p></div>' +
        '<div class="cf-btns">' + (ver
          ? '<button class="btn b-steel" data-act="mclose">KAPAT</button><button class="btn b-gold cf-ok" data-act="reload">' + svg('reset') + '<span>SAYFAYI YENİLE</span></button>'
          : '<button class="btn b-green cf-ok" data-act="mclose">TAMAM</button>') + '</div>' +
      '</div>');
  }
  function mpCreate() {
    const n = NET();
    if (!n) { openErr('nows', 'Bu tarayıcı çok oyunculuyu desteklemiyor. Chrome ya da Safari ile aç.'); return; }
    if (mpInRoom()) { showScreen('lobby'); return; }
    if (mpBusy()) gcall('leave');
    const ok = ncall('createRoom', { cfg: lastCfg() });
    if (ok === false) return;      // net:error zaten geldi
    openWait('ODA KURULUYOR', 'Sunucuya bağlanılıyor…');
  }
  function mpJoin(v) {
    const n = NET();
    if (!n) { openErr('nows', 'Bu tarayıcı çok oyunculuyu desteklemiyor. Chrome ya da Safari ile aç.'); return; }
    const pc = ncall('parseCode', String(v || ''));
    if (!pc || !pc.code) {
      const inp = $('.cin', Ls.scr);
      if (inp) { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); }
      sfx('error'); buzz(35);
      note({ title: 'Kod hatalı', sub: 'Oda kodu 5 harflidir (ör. K7MXQ).', icon: svg('info'), cls: 'n-err', ms: 2000 });
      return;
    }
    if (mpInRoom() && ncall('code') === pc.code) { showScreen('lobby'); return; }
    if (mpInRoom() || mpBusy()) gcall('leave');
    st.mpCode = pc.code;
    const ok = ncall('joinRoom', pc.code);
    if (ok === false) return;
    openWait('ODAYA KATILINIYOR', '<b>' + esc(pc.code) + '</b> odası aranıyor…');
  }
  /** Lobiye girildi (ilk kez ya da maç sonunda ev sahibi lobiye döndürdü) */
  function showLobby() {
    if (st.modal === 'mpwait') closeModalHard();
    // sayfa yenilenirse aynı odaya dönülsün: adrese ?oda=KOD yaz (ayrılınca silinir)
    const code = ncall('code');
    if (code && !FM.DEV) { try { const u = new URL(location.href); if (u.searchParams.get('oda') !== code) { u.searchParams.set('oda', code); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } } catch (e) { /* yok say */ } }
    st.mpRaced = false;
    showScreen('lobby');
  }
  function shareInfo(to) {
    const code = String(ncall('code') || (st.fakeLobby && st.fakeLobby.lob.code) || '');
    const link = ncall('shareLink') || (location.origin + location.pathname + '?oda=' + code);
    return { code, link, text: (to ? to + ', ' : '') + 'Fuat Morel odama gel! Oda kodu: ' + code };
  }
  /** "Odaya geri dönülüyor…" bekleme penceresi (otomatik ya da elle geri dönüş) */
  function openRejoin(code) {
    st.rejoining = true;
    const c = String(code || (rejoinData() || {}).code || ncall('code') || '');
    if (st.modal === 'mpwait') { const t = $('.cf-t', Ls.mdl); if (t) t.innerHTML = c ? '<b>' + esc(c) + '</b> odasına bağlanılıyor…' : 'Odana bağlanılıyor…'; return; }
    openWait('ODAYA GERİ DÖNÜLÜYOR', c ? '<b>' + esc(c) + '</b> odasına bağlanılıyor…' : 'Odana bağlanılıyor…');
  }
  function copyText(t) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-200px';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove();
        return Promise.resolve(!!ok);
      } catch (e) { return Promise.resolve(false); }
    };
    try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(() => true, fallback); } catch (e) { /* yedek */ }
    return fallback();
  }
  function copied(ok, what) {
    if (ok) note({ title: 'Kopyalandı!', sub: what || 'Linki arkadaşlarına yapıştır.', icon: svg('copy'), cls: 'n-ok', ms: 1700 });
    else note({ title: 'Kopyalanamadı', sub: 'Kodu elle yaz: ' + shareInfo().code, icon: svg('info'), cls: 'n-err', ms: 2600 });
  }
  function doShare(to) {
    const si = shareInfo(typeof to === 'string' ? to : '');
    if (!si.code) return;
    if (navigator.share && touchMode) {
      try { const p = navigator.share({ title: 'Fuat Morel', text: si.text, url: si.link }); if (p && p.catch) p.catch(() => { }); return; } catch (e) { /* aşağıdaki pencere */ }
    }
    copyText(si.link).then(ok => { if (ok) copied(true); });
    openModal('share',
      '<div class="pnl pnl-sm pnl-share">' + ribbon('ARKADAŞINI ÇAĞIR', 'rb-green') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="sh-body"><span class="sh-l">Oda kodu</span><b class="sh-code">' + esc(si.code) + '</b>' +
          '<span class="sh-link">' + esc(si.link) + '</span></div>' +
        '<div class="cf-btns"><a class="btn b-green sh-wa" href="https://wa.me/?text=' + encodeURIComponent(si.text + ' ' + si.link) + '" target="_blank" rel="noopener">' + svg('share') + '<span>WHATSAPP</span></a>' +
          '<button class="btn b-blue cf-ok" data-act="copylink">' + svg('copy') + '<span>KOPYALA</span></button></div>' +
      '</div>');
  }
  function openCharPick() {
    const cur = selChar();
    let h = '';
    FM.ORDER.forEach((id, i) => {
      h += '<button class="cpk ' + (id === cur ? 'on' : '') + '" data-act="chset" data-id="' + esc(id) + '" style="--cc:' + esc(chBg(id)) + ';--d:' + (i * .03).toFixed(2) + 's">' +
        '<span class="cpk-pt">' + pt(id, 80, { skin: equipped('skins', id) }) + '</span><b>' + esc(id) + '</b><em>' + esc((FM.CH[id] && FM.CH[id].ab) || '') + '</em></button>';
    });
    openModal('chpick', '<div class="pnl pnl-cpk">' + ribbon('KARAKTERİNİ SEÇ', 'rb-purple') +
      '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
      '<div class="cpk-g">' + h + '</div><p class="cpk-tip">Hepsi eşit güçte; fark görünüş ve özel güçte.</p></div>');
  }
  function setLobbyChar(id) {
    if (!FM.CH[id]) return;
    sv().selChar = id; if (typeof FM.persist === 'function') FM.persist();
    const lo = FM.meta && typeof FM.meta.loadout === 'function' ? FM.meta.loadout(id) : null;
    ncall('setProfile', Object.assign({ char: id, skin: equipped('skins', id), trail: equipped('trails', id), plate: equipped('plates', id) }, lo ? { hat: lo.hat, win: lo.win, death: lo.death } : {}));
    closeModalHard(); sfx('select');
    updateLobby(true);
  }
  function mpEmote(e) {
    if (!e) return;
    const ok = gcall('emote', e);
    if (ok === false) return;
    const me = ncall('pid');
    if (me) st.mpEmo[me] = { e, t: nowMs() };
    updateLobby();
  }

  /* ---------- iPhone tam ekran rehberi: Safari öğe tam ekranına izin vermez; Ana Ekrana Ekle ile açılan uygulama
     adres çubuğu olmadan tam ekran çalışır. iPhone ana ekran uygulamasının kaydını Safari'den AYRI tutar: kod ile taşınır. ---------- */
  function openIosFull() {
    const step = (n, t) => '<li class="ios-st"><span class="ios-n">' + n + '</span><span class="ios-tx">' + t + '</span></li>';
    openModal('iosfull',
      '<div class="pnl pnl-sm pnl-ios">' + ribbon('TAM EKRAN OYNA', 'rb-gold') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="ios-body">' +
          '<p class="ios-lead">iPhone, Safari\'de tam ekrana izin vermiyor. Oyunu <b>ana ekrana ekle</b>, üst çubuk olmadan açılsın:</p>' +
          '<ol class="ios-steps">' +
            step(1, '<b>Paylaş</b>\'a dokun <span class="ios-ic">' + svg('share') + '</span>') +
            step(2, '<b>Ana Ekrana Ekle</b> › <b>Ekle</b>') +
            step(3, 'Ana ekrandaki <b>Fuat Morel</b> simgesinden aç') +
          '</ol>' +
          '<div class="ios-save"><span class="ios-sv-t">' + svg('info') + '<span>İlerlemen Safari\'de kalır: önce <b>kodunu al</b>, uygulamada <b>KOD GİR</b> ile getir.</span></span>' +
            '<button class="btn sm b-blue" data-act="iosexp">' + svg('share') + '<span>KAYDIMI TAŞI</span></button></div>' +
        '</div>' +
      '</div>');
  }
  function freshSave() {
    const s = sv(), stt = s.stats || {};
    return (s.level | 0) <= 1 && !(stt.races > 0) && !(stt.playSec > 300);
  }
  function openIosImport() {
    openModal('iosimp',
      '<div class="pnl pnl-sm pnl-ios">' + ribbon('HOŞ GELDİN!', 'rb-green') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="ios-body">' +
          '<p class="ios-lead">Oyun artık tam ekran. Safari\'de oynadıysan ilerlemen orada kaldı: Safari\'de <b>Ayarlar › KODUMU AL</b> ile aldığın kodu buraya gir.</p>' +
          '<div class="cf-btns"><button class="btn b-steel" data-act="mclose">YENİ BAŞLA</button><button class="btn b-green cf-ok" data-act="iosimp">' + svg('down') + '<span>KOD GİR</span></button></div>' +
        '</div>' +
      '</div>');
  }

  /* ---------- kayıt kodu (Ayarlar): dışa aktar (bulut kısa kod / uzun kod) ve içe aktar (kod → önizleme → onay) ---------- */
  function openExport() {
    openModal('svexp',
      '<div class="pnl pnl-sm pnl-sv">' + ribbon('KAYDINI TAŞI', 'rb-blue') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="sv-body">' +
          '<p class="sv-t">Başka telefona ya da tarayıcıya geçerken ilerlemeni bu kodla taşı.</p>' +
          '<div class="sv-box sv-cloud"><span class="sv-h">' + svg('wifi') + 'KISA KOD (internetten)</span><div class="sv-out" data-cloud>' +
            '<button class="btn b-gold" data-act="svcloud">' + svg('share') + '<span>KISA KOD AL</span></button></div></div>' +
          '<div class="sv-box"><span class="sv-h">' + svg('copy') + 'UZUN KOD (internetsiz)</span><div class="sv-out">' +
            '<button class="btn b-blue" data-act="svlong">' + svg('copy') + '<span>UZUN KODU KOPYALA</span></button></div></div>' +
        '</div>' +
      '</div>');
  }
  function svCloud(el) {
    if (!hasMeta('cloudSave')) return;
    const box = $('[data-cloud]', Ls.mdl);
    if (box) box.innerHTML = '<span class="sv-wait"><i class="spin sm"><i></i></i>Kod hazırlanıyor…</span>';
    Promise.resolve(mcall('cloudSave')).then(r => {
      const b = $('[data-cloud]', Ls.mdl); if (!b) return;
      if (r && r.ok) {
        b.innerHTML = '<b class="sv-code">' + esc(r.text || r.code) + '</b><button class="btn sm b-blue" data-act="svcopy" data-v="' + esc(r.code) + '">' + svg('copy') + '<span>KOPYALA</span></button>' +
          (r.warn ? '<span class="sv-warn">' + esc(r.warn) + '</span>' : '');
      } else b.innerHTML = '<span class="sv-warn err">' + esc((r && r.err) || 'Kod alınamadı, uzun kodu kullan.') + '</span><button class="btn sm b-gold" data-act="svcloud">TEKRAR</button>';
    });
    void el;
  }
  function svLong() {
    if (!hasMeta('exportCode')) return;
    Promise.resolve(mcall('exportCode')).then(code => {
      if (!code) { note({ title: 'Kod oluşturulamadı', icon: svg('info'), cls: 'n-err', ms: 2000 }); return; }
      copyText(code).then(ok => copied(ok, 'Uzun kayıt kodu panoda. Yeni cihazda Ayarlar › Kod gir.'));
    });
  }
  function openImport() {
    st.imp = null;
    openModal('svimp',
      '<div class="pnl pnl-sm pnl-sv">' + ribbon('KAYIT YÜKLE', 'rb-blue') +
        '<button class="rbtn b-red mdl-x" data-act="mclose" aria-label="Kapat">' + svg('close') + '</button>' +
        '<div class="sv-body" data-imp>' +
          '<p class="sv-t">Kısa kodu (ör. ABCD-2345) ya da uzun kodu yapıştır.</p>' +
          '<div class="code-in"><input class="cin imp-in" type="text" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" data-enter="svimpgo" placeholder="KOD" aria-label="Kayıt kodu">' +
          '<button class="btn b-blue" data-act="svimpgo">' + svg('play') + '<span>GETİR</span></button></div>' +
        '</div>' +
      '</div>');
  }
  function impRow(l, a, b) { return '<div class="ip-r"><span>' + l + '</span><b>' + a + '</b><b class="nw">' + b + '</b></div>'; }
  function svImpGo() {
    const i = $('.imp-in', Ls.mdl), v = i ? i.value.trim() : '';
    if (!v || !hasMeta('importCode')) return;
    const box = $('[data-imp]', Ls.mdl);
    const keep = box ? box.innerHTML : '';
    if (box) box.innerHTML = '<span class="sv-wait"><i class="spin sm"><i></i></i>Kayıt aranıyor…</span>';
    Promise.resolve(mcall('importCode', v)).then(r => {
      const b = $('[data-imp]', Ls.mdl); if (!b) return;
      if (!r || !r.ok) {
        b.innerHTML = keep;
        const i2 = $('.imp-in', b); if (i2) i2.value = v;
        note({ title: 'Kayıt bulunamadı', sub: (r && r.err) || 'Kodu kontrol et.', icon: svg('info'), cls: 'n-err', ms: 2600 });
        return;
      }
      st.imp = r;
      const c = r.current || {}, n = r.preview || {};
      b.innerHTML = '<p class="sv-t">Bu kayıt yüklensin mi? Şimdiki ilerlemen yedeklenir.</p>' +
        '<div class="ip"><div class="ip-r ip-h"><span></span><b>Bu cihaz</b><b class="nw">Yüklenecek</b></div>' +
          impRow('Takma ad', esc(c.nick || '—'), esc(n.nick || '—')) + impRow('Seviye', fmtN(c.level), fmtN(n.level)) +
          impRow('Altın', fmtN(c.coins), fmtN(n.coins)) + impRow('Elmas', fmtN(c.gems), fmtN(n.gems)) +
          impRow('Kupa', fmtN(c.trophies), fmtN(n.trophies)) + impRow('Yarış', fmtN(c.races), fmtN(n.races)) + '</div>' +
        '<div class="cf-btns"><button class="btn b-steel" data-act="mclose">VAZGEÇ</button><button class="btn b-green cf-ok" data-act="svimpok">' + svg('check') + '<span>YÜKLE</span></button></div>';
    });
  }
  function svImpOk() {
    const r = st.imp; if (!r) return;
    let ok = false;
    try { ok = typeof r.apply === 'function' ? !!r.apply() : !!mcall('applyImport'); } catch (e) { console.error('[ui içe aktar]', e); }
    st.imp = null;
    closeModalHard();
    if (ok) { st.lastCur = null; note({ title: 'Kayıt yüklendi!', sub: 'İlerlemen bu cihaza taşındı.', icon: svg('check'), cls: 'n-ok', ms: 2400 }); refreshSoon(); }
    else note({ title: 'Yüklenemedi', sub: 'Yarış sırasında yüklenmez; menüde tekrar dene.', icon: svg('info'), cls: 'n-err', ms: 2600 });
  }

  /* ---------- uygulama-içi tarayıcı (WhatsApp, Instagram...) bandı: bir kez kapatılabilir ---------- */
  const iab = document.createElement('div');
  iab.className = 'iab'; root.appendChild(iab);
  function syncIab() {
    let k = null;
    try { k = typeof FM.inAppBrowser === 'function' ? FM.inAppBrowser() : null; } catch (e) { k = null; }
    if (FM.DEV && FM.params && FM.params.iab) k = FM.params.iab;
    const on = !!k && st.view === 'menu' && (st.screen === 'menu' || st.screen === 'friends' || st.screen === 'lobby') && !lsGet('fm-iab-x');
    if (on && !iab.firstChild) {
      const nm = (FM.IN_APP_NAMES && FM.IN_APP_NAMES[k]) || 'Uygulama';
      iab.innerHTML = '<span class="iab-ic">' + svg('info') + '</span><span class="iab-t"><b>' + esc(nm) + ' tarayıcısındasın.</b> İlerlemenin kaybolmaması için ⋮ / paylaş menüsünden <b>' + (isIOS() ? 'Safari' : 'Chrome') + '\'de aç</b>, sonra <b>Ana ekrana ekle</b>.</span>' +
        '<button class="rbtn b-red iab-x" data-act="iabx" aria-label="Kapat">' + svg('close') + '</button>';
    }
    iab.classList.toggle('on', on);
  }
  function pwaCard() {
    let inst = false;
    try { inst = typeof FM.isStandalone === 'function' ? FM.isStandalone() : isStandalone(); } catch (e) { inst = false; }
    let can = false;
    try { can = !!(FM.pwa && typeof FM.pwa.canInstall === 'function' && FM.pwa.canInstall()); } catch (e) { can = false; }
    if (inst) return '<div class="set-card"><h4>' + svg('home') + 'ANA EKRAN</h4><p class="set-tip sv-okline">' + svg('check') + 'Oyunu ana ekrandan açtın: ilerlemen güvende.</p></div>';
    return '<div class="set-card"><h4>' + svg('home') + 'ANA EKRANA EKLE</h4>' +
      '<p class="set-tip">Ana ekrandan açınca tam ekran olur ve ilerlemen hep aynı yerde kalır.</p>' +
      (can ? '<div class="srow"><span class="s-l s-wide">Tek dokunuşla ekle.</span><button class="btn sm b-green" data-act="pwainst">EKLE</button></div>' : '') +
      '<div class="a2h"><span><b>Android:</b> Chrome ⋮ › <b>Ana ekrana ekle</b></span><span><b>iPhone:</b> Safari › Paylaş › <b>Ana Ekrana Ekle</b></span></div>' +
    '</div>';
  }

  /* =====================================================================
     23) EYLEMLER (tek tıklama dinleyicisi, data-act)
     ===================================================================== */
  function fail(el, cur) {
    if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    const pill = $('.cur[data-cur="' + cur + '"]');
    if (pill) { pill.classList.remove('flash-red'); void pill.offsetWidth; pill.classList.add('flash-red'); }
    sfx('error'); buzz(35);
    note({ title: cur === 'gems' ? 'Yetersiz elmas!' : 'Yetersiz altın!', sub: 'Yarış koş ve görevleri tamamla.', icon: cur === 'gems' ? gemI(40) : coinI(40), cls: 'n-err', ms: 1900 });
  }
  function success(key, title, sub) {
    st.flashKey = key;
    sfx('buy');
    note({ title, sub, icon: svg('check'), cls: 'n-ok', ms: 1800 });
    refreshSoon();
  }
  /** Satın almada ikinci dokunuşla onay (görünümlerdeki onay kutusuyla tutarlı; kaydırırken yanlış dokunma para yakmasın).
      İlk dokunuş düğmeyi 3 sn "ONAYLA" durumuna alır; true yalnızca onay dokunuşunda döner. */
  function armBuy(el) {
    const t = nowMs();
    if (el._armT && t - el._armT < 3000) { el._armT = 0; return true; }
    for (const b of $$('.buy.armed')) disarmBuy(b);
    const b = el.querySelector('b');
    el._armT = t;
    if (b) { el._armTxt = b.textContent; el.style.minWidth = el.offsetWidth + 'px'; b.textContent = 'ONAYLA'; }
    el.classList.add('armed');
    sfx('select'); buzz(10);
    setTimeout(() => { if (el.isConnected && el._armT === t) disarmBuy(el); }, 3000);
    return false;
  }
  function disarmBuy(el) {
    el._armT = 0; el.classList.remove('armed');
    const b = el.querySelector('b'); if (b && el._armTxt != null) b.textContent = el._armTxt;
    el.style.minWidth = '';
  }
  function doUpgrade(el) {
    const key = el.getAttribute('data-key'), ch = el.getAttribute('data-ch') || selChar();
    const u = (upgrades(ch) || []).find(x => x.key === key);
    if (!u || !hasMeta('buyUpgrade')) return;
    if ((+u.lv || 0) >= (+u.max || 1)) return;
    const p = priceOf(u);
    if (!canAfford(p)) { fail(el, p.cur); return; }
    if (!armBuy(el)) return;
    if (!mcall('buyUpgrade', key, ch)) { fail(el, p.cur); return; }
    success('up:' + key, 'Yükseltildi!', (u.n || 'Geliştirme') + ' artık daha güçlü.');
  }
  function doBuyCos(el) {
    const type = el.getAttribute('data-type'), id = el.getAttribute('data-id'), ch = el.getAttribute('data-ch') || selChar();
    const it = cosItem(type, id);
    if (!it) return;
    const cur = cosCur(type, id);
    if (curAmt(cur) < (+it.price || 0)) { fail(el, cur); return; }
    if (!armBuy(el)) return;
    if (!buyCos(type, id, ch)) { fail(el, cur); return; }
    equip(type, id, ch);
    success(type + ':' + id, 'Satın alındı!', it.n + ' kuşanıldı.');
  }
  function doEquip(el) {
    const type = el.getAttribute('data-type'), id = el.getAttribute('data-id'), ch = el.getAttribute('data-ch') || selChar();
    equip(type, id, ch);
    st.flashKey = type + ':' + id;
    refreshSoon();
  }
  /** Mağaza 2.0 satın alma: bugünkü (vitrin indirimli) fiyat, iki dokunuşla onay, otomatik kuşanma */
  function doShopBuy(el) {
    const type = el.getAttribute('data-type'), id = el.getAttribute('data-id'), ch = el.getAttribute('data-ch') || selChar();
    const v = cosView(type, id, ch); if (!v) return;
    if (v.owned) { equip(type, id, ch); refreshSoon(); return; }
    if (curAmt(v.cur) < v.price) { fail(el, v.cur); return; }
    if (!armBuy(el)) return;
    if (!buyCos(type, id, ch)) { fail(el, v.cur); return; }
    equip(type, id, ch);
    if (type === 'skins') st.cheerNext = true;
    buzz(25);
    success('cos:' + type + ':' + id, v.rar === 'l' ? 'EFSANEVİ ürün senin!' : v.rar === 'e' ? 'Destansı ürün senin!' : 'Satın alındı!', v.n + ' kuşanıldı' + (v.off ? ' · %' + v.off + ' indirimle!' : '.'));
  }
  function skinClick(el) {
    const id = el.getAttribute('data-id'), ch = el.getAttribute('data-ch') || selChar();
    if (equipped('skins', ch) === id) return;
    if (owns('skins', id, ch)) { equip('skins', id, ch); st.flashKey = 'sk:' + id; st.cheerNext = true; refreshSoon(); return; }
    const it = cosItem('skins', id); if (!it) return;
    const cur = cosCur('skins', id);
    confirmBox({
      title: 'GÖRÜNÜM', rcls: 'rb-gold',
      art: '<div class="cf-art sk-' + esc(id) + '">' + pt(ch, 140, { skin: id }) + '</div>',
      text: '<b>' + esc(ch) + '</b> için <b>' + esc(it.n) + '</b> görünümü satın alınsın mı?',
      ok: curIcon(cur, 28, 'bi') + '<b>' + fmtN(it.price) + '</b>', okCls: 'b-green',
      onOk: btn => {
        if (curAmt(cur) < it.price || !buyCos('skins', id, ch)) { fail(btn, cur); return false; }
        equip('skins', id, ch); st.cheerNext = true;
        success('sk:' + id, 'Yeni görünüm!', ch + ' · ' + it.n);
        return true;
      }
    });
  }
  function claimMission(el) {
    const id = el.getAttribute('data-id');
    const rw = mcall('claim', id);
    if (!rw) return;
    flyReward(el, rw);
    st.flashKey = 'ms:' + id;
    sfx('reward');
    note({ title: 'Ödül alındı!', rw, icon: svg('gift'), cls: 'n-ok', ms: 1800 });
    refreshSoon();
  }
  function claimDaily(el) {
    const rw = mcall('claimDaily');
    if (!rw) return;
    flyReward(el, rw);
    sfx('reward');
    note({ title: 'Günlük ödül alındı!', rw, icon: svg('gift'), cls: 'n-ok', ms: 2200 });
    refreshSoon();
    if (st.modal === 'daily') setTimeout(() => { if (st.modal === 'daily') closeModalHard(); }, 1500);
  }
  function setSetting(key, val) {
    const s = sv().settings; if (!s) return;
    s[key] = val;
    if (typeof FM.persist === 'function') FM.persist();
    if ((key === 'music' || key === 'sfx') && FM.audio && typeof FM.audio.setVolume === 'function') { try { FM.audio.setVolume(key, val); } catch (e) { /* yok say */ } }
    if (key === 'quality') { applyQuality(); if (typeof FM.resize === 'function') { try { FM.resize(); } catch (e) { console.error(e); } } }
  }
  function applyQuality() { root.classList.toggle('q-low', ((sv().settings || {}).quality) === 'low'); }
  function lockLandscape() { try { if (screen.orientation && screen.orientation.lock) { const p = screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => { }); } } catch (e) { /* yok say */ } }
  function toggleFull(force) {
    const d = document, el = d.documentElement;
    try {
      const on = !!(d.fullscreenElement || d.webkitFullscreenElement);
      if (on && force === true) lockLandscape();
      else if (on) { const x = d.exitFullscreen || d.webkitExitFullscreen; if (x) x.call(d); }
      else {
        const rq = el.requestFullscreen || el.webkitRequestFullscreen;
        if (rq) { const r = rq.call(el, { navigationUI: 'hide' }); if (r && r.then) r.then(lockLandscape, () => { }); }
      }
    } catch (e) { /* desteklenmiyor */ }
  }
  function startGame() {
    if (!FM.game || typeof FM.game.startMatch !== 'function') return;
    const o = soloSel(), ch = selChar();
    st.lastMatch = { rounds: o.rounds, mode: o.mode, theme: o.map, n: o.rivals + 1 };
    if (touchMode) toggleFull(true);
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* yok say */ }
    FM.game.startMatch({ char: ch, rounds: o.rounds, mode: o.mode, theme: o.map, n: o.rivals + 1 });
  }
  function cycleChar(d) {
    const i = FM.ORDER.indexOf(selChar());
    const n = FM.ORDER[(i + d + FM.ORDER.length) % FM.ORDER.length];
    sv().selChar = n;
    if (typeof FM.persist === 'function') FM.persist();
    updateShowcaseOnly();
  }
  const ACT = {
    play: () => showScreen('solo'),
    solostart: () => startGame(),
    smode: el => { const v = el.getAttribute('data-v'); if (!FM.modeById || FM.modeById(v)) { sv().mode = modeOf(v).id; if (typeof FM.persist === 'function') FM.persist(); paint(false); } },
    smap: el => { const v = el.getAttribute('data-v'); if (mapList().indexOf(v) >= 0) { sv().map = v; if (typeof FM.persist === 'function') FM.persist(); paint(false); } },
    rivals: el => {
      const s = sv(); s.rivals = clamp(Math.round(+s.rivals || 3) + (+el.getAttribute('data-d') || 0), 1, 9);
      if (typeof FM.persist === 'function') FM.persist();
      const b = $('.stp-v', Ls.scr); if (b) b.textContent = String(s.rivals);
    },
    rounds: el => {
      const n = +el.getAttribute('data-n');
      if ([1, 3, 5].indexOf(n) < 0) return;
      sv().rounds = n; if (typeof FM.persist === 'function') FM.persist();
      for (const b of $$('.rd', Ls.scr)) b.classList.toggle('on', +b.getAttribute('data-n') === n);
    },
    go: el => showScreen(el.getAttribute('data-to')),
    back: () => goBack(),
    cyc: el => cycleChar(+el.getAttribute('data-d') || 1),
    cview: el => { const id = el.getAttribute('data-id'); if (!FM.CH[id] || st.cview === id) return; st.cview = id; st.cheerNext = true; paint(false); const det = $('.cd-scroll', Ls.scr); if (det) { det.scrollTop = 0; det.classList.add('swap'); } },
    select: el => {
      const id = el.getAttribute('data-id'); if (!FM.CH[id]) return;
      sv().selChar = id; if (typeof FM.persist === 'function') FM.persist();
      st.flashKey = 'cc:' + id; st.cheerNext = true;
      sfx('select');
      note({ title: id + ' seçildi!', sub: (FM.CH[id] && FM.CH[id].ab) || '', icon: pt(id, 48, {}, 'n-pt'), cls: 'n-ok', ms: 1600 });
      paint(false);
    },
    tab: el => {
      const s = el.getAttribute('data-s'), t = el.getAttribute('data-t');
      if (!st.tabs[s] || st.tabs[s] === t) return;
      st.tabs[s] = t; paint(false);
      const tb = $('.tab-body', Ls.scr); if (tb) { tb.scrollTop = 0; tb.classList.add('tab-in'); }
    },
    upg: el => doUpgrade(el),
    reroll: el => {
      const id = el.getAttribute('data-id'), cost = +el.getAttribute('data-cost') || 0;
      const go = btn => {
        if (mcall('rerollMission', id)) { st.flashKey = 'ms:' + id; note({ title: 'Görev değişti!', sub: 'Yeni görevin hazır.', icon: svg('reset'), cls: 'n-ok', ms: 1500 }); refreshSoon(); return true; }
        fail(btn || el, 'gems'); return false;
      };
      if (cost > 0) {
        if (gems() < cost) { fail(el, 'gems'); return; }
        confirmBox({ title: 'GÖREV DEĞİŞTİR', rcls: 'rb-purple', text: 'Bu görev <b>' + cost + ' elmas</b> karşılığında yenisiyle değiştirilsin mi?', ok: gemI(28, 'bi') + '<b>' + cost + '</b>', okCls: 'b-purple', onOk: go });
      } else go();
    },
    startitem: el => {
      const it = el.getAttribute('data-item');
      if (el.classList.contains('locked')) {
        el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
        note({ title: 'Kilitli eşya', sub: 'Başlangıç Eşyası geliştirmesiyle açılır.', icon: svg('lock'), cls: 'n-err', ms: 1700 });
        return;
      }
      if (mcall('selectStartItem', it)) { st.flashKey = 'up:start'; refreshSoon(); }
    },
    pack: el => {
      const id = el.getAttribute('data-id');
      const pk = (mcall('packs') || []).find(x => x.id === id);
      if (!pk) return;
      if (gems() < pk.gems) { fail(el, 'gems'); return; }
      confirmBox({
        title: 'HAZİNE', rcls: 'rb-gold',
        art: '<div class="cf-art cf-pack">' + anyIcon(pk.icon, 96) + '</div>',
        text: '<b>' + fmtN(pk.gems) + ' elmas</b> bozdurulup <b>' + fmtN(pk.coins) + ' altın</b> alınsın mı?',
        ok: gemI(28, 'bi') + '<b>' + fmtN(pk.gems) + '</b>', okCls: 'b-green',
        onOk: btn => {
          if (!mcall('exchange', id)) { fail(btn, 'gems'); return false; }
          flyReward(el, { coins: pk.coins });
          success('pack:' + id, 'Altınlar kesende!', '+' + fmtN(pk.coins) + ' altın');
          return true;
        }
      });
    },
    skin: el => skinClick(el),
    buycos: el => doBuyCos(el),
    equip: el => doEquip(el),
    // Mağaza 2.0: kart seç (canlı önizleme), satın al (iki dokunuşla onay, vitrin indirimi meta'da), kuşan
    shopsel: el => {
      const type = el.getAttribute('data-type'), id = el.getAttribute('data-id');
      if (!type || !id) return;
      const key = type + ':' + id;
      if (st.shopSel[st.tabs.shop] === key) return;
      st.shopSel[st.tabs.shop] = key; click(); paint(false);
    },
    shopbuy: el => doShopBuy(el),
    shopeq: el => {
      const type = el.getAttribute('data-type'), id = el.getAttribute('data-id'), ch = el.getAttribute('data-ch') || selChar();
      if (!owns(type, id, ch)) return;
      equip(type, id, ch);
      st.flashKey = 'cos:' + type + ':' + id; sfx('select'); buzz(10);
      refreshSoon();
    },
    claim: el => claimMission(el),
    claimDaily: el => claimDaily(el),
    daily: () => openDaily(),
    tgl: el => {
      const k = el.getAttribute('data-set'), cur = !!setting(k);
      setSetting(k, !cur);
      el.classList.toggle('on', !cur); el.setAttribute('aria-checked', String(!cur));
      if (k === 'haptic' && !cur) FM.haptic('ready');
      if (k === 'lefty' || k === 'btnSize') applyTcPrefs();
    },
    segset: el => {
      const k = el.getAttribute('data-set'), v = el.getAttribute('data-v');
      setSetting(k, v);
      for (const b of $$('.seg button[data-set="' + k + '"]', Ls.scr)) b.classList.toggle('on', b.getAttribute('data-v') === v);
      if (k === 'btnSize') { applyTcPrefs(); FM.haptic('tap'); }
    },
    tglnotify: el => toggleNotify(el),
    rejoin: () => {
      const rj = rejoinData(); if (!rj) { refreshSoon(); return; }
      const ok = gcall('rejoin');
      if (ok === false) { note({ title: 'Odaya dönülemedi', sub: 'Oda kapanmış olabilir.', icon: svg('door'), cls: 'n-err', ms: 2800 }); gcall('forgetRoom'); refreshSoon(); return; }
      openRejoin(rj.code);
    },
    rejoinx: () => { gcall('forgetRoom'); refreshSoon(); },
    joinroom: el => joinCode(el.getAttribute('data-code')),
    prof: el => openProfile(el.getAttribute('data-pid')),
    invite: el => doShare(el.getAttribute('data-nick')),
    lbtab: el => { const t = el.getAttribute('data-t') === 'fr' ? 'fr' : 'set'; if (st.lbTab === t) return; st.lbTab = t; updateLobby(true); },
    q: el => { const v = el.getAttribute('data-v') === 'low' ? 'low' : 'high'; setSetting('quality', v); for (const b of $$('.seg button')) b.classList.toggle('on', b.getAttribute('data-v') === v); },
    full: () => toggleFull(),
    reset: () => confirmBox({
      title: 'SIFIRLA', rcls: 'rb-red',
      art: '<div class="cf-art cf-warn">' + svg('reset') + '</div>',
      text: 'Altın, elmas, seviye, görünümler ve kupalar <b>tamamen silinecek</b>. Bu işlem geri alınamaz!',
      ok: '<span>SIFIRLA</span>', okCls: 'b-red',
      onOk: () => {
        if (typeof FM.resetSave === 'function') FM.resetSave();
        st.lastCur = null; st.dailyShown = false;
        applyQuality();
        const s = sv().settings || {};
        try { if (FM.audio && typeof FM.audio.setVolume === 'function') { FM.audio.setVolume('music', s.music); FM.audio.setVolume('sfx', s.sfx); } } catch (e) { /* yok say */ }
        setTimeout(() => { showScreen('menu'); note({ title: 'İlerleme sıfırlandı', sub: 'Yeni bir başlangıç!', icon: svg('reset'), cls: 'n-ok' }); }, 0);
        return true;
      }
    }),
    mclose: () => closeModal(),
    mok: el => okModal(el),
    pause: () => {
      if (st.modal === 'pause') return;
      if (nowMs() - (st.pzT || 0) < 450) return;          // dokunmatik pointerup ile zaten açıldı (ardından gelen click)
      if (canPause()) openPause();
    },
    rotfull: () => { toggleFull(true); lockLandscape(); setTimeout(checkRotate, 400); },
    resume: () => resumeGame(),
    quit: el => {
      const t = nowMs();
      if (st.quitArm && t - st.quitArm < 3000) { st.quitArm = 0; doQuit(); return; }
      st.quitArm = t;
      el.classList.add('armed');
      const q = el.querySelector('.q-t'); if (q) q.textContent = 'EMİN MİSİN?';
      setTimeout(() => { if (el.isConnected) { el.classList.remove('armed'); if (q) q.textContent = el.getAttribute('data-t') || 'MENÜYE DÖN'; } }, 3000);
    },
    next: el => {
      if (st.view !== 'results') return;
      st.view = 'busy';
      if (el) el.disabled = true;
      if (FM.game && typeof FM.game.next === 'function') FM.game.next();
    },
    resquit: () => confirmBox({
      title: 'MAÇTAN ÇIK', rcls: 'rb-red', text: 'Maçı bırakıp menüye dönmek istiyor musun?', ok: '<span>ÇIK</span>', okCls: 'b-red',
      onOk: () => { setTimeout(() => { if (FM.game && typeof FM.game.toMenu === 'function') FM.game.toMenu(); else showScreen('menu'); }, 0); return true; }
    }),
    replay: () => {
      if (!FM.game || typeof FM.game.startMatch !== 'function') return;
      const o = soloSel(), lm = st.lastMatch || {};
      FM.game.startMatch({ char: selChar(), rounds: lm.rounds || o.rounds, mode: lm.mode || o.mode, theme: lm.theme || o.map, n: lm.n || o.rivals + 1 });
    },
    menu: () => { if (FM.game && typeof FM.game.toMenu === 'function') FM.game.toMenu(); else showScreen('menu'); },
    /* ---- çok oyunculu ---- */
    golobby: () => { if (mpInRoom()) showScreen('lobby'); else showScreen('friends'); },
    nick: () => openNick(null),
    nickok: () => nickOk(),
    mpcreate: () => withNick(mpCreate),
    mpjoin: () => { const i = $('.cin', Ls.scr); const v = i ? i.value : st.mpCode; st.mpCode = v || ''; withNick(() => mpJoin(v)); },
    mpcancel: () => { const rj = st.rejoining; st.rejoining = false; closeModalHard(); gcall('leave'); if (rj) gcall('forgetRoom'); if (NET() && !mpInRoom()) ncall('clearUrlCode'); },
    lbleave: () => confirmBox({
      title: 'ODADAN AYRIL', rcls: 'rb-red', art: '<div class="cf-art cf-warn">' + svg('door') + '</div>',
      text: mpHost() ? 'Ayrılırsan ev sahipliği başka bir oyuncuya geçer.' : 'Odadan ayrılıp ana menüye dönülsün mü?',
      ok: '<span>AYRIL</span>', okCls: 'b-red',
      onOk: () => { setTimeout(() => { gcall('leave'); ncall('clearUrlCode'); if (st.view === 'menu') showScreen('menu'); }, 0); return true; }
    }),
    mpleave: () => confirmBox({
      title: 'ODADAN AYRIL', rcls: 'rb-red', art: '<div class="cf-art cf-warn">' + svg('door') + '</div>',
      text: 'Maçı bırakıp odadan ayrılmak istiyor musun?', ok: '<span>AYRIL</span>', okCls: 'b-red',
      onOk: () => {
        setTimeout(() => {
          gcall('leave'); ncall('clearUrlCode');
          if (st.view !== 'menu' && st.view !== 'race') { if (FM.game && typeof FM.game.toMenu === 'function') FM.game.toMenu(); else showScreen('menu'); }
        }, 0);
        return true;
      }
    }),
    share: () => doShare(),
    copylink: () => { const si = shareInfo(); if (!si.code) return; copyText(si.link).then(ok => copied(ok)); },
    lcfg: el => {
      if (!mpHost()) return;
      const d = lobbyData(); if (!d || !d.lob) return;
      const cur = normCfg(d.lob.cfg), k = el.getAttribute('data-k'), dd = +el.getAttribute('data-d') || 0;
      let patch = null;
      if (k === 'mode') { const L = MODES().map(m => m.id); patch = { mode: L[(L.indexOf(cur.mode) + dd + L.length) % L.length] }; }
      else if (k === 'map') { const L = mapList(); patch = { map: L[(Math.max(0, L.indexOf(cur.map)) + dd + L.length) % L.length] }; }
      else if (k === 'rounds') patch = { rounds: [1, 3, 5].indexOf(+el.getAttribute('data-v')) >= 0 ? +el.getAttribute('data-v') : 3 };
      else if (k === 'bots') patch = { bots: !cur.bots };
      if (!patch) return;
      ncall('setConfig', patch);
      lsSet('fm-mpcfg', JSON.stringify(Object.assign({}, cur, patch)));
      updateLobby();
    },
    lbready: () => {
      const d = lobbyData(); if (!d) return;
      const me = d.pl.find(p => p.me) || {};
      ncall('setReady', !me.ready); sfx(me.ready ? 'click' : 'select'); buzz(12);
      updateLobby();
    },
    lbstart: el => {
      const d = lobbyData(); if (!d || !mpHost()) return;
      const others = d.pl.filter(p => !p.me && !p.off), notReady = others.filter(p => !p.ready).length;
      const go = () => {
        if (touchMode) toggleFull(true);
        const ok = gcall('hostStart');
        if (!ok) { note({ title: 'Başlatılamadı', sub: 'Bağlantıyı bekle ve tekrar dene.', icon: svg('info'), cls: 'n-err', ms: 2000 }); return; }
        if (el && el.isConnected) el.disabled = true;
      };
      if (notReady > 0) confirmBox({ title: 'HERKES HAZIR DEĞİL', rcls: 'rb-gold', text: '<b>' + notReady + '</b> oyuncu henüz hazır değil. Yine de hemen başlatılsın mı?', ok: svg('play') + '<span>HEMEN BAŞLAT</span>', okCls: 'b-gold', onOk: () => { setTimeout(go, 0); return true; } });
      else go();
    },
    chpick: () => openCharPick(),
    chset: el => setLobbyChar(el.getAttribute('data-id')),
    lbemo: () => { const e = $('.lb-emo', Ls.scr); if (e) e.classList.toggle('on'); },
    emotog: () => { if (nowMs() - (st.emT || 0) < 450 && st.emLast === 'tog') return; st.emLast = 'tog'; Ls.race.classList.toggle('emo-open'); },
    emo: el => {
      if (nowMs() - (st.emT || 0) < 450 && st.emLast === 'emo') return;
      st.emLast = 'emo';
      mpEmote(el.getAttribute('data-e'));
      Ls.race.classList.remove('emo-open');
      const e = $('.lb-emo', Ls.scr); if (e) e.classList.remove('on');
    },
    skipres: () => { if (FM.game && typeof FM.game.finishNow === 'function') FM.game.finishNow(); },
    tolobby: el => { if (gcall('hostToLobby') && el) el.disabled = true; },
    reload: () => { try { location.reload(); } catch (e) { /* yok say */ } },
    iabx: () => { lsSet('fm-iab-x', '1'); syncIab(); },
    pwainst: () => { try { if (FM.pwa && typeof FM.pwa.install === 'function') Promise.resolve(FM.pwa.install()).then(() => refreshSoon()); } catch (e) { /* yok say */ } },
    iosfull: () => openIosFull(),
    iosimp: () => { closeModalHard(); showScreen('settings'); openImport(); },
    iosexp: () => { closeModalHard(); openExport(); },
    svexp: () => openExport(),
    svimp: () => openImport(),
    svcloud: el => svCloud(el),
    svlong: () => svLong(),
    svcopy: el => copyText(el.getAttribute('data-v') || '').then(ok => copied(ok, 'Kısa kod panoda.')),
    svimpgo: () => svImpGo(),
    svimpok: () => svImpOk()
  };
  root.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || !root.contains(el) || el.disabled) return;
    const a = el.getAttribute('data-act');
    if (!a || !ACT[a]) return;
    if (a === 'pause' && nowMs() - (st.pzT || 0) < 450) return;   // pointerup ile zaten açıldı
    if ((a === 'emo' || a === 'emotog') && el.closest('.ly-race') && nowMs() - (st.emT || 0) < 450) return;
    // Android: menüdeki ilk dokunuşta bir kez tam ekrana geç (adres çubuğu yer kaplamasın)
    if (touchMode && !st.autoFs && !FM.DEV) {
      st.autoFs = true;   // oturum başına yalnızca bir kez (oyuncu tam ekrandan çıkarsa zorlama)
      // OYNA ve tam ekran düğmeleri zaten kendileri ister
      if (a !== 'full' && a !== 'rotfull' && a !== 'play' && fsOK() && !isIOS() && !isStandalone()) toggleFull(true);
    }
    click();
    try { ACT[a](el, e); } catch (err) { console.error('[ui eylem ' + a + ']', err); }
    // fareyle tıklanan düğmede odak kalmasın: yoksa Enter 'OYNA' yerine o düğmeye basar
    if (e.detail > 0 && el.tagName === 'BUTTON' && el.isConnected && document.activeElement === el) { try { el.blur(); } catch (x) { /* yok say */ } }
  });
  root.addEventListener('input', e => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('input[data-set]')) return;
    const k = el.getAttribute('data-set'), v = clamp(+el.value || 0, 0, 100);
    el.style.setProperty('--v', v + '%');
    for (const l of $$('[data-v="' + k + '"]')) l.textContent = String(v);
    setSetting(k, v / 100);
  });
  root.addEventListener('change', e => { const el = e.target; if (el && el.matches && el.matches('input[data-set]')) click(); });
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !touchMode) setTouch(true); }, true);

  /* ---------- klavye ---------- */
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key;
    const ae = document.activeElement;
    const onCtl = ae && ae !== document.body && root.contains(ae) && /^(BUTTON|INPUT)$/.test(ae.tagName);
    // yazı alanında Enter: alanın data-enter eylemi (takma ad, oda kodu, kayıt kodu)
    if (k === 'Enter' && ae && ae.tagName === 'INPUT' && ae.getAttribute('data-enter') && root.contains(ae)) {
      e.preventDefault(); click();
      const a = ae.getAttribute('data-enter'); if (ACT[a]) { try { ACT[a](ae); } catch (err) { console.error(err); } }
      return;
    }
    if (ae && ae.tagName === 'INPUT' && ae.type === 'text' && k !== 'Escape') return;   // yazarken kısayol yok
    if (st.modal === 'pause') {
      if (k === 'Enter' && !onCtl) { e.preventDefault(); click(); resumeGame(); }
      return;   // Esc'i main.js 'ui:pause' ile iletir
    }
    if (st.modal) {
      if (k === 'Escape') { e.preventDefault(); click(); closeModal(); }
      else if (k === 'Enter' && !onCtl) {
        e.preventDefault();
        const b = $('.cf-ok, .dc-claim', Ls.mdl); if (b) b.click();
      }
      return;
    }
    if (st.view === 'menu') {
      if (k === 'Enter' && (st.screen === 'menu' || st.screen === 'solo') && !onCtl) { e.preventDefault(); click(); startGame(); }
      else if (k === 'Escape' && st.screen !== 'menu') { e.preventDefault(); click(); goBack(); }
      else if (st.screen === 'menu' && (k === 'ArrowLeft' || k === 'ArrowRight') && !onCtl) { e.preventDefault(); click(); cycleChar(k === 'ArrowLeft' ? -1 : 1); }
    } else if (st.view === 'results') {
      if (k === 'Enter' && !onCtl) { e.preventDefault(); const b = $('.btn-next', Ls.res); if (b) b.click(); }
    } else if (st.view === 'final') {
      if (k === 'Enter' && !onCtl) { e.preventDefault(); click(); ACT.replay(); }
      else if (k === 'Escape') { e.preventDefault(); click(); ACT.menu(); }
    }
  });

  /* =====================================================================
     24) OYUN OLAYLARI
     ===================================================================== */
  FM.on('ui:menu', () => {
    // odadaysan ve lobideysen menüye değil lobiye dön ("lobi unutulmasın")
    if (mpInRoom() && (gcall('state') || {}).phase === 'lobby' && !FM.DEV) { showLobby(); return; }
    showScreen('menu');
    // sayfa yenilenince otomatik odaya dönülüyorsa (mp:rejoining olayı ui yüklenmeden geldiyse) bekleme penceresi
    if (!st.modal && !mpInRoom() && mpBusy() && !ncall('codeFromUrl')) openRejoin(ncall('code'));
    // ?oda=KOD linkiyle açıldıysa doğrudan katıl (takma ad yoksa önce sor)
    tryAutoJoin();
    if (!st.dailyShown && !FM.DEV && dailyReady()) {
      st.dailyShown = true;
      // başka pencere (takma ad sorusu vb.) açıksa kapanmasını bekle
      const tryDaily = k => { if (st.view !== 'menu' || st.screen !== 'menu' || !dailyReady()) return; if (st.modal) { if (k < 40) setTimeout(() => tryDaily(k + 1), 1500); } else openDaily(); };
      setTimeout(() => tryDaily(0), 800);
    }
    // takma ad hiç seçilmediyse (çevrimiçi listesinde karakter adıyla — ör. "Kral" — görünmesin) oturumda bir kez sor
    if (!FM.DEV && NET() && sv().nickSet !== true && !st.nickAsked && !ncall('codeFromUrl')) {
      st.nickAsked = true;
      setTimeout(() => { if (st.view === 'menu' && st.screen === 'menu' && !st.modal && sv().nickSet !== true) openNick(null); }, 500);
    }
    // iPhone'da tarayıcı tam ekranı yok: bir kez "Ana Ekrana Ekle" ipucu
    if (touchMode && !FM.DEV && iosTab() && !lsGet('fm-ios-tip2')) {
      lsSet('fm-ios-tip2', '1');
      setTimeout(() => { if (st.view === 'menu' && st.screen === 'menu' && !st.modal) openIosFull(); }, 2600);
    }
    // ana ekrandaki uygulama ilk kez açıldı: iPhone Safari'nin kaydını ayrı tutar → ilerlemeyi kodla getirmeyi öner
    if (!FM.DEV && isIOS() && isStandalone() && !lsGet('fm-ios-imp') && freshSave()) {
      lsSet('fm-ios-imp', '1');
      setTimeout(() => { if (st.view === 'menu' && st.screen === 'menu' && !st.modal) openIosImport(); }, 1800);
    }
  });
  FM.on('match:start', d => { st.lastMatch = { rounds: (d && d.rounds) || S.ROUNDS || roundsSel() }; st.bestT = {}; });
  FM.on('race:start', () => enterRace(true));
  FM.on('race:end', d => { releaseAllTouch(); try { trackRound(d); } catch (e) { console.error('[ui tur izi]', e); } });
  FM.on('ui:podium', res => showResults(res && res.ranking ? res : S.lastResult));
  FM.on('match:end', d => {
    // ağ maçı: final ekranını mp:final çizer (takma adlar, ev sahibi düğmeleri)
    if (mpActive()) { st.mpRaced = true; return; }
    showFinal(d);
    // arka planda canlı demo dönsün (diğer dinleyiciler bitince)
    setTimeout(() => { if (st.view === 'final' && S.mode === 'menu' && FM.game && typeof FM.game.startDemo === 'function') { try { FM.game.startDemo(); if (typeof FM.updateCamera === 'function') FM.updateCamera(0, true); } catch (e) { console.error(e); } } }, 60);
  });
  /* ---------- çok oyunculu olaylar ---------- */
  function tryAutoJoin() {
    if (st.autoJoinDone) return;
    st.autoJoinDone = true;
    if (!(FM.DEV && FM.params && FM.params.mp)) setTimeout(autoJoin, 250);
  }
  function autoJoin() {
    if (!NET()) return;
    let code = null;
    try { code = ncall('codeFromUrl'); } catch (e) { code = null; }
    if (!code) {
      if (FM.params && FM.params.oda) note({ title: 'Linkteki oda kodu geçersiz', sub: 'Arkadaşından linki tekrar iste.', icon: svg('info'), cls: 'n-err', ms: 3000 });
      return;
    }
    if (mpInRoom() || mpBusy()) return;
    st.mpCode = code;
    showScreen('friends');
    withNick(() => mpJoin(code));
  }
  FM.on('mp:lobby', d => { st.cd = null; st.rejoining = false; if (d && d.back) st.lbTab = 'set'; try { showLobby(); } catch (e) { console.error('[ui mp:lobby]', e); } });
  FM.on('mp:countdown', d => {
    d = d || {};
    const left = d.left == null ? null : (d.left | 0);
    if (left != null && left >= 1) { st.cd = { left, t: nowMs() }; FM.haptic('count'); }
    else {
      const was = !!(st.cd && st.cd.left != null);
      const why = { unready: 'Biri hazırı geri aldı.', join: 'Odaya yeni biri katıldı.', leave: 'Biri odadan ayrıldı.' }[d.reason];
      st.cd = was && why ? { left: null, msg: why, t: nowMs() } : null;
      if (st.cd) setTimeout(() => updateLobby(), 3300);
    }
    updateLobby();
  });
  FM.on('mp:rejoining', d => openRejoin(d && d.code));
  FM.on('net:lobby', () => updateLobby());
  FM.on('net:players', () => updateLobby());
  FM.on('net:status', s => {
    updateLobby();
    // kurulum/katılma iptal oldu (bağlantı kurulamadı vb.): bekleme penceresi açık kalmasın
    if (st.modal === 'mpwait' && s && !s.phase && s.conn === 'idle') closeModalHard();
  });
  FM.on('net:error', d => {
    d = d || {};
    if (d.rejoin) return;   // otomatik geri dönüş hatası: mp:left {reason:'rejoin-failed'} kendi uyarısını gösterir
    if (st.modal === 'mpwait' || st.modal === 'share' || st.modal === 'chpick') closeModalHard();
    if (st.view === 'menu' && st.screen === 'lobby') showScreen('friends');
    if (d.code === 'badcode' || d.code === 'noroom' || d.code === 'full' || d.code === 'ver' || d.code === 'kicked') ncall('clearUrlCode');
    openErr(d.code, d.msg);
  });
  FM.on('net:kicked', d => {
    if (st.view === 'menu' && st.screen === 'lobby') showScreen('menu');
    ncall('clearUrlCode');
    openErr('kicked', (d && d.msg) || 'Ev sahibi seni odadan çıkardı.');
  });
  FM.on('mp:left', d => {
    st.cd = null; st.rejoining = false;
    if (d && d.reason === 'rejoin-failed') {
      if (st.modal === 'mpwait') closeModalHard();
      if (st.view === 'menu' && st.screen !== 'menu') showScreen('menu'); else if (st.view === 'menu') refreshSoon();
      note({ title: 'Odaya dönülemedi', sub: 'Oda kapanmış ya da bağlantı kurulamadı.', icon: svg('door'), cls: 'n-err', ms: 3600 });
      FM.haptic('hit');
      return;
    }
    if (st.modal === 'mpwait' || st.modal === 'share' || st.modal === 'chpick' || st.modal === 'prof') closeModalHard();
    if (st.view === 'menu' && (st.screen === 'lobby' || st.screen === 'friends')) showScreen(d && d.reason === 'left' ? 'menu' : 'friends');
    else if (st.view === 'results' || st.view === 'final') { if (FM.game && typeof FM.game.toMenu === 'function') FM.game.toMenu(); else showScreen('menu'); }
    if (d && d.reason === 'left') ncall('clearUrlCode');
  });
  FM.on('mp:host', d => {
    if (!d || d.pending) return;
    if (d.me) note({ title: 'Artık ev sahibi sensin!', sub: 'Turları ve ayarları sen yönetiyorsun.', icon: svg('crown', 'gold'), cls: 'n-ok', ms: 3000 });
    else {
      const p = (ncall('players') || []).find(x => x.pid === d.pid);
      note({ title: 'Ev sahibi değişti', sub: p ? 'Yeni ev sahibi: ' + p.nick : 'Oda devam ediyor.', icon: svg('crown', 'gold'), cls: 'n-tip', ms: 2600 });
    }
    if (st.view === 'results') { const f = $('.res-foot', Ls.res); if (f) f.innerHTML = resFoot(true, !!st.resLast); }
    else if (st.view === 'final' && st.finData) showFinal(st.finData);
    updateLobby(true);
  });
  FM.on('mp:emote', d => {
    if (!d || !d.pid || typeof d.e !== 'string') return;
    st.mpEmo[d.pid] = { e: d.e, t: nowMs() };
    if (st.view === 'menu' && st.screen === 'lobby') { updateLobby(); setTimeout(updateLobby, 3300); }
  });
  FM.on('mp:final', f => {
    if (!f || !Array.isArray(f.standings)) return;
    const stn = f.standings.map(x => {
      const r = gcall('racer', x.pid) || {};
      return { id: FM.CH[x.char] ? x.char : 'TAFTAF', pid: x.pid, name: x.nick || x.char, skin: x.skin, total: x.total | 0, bot: !!x.bot, me: !!x.me, kills: typeof r.kills === 'number' ? r.kills : undefined, coins: typeof r.coins === 'number' ? r.coins : undefined, deaths: typeof r.deaths === 'number' ? r.deaths : undefined };
    });
    showFinal({ mp: true, standings: stn, champion: !!f.champion });
  });
  FM.on('ui:pause', d => {
    d = d || {};
    // açık bir duraklatma her zaman kapatılabilsin (Esc/P), yenisi yalnızca geri sayım/yarışta açılsın
    if (st.modal === 'pause') { if (d.toggle) resumeGame(); return; }
    if (!canPause()) return;
    openPause();
  });
  FM.on('ui:hide', () => {
    st.view = 'hidden';
    setNotesPos();
    stopShowcases(); stopTicker(); closeModalHard();
    showLayer('scr', false); Ls.scr.innerHTML = '';
    hideRaceLayer(); clearResults(); clearFinal();
  });
  FM.on('meta:change', () => { if (st.view === 'menu' || st.modal === 'daily') refreshSoon(); });
  FM.on('save:reset', () => refreshSoon());
  FM.on('meta:mission', d => {
    const m = (d && d.mission) || {};
    note({ title: 'GÖREV TAMAMLANDI!', sub: m.title || '', icon: anyIcon(m.icon, 40), rw: m.reward, cls: 'n-ms', ms: 3400 });
  });
  FM.on('meta:levelup', d => {
    const lv = (d && d.level) || levelInfo().level;
    note({ title: 'SEVİYE ATLADIN!', sub: 'Seviye ' + lv + ' oldun', icon: '<span class="n-lvb">' + svg('star', 'gold') + '<b>' + lv + '</b></span>', cls: 'n-lv', ms: 3600 });
    sfx('levelup');
  });
  /* ---------- 5. tur: titreşim (YALNIZCA ARAYÜZ tetikler), yuvaya vardı, arkadaş varlığı, canlı "son görülme" ---------- */
  const localR = r => !!r && r === S.player && S.mode !== 'demo';
  FM.on('box', d => { if (d && localR(d.r) && d.item !== null) FM.haptic('pick'); });
  FM.on('charge:full', d => { if (d && localR(d.r)) FM.haptic('ready'); });
  FM.on('death', d => { if (d && localR(d.r)) FM.haptic('death'); });
  FM.on('hit', d => { if (d && localR(d.victim)) FM.haptic('hit'); });
  FM.on('finish', d => { if (d && localR(d.r)) FM.haptic(d.place === 1 ? 'win' : 'pick'); });
  FM.on('match:end', d => { if (d && d.champion) FM.haptic('win'); });
  FM.on('hud:arrive', d => bumpSlot(d && d.kind === 'ab' ? 'ab' : 'item'));
  FM.on('net:came', d => { try { friendNote('came', d && d.p); } catch (e) { console.error('[ui net:came]', e); } });
  FM.on('net:lobby-open', d => { try { friendNote('lobby', d && d.p); } catch (e) { console.error('[ui net:lobby-open]', e); } });
  /** Canlı veri gelince açık ekranları yenile (parmak basılıyken değil: dokunuş yutulmasın) */
  let ptrDown = 0;
  root.addEventListener('pointerdown', () => { ptrDown = nowMs(); }, true);
  const liveRefresh = (() => {
    let t = 0;
    return () => {
      if (t) return;
      t = setTimeout(() => {
        t = 0;
        if (nowMs() - ptrDown < 350) { liveRefresh(); return; }
        if (st.view === 'menu' && st.screen === 'menu') updateRoomsBadge();   // açık pencere olsa da rozet canlı kalsın
        if (st.view === 'menu' && !st.modal) {
          if (st.screen === 'online' || st.screen === 'clan') paint(false);
          else if (st.screen === 'menu') { updateOnlinePill(); updateRoomsBadge(); }
          else if (st.screen === 'friends') updateRoomsList();
          else if (st.screen === 'lobby') updateLobby();
        } else if (st.view === 'menu' && st.screen === 'lobby') updateLobby();
      }, 250);
    };
  })();
  FM.on('net:online', liveRefresh);
  FM.on('net:profiles', liveRefresh);
  FM.on('meta:card', liveRefresh);
  /** "son görülme: 5 dk önce" yazıları ekran açıkken canlı kalsın (net olaylarından bağımsız, 20 sn'de bir) */
  function refreshAgo() {
    for (const el of $$('[data-ls]', root)) {
      const ms = +el.getAttribute('data-ls');
      el.textContent = 'son görülme: ' + fmtAgo(ms);
    }
  }
  setInterval(() => { if (!document.hidden) refreshAgo(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshAgo(); liveRefresh(); } });
  // bildirime dokunulunca (sw.js notificationclick) açık oyuna oda kodu gelir
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', e => {
        const m = e && e.data;
        if (m && m.type === 'fm-join' && m.code) { try { joinCode(String(m.code)); } catch (err) { console.error(err); } }
      });
    }
  } catch (e) { /* servis çalışanı yok */ }

  FM.on('resize', () => {
    checkRotate();
    if (st.view === 'menu' || st.modal) { clearTimeout(UI._rz); UI._rz = setTimeout(redrawArt, 120); }
    clearTimeout(UI._rzh);
    UI._rzh = setTimeout(() => { if (st.view === 'menu') scrollHints(Ls.scr); else if (st.view === 'results') scrollHints(Ls.res); }, 160);
  });
  window.addEventListener('orientationchange', () => setTimeout(checkRotate, 200));
  document.addEventListener('fullscreenchange', () => { if (st.view === 'menu' && st.screen === 'settings') refreshSoon(); });

  /* =====================================================================
     25) GELİŞTİRİCİ MODU (?dev=1&scene=menu&ui=shop&tab=trails)
         5. tur: ui=online | clan | prof&pid=p1 | ftoast&kind=lobby | rejoinwait | lobby&tab=fr&cd=3 (+ &fakenet=1: sahte varlık verisi, yalnızca ekran görüntüsü için)
     ===================================================================== */
  function devFakeResult() {
    const rs = (S.racers || []).slice(0, 10);
    if (!rs.length) return null;
    const rk = rs.slice().sort((a, b) => b.x - a.x).map((r, i) => Object.assign({}, r, { finished: i < 3, ftime: 41.37 + i * 2.71, place: i + 1, rp: i < 3 ? (FM.PTS || [10, 6, 3, 1])[i] : 0, total: Math.max(0, 16 - i * 3) }));
    const pid = S.player && S.player.id;
    const pl = rk.find(r => r.id === pid) || rk[0];
    pl.bot = false;
    const lr = FM.meta && FM.meta.lastRewards;
    if (FM.meta && (!lr || !(lr.lines && lr.lines.length))) {
      FM.meta.lastRewards = {
        kind: 'race', coins: 214, gems: 1, xp: 85, levelUp: FM.params.lv === '0' ? 0 : 2,
        lines: [
          { t: '1. oldun', v: 120, cur: 'coins', icon: '🥇', s: '+120 altın' },
          { t: 'Toplanan altın ×22', v: 44, cur: 'coins', icon: '🪙', s: '+44 altın' },
          { t: 'Patlatılan rakip ×2', v: 30, cur: 'coins', icon: '💥', s: '+30 altın' },
          { t: 'Bitiş bonusu', v: 20, cur: 'coins', icon: '🏁', s: '+20 altın' },
          { t: 'Deneyim', v: 85, cur: 'xp', icon: '⭐', s: '+85 XP' },
          { t: 'Kupa', v: 30, cur: 'trophy', icon: '🏆', s: '+30 kupa' }
        ],
        missionsDone: [{ title: '3 yarış bitir', icon: '🏁' }, { title: '2 saldırıyı savuştur', icon: '🎈' }]
      };
    }
    return { ranking: rk, player: pl, playerRank: rk.indexOf(pl), round: 2, rounds: 3, theme: S.L && S.L.theme, trophyDelta: [30, 12, -5, -15][rk.indexOf(pl)] || 0, last: FM.params.last === '1' };
  }
  function devFakeFinal() {
    const rs = (S.racers || []).slice(0, 10).map((r, i) => Object.assign({}, r, { total: Math.max(0, 24 - i * 5), kills: [3, 1, 0, 2, 1, 0, 0, 1, 0, 0][i] }));
    const pl = rs[0]; pl.bot = false;
    const champ = FM.params.champ !== '0';
    const st2 = champ ? rs : [rs[1], rs[0]].concat(rs.slice(2));
    return { standings: st2, player: pl, champion: champ };
  }
  function devFakeLobby(host, np) {
    const nicks = ['Emir', 'Caner', 'Lul_Kral', 'ertan', 'Nusret', 'baso', 'Fuat', 'Morel', 'TAFTAF', 'Kral'];
    const pl = [];
    for (let i = 0; i < clamp(np, 1, 10); i++) {
      const me = host ? i === 0 : i === 2;
      pl.push({ pid: 'p' + i, nick: nicks[i], char: FM.ORDER[i % FM.ORDER.length], skin: i === 3 ? 'altin' : 'klasik', ready: i % 3 !== 1, waiting: false, off: i === 5, host: i === 0, me, alive: i !== 5, ping: [62, 88, 140, 250, 95, null, 72, 410, 66, 120][i] });
    }
    return { lob: { code: 'K7MXQ', isHost: host, max: 10, st: 'lobby', cfg: { mode: FM.params.mode || 'elim', map: FM.params.map || 'desert', rounds: 3, bots: true, fill: 4 } }, pl, stt: { conn: 'open', rtt: 84, phase: 'in' } };
  }
  /** Geliştirici: sahte varlık verisi (yalnızca ?dev=1&fakenet=1 ekran görüntüleri için; oyunda HİÇ kullanılmaz) */
  function devFakeNet(long) {
    const now = Date.now(), H = 3600e3, D = 24 * H;
    const online = [
      { pid: 'me0', nick: myNick(), char: selChar(), st: 'menu', me: true },
      { pid: 'p1', nick: 'Kral', char: 'Kral', st: 'lobby', code: 'K7MXQ', n: 3, max: 10, open: true },
      { pid: 'p2', nick: 'Caner', char: 'Caner', st: 'race' },
      { pid: 'p3', nick: 'ertan', char: 'ertan', st: 'menu' },
      { pid: 'p4', nick: 'LUL', char: 'LUL', st: 'solo' },
      { pid: 'p5', nick: 'Nusret', char: 'Nuss', st: 'away' }
    ];
    const pr = (pid, nick, char, tr, play, lvl, races, wins, best, ls, extra) => Object.assign({ pid, nick, char, skin: 'klasik', lvl, tr, play, races, wins, kills: wins * 3, best, since: now - 40 * D, ls, online: false, st: 'menu' }, extra || {});
    const profiles = [
      pr('p1', 'Kral', 'Kral', 1320, 45360, 18, 212, 61, 'Kral', now - 4000, { online: true, st: 'lobby' }),
      pr('p2', 'Caner', 'Caner', 2150, 98100, 24, 480, 167, 'Caner', now - 3000, { online: true, st: 'race' }),
      pr('p3', 'ertan', 'ertan', 410, 7260, 6, 40, 4, 'ertan', now - 2000, { online: true }),
      pr('p4', 'LUL', 'LUL', 0, 540, 1, 3, 0, 'LUL', now - 5000, { online: true, st: 'solo' }),
      pr('p5', 'Nusret', 'Nuss', 880, 21000, 11, 90, 22, 'Nuss', now - 70000, { online: true, st: 'away' }),
      pr('p6', 'baso', 'baso', 3120, 180000, 31, 900, 410, 'baso', now - 2 * H - 600000),
      pr('p7', 'Fuat', 'TAFTAF', 150, 3900, 3, 12, 1, 'TAFTAF', now - 26 * H),
      pr('p8', 'Morel', 'Kral', 95, 1500, 2, 9, 0, 'Kral', now - 5 * D),
      pr('p9', 'Emir', 'Nuss', 0, 300, 1, 2, 0, 'Nuss', now - 40 * 60000)
    ];
    if (long) {   // en kötü durum: 14 harfli takma ad, 5 haneli kupa, uzun süre
      online[1].nick = 'UzunTakmaAdli14'.slice(0, 14); profiles[0].nick = online[1].nick; profiles[0].tr = 12345; profiles[0].play = 3600 * 987 + 1800;
      profiles[1].nick = 'MMMMMMMMMMMMMM'; online[2].nick = profiles[1].nick; profiles[1].tr = 54321;
    }
    return { online, profiles, h2h: { p1: { nick: 'Kral', w: 12, l: 8 } } };
  }
  function devOpen() {
    const P = FM.params || {}, u = P.ui;
    if (!u) {
      if (P.scene === 'menu') showScreen('menu');
      // telefon çekimi (?mobile=1 / ?touch=1): yarış karesinde dokunmatik düğmeler de görünsün (gerçek telefon düzeni)
      else if ((P.scene || 'race') === 'race' && touchMode) { st.devForce = true; enterRace(); }
      return;
    }
    if (P.fakenet === '1' || P.fakenet === '2') st.fakeNet = devFakeNet(P.fakenet === '2');
    if (P.tab && st.tabs[u] !== undefined) st.tabs[u] = P.tab;
    if (P.cv && FM.CH[P.cv]) st.cview = P.cv;
    switch (u) {
      case 'menu': case 'chars': case 'shop': case 'missions': case 'clan': case 'settings': case 'help': case 'online': showScreen(u); break;
      case 'prof': showScreen('clan'); openProfile(P.pid || 'p1'); break;
      case 'ftoast': friendNote(P.kind === 'lobby' ? 'lobby' : 'came', { pid: 'p1', nick: 'Kral', char: 'Kral', st: 'lobby', code: 'K7MXQ', n: 3, max: 10 }); showScreen('menu'); break;
      case 'rejoinwait': showScreen('menu'); openRejoin('K7MXQ'); break;
      case 'daily': showScreen('menu'); openDaily(); break;
      case 'confirm': showScreen('settings'); ACT.reset(); break;
      case 'pause': st.devForce = true; enterRace(); openPause(); break;
      case 'touch': st.devForce = true; setTouch(true); enterRace(); break;
      case 'results': showResults(S.lastResult || devFakeResult()); break;
      case 'final': showFinal(devFakeFinal()); break;
      case 'rotate': setTouch(true); showScreen('menu'); Ls.rot.classList.add('on'); break;
      case 'solo': case 'friends': showScreen(u); break;
      case 'lobby':
        st.fakeLobby = devFakeLobby(P.host !== '0', +P.np || 6);
        if (P.tab === 'fr') st.lbTab = 'fr';
        if (P.cd) st.fakeLobby.cd = +P.cd;
        showScreen('lobby'); break;
      case 'nick': showScreen('friends'); openNick(null); break;
      case 'wait': showScreen('friends'); openWait('ODAYA KATILINIYOR', '<b>K7MXQ</b> odası aranıyor…'); break;
      case 'mperr': showScreen('friends'); openErr(P.code || 'noroom', P.code === 'ver' ? 'Oyunun yeni bir sürümü var. Sayfayı yenile.' : 'Bu kodla açık bir oda yok. Kodu kontrol et ya da arkadaşından yeni link iste.'); break;
      case 'share': st.fakeLobby = devFakeLobby(true, 3); showScreen('lobby'); doShare(); break;
      case 'chpick': st.fakeLobby = devFakeLobby(false, 4); showScreen('lobby'); openCharPick(); break;
      case 'svexp': showScreen('settings'); openExport(); break;
      case 'svimp': showScreen('settings'); openImport(); break;
      case 'mpresults': { const r = devFakeResult(); if (r) { r.mp = true; r.mode = P.mode || 'elim'; } showResults(r); break; }
      case 'mpfinal': { const f = devFakeFinal(); f.mp = true; f.standings.forEach((x, i) => { x.me = i === 1; }); showFinal(f); break; }
      default: showScreen('menu');
    }
    if (P.note === '1') {
      note({ title: 'GÖREV TAMAMLANDI!', sub: '5 rakibi eşyayla vur', icon: anyIcon('dyn', 40), rw: { coins: 150, xp: 40 }, cls: 'n-ms', ms: 60000 });
      note({ title: 'SEVİYE ATLADIN!', sub: 'Seviye 7 oldun', icon: '<span class="n-lvb">' + svg('star', 'gold') + '<b>7</b></span>', cls: 'n-lv', ms: 60000 });
    }
  }
  FM.on('boot', () => {
    if (FM.DEV && FM.params && FM.params.still === '1') root.classList.add('dev-still');
    applyQuality();
    setTouch(touchMode);
    const s = sv().settings || {};
    try { if (FM.audio && typeof FM.audio.setVolume === 'function') { FM.audio.setVolume('music', s.music); FM.audio.setVolume('sfx', s.sfx); } } catch (e) { /* yok say */ }
    if (FM.DEV) setTimeout(devOpen, 0);
    // geliştirici sahnesinde ui:menu gelmeyebilir: ?oda= ile açılışta yine katıl
    setTimeout(() => { if (st.view === 'menu' && FM.params && FM.params.oda) tryAutoJoin(); }, 600);
  });

  /* =====================================================================
     26) DIŞA AÇIK API
     ===================================================================== */
  UI.show = showScreen;
  UI.hide = () => FM.emit('ui:hide');
  UI.note = note;
  UI.refresh = refreshSoon;
  UI.pause = openPause;
  UI.resume = resumeGame;
  UI.results = showResults;
  UI.final = showFinal;
  UI.svg = svg;
  UI.isTouch = () => touchMode;
  UI.state = () => ({ view: st.view, screen: st.screen, modal: st.modal });
})(window.FM);

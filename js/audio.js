/* FUAT MOREL — audio.js
   %100 prosedürel ses motoru (WebAudio). Hiçbir ses dosyası / örnek yok: her efekt ve her müzik notası
   osilatör + gürültü + filtre + zarf ile anında sentezlenir.

   API  (FM.audio)
     unlock()                     → ilk kullanıcı etkileşiminde ses bağlamını açar (kendisi de pointerup/touchend/click/keydown dinler;
                                    dokunmatikte touchstart/pointerdown etkinleştirme sayılmaz, orada beklenir)
     play(name, opts)             → efekt çalar. opts: {vol, pan, rate, when, r (yarışçı → otomatik ses/pan), x,y (dünya konumu), exact}
     music(id | null, opts)       → 'forest'|'candy'|'snow'|'castle'|'menu'|'podium'|0..3|tema nesnesi|null — çapraz geçişli
     setVolume('music'|'sfx', v)  → 0..1, FM.save.settings'e yazar
     click(), hover()             → arayüz sesleri
     duck(amount, dur), mute(on), names(), songs(), ready, current, enabled

   Ses zinciri
     efekt sesi → sfxIn → sfxVol ─┐
     şarkı kanalları → şarkı fade → musicIn → musicLP (duraklatma filtresi) → musicPause → musicImp (patlama kısması) → musicVol ─┤
     yankı (convolver, müzik + efekt gönderimleri, ses düzeyinden SONRA) ───────────────────────────────────────────────────────┤
     eko (müzik, noktalı sekizlik) → musicIn                                                                                    │
                                                                         master → kompresör → limiter → hoparlör ◄──────────────┘

   Arayüz ipucu: #ui içindeki <button>/.btn öğelerine tıklanınca otomatik "tık" sesi çalınır.
     data-sfx="buy" (ya da başka bir ses adı) → o ses çalar; data-sfx="none" → sessiz.
*/
'use strict';
(function (FM) {
  const W = window;
  const AC = W.AudioContext || W.webkitAudioContext || null;
  const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext || null;

  /* =====================================================================
     KÜÇÜK YARDIMCILAR
     ===================================================================== */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const P = v => (v > 0.0001 ? v : 0.0001);                 // üstel rampa hedefi asla 0 olmasın
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  /** 'c#5' → 73, 'bb3' → 58, 'e5' → 76 */
  function n2m(s) {
    const m = /^([a-g])(#|b)?(\d)$/.exec(String(s).trim().toLowerCase());
    if (!m) return null;
    return NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
  }

  let E = null;              // etkin ses motoru (canlı ya da çevrimdışı ölçüm motoru)
  let curV = null;           // şu an sentezlenen efekt sesi (kaynakları kaydedilir → ses çalınırsa hemen durdurulur)
  const own = src => { if (curV) curV.srcs.push(src); };
  let LIVE = null;           // canlı motor
  let unlocked = false;
  let disabled = !AC;
  let errN = 0;
  const errLog = [];
  function fail(e) {
    errN++;
    const msg = (e && (e.stack || e.message)) || String(e);
    if (errLog.length < 30) errLog.push(msg);
    if (FM.DEV && errN <= 4) { try { console.warn('[ses] ' + ((e && e.message) || e)); } catch (_) { } }
  }
  function live() { return !!(LIVE && unlocked && !disabled && LIVE.ac.state === 'running'); }
  const nowMs = () => (W.performance && W.performance.now) ? W.performance.now() : Date.now();
  let resumeT = -1e9;        // bir dokunuşta resume() istendiği an (bağlam birkaç ms sonra 'running' olur)
  /** Aynı dokunuşun arayüz tık sesi kaybolmasın: resume() az önce bir etkileşimde istendiyse sesi askıdaki
      bağlama çizelgele; bağlam açılınca çalar. Yalnızca play() kullanır (müzik/olaylar beklemez). */
  function starting() { return !!(LIVE && unlocked && !disabled && LIVE.ac.state === 'suspended' && nowMs() - resumeT < 400); }

  /* =====================================================================
     MOTOR KURULUMU
     ===================================================================== */
  function compSet(c, th, knee, ratio, att, rel) {
    try { c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = att; c.release.value = rel; } catch (e) { }
  }
  function noiseBuf(ac, kind, secs) {
    const n = Math.max(1, Math.floor(ac.sampleRate * secs));
    const b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.9;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    }
    if (kind === 'brown') { // döngü dikişinde tık olmasın: kaymayı düzle
      const drift = d[n - 1] - d[0];
      for (let i = 0; i < n; i++) d[i] -= drift * i / (n - 1 || 1);
    }
    return b;
  }
  /** Yapay oda yankısı: ön gecikme + erken yansımalar + zamanla koyulaşan, üstel sönen gürültü kuyruğu */
  function makeIR(ac, secs, decay) {
    const sr = ac.sampleRate, n = Math.max(2, Math.floor(sr * secs)), b = ac.createBuffer(2, n, sr);
    const pre = Math.floor(sr * 0.012);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const x = (i - pre) / (n - pre);
        const a = 0.72 - 0.6 * x;                 // kuyruk zamanla kararır (tiz söner)
        lp += ((Math.random() * 2 - 1) - lp) * a;
        d[i] = lp * Math.pow(1 - x, decay);
      }
      for (let k = 0; k < 7; k++) {
        const at = pre + Math.floor(sr * (0.004 + Math.random() * 0.05));
        if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.55 - k * 0.06);
      }
    }
    return b;
  }
  function makeWaves(ac) {
    const out = {};
    const mk = (n, fn) => {
      const re = new Float32Array(n), im = new Float32Array(n);
      for (let i = 1; i < n; i++) { const v = fn(i); re[i] = v[0]; im[i] = v[1]; }
      return ac.createPeriodicWave(re, im);
    };
    try {
      out.p25 = mk(32, i => [2 * Math.sin(Math.PI * i * 0.25) / (Math.PI * i), 0]);     // %25 darbe (chiptune)
      out.p12 = mk(40, i => [2 * Math.sin(Math.PI * i * 0.125) / (Math.PI * i), 0]);    // %12.5 darbe (ince, nazal)
      out.ss = mk(28, i => [0, (i % 2 ? 1 : -1) / i / (1 + Math.pow(i / 10, 2))]);      // yumuşak testere (pad)
      out.sq = mk(24, i => [0, i % 2 ? 1 / i / (1 + Math.pow(i / 9, 2)) : 0]);          // yumuşak kare
      out.org = mk(10, i => [0, ({ 1: 1, 2: 0.55, 3: 0.3, 4: 0.18, 6: 0.08, 8: 0.05 })[i] || 0]); // org
    } catch (e) { fail(e); }
    return out;
  }
  function makeCurve(k) {
    const n = 1024, c = new Float32Array(n), tk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
    return c;
  }

  function build(ac, offline, raw) {
    const e = { ac, offline: !!offline, voices: [], songs: [], last: {}, cur: null, mv: 0, sv: 0, paused: false, volT: -1, rawM: -1, rawS: -1 };
    const G = (v, dst) => { const g = ac.createGain(); g.gain.value = v; if (dst) g.connect(dst); return g; };
    const BQ = (type, f, q, dst) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (dst) b.connect(dst); return b; };
    e.G = G; e.BQ = BQ;
    // master → kompresör (yapıştırıcı) → limiter (koruma) → çıkış
    if (raw) e.master = G(0.92, ac.destination);
    else {
      e.lim = ac.createDynamicsCompressor(); compSet(e.lim, -2.5, 0, 20, 0.002, 0.12); e.lim.connect(ac.destination);
      e.comp = ac.createDynamicsCompressor(); compSet(e.comp, -17, 12, 3.2, 0.006, 0.25); e.comp.connect(e.lim);
      e.master = G(0.92, e.comp);
    }
    // müzik yolu
    e.musicVol = G(0, e.master);
    e.musicImp = G(1, e.musicVol);          // patlama / fanfar anında kısa kısma
    e.musicPause = G(1, e.musicImp);        // duraklatmada kısma
    e.musicLP = BQ('lowpass', 20000, 0.5, e.musicPause);
    e.musicIn = G(1, e.musicLP);
    // efekt yolu
    e.sfxVol = G(0, e.master);
    e.sfxIn = G(1, e.sfxVol);
    // yankı: gönderimler ses düzeyinden sonra convolver'a girer (müzik kısılınca yankısı da kısılır)
    e.verb = ac.createConvolver();
    try { e.verb.buffer = makeIR(ac, 1.7, 2.6); } catch (er) { fail(er); }
    e.verbOut = G(0.85, e.master);
    e.verb.connect(e.verbOut);
    e.musicVerbVol = G(0, e.verb);
    e.musicVerbPause = G(1, e.musicVerbVol);
    e.musicVerbIn = G(1, e.musicVerbPause);
    e.sfxVerbVol = G(0, e.verb);
    e.sfxVerbIn = G(1, e.sfxVerbVol);
    // müzik ekosu (noktalı sekizlik, geri beslemeli, koyulaşan)
    e.dly = ac.createDelay(2); e.dly.delayTime.value = 0.32;
    e.dlyLP = BQ('lowpass', 2300, 0.5);
    e.dlyHP = BQ('highpass', 280, 0.5);
    e.dlyFb = G(0.3);
    e.dlyIn = G(1, e.dly);
    e.dly.connect(e.dlyLP); e.dlyLP.connect(e.dlyHP); e.dlyHP.connect(e.dlyFb); e.dlyFb.connect(e.dly);
    e.dlyOut = G(0.5, e.musicIn); e.dlyHP.connect(e.dlyOut);
    // kaynaklar
    e.noise = { white: noiseBuf(ac, 'white', 2), pink: noiseBuf(ac, 'pink', 2), brown: noiseBuf(ac, 'brown', 2) };
    e.waves = makeWaves(ac);
    e.curve = makeCurve(3.2);
    e.hasPan = typeof ac.createStereoPanner === 'function';
    return e;
  }

  /* ---------- ses düzeyleri ---------- */
  const MUSIC_BASE = 0.5, SFX_BASE = 1.0;
  const volCurve = v => { v = clamp(num(v, 0), 0, 1); return v <= 0.001 ? 0 : Math.pow(v, 1.6); };
  function settingsVal(k, d) {
    const st = FM.save && FM.save.settings;
    return st ? clamp(num(+st[k], d), 0, 1) : d;
  }
  function glide(e, p, v, tc) {
    if (e.offline) { p.value = v; return; }
    const t = e.ac.currentTime;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.setTargetAtTime(v, t, Math.max(0.005, tc));
  }
  function applyVol(e, instant, mOverride, sOverride) {
    const rm = mOverride != null ? mOverride : settingsVal('music', 0.6);
    const rs = sOverride != null ? sOverride : settingsVal('sfx', 0.8);
    e.rawM = rm; e.rawS = rs;
    e.mv = volCurve(rm) * MUSIC_BASE; e.sv = volCurve(rs) * SFX_BASE;
    const tc = instant ? 0.005 : 0.06;
    glide(e, e.musicVol.gain, e.mv, tc); glide(e, e.musicVerbVol.gain, e.mv, tc);
    glide(e, e.sfxVol.gain, e.sv, tc); glide(e, e.sfxVerbVol.gain, e.sv, tc);
  }
  function syncVol() {
    if (!LIVE) return;
    const rm = settingsVal('music', 0.6), rs = settingsVal('sfx', 0.8);
    if (Math.abs(rm - LIVE.rawM) > 0.0005 || Math.abs(rs - LIVE.rawS) > 0.0005) applyVol(LIVE, false);
  }

  /* =====================================================================
     SENTEZ YAPI TAŞLARI
     ===================================================================== */
  function setWave(osc, w) {
    if (w && E.waves[w]) osc.setPeriodicWave(E.waves[w]);
    else osc.type = (w === 'square' || w === 'sawtooth' || w === 'triangle') ? w : 'sine';
  }
  /** Genlik zarfı. a: atak, g: tepe, d: toplam süre (sonunda sessiz), sus: sürdürme oranı (verilirse ADSR), rel: bırakma, hold: tepe tutma */
  function env(p, t, a, g, d, sus, rel, hold) {
    a = Math.max(0.0015, num(a, 0.005)); g = Math.max(0, num(g, 0.3)); d = Math.max(a + 0.01, num(d, 0.2));
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(g, t + a);
    let tt = t + a;
    if (hold > 0) { tt += hold; p.setValueAtTime(g, tt); }
    if (sus != null) {
      rel = Math.max(0.01, num(rel, 0.06));
      const dec = Math.min(0.12, Math.max(0.005, (t + d - rel - tt) * 0.5));
      const sv = P(g * sus);
      p.exponentialRampToValueAtTime(sv, tt + dec);
      const rs = Math.max(tt + dec, t + d - rel);
      p.setValueAtTime(sv, rs);
      p.exponentialRampToValueAtTime(0.0001, rs + rel);
    } else {
      p.exponentialRampToValueAtTime(0.0001, Math.max(tt + 0.005, t + d));
    }
  }
  function fq(v, d) { return clamp(num(v, d), 10, 22000); }
  /** Filtre zinciri: hp / bp / lp (her biri isteğe bağlı süpürmeli: hp2, bp2, lp2; süpürme süresi ft) */
  function filt(src, o, t, d) {
    const ac = E.ac; let h = src;
    const sweep = (f, from, to) => {
      f.frequency.setValueAtTime(fq(from, 1000), t);
      if (to != null) f.frequency.exponentialRampToValueAtTime(fq(to, 1000), t + Math.max(0.01, num(o.ft, d)));
    };
    if (o.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.Q.value = num(o.hq, 0.7); sweep(f, o.hp, o.hp2); h.connect(f); h = f; }
    if (o.bp) { const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = num(o.bq, 1); sweep(f, o.bp, o.bp2); h.connect(f); h = f; }
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = num(o.lq, 0.7); sweep(f, o.lp, o.lp2); h.connect(f); h = f; }
    return h;
  }
  /** Ton: osilatör (+ perde rampası, vibrato, filtre, zarf).
      o = {w, f, f2, pt, lin, t, a, d, g, sus, rel, hold, det, hp/bp/lp(+2), vib, vd, vdl} */
  function T(dst, o) {
    const ac = E.ac, t = num(o.t, ac.currentTime), d = Math.max(0.02, num(o.d, 0.2));
    const osc = ac.createOscillator();
    setWave(osc, o.w);
    const f = fq(o.f, 440);
    osc.frequency.setValueAtTime(f, t);
    if (o.f2 != null) {
      const f2 = fq(o.f2, f), pt = t + Math.max(0.005, num(o.pt, d));
      if (o.lin) osc.frequency.linearRampToValueAtTime(f2, pt); else osc.frequency.exponentialRampToValueAtTime(f2, pt);
    }
    if (o.det) osc.detune.setValueAtTime(num(o.det, 0), t);
    const head = filt(osc, o, t, d);
    const g = ac.createGain();
    env(g.gain, t, o.a, o.g, d, o.sus, o.rel, o.hold);
    head.connect(g); g.connect(dst);
    if (o.vib > 0) {
      const l = ac.createOscillator(); l.frequency.value = o.vib;
      const lg = ac.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(num(o.vd, f * 0.01), t + Math.max(0.01, num(o.vdl, 0.05)));
      l.connect(lg); lg.connect(osc.frequency);
      l.start(t); l.stop(t + d + 0.05); own(l);
    }
    osc.start(t); osc.stop(t + d + 0.05); own(osc);
    return osc;
  }
  /** Gürültü: o = {k:'white'|'pink'|'brown', t, d, g, a, sus, rel, hold, rate, hp/bp/lp(+2)} */
  function N(dst, o) {
    const ac = E.ac, t = num(o.t, ac.currentTime), d = Math.max(0.01, num(o.d, 0.2));
    const s = ac.createBufferSource(); s.buffer = E.noise[o.k] || E.noise.white; s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    const head = filt(s, o, t, d);
    const g = ac.createGain();
    env(g.gain, t, o.a, o.g, d, o.sus, o.rel, o.hold);
    head.connect(g); g.connect(dst);
    s.start(t, Math.random() * 1.4); s.stop(t + d + 0.05); own(s);
    return g;
  }
  /** FM çifti (çan, cam, metal). o = {t, f, f2, pt, ratio, idx, idxEnd, idxD, d, g, a, sus, rel, w} */
  function FMt(dst, o) {
    const ac = E.ac, t = num(o.t, ac.currentTime), d = Math.max(0.03, num(o.d, 0.5));
    const f = fq(o.f, 440);
    const car = ac.createOscillator(); car.type = o.w === 'triangle' ? 'triangle' : 'sine';
    car.frequency.setValueAtTime(f, t);
    if (o.f2 != null) car.frequency.exponentialRampToValueAtTime(fq(o.f2, f), t + Math.max(0.005, num(o.pt, d)));
    const mod = ac.createOscillator(); mod.type = 'sine';
    mod.frequency.setValueAtTime(fq(f * num(o.ratio, 2), 880), t);
    const mg = ac.createGain();
    const dep = Math.max(0.001, f * num(o.idx, 2));
    mg.gain.setValueAtTime(dep, t);
    mg.gain.exponentialRampToValueAtTime(P(dep * num(o.idxEnd, 0.02)), t + Math.max(0.01, num(o.idxD, d * 0.5)));
    mod.connect(mg); mg.connect(car.frequency);
    const g = ac.createGain();
    env(g.gain, t, num(o.a, 0.002), o.g, d, o.sus, o.rel);
    car.connect(g); g.connect(dst);
    car.start(t); mod.start(t); car.stop(t + d + 0.05); mod.stop(t + d + 0.05); own(car); own(mod);
  }
  /** Çıtırtı: tek gürültü kaynağı + çok sayıda kısa genlik iğnesi (ucuz) */
  function crackle(dst, t, span, n, g, f) {
    const ac = E.ac;
    const s = ac.createBufferSource(); s.buffer = E.noise.white; s.loop = true;
    const head = filt(s, f || { hp: 2000 }, t, span);
    const gn = ac.createGain(); gn.gain.setValueAtTime(0, t);
    const times = [];
    for (let i = 0; i < n; i++) times.push(t + Math.random() * span);
    times.sort((a, b) => a - b);
    let last = t;
    for (const ti of times) {
      const st = Math.max(ti, last + 0.002), dd = 0.004 + Math.random() * 0.012, amp = g * (0.35 + Math.random() * 0.65);
      gn.gain.setValueAtTime(0, st); gn.gain.linearRampToValueAtTime(amp, st + 0.001); gn.gain.linearRampToValueAtTime(0, st + dd);
      last = st + dd;
    }
    head.connect(gn); gn.connect(dst);
    s.start(t, Math.random()); s.stop(last + 0.05); own(s);
  }
  /** Yumuşak doyum (patlama gövdesi, yer sarsıntısı) */
  function shaper(dst) {
    const ws = E.ac.createWaveShaper(); ws.curve = E.curve; ws.connect(dst); return ws;
  }

  /* =====================================================================
     ENSTRÜMANLAR (müzik + jingle'lar ortak kullanır): fn(dst, t, frekans, süre, şiddet)
     ===================================================================== */
  const INS = {
    // —— melodi
    pulse(dst, t, f, d, v) { // chiptune %25 darbe, yumuşatılmış, uzun notada gecikmeli vibrato
      T(dst, { w: 'p25', f, t, a: 0.006, d: d + 0.07, g: v, sus: 0.72, rel: 0.07, lp: Math.min(5200, f * 5), lq: 0.6, vib: d > 0.28 ? 5.5 : 0, vd: f * 0.007, vdl: 0.22 });
    },
    p12(dst, t, f, d, v) {
      T(dst, { w: 'p12', f, t, a: 0.005, d: d + 0.06, g: v, sus: 0.7, rel: 0.06, lp: Math.min(5000, f * 5.5), vib: d > 0.28 ? 5 : 0, vd: f * 0.006, vdl: 0.22 });
    },
    square(dst, t, f, d, v) { // kalın kare (iki hafif kaymış ses)
      T(dst, { w: 'sq', f, t, a: 0.006, d: d + 0.07, g: v * 0.75, sus: 0.75, rel: 0.07, lp: Math.min(4200, f * 4), det: -6, vib: d > 0.3 ? 5.5 : 0, vd: f * 0.006, vdl: 0.22 });
      T(dst, { w: 'sq', f, t, a: 0.006, d: d + 0.07, g: v * 0.45, sus: 0.75, rel: 0.07, lp: Math.min(4200, f * 4), det: 7 });
    },
    brass(dst, t, f, d, v) { // parlak bakır: açılan filtre
      T(dst, { w: 'sawtooth', f, t, a: 0.025, d: d + 0.08, g: v * 0.55, sus: 0.8, rel: 0.08, lp: f * 1.3, lp2: Math.min(5000, f * 4.5), ft: 0.09, det: -8, vib: d > 0.3 ? 5 : 0, vd: f * 0.006, vdl: 0.25 });
      T(dst, { w: 'sawtooth', f, t, a: 0.03, d: d + 0.08, g: v * 0.4, sus: 0.8, rel: 0.08, lp: f * 1.3, lp2: Math.min(5000, f * 4), ft: 0.1, det: 9 });
    },
    bell(dst, t, f, d, v) { // oyuncak piyano / çan (FM)
      FMt(dst, { t, f, ratio: 4, idx: 1.5, idxD: 0.16, d: Math.min(1.5, d + 0.7), g: v });
      T(dst, { w: 'sine', f: f * 2, t, a: 0.002, d: 0.22, g: v * 0.16 });
    },
    celesta(dst, t, f, d, v) {
      T(dst, { w: 'sine', f, t, a: 0.003, d: Math.min(1.7, d + 0.9), g: v });
      T(dst, { w: 'sine', f: f * 4, t, a: 0.002, d: 0.1, g: v * 0.1 });
      T(dst, { w: 'triangle', f: f * 2, t, a: 0.003, d: 0.4, g: v * 0.12 });
    },
    mbox(dst, t, f, d, v) { // müzik kutusu
      T(dst, { w: 'sine', f, t, a: 0.002, d: 1.1, g: v });
      T(dst, { w: 'sine', f: f * 3, t, a: 0.002, d: 0.16, g: v * 0.1 });
    },
    mallet(dst, t, f, d, v) { // yumuşak marimba (menü)
      T(dst, { w: 'sine', f, t, a: 0.003, d: Math.min(0.9, d + 0.35), g: v });
      T(dst, { w: 'sine', f: f * 3.99, t, a: 0.001, d: 0.06, g: v * 0.18 });
      T(dst, { w: 'triangle', f, t, a: 0.003, d: 0.22, g: v * 0.3 });
    },
    pluck(dst, t, f, d, v) {
      T(dst, { w: 'sine', f, t, a: 0.002, d: 0.42, g: v });
      T(dst, { w: 'sine', f: f * 3.98, t, a: 0.001, d: 0.07, g: v * 0.22 });
      T(dst, { w: 'triangle', f, t, a: 0.002, d: 0.2, g: v * 0.35 });
    },
    // —— eşlik
    stab(dst, t, f, d, v) { T(dst, { w: 'p25', f, t, a: 0.004, d: Math.min(0.16, d + 0.04), g: v, lp: 2300 }); },
    bubble(dst, t, f, d, v) { T(dst, { w: 'sq', f: f * 0.96, f2: f, pt: 0.02, t, a: 0.003, d: 0.11, g: v, lp: 3200 }); },
    harpsi(dst, t, f, d, v) { T(dst, { w: 'p12', f, t, a: 0.002, d: 0.28, g: v, lp: 4200, hp: 220 }); },
    ep(dst, t, f, d, v) { // elektrik piyano (tine FM)
      FMt(dst, { t, f, ratio: 1, idx: 1.0, idxD: 0.35, idxEnd: 0.08, d: Math.min(2.2, d + 0.5), g: v });
      T(dst, { w: 'sine', f: f * 2, t, a: 0.002, d: 0.25, g: v * 0.1 });
    },
    pad(dst, t, f, d, v) {
      T(dst, { w: 'ss', f, t, a: 0.22, d: d + 0.4, g: v, sus: 0.9, rel: 0.4, lp: 1500, det: -8 });
      T(dst, { w: 'ss', f, t, a: 0.22, d: d + 0.4, g: v, sus: 0.9, rel: 0.4, lp: 1500, det: 8 });
    },
    organ(dst, t, f, d, v) { T(dst, { w: 'org', f, t, a: 0.03, d: d + 0.15, g: v, sus: 0.9, rel: 0.15, lp: 2600 }); },
    // —— arp / süs (hafif: tek osilatör)
    pluckS(dst, t, f, d, v) { T(dst, { w: 'triangle', f, t, a: 0.002, d: 0.2, g: v }); },
    bubbleS(dst, t, f, d, v) { T(dst, { w: 'sq', f, t, a: 0.002, d: 0.09, g: v * 0.8, lp: 2800 }); },
    bellS(dst, t, f, d, v) { T(dst, { w: 'sine', f, t, a: 0.002, d: 0.32, g: v }); T(dst, { w: 'sine', f: f * 3, t, a: 0.001, d: 0.05, g: v * 0.12 }); },
    // —— bas (telefon hoparlöründe duyulsun diye üst harmonikli)
    chipbass(dst, t, f, d, v) {
      T(dst, { w: 'triangle', f, t, a: 0.004, d: d + 0.04, g: v, sus: 0.85, rel: 0.04 });
      T(dst, { w: 'p25', f, t, a: 0.004, d: d + 0.04, g: v * 0.22, sus: 0.7, rel: 0.04, lp: 950 });
    },
    sawbass(dst, t, f, d, v) {
      T(dst, { w: 'sawtooth', f, t, a: 0.004, d: d + 0.04, g: v * 0.55, sus: 0.7, rel: 0.05, lp: 1400, lp2: 420, ft: 0.12, lq: 2.5 });
      T(dst, { w: 'sine', f, t, a: 0.004, d: d + 0.04, g: v * 0.6, sus: 0.9, rel: 0.05 });
    },
    roundbass(dst, t, f, d, v) {
      T(dst, { w: 'sine', f, t, a: 0.006, d: d + 0.06, g: v, sus: 0.8, rel: 0.06 });
      T(dst, { w: 'triangle', f: f * 2, t, a: 0.006, d: Math.min(d, 0.2) + 0.04, g: v * 0.16 });
    }
  };

  /* ---------- davullar ---------- */
  const KIT0 = { kf: 150, kf2: 46, kd: 0.3 };
  const DRUM = {
    k(dst, t, v, kit) {
      kit = kit || KIT0;
      const kf = kit.kf || 150;
      T(dst, { w: 'sine', f: kf, f2: kit.kf2 || 46, pt: 0.09, t, a: 0.002, hold: 0.012, d: kit.kd || 0.3, g: v });
      T(dst, { w: 'triangle', f: kf * 1.6, f2: 90, pt: 0.03, t, a: 0.001, d: 0.04, g: v * 0.22 });
      N(dst, { t, a: 0.001, d: 0.012, g: v * 0.1, hp: 2200 });
    },
    s(dst, t, v, kit) {
      kit = kit || KIT0;
      N(dst, { t, a: 0.001, d: 0.17, g: v * 0.95, bp: kit.sf || 1850, bq: 0.9 });
      N(dst, { t, a: 0.001, d: 0.08, g: v * 0.16, hp: 5200 });
      const st = kit.st || 200;
      T(dst, { w: 'triangle', f: st, f2: st * 0.8, pt: 0.06, t, a: 0.001, d: 0.1, g: v * 0.5 });
    },
    c(dst, t, v) { // el çırpma: üç hızlı patlama + kuyruk
      const ac = E.ac;
      const s = ac.createBufferSource(); s.buffer = E.noise.white; s.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1250; bp.Q.value = 1.3;
      const g = ac.createGain(); const p = g.gain;
      p.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) { const ti = t + i * 0.011; p.linearRampToValueAtTime(v * 0.8, ti + 0.001); p.linearRampToValueAtTime(v * 0.15, ti + 0.009); }
      p.linearRampToValueAtTime(v * 0.55, t + 0.035);
      p.exponentialRampToValueAtTime(0.0001, t + 0.2);
      s.connect(bp); bp.connect(g); g.connect(dst);
      s.start(t, Math.random()); s.stop(t + 0.25); own(s);
    },
    h(dst, t, v) { N(dst, { t, a: 0.001, d: 0.045, g: v * 0.5, hp: 7600 }); },
    o(dst, t, v) { N(dst, { t, a: 0.002, d: 0.26, g: v * 0.32, hp: 6800 }); },
    j(dst, t, v, kit) {
      if (kit && kit.jingle) { // kızak zilleri
        N(dst, { t, a: 0.003, d: 0.11, g: v * 0.45, bp: 7600, bq: 3 });
        N(dst, { t: t + 0.008, a: 0.002, d: 0.07, g: v * 0.2, bp: 10200, bq: 4 });
      } else N(dst, { t, a: 0.012, d: 0.06, g: v * 0.3, bp: 6200, bq: 1.2 }); // shaker
    },
    r(dst, t, v) {
      T(dst, { w: 'triangle', f: 1750, t, a: 0.001, d: 0.028, g: v * 0.18 });
      N(dst, { t, a: 0.001, d: 0.02, g: v * 0.12, bp: 3000, bq: 2 });
    },
    t(dst, t, v, kit, chr) {
      const f = chr === 'h' ? 215 : chr === 'm' ? 165 : 122;
      T(dst, { w: 'sine', f, f2: f * 0.62, pt: 0.2, t, a: 0.002, d: 0.3, g: v * 0.7 });
      N(dst, { t, a: 0.001, d: 0.04, g: v * 0.07, lp: 1300 });
    },
    crash(dst, t, v) {
      N(dst, { t, a: 0.002, d: 1.5, g: v * 0.12, hp: 4600, lp: 11500 });
      N(dst, { t, a: 0.002, d: 0.3, g: v * 0.06, bp: 3000, bq: 0.6 });
    },
    riser(dst, t, dur, v) { N(dst, { t, a: dur * 0.92, d: dur, g: v * 0.1, bp: 450, bp2: 6000, bq: 2.2, ft: dur }); }
  };

  /** Küçük nota dizisi: notes = [[midi, vuruş, uzunluk(vuruş), şiddet?], ...] */
  function jingle(dst, t, notes, inst, bpm, vel) {
    const b = 60 / bpm, fn = INS[inst] || INS.pulse;
    for (const n of notes) fn(dst, t + n[1] * b, mtof(n[0]), n[2] * b, vel * (n[3] || 1));
  }

  /* =====================================================================
     EFEKT KATALOĞU
     def(ad, öncelik, aynıAnda, minAralık, süre, yankı, fn(v, t, k, o))
       öncelik: 1 hareket, 2 olay, 3 önemli (arayüz, büyük olaylar)
       k: perde çarpanı (hafif rastgele), o: play() seçenekleri
     ===================================================================== */
  const SFX = {};
  function def(name, pri, poly, gap, dur, verb, fn) { SFX[name] = { pri, poly, gap, dur, verb, fn }; }

  /* ---------- hareket ---------- */
  def('jump', 1, 3, 0.04, 0.25, 0.04, (v, t, k) => {
    T(v.out, { w: 'triangle', f: 250 * k, f2: 640 * k, pt: 0.09, t, a: 0.004, d: 0.17, g: 0.4 });
    T(v.out, { w: 'square', f: 500 * k, f2: 1280 * k, pt: 0.09, t, a: 0.004, d: 0.1, g: 0.035, lp: 2400 });
    N(v.out, { t, a: 0.01, d: 0.08, g: 0.05, hp: 2600 });
  });
  def('jump2', 1, 3, 0.04, 0.45, 0.14, (v, t, k) => {
    T(v.out, { w: 'triangle', f: 400 * k, f2: 1000 * k, pt: 0.1, t, a: 0.004, d: 0.2, g: 0.34 });
    T(v.out, { w: 'sine', f: 800 * k, f2: 1600 * k, pt: 0.1, t, a: 0.004, d: 0.13, g: 0.07 });
    [1319, 1760, 2093].forEach((f, i) => T(v.out, { w: 'sine', f: f * k, t: t + 0.05 + i * 0.035, a: 0.002, d: 0.18, g: 0.055 }));
    N(v.out, { t, a: 0.02, d: 0.14, g: 0.05, hp: 3200 });
  });
  def('land', 1, 2, 0.06, 0.15, 0, (v, t, k) => {
    T(v.out, { w: 'sine', f: 150 * k, f2: 70 * k, pt: 0.06, t, a: 0.002, d: 0.1, g: 0.3 });
    N(v.out, { k: 'pink', t, a: 0.002, d: 0.06, g: 0.1, lp: 700 });
  });
  def('landHard', 1, 2, 0.06, 0.3, 0.04, (v, t, k) => {
    T(v.out, { w: 'sine', f: 125 * k, f2: 48 * k, pt: 0.1, t, a: 0.002, d: 0.2, g: 0.5 });
    N(v.out, { k: 'brown', t, a: 0.002, d: 0.16, g: 0.35, lp: 900, lp2: 300 });
    N(v.out, { t, a: 0.002, d: 0.05, g: 0.05, bp: 1500, bq: 1 });
  });
  def('slide', 1, 2, 0.08, 0.45, 0.03, (v, t, k) => {
    N(v.out, { k: 'pink', t, a: 0.02, d: 0.36, g: 0.32, bp: 2200 * k, bp2: 800 * k, bq: 1.3 });
    N(v.out, { t, a: 0.03, d: 0.25, g: 0.05, bp: 3200, bq: 0.9 });
  });
  def('slam', 1, 2, 0.1, 0.35, 0.05, (v, t, k) => {
    N(v.out, { k: 'pink', t, a: 0.03, d: 0.25, g: 0.34, bp: 2600, bp2: 500, bq: 1.6 });
    T(v.out, { w: 'triangle', f: 700 * k, f2: 220 * k, pt: 0.2, t, a: 0.01, d: 0.2, g: 0.09 });
  });
  def('slamLand', 2, 2, 0.08, 0.5, 0.1, (v, t, k) => {
    T(shaper(v.out), { w: 'sine', f: 130 * k, f2: 38 * k, pt: 0.18, t, a: 0.002, d: 0.38, g: 0.6 });
    T(v.out, { w: 'triangle', f: 260 * k, f2: 90 * k, pt: 0.08, t, a: 0.002, d: 0.12, g: 0.18 });
    N(v.out, { k: 'brown', t, a: 0.002, d: 0.3, g: 0.6, lp: 700, lp2: 200 });
    N(v.out, { t, a: 0.001, d: 0.06, g: 0.1, bp: 1800, bq: 0.8 });
  });
  def('climb', 1, 3, 0.06, 0.08, 0, (v, t, k, o) => {
    const f = (o.alt ? 960 : 780) * k;
    T(v.out, { w: 'triangle', f, f2: f * 0.7, pt: 0.03, t, a: 0.001, d: 0.045, g: 0.15 });
    N(v.out, { t, a: 0.001, d: 0.022, g: 0.05, hp: 2600 });
  });
  def('vault', 1, 2, 0.1, 0.15, 0, (v, t, k) => {
    T(v.out, { w: 'triangle', f: 320 * k, f2: 760 * k, pt: 0.07, t, a: 0.003, d: 0.11, g: 0.2 });
  });
  def('flap', 1, 2, 0.1, 0.25, 0.05, (v, t, k) => {
    N(v.out, { k: 'pink', t, a: 0.015, d: 0.12, g: 0.32, bp: 900 * k, bp2: 500 * k, bq: 0.8 });
    N(v.out, { k: 'pink', t: t + 0.09, a: 0.015, d: 0.1, g: 0.16, bp: 1100 * k, bp2: 600 * k, bq: 0.8 });
  });
  def('pad', 2, 2, 0.15, 0.6, 0.2, (v, t, k) => {
    T(v.out, { w: 'sawtooth', f: 180 * k, f2: 1100 * k, pt: 0.32, t, a: 0.02, d: 0.42, g: 0.11, lp: 500, lp2: 4000 });
    T(v.out, { w: 'sq', f: 360 * k, f2: 2000 * k, pt: 0.32, t, a: 0.02, d: 0.36, g: 0.035, lp: 3000 });
    N(v.out, { t, a: 0.1, d: 0.4, g: 0.1, bp: 600, bp2: 5000, bq: 1.5 });
    T(v.out, { w: 'sine', f: 1568, t: t + 0.3, a: 0.002, d: 0.22, g: 0.04 });
  });
  def('mush', 2, 2, 0.08, 0.55, 0.08, (v, t, k) => {
    T(v.out, { w: 'sine', f: 190 * k, f2: 560 * k, pt: 0.14, t, a: 0.004, d: 0.45, g: 0.42, vib: 16, vd: 40, vdl: 0.12 });
    T(v.out, { w: 'triangle', f: 380 * k, f2: 1120 * k, pt: 0.14, t, a: 0.004, d: 0.25, g: 0.07, vib: 16, vd: 80, vdl: 0.12 });
  });
  def('box', 2, 2, 0.08, 0.75, 0.2, (v, t, k, o) => {
    N(v.out, { t, a: 0.001, d: 0.05, g: 0.3, bp: 1400, bq: 1.2 });             // kapak "pop"
    T(v.out, { w: 'triangle', f: 420, f2: 880, pt: 0.05, t, a: 0.002, d: 0.09, g: 0.22 });
    if (o.got) {                                                                  // eşya geldi: yükselen parıltı
      [0, 4, 7, 12].forEach((s, i) => T(v.out, { w: 'sine', f: mtof(76 + s), t: t + 0.06 + i * 0.045, a: 0.002, d: 0.3, g: 0.12 }));
      T(v.out, { w: 'triangle', f: mtof(88), t: t + 0.24, a: 0.002, d: 0.35, g: 0.035 });
      N(v.out, { t: t + 0.05, a: 0.05, d: 0.35, g: 0.03, bp: 7000, bq: 2 });
    } else T(v.out, { w: 'sine', f: mtof(81), t: t + 0.05, a: 0.002, d: 0.2, g: 0.07 });
  });
  const COIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
  def('coin', 2, 4, 0.02, 0.45, 0.1, (v, t, k, o) => {
    const f = mtof(74 + COIN_STEPS[clamp(o.combo | 0, 0, COIN_STEPS.length - 1)]);
    T(v.out, { w: 'sine', f, t, a: 0.002, d: 0.09, g: 0.2 });
    T(v.out, { w: 'triangle', f, t, a: 0.002, d: 0.05, g: 0.06 });
    T(v.out, { w: 'sine', f: f * 1.335, t: t + 0.055, a: 0.002, d: 0.38, g: 0.22 });
    T(v.out, { w: 'sine', f: f * 2.67, t: t + 0.055, a: 0.002, d: 0.12, g: 0.025 });
  });

  /* ---------- eşyalar (kullanım) ---------- */
  def('saw', 2, 2, 0.1, 0.7, 0.1, (v, t, k) => {
    FMt(v.out, { t, f: 900 * k, ratio: 1.414, idx: 3, idxD: 0.2, d: 0.35, g: 0.1 });
    T(v.out, { w: 'sawtooth', f: 160 * k, f2: 240 * k, pt: 0.5, t, a: 0.02, d: 0.55, g: 0.1, bp: 1800, bq: 2.5, vib: 30, vd: 25 });
    N(v.out, { t, a: 0.02, d: 0.4, g: 0.05, bp: 3500, bq: 2 });
  });
  def('dyn', 2, 2, 0.1, 1.2, 0.05, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.02, d: 0.18, g: 0.2, bp: 1200, bp2: 600, bq: 1 });        // fırlatma
    N(v.out, { t, a: 0.05, d: 1.05, g: 0.07, bp: 2400, bq: 1.1, sus: 0.8, rel: 0.1 });      // fitil cızırtısı
    crackle(v.out, t + 0.05, 1.0, 16, 0.18, { bp: 1600, bq: 0.8 });
  });
  def('trap', 2, 2, 0.1, 0.45, 0.08, (v, t, k) => {
    N(v.out, { t, a: 0.001, d: 0.04, g: 0.32, bp: 2600, bq: 3 });
    T(v.out, { w: 'square', f: 300 * k, f2: 240 * k, pt: 0.04, t, a: 0.002, d: 0.06, g: 0.06, lp: 2000 });
    N(v.out, { t: t + 0.11, a: 0.001, d: 0.03, g: 0.3, bp: 3400, bq: 4 });
    T(v.out, { w: 'triangle', f: 1200 * k, f2: 900 * k, pt: 0.05, t: t + 0.11, a: 0.002, d: 0.12, g: 0.07 });
  });
  def('mis', 2, 2, 0.1, 0.9, 0.1, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.25, d: 0.6, g: 0.28, lp: 500, lp2: 3500 });              // ateşleme "fışşş"
    T(v.out, { w: 'sawtooth', f: 70, f2: 110, pt: 0.5, t, a: 0.1, d: 0.6, g: 0.1, lp: 400 });
    T(v.out, { w: 'sq', f: 988, t, a: 0.003, d: 0.07, g: 0.06, lp: 3000 });                // "kuruldu" bip bip
    T(v.out, { w: 'sq', f: 988, t: t + 0.11, a: 0.003, d: 0.07, g: 0.06, lp: 3000 });
  });
  def('misLaunch', 2, 2, 0.1, 0.7, 0.1, (v, t) => {
    N(v.out, { t, a: 0.01, d: 0.55, g: 0.3, bp: 900, bp2: 2500, bq: 0.7 });
    N(v.out, { k: 'brown', t, a: 0.01, d: 0.5, g: 0.5, lp: 400 });
  });
  def('lock', 3, 2, 0.06, 0.12, 0, (v, t, k) => {
    T(v.out, { w: 'sq', f: 1175 * k, t, a: 0.003, d: 0.07, g: 0.06, lp: 2600 });
    T(v.out, { w: 'sine', f: 1175 * k, t, a: 0.003, d: 0.07, g: 0.08 });
  });
  def('bolt', 2, 2, 0.2, 1.4, 0.25, (v, t) => {
    T(v.out, { w: 'sawtooth', f: 55, t, a: 0.25, d: 1.2, g: 0.13, lp: 380 });
    T(v.out, { w: 'sawtooth', f: 55.7, t, a: 0.25, d: 1.2, g: 0.13, lp: 380 });
    N(v.out, { k: 'brown', t, a: 0.3, d: 1.2, g: 0.45, lp: 260 });
    crackle(v.out, t + 0.2, 1.0, 10, 0.1, { bp: 4000, bq: 0.7 });
    T(v.out, { w: 'sine', f: 660, f2: 1320, pt: 1, t, a: 0.2, d: 1.1, g: 0.035, vib: 7, vd: 12 });
  });
  def('cloud', 3, 1, 0.5, 2.0, 0.3, (v, t) => {          // başımın üstünde kara bulut!
    N(v.out, { k: 'brown', t, a: 0.6, d: 1.8, g: 0.6, lp: 220, lp2: 420, sus: 0.9, rel: 0.25 });
    T(v.out, { w: 'sawtooth', f: 48, f2: 62, pt: 1.7, t, a: 0.5, d: 1.8, g: 0.1, lp: 300 });
    crackle(v.out, t + 0.6, 1.1, 14, 0.12, { bp: 3500, bq: 0.8 });
  });
  def('ice', 2, 2, 0.15, 1.2, 0.4, (v, t) => {
    N(v.out, { t, a: 0.15, d: 0.8, g: 0.08, bp: 6500, bq: 0.7 });                           // soğuk rüzgâr
    const sc = [81, 84, 86, 88, 91, 93];
    for (let i = 0; i < 7; i++) {
      const f = mtof(sc[(Math.random() * sc.length) | 0]);
      FMt(v.out, { t: t + i * 0.06 + rnd(0, 0.02), f, ratio: 3.5, idx: 0.8, idxD: 0.06, d: 0.35, g: 0.05 });
    }
  });
  def('mag', 2, 2, 0.2, 0.7, 0.1, (v, t) => {
    T(v.out, { w: 'sine', f: 110, f2: 175, pt: 0.45, t, a: 0.05, d: 0.55, g: 0.3, vib: 12, vd: 6 });
    T(v.out, { w: 'sq', f: 220, f2: 350, pt: 0.45, t, a: 0.05, d: 0.5, g: 0.04, lp: 900, vib: 12, vd: 12 });
    T(v.out, { w: 'sine', f: 330, f2: 600, pt: 0.2, t: t + 0.4, a: 0.01, d: 0.2, g: 0.06 });
  });
  def('net', 2, 2, 0.15, 0.6, 0.08, (v, t) => {
    T(v.out, { w: 'sawtooth', f: 118, t, a: 0.02, d: 0.45, g: 0.11, bp: 1400, bq: 1.5, vib: 50, vd: 30 });
    T(v.out, { w: 'square', f: 177, t, a: 0.02, d: 0.45, g: 0.04, lp: 2000 });
    crackle(v.out, t, 0.45, 10, 0.16, { bp: 2000, bq: 0.9 });
  });
  def('ink', 2, 2, 0.1, 0.5, 0.1, (v, t, k) => {
    N(v.out, { k: 'pink', t, a: 0.002, d: 0.22, g: 0.45, lp: 1600, lp2: 300 });
    T(v.out, { w: 'sine', f: 220 * k, f2: 70 * k, pt: 0.12, t, a: 0.002, d: 0.15, g: 0.33 });
    N(v.out, { k: 'pink', t: t + 0.08, a: 0.002, d: 0.16, g: 0.22, lp: 900, lp2: 250 });
    T(v.out, { w: 'sine', f: 380, f2: 120, pt: 0.08, t: t + 0.1, a: 0.002, d: 0.1, g: 0.12 });
  });
  def('speed', 2, 2, 0.15, 0.7, 0.12, (v, t) => {
    T(v.out, { w: 'sawtooth', f: 200, f2: 900, pt: 0.35, t, a: 0.02, d: 0.42, g: 0.09, lp: 800, lp2: 4500 });
    T(v.out, { w: 'sq', f: 400, f2: 1800, pt: 0.35, t, a: 0.02, d: 0.38, g: 0.03, lp: 3000 });
    N(v.out, { k: 'pink', t, a: 0.05, d: 0.45, g: 0.16, bp: 1000, bp2: 3500, bq: 0.8 });
    T(v.out, { w: 'sine', f: 1760, t: t + 0.33, a: 0.002, d: 0.3, g: 0.05 });
  });
  def('shield', 2, 2, 0.15, 1.0, 0.35, (v, t) => {
    [72, 76, 79, 84].forEach((m, i) => T(v.out, { w: 'sine', f: mtof(m), t: t + i * 0.03, a: 0.02, d: 0.85, g: 0.085, vib: 6, vd: 3 }));
    T(v.out, { w: 'triangle', f: 700, f2: 1400, pt: 0.25, t, a: 0.005, d: 0.3, g: 0.06 });
    N(v.out, { t, a: 0.05, d: 0.5, g: 0.04, bp: 6000, bq: 2 });
  });
  def('balloon', 2, 2, 0.15, 0.65, 0.05, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.2, d: 0.5, g: 0.3, bp: 300, bp2: 1600, bq: 2.5 });
    T(v.out, { w: 'sine', f: 380, f2: 760, pt: 0.45, t, a: 0.1, d: 0.5, g: 0.08, vib: 9, vd: 8 });
  });

  /* ---------- çatışma ---------- */
  def('explode', 3, 3, 0.05, 1.6, 0.32, (v, t, k) => {
    N(v.out, { t, a: 0.003, d: 0.7, g: 0.55, lp: 5000, lp2: 250, ft: 0.6 });
    N(v.out, { k: 'brown', t, a: 0.005, d: 1.3, g: 1.1, lp: 600, lp2: 120 });
    T(shaper(v.out), { w: 'sine', f: 95 * k, f2: 32 * k, pt: 0.45, t, a: 0.003, d: 0.7, g: 0.75 });
    crackle(v.out, t + 0.08, 0.5, 12, 0.16, { bp: 1500, bq: 0.7 });
  });
  def('snap', 3, 2, 0.05, 0.4, 0.1, (v, t) => {
    N(v.out, { t, a: 0.001, d: 0.05, g: 0.6, bp: 2800, bq: 2.5 });
    T(v.out, { w: 'square', f: 900, f2: 280, pt: 0.04, t, a: 0.001, d: 0.06, g: 0.08, lp: 3000 });
    T(v.out, { w: 'sine', f: 170, f2: 70, pt: 0.1, t, a: 0.002, d: 0.16, g: 0.45 });
    N(v.out, { t: t + 0.03, a: 0.002, d: 0.2, g: 0.05, bp: 4200, bq: 6 });
  });
  def('thunder', 3, 2, 0.08, 2.2, 0.45, (v, t) => {
    crackle(v.out, t, 0.12, 14, 0.5, { hp: 1200 });
    N(v.out, { t, a: 0.002, d: 0.3, g: 0.4, hp: 800, lp: 6000, lp2: 1500 });
    N(v.out, { k: 'brown', t: t + 0.03, a: 0.05, d: 1.8, g: 1.2, lp: 400, lp2: 90 });
    T(shaper(v.out), { w: 'sine', f: 62, f2: 30, pt: 1, t, a: 0.01, d: 1, g: 0.35 });
  });
  def('stun', 2, 2, 0.1, 0.9, 0.1, (v, t) => {
    T(v.out, { w: 'sine', f: 330, f2: 170, pt: 0.09, t, a: 0.002, d: 0.14, g: 0.4 });   // "bonk"
    T(v.out, { w: 'triangle', f: 820, t, a: 0.001, d: 0.04, g: 0.1 });
    for (let i = 0; i < 4; i++) {                                                          // dönen kuşlar: cik cik
      const b = 1450 + (i % 2) * 230;
      T(v.out, { w: 'sine', f: b, f2: b * 1.3, pt: 0.05, t: t + 0.16 + i * 0.13, a: 0.004, d: 0.08, g: 0.04 });
    }
  });
  def('knock', 2, 2, 0.1, 0.4, 0.1, (v, t) => {
    N(v.out, { t, a: 0.001, d: 0.07, g: 0.42, bp: 1100, bq: 1 });
    T(v.out, { w: 'sine', f: 210, f2: 85, pt: 0.14, t, a: 0.002, d: 0.2, g: 0.5 });
    N(v.out, { k: 'pink', t: t + 0.03, a: 0.02, d: 0.25, g: 0.15, bp: 1500, bp2: 400, bq: 1 });
  });
  def('freeze', 2, 2, 0.1, 0.8, 0.25, (v, t) => {
    crackle(v.out, t, 0.2, 8, 0.28, { bp: 2000, bq: 0.8 });
    FMt(v.out, { t, f: 1320, ratio: 3.5, idx: 0.7, idxD: 0.1, d: 0.6, g: 0.07 });
    FMt(v.out, { t: t + 0.05, f: 1760, ratio: 2.76, idx: 1, idxD: 0.1, d: 0.5, g: 0.05 });
    N(v.out, { t, a: 0.005, d: 0.35, g: 0.1, bp: 3000, bq: 0.6 });
    T(v.out, { w: 'sine', f: 300, f2: 150, pt: 0.1, t, a: 0.002, d: 0.12, g: 0.2 });
  });
  def('zap', 2, 2, 0.1, 0.6, 0.08, (v, t) => {
    T(v.out, { w: 'sawtooth', f: 90, t, a: 0.005, d: 0.5, g: 0.12, bp: 1200, bq: 1.2, vib: 60, vd: 40 });
    T(v.out, { w: 'square', f: 135, t, a: 0.005, d: 0.45, g: 0.045, lp: 1800 });
    crackle(v.out, t, 0.5, 16, 0.2, { bp: 1800, bq: 0.9 });
  });
  def('slowed', 2, 2, 0.1, 0.8, 0.1, (v, t) => {
    T(v.out, { w: 'sawtooth', f: 260, f2: 110, pt: 0.6, t, a: 0.02, d: 0.7, g: 0.13, lp: 1600, lp2: 300, lq: 5, vib: 5, vd: 18 });
  });
  def('pulled', 2, 2, 0.1, 0.4, 0.05, (v, t) => {
    T(v.out, { w: 'sine', f: 900, f2: 220, pt: 0.25, t, a: 0.003, d: 0.3, g: 0.22 });
    T(v.out, { w: 'sq', f: 450, f2: 110, pt: 0.25, t, a: 0.003, d: 0.25, g: 0.03, lp: 1500 });
  });
  def('splat', 2, 2, 0.1, 0.5, 0.1, (v, t, k, o) => SFX.ink.fn(v, t, k, o));
  def('hitConfirm', 2, 2, 0.1, 0.35, 0.08, (v, t) => {
    T(v.out, { w: 'triangle', f: mtof(84), t, a: 0.002, d: 0.12, g: 0.09 });
    T(v.out, { w: 'triangle', f: mtof(91), t: t + 0.06, a: 0.002, d: 0.2, g: 0.09 });
  });
  def('killConfirm', 2, 2, 0.1, 0.6, 0.15, (v, t) => {
    N(v.out, { t, a: 0.001, d: 0.03, g: 0.12, bp: 3000, bq: 1.5 });
    [79, 84, 91].forEach((m, i) => T(v.out, { w: 'triangle', f: mtof(m), t: t + i * 0.06, a: 0.002, d: 0.22, g: 0.09 }));
  });
  def('blockShield', 2, 2, 0.08, 0.7, 0.3, (v, t) => {
    FMt(v.out, { t, f: 1319, ratio: 2, idx: 1, idxD: 0.15, d: 0.6, g: 0.13 });
    T(v.out, { w: 'sine', f: 659, t, a: 0.002, d: 0.3, g: 0.08 });
    T(v.out, { w: 'sine', f: 1976, t, a: 0.002, d: 0.35, g: 0.035 });
  });
  def('pop', 2, 3, 0.05, 0.25, 0.05, (v, t, k) => {
    N(v.out, { t, a: 0.001, d: 0.04, g: 0.6, bp: 1500, bq: 0.7 });
    T(v.out, { w: 'sine', f: 1100 * k, f2: 300 * k, pt: 0.05, t, a: 0.001, d: 0.06, g: 0.25 });
  });
  def('death', 3, 3, 0.05, 0.9, 0.12, (v, t, k) => {
    T(v.out, { w: 'sine', f: 950 * k, f2: 380 * k, pt: 0.03, t, a: 0.001, d: 0.05, g: 0.38 });        // "pıt"
    N(v.out, { t, a: 0.001, d: 0.03, g: 0.25, hp: 1200 });
    T(v.out, { w: 'triangle', f: 760 * k, f2: 170 * k, pt: 0.5, t: t + 0.06, a: 0.02, d: 0.58, g: 0.2, vib: 7, vd: 14, vdl: 0.15 }); // düşen düdük
    T(v.out, { w: 'square', f: 760 * k, f2: 170 * k, pt: 0.5, t: t + 0.06, a: 0.02, d: 0.55, g: 0.02, lp: 1500 });
  });
  def('respawn', 2, 2, 0.2, 0.6, 0.3, (v, t) => {
    T(v.out, { w: 'sine', f: 400, f2: 1000, pt: 0.18, t, a: 0.01, d: 0.25, g: 0.13 });
    [79, 84, 88].forEach((m, i) => T(v.out, { w: 'sine', f: mtof(m), t: t + 0.12 + i * 0.05, a: 0.002, d: 0.3, g: 0.055 }));
  });
  def('clang', 1, 2, 0.08, 0.3, 0.1, (v, t, k) => {
    FMt(v.out, { t, f: 1100 * k, ratio: 1.41, idx: 2, idxD: 0.08, d: 0.2, g: 0.07 });
    N(v.out, { t, a: 0.001, d: 0.03, g: 0.1, hp: 3000 });
  });

  /* ---------- sıvılar ---------- */
  function bloops(v, t, n, lo, hi, g, step) {
    for (let i = 0, tt = t; i < n; i++) { const f = rnd(lo, hi); T(v.out, { w: 'sine', f, f2: f * 1.8, pt: 0.05, t: tt, a: 0.003, d: 0.07, g }); tt += rnd(step * 0.6, step * 1.2); }
  }
  def('splash_water', 3, 2, 0.1, 0.9, 0.2, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.005, d: 0.45, g: 0.55, bp: 1100, bp2: 450, bq: 0.7 });
    N(v.out, { t, a: 0.002, d: 0.15, g: 0.16, bp: 2500, bq: 0.8 });
    bloops(v, t + 0.08, 5, 350, 900, 0.09, 0.06);
  });
  def('splash_chocolate', 3, 2, 0.1, 1.0, 0.15, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.01, d: 0.5, g: 0.6, bp: 650, bp2: 250, bq: 0.8 });
    N(v.out, { k: 'brown', t, a: 0.01, d: 0.4, g: 0.4, lp: 500 });
    bloops(v, t + 0.1, 5, 160, 420, 0.13, 0.09);
  });
  def('splash_icewater', 3, 2, 0.1, 1.0, 0.3, (v, t) => {
    N(v.out, { k: 'pink', t, a: 0.005, d: 0.45, g: 0.5, bp: 1200, bp2: 500, bq: 0.7 });
    bloops(v, t + 0.08, 4, 400, 900, 0.08, 0.06);
    for (let i = 0; i < 3; i++) FMt(v.out, { t: t + 0.05 + i * rnd(0.05, 0.1), f: rnd(1500, 2200), ratio: 3.5, idx: 0.8, idxD: 0.05, d: 0.3, g: 0.045 });
  });
  def('splash_lava', 3, 2, 0.1, 1.3, 0.2, (v, t) => {
    N(v.out, { t, a: 0.01, d: 0.95, g: 0.2, bp: 2800, bq: 0.7, sus: 0.6, rel: 0.4 });                 // cızzzz
    crackle(v.out, t + 0.02, 1.0, 22, 0.2, { bp: 1600, bq: 0.8 });
    N(v.out, { k: 'brown', t, a: 0.02, d: 0.6, g: 0.7, lp: 500, lp2: 150 });                   // "fuum"
    bloops(v, t + 0.15, 4, 90, 200, 0.14, 0.12);
  });

  /* ---------- özel güçler ---------- */
  def('ab_TAFTAF', 3, 1, 0.2, 0.9, 0.3, (v, t) => {          // gölge atılımı
    FMt(v.out, { t, f: 1200, ratio: 1.41, idx: 2.5, idxD: 0.15, d: 0.3, g: 0.07 });
    N(v.out, { k: 'pink', t, a: 0.04, d: 0.6, g: 0.5, bp: 300, bp2: 3200, bq: 2, ft: 0.25 });
    T(v.out, { w: 'sine', f: 140, f2: 55, pt: 0.5, t, a: 0.02, d: 0.55, g: 0.33 });
    T(v.out, { w: 'sawtooth', f: 220, f2: 880, pt: 0.25, t, a: 0.02, d: 0.3, g: 0.045, lp: 1500 });
  });
  function caw(dst, t, k) {
    T(dst, { w: 'sawtooth', f: 620 * k, f2: 470 * k, pt: 0.17, t, a: 0.015, d: 0.2, g: 0.17, bp: 1300 * k, bq: 3, vib: 38, vd: 25 });
    T(dst, { w: 'sq', f: 310 * k, f2: 235 * k, pt: 0.17, t, a: 0.015, d: 0.2, g: 0.045, lp: 1800 });
    N(dst, { t, a: 0.01, d: 0.18, g: 0.1, bp: 2000, bq: 1.5 });
  }
  def('ab_Caner', 3, 1, 0.2, 1.1, 0.3, (v, t) => {            // kızıl ay kargaları
    for (let i = 0; i < 3; i++) caw(v.out, t + i * 0.2, 1 - i * 0.06 + rnd(-0.03, 0.03));
    N(v.out, { k: 'pink', t: t + 0.05, a: 0.02, d: 0.12, g: 0.18, bp: 900, bp2: 500, bq: 0.8 });
    N(v.out, { k: 'pink', t: t + 0.38, a: 0.02, d: 0.12, g: 0.15, bp: 900, bp2: 500, bq: 0.8 });
  });
  def('ab_LUL', 3, 1, 0.2, 1.5, 0.25, (v, t) => {             // göğüs yumruğu + yer sarsıntısı
    for (let i = 0; i < 4; i++) {
      T(v.out, { w: 'sine', f: i % 2 ? 118 : 100, f2: 62, pt: 0.08, t: t + i * 0.11, a: 0.002, d: 0.12, g: 0.5 });
      N(v.out, { k: 'pink', t: t + i * 0.11, a: 0.001, d: 0.05, g: 0.18, lp: 900 });
    }
    const t2 = t + 0.48;
    T(shaper(v.out), { w: 'sine', f: 70, f2: 28, pt: 0.6, t: t2, a: 0.003, d: 0.8, g: 0.75 });
    N(v.out, { k: 'brown', t: t2, a: 0.01, d: 0.9, g: 1.1, lp: 350, lp2: 80 });
    crackle(v.out, t2, 0.45, 10, 0.12, { lp: 1200 });
  });
  def('ab_ertan', 3, 1, 0.2, 1.4, 0.35, (v, t) => {           // buz kızağı
    N(v.out, { t, a: 0.05, d: 1.1, g: 0.12, bp: 3400, bq: 0.8, sus: 0.6, rel: 0.3 });
    [76, 79, 83, 86, 88, 91].forEach((m, i) => FMt(v.out, { t: t + i * 0.07, f: mtof(m), ratio: 3.5, idx: 0.5, idxD: 0.08, d: 0.35, g: 0.055 }));
    T(v.out, { w: 'sine', f: 500, f2: 900, pt: 0.5, t, a: 0.05, d: 0.6, g: 0.07, vib: 6, vd: 10 });
  });
  def('ab_Kral', 3, 1, 0.2, 1.5, 0.3, (v, t) => {             // aslan kükremesi
    N(v.out, { k: 'pink', t, a: 0.08, hold: 0.35, d: 1.1, g: 0.65, bp: 520, bp2: 260, bq: 1.6 });
    T(v.out, { w: 'sawtooth', f: 92, f2: 64, pt: 1, t, a: 0.08, hold: 0.4, d: 1.1, g: 0.26, lp: 700, lp2: 300, vib: 28, vd: 6 });
    T(v.out, { w: 'sawtooth', f: 138, f2: 96, pt: 1, t, a: 0.08, hold: 0.35, d: 1.0, g: 0.1, lp: 900, vib: 31, vd: 9 });
    N(v.out, { k: 'brown', t, a: 0.1, d: 1.2, g: 0.7, lp: 200 });
  });
  def('ab_Nuss', 3, 1, 0.2, 1.2, 0.3, (v, t) => {             // kanat çırpma + baykuş "hu-hu"
    for (let i = 0; i < 3; i++) N(v.out, { k: 'pink', t: t + i * 0.13, a: 0.02, d: 0.14, g: 0.34 - i * 0.06, bp: 800, bp2: 1400, bq: 0.9 });
    N(v.out, { t: t + 0.3, a: 0.2, d: 0.6, g: 0.1, bp: 2000, bp2: 4000, bq: 0.7 });
    T(v.out, { w: 'sine', f: 520, f2: 480, pt: 0.18, t: t + 0.35, a: 0.03, d: 0.2, g: 0.13, lp: 1500 });
    T(v.out, { w: 'sine', f: 470, f2: 420, pt: 0.25, t: t + 0.6, a: 0.03, d: 0.28, g: 0.13 });
  });
  def('ab_baso', 3, 1, 0.2, 1.4, 0.2, (v, t) => {             // bas düşüşü "wub wub"
    const ac = E.ac;
    const osc = ac.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t); osc.frequency.exponentialRampToValueAtTime(41, t + 0.8);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7; lp.frequency.setValueAtTime(700, t);
    const lfo = ac.createOscillator(); lfo.frequency.setValueAtTime(7, t); lfo.frequency.linearRampToValueAtTime(3, t + 0.9);
    const lg = ac.createGain(); lg.gain.value = 520;
    lfo.connect(lg); lg.connect(lp.frequency);
    const g = ac.createGain(); env(g.gain, t, 0.01, 0.28, 1.0, 0.9, 0.25);
    osc.connect(lp); lp.connect(g); g.connect(v.out);
    osc.start(t); lfo.start(t); osc.stop(t + 1.05); lfo.stop(t + 1.05); own(osc); own(lfo);
    T(v.out, { w: 'sine', f: 60, f2: 30, pt: 0.9, t, a: 0.01, d: 1, g: 0.5 });
  });

  /* ---------- yarış akışı ---------- */
  def('count', 3, 2, 0.2, 0.5, 0.1, (v, t) => {
    const f = 587;
    T(v.out, { w: 'sq', f, t, a: 0.005, d: 0.26, g: 0.06, lp: 2200, sus: 0.7, rel: 0.08 });
    T(v.out, { w: 'sine', f, t, a: 0.005, d: 0.3, g: 0.22 });
    T(v.out, { w: 'sine', f: f * 2, t, a: 0.003, d: 0.12, g: 0.04 });
  });
  def('go', 3, 1, 0.3, 1.0, 0.25, (v, t) => {
    const f = 1175;
    T(v.out, { w: 'sq', f, t, a: 0.005, d: 0.55, g: 0.06, lp: 3200, sus: 0.6, rel: 0.2 });
    T(v.out, { w: 'sine', f, t, a: 0.005, d: 0.6, g: 0.24 });
    T(v.out, { w: 'sine', f: f * 1.5, t, a: 0.005, d: 0.4, g: 0.06 });
    N(v.out, { t, a: 0.02, d: 0.4, g: 0.08, hp: 1500, hp2: 5000 });
  });
  def('tick', 3, 1, 0.3, 0.12, 0, (v, t, k, o) => {
    const hi = (o.n | 0) <= 3, f = hi ? 1400 : 1150;
    T(v.out, { w: 'triangle', f, f2: f * 0.8, pt: 0.03, t, a: 0.001, d: 0.05, g: 0.16 });
    T(v.out, { w: 'sine', f: f / 2, t, a: 0.001, d: 0.06, g: 0.09 });
  });
  def('finish', 3, 1, 0.5, 2.6, 0.3, (v, t, k, o) => {
    const first = (o.place | 0) === 1;
    if (first) {
      jingle(v.out, t, [[67, 0, 0.25], [72, 0.25, 0.25], [76, 0.5, 0.25], [79, 0.75, 0.25], [84, 1, 1.6]], 'pulse', 150, 0.2);
      jingle(v.out, t, [[64, 0, 0.25], [67, 0.25, 0.25], [72, 0.5, 0.25], [76, 0.75, 0.25], [79, 1, 1.6]], 'p12', 150, 0.1);
      const tb = t + 0.4;
      [60, 64, 67, 72].forEach(m => INS.pad(v.out, tb, mtof(m), 0.9, 0.05));
      DRUM.k(v.out, tb, 0.8); DRUM.crash(v.out, tb, 0.8);
      for (let i = 0; i < 6; i++) INS.bellS(v.out, tb + 0.15 + i * 0.07, mtof([84, 88, 91, 96, 91, 88][i]), 0.1, 0.05);
    } else {
      jingle(v.out, t, [[72, 0, 0.25], [76, 0.25, 0.25], [79, 0.5, 1.2]], 'bell', 150, 0.2);
      [60, 64, 67].forEach(m => INS.pad(v.out, t + 0.2, mtof(m), 0.7, 0.04));
      DRUM.crash(v.out, t + 0.2, 0.5);
    }
  });
  def('finishOther', 1, 2, 0.2, 0.5, 0.2, (v, t) => {
    T(v.out, { w: 'sine', f: mtof(84), t, a: 0.002, d: 0.3, g: 0.09 });
    T(v.out, { w: 'sine', f: mtof(88), t: t + 0.08, a: 0.002, d: 0.35, g: 0.07 });
  });
  def('victory', 3, 1, 1, 4.0, 0.3, (v, t) => {               // kürsü: 1.
    const bpm = 150, b = 60 / bpm;
    for (let i = 0; i < 8; i++) DRUM.s(v.out, t + i * b / 4, 0.18 + i * 0.07);
    const t0 = t + 2 * b;
    jingle(v.out, t0, [[67, 0, 0.5], [72, 0.5, 0.5], [76, 1, 0.5], [79, 1.5, 0.5], [84, 2, 1.4], [81, 3.5, 0.5], [83, 4, 0.5], [84, 4.5, 3]], 'pulse', bpm, 0.18);
    jingle(v.out, t0, [[64, 0, 0.5], [67, 0.5, 0.5], [72, 1, 0.5], [76, 1.5, 0.5], [79, 2, 1.4], [77, 3.5, 0.5], [79, 4, 0.5], [76, 4.5, 3]], 'p12', bpm, 0.09);
    jingle(v.out, t0, [[48, 0, 1.5], [53, 2, 1.4], [55, 3.5, 1], [48, 4.5, 2.5]], 'chipbass', bpm, 0.3);
    const tf = t0 + 4.5 * b;
    [60, 64, 67, 72].forEach(m => INS.pad(v.out, tf, mtof(m), 3 * b, 0.05));
    DRUM.k(v.out, t0, 0.8); DRUM.k(v.out, t0 + 2 * b, 0.7); DRUM.k(v.out, tf, 0.9); DRUM.crash(v.out, tf, 0.85);
    for (let i = 0; i < 8; i++) INS.bellS(v.out, tf + 0.1 + i * 0.08, mtof([84, 88, 91, 96, 93, 91, 88, 96][i]), 0.1, 0.045);
  });
  def('podium', 3, 1, 1, 3.0, 0.3, (v, t) => {                // kürsü: 2-4. (tatlı)
    const bpm = 140, b = 60 / bpm;
    jingle(v.out, t, [[72, 0, 0.5], [76, 0.5, 0.5], [79, 1, 1], [77, 2, 0.5], [76, 2.5, 0.5], [74, 3, 0.5], [76, 3.5, 2.5]], 'bell', bpm, 0.17);
    jingle(v.out, t, [[48, 0, 2], [53, 2, 1.5], [48, 3.5, 2.5]], 'roundbass', bpm, 0.28);
    [60, 64, 67].forEach(m => INS.pad(v.out, t + 3.5 * b, mtof(m), 2.4 * b, 0.05));
    DRUM.k(v.out, t, 0.5); DRUM.crash(v.out, t + 3.5 * b, 0.4);
  });
  def('champion', 3, 1, 1, 5.0, 0.35, (v, t) => {             // maç şampiyonu
    const bpm = 132, b = 60 / bpm;
    for (let i = 0; i < 12; i++) DRUM.s(v.out, t + i * b / 4, 0.15 + i * 0.05);
    const t0 = t + 3 * b;
    jingle(v.out, t0, [[72, 0, 0.33], [72, 0.33, 0.33], [72, 0.67, 0.33], [76, 1, 1], [74, 2, 0.5], [76, 2.5, 0.5], [79, 3, 0.5], [84, 3.5, 3]], 'brass', bpm, 0.2);
    jingle(v.out, t0, [[67, 0, 0.33], [67, 0.33, 0.33], [67, 0.67, 0.33], [72, 1, 1], [71, 2, 0.5], [72, 2.5, 0.5], [76, 3, 0.5], [79, 3.5, 3]], 'square', bpm, 0.1);
    jingle(v.out, t0, [[48, 0, 1], [48, 1, 1], [55, 2, 1.5], [48, 3.5, 3]], 'sawbass', bpm, 0.3);
    const tf = t0 + 3.5 * b;
    [60, 64, 67, 72, 76].forEach(m => INS.pad(v.out, tf, mtof(m), 3 * b, 0.045));
    DRUM.k(v.out, t0, 0.9); DRUM.k(v.out, t0 + b, 0.7); DRUM.k(v.out, tf, 1); DRUM.crash(v.out, t0, 0.6); DRUM.crash(v.out, tf, 0.9);
    for (let i = 0; i < 10; i++) INS.bellS(v.out, tf + 0.1 + i * 0.07, mtof(84 + [0, 4, 7, 12, 7, 4, 12, 16, 12, 19][i]), 0.1, 0.04);
  });
  def('matchEnd', 3, 1, 1, 2.2, 0.3, (v, t) => {
    jingle(v.out, t, [[67, 0, 0.5], [72, 0.5, 0.5], [76, 1, 2]], 'bell', 130, 0.17);
    [60, 64, 67].forEach(m => INS.pad(v.out, t + 0.45, mtof(m), 1.3, 0.045));
  });

  /* ---------- ödüller / meta ---------- */
  def('mission', 3, 1, 0.3, 1.2, 0.3, (v, t) => {
    jingle(v.out, t, [[79, 0, 0.25], [84, 0.25, 0.25], [88, 0.5, 0.9]], 'bell', 150, 0.16);
    N(v.out, { t: t + 0.2, a: 0.1, d: 0.6, g: 0.03, bp: 7000, bq: 2 });
  });
  def('levelup', 3, 1, 0.5, 1.8, 0.3, (v, t) => {
    const ns = [60, 64, 67, 72, 76, 79, 84];
    ns.forEach((m, i) => INS.pulse(v.out, t + i * 0.055, mtof(m), 0.07, 0.11));
    const tc = t + ns.length * 0.055;
    [72, 76, 79, 84].forEach(m => INS.brass(v.out, tc, mtof(m), 0.6, 0.06));
    INS.chipbass(v.out, tc, mtof(48), 0.6, 0.3);
    DRUM.k(v.out, tc, 0.7); DRUM.crash(v.out, tc, 0.6);
    for (let i = 0; i < 6; i++) INS.bellS(v.out, tc + 0.1 + i * 0.07, mtof([88, 91, 96, 91, 96, 100][i] - 12), 0.1, 0.05);
  });
  def('buy', 3, 2, 0.12, 1.0, 0.25, (v, t) => {               // "ka-çing"
    N(v.out, { t, a: 0.001, d: 0.05, g: 0.35, bp: 2500, bq: 1.5 });
    T(v.out, { w: 'square', f: 180, f2: 120, pt: 0.05, t, a: 0.001, d: 0.06, g: 0.06, lp: 1500 });
    const t2 = t + 0.09;
    FMt(v.out, { t: t2, f: 1568, ratio: 2, idx: 1.3, idxD: 0.2, d: 0.8, g: 0.12 });
    FMt(v.out, { t: t2, f: 2093, ratio: 2, idx: 0.9, idxD: 0.2, d: 0.6, g: 0.05 });
    for (let i = 0; i < 5; i++) T(v.out, { w: 'sine', f: rnd(1800, 2500), t: t2 + 0.05 + i * 0.05, a: 0.001, d: 0.08, g: 0.025 });
  });
  def('reward', 3, 2, 0.15, 1.0, 0.2, (v, t) => {
    for (let i = 0; i < 6; i++) {
      const f = mtof(74 + COIN_STEPS[i]);
      T(v.out, { w: 'sine', f, t: t + i * 0.07, a: 0.002, d: 0.08, g: 0.13 });
      T(v.out, { w: 'sine', f: f * 1.335, t: t + i * 0.07 + 0.045, a: 0.002, d: 0.25, g: 0.13 });
    }
  });
  def('daily', 3, 1, 0.3, 1.8, 0.3, (v, t, k, o) => {
    SFX.reward.fn(v, t, k, o);
    const tc = t + 0.5;
    [72, 76, 79, 84].forEach(m => INS.bell(v.out, tc, mtof(m), 0.8, 0.05));
    DRUM.crash(v.out, tc, 0.4);
  });
  def('gem', 2, 2, 0.08, 0.8, 0.3, (v, t) => {
    FMt(v.out, { t, f: 1319, ratio: 3.5, idx: 1.2, idxD: 0.12, d: 0.6, g: 0.1 });
    FMt(v.out, { t: t + 0.08, f: 1976, ratio: 3.5, idx: 1, idxD: 0.12, d: 0.6, g: 0.07 });
  });
  def('unlockItem', 3, 1, 0.3, 1.3, 0.3, (v, t) => {
    jingle(v.out, t, [[72, 0, 0.25], [79, 0.25, 0.25], [84, 0.5, 1]], 'pulse', 150, 0.12);
    [76, 79, 84].forEach(m => INS.bell(v.out, t + 0.2, mtof(m), 0.6, 0.04));
  });

  /* ---------- arayüz ---------- */
  def('click', 3, 2, 0.06, 0.1, 0, (v, t) => {
    T(v.out, { w: 'sine', f: 1000, f2: 620, pt: 0.035, t, a: 0.002, d: 0.06, g: 0.2 });
    T(v.out, { w: 'triangle', f: 2000, t, a: 0.001, d: 0.015, g: 0.035 });
  });
  def('hover', 1, 1, 0.05, 0.05, 0, (v, t) => {
    T(v.out, { w: 'sine', f: 1500, f2: 1700, pt: 0.02, t, a: 0.002, d: 0.035, g: 0.045 });
  });
  def('whoosh', 2, 2, 0.08, 0.4, 0.05, (v, t, k) => N(v.out, { k: 'pink', t, a: 0.06, d: 0.3, g: 0.22, bp: 500 * k, bp2: 2200 * k, bq: 1 }));
  def('open', 2, 2, 0.08, 0.25, 0.08, (v, t) => {
    T(v.out, { w: 'triangle', f: 520, f2: 780, pt: 0.06, t, a: 0.002, d: 0.12, g: 0.14 });
    T(v.out, { w: 'sine', f: 1040, t: t + 0.04, a: 0.002, d: 0.12, g: 0.055 });
  });
  def('back', 2, 2, 0.08, 0.25, 0.05, (v, t) => {
    T(v.out, { w: 'triangle', f: 700, f2: 450, pt: 0.07, t, a: 0.002, d: 0.12, g: 0.14 });
  });
  def('tab', 2, 2, 0.06, 0.15, 0.03, (v, t) => {
    T(v.out, { w: 'triangle', f: 880, t, a: 0.002, d: 0.07, g: 0.11 });
    T(v.out, { w: 'sine', f: 1320, t: t + 0.03, a: 0.002, d: 0.07, g: 0.045 });
  });
  def('toggle', 2, 2, 0.05, 0.1, 0, (v, t) => {
    T(v.out, { w: 'sq', f: 1200, t, a: 0.001, d: 0.02, g: 0.035, lp: 3000 });
    T(v.out, { w: 'sine', f: 800, t, a: 0.001, d: 0.04, g: 0.11 });
  });
  def('select', 2, 2, 0.08, 0.5, 0.15, (v, t) => {
    INS.pluck(v.out, t, mtof(76), 0.2, 0.16); INS.pluck(v.out, t + 0.07, mtof(83), 0.2, 0.16);
  });
  def('equip', 2, 2, 0.1, 0.7, 0.2, (v, t) => {
    [72, 79, 84].forEach((m, i) => INS.pluck(v.out, t + i * 0.06, mtof(m), 0.2, 0.15));
    N(v.out, { k: 'pink', t, a: 0.05, d: 0.25, g: 0.08, bp: 800, bp2: 3000, bq: 1 });
  });
  def('upgrade', 3, 2, 0.1, 1.0, 0.25, (v, t) => {
    [67, 72, 76, 79].forEach((m, i) => INS.pulse(v.out, t + i * 0.06, mtof(m), 0.08, 0.1));
    INS.bell(v.out, t + 0.24, mtof(84), 0.6, 0.12);
    N(v.out, { t: t + 0.2, a: 0.1, d: 0.6, g: 0.03, bp: 7000, bq: 2 });
  });
  def('deny', 2, 2, 0.15, 0.3, 0, (v, t) => {
    T(v.out, { w: 'sq', f: 220, t, a: 0.003, d: 0.09, g: 0.07, lp: 900 });
    T(v.out, { w: 'sine', f: 220, t, a: 0.003, d: 0.09, g: 0.12 });
    T(v.out, { w: 'sq', f: 185, t: t + 0.1, a: 0.003, d: 0.14, g: 0.07, lp: 900 });
    T(v.out, { w: 'sine', f: 185, t: t + 0.1, a: 0.003, d: 0.14, g: 0.12 });
  });
  def('notify', 2, 2, 0.2, 0.6, 0.2, (v, t) => {
    INS.bellS(v.out, t, mtof(79), 0.1, 0.12); INS.bellS(v.out, t + 0.09, mtof(84), 0.1, 0.12);
  });
  def('star', 2, 3, 0.05, 0.5, 0.3, (v, t) => {
    [84, 88, 91].forEach((m, i) => T(v.out, { w: 'sine', f: mtof(m), t: t + i * 0.04, a: 0.002, d: 0.22, g: 0.05 }));
  });

  /* Ses düzeyi dengesi (dB): headless Chrome + OfflineAudioContext ile her efektin RMS düzeyi ölçüldü,
     hedef düzeylere göre düzeltildi (scratchpad ölçüm betiği). Müzik ≈ -22 dB RMS, büyük olaylar ≈ -20, hareket ≈ -27..-33, arayüz ≈ -31..-35. */
  const TRIM = {
    explode: -2, ab_LUL: -3, champion: -1, thunder: -0.5, podium: -2.5, victory: -1, slamLand: -2.5, ab_baso: -1, levelup: -1,
    landHard: -2.5, finish: 1, ab_Kral: 1.5, cloud: 1.5, mush: 1, jump: -0.5, count: 1, land: -4, mag: -0.5,
    snap: 3.5, go: 4.5, matchEnd: 2.5, ink: 2.5, splat: 1, pulled: 1, bolt: 2.5, ab_TAFTAF: 5, mission: 3,
    deny: -0.5, coin: 4.5, stun: 4.5, death: 5.5, mis: 4, select: -1.5, equip: 1.5, jump2: 6.5, lock: 3.5,
    splash_lava: 5.5, unlockItem: 3.5, reward: 5, daily: 5, box: 5.5, shield: 5, misLaunch: 4, tick: 2.5, upgrade: 4.5,
    splash_chocolate: 6.5, back: 0.5, freeze: 7.5, notify: 2, ab_ertan: 11, balloon: 5, splash_water: 10, slowed: 7, slam: 6.5,
    saw: 8, blockShield: 7, finishOther: 3.5, open: 2, climb: 3, buy: 9, killConfirm: 7.5, ab_Nuss: 12.5, gem: 6.5,
    zap: 11, respawn: 5.5, splash_icewater: 10, speed: 11, toggle: 2.5, tab: 2.5, hitConfirm: 5.5, clang: 3.5, pad: 12.5,
    ice: 9, trap: 9, ab_Caner: 16.5, dyn: 13, slide: 11.5, net: 12, flap: 8.5, star: 8, whoosh: 7
  };
  let trimOn = true;

  const ALIAS = {
    hit: 'stun', bonk: 'stun', tap: 'click', press: 'click', button: 'click', ok: 'select', confirm: 'select',
    cancel: 'back', close: 'back', error: 'deny', fail: 'deny', no: 'deny', locked: 'deny',
    kaching: 'buy', purchase: 'buy', coins: 'reward', claim: 'reward', level: 'levelup', levelUp: 'levelup',
    achievement: 'mission', blocked: 'blockShield', shieldBlock: 'blockShield', balloonPop: 'pop',
    win: 'victory', countdown: 'count', beep: 'count', start: 'go', strike: 'thunder', boom: 'explode', explosion: 'explode',
    splash: 'splash_water', water: 'splash_water', lava: 'splash_lava', chocolate: 'splash_chocolate', icewater: 'splash_icewater',
    jumpDouble: 'jump2', doubleJump: 'jump2', dbl: 'jump2', swoosh: 'whoosh', toast: 'notify', unlock: 'unlockItem',
    shine: 'star', sparkle: 'star', swap: 'tab', page: 'tab', next: 'select', prev: 'back', slider: 'toggle'
  };

  /* =====================================================================
     SES (VOICE) YÖNETİMİ — aynı anda çok fazla ses olmasın
     ===================================================================== */
  const MAXV = 22;
  function prune(e, now) {
    for (let i = e.voices.length - 1; i >= 0; i--) {
      const v = e.voices[i];
      if (now > v.end + 0.15) { try { v.out.disconnect(); } catch (er) { } e.voices.splice(i, 1); }
    }
  }
  function kill(v) {
    if (v.killed) return;
    v.killed = true;
    const t = E.ac.currentTime;
    try {
      const p = v.out.gain;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 0.03);
    } catch (er) { }
    // susturulan sesin kaynaklarını gerçekten durdur (işlemci boşa dönmesin)
    for (const s of v.srcs) { try { s.stop(t + 0.04); } catch (er) { } }
    v.srcs.length = 0;
    v.end = Math.min(v.end, t + 0.05);
  }
  function newVoice(name, d, vol, pan, verb, when) {
    const e = E, ac = e.ac, now = ac.currentTime;
    prune(e, now);
    let same = 0, oldestSame = null, active = 0;
    for (const v of e.voices) {
      if (v.killed) continue;
      active++;
      if (v.name === name) { same++; if (!oldestSame || v.t < oldestSame.t) oldestSame = v; }
    }
    if (same >= d.poly && oldestSame) { kill(oldestSame); same--; active--; }
    if (active >= MAXV) {
      let victim = null;
      for (const v of e.voices) if (!v.killed && v.pri <= d.pri && (!victim || v.pri < victim.pri || (v.pri === victim.pri && v.t < victim.t))) victim = v;
      if (!victim) return null;
      kill(victim);
    }
    vol *= 1 / (1 + 0.35 * same);                       // aynı ses üst üste binerse kıs
    const t = now + 0.006 + Math.max(0, when || 0);
    const out = ac.createGain(); out.gain.value = vol;
    if (pan && e.hasPan) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); out.connect(p); p.connect(e.sfxIn); }
    else out.connect(e.sfxIn);
    if (verb > 0) { const s = ac.createGain(); s.gain.value = verb; out.connect(s); s.connect(e.sfxVerbIn); }
    const v = { name, pri: d.pri, t, end: t + d.dur, out, killed: false, srcs: [] };
    e.voices.push(v);
    return v;
  }

  /* ---------- konuma göre ses düzeyi / pan ---------- */
  function playerCx() { const p = FM.S.player; return p ? p.x + (p.w || 28) / 2 : null; }
  function onScreen(x, y, m) {
    const S = FM.S, V = FM.view, cam = S.cam || { x: 0, y: 0 };
    return x > cam.x - m && x < cam.x + (V.VW || 1000) + m && y > cam.y - m && y < cam.y + (V.VH || 540) + m;
  }
  function quietMode() { const m = FM.S.mode; return m === 'demo' || m === 'menu' || m === 'boot'; }
  function racerVol(r) {
    if (quietMode()) return 0;
    if (r === FM.S.player) return 1;
    const x = r.x + (r.w || 28) / 2, y = r.y + (r.h || 42) / 2;
    if (!onScreen(x, y, 40)) return 0;                 // ekranda değilse duyma
    const pc = playerCx(), vw = FM.view.VW || 1000;
    const dd = pc == null ? 0 : Math.abs(x - pc) / vw;
    return 0.55 * (1 - Math.min(0.5, dd * 0.6));
  }
  function posVol(x, y) {
    if (quietMode()) return 0;
    const S = FM.S, V = FM.view, cam = S.cam || { x: 0, y: 0 };
    const vw = V.VW || 1000, vh = V.VH || 540;
    const dx = x < cam.x ? cam.x - x : x > cam.x + vw ? x - cam.x - vw : 0;
    const dy = y < cam.y ? cam.y - y : y > cam.y + vh ? y - cam.y - vh : 0;
    const out = Math.max(dx, dy);
    if (out <= 0) { const pc = playerCx(); return pc == null ? 1 : 1 - Math.min(0.4, Math.abs(x - pc) / vw * 0.5); }
    return out < 600 ? 0.35 * (1 - out / 600) : 0;
  }
  function panFor(x) {
    const pc = playerCx(); if (pc == null) return 0;
    return clamp((x - pc) / (FM.view.VW || 1000) * 1.1, -0.6, 0.6);
  }

  /* =====================================================================
     play()
     ===================================================================== */
  function playNow(name, o, force) {
    if (!E) return false;
    if (hasOwn(ALIAS, name)) name = ALIAS[name];
    if (!hasOwn(SFX, name)) return false;
    const d = SFX[name];
    if (!force && E.sv <= 0) return false;
    const ac = E.ac, now = ac.currentTime;
    const isP = o.r && o.r === FM.S.player;
    const key = isP ? name + '#p' : name;
    if (!force) {
      const lt = E.last[key];
      if (lt != null && now - lt < d.gap && now >= lt) return false;
    }
    let vol = num(o.vol, 1), pan = num(o.pan, 0);
    if (!force) {
      if (o.r) {
        const rv = racerVol(o.r); if (rv <= 0) return false;
        vol *= rv;
        if (o.pan == null && !isP) pan = panFor(o.r.x + (o.r.w || 28) / 2);
      } else if (o.x != null) {
        const pv = posVol(num(o.x, 0), num(o.y, 0)); if (pv <= 0) return false;
        vol *= pv;
        if (o.pan == null) pan = panFor(num(o.x, 0));
      }
    }
    if (trimOn && hasOwn(TRIM, name)) vol *= Math.pow(10, TRIM[name] / 20);
    if (vol <= 0.004) return false;
    E.last[key] = now;
    const v = newVoice(name, d, vol, pan, d.verb * num(o.verb, 1), num(o.when, 0));
    if (!v) return false;
    const k = num(o.rate, 1) * (o.exact ? 1 : rnd(0.97, 1.03));
    curV = v;
    try { d.fn(v, v.t, k, o); } finally { curV = null; }
    return true;
  }
  function play(name, opts) {
    if (!live() && !starting()) return false;
    const saved = E; E = LIVE;
    try { return playNow(String(name || ''), opts || {}, false); }
    catch (e) { fail(e); return false; }
    finally { E = saved; }
  }
  function duck(amount, dur) {
    if (!live()) return;
    try {
      const e = LIVE, p = e.musicImp.gain, t = e.ac.currentTime;
      amount = clamp(num(amount, 0.5), 0, 1); dur = Math.max(0.1, num(dur, 0.5));
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(amount, t + 0.04);
      p.setValueAtTime(amount, t + 0.04 + dur * 0.45);
      p.linearRampToValueAtTime(1, t + 0.04 + dur);
    } catch (e) { fail(e); }
  }

  /* =====================================================================
     MÜZİK — veri
     Melodi yazımı: 'nota:uzunluk' (uzunluk 16'lık cinsinden, her ölçü 16), 'r' = es, ölçüler '|' ile ayrılır.
     Akorlar: 'C | G | Am | F' — bir ölçüde iki akor 'Am,F'.
     Davul şeritleri: k kick, s trampet, c el çırpma, h kapalı zil, o açık zil, j zilli/shaker, r rim, t tom (h/m/l)
       karakterler: X vurgu, x normal, g hayalet, . boş
     Bas: R kök, r yumuşak kök, O oktav, 5 beşli, 3 üçlü, 7 yedili, A sonraki köke yaklaşma, - uzat, . sus
     ===================================================================== */
  const QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7],
    add9: [0, 4, 7, 14], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], dim: [0, 3, 6], aug: [0, 4, 8], '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], '7sus4': [0, 5, 7, 10]
  };
  const SCALE = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 11] };   // min = armonik minör
  const VEL = { X: 1, x: 0.78, g: 0.32, h: 0.85, m: 0.85, l: 0.85 };
  const LANES = ['k', 's', 'c', 'h', 'o', 'j', 'r', 't'];
  const LANE_CH = { k: 'dr', t: 'dr', s: 'sn', c: 'sn', r: 'sn', h: 'hh', o: 'hh', j: 'hh' };

  const DR = {
    intro: { k: 'X.......X.......', h: '..x...x...x...x.' },
    pop: { k: 'X.....x.X.......', s: '....X.......X...', h: 'x.X.x.X.x.X.x.X.' },
    pop2: { k: 'X.....x.X.x.....', s: '....X.......X..g', c: '....x.......x...', h: 'xgxgxgxgxgxgxgx.', o: '..............x.' },
    half: { k: 'X.........x.....', s: '........X.......', h: 'x...x...x...x...' },
    candyI: { k: 'X.......X.......', h: 'xgxgxgxgxgxgxgxg' },
    candy: { k: 'X.....x...x.X...', c: '....X.......X...', h: 'xgxgxgxgxgxgxgxg', j: '..x...x...x...x.' },
    candy2: { k: 'X..x..x.X..x..x.', c: '....X.......X...', s: '....x.......x...', h: 'x...x...x...x...', o: '..x...x...x...x.' },
    snowI: { k: 'X...............', j: 'x.gxx.gxx.gxx.gx' },
    snow: { k: 'X.........X.....', s: '....X.......X...', j: 'xgxgxgxgxgxgxgxg' },
    snow2: { k: 'X.....x...X.....', s: '....X.......X...', j: 'x.xgx.xgx.xgx.xg', o: '......x.......x.' },
    castleI: { k: 'X...X...X...X...', h: 'x.x.x.x.x.x.x.x.' },
    drive: { k: 'X...X...X...X...', s: '....X.......X...', h: '..x...x...x...x.' },
    drive2: { k: 'X.x.X...X.x.X...', s: '....X.......X...', c: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
    lounge: { k: 'X......x..X.....', r: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', s: '.......g.......g' },
    lounge2: { k: 'X......x..X..x..', s: '....x.......x...', h: 'xgx.xgx.xgx.xgx.', o: '..............x.' },
    march: { k: 'X...X...X...X...', s: '....X.......X.gg', h: 'x.x.x.x.x.x.x.x.', c: '....x.......x...' }
  };
  const FILL = {
    snare: { k: '........X.......', s: '........x.x.xxXX', h: '................', o: '................', c: '................', j: '................' },
    tom: { k: '........X...X...', t: '........h.h.m.l.', s: '................', h: '................', o: '................', c: '................' },
    roll: { k: 'X...X...X...X...', s: 'x.x.x.x.xxxxxxxx', h: '................', o: '................', c: '................', j: '................', r: '................' }
  };
  const BS = {
    tres: 'R-.R-.O-R-.R-.5-',
    eights: 'R.R.O.R.R.R.O.5.',
    long: 'R-------5-------',
    bounce: 'R.O.R.O.R.O.5.OA',
    gallop: 'R.RRR.RRR.RRO.5A',
    snow: 'R-----5-O-----5-',
    walk: 'R-----5-O---..A-',
    podium: 'R.R.O.R.5.R.O.5.'
  };
  const CP = {
    off: '..x...x...x...x.',
    skank: 'x..x..x...x..x..',
    chug: 'x.x.x.x.x.x.x.x.',
    ep: 'X-----x---x-----'
  };
  // kanal: [ad, düzey, yankı, eko, pan]
  const CHN = [
    ['dr', 0.8, 0.05, 0, 0], ['sn', 1.3, 0.18, 0, 0], ['hh', 0.9, 0.06, 0, 0.22], ['bs', 0.42, 0, 0, 0],
    ['ld', 0.85, 0.2, 0.22, 0], ['hm', 1.0, 0.22, 0.12, 0.25], ['cp', 0.75, 0.15, 0, -0.2], ['pd', 0.32, 0.4, 0, 0],
    ['ar', 0.62, 0.2, 0.25, -0.25], ['or', 0.8, 0.35, 0.35, 0.15]
  ];

  const SONGS = {
    /* Çılgın Orman — Do majör, zıplayan pop-chiptune */
    forest: {
      bpm: 140, key: 0, swing: 0, lead: 'pulse', harm: 'p12', comp: 'stab', bass: 'chipbass', pad: 'pad', arp: 'pluckS', orn: 'bellS',
      kit: { kf: 155, kf2: 48, kd: 0.3 },
      form: ['I', 'A', 'B', 'A2', 'C'], loop: 1,
      sec: {
        I: { ch: 'C | G', dr: 'intro', bs: 'tres', pad: 1, fill: 'snare' },
        A: {
          ch: 'C | G | Am | F | C | G | F | G',
          mel: 'e5:2 g5:2 c6:3 g5:1 a5:2 g5:2 e5:4 | d5:2 g5:2 b5:3 a5:1 g5:2 d5:2 b4:4 | c5:2 e5:2 a5:3 g5:1 a5:2 b5:2 c6:4 | a5:2 g5:2 f5:2 e5:2 f5:4 r:4 | ' +
            'e5:2 g5:2 c6:3 g5:1 a5:2 g5:2 e5:2 c5:2 | d5:2 b4:2 d5:2 g5:2 f5:2 e5:2 d5:4 | c5:2 f5:2 a5:3 g5:1 f5:2 a5:2 c6:4 | b5:3 a5:1 g5:2 f5:2 d5:4 r:4',
          dr: 'pop', bs: 'tres', cp: 'off', pad: 1, crash: 1, fill: 'snare'
        },
        B: {
          ch: 'F | G | Em | Am | F | G | Am,F | Gsus4,G',
          mel: 'r:2 a4:2 c5:2 f5:2 r:2 e5:2 f5:2 a5:2 | g5:3 f5:3 d5:2 b4:4 r:4 | r:2 g4:2 b4:2 e5:2 r:2 d5:2 e5:2 g5:2 | a5:3 g5:3 e5:2 c5:4 r:4 | ' +
            'r:2 c6:2 a5:2 f5:2 r:2 c6:2 a5:2 f5:2 | g5:2 a5:2 b5:2 d6:2 b5:4 g5:4 | c6:4 b5:2 a5:2 a5:2 g5:2 f5:4 | c6:6 b5:2 d6:4 g5:4',
          lead: 'square', dr: 'pop2', bs: 'eights', cp: 'off', pad: 1, crash: 1, fill: 'tom'
        },
        A2: { from: 'A', harm: 1, dr: 'pop2', arp: 'up' },
        C: {
          ch: 'Am | F | C | G | Am | F | Dm | G',
          mel: 'e5:8 c5:4 e5:4 | f5:8 a5:4 c6:4 | g5:12 e5:4 | d5:8 b4:4 d5:4 | e5:8 a5:4 b5:4 | c6:8 a5:4 f5:4 | f5:8 a5:4 d6:4 | b5:4 g5:4 d5:4 b4:4',
          lead: 'bell', dr: 'half', bs: 'long', pad: 1, arp: 'ud', build: 1
        }
      }
    },
    /* Şeker Diyarı — Fa majör, hafif shuffle, oyuncak piyano */
    candy: {
      bpm: 150, key: 5, swing: 0.1, lead: 'bell', harm: 'mbox', comp: 'bubble', bass: 'chipbass', pad: 'pad', arp: 'bubbleS', orn: 'bellS',
      kit: { kf: 165, kf2: 55, kd: 0.22 },
      mix: { ld: 1.1, hm: 1.0 },
      form: ['I', 'A', 'B', 'A2', 'C'], loop: 1,
      sec: {
        I: { ch: 'F | C7', dr: 'candyI', bs: 'bounce', pad: 1, fill: 'snare' },
        A: {
          ch: 'F | Dm | Bb | C | F | Dm | Gm7,C7 | F',
          mel: 'c5:2 f5:2 a5:2 c6:2 a5:2 f5:2 g5:2 a5:2 | f5:2 d5:2 a4:2 d5:2 f5:4 e5:2 d5:2 | d5:2 f5:2 bb5:2 d6:2 c6:2 bb5:2 a5:2 bb5:2 | c6:4 g5:2 e5:2 c5:4 r:4 | ' +
            'c5:2 f5:2 a5:2 c6:2 f6:4 e6:2 c6:2 | d6:2 a5:2 f5:2 a5:2 d6:4 c6:4 | bb5:2 g5:2 d5:2 f5:2 e5:2 g5:2 bb5:2 c6:2 | a5:4 f5:2 c5:2 f5:4 r:4',
          dr: 'candy', bs: 'bounce', cp: 'off', pad: 1, crash: 1, fill: 'snare'
        },
        B: {
          ch: 'Bb | C | Am | Dm | Gm | C | F,Dm | Gm7,C7',
          mel: 'd6:3 c6:3 bb5:2 f5:4 d5:4 | e5:3 g5:3 c6:2 bb5:4 g5:4 | a5:3 c6:3 e6:2 c6:4 a5:4 | f5:3 a5:3 d6:2 a5:8 | ' +
            'bb5:3 a5:3 g5:2 d5:4 g5:4 | c6:3 bb5:3 g5:2 e5:4 c5:4 | a5:4 c6:4 d6:4 f6:4 | f6:2 e6:2 d6:2 c6:2 bb5:2 g5:2 e5:2 c5:2',
          lead: 'pulse', dr: 'candy2', bs: 'eights', cp: 'skank', pad: 1, crash: 1, fill: 'tom'
        },
        A2: { from: 'A', harm: 1, dr: 'candy2', arp: 'up' },
        C: {
          ch: 'Dm | Bb | F | C | Dm | Bb | Gm | C7',
          mel: 'a5:6 f5:2 d5:8 | bb5:6 f5:2 d5:8 | c6:6 a5:2 f5:8 | g5:6 e5:2 c5:8 | d6:6 a5:2 f5:8 | f6:6 d6:2 bb5:8 | g5:4 bb5:4 d6:4 g6:4 | e6:4 c6:4 bb5:4 g5:4',
          lead: 'mbox', dr: 'half', bs: 'long', pad: 1, arp: 'ud', build: 1
        }
      }
    },
    /* Karlı Zirve — Re majör, kızak zilleri, celesta, geniş yankı */
    snow: {
      bpm: 132, key: 2, swing: 0, lead: 'celesta', harm: 'mbox', comp: 'pluck', bass: 'roundbass', pad: 'pad', arp: 'pluckS', orn: 'bellS', verb: 1.5,
      kit: { kf: 140, kf2: 45, kd: 0.34, jingle: 1 },
      mix: { ld: 1.45, ar: 1.1 },
      form: ['I', 'A', 'B', 'A2', 'C'], loop: 1,
      sec: {
        I: { ch: 'D | A', dr: 'snowI', bs: 'snow', pad: 1, arp: 'up', fill: 'snare' },
        A: {
          ch: 'D | Bm | Em7 | A | D | Bm | G | A7',
          mel: 'f#5:2 a5:2 d6:4 c#6:2 a5:2 f#5:4 | d5:2 f#5:2 b5:4 a5:2 f#5:2 d5:4 | e5:2 g5:2 b5:2 d6:2 e6:4 d6:2 b5:2 | c#6:4 a5:4 e5:8 | ' +
            'f#5:2 a5:2 d6:4 e6:2 f#6:2 e6:2 d6:2 | d6:4 b5:2 a5:2 f#5:4 d5:4 | g5:2 b5:2 d6:2 g6:2 f#6:2 e6:2 d6:2 b5:2 | a5:2 c#6:2 e6:2 g6:2 e6:4 c#6:4',
          dr: 'snow', bs: 'snow', pad: 1, arp: 'up', crash: 1, fill: 'snare'
        },
        B: {
          ch: 'G | A | F#m | Bm | Em | A | D,Bm | Em7,A7',
          mel: 'b5:6 a5:2 g5:4 d5:4 | c#6:6 b5:2 a5:4 e5:4 | c#6:6 b5:2 a5:4 f#5:4 | d6:6 c#6:2 b5:4 f#5:4 | ' +
            'g5:2 b5:2 e6:4 d6:2 b5:2 g5:4 | a5:2 c#6:2 e6:4 f#6:2 e6:2 c#6:4 | d6:4 f#6:4 f#6:2 e6:2 d6:4 | e6:2 d6:2 b5:2 g5:2 a5:2 c#6:2 e6:2 g6:2',
          lead: 'pulse', dr: 'snow2', bs: 'eights', cp: 'off', pad: 1, crash: 1, fill: 'tom'
        },
        A2: { from: 'A', harm: 1, dr: 'snow2', arp: 'ud' },
        C: {
          ch: 'Bm | G | D | A | Bm | G | Em | A',
          mel: 'f#5:4 d5:4 b4:8 | g5:4 d5:4 b4:8 | a5:4 f#5:4 d5:8 | e5:4 c#5:4 a4:8 | d5:2 f#5:2 b5:4 a5:4 f#5:4 | g5:2 d5:2 b4:4 d5:8 | e5:4 g5:4 b5:4 g5:4 | a5:8 e5:4 c#5:4',
          lead: 'mbox', dr: 'half', bs: 'long', pad: 1, arp: 'ud', build: 1
        }
      }
    },
    /* Gün Batımı Kalesi — Re minör (armonik), dörtnala bas, kahramanca */
    castle: {
      bpm: 144, key: 2, minor: 1, swing: 0, lead: 'square', harm: 'p12', comp: 'stab', bass: 'sawbass', pad: 'pad', arp: 'harpsi', orn: 'bellS',
      kit: { kf: 150, kf2: 42, kd: 0.3 },
      mix: { cp: 0.7 },
      form: ['I', 'A', 'B', 'A2', 'C'], loop: 1,
      sec: {
        I: { ch: 'Dm | A', dr: 'castleI', bs: 'gallop', pad: 1, fill: 'tom' },
        A: {
          ch: 'Dm | Bb | C | A | Dm | Bb | Gm,A | Dm',
          mel: 'd5:2 d5:1 e5:1 f5:2 a5:2 d6:4 c6:2 a5:2 | bb5:4 a5:2 g5:2 f5:2 d5:2 f5:4 | e5:2 e5:1 f5:1 g5:2 c6:2 e6:4 d6:2 c6:2 | c#6:4 a5:2 e5:2 c#5:4 a4:4 | ' +
            'd5:2 d5:1 e5:1 f5:2 a5:2 d6:4 e6:2 f6:2 | d6:4 bb5:2 f5:2 bb5:4 d6:4 | g5:2 bb5:2 d6:2 bb5:2 a5:2 c#6:2 e6:2 c#6:2 | d6:6 a5:2 d5:4 r:4',
          dr: 'drive', bs: 'gallop', cp: 'chug', pad: 1, crash: 1, fill: 'tom'
        },
        B: {
          ch: 'F | C | Dm | Bb | Gm | Dm | Bb,C | A',
          mel: 'a5:6 c6:2 f6:4 e6:2 c6:2 | e6:6 d6:2 c6:4 g5:4 | f5:2 a5:2 d6:4 c6:2 a5:2 f5:4 | bb5:6 a5:2 f5:4 d5:4 | ' +
            'g5:2 bb5:2 d6:4 g6:4 f6:4 | f6:4 e6:2 d6:2 a5:4 f5:4 | d6:4 f6:4 e6:4 g6:4 | e6:6 c#6:2 a5:8',
          lead: 'brass', dr: 'drive2', bs: 'eights', cp: 'chug', pad: 1, crash: 1, fill: 'snare'
        },
        A2: { from: 'A', harm: 1, dr: 'drive2', arp: 'up' },
        C: {
          ch: 'Gm | Dm | Bb | A | Gm | Dm | Eb | A',
          mel: 'd5:8 bb4:8 | f5:8 d5:8 | f5:8 bb5:8 | a5:8 e5:8 | g5:8 bb5:8 | a5:8 f5:8 | g5:8 bb5:8 | a5:4 c#6:4 e6:8',
          lead: 'brass', dr: 'half', bs: 'long', pad: 1, arp: 'ud', build: 1
        }
      }
    },
    /* Menü — Sol majör, rahat lounge-pop, elektrik piyano */
    menu: {
      bpm: 116, key: 7, swing: 0.14, lead: 'mallet', harm: 'bellS', comp: 'ep', bass: 'roundbass', pad: 'pad', arp: 'pluckS', orn: 'bellS',
      kit: { kf: 130, kf2: 45, kd: 0.3 },
      mix: { ld: 1.5, hm: 0.9, cp: 1.0 },
      form: ['A', 'B', 'A2', 'C'], loop: 0,
      sec: {
        A: {
          ch: 'Gmaj7 | Em7 | Cmaj7 | D7 | Gmaj7 | Em7 | Am7,D7 | Gmaj7',
          mel: 'b4:2 d5:2 f#5:3 g5:1 f#5:2 d5:2 b4:4 | r:2 e5:2 g5:2 b5:2 a5:3 g5:1 e5:4 | r:2 c5:2 e5:2 g5:2 b5:4 a5:2 g5:2 | a5:3 f#5:3 d5:2 c5:4 r:4 | ' +
            'b4:2 d5:2 f#5:3 g5:1 a5:2 b5:2 d6:4 | b5:3 a5:3 g5:2 e5:4 r:4 | c6:2 b5:2 a5:2 e5:2 f#5:2 a5:2 c6:2 a5:2 | b5:6 a5:2 g5:8',
          dr: 'lounge', bs: 'walk', cp: 'ep', pad: 1, fill: 'snare'
        },
        B: {
          ch: 'Cmaj7 | Bm7 | Am7 | D7 | Cmaj7 | Bm7 | Am7 | D7',
          mel: 'e5:2 g5:2 b5:4 c6:2 b5:2 g5:4 | f#5:2 a5:2 b5:4 a5:2 f#5:2 d5:4 | c5:2 e5:2 g5:4 a5:2 c6:2 e6:4 | d6:3 c6:3 a5:2 f#5:8 | ' +
            'g5:2 b5:2 e6:4 d6:2 b5:2 g5:4 | f#5:2 b5:2 d6:4 a5:4 f#5:4 | e5:2 a5:2 c6:2 e6:2 d6:4 c6:4 | a5:2 b5:2 c6:2 d6:2 c6:4 a5:4',
          dr: 'lounge2', bs: 'walk', cp: 'ep', pad: 1, fill: 'tom'
        },
        A2: { from: 'A', harm: 1, arp: 'up', dr: 'lounge2' },
        C: {
          ch: 'Em7 | Cmaj7 | G | D | Em7 | Cmaj7 | Am7 | D7',
          mel: 'b5:8 g5:8 | e5:8 g5:8 | d6:8 b5:8 | a5:12 f#5:4 | g5:4 b5:4 d6:8 | e6:8 b5:8 | c6:4 a5:4 e5:8 | f#5:4 a5:4 c6:4 d6:4',
          lead: 'celesta', dr: 'half', bs: 'long', pad: 1, arp: 'ud', fill: 'snare'
        }
      }
    },
    /* Kürsü — Do majör, kutlama döngüsü */
    podium: {
      bpm: 126, key: 0, swing: 0, lead: 'pulse', harm: 'bell', comp: 'stab', bass: 'chipbass', pad: 'pad', arp: 'pluckS', orn: 'bellS',
      kit: { kf: 150, kf2: 46, kd: 0.3 },
      form: ['A', 'A2'], loop: 0,
      sec: {
        A: {
          ch: 'C | F | G | C | Am | F | G | C',
          mel: 'c5:2 e5:2 g5:2 c6:6 g5:2 e5:2 | a5:2 c6:2 f5:2 a5:6 c6:4 | b5:2 d6:2 g5:2 b5:6 a5:2 g5:2 | c6:6 g5:2 e5:4 g5:4 | ' +
            'a5:2 c6:2 e6:2 c6:6 b5:2 a5:2 | f5:2 a5:2 c6:2 a5:6 g5:2 f5:2 | g5:2 b5:2 d6:2 f6:4 e6:2 d6:4 | e6:4 c6:4 g5:4 r:4',
          dr: 'march', bs: 'podium', cp: 'off', pad: 1, crash: 1, fill: 'snare'
        },
        A2: { from: 'A', harm: 1, arp: 'up', lead: 'bell', harmI: 'p12' }
      }
    }
  };

  /* ---------- müzik: derleme ---------- */
  function parseChord(s) {
    const m = /^([A-G])(#|b)?([a-z0-9]*)(?:\/([A-G])(#|b)?)?$/.exec(String(s).trim());
    if (!m) return null;
    const root = (NOTE_PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    const iv = QUAL[m[3]];
    if (!iv) return null;
    const pcs = [];
    for (const i of iv) { const pc = (root + i) % 12; if (!pcs.includes(pc)) pcs.push(pc); }
    const bass = m[4] ? (NOTE_PC[m[4].toLowerCase()] + (m[5] === '#' ? 1 : m[5] === 'b' ? -1 : 0) + 12) % 12 : null;
    return { root, iv, pcs, bass, name: s };
  }
  function parseMel(str, nb, problems, where) {
    const bars = String(str).split('|');
    if (bars.length !== nb) problems.push(where + ': melodi ' + bars.length + ' ölçü, akor ' + nb);
    const out = [];
    for (let i = 0; i < nb; i++) {
      const ev = new Array(16).fill(null);
      let pos = 0, lastEnd = 0, lastStart = -1;
      const toks = (bars[i] || '').trim().split(/\s+/).filter(Boolean);
      for (const tk of toks) {
        const parts = tk.split(':'), n = parts[0], d = Math.max(1, parseInt(parts[1], 10) || 1);
        if (n !== 'r') {
          const m = n2m(n);
          if (m == null) problems.push(where + ' ölçü ' + (i + 1) + ': nota okunamadı ' + tk);
          else if (pos < 16) { ev[pos] = { m, d: Math.min(d, 16 - pos) }; lastStart = pos; lastEnd = pos + d; }
        }
        pos += d;
      }
      if (pos !== 16) problems.push(where + ' ölçü ' + (i + 1) + ': toplam ' + pos + ' (16 olmalı)');
      ev.free = lastStart < 12 && lastEnd <= 12;      // ölçü sonu boş → süs eklenebilir
      out.push(ev);
    }
    return out;
  }
  function compile(def) {
    if (def._c) return def._c;
    const problems = [];
    const sec = {};
    for (const k in def.sec) {
      let s = def.sec[k];
      if (s.from) s = Object.assign({}, def.sec[s.from], s);
      const bars = String(s.ch).split('|').map(x => x.trim()).filter(Boolean);
      const chords = bars.map((bs, bi) => {
        const parts = bs.split(',').map(x => x.trim()).filter(Boolean);
        return parts.map((p, i) => {
          let c = parseChord(p);
          if (!c) { problems.push(k + ' ölçü ' + (bi + 1) + ': akor okunamadı ' + p); c = parseChord('C'); }
          return { st: Math.round(i * 16 / parts.length), c };
        });
      });
      const nb = chords.length;
      const mel = s.mel ? parseMel(s.mel, nb, problems, k) : null;
      for (const lane of ['dr']) if (s[lane] && !DR[s[lane]]) problems.push(k + ': davul deseni yok ' + s[lane]);
      if (s.bs && !BS[s.bs]) problems.push(k + ': bas deseni yok ' + s.bs);
      if (s.cp && !CP[s.cp]) problems.push(k + ': eşlik deseni yok ' + s.cp);
      if (s.fill && !FILL[s.fill]) problems.push(k + ': geçiş yok ' + s.fill);
      for (const ik of ['lead', 'harmI', 'compI', 'bassI', 'arpI']) if (s[ik] && !INS[s[ik]]) problems.push(k + ': enstrüman yok ' + s[ik]);
      sec[k] = { nb, chords, mel, dr: s.dr, bs: s.bs, cp: s.cp, pad: !!s.pad, arp: s.arp || null, harm: !!s.harm, crash: !!s.crash, fill: s.fill || null, build: !!s.build, lead: s.lead, harmI: s.harmI, compI: s.compI, bassI: s.bassI, arpI: s.arpI };
    }
    for (const f of def.form) if (!sec[f]) problems.push('form: bölüm yok ' + f);
    for (const ik of ['lead', 'harm', 'comp', 'bass', 'pad', 'arp', 'orn']) if (def[ik] && !INS[def[ik]]) problems.push('enstrüman yok ' + def[ik]);
    def._c = { sec, form: def.form, loop: clamp(def.loop | 0, 0, def.form.length - 1), problems };
    return def._c;
  }

  /* ---------- müzik: armoni yardımcıları ---------- */
  const pcOf = m => ((m % 12) + 12) % 12;
  function voicing(c, prev) {
    const pcs = c.pcs.slice(0, 4);
    const LO = 55, HI = 77;
    const pc0 = prev && prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 64;
    let best = null, bs = 1e9;
    for (let r = 0; r < pcs.length; r++) {
      const order = pcs.slice(r).concat(pcs.slice(0, r));
      const notes = [LO + pcOf(order[0] - LO)];
      for (let i = 1; i < order.length; i++) { let n = notes[i - 1] + pcOf(order[i] - notes[i - 1]); if (n === notes[i - 1]) n += 12; notes.push(n); }
      if (notes[notes.length - 1] > HI) continue;
      const cen = notes.reduce((a, b) => a + b, 0) / notes.length;
      const sc = Math.abs(cen - pc0) + (notes[notes.length - 1] - notes[0]) * 0.05;
      if (sc < bs) { bs = sc; best = notes; }
    }
    if (!best) { best = []; for (const pc of pcs) best.push(60 + pcOf(pc - 60)); best.sort((a, b) => a - b); }
    return best;
  }
  function bassNote(c, tok, nxt) {
    const LO = 40;                                          // Mi2: telefonda da duyulsun
    const rootPc = c.bass != null ? c.bass : c.root;
    const r = LO + pcOf(rootPc - LO);
    switch (tok) {
      case 'O': return r + 12;
      case '5': return r + (c.iv.includes(7) ? 7 : c.iv.includes(6) ? 6 : c.iv.includes(8) ? 8 : 7);
      case '3': return r + (c.iv.includes(4) ? 4 : c.iv.includes(3) ? 3 : 5);
      case '7': return r + (c.iv.includes(11) ? 11 : 10);
      case 'A': {
        const npc = nxt ? (nxt.bass != null ? nxt.bass : nxt.root) : rootPc;
        const nr = LO + pcOf(npc - LO);
        if (nr === r) return r + 7;
        return nr > r ? nr - 1 : nr + 1;
      }
      default: return r;
    }
  }
  function harmNote(m, c, key, minor) {
    for (let iv = 3; iv <= 5; iv++) if (c.pcs.includes(pcOf(m - iv))) return m - iv;
    const sc = minor ? SCALE.min : SCALE.maj;
    for (let iv = 3; iv <= 4; iv++) if (sc.includes(pcOf(m - iv - key))) return m - iv;
    return m - 3;
  }
  function chordAt(sec, b, st) { const arr = sec.chords[b]; let c = arr[0]; for (const x of arr) if (x.st <= st) c = x; return c; }
  function nextChangeStep(sec, b, st) { for (const x of sec.chords[b]) if (x.st > st) return x.st; return 16; }
  function peekNextBarChord(s) {
    const c = s.c, sec = c.sec[c.form[s.fi]];
    if (s.bar + 1 < sec.nb) return sec.chords[s.bar + 1][0].c;
    let fi = s.fi + 1; if (fi >= c.form.length) fi = c.loop;
    return c.sec[c.form[fi]].chords[0][0].c;
  }

  /* ---------- müzik: şarkı nesnesi ---------- */
  function makeSong(id) {
    const def = SONGS[id], c = compile(def), e = E, ac = e.ac;
    const s = { id, def, c, fi: 0, bar: 0, step: 0, next: 0, sd: 60 / def.bpm / 4, ch: {}, nodes: [], voi: null, chCur: null, stopping: false, end: Infinity, loops: 0 };
    s.fade = e.G(0, e.musicIn); s.fadeV = e.G(0, e.musicVerbIn); s.fadeD = e.G(0, e.dlyIn);
    s.nodes.push(s.fade, s.fadeV, s.fadeD);
    const vm = num(def.verb, 1), mix = def.mix || {};
    for (const [name, lvl, verb, dly, pan] of CHN) {
      const g = e.G(lvl * num(mix[name], 1));
      s.nodes.push(g);
      if (pan && e.hasPan) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(s.fade); s.nodes.push(p); }
      else g.connect(s.fade);
      if (verb) { const sv = e.G(Math.min(0.9, verb * vm)); g.connect(sv); sv.connect(s.fadeV); s.nodes.push(sv); }
      if (dly) { const sd = e.G(dly); g.connect(sd); sd.connect(s.fadeD); s.nodes.push(sd); }
      s.ch[name] = g;
    }
    return s;
  }
  function advance(s) {
    s.next += s.sd;
    if (++s.step >= 16) {
      s.step = 0;
      const sec = s.c.sec[s.c.form[s.fi]];
      if (++s.bar >= sec.nb) { s.bar = 0; if (++s.fi >= s.c.form.length) { s.fi = s.c.loop; s.loops++; } }
    }
  }
  function schedStep(s, time) {
    const c = s.c, def = s.def, sd = s.sd;
    const sec = c.sec[c.form[s.fi]], b = s.bar, st = s.step;
    const chE = chordAt(sec, b, st);
    if (chE !== s.chCur) { s.chCur = chE; s.voi = voicing(chE.c, s.voi); }
    if (E.mv <= 0 && !E.offline) return;              // müzik kapalı: zaman ilerler, nota üretme
    const t = time + ((st & 1) ? num(def.swing, 0) * sd : 0);
    const ch = chE.c, kit = def.kit || KIT0, lastBar = b === sec.nb - 1;
    // —— davul
    const pat = DR[sec.dr];
    if (pat) {
      const fill = lastBar ? (sec.build ? FILL.roll : sec.fill ? FILL[sec.fill] : null) : null;
      const fillOn = fill && (fill === FILL.roll || st >= 8);
      for (const lane of LANES) {
        let str = pat[lane], vm = 1;
        if (fillOn && fill[lane] !== undefined) {
          str = fill[lane];
          if (fill === FILL.roll) vm = 0.3 + 0.7 * st / 15;
          else if (lane === 's' || lane === 't') vm = 0.6 + 0.4 * (st - 8) / 7;
        }
        if (!str) continue;
        const chr = str[st], vel = VEL[chr];
        if (!vel) continue;
        const dst = s.ch[LANE_CH[lane]];
        const hv = lane === 'h' || lane === 'j' ? vel * rnd(0.85, 1.05) : vel;
        if (lane === 't') DRUM.t(dst, t, hv * vm, kit, chr); else DRUM[lane](dst, t, hv * vm, kit);
      }
      if (sec.crash && b === 0 && st === 0) DRUM.crash(s.ch.hh, t, 0.8);
      if (sec.build && lastBar && st === 0) DRUM.riser(s.ch.hh, t, sd * 16, 1);
    }
    // —— bas
    const bp = BS[sec.bs];
    if (bp) {
      const chr = bp[st];
      if (chr && chr !== '-' && chr !== '.') {
        let len = 1; while (st + len < 16 && bp[st + len] === '-') len++;
        const m = bassNote(ch, chr, chr === 'A' ? peekNextBarChord(s) : null);
        const v = (chr === 'r' ? 0.6 : 1) * (st % 4 === 0 ? 0.95 : 0.8);
        (INS[sec.bassI || def.bass] || INS.chipbass)(s.ch.bs, t, mtof(m), len * sd * 0.9, v);
      }
    }
    // —— eşlik akorları
    const cp = sec.cp && CP[sec.cp];
    if (cp) {
      const chr = cp[st];
      if (chr === 'x' || chr === 'X') {
        let len = 1; while (st + len < 16 && cp[st + len] === '-') len++;
        const fn = INS[sec.compI || def.comp] || INS.stab, v = (chr === 'X' ? 1 : 0.8) * (2.2 / Math.max(2, s.voi.length));
        for (const m of s.voi) fn(s.ch.cp, t, mtof(m), len * sd * 0.9, v * 0.5);
      }
    }
    // —— pad (akor değişiminde, bir sonraki değişime kadar)
    if (sec.pad && chE.st === st) {
      const dur = (nextChangeStep(sec, b, st) - st) * sd;
      const fn = INS[def.pad] || INS.pad;
      for (const m of s.voi) fn(s.ch.pd, t, mtof(m), dur, 0.12);
    }
    // —— arpej
    if (sec.arp) {
      const vo = s.voi, up = vo.concat([vo[0] + 12]);
      const seq = sec.arp === 'ud' ? up.concat(vo.slice(1).reverse()) : up;   // yukarı / yukarı-aşağı
      const m = seq[st % seq.length] + 12;
      (INS[sec.arpI || def.arp] || INS.pluckS)(s.ch.ar, t, mtof(m), sd * 0.9, st % 4 === 0 ? 0.5 : 0.32);
    }
    // —— melodi (+ armoni)
    if (sec.mel) {
      const ev = sec.mel[b][st];
      if (ev) {
        const dur = ev.d * sd * 0.94, v = st % 4 === 0 ? 0.5 : 0.43;
        (INS[sec.lead || def.lead] || INS.pulse)(s.ch.ld, t, mtof(ev.m), dur, v);
        if (sec.harm) (INS[sec.harmI || def.harm] || INS.p12)(s.ch.hm, t, mtof(harmNote(ev.m, ch, def.key | 0, !!def.minor)), dur, v * 0.75);
      }
      // —— süs: 4. ve 8. ölçünün boş son vuruşunda yükselen çan parıltısı
      if (def.orn && (b % 4 === 3) && st >= 12 && sec.mel[b].free) {
        const vo = s.voi; let m = vo[(st - 12) % vo.length] + 24; while (m > 91) m -= 12;
        (INS[def.orn] || INS.bellS)(s.ch.or, t, mtof(m), sd, 0.16 + (st - 12) * 0.05);
      }
    }
  }
  function fadeTo(s, v, dur, at) {
    const t0 = Math.max(E.ac.currentTime, at || 0);
    for (const g of [s.fade, s.fadeV, s.fadeD]) {
      const p = g.gain;
      p.cancelScheduledValues(t0); p.setValueAtTime(p.value, t0); p.linearRampToValueAtTime(v, t0 + Math.max(0.02, dur));
    }
  }
  function startSong(id, delay, fadeIn, skipSteps) {
    const s = makeSong(id), now = E.ac.currentTime;
    for (let i = 0; i < (skipSteps | 0); i++) advance(s);
    s.next = now + 0.05 + Math.max(0, delay || 0);
    for (const g of [s.fade, s.fadeV, s.fadeD]) {
      const p = g.gain; p.setValueAtTime(0, now); p.setValueAtTime(0, s.next - 0.01); p.linearRampToValueAtTime(1, s.next + Math.max(0.03, fadeIn || 0.3));
    }
    try { E.dly.delayTime.setTargetAtTime(Math.min(1.5, s.sd * 3), s.next, 0.05); } catch (er) { }
    E.songs.push(s);
    return s;
  }
  function stopSong(s, fadeOut) {
    if (s.stopping) return;
    s.stopping = true;
    fadeTo(s, 0, Math.max(0.05, fadeOut));
    s.end = E.ac.currentTime + Math.max(0.05, fadeOut) + 0.15;
  }
  function disposeSong(s) {
    for (const n of s.nodes) { try { n.disconnect(); } catch (er) { } }
    s.nodes.length = 0;
  }

  /* ---------- müzik: istek → uygulama ---------- */
  let want = null, wantOpts = null, dirty = false;
  function normId(id) {
    if (id == null || id === false || id === '') return null;
    if (typeof id === 'number') { const th = FM.THEMES && FM.THEMES[((id % FM.THEMES.length) + FM.THEMES.length) % FM.THEMES.length]; return th ? th.id : 'forest'; }
    if (typeof id === 'object') return id.id && hasOwn(SONGS, id.id) ? id.id : null;
    id = String(id);
    if (hasOwn(SONGS, id)) return id;
    const n = +id; if (isFinite(n) && FM.THEMES) return normId(n);
    return null;
  }
  function music(id, opts) {
    try {
      want = normId(id); wantOpts = opts || {}; dirty = true;
      if (live()) { const saved = E; E = LIVE; try { applyMusic(); } finally { E = saved; } }
    } catch (e) { fail(e); }
  }
  function applyMusic() {
    dirty = false;
    const o = wantOpts || {}; wantOpts = null;
    const cur = E.cur;
    if (cur && !cur.stopping && cur.id === want && !o.restart) { fadeTo(cur, 1, 0.4); return; }
    if (cur) stopSong(cur, num(o.fadeOut, 0.9));
    E.cur = null;
    if (want && hasOwn(SONGS, want)) {
      let delay = num(o.delay, 0), skip = 0;
      if (o.goIn != null) {                              // giriş bitip A bölümü tam "KOŞ!" anında başlasın
        const sd = 60 / SONGS[want].bpm / 4, c = compile(SONGS[want]);
        const introSteps = c.form[0] === 'I' ? c.sec.I.nb * 16 : 0;
        const lead = num(o.goIn, 0) - 0.05 - introSteps * sd;
        if (lead >= 0) delay = Math.min(3, lead);
        else skip = Math.min(introSteps, Math.round(-lead / sd));
      }
      E.cur = startSong(want, delay, num(o.fade, 0.35), skip);
    }
    // aynı anda en fazla 3 şarkı (hızlı geçişlerde eskiler hemen sönsün)
    while (E.songs.length > 3) { const s = E.songs.shift(); disposeSong(s); }
  }

  /* =====================================================================
     ZAMANLAYICI (lookahead): setInterval 25 ms + AudioContext saat çizelgesi
     ===================================================================== */
  const LOOK = 0.15;
  let timer = null;
  function startTimer() { if (!timer) timer = setInterval(tick, 25); }
  function tick() {
    const e = LIVE;
    if (!e || disabled) return;
    const saved = E; E = e;
    try {
      const ac = e.ac;
      if (ac.state !== 'running') return;
      const now = ac.currentTime;
      if (now - e.volT > 0.2) { e.volT = now; syncVol(); }
      const paused = !!(FM.S && FM.S.paused);
      if (paused !== e.paused) {
        e.paused = paused;
        glide(e, e.musicLP.frequency, paused ? 750 : 20000, 0.08);
        glide(e, e.musicPause.gain, paused ? 0.45 : 1, 0.1);
        glide(e, e.musicVerbPause.gain, paused ? 0.45 : 1, 0.1);
      }
      if (dirty) applyMusic();
      for (let i = e.songs.length - 1; i >= 0; i--) {
        const s = e.songs[i];
        if (s.stopping && now > s.end) { disposeSong(s); e.songs.splice(i, 1); if (e.cur === s) e.cur = null; continue; }
        if (s.next < now - 0.2) s.next = now + 0.03;   // sekme gizlenip geri gelindi vb. → toparla, sel yapma
        let guard = 0;
        while (s.next < now + LOOK && guard++ < 48) { schedStep(s, s.next); advance(s); }
      }
      prune(e, now);
    } catch (er) { fail(er); }
    finally { E = saved; }
  }

  /* =====================================================================
     KİLİT AÇMA (tarayıcılar sesi ancak kullanıcı etkileşiminden sonra başlatır)
     ===================================================================== */
  function unlock() {
    if (disabled) return false;
    try {
      if (!LIVE) {
        let ac;
        try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { ac = new AC(); }
        const saved = E;
        try { LIVE = build(ac, false); E = LIVE; applyVol(LIVE, true); } finally { E = saved; }
        startTimer();
      }
      unlocked = true;
      const ac = LIVE.ac;
      if (ac.state !== 'running' && ac.resume) {
        resumeT = nowMs();
        const pr = ac.resume();
        if (pr && pr.then) pr.then(() => { dirty = dirty || !!want; }, () => { });
      }
      // iOS: sessiz tek örnek çal → çıkış açılır. Buraya yalnızca geçerli bir etkileşimde gelinir (bkz. canStart);
      // bağlam hâlâ çalışmıyorsa (iOS 'interrupted', arka plandan dönüş) sonraki geçerli dokunuşta yeniden dene.
      if (!LIVE.primed || ac.state !== 'running') {
        LIVE.primed = true;
        const b = ac.createBuffer(1, 1, ac.sampleRate), s = ac.createBufferSource();
        s.buffer = b; s.connect(ac.destination); s.start(0);
      }
      if (want && !LIVE.cur) dirty = true;
      return true;
    } catch (e) {
      disabled = true; fail(e);
      return false;
    }
  }
  /* Bu an tarayıcı için gerçek bir "kullanıcı etkinleştirmesi" mi?
     Dokunmatikte touchstart ve pointerdown(touch) etkinleştirme SAYILMAZ (etkinleştirme pointerup/touchend'de oluşur).
     Ses bağlamı orada açılmaya çalışılırsa Chrome 'AudioContext was not allowed to start' uyarıları basar,
     iOS'un sessiz-örnek 'prime'ı da boşa harcanır. e yoksa (FM.audio.unlock() doğrudan çağrıldı) yapışkan
     etkinleştirme de yeter (Chrome bağlamı buna göre açar). */
  function canStart(e) {
    let ua = null;
    try { ua = W.navigator && W.navigator.userActivation || null; } catch (_) { }
    if (ua && typeof ua.isActive === 'boolean') return e ? ua.isActive : (ua.isActive || !!ua.hasBeenActive);
    if (!e || !e.type) return true;                     // API yok (eski tarayıcı) + doğrudan çağrı: eski davranış
    if (e.type === 'touchstart') return false;
    if (e.type === 'pointerdown' && e.pointerType && e.pointerType !== 'mouse') return false;
    return true;
  }
  function gesture(e) {
    if (disabled) return;
    if (LIVE && unlocked && LIVE.ac.state === 'running') return;
    if (!canStart(e)) return;                           // dokunuşun başı: bekle → aynı dokunuşun pointerup/touchend/click'inde açılır
    unlock();
  }
  try {
    const opt = { capture: true, passive: true };
    // pointerup da dinlenir: dokunmatikte etkinleştirme orada oluşur; sonraki bir dinleyici (ör. tam ekran isteği)
    // geçici etkinleştirmeyi tüketse bile ses ondan önce (pencere/yakalama aşaması) açılmış olur.
    for (const ev of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click']) W.addEventListener(ev, gesture, opt);
    document.addEventListener('visibilitychange', () => {
      if (!LIVE) return;
      try {
        if (document.hidden) { const p = LIVE.ac.suspend && LIVE.ac.suspend(); if (p && p.catch) p.catch(() => { }); }
        else if (unlocked) { const p = LIVE.ac.resume && LIVE.ac.resume(); if (p && p.catch) p.catch(() => { }); }
      } catch (e) { }
    });
  } catch (e) { fail(e); }

  /* =====================================================================
     ARAYÜZ: otomatik tık / üzerine gelme sesi
     ===================================================================== */
  const UI_SEL = 'button, .btn, [data-sfx], [role="button"], a[href], select, input[type="checkbox"], input[type="radio"]';
  function uiTarget(el) {
    if (!el || !el.closest) return null;
    const b = el.closest(UI_SEL);
    if (!b) return null;
    const root = document.getElementById('ui');
    if (root && !root.contains(b)) return null;
    if (b.disabled || b.getAttribute('aria-disabled') === 'true') return null;
    return b;
  }
  function inGameplay() { const S = FM.S, m = S && S.mode; return (m === 'race' || m === 'count' || m === 'end') && !S.paused; }
  let hoverEl = null;
  try {
    document.addEventListener('click', ev => {
      if (inGameplay()) return;
      const b = uiTarget(ev.target); if (!b) return;
      const s = b.getAttribute('data-sfx');
      if (s === 'none' || s === '0' || s === 'off') return;
      play(s && (hasOwn(SFX, s) || hasOwn(ALIAS, s)) ? s : 'click', { exact: true });
    }, true);
    document.addEventListener('pointerover', ev => {
      if (ev.pointerType && ev.pointerType !== 'mouse') return;
      if (inGameplay()) return;
      const b = uiTarget(ev.target);
      if (b === hoverEl) return;
      hoverEl = b;
      if (b && b.getAttribute('data-sfx') !== 'none') play('hover', { exact: true });
    }, true);
  } catch (e) { fail(e); }

  /* =====================================================================
     OYUN OLAYLARI
     ===================================================================== */
  const isP = r => !!r && r === FM.S.player;
  const demo = () => FM.S.mode === 'demo';
  function hook(ev, fn) { FM.on(ev, d => { if (!live()) return; try { fn(d || {}); } catch (e) { fail(e); } }); }
  const HIT_SND = { stun: 'stun', freeze: 'freeze', net: 'zap', knock: 'knock', slow: 'slowed', pull: 'pulled', ink: 'splat' };
  const LIQ = { water: 1, chocolate: 1, icewater: 1, lava: 1 };
  let combo = 0, lastCoin = -9, climbT = 0, climbAlt = false, lastTick = null, goPlayed = false;

  hook('jump', d => play(d.dbl ? 'jump2' : 'jump', { r: d.r, vol: isP(d.r) ? 1 : 0.5 }));
  hook('land', d => {
    const r = d.r; if (!r || r.slam) return;
    if (isP(r)) play(d.hard ? 'landHard' : 'land', { r });
    else if (d.hard) play('landHard', { r, vol: 0.4 });
  });
  hook('slide', d => play('slide', { r: d.r, vol: isP(d.r) ? 1 : 0.45 }));
  hook('slam', d => play('slam', { r: d.r, vol: isP(d.r) ? 1 : 0.45 }));
  hook('slamLand', d => play('slamLand', { r: d.r, vol: isP(d.r) ? 1 : 0.5 }));
  hook('climb', d => { if (isP(d.r)) { play('climb', { r: d.r }); climbT = 0.12; } });
  hook('vault', d => play('vault', { r: d.r, vol: isP(d.r) ? 0.8 : 0.3 }));
  hook('flap', d => play('flap', { r: d.r, vol: isP(d.r) ? 1 : 0.5 }));
  hook('pad', d => play('pad', { r: d.r, vol: isP(d.r) ? 1 : 0.45 }));
  hook('mush', d => play('mush', { r: d.r, vol: isP(d.r) ? 1 : 0.5 }));
  hook('box', d => play('box', isP(d.r) ? { r: d.r, got: !!d.item } : { r: d.r, vol: 0.35, got: false }));
  hook('coin', d => {
    if (!isP(d.r) || demo()) return;
    const now = LIVE.ac.currentTime;
    combo = now - lastCoin < 0.7 ? Math.min(combo + 1, COIN_STEPS.length - 1) : 0;
    lastCoin = now;
    play('coin', { combo, exact: true });
  });
  hook('item:use', d => {
    const r = d.r, it = d.item; if (!r || !it) return;
    play(it, { r, vol: isP(r) ? 1 : 0.55 });
    const p = FM.S.player;
    if (!isP(r) && it === 'bolt' && !demo() && p && !p.finished && FM.S.mode === 'race') play('cloud', { vol: 0.85 });
  });
  hook('ability', d => { const r = d.r; if (r) play('ab_' + (d.id || r.id), { r, vol: isP(r) ? 1 : 0.6 }); });
  hook('explode', d => {
    const x = num(d.x, 0), y = num(d.y, 0);
    const v = posVol(x, y); if (v <= 0) return;
    play('explode', { x, y, vol: isP(d.owner) ? 1 : 0.9 });
    if (v > 0.5) duck(0.5, 0.5);
  });
  hook('trap:snap', d => { if (d.r) play('snap', { r: d.r, vol: isP(d.r) ? 1 : 0.7 }); });
  hook('bolt:strike', d => {
    const r = d.r; if (!r || demo()) return;
    if (isP(r)) { play('thunder', { vol: 1 }); duck(0.45, 0.7); }
    else play('thunder', { x: r.x + 14, y: r.y, vol: 0.6 });
  });
  hook('hit', d => {
    const q = d.victim, nm = HIT_SND[d.kind]; if (!q || !nm) return;
    if (isP(q)) play(nm, { vol: quietMode() ? 0 : 1 });
    else { play(nm, { r: q, vol: 0.5 }); if (isP(d.src) && !demo()) play('hitConfirm', { vol: 0.7 }); }
  });
  hook('blocked', d => { if (d.r) play(d.by === 'balloon' ? 'pop' : 'blockShield', { r: d.r, vol: isP(d.r) ? 1 : 0.5 }); });
  hook('death', d => {
    const r = d.r; if (!r) return;
    play('death', { r, vol: isP(r) ? (LIQ[d.cause] ? 0.7 : 1) : 0.45 });
    if (d.killer && isP(d.killer) && !isP(r) && !demo()) play('killConfirm', { vol: 0.8, when: 0.08 });
  });
  hook('respawn', d => { if (isP(d.r) && !demo()) play('respawn', {}); });
  hook('splash', d => {
    const nm = 'splash_' + (LIQ[d.liquid] ? d.liquid : 'water');
    if (d.r) play(nm, { r: d.r, vol: isP(d.r) ? 1 : 0.5 });
    else play(nm, { x: d.x, y: d.y });
  });
  hook('countdown', d => {
    if (demo()) return;
    const n = d.n | 0;
    if (n >= 1 && n <= 3) { play('count', { exact: true }); goPlayed = false; }
    else if (n === 0) { play('go', { exact: true }); goPlayed = true; }   // HUD "KOŞ!" bu anda görünür
  });
  hook('go', () => { if (!demo() && !goPlayed) play('go', { exact: true }); goPlayed = false; });
  hook('finish', d => {
    if (demo() || FM.S.mode !== 'race') return;
    if (isP(d.r)) { play('finish', { place: d.place, exact: true }); duck(0.35, 2.2); }
    else play('finishOther', { vol: 0.5 });
  });
  hook('ui:podium', d => { play(d && d.playerRank === 0 ? 'victory' : 'podium', { exact: true }); });
  hook('match:end', d => { play(d && d.champion ? 'champion' : 'matchEnd', { exact: true }); duck(0.35, d && d.champion ? 4 : 2); });
  hook('meta:mission', () => play('mission', { when: 0.15, exact: true }));
  hook('meta:levelup', () => play('levelup', { when: 0.45, exact: true }));

  /* ---------- müzik olayları (ses kilitli olsa da istek kaydedilir) ---------- */
  function safeOn(ev, fn) { FM.on(ev, d => { try { fn(d || {}); } catch (e) { fail(e); } }); }
  safeOn('race:start', d => {
    const th = d.theme || (FM.S.L && FM.S.L.theme);
    const goIn = FM.S.mode === 'count' ? Math.max(0, num(FM.S.countT, 3.6) - 0.6) : 0;
    music(th && th.id ? th.id : 'forest', { goIn, fadeOut: 0.8, fade: 0.25 });
  });
  safeOn('ui:menu', () => music('menu', { fadeOut: 0.9, fade: 0.8 }));
  safeOn('race:end', () => { if (live() && LIVE.cur) { const saved = E; E = LIVE; try { fadeTo(LIVE.cur, 0.5, 1.2); } finally { E = saved; } } });
  safeOn('ui:podium', d => music('podium', { delay: d && d.playerRank === 0 ? 2.5 : 1.9, fadeOut: 0.5, fade: 0.8 }));
  safeOn('boot', () => { if (!want && !(FM.DEV && FM.params && FM.params.scene && FM.params.scene !== 'menu')) want = 'menu'; });

  /* ---------- oyun durumunu izleyen döngü (tırmanma tıkırtısı, füze kilidi, süre sayacı, testere sekmesi) ---------- */
  const misSeen = new WeakMap(), sawSeen = new WeakMap();
  function watch(dt) {
    if (!live()) return;
    const S = FM.S, p = S.player;
    if (!p || !(S.mode === 'race' || S.mode === 'count' || S.mode === 'end')) { lastTick = null; climbT = 0; return; }
    dt = Math.min(0.1, Math.max(0, num(dt, 0)));
    // tırmanma tıkırtıları
    if (p.climb && p.dead <= 0) {
      climbT -= dt;
      if (climbT <= 0) { climbAlt = !climbAlt; play('climb', { r: p, alt: climbAlt, vol: 0.85 }); climbT = 0.12; }
    } else climbT = 0;
    // varlıklar
    const ents = S.ents || [];
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]; if (!e) continue;
      if (e.type === 'mis') {
        let st = misSeen.get(e); if (!st) { st = { b: 0, l: false }; misSeen.set(e, st); }
        const mine = e.tgt === p || e.o === p;
        if (num(e.age, 0) < num(e.warn, 0)) {
          if (mine) {
            st.b -= dt;
            if (st.b <= 0) {
              const prog = clamp(num(e.age, 0) / (num(e.warn, 1) || 1), 0, 1);
              play('lock', { vol: e.tgt === p ? 1 : 0.4, rate: 1 + prog * 0.2, exact: true });
              st.b = 0.2 - prog * 0.1;
            }
          }
        } else if (!st.l) {
          st.l = true;
          if (mine) play('misLaunch', { vol: 0.9 }); else play('misLaunch', { x: num(e.x, 0), y: num(e.y, 0), vol: 0.6 });
        }
      } else if (e.type === 'saw') {
        const sg = num(e.vx, 0) >= 0 ? 1 : -1, pv = sawSeen.get(e);
        if (pv !== undefined && pv !== sg) play('clang', { x: num(e.x, 0), y: num(e.y, 0), vol: 0.7 });
        sawSeen.set(e, sg);
      }
    }
    // biri bitirdi: son 5 saniye tik-tak
    if (S.mode === 'race' && S.endTimer != null && !p.finished && S.endTimer > 0 && S.endTimer <= 5.5) {
      const sec = Math.ceil(S.endTimer);
      if (sec !== lastTick) { lastTick = sec; play('tick', { n: sec, exact: true }); }
    } else lastTick = null;
  }
  if (FM.R && Array.isArray(FM.R.updaters)) FM.R.updaters.push(watch);

  /* =====================================================================
     DIŞA AÇIK API
     ===================================================================== */
  function setVolume(kind, v) {
    try {
      if (kind !== 'music' && kind !== 'sfx') return;
      v = clamp(num(+v, 0), 0, 1);
      const st = FM.save ? (FM.save.settings = FM.save.settings || {}) : null;
      const prev = st ? num(+st[kind], -1) : -1;
      if (st) { st[kind] = v; if (typeof FM.persist === 'function') FM.persist(); }
      if (LIVE) { const saved = E; E = LIVE; try { applyVol(LIVE, false); } finally { E = saved; } }
      if (kind === 'sfx' && Math.abs(prev - v) > 0.001 && live()) {     // kaydırıcı önizlemesi
        const now = LIVE.ac.currentTime;
        if (!setVolume.t || now - setVolume.t > 0.18) { setVolume.t = now; play('coin', { combo: 2, exact: true }); }
      }
    } catch (e) { fail(e); }
  }
  let muted = false;
  function mute(on) {
    muted = on == null ? !muted : !!on;
    if (LIVE) { const saved = E; E = LIVE; try { glide(LIVE, LIVE.master.gain, muted ? 0 : 0.92, 0.03); } catch (e) { fail(e); } finally { E = saved; } }
    return muted;
  }

  /* ---------- geliştirici: çevrimdışı ölçüm (OfflineAudioContext ile gerçek sentez) ---------- */
  function renderOffline(secs, raw, fn) {
    if (!OAC) return Promise.reject(new Error('OfflineAudioContext yok'));
    const sr = 44100, oac = new OAC(2, Math.ceil(secs * sr), sr);
    const saved = E;
    try { E = build(oac, true, raw); applyVol(E, true); fn(E); }
    finally { E = saved; }
    return oac.startRendering();
  }
  function stats(buf) {
    let peak = 0, sum = 0, dsum = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c); let prev = 0;
      for (let i = 0; i < d.length; i++) { const x = d[i]; const a = x < 0 ? -x : x; if (a > peak) peak = a; sum += x * x; const df = x - prev; dsum += df * df; prev = x; n++; }
    }
    // yalnızca sesli bölümün RMS'i (sessiz kuyruk ortalamayı düşürmesin)
    let act = 0, asum = 0;
    const d0 = buf.getChannelData(0), win = 1024;
    for (let i = 0; i + win <= d0.length; i += win) { let s = 0; for (let j = 0; j < win; j++) s += d0[i + j] * d0[i + j]; s /= win; if (s > 1e-6) { act++; asum += s; } }
    const db = x => x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120;
    return { peakDb: db(peak), rmsDb: db(Math.sqrt(act ? asum / act : 0)), activeS: Math.round(act * win / buf.sampleRate * 100) / 100, bright: Math.round(Math.sqrt(dsum / (sum || 1)) * 1000) / 1000 };
  }

  FM.audio = {
    unlock: () => (canStart(null) ? unlock() : false),   // etkileşim yoksa sessizce false (tarayıcı uyarısı yok)
    play, music, setVolume, duck, mute,
    click() { return play('click', { exact: true }); },
    hover() { return play('hover', { exact: true }); },
    names() { return Object.keys(SFX); },
    songs() { return Object.keys(SONGS); },
    get ready() { return live(); },
    get current() { return want; },
    get enabled() { return !disabled; },
    _dev: {
      errors: () => errLog.slice(),
      errorCount: () => errN,
      validate() { const out = []; for (const k in SONGS) { const c = compile(SONGS[k]); for (const p of c.problems) out.push(k + ' → ' + p); } return out; },
      renderSfx(name, opts, secs, raw) {
        return renderOffline(secs || ((hasOwn(SFX, name) ? SFX[name] : hasOwn(ALIAS, name) ? SFX[ALIAS[name]] : { dur: 1 }).dur + 0.8), raw, () => {
          if (!playNow(name, Object.assign({ exact: true }, opts || {}), true)) throw new Error('ses yok: ' + name);
        });
      },
      renderMusic(id, secs, raw, solo) {
        return renderOffline(secs, raw, () => {
          const s = makeSong(id); E.songs.push(s);
          if (solo) for (const k in s.ch) if (!solo.includes(k)) s.ch[k].gain.value = 0;
          for (const g of [s.fade, s.fadeV, s.fadeD]) g.gain.value = 1;
          s.next = 0.05;
          while (s.next < secs - 0.05) { schedStep(s, s.next); advance(s); }
        });
      },
      stats,
      trim(on) { trimOn = !!on; return Object.assign({}, TRIM); },
      state() { return { want, unlocked, disabled, ctx: LIVE ? LIVE.ac.state : null, songs: LIVE ? LIVE.songs.map(s => s.id + (s.stopping ? '(sönüyor)' : '')) : [], voices: LIVE ? LIVE.voices.filter(v => !v.killed).length : 0, voicesAll: LIVE ? LIVE.voices.length : 0 }; },
      tick
    }
  };
})(window.FM);

// Engel tasarımı denetleyicisi (deterministik): her engel örneği için TEK koşucuyu betikli politikalarla koşturur ve
// "her engelin tek, net ve çalışan bir cevabı var mı?" sorusunu ölçer.
// Kullanım: node dev/obstacles.js [seed sayısı=4] [modlar=classic,pure,coins] [temalar=all|0,3,desert] [--ayrinti] [--seed0=N]
//   Engeller: spikes (zıpla), pit (çukur: kenarda zıpla), crush (ezici: kay), saw (testere makinesi: kay), boulder (kaya: zamanla zıpla),
//   wall (duvar/basamak: tutarak tırman). Her biri için:
//     • yok      : o engelin kuralı kapalıyken (diğer engeller normal) koşucu geçebiliyor mu? → geçiyorsa "bedava" İHLAL
//                   (testere ve kayada her evrede denenir: kaymadan/zıplamadan geçilebilen evre varsa ihlal)
//     • pencere  : doğru hareketin zamanlaması (zıplama/kayma mesafesi) taranır; geçen en uzun kesintisiz aralık ms'ye çevrilir
//                   0 → "imkânsız" İHLAL, < DAR ms → "dar (piksel hassasiyeti)" İHLAL
//     • yanlış   : kayma engeline zıplamak / zıplama engeline kaymak geçiyor mu (bilgi)
//   Koşucu engelin ~300 px önünde, tam hızda yerde başlar; engelin 160 px ötesine sağ varırsa başarılı. Arkadan gelen engeller
//   (ör. ezicinin hemen ardından çukur) testin içindedir: "kombinasyon" sorunları böyle yakalanır.
// Çıkış kodu: ihlal varsa 1.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
FM.view.VW = 1000;
const ARG = process.argv.slice(2), FL = {};
for (const a of ARG) if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); FL[k] = v == null ? true : v; }
const POS = ARG.filter(a => !a.startsWith('--'));
const SEEDS = +(POS[0] || 4), MODES = (POS[1] || 'classic,pure,coins').split(','), THS = POS[2] && POS[2] !== 'all' ? POS[2].split(',').map(t => isFinite(+t) ? +t : FM.themeIndex(t)) : [0, 1, 2, 3, 4, 5, 6, 7];
const SEED0 = FL.seed0 != null ? +FL.seed0 : 9000;
const DAR = 70;   // ms: bundan dar pencere "piksel hassasiyeti" sayılır
const S = FM.S, G = FM.game, C = FM.C, I = FM.input, STEP = C.STEP;
const RUN = C.RUN;

/* ---------- politika: parametreli tepkisel koşucu (oyuncu gibi) ----------
   prm: {Le (çukur kenarından önce zıplama payı px), Ls (dikene kala zıplama px), Lc (ezici/testereye kala kayma px), Tb (kayaya temas sn)}
   ov: {o (engel), v (bu engel için taranan değer) | off: true (bu engelin kuralı kapalı) | wrong: true (yanlış hareket)} */
function gw(L, px, py, d) { for (const s of L.solids) if (px >= s.x && px <= s.x + s.w && s.y >= py - 4 && s.y < py + d) return true; return false; }
function within(o, x0, x1) { return o && x1 > o.x0 - 2 && x0 < o.x1 + 2; }
function policy(P, prm, ov) {
  const L = S.L, fx = P.x + P.w, feet = P.y + P.h, cx = P.x + P.w / 2;
  I.jp = false; I.dp = false;
  let jump = false, slide = false;
  const O = ov && ov.o;
  const val = (k, o, def) => (O && o === O && ov.v != null ? ov.v : def);
  const off = o => !!(O && o === O && (ov.off || ov.wrong));
  if (P.onGround || P.coy > 0) {
    // çukur kenarı
    for (const o of OBS.pit) {
      const le = val('Le', o, prm.Le);
      if (fx + le >= o.x0 && fx < o.x1 && Math.abs(o.y - feet) < 6 && !off(o)) { jump = true; break; }
    }
    if (!jump && !gw(L, fx + prm.Le, feet, 240) && !OBS.pit.some(o => fx + 260 > o.x0 && fx < o.x1)) jump = true;   // tanımsız kenar (güvenlik)
    // diken
    for (const o of OBS.spikes) {
      const ls = val('Ls', o, prm.Ls), dx = o.x0 - fx;
      if (dx >= 0 && dx <= ls && Math.abs(o.y - feet) < 40 && !off(o)) { jump = true; break; }
      if (O === o && ov.wrong && dx >= 0 && dx <= prm.Ls) slide = true;
    }
    // kaya
    for (const o of OBS.boulder) {
      const b = o.b; if (fx < b.x0 - 60 || P.x > b.x1 + 2 * b.r || Math.abs(b.y - feet) > 40 || off(o)) continue;
      const tc = G.boulderContact(b, P), tb = val('Tb', o, prm.Tb);
      if (tc > 0 && tc <= tb) { jump = true; break; }
    }
    // ezici / testere: kay (yanlış hareket testinde zıpla)
    for (const o of OBS.slideOb) {
      const lc = val('Lc', o, prm.Lc), dx = o.x0 - fx;
      if (dx >= -(o.x1 - o.x0) - P.w && dx <= lc && Math.abs(o.y - feet) < 30) {
        if (O === o && ov.wrong) { if (dx >= 0) jump = true; }
        else if (!off(o)) slide = true;
      }
    }
  } else if (!P.climb && P.jumps < 2 && P.vy > 120 && !(O && (ov.off || ov.wrong) && O.k === 'pit' && cx > O.x0 - 200 && cx < O.x1 + 40)) {
    // çift zıplama: altında zemin yok ve ileride zemin var (yapay zekâ ile aynı kural; "hareketsiz" testinde o çukurda kapalı)
    if (!gw(L, cx + P.vx * .08, feet, 700) && !gw(L, cx + P.vx * .3, feet, 700) && gw(L, cx + 190, feet - 80, 440)) jump = true;
  }
  if (P.slide) for (const o of OBS.slideOb) if (P.x + P.w > o.x0 - 4 && P.x < o.x1 + 4 && !off(o)) slide = true;   // altındayken kaymayı sürdür
  if (jump && !P.slide) I.jp = true;
  else if (jump && P.slide && !slide) I.jp = true;
  if (slide && !P.slide && P.onGround) I.dp = true;
  I.dh = slide;
  I.jh = P.vy < 0 || P.climb || P.blocked || jump;
}

/* ---------- seviyeden engeller ---------- */
let OBS = null;
function obstaclesOf(L) {
  const O = { spikes: [], pit: [], crush: [], saw: [], boulder: [], wall: [], slideOb: [] };
  // çukur: hiçbir katının (yüzen dahil) x aralığının kapsamadığı boşluklar
  const iv = L.solids.map(s => [s.x, s.x + s.w, s]).sort((a, b) => a[0] - b[0]);
  let end = -1e9, last = null;
  for (const [a, b, s] of iv) {
    if (a > end + 4 && last) {
      const y = last.y;
      O.pit.push({ k: 'pit', x0: end, x1: a, y, w: a - end });
    }
    if (b > end) { end = b; last = s; }
  }
  for (const s of L.spikes) O.spikes.push({ k: 'spikes', x0: s.x, x1: s.x + s.w, y: s.y + s.h });
  for (const k of L.crush) { const o = { k: 'crush', x0: k.x, x1: k.x + k.w, y: k.y + k.h + 26 }; O.crush.push(o); O.slideOb.push(o); }
  for (const s of L.saws) { const o = { k: 'saw', x0: s.cx - s.r, x1: s.cx + s.r, y: s.cy + 80, s }; O.saw.push(o); O.slideOb.push(o); }
  for (const b of L.boulders) O.boulder.push({ k: 'boulder', x0: b.x0, x1: b.x1 + 2 * b.r, y: b.y, b });
  // duvar/basamak: ardışık zeminlerde 46 px'ten (otomatik basamak) yüksek çıkış
  const gr = L.solids.filter(s => !s.float).sort((a, b) => a.x - b.x);
  for (let i = 1; i < gr.length; i++) if (Math.abs(gr[i].x - (gr[i - 1].x + gr[i - 1].w)) < 2 && gr[i - 1].y - gr[i].y > 46) O.wall.push({ k: 'wall', x0: gr[i].x - 10, x1: gr[i].x + 40, y: gr[i - 1].y, h: gr[i - 1].y - gr[i].y });
  return O;
}

/* ---------- koşu ---------- */
const FULL = {};
function trimmedLevel(L, x0, x1) {
  const f = a => a.filter(o => { const ox = o.x != null ? o.x : o.cx != null ? o.cx : o.x0 != null ? o.x0 : o.ax; const ow = o.w || (o.x1 && o.x0 != null ? o.x1 - o.x0 : 0) || 120; return ox + ow > x0 && ox < x1; });
  const T = Object.assign({}, L);
  for (const k of ['solids', 'spikes', 'crush', 'saws', 'boxes', 'pads', 'mush', 'belts', 'mud', 'coins', 'ice', 'quicksand', 'boulders', 'vents', 'portals', 'lowg', 'tramp', 'bridges', 'gates', 'decor']) T[k] = f(L[k] || []);
  T.coins = []; T.decor = []; T.boxes = [];   // denetimde gereksiz (hızlı)
  return T;
}
function placeAt(P, x0, L, xmax) {
  // x0'da (önce engele doğru ileride, sonra geride) zemin bul; tehlikesiz bir noktaya koy, tam hızda
  const cand = [];
  for (let x = x0; x <= (xmax != null ? xmax : x0); x += 20) cand.push(x);
  for (let k = 1; k < 40; k++) cand.push(x0 - k * 20);
  for (const x of cand) {
    let gy = null; for (const s of L.solids) if (x >= s.x + 4 && x + P.w <= s.x + s.w - 4 && (gy === null || s.y < gy) && s.y > -500) gy = s.y;
    if (gy === null) continue;
    const bad = L.spikes.some(s => s.x < x + 120 && s.x + s.w > x - 60) || L.crush.some(c => c.x < x + 120 && c.x + c.w > x - 60) || L.saws.some(s => Math.abs(s.cx - x) < 140) || (L.boulders || []).some(b => x + 120 > b.x0 && x < b.x1 + 2 * b.r + 10);   // kaya sola yuvarlanır: kapının sağı güvenli
    if (bad) continue;
    Object.assign(P, { x, y: gy - C.RH, h: C.RH, w: C.RW, vx: RUN, vy: 0, onGround: true, coy: .1, jumps: 0, slide: false, slideT: 0, climb: false, blocked: false, slam: false,
      dead: 0, inv: 0, stun: 0, frozen: 0, netted: 0, slowT: 0, pull: 0, inked: 0, dash: 0, sled: 0, fly: 0, boost: 0, shield: 0, balloon: false, padT: 0,
      jbuf: 0, landT: 9, perfT: 0, spawnT: 0, airJ: false, item: null, charge: 0, finished: false, onIce: false, onMud: false, onSand: false, bounceT: 0, ventCd: 0, portCd: 0 });
    P.safe = { x: x + 14, y: gy }; P.loop = { sx: -1, n: 0 };
    return true;
  }
  return false;
}
// tek deneme: engel o'nun 300 px önünden başla, o.x1+160'a sağ var → true
function trial(o, lt, prm, ov) {
  const L = FULL.L, P = S.player;
  S.L = FULL.T;
  if (!placeAt(P, o.x0 - 300, S.L, o.x0 - 150)) return null;
  S.lt = lt; S.raceT = 20; S.mode = 'race'; S.ents = []; S.parts = []; S.endTimer = null; S.finishedN = 0;
  const goal = o.x1 + 160;
  let t = 0;
  while (t < 6) {
    policy(P, prm, ov);
    G.step(STEP); t += STEP;
    if (P.dead > 0) return false;
    if (P.x > goal) return true;
    if (S.mode !== 'race') return P.finished;
  }
  return false;   // takıldı
}
const NOM = { Le: 18, Ls: 46, Lc: 36, Tb: .2 };
const SWEEP = { spikes: ['Ls', 0, 230, 4], pit: ['Le', -12, 130, 3], crush: ['Lc', -24, 230, 4], saw: ['Lc', -24, 230, 4], boulder: ['Tb', .02, .7, .02] };
function sweep(o, lt) {
  const [key, a, b, st] = SWEEP[o.k];
  let best = 0, cur = 0, any = false, at = null, bestAt = null;
  for (let v = a; v <= b + 1e-9; v += st) {
    const ok = trial(o, lt, NOM, { o, v });
    if (ok) { any = true; if (!cur) at = v; cur++; if (cur > best) { best = cur; bestAt = [at, v]; } } else cur = 0;
  }
  // pencere → ms: mesafe pencerelerinde px / hız; kaya zaman penceresi doğrudan
  const ms = key === 'Tb' ? best * st * 1000 : best * st / RUN * 1000;
  return { ms: Math.round(ms), any, range: bestAt };
}
const phasesFor = o => o.k === 'saw' ? [0, .7, 1.4, 2.1, 2.8, 3.5].map(p => 10 + p) : o.k === 'boulder' ? Array.from({ length: 10 }, (_, i) => 10 + i * o.b.per / 10) : [10];

/* ---------- ana döngü ---------- */
const stat = {}, viol = [];
const st = k => stat[k] || (stat[k] = { n: 0, bedava: 0, imkansiz: 0, dar: 0, yanlis: 0, ms: [] });
let levels = 0;
const t0 = Date.now();
for (const mode of MODES) for (const th of THS) for (let si = 0; si < SEEDS; si++) {
  const seed = SEED0 + si * 101 + th * 7;
  G.startMatch({ char: 'Kral', rounds: 1, auto: false, seed, theme: th, themeIdx: th, mode, n: 2 });
  const P = S.player; S.racers = [P]; P.bot = false; P.ctrl = 'local';
  FULL.L = S.L; OBS = obstaclesOf(S.L); levels++;
  const all = [].concat(OBS.spikes, OBS.pit, OBS.crush, OBS.saw, OBS.boulder, OBS.wall);
  for (const o of all) {
    if (o.x0 < 900 || o.x1 > FULL.L.end - 100) continue;   // başlangıç/bitiş alanı
    FULL.T = trimmedLevel(FULL.L, o.x0 - 700, o.x1 + 900);
    const s = st(o.k); s.n++;
    const where = `${mode}/${FM.THEMES[th].id}/seed ${seed} x ${Math.round(o.x0)}`;
    if (o.k === 'wall') {
      if (![10, 11.3, 12.6].some(lt => trial(o, lt, NOM, null))) { s.imkansiz++; viol.push(`${where} duvar (${Math.round(o.h)} px): tırmanılarak geçilemedi`); }
      continue;
    }
    let minMs = 1e9, freeAny = false, wrongAll = true, worst = null;
    for (const lt of phasesFor(o)) {
      const free = trial(o, lt, NOM, { o, off: true });
      if (free) freeAny = true;
      const w = sweep(o, lt);
      // kaya: o evrede kaya zaten yoksa (geçilebilir) pencere ölçülmez
      if (o.k === 'boulder' && free) continue;
      if (w.ms < minMs) { minMs = w.ms; worst = { lt, w }; }
      if ((o.k === 'crush' || o.k === 'saw' || o.k === 'spikes') && !trial(o, lt, NOM, { o, wrong: true })) { } else if (o.k !== 'boulder' && o.k !== 'pit') wrongAll = false;
    }
    // çukur: koşucudan (28 px) dar boşluk düşülemez, mantar/trambolin/gayzer fırlatması ya da yüzen yol üstünden geçirir → çukur sayılmaz
    if (freeAny && o.k === 'pit') { s.n--; s.yol = (s.yol || 0) + 1; continue; }
    if (freeAny && o.k !== 'boulder') { s.bedava++; viol.push(`${where} ${o.k}: hareketsiz geçilebiliyor${o.k === 'saw' || o.k === 'crush' ? ' (kaymadan geçiliyor)' : ''}`); }
    if (minMs === 1e9) continue;
    s.ms.push(minMs);
    if (minMs === 0) { s.imkansiz++; viol.push(`${where} ${o.k}${o.w ? ' (' + Math.round(o.w) + ' px)' : ''}: doğru hareketle geçilemiyor (lt ${worst.lt.toFixed(2)})`); }
    else if (minMs < DAR) { s.dar++; viol.push(`${where} ${o.k}${o.w ? ' (' + Math.round(o.w) + ' px)' : ''}: pencere dar ${minMs} ms ${JSON.stringify(worst.w.range)}`); }
    if (!wrongAll) s.yanlis++;
  }
}
const pct = (a, q) => { if (!a.length) return '-'; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };
console.log(`Engel denetimi: ${levels} harita (${MODES.join(',')} × tema ${THS.join(',')} × ${SEEDS} seed), ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
for (const [k, s] of Object.entries(stat)) console.log(`  ${k.padEnd(8)} ${String(s.n).padStart(4)} örnek | bedava ${s.bedava} | imkânsız ${s.imkansiz} | dar(<${DAR}ms) ${s.dar} | yanlış hareketle de geçen ${s.yanlis} | pencere ms en kötü ${pct(s.ms, 0)} · %10 ${pct(s.ms, .1)} · medyan ${pct(s.ms, .5)}${s.yol ? ' | kendiliğinden aşılan boşluk ' + s.yol : ''}`);
console.log(`İhlal: ${viol.length}`);
for (const v of viol.slice(0, FL.ayrinti ? 400 : 40)) console.log('  ' + v);
if (viol.length > 40 && !FL.ayrinti) console.log(`  … (+${viol.length - 40}; tamamı için --ayrinti)`);
process.exitCode = viol.length ? 1 : 0;

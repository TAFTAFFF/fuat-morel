// Yokuş fiziği denetimi: botlu yarışlarda eğimli zeminde koşu/kayma/zıplama/iniş ölçümleri (tarayıcısız)
// Kullanım: node dev/slopes.js [tema×mod başına koşu] [yarışçı sayısı]
// Ölçümler (hepsi 0'a yakın olmalı):
//   kopma  : yerde koşarken zıplamadan/fırlatılmadan havalanma (altında 20 px içinde zemin varken) ve 50 ms'den uzun havada kalma
//   sekme  : böyle bir kopmadan sonra yere geri düşme (yokuş başında/sonunda zıplama hissi)
//   gömülme: canlı yarışçının ayak noktası katının içinde (2 adımdan uzun)
//   sıvı   : sıvıya düşüp ölme (artık çukur yok → 0 olmalı)
//   kayma  : yokuşta kayma sayısı ve ayağa kalkamayan (1.2 sn'den uzun, üstünde engel yokken) kayma
//   hız    : yerde koşu hızı ortalaması (çıkış / düz / iniş; kayarken ayrı)
const src = require('fs').readFileSync(require('path').join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
const RUNS = +(process.argv[2] || 2), NR = +(process.argv[3] || 4);
const MODES = ['classic', 'pure', 'chaos', 'coins', 'elim'];
const tot = { koşu: 0, adım: 0, kopma: 0, sekme: 0, gömülme: 0, sıvı: 0, yokuşKayma: 0, kalkamayan: 0, yokuşZıplama: 0, tırmanma: 0, uzunTırmanma: 0, ölüm: 0, takılma: 0, bitmeyen: 0 };
const spd = { çıkış: [0, 0], düz: [0, 0], iniş: [0, 0], kayarakİniş: [0, 0], kayarakÇıkış: [0, 0] };
const where = {};
let maxLift = 0;
// eski sürümle (yokuşsuz) karşılaştırılabilsin: yardımcılar yoksa düz zemin
const topAt = FM.level && FM.level.topAt ? FM.level.topAt : s => s.y;
const groundY = (x, y) => { let b = null; for (const s of FM.S.L.solids) { if (x < s.x || x > s.x + s.w) continue; const t = topAt(s, x); if (t >= y - 8 && (b === null || t < b)) b = t; } return b; };
const inSolidPt = (L, x, y) => { for (const s of L.solids) if (x >= s.x && x < s.x + s.w && y < s.y + s.h && y >= topAt(s, x)) return true; return false; };
for (const mode of MODES) for (let th = 0; th < 8; th++) for (let k = 0; k < RUNS; k++) {
  const seed = 7100 + th * 131 + k * 17 + MODES.indexOf(mode) * 1009;
  const st = new Map();
  const S = FM.S;
  const mark = (r, f) => { const o = st.get(r); if (o) o[f] = S.raceT; };
  const onJ = d => mark(d.r, 'jt'), onL = d => mark(d.r, 'lt');
  const onD = d => { tot.ölüm++; if (d.cause === S.L.theme.liquid) { tot.sıvı++; const key = S.L.theme.id + ' ' + mode; where[key] = (where[key] || 0) + 1; } };
  const onH = d => { if (d && d.r) mark(d.r, 'lt'); };
  FM.on('jump', onJ); FM.on('mush', onL); FM.on('vent', onL); FM.on('portal', onL); FM.on('hit', onH); FM.on('death', onD); FM.on('respawn', onL);
  FM.game.startMatch({ char: FM.ORDER[k % 7], rounds: 1, auto: true, seed, theme: th, mode, n: NR });
  S.countT = .01; tot.koşu++;
  for (const r of S.racers) st.set(r, { was: false, jt: -9, lt: -9, det: null, emb: 0, cl: 0, slT: 0, wx: r.x, wt: 0 });
  let t = 0;
  while (t < 220 && S.mode !== 'end' && S.mode !== 'podium') {
    const pre = S.racers.map(r => [r.onGround, r.slope || 0]);
    FM.game.step(FM.C.STEP); t += FM.C.STEP; S.parts.length = 0;
    if (S.mode !== 'race') continue;
    const L = S.L;
    S.racers.forEach((r, i) => {
      const o = st.get(r); if (!o || r.finished || r.out) return;
      tot.adım++;
      if (r.dead > 0) { o.det = null; o.emb = 0; o.wx = r.x; o.wt = t; return; }
      const cx = r.x + r.w / 2, feet = r.y + r.h;
      // kopma: önceki adım yerde, şimdi havada; zıplama/fırlatma yok
      if (pre[i][0] && !r.onGround && !r.climb && !r.inLift && r.fly <= 0 && r.dash <= 0 && S.raceT - o.jt > .02 && S.raceT - o.lt > .05 && !(r.stun > 0)) {
        const g = groundY(cx, feet - 2);
        if (g !== null && g - feet < 20) o.det = { t: S.raceT, x: cx, y: feet, sl: pre[i][1] };
      }
      if (o.det) {
        const g = groundY(cx, feet - 2); if (g !== null) maxLift = Math.max(maxLift, g - feet);
        if (r.onGround || r.climb) {
          const dur = S.raceT - o.det.t;
          if (dur > .05) { tot.kopma++; if (r.onGround) tot.sekme++; const key = 'kopma eğim ' + o.det.sl.toFixed(2) + ' ' + S.L.theme.id + '/' + mode + '/' + seed + ' @' + Math.round(o.det.x); where[key] = (where[key] || 0) + 1; }
          o.det = null;
        } else if (S.raceT - o.det.t > 1.5) o.det = null;   // gerçek kenar düşüşü (vadi/basamak inişi)
      }
      // gömülme
      if (inSolidPt(L, cx, feet - 6)) { if (++o.emb === 3) { tot.gömülme++; const key = 'gömülme ' + S.L.theme.id + '/' + mode + '/' + seed + ' @' + Math.round(cx) + ',' + Math.round(feet) + ' ' + [r.onGround ? 'yer' : 'hava', r.climb ? 'tırman' : '', r.slide ? 'kay' : '', r.frozen > 0 ? 'don' : '', r.netted > 0 ? 'ağ' : '', r.stun > 0 ? 'sersem' : '', 'vx' + Math.round(r.vx), 'vy' + Math.round(r.vy)].filter(Boolean).join(',') + ' ' + JSON.stringify(L.solids.filter(q => q.x < cx + 60 && q.x + q.w > cx - 60).map(q => [Math.round(q.x), Math.round(q.y), Math.round(q.w), q.y2 == null ? null : Math.round(q.y2), q.float ? 1 : 0])); where[key] = (where[key] || 0) + 1; } } else o.emb = 0;
      // kayma ve zıplama yokuşta
      if (r.slide) { if (r.slope && r.slideT < 1 / 120 + 1e-9) tot.yokuşKayma++; if (r.slideT > 1.2 && !(r.sled > 0) && !FM.game.solidAt(cx, r.y - 6) && !r.ctl.dh && !L.crush.some(k => cx > k.x - 40 && cx < k.x + k.w + 120) && !L.saws.some(q => cx > q.cx - q.r - 40 && cx < q.cx + q.r + 120)) { if (!o.slT) { tot.kalkamayan++; const key = 'kalkamayan ' + S.L.theme.id + '/' + mode + '/' + seed + ' @' + Math.round(cx) + ',' + Math.round(feet) + ' eğim ' + (r.slope || 0).toFixed(2) + (r.onGround ? '' : ' havada'); where[key] = (where[key] || 0) + 1; } o.slT = 1; } } else o.slT = 0;
      if (S.raceT === o.jt && pre[i][1]) tot.yokuşZıplama++;
      if (r.climb) { if (!o.cl) tot.tırmanma++; o.cl += FM.C.STEP; if (o.cl > 3 && o.cl < 3 + FM.C.STEP * 1.5) tot.uzunTırmanma++; } else o.cl = 0;
      // hız: yerde, sağa koşarken, etkisiz (hız pedi/destek yok)
      if (r.onGround && r.vx > 100 && !(r.boost > 0) && !(r.padT > 0) && !(r.slowT > 0) && !r.onMud && !r.onSand && !r.onIce && !r.onBelt) {
        const sl = r.slope || 0, k2 = r.slide ? (sl > .05 ? 'kayarakİniş' : sl < -.05 ? 'kayarakÇıkış' : null) : sl > .05 ? 'iniş' : sl < -.05 ? 'çıkış' : 'düz';
        if (k2) { spd[k2][0] += r.vx; spd[k2][1]++; }
      }
      // takılma: 3 sn'de 40 px'ten az ilerleme (kontrol kaybı yokken)
      const free = !(r.frozen > 0) && !(r.netted > 0) && !(r.stun > 0) && !(r.spawnT > 0) && !(r.pull > 0);
      if (!free || r.x > o.wx + 40) { o.wx = r.x; o.wt = t; } else if (t - o.wt > 3) { tot.takılma++; o.wx = r.x; o.wt = t; const key = 'takılma ' + S.L.theme.id + ' @' + Math.round(r.x); where[key] = (where[key] || 0) + 1; }
    });
  }
  if (S.racers.some(r => !r.finished && !r.out) && mode !== 'coins') tot.bitmeyen++;
  FM.off('jump', onJ); FM.off('mush', onL); FM.off('vent', onL); FM.off('portal', onL); FM.off('hit', onH); FM.off('death', onD); FM.off('respawn', onL);
}
console.log('Yokuş denetimi:', JSON.stringify(tot));
console.log('Kopmada en büyük yükselme (px):', maxLift.toFixed(1));
console.log('Yerde koşu hızı ort. (px/sn):', Object.entries(spd).map(([k, v]) => `${k} ${v[1] ? (v[0] / v[1]).toFixed(0) : '-'} (${v[1]})`).join('  '));
console.log('Ayrıntı:', JSON.stringify(Object.entries(where).sort((a, b) => b[1] - a[1]).slice(0, 20)));
const fail = tot.kopma + tot.gömülme + tot.sıvı + tot.kalkamayan + tot.bitmeyen;
console.log(fail ? `!! ${fail} sorun` : 'Tamam: kopma/sekme/gömülme/sıvı/kalkamayan/bitmeyen yok');
process.exitCode = fail ? 1 : 0;

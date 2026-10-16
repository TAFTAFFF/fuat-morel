// Doğduktan hemen sonra ölme (yeniden doğma döngüsü) avcısı: her tema/mod için botlu koşular
// Kullanım: node dev/respawn-scan.js [tema başına koşu]
const src = require('fs').readFileSync(require('path').join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
const RUNS = +(process.argv[2] || 3);
const quick = {}, ceil = {}; let respawns = 0, quickN = 0, chains = 0;
for (const mode of ['classic', 'chaos']) for (let th = 0; th < 8; th++) for (let k = 0; k < RUNS; k++) {
  const seed = 5000 + th * 97 + k * 13 + (mode === 'chaos' ? 7 : 0);
  const last = new Map(), streak = new Map();
  const onR = d => { last.set(d.r, FM.S.raceT); respawns++;
    // tavan kontrolü: ayakta duran kutu bir katıyla çakışıyor mu
    const r = d.r, L = FM.S.L; for (const s of L.solids) if (r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y) { const key = L.theme.id + ' ' + mode; ceil[key] = (ceil[key] || 0) + 1; break; } };
  const onD = d => { const t = last.get(d.r); if (t != null && FM.S.raceT - t < 3) { quickN++; const key = FM.S.L.theme.id + ' ' + mode + ' ' + d.cause; quick[key] = (quick[key] || 0) + 1; const s = (streak.get(d.r) || 0) + 1; streak.set(d.r, s); if (s === 3) chains++; } else streak.set(d.r, 0); };
  FM.on('respawn', onR); FM.on('death', onD);
  FM.game.startMatch({ char: FM.ORDER[k % 7], rounds: 1, auto: true, seed, theme: th, themeIdx: th, mode, n: 4 });
  FM.S.countT = .01;
  let t = 0; while (t < 200 && FM.S.mode !== 'end' && FM.S.mode !== 'podium') { FM.game.step(FM.C.STEP); t += FM.C.STEP; FM.S.parts.length = 0; }
  FM.off('respawn', onR); FM.off('death', onD);
}
console.log('yeniden doğma', respawns, '| 3 sn içinde tekrar ölüm', quickN, '(%' + (100 * quickN / Math.max(1, respawns)).toFixed(1) + ') | art arda 3 hızlı ölüm zinciri', chains);
console.log('hızlı ölümler (tema mod sebep):', JSON.stringify(Object.entries(quick).sort((a, b) => b[1] - a[1]).slice(0, 15)));
console.log('tavana gömülü doğma:', JSON.stringify(ceil));

// Kullanım: node dev/meta-test.js [bulut]
// meta.js + core.js kayıt testleri (tarayıcısız): eski kayıt göçü, n kişilik ödül, elmaslı kozmetik, mod/çok oyunculu
// sayaçları, uzun kodla dışa/içe aktarma (yedek + geri alma), FM.inAppBrowser, 5. tur profil: kupa sıfırlama göçü, oynama
// süresi (sanal saat/görünürlük/etkileşim), profil kartı + 'meta:card', lig, kafa kafaya. 'bulut' verilirse gerçek MQTT aracısına
// bulut kodu yazıp geri okur (internet gerekir).
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
function stubEl() { return { style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, addEventListener() { }, appendChild() { }, setAttribute() { }, querySelector() { return null }, querySelectorAll() { return [] }, getContext() { return new Proxy({}, { get: (t, p) => p in t ? t[p] : (() => ({ addColorStop() { } })), set: (t, p, v) => (t[p] = v, true) }) }, dataset: {} }; }
let fails = 0, oks = 0;
function ok(c, m) { if (c) oks++; else { fails++; console.log('HATA: ' + m); } }
/* Sanal ortam: sahte Date/zamanlayıcı/olay dinleyicileri/sayfa görünürlüğü. advance(ms) zamanı ilerletir ve vadesi gelen zamanlayıcıları sırayla çalıştırır. */
function virt(t0) {
  const v = { t: t0, timers: [], nid: 1, hidden: false, W: {}, D: {} };
  class FDate extends Date { constructor(...a) { if (a.length) super(...a); else super(v.t); } static now() { return v.t; } }
  v.Date = FDate;
  v.setTimeout = (fn, ms) => { const id = v.nid++; v.timers.push({ id, at: v.t + (ms || 0), fn, ev: 0 }); return id; };
  v.setInterval = (fn, ms) => { const id = v.nid++; v.timers.push({ id, at: v.t + ms, fn, ev: ms }); return id; };
  v.clear = id => { v.timers = v.timers.filter(x => x.id !== id); };
  v.advance = ms => {
    const end = v.t + ms;
    for (let g = 0; g < 1e6; g++) {
      let n = null; for (const x of v.timers) if (x.at <= end && (!n || x.at < n.at || (x.at === n.at && x.id < n.id))) n = x;
      if (!n) break;
      v.t = Math.max(v.t, n.at);
      if (n.ev) n.at += n.ev; else v.timers = v.timers.filter(x => x !== n);
      try { n.fn(); } catch (e) { console.log('zamanlayıcı hatası ' + (e && e.stack || e)); }
    }
    v.t = end;
  };
  v.on = which => (ev, fn) => { (v[which][ev] = v[which][ev] || []).push(fn); };
  v.fire = (which, ev) => { for (const f of (v[which][ev] || []).slice()) f({}); };
  return v;
}
function boot(store, v) {
  const sb = { console, Math, Date: v ? v.Date : Date, JSON, setTimeout: v ? v.setTimeout : setTimeout, clearTimeout: v ? v.clear : clearTimeout, performance: { now: () => v ? v.t : Date.now() }, requestAnimationFrame() { },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, val) => { store[k] = String(val) }, removeItem: k => { delete store[k] } },
    location: { search: '', protocol: 'file:' }, URLSearchParams, navigator: { maxTouchPoints: 0, userAgent: 'node' }, matchMedia: () => ({ matches: false, addEventListener() { } }),
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: v ? v.on('W') : () => { },
    document: { getElementById: () => stubEl(), createElement: () => stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener: v ? v.on('D') : () => { }, body: stubEl(), fonts: null, readyState: 'complete', get hidden() { return v ? v.hidden : false; } },
    TextEncoder, TextDecoder, btoa, atob, Blob, Response, CompressionStream, DecompressionStream, WebSocket: v ? undefined : globalThis.WebSocket, crypto: globalThis.crypto, Uint8Array };
  if (v) { sb.setInterval = v.setInterval; sb.clearInterval = v.clear; }
  sb.window = sb; vm.createContext(sb);
  // sanal ortamda ağ katmanı yüklenmez (gerçek WebSocket / zamanlayıcı karışmasın); meta testleri için gerekmez
  for (const f of (v ? ['core', 'gfx', 'level', 'game', 'meta'] : ['core', 'gfx', 'net', 'level', 'game', 'meta', 'netgame'])) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
  return sb.FM;
}
(async function () {
  // 1) yepyeni kayıt
  let store = {};
  let FM = boot(store);
  ok(FM.save.coins === 500, 'yeni kayıt 500 altın değil: ' + FM.save.coins);
  ok(FM.meta.currency('skins', 'altin') === 'gems' && FM.meta.currency('trails', 'spades') === 'gems' && FM.meta.currency('trails', 'fire') === 'coins', 'para birimi');
  // 2) eski kayıt göçü (alanlar eksik, sahip olunan eski altın kostüm korunur)
  store = { fuatmorel_save_v2: JSON.stringify({ v: 2, coins: 1234, gems: 30, xp: 5, level: 7, selChar: 'Kral', trophies: { Kral: 2000 }, owned: { skins: { Kral: ['klasik', 'altin'] }, trails: ['none', 'dust', 'spades'], plates: ['basic'] }, equipped: { skin: { Kral: 'altin' }, trail: 'spades', plate: 'basic' }, stats: { races: 40, wins: 9 }, metaV: 1 }) };
  FM = boot(store);
  ok(FM.save.coins === 1234 && FM.save.gems === 30 && FM.save.level === 7, 'eski bakiye/seviye korunmadı');
  ok(FM.meta.owns('skins', 'altin', 'Kral') && FM.meta.equipped('skins', 'Kral') === 'altin' && FM.meta.owns('trails', 'spades'), 'eski kozmetik kayboldu');
  ok(FM.save.stats.mpRaces === 0 && typeof FM.save.stats.modeRaces === 'object' && FM.save.stats.races === 40, 'yeni sayaçlar eklenmedi');
  ok(FM.meta.missions('ach').some(a => a.key === 'th_desert') && FM.meta.missions('ach').some(a => a.key === 'mpRaces'), 'yeni başarımlar yok');
  // 3) elmasla kozmetik
  const g0 = FM.save.gems, c0 = FM.save.coins;
  ok(FM.meta.buyCosmetic('skins', 'altin', 'TAFTAF') === true, 'elmasla kostüm alınamadı');
  ok(FM.save.gems === g0 - 25 && FM.save.coins === c0, 'elmas düşmedi / altın düştü: ' + g0 + '→' + FM.save.gems + ' ' + c0 + '→' + FM.save.coins);
  FM.save.gems = 3;
  ok(FM.meta.buyCosmetic('skins', 'altin', 'LUL') === false && FM.save.gems === 3, 'yetersiz elmasla alındı');
  const list = FM.meta.cosmetics('skins', 'LUL'); const alt = list.find(x => x.id === 'altin');
  ok(alt && alt.cur === 'gems' && alt.can === false && alt.price === 25, 'cosmetics() cur/can yanlış');
  // 4) n kişilik ödül (race:end), Altın Avı, çok oyunculu
  const S = FM.S; S.mode = 'race';
  function race(o) {
    const P = { id: 'TAFTAF', finished: !!o.fin, kills: 0, coins: o.coins || 0, deaths: 0, ftime: 40, out: !!o.out, ctrl: 'local' };
    const rk = [P]; for (let i = 1; i < o.n; i++) rk.push({ id: 'LUL', ctrl: o.mp && i < (o.humans || 1) ? 'remote' : 'bot', nbot: !(o.mp && i < (o.humans || 1)) });
    const ranking = rk.slice(1, o.rank + 1).concat([P], rk.slice(o.rank + 1));
    S.matchStats = { startedAt: Math.random() };
    FM.emit('race:end', { ranking, player: P, playerRank: o.rank, round: 1, rounds: 1, theme: FM.THEMES[o.th || 0], n: o.n, mode: o.mode || 'classic', mp: !!o.mp });
    return FM.meta.lastRewards;
  }
  let r = race({ n: 4, rank: 0, fin: 1 }); ok(r.lines[0].v === 120 && r.place === 1, '4 kişi 1. ödül ' + r.lines[0].v);
  r = race({ n: 4, rank: 3, fin: 1 }); ok(r.lines[0].v === 20, '4 kişi 4. ödül ' + r.lines[0].v);
  r = race({ n: 10, rank: 9, fin: 1 }); ok(r.lines[0].v === 20 && r.place === 10, '10 kişi 10. ödül/sıra ' + r.lines[0].v + ' ' + r.place);
  r = race({ n: 10, rank: 4, fin: 1 }); ok(r.lines[0].v > 40 && r.lines[0].v < 70, '10 kişi 5. ödül ' + r.lines[0].v);
  r = race({ n: 6, rank: 0, mode: 'coins', coins: 220, fin: 0, th: 4 });
  ok(r.win && r.lines[0].v === 120 && r.lines.find(l => l.icon === '🪙').v === 132, 'Altın Avı ödülü ' + JSON.stringify(r.lines.slice(0, 2)));
  ok(FM.save.stats.coinsBest === 220 && FM.save.stats.coinsWins === 1 && FM.save.stats.themeRaces.desert === 1, 'Altın Avı sayaçları');
  r = race({ n: 5, rank: 1, mode: 'elim', out: 1 }); ok(FM.save.stats.elimTop3 === 1 && r.lines[0].v > 20, 'eleme ilk 3');
  r = race({ n: 4, rank: 0, fin: 1, mp: 1, humans: 3 });
  ok(FM.save.stats.mpRaces === 1 && FM.save.stats.mpWins === 1 && r.lines.some(l => l.icon === '🤝' && l.v === 18), 'çok oyunculu sayaç/bonus ' + JSON.stringify(r.lines.map(l => l.v)));
  // meteor kaçışı
  S.gameMode = 'chaos'; S.player = { x: 1000, w: 28, dead: 0 };
  FM.emit('meteor', { x: 1100, y: 0 }); FM.emit('meteor', { x: 1900, y: 0 }); S.player.dead = 1; FM.emit('meteor', { x: 1010, y: 0 });
  ok(FM.save.stats.meteorDodge === 1, 'meteor kaçışı ' + FM.save.stats.meteorDodge);
  S.mode = 'menu';
  ok(FM.meta.mpStats().races === 1 && FM.meta.mpStats().winPct === 100, 'mpStats');
  // 5) dışa / içe aktarma
  FM.save.nick = 'Emir'; FM.save.nickSet = true; FM.save.gems = 77; FM.persist(true);
  const code = await FM.meta.exportCode();
  ok(typeof code === 'string' && /^FM1\./.test(code), 'exportCode biçimi ' + String(code).slice(0, 10));
  console.log('uzun kod uzunluğu: ' + code.length);
  const store2 = {}; const FM2 = boot(store2);
  const myPid = FM2.save.pid;
  const bad1 = await FM2.meta.importCode(code.slice(0, code.length - 30));
  ok(!bad1.ok && /bozuk|eksik|tanınmadı/i.test(bad1.err), 'kesik kod reddedilmedi');
  const bad2 = await FM2.meta.importCode('merhaba dünya');
  ok(!bad2.ok, 'çöp kod reddedilmedi');
  const pv = await FM2.meta.importCode(' ' + code.slice(0, 50) + '\n' + code.slice(50) + ' ');
  ok(pv.ok && pv.preview.gems === 77 && pv.preview.nick === 'Emir' && pv.current.coins === 500, 'önizleme ' + JSON.stringify(pv.preview || pv));
  ok(FM2.save.gems === 10, 'önizleme kaydı değiştirdi');
  ok(pv.apply() === true, 'apply başarısız');
  ok(FM2.save.gems === 77 && FM2.save.nick === 'Emir' && FM2.save.pid === myPid && FM2.save.stats.mpRaces === 1, 'içe aktarılan kayıt yanlış (pid korunmalı)');
  ok(JSON.parse(store2.fuatmorel_save_v2).gems === 77, 'içe aktarılan kayıt yazılmadı');
  const bi = FM2.meta.backupInfo(); ok(bi && bi.coins === 500, 'yedek yok');
  ok(FM2.meta.restoreBackup() === true && FM2.save.gems === 10 && FM2.save.pid === myPid, 'yedekten geri alma');
  ok(FM2.meta.restoreBackup() === true && FM2.save.gems === 77, 'geri almayı geri alma');
  // 6) bozuk kayıt silinmez (yedeklenir)
  const st3 = { fuatmorel_save_v2: '{bozuk json' }; const FM3 = boot(st3); FM3.persist(true);
  ok(Object.keys(st3).some(k => k.indexOf('fuatmorel_save_v2_bozuk_') === 0), 'bozuk kayıt yedeklenmedi');
  // 7) uygulama içi tarayıcı
  const ua = {
    whatsapp: 'Mozilla/5.0 (Linux; Android 13; SM-A515F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 WhatsApp/2.23.20',
    instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 305.0.0.0',
    facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]',
    messenger: 'Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 Chrome/119 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/435.0]',
    webview: 'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36',
    null: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  };
  for (const k in ua) { const want = k === 'null' || k === 'safari' ? null : k; ok(FM.inAppBrowser(ua[k]) === want, 'inAppBrowser ' + k + ' → ' + FM.inAppBrowser(ua[k])); }
  // 8) bulut (isteğe bağlı, gerçek aracı)
  if (process.argv[2] === 'bulut') {
    const t0 = Date.now();
    const cs = await FM.meta.cloudSave();
    console.log('bulut kaydı: ' + JSON.stringify(cs) + ' ' + (Date.now() - t0) + ' ms');
    ok(cs.ok && /^[A-Z2-9]{8}$/.test(cs.code), 'cloudSave başarısız');
    if (cs.ok) {
      const t1 = Date.now();
      const st4 = {}; const FM4 = boot(st4);
      const cl = await FM4.meta.importCode(cs.text.toLowerCase());
      console.log('bulut okuma: ' + (cl.ok ? 'ok gems=' + cl.preview.gems : cl.err) + ' ' + (Date.now() - t1) + ' ms');
      ok(cl.ok && cl.src === 'cloud' && cl.preview.gems === FM.save.gems, 'cloudLoad başarısız');
      const nf = await FM4.meta.cloudLoad('ZZZZ2222');
      ok(!nf.ok && /bulunamadı/.test(nf.err), 'olmayan bulut kodu');
    }
  }
  console.log((fails ? 'BAŞARISIZ ' : 'TAMAM ') + oks + ' denetim geçti, ' + fails + ' hata');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('İSTİSNA ' + (e && e.stack || e)); process.exit(1); });

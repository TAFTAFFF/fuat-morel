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
  // 7b) PROFİL (5. tur): kupa sıfırlama göçü, profil kartı, lig, kafa kafaya, oynama süresi, dışa/içe aktarma
  {
    const T0 = 1.75e12, deq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const rc = (F, o) => {   // race:end simülasyonu (o: {rank, others[], mp, id, fin, kills})
      const P = { id: o.id || 'TAFTAF', pid: 'pme', finished: o.fin !== 0, kills: o.kills || 0, coins: 0, deaths: 0, ftime: 40, ctrl: 'local' };
      const others = o.others || [{ id: 'LUL', ctrl: 'bot', bot: true }, { id: 'Nuss', ctrl: 'bot', bot: true }, { id: 'baso', ctrl: 'bot', bot: true }];
      const ranking = others.slice(0, o.rank).concat([P], others.slice(o.rank));
      F.S.matchStats = { startedAt: Math.random() }; F.S.mode = 'race';
      F.emit('race:end', { ranking, player: P, playerRank: o.rank, round: 1, rounds: 1, theme: F.THEMES[0], n: ranking.length, mode: 'classic', mp: !!o.mp });
      F.S.mode = 'menu';
    };
    // (a) yeni kayıt: kupalar 0
    let F = boot({}, virt(T0));
    const d0 = F.defaultSave();
    ok(F.ORDER.every(k => d0.trophies[k] === 0) && d0.trReset === 1 && deq(d0.h2h, {}) && d0.since > 0, 'defaultSave kupa/trReset/h2h/since');
    ok(F.ORDER.every(k => F.save.trophies[k] === 0) && F.save.trReset === 1 && F.save.since === T0, 'yeni kayıt kupaları 0 değil');
    ok(F.meta.card().tr === 0 && F.meta.card().lg === 'bronz', 'yeni kartta kupa 0 / Bronz değil');
    // (b) bir kerelik göç: eski kayıt (trReset yok) sıfırlanır, ikinci yüklemede kazanılan kupa KORUNUR
    const old = { v: 2, coins: 900, level: 3, selChar: 'Kral', trophies: { TAFTAF: 2555, Caner: 1999, Kral: 1188 }, stats: { races: 12, wins: 3 }, created: 1.6e12 };
    const stp = { fuatmorel_save_v2: JSON.stringify(old) };
    F = boot(stp, virt(T0));
    ok(F.ORDER.every(k => F.save.trophies[k] === 0) && F.save.trReset === 1, 'eski kayıt kupaları sıfırlanmadı: ' + JSON.stringify(F.save.trophies));
    ok(F.save.coins === 900 && F.save.level === 3 && F.save.stats.races === 12, 'göç eski ilerlemeyi bozdu');
    ok(F.save.since === 1.6e12, 'since eski kaydın created değerinden gelmeli: ' + F.save.since);
    F.save.trophies.Kral = 40; F.save.trophies.TAFTAF = 15; F.persist(true);
    ok(JSON.parse(stp.fuatmorel_save_v2).trReset === 1, 'trReset yazılmadı');
    const F2 = boot(stp, virt(T0 + 1000));
    ok(F2.save.trophies.Kral === 40 && F2.save.trophies.TAFTAF === 15 && F2.save.trophies.Caner === 0, 'ikinci yüklemede kazanılan kupa silindi: ' + JSON.stringify(F2.save.trophies));
    const n1 = F.normSave({ trophies: { TAFTAF: 500 } });
    ok(F.ORDER.every(k => n1.trophies[k] === 0) && n1.trReset === 1, 'normSave trReset yokken sıfırlamadı');
    const n2 = F.normSave({ trReset: 1, trophies: { TAFTAF: 500, Kral: 'x', LUL: -5, ertan: NaN, Nuss: 12.6, baso: Infinity, Sahte: 99 } });
    ok(n2.trophies.TAFTAF === 500 && n2.trophies.Kral === 0 && n2.trophies.LUL === 0 && n2.trophies.ertan === 0 && n2.trophies.Nuss === 13 && n2.trophies.baso === 0 && !('Sahte' in n2.trophies), 'normSave kupa düzeltmesi ' + JSON.stringify(n2.trophies));
    const n3 = F.normSave({ trReset: 1, trophies: [1, 2, 3], h2h: [1], since: 'x', created: 'y' });
    ok(F.ORDER.every(k => n3.trophies[k] === 0) && !Array.isArray(n3.h2h) && n3.since > 0, 'bozuk alanlar düzeltilmedi');
    ok(F.normSave(null) === null && F.normSave([]) === null && F.normSave('x') === null, 'normSave geçersiz girdi');
    // (c) yedek özeti: eski yedeğin kupaları 0 gösterilir
    const stb = {}; const Fb = boot(stb, virt(T0));
    stb.fuatmorel_save_v2_yedek = JSON.stringify({ t: T0, s: { coins: 10, trophies: { TAFTAF: 5000 } } });
    ok(Fb.meta.backupInfo().trophies === 0, 'eski yedek özeti kupa gösteriyor');
    ok(Fb.meta.restoreBackup() === true && Fb.ORDER.every(k => Fb.save.trophies[k] === 0), 'eski yedek geri yüklenince kupa 0 olmalı');
    stb.fuatmorel_save_v2_yedek = JSON.stringify({ t: T0, s: { coins: 10, trReset: 1, trophies: { TAFTAF: 123, Kral: 7 }, stats: { playSec: 4000 } } });
    const bi2 = Fb.meta.backupInfo(); ok(bi2.trophies === 130 && bi2.play === 4000, 'yeni yedek özeti ' + JSON.stringify(bi2));

    // (d) lig
    const L = F.meta.league;
    const lgId = [[0, 'bronz'], [299, 'bronz'], [300, 'gumus'], [799, 'gumus'], [800, 'altin'], [1599, 'altin'], [1600, 'elmas'], [2999, 'elmas'], [3000, 'efsane'], [99999, 'efsane'], [-5, 'bronz'], ['x', 'bronz']];
    ok(lgId.every(([t, id]) => L(t).id === id), 'lig sınırları');
    ok(L(0).next === 300 && L(300).next === 800 && L(1600).next === 3000 && L(3000).next === null && L(0).min === 0 && L(800).min === 800, 'lig next/min');
    ok(L(0).n === 'Bronz' && L(300).n === 'Gümüş' && L(800).n === 'Altın' && L(1600).n === 'Elmas' && L(3000).n === 'Efsane' && /^#[0-9a-f]{6}$/i.test(L(300).col), 'lig adı/renk');
    ok(Math.abs(L(150).pct - 0.5) < 1e-9 && L(5000).pct === 1, 'lig ilerleme yüzdesi');

    // (e) profil kartı biçimi
    F = boot({}, virt(T0));
    const keys = ['nick', 'char', 'skin', 'lvl', 'tr', 'play', 'races', 'wins', 'kills', 'best', 'since', 'lg'];
    const typeOk = c => ['nick', 'char', 'skin', 'best', 'lg'].every(k => typeof c[k] === 'string' && c[k]) && ['lvl', 'tr', 'play', 'races', 'wins', 'kills', 'since'].every(k => Number.isInteger(c[k]) && c[k] >= 0);
    let c = F.meta.card();
    ok(deq(Object.keys(c).sort(), keys.slice().sort()) && typeOk(c), 'card() biçimi ' + JSON.stringify(c));
    ok(JSON.stringify(c).length < 300 && deq(JSON.parse(JSON.stringify(c)), c), 'card() küçük düz JSON değil');
    ok(c.best === F.save.selChar && c.tr === 0 && c.races === 0 && c.since === T0, 'boş kart değerleri');
    F.save.trophies.TAFTAF = 100; F.save.trophies.Kral = 250; F.save.nick = 'Emir<b>"'; F.save.level = 9;
    F.save.stats.kills = 2;   // öldürme sayacı 'death' olaylarından gelir (race:end yalnızca mpKills'e ekler)
    rc(F, { rank: 0, id: 'Kral', kills: 2 }); rc(F, { rank: 0, id: 'Kral' }); rc(F, { rank: 2, id: 'LUL' }); rc(F, { rank: 3, id: 'LUL' });
    c = F.meta.card();
    ok(c.tr === 350 && c.lg === 'gumus' && c.lvl >= 9 && c.nick === 'Emirb' && c.races === 4 && c.wins === 2 && c.kills === 2, 'kart istatistikleri ' + JSON.stringify(c));
    F.save.selChar = 'LUL'; ok(F.meta.card().best === 'LUL', 'eşitlikte best = seçili karakter (LUL)');
    F.save.selChar = 'Kral'; ok(F.meta.card().best === 'Kral', 'eşitlikte best = seçili karakter (Kral)');
    F.save.selChar = 'baso'; ok(F.meta.card().best === 'LUL', 'eşitlikte seçili karakter yoksa ORDER sırası: ' + F.meta.card().best);
    F.save.stats.charRaces.Kral = 9; ok(F.meta.card().best === 'Kral', 'en çok yarışılan karakter');
    F.save.selChar = 'Kral';
    // lig yükselişi + trBest (kupa kaybı ilerlemeyi geri almaz) + başarım
    F.save.trophies.TAFTAF = 295; F.save.trophies.Kral = 0; F.save.trophies.LUL = 0; F.meta._normalize();
    let up = null; F.on('meta:league', d => { up = d; });
    rc(F, { rank: 3 });   // trSeen'i 295'e çek (yarış sonu sayımı)
    F.save.trophies.TAFTAF = 310; rc(F, { rank: 0 });
    ok(F.meta.lastRewards.league && F.meta.lastRewards.league.up === true && F.meta.lastRewards.league.id === 'gumus' && up && up.league.id === 'gumus', 'lige yükselme bildirimi');
    ok(F.save.stats.trBest >= 310, 'trBest');
    F.save.trophies.TAFTAF = 100; rc(F, { rank: 3 });
    ok(F.save.stats.trBest >= 310 && F.meta.lastRewards.league.down === true, 'trBest kupa kaybıyla düşmemeli');
    const ach = F.meta.missions('ach').find(a => a.key === 'trophy');
    ok(ach && ach.done && ach.goal === 300 && ach.title === 'Lig Yolcusu I' && /300 kupaya/.test(ach.desc), 'Lig Yolcusu başarımı ' + JSON.stringify(ach));

    // (f) kafa kafaya
    const v = virt(T0); F = boot({}, v); F.save.pid = 'me123';
    const A = { id: 'LUL', pid: 'pa', nick: 'Al<i>', name: 'Ali', ctrl: 'remote' }, B = { id: 'Kral', pid: 'pb', nick: 'Veli', name: 'Veli', ctrl: 'remote' };
    const noise = [{ id: 'Nuss', pid: 'b0', nbot: true, ctrl: 'remote', nick: 'Nuss' }, { pid: 'pc', nick: 'Kopan', ctrl: 'remote', off: true }, { pid: 'b1', ctrl: 'bot', bot: true },
      { pid: 'pg', ctrl: 'spec', ghost: true }, { pid: 'me123', nick: 'Ben', ctrl: 'remote' }, { ctrl: 'remote', nick: 'pidsiz' }];
    v.advance(1000); rc(F, { rank: 1, mp: 1, others: [A, B].concat(noise) });                   // sıra: A, ben, B, gürültü
    let h = F.meta.h2h();
    ok(Object.keys(h).sort().join() === 'pa,pb' && h.pa.l === 1 && h.pa.w === 0 && h.pb.w === 1 && h.pb.l === 0 && h.pa.nick === 'Ali' && h.pa.t === T0 + 1000, 'h2h ilk yarış ' + JSON.stringify(h));
    v.advance(1000); rc(F, { rank: 0, mp: 1, others: [A, B] });
    h = F.meta.h2h(); ok(h.pa.w === 1 && h.pa.l === 1 && h.pb.w === 2 && h.pa.t === T0 + 2000, 'h2h ikinci yarış');
    rc(F, { rank: 2, mp: 0, others: [A, B] }); ok(deq(F.meta.h2h(), h), 'tek oyunculu yarış h2h değiştirdi');
    h.pa.w = 99; ok(F.meta.h2h().pa.w === 1 && F.meta.h2h('pa').w === 1 && F.meta.h2h('yok') === null, 'h2h() kopya döndürmeli');
    for (let i = 0; i < 60; i++) { v.advance(1000); rc(F, { rank: 0, mp: 1, others: [{ id: 'Caner', pid: 'q' + i, nick: 'Q' + i, ctrl: 'remote' }] }); }
    h = F.meta.h2h(); ok(Object.keys(h).length === 50 && h.q59 && h.q10 && !h.q9 && !h.pa, 'h2h sınırı: ' + Object.keys(h).length);
    F.save.h2h = { 'kötü<anahtar': { nick: 'x', w: 1, l: 0, t: 1 }, ok1: { nick: 5, w: -3, l: 'x', t: 'q' }, ok2: { nick: 'Zed', w: 2.9, l: 0, t: 5 }, ok3: 'metin', me123: { nick: 'Ben', w: 3, l: 3, t: 9 } };
    F.meta._normalize();
    ok(deq(Object.keys(F.save.h2h), ['ok2']) && F.save.h2h.ok2.w === 2 && F.save.h2h.ok2.nick === 'Zed', 'h2h temizliği ' + JSON.stringify(F.save.h2h));
    F.save.h2h = Array.from({ length: 80 }, (_, i) => i).reduce((o, i) => (o['x' + i] = { nick: 'N', w: 1, l: 0, t: i + 1 }, o), {}); F.meta._normalize();
    ok(Object.keys(F.save.h2h).length === 50 && F.save.h2h.x79 && !F.save.h2h.x29, 'h2h normalize sınırı');

    // (g) dışa/içe aktarma yeni alanları taşır
    const Fa = boot({}, virt(T0)); Fa.save.pid = 'pidA';
    Fa.save.trophies.Kral = 420; Fa.save.trophies.LUL = 80; Fa.save.stats.playSec = 7777; Fa.save.stats.charRaces.Kral = 5; Fa.save.since = 1.7e12; Fa.save.nick = 'Emir';
    Fa.save.h2h = { pa: { nick: 'Ali', w: 3, l: 1, t: 1.74e12 } };
    const code = await Fa.meta.exportCode();
    const Fc = boot({}, virt(T0)), pid0 = Fc.save.pid;
    const pv2 = await Fc.meta.importCode(code);
    ok(pv2.ok && pv2.preview.trophies === 500 && pv2.preview.play === 7777, 'önizleme kupa/oynama ' + JSON.stringify(pv2.preview));
    ok(pv2.apply() === true, 'apply');
    ok(deq(Fc.save.trophies, Fa.save.trophies) && Fc.save.trReset === 1 && Fc.save.since === 1.7e12 && Fc.save.stats.playSec === 7777 && Fc.save.stats.charRaces.Kral === 5 && deq(Fc.save.h2h, Fa.save.h2h), 'içe aktarma yeni alanları taşımadı');
    ok(Fc.meta.card().play === 7777 && Fc.meta.card().tr === 500 && Fc.meta.card().best === 'Kral' && Fc.save.pid === pid0, 'içe aktarma sonrası kart');
    // eski (trReset'siz) kod içe aktarılınca kupa sıfırlanır
    delete Fa.save.trReset; const codeOld = await Fa.meta.exportCode(); Fa.save.trReset = 1;
    const Fd = boot({}, virt(T0)), pv3 = await Fd.meta.importCode(codeOld);
    ok(pv3.ok && pv3.preview.trophies === 0, 'eski kod önizlemesi kupa göstermemeli: ' + (pv3.preview && pv3.preview.trophies));
    ok(pv3.apply() === true && Fd.ORDER.every(k => Fd.save.trophies[k] === 0) && Fd.save.trReset === 1 && Fd.save.stats.playSec === 7777, 'eski kod kupaları sıfırlamalı, süreyi korumalı');

    // (h) oynama süresi: sanal saat, görünürlük, etkileşim, yarış
    const vp = virt(T0); let writes = 0;
    const sto = new Proxy({}, { set(t, k, val) { if (k === 'fuatmorel_save_v2') writes++; t[k] = val; return true; } });
    F = boot(sto, vp);
    const play = () => F.save.stats.playSec;
    vp.advance(30000); ok(play() === 30 && F.meta.playTime() === 30, 'ilk 30 sn etkileşimsiz ama pencere içinde: ' + play());
    vp.advance(120000); ok(play() === 90, '90 sn etkileşimsizlikten sonra süre işlememeli: ' + play());
    vp.fire('W', 'pointerdown'); vp.advance(21000); ok(play() === 111, 'etkileşimle süre yeniden işlemeli: ' + play());
    F.S.mode = 'race'; vp.advance(300000); ok(play() === 411, 'yarış sürerken etkileşimsiz de sayılmalı: ' + play());
    F.S.paused = true; vp.advance(100000); ok(play() === 411, 'duraklatılmış yarış sayılmamalı: ' + play());
    F.S.paused = false; F.S.mode = 'menu';
    const near = (a, b) => a >= b - 1 && a <= b;   // 3 sn'lik sayım ızgarası yüzünden en çok 1 sn aşağı sapma
    let p0 = play(); vp.fire('W', 'keydown'); vp.advance(9000); ok(near(play(), p0 + 9), 'klavye etkileşimi: ' + (play() - p0));
    vp.hidden = true; vp.fire('D', 'visibilitychange');
    ok(JSON.parse(sto.fuatmorel_save_v2).stats.playSec === play(), 'gizlenince kayıt hemen yazılmalı');
    p0 = play(); vp.advance(60000); ok(play() === p0, 'sayfa gizliyken süre işlememeli: ' + (play() - p0));
    vp.hidden = false; vp.fire('D', 'visibilitychange'); vp.advance(12000); ok(near(play(), p0 + 12), 'görünür olunca süre sürmeli: ' + (play() - p0));
    const pb = play(); vp.advance(1000); vp.fire('W', 'pagehide');
    ok(JSON.parse(sto.fuatmorel_save_v2).stats.playSec === play() && play() >= pb, 'pagehide kaydı');
    ok(F.meta.fmtDur(45) === '45 sn' && F.meta.fmtDur(750) === '12 dk' && F.meta.fmtDur(45000) === '12 sa 30 dk' && F.meta.fmtDur(7200) === '2 sa' && F.meta.fmtDur('x') === '0 sn', 'fmtDur');
    // kayıt seyrekliği: 10 dk yarışta ~20 yazım (her 30 sn), 200 değil
    F.S.mode = 'race'; const w0 = writes; vp.advance(600000); F.S.mode = 'menu';
    ok(writes - w0 >= 15 && writes - w0 <= 24, 'kayıt sıklığı 600 sn → ' + (writes - w0) + ' yazım');
    // saat sıçraması (uyku) tek sayımda en çok 6 sn ekler; geri alınan saat süreyi azaltmaz
    F.S.mode = 'race'; const pj = play(); vp.t += 3600e3; vp.advance(3000); ok(play() - pj <= 10, 'saat sıçraması süreyi şişirdi: ' + (play() - pj));
    const pj2 = play(); vp.t -= 500e3; vp.advance(6000); ok(play() >= pj2, 'geri alınan saat süreyi azalttı'); F.S.mode = 'menu';
    // başarım: Maratoncu (dakika sayılır)
    F.save.stats.playSec = 3600; let mp1 = F.meta.missions('ach').find(a => a.key === 'playTime');
    ok(mp1 && mp1.done && mp1.title === 'Maratoncu I' && mp1.goal === 60 && mp1.prog === 60 && mp1.desc === 'Toplam 1 saat oyna (60 dk)', 'Maratoncu I ' + JSON.stringify(mp1));
    const cl = F.meta.claim(mp1.id); ok(cl && cl.coins === 100, 'Maratoncu I ödülü');
    F.save.stats.playSec = 5 * 3600; mp1 = F.meta.missions('ach').find(a => a.key === 'playTime'); ok(mp1.goal === 300 && mp1.done && mp1.desc === 'Toplam 5 saat oyna (300 dk)', 'Maratoncu II');
    F.meta.claim(mp1.id); F.save.stats.playSec = 24 * 3600; mp1 = F.meta.missions('ach').find(a => a.key === 'playTime');
    ok(mp1.goal === 1440 && mp1.done && mp1.desc === 'Toplam 24 saat oyna (1.440 dk)', 'Maratoncu III');

    // (i) meta:card olayı: ilk bildirim, dakikaya yuvarlanan süre, en çok ~1/sn, olaysız karakter değişimi
    const v3 = virt(T0), F3 = boot({}, v3), evs = [];
    F3.on('meta:card', d => evs.push({ t: v3.t, card: d.card }));
    v3.advance(1400); ok(evs.length === 0, 'ilk bildirim erken geldi');
    v3.advance(200); ok(evs.length === 1 && deq(evs[0].card, F3.meta.card()) && typeOk(evs[0].card), 'ilk meta:card');
    v3.advance(100000);   // 90 sn etkileşim + dakika sınırı: bir kez daha, sonra süre durur
    const nMin = evs.length; ok(nMin === 2 && evs[1].card.play >= 60, 'süre değişimi dakikada bir bildirilmeli: ' + evs.map(e => e.card.play).join());
    v3.advance(20000); ok(evs.length === nMin, 'değişiklik yokken olay yayınlandı');
    F3.save.level = 5; F3.emit('meta:change', {}); ok(evs.length === nMin + 1 && evs[nMin].card.lvl === 5, 'seviye değişimi meta:card yayınlamadı');
    F3.save.level = 6; F3.emit('meta:change', {}); F3.save.level = 7; F3.emit('meta:change', {});
    ok(evs.length === nMin + 1, 'hız sınırı: 1 sn içinde ikinci olay çıktı'); v3.advance(1200);
    ok(evs.length === nMin + 2 && evs[nMin + 1].card.lvl === 7, 'bekleyen son kart yayınlanmalı');
    F3.save.selChar = 'Nuss'; v3.advance(4000); ok(evs.length === nMin + 3 && evs[nMin + 2].card.char === 'Nuss', 'olaysız karakter değişimi 3-4 sn içinde bildirilmeli');
    F3.save.trophies.Kral = 12; rc(F3, { rank: 0 }); v3.advance(1200);
    ok(evs[evs.length - 1].card.races === 1 && evs[evs.length - 1].card.wins === 1 && evs[evs.length - 1].card.char === 'Nuss', 'yarış sonu kartı güncellemeli');
    ok(evs.every((e, i) => i < 2 || e.t - evs[i - 1].t >= 1000), 'olaylar 1 sn\'den sık');

    // (j) bozuk kayıtlarda çökmemeli
    const bz = { fuatmorel_save_v2: JSON.stringify({ trophies: 'x', stats: { playSec: 'abc', charRaces: [1], races: -4, wins: 'q' }, h2h: 'zz', since: 'x', level: 'q', nick: 5, selChar: 'yok' }) };
    let Fz = null, bozukHata = '';
    try { Fz = boot(bz, virt(T0)); const cz = Fz.meta.card(); ok(typeOk(cz) && cz.tr === 0 && cz.play === 0 && cz.char === 'TAFTAF', 'bozuk kayıt kartı ' + JSON.stringify(cz)); Fz.save.stats = null; Fz.meta.card(); Fz.save.stats = {}; Fz.save.trophies = null; Fz.save.nick = null; Fz.meta.card(); Fz.meta.h2h(); Fz.meta.playTime(); } catch (e) { bozukHata = String(e && e.stack || e); }
    ok(!bozukHata, 'bozuk kayıt istisna: ' + bozukHata);
  }
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

/* FUAT MOREL — netgame.js : çok oyunculu YARIŞ (docs/MULTIPLAYER.md bölüm 2). FM.net (ağ) ile FM.game (motor) arasındaki köprü.
   HİÇBİR ŞEY ÇİZMEZ, DOM'a dokunmaz. Tüm API FM.netgame altında; arayüz için olaylar 'mp:*' (Uygulama Notları → netgame).

   Yetki modeli ("herkes kendinden sorumlu"):
   - Her telefon KENDİ yarışçısını (ctrl 'local') simüle eder; ev sahibi botları da ('bot'). Diğerleri 'remote':
     fizik/çarpışma/kutu/altın YOK; FM.net tamponundan ~120 ms gecikmeli ara değerlenir (game.onRemote).
   - Eşya/güç kullanımı olay olarak yayınlanır, herkes aynı varlığı kendi dünyasında kurar (game.castItem/castAbility).
     Hasar yalnızca yerel yetkililere uygulanır (game.harm uzakları atlar); kurban vuruluşunu/ölümünü (öldüren kimliğiyle) yayınlar.
   - Eleme kararı, meteorlar ve tur sonu sıralaması ev sahibinde; tur sonu ctl 'end' ile herkese AYNEN uygulanır.
   - Ev sahibi göçünde yeni ev sahibi botları son uzak durumlarından devralır.
   Tek oyunculu oyuna dokunmaz: S.netRole null iken hiçbir kanca çalışmaz. */
'use strict';
(function (FM) {
  if (!FM || !FM.game) return;
  const S = FM.S, game = FM.game, C = FM.C;

  /* =================== sabitler =================== */
  const NGV = 1;                    // start/end yük sürümü
  const COUNT0 = 3.6;               // geri sayım (game.startRound ile aynı)
  const END_GRACE = 600;            // ms: ev sahibi tur sonu kararından sonra son durumların gelmesini bekler
  const SEND_MS = 33;               // yerel durumu paketleme aralığı (net.js ~10 Hz'e kısar, en günceli gider)
  const EMOTE_T = 3;                // emoji balonu süresi (sn)
  const FINAL_AUTO = 10;            // sn: final sıralamasından sonra herkes otomatik lobiye döner (TUR5 §7)
  const AUTO_MAX = 10;              // sn: turlar arası otomatik geçiş en fazla (kürsüden ~6 sn sonra sonraki tur)
  const CD_SEC = 5;                 // herkes hazır → bu kadar sn geri sayım, sonra yarış kendiliğinden başlar (TUR5 §6)
  const CD_COOL = 1500;             // iptalden sonra yeniden başlamadan önce kısa bekleme (sayı titremesin)
  const SNAP_KEY = 'fm-mpsnap';     // yarış ortasında sayfa yenilenirse aynı yarışçıya dönmek için son konum (localStorage)
  const MAXR = FM.MAXR || 10;
  const DEF = { mode: 'classic', map: 'random', rounds: 3, bots: true, fill: 4, autoNext: 8 };
  // uzak yarışçı durum bayrakları (kompakt bit maskesi, anahtar 'f')
  const F = { g: 1, sl: 2, cl: 4, sm: 8, bl: 16, fi: 32, el: 64, lf: 128, sp: 256, ice: 512, sand: 1024, lift: 2048 };
  // süreler (0.01 hassasiyet, yalnızca > 0 gider) ve tam sayılar (yalnızca ≠ 0 gider)
  const TIM = [['fly', 'fl'], ['dash', 'da'], ['sled', 'se'], ['shield', 'sh'], ['boost', 'bo'], ['padT', 'pd'], ['frozen', 'fr'], ['stun', 'st'],
    ['netted', 'nt'], ['dead', 'dd'], ['inv', 'iv'], ['inked', 'ik'], ['slowT', 'sw'], ['pull', 'pu'], ['bounceT', 'bt']];
  const INT = [['jumps', 'ju'], ['charge', 'ch'], ['coins', 'co'], ['kills', 'k'], ['deaths', 'de'], ['tp', 'j']];
  // gelen olaylardan bu türler, gönderenin ara değerleme gecikmesi kadar bekletilip uygulanır (ekranda gördüğün an ile hizalı)
  const DELAYED = { it: 1, ab: 1, ht: 1, bl: 1, dt: 1, fn: 1, cd: 1 };
  // eşya/güç parametreleri (p): mesajda doğrudan giden alanlar; MOTOR'un eklediği diğer sonlu sayısal alanlar 'q' içinde (2 ondalık)
  const P_DIRECT = { x: 1, y: 1, vx: 1, vy: 1, rx: 1, fy: 1, ax: 1, ay: 1, tgt: 1, tg: 1 };
  const P_KEY = /^[a-z][A-Za-z0-9]{0,11}$/;

  /* =================== yardımcılar =================== */
  const now = () => (FM.net && FM.net.now ? FM.net.now() : Date.now());
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const hasKey = (T, k) => typeof k === 'string' && !!T && Object.prototype.hasOwnProperty.call(T, k);   // '__proto__' vb. geçemez
  const num = v => typeof v === 'number' && isFinite(v);
  const int = (v, d) => num(v) ? Math.round(v) : (d || 0);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const tok = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v) && !(v in Object.prototype);   // '__proto__' vb. kimlik olamaz
  const r1 = v => num(v) ? Math.round(v * 10) / 10 : undefined;
  const r2 = v => num(v) ? Math.round(v * 100) / 100 : undefined;
  const cx = r => r.x + r.w / 2, cy = r => r.y + r.h / 2;
  function cleanNick(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, 14).join('').trim();
  }
  function rid(p) { let s = p || ''; for (let i = 0; i < 8; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[(Math.random() * 32) | 0]; return s; }
  const inRoom = () => !!(FM.net && FM.net.inRoom && FM.net.inRoom());
  const isHost = () => !!(FM.net && FM.net.isHost && FM.net.isHost());
  const myPid = () => (FM.net && FM.net.pid ? FM.net.pid() : 'p0');
  function errLog(where, e) { ST.errs++; if (ST.errs < 30) try { console.error('[netgame ' + where + ']', e); } catch (e2) { } }

  /* =================== durum =================== */
  const M = {
    on: false,          // bir ağ maçı sürüyor (start'tan toLobby'ye / odadan çıkışa kadar)
    phase: 'off',       // 'off' | 'lobby' | 'race' | 'results' | 'final'
    mid: null, round: 0, rounds: 0, mode: 'classic', an: DEF.autoNext,
    tot: {},            // yarışçı kimliği (pid ya da bot id) → maç toplam puanı
    info: {},           // kimlik → {nick, char, skin, bot} (maçın tüm katılımcıları; final listesi için)
    raced: false,       // bu maçta en az bir tur yarıştım (match:end ödülü için)
    spectating: false,  // bu turu izliyorum (geç katıldım)
    late: false, lateT: 0,
    lastStart: null, lastEnd: null, final: null,
    endAt: 0, endTry: 0, autoAt: 0, seq: 0, inRoom: false
  };
  // seviye saati eşitleme (S.lt = (şimdi - t0) / 1000). q = tur anahtarı (seed'den): her durum mesajında gider; net.js tamponunda
  // önceki turdan kalan örnekler (bitiş bayrağı, eski konum, ev sahibinin eski saati) yeni turda YOK SAYILIR.
  const K = { t0: 0, ok: false, lastT: -1, q: -1 };
  const byRid = new Map();                           // kimlik → yarışçı (bu tur)
  const smp = new Map();                             // kimlik → son ara değerlenmiş örnek (karede bir)
  const inQ = [];                                    // bekletilen gelen olaylar
  const outQ = [];                                   // gönderilecek olaylar (karede bir toplu 'b' olayı)
  let lastSmp = 0, lastSend = 0, outSched = false, tickTimer = null;
  const ST = { sent: {}, recv: {}, applied: 0, dropped: 0, errs: 0, batches: 0, batchFail: 0, endsSent: 0 };   // teşhis/test

  /* =================== kimlik / yetki =================== */
  // yerel yetkili: kendi oyuncum ya da (ev sahibinde) bot
  const isAuth = r => !!r && (r.ctrl === 'local' || r.ctrl === 'bot') && typeof r.pid === 'string';
  // canlı ağ yarışı (olay yayınlanır/uygulanır)
  const liveRace = () => M.on && !!S.netRole && (S.mode === 'count' || S.mode === 'race' || S.mode === 'end');
  // gelen olaydaki yarışçı gerçekten göndereninki mi? (insan: kendi pid'i; bot: ev sahibi)
  function own(from, id) {
    const r = byRid.get(id);
    if (!r || r.ctrl !== 'remote') return null;
    if (r.nbot) return from === (FM.net && FM.net.host()) || from === r._src ? r : null;
    return id === from ? r : null;
  }
  function nidAssign(ents, from, n) {
    if (!Array.isArray(ents) || !tok(from) || !num(n)) return;
    ents.forEach((e, i) => { if (e) e.nid = from + '.' + n + (i ? '.' + i : ''); });
  }
  // nişan yönü (TUR5 §2.3): birim vektör, 2 ondalık; (0,0) ya da yoksa GÖNDERİLMEZ (alıcıda varsayılan yön) + ek sayısal p alanları
  function packAim(p, o) {
    if (num(p.ax) && num(p.ay) && (p.ax || p.ay)) { o.ax = r2(clamp(p.ax, -1, 1)); o.ay = r2(clamp(p.ay, -1, 1)); }
    let q = null, n = 0;
    for (const k in p) {
      if (P_DIRECT[k] || !P_KEY.test(k) || !num(p[k])) continue;
      if (++n > 12) break;
      (q || (q = {}))[k] = Math.round(p[k] * 100) / 100;
    }
    if (q) o.q = q;
    return o;
  }
  // alıcı: eski mesajlarda ax/ay yok → p.ax/p.ay tanımsız kalır (varsayılan davranış). Ek alanlar yalnız sonlu sayı, bilinen adları ezmez.
  function unpackAim(d, p) {
    if (num(d.ax) && num(d.ay) && (d.ax || d.ay)) { p.ax = clamp(d.ax, -1, 1); p.ay = clamp(d.ay, -1, 1); }
    if (isObj(d.q)) {
      let n = 0;
      for (const k in d.q) {
        if (++n > 12) break;
        const v = d.q[k];
        if (P_DIRECT[k] || !P_KEY.test(k) || (k in Object.prototype) || p[k] !== undefined || !num(v) || Math.abs(v) > 1e7) continue;
        p[k] = v;
      }
    }
    return p;
  }
  function entByNid(nid) { if (typeof nid !== 'string' || !nid) return null; for (const e of S.ents) if (e.nid === nid) return e; return null; }

  /* =================== durum paketleme (kompakt) =================== */
  function pack(r) {
    if (r.out) return { x: r1(r.x) || 0, y: r1(r.y) || 0, vx: 0, vy: 0, f: F.el, q: K.q };
    const o = { x: r1(r.x) || 0, y: r1(r.y) || 0, vx: Math.round(r.vx) || 0, vy: Math.round(r.vy) || 0, q: K.q };
    let f = 0;
    if (r.onGround) f |= F.g; if (r.slide) f |= F.sl; if (r.climb) f |= F.cl; if (r.slam) f |= F.sm; if (r.balloon) f |= F.bl;
    if (r.finished) f |= F.fi; if (r.face < 0) f |= F.lf; if (r.onIce) f |= F.ice; if (r.onSand) f |= F.sand; if (r.inLift) f |= F.lift;
    if (f) o.f = f;
    if (r.h !== C.RH && num(r.h)) o.h = Math.round(r.h);
    for (const t of TIM) { const v = r[t[0]]; if (num(v) && v > 0) o[t[1]] = Math.round(v * 100) / 100; }
    for (const t of INT) { const v = r[t[0]]; if (num(v) && v) o[t[1]] = Math.round(v); }
    if (r.finished) { o.ft = r2(r.ftime) || 0; o.pc = r.place | 0; }
    if (r.item) o.it = r.item;
    return o;
  }
  // uzak yarışçının fırlatılması / ışınlanması: yerel fizikte olan küçük görsel tepkiler (esneme, buhar, kapı parıltısı)
  function bounceFx(q) {
    const L = S.L, c = cx(q), feet = q.y + q.h;
    for (const m of L.mush) if (c > m.x - 30 && c < m.x + m.w + 30 && Math.abs(feet - (m.y - 24)) < 90) { m.sq = .3; return; }
    for (const m of L.tramp) if (c > m.x - 30 && c < m.x + m.w + 30 && Math.abs(feet - (m.y - 24)) < 90) { m.sq = .35; return; }
    for (const v of L.vents) if (v.kind === 'burst' && c > v.x - 20 && c < v.x + v.w + 20 && Math.abs(feet - v.y) < 110) { FM.fx.puff(c, v.y - 10, 8, 'rgba(255,255,255,.85)', 14, 120); return; }
  }
  function portalFx(q, px) {
    let best = null, bd = 1e9;
    for (const p of S.L.portals) { const d = Math.abs(p.bx - cx(q)) + Math.abs(p.by - (q.y + q.h)); if (d < bd) { bd = d; best = p; } }
    if (!best || bd > 260 || Math.abs(px - best.ax) > 500) return;
    if (game.near({ x: best.ax - 14, w: 28 })) { FM.fx.burst(best.ax, best.ay, ['#c084fc', '#7be3ff', '#ffffff'], 14, 220, 0, 'star'); FM.fx.ring(best.ax, best.ay, 50, '#c084fc', .4, 6); }
    if (game.near({ x: best.bx - 14, w: 28 })) { FM.fx.burst(best.bx, best.by - 40, ['#c084fc', '#7be3ff', '#ffffff'], 14, 220, 0, 'star'); FM.fx.ring(best.bx, best.by - 40, 50, '#7be3ff', .4, 6); }
  }
  // uzak örneği yarışçıya uygula (+ yerelde üretilen animasyon alanları: jumpT, land; ph onRemote'ta)
  function unpack(r, s) {
    const f = s.f | 0, wasG = r.onGround, wasDead = r.dead > 0, j0 = r.jumps | 0, vy0 = r.vy || 0, tp0 = r.tp | 0, slam0 = !!r.slam, x0 = r.x;
    if (f & F.el) {                                    // elendi (ev sahibinin olayı kaçtıysa durumdan)
      if (!r.out) {
        if (M.late && now() - M.lateT < 1500) { r.out = r.elim = true; r.dead = 1e9; r.item = null; }
        else game.eliminate(r, -1);
      }
      return;
    }
    if (num(s.x)) r.x = s.x; if (num(s.y)) r.y = s.y;
    r.vx = num(s.vx) ? s.vx : 0; r.vy = num(s.vy) ? s.vy : 0;
    r.onGround = !!(f & F.g); r.slide = !!(f & F.sl); r.climb = !!(f & F.cl); r.slam = !!(f & F.sm); r.balloon = !!(f & F.bl);
    r.face = f & F.lf ? -1 : 1; r.onIce = !!(f & F.ice); r.onSand = !!(f & F.sand); r.inLift = !!(f & F.lift);
    r.h = num(s.h) && s.h > 4 && s.h < 120 ? s.h : C.RH;
    for (const t of TIM) { const v = s[t[1]]; r[t[0]] = num(v) && v > 0 ? v : 0; }
    for (const t of INT) { const v = s[t[1]]; r[t[0]] = num(v) ? Math.round(v) : 0; }
    r.item = hasKey(FM.ITEMS, s.it) ? s.it : null;
    r.stale = !!s._stale;
    if (!r.onGround) r._avy = r.vy;
    const nearR = !r.dead && game.near && game.near(r);
    if (r.jumps > j0 && !r.onGround && r.dead <= 0) {
      r.jumpT = 1;
      if (nearR) {
        if (r.jumps >= 2) FM.fx.burst(cx(r), r.y + r.h, ['#ffffff', '#bfe9ff'], 7, 110, 300, 'star', 4);
        else FM.fx.puff(cx(r), r.y + r.h, 4, 'rgba(255,255,255,.8)', 7, 70);
      }
    }
    if (!wasG && r.onGround && r.dead <= 0) {
      r.land = clamp((r._avy || 0) / 1300, .25, 1);
      if (nearR && ((r._avy || 0) > 700 || slam0)) FM.fx.puff(cx(r), r.y + r.h, slam0 ? 10 : 5, 'rgba(255,255,255,.85)', slam0 ? 12 : 8, slam0 ? 140 : 70);
    }
    if (wasDead && r.dead <= 0 && nearR) FM.fx.puff(cx(r), cy(r), 10, 'rgba(255,255,255,.9)', 14, 80);
    // fırlatma (mantar / trambolin / gayzer): yerdeki öğe esnesin, gayzerde buhar
    if (nearR && r.vy < -1000 && vy0 > -600 && r.dead <= 0) bounceFx(r);
    // ışınlanma (yeniden doğma değil): iki kapıda da parıltı
    if ((r.tp | 0) !== tp0 && !wasDead && r.dead <= 0 && S.L && S.L.portals.length) portalFx(r, x0);
    // bitiş (olayı kaçtıysa durumdan): yerel sıra ve süre kaydı
    if ((f & F.fi) && !r.finished) game.finishRacer(r, num(s.ft) ? s.ft : S.raceT, true);
  }

  /* =================== motor kancaları =================== */
  game.onRemote = function (r, dt) {
    const s = smp.get(r.pid);
    if (s && s !== r._ns) { r._ns = s; try { unpack(r, s); } catch (e) { errLog('unpack', e); } }
    r.land = Math.max(0, (r.land || 0) - dt * 5); r.jumpT = Math.max(0, (r.jumpT || 0) - dt * 5);
    if (r.dead > 0 || r.out) return;
    if (r.onGround || r.climb) r.ph += (r.climb ? C.CLIMB : Math.abs(r.vx)) * dt * .05; else r.ph += dt * 4;
  };
  game.onNetStep = function (dt) {
    if (!M.on) return;
    const t = now();
    if (inQ.length) runQ(t);
    if (t - lastSmp >= 8) {                            // uzak örnekler karede bir (adım başına değil)
      lastSmp = t;
      const N = FM.net;
      for (const r of S.racers) if (r.ctrl === 'remote' && !r.out) { const s = N.sample(r.pid); smp.set(r.pid, s && s.q === K.q ? s : null); }
    }
    clockStep(t);
    if (S.player && S.player.ghost) followGhost();
    for (const r of S.racers) if (r.emote) { r.emote.t -= dt; if (r.emote.t <= 0) r.emote = null; }
    if (S.player && S.player.ghost && S.player.emote) { S.player.emote.t -= dt; if (S.player.emote.t <= 0) S.player.emote = null; }
    if (S.netRole === 'member' && S.gameMode === 'elim' && S.mode === 'race') game.checkSurvivor();
    if (t - lastSend >= SEND_MS && (S.mode === 'count' || S.mode === 'race' || S.mode === 'end')) { lastSend = t; sendState(); }
    if (M.endAt && t >= M.endAt) sendEnd();
  };
  // ev sahibinde tur sonu koşulu oluştu: kısa bekleme (son durumlar gelsin), sonra sıralamayı yayınla
  game.onEndRound = function () {
    if (!M.on || !isHost()) return;
    if (!M.endAt) M.endAt = now() + END_GRACE;
  };
  /* Mevcut arayüz düğmeleri ağ maçında güvenli çalışsın (arayüz ajanı kendi düğmelerini eklese de):
     - duraklatma "MENÜYE DÖN" (quitRace) / sonuç "maçtan çık" ve final "menü" (toMenu) → odadan çık + ana menü
     - sonuç "SONRAKİ TUR" (next) → yalnızca ev sahibinde hostNext; üyede hiçbir şey (ev sahibi bekleniyor)
     - tek oyunculu maç başlatılırsa (startMatch, ör. final "tekrar oyna") önce odadan çıkılır */
  const quit0 = game.quitRace, menu0 = game.toMenu, next0 = game.next, start0 = game.startMatch;
  game.quitRace = function () { if (M.on && inRoom()) { leave(); return; } return quit0.apply(this, arguments); };
  game.toMenu = function () { if (M.on && inRoom()) { leave(); return; } return menu0.apply(this, arguments); };
  game.next = function () { if (M.on && inRoom()) { if (isHost()) hostNext(); return; } return next0.apply(this, arguments); };
  game.startMatch = function () { if (M.on || inRoom() || (FM.net && FM.net.busy && FM.net.busy())) leave(); return start0.apply(this, arguments); };

  /* =================== saat eşitleme =================== */
  // S.lt (seviye saati: testere/kaya/gayzer evreleri) ve S.raceT herkeste aynı olmalı. Başlangıçta herkes start mesajını
  // aracının ilettiği an + kendi rtt/2 ile hizalar; üyeler sonra ev sahibinin durumundaki L (onun S.lt'si) ile ince ayar yapar.
  function clockStep(t) {
    if (!K.ok || !(S.mode === 'count' || S.mode === 'race' || S.mode === 'end')) return;
    const d = (t - K.t0) / 1000 - S.lt;
    if (Math.abs(d) <= .12) return;
    S.lt += d;
    if (S.mode === 'count') S.countT -= d;             // geri sayım bitince game.step yarışa geçer (KOŞ!)
    else S.raceT = Math.max(0, S.raceT + d);
  }
  function clockSync() {
    if (!M.on || isHost() || M.phase !== 'race') return;
    const h = FM.net.host(); if (!h) return;
    const b = FM.net.buffer(h), e = b.length ? b[b.length - 1] : null;
    if (!e || !e.d || !num(e.d.L) || e.d.q !== K.q || e.t === K.lastT) return;
    K.lastT = e.t;
    let hp = null; for (const p of FM.net.players()) if (p.pid === h) hp = p.ping;
    const my = FM.net.rtt() || 100, lat = ((num(hp) ? hp : my) + my) / 2;
    const est = e.t - lat - e.d.L * 1000;
    const first = !K.ok;
    if (first || Math.abs(est - K.t0) > 400) K.t0 = est; else K.t0 += (est - K.t0) * .15;
    K.ok = true;
    if (first && M.late) {                              // geç katılan: yarışın o anına atla
      const tl = (now() - K.t0) / 1000;
      S.lt = tl;
      if (tl < COUNT0) { S.mode = 'count'; S.countT = COUNT0 - tl; S.raceT = 0; }
      else { S.mode = 'race'; S.countT = 0; S.raceT = tl - COUNT0; }
    }
  }

  /* =================== durum yayını =================== */
  function sendState() {
    const me = S.player, host = S.netRole === 'host';
    const local = me && me.ctrl === 'local';
    if (!local && !host) return;
    const s = local ? pack(me) : { x: 0, y: 0, vx: 0, vy: 0, f: F.sp, q: K.q };
    let bots = null;
    if (host) {
      s.L = Math.round(S.lt * 100) / 100;
      for (const r of S.racers) if (r.ctrl === 'bot') (bots || (bots = {}))[r.pid] = pack(r);
    }
    FM.net.sendState(s, bots);
  }

  /* =================== olay yayını (karede bir toplu) =================== */
  // kuyruk öğesi: [tür, veri, zaman, maç, tur] — toplu mesaj yalnızca aynı maç+tur olaylarını taşır (yeniden denemede tur değişmiş olabilir)
  function out(type, d) {
    outQ.push([type, d, now(), M.mid, M.round]);
    ST.sent[type] = (ST.sent[type] || 0) + 1;
    if (!outSched) { outSched = true; Promise.resolve().then(flushOut); }
  }
  function flushOut() {
    outSched = false;
    if (!outQ.length) return;
    if (!inRoom()) { outQ.length = 0; return; }
    const t = now();
    while (outQ.length && t - outQ[0][2] > 4000) { outQ.shift(); ST.dropped++; }   // bağlantı uzun süre yoksa bayatlar atılır
    if (!outQ.length) return;
    const mid = outQ[0][3], rd = outQ[0][4];
    let n = 0; while (n < outQ.length && n < 40 && outQ[n][3] === mid && outQ[n][4] === rd) n++;
    const part = outQ.slice(0, n);
    const ok = FM.net.sendEvent('b', { mid, rd, l: part.map(x => [x[0], x[1]]) });
    if (ok) { outQ.splice(0, part.length); ST.batches++; }
    else ST.batchFail++;
    if (outQ.length && !outSched) { outSched = true; setTimeout(flushOut, ok ? 0 : 80); }
  }
  // yerel olaylar → ağ (yalnızca yerel yetkili yarışçılar; ağdan uygulananlar d.net taşır)
  function onLocal(ev, fn) { FM.on(ev, d => { if (!d || d.net || !liveRace()) return; try { fn(d); } catch (e) { errLog(ev, e); } }); }
  onLocal('item:use', d => {
    if (!isAuth(d.r)) return;
    const n = ++M.seq, p = d.p || {};
    nidAssign(d.ents, myPid(), n);
    out('it', packAim(p, { r: d.r.pid, k: d.item, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), rx: r1(p.rx),
      t: p.tgt && p.tgt.pid || undefined, ts: Array.isArray(p.tg) ? p.tg.map(q => q && q.pid).filter(tok) : undefined, n }));
  });
  onLocal('ability', d => {
    if (!isAuth(d.r)) return;
    const n = ++M.seq, p = d.p || {};
    nidAssign(d.ents, myPid(), n);
    out('ab', packAim(p, { r: d.r.pid, x: r1(p.x), y: r1(p.y), fy: r1(p.fy), t: p.tgt && p.tgt.pid || undefined, n }));
  });
  onLocal('hit', d => { if (isAuth(d.victim)) out('ht', { v: d.victim.pid, s: d.src && d.src.pid || undefined, k: d.kind, c: d.cause || undefined, n: d.ent && d.ent.nid || undefined }); });
  onLocal('blocked', d => { if (isAuth(d.r)) out('bl', { r: d.r.pid, b: d.by, n: d.ent && d.ent.nid || undefined }); });
  onLocal('death', d => {
    if (!isAuth(d.r)) return;
    out('dt', { r: d.r.pid, s: d.killer && d.killer.pid || undefined, c: d.cause, x: r1(cx(d.r)), y: r1(cy(d.r)), sf: d.self ? 1 : undefined, n: d.ent && d.ent.nid || undefined });
  });
  onLocal('finish', d => { if (isAuth(d.r)) out('fn', { r: d.r.pid, ft: r2(d.time), sv: d.survivor ? 1 : undefined }); });
  onLocal('gate', d => { if (isAuth(d.r)) out('gt', { r: d.r.pid, g: d.n, t: r2(d.r.gateT && d.r.gateT[d.n]) }); });
  onLocal('eliminated', d => { if (S.netRole === 'host' && d.r && d.r.pid) out('el', { r: d.r.pid, g: d.gate }); });
  onLocal('meteor:warn', d => { if (S.netRole === 'host') out('mw', { x: r1(d.x), y: r1(d.y), t: r2(d.t) }); });
  onLocal('coins:drop', d => { if (isAuth(d.r)) out('cd', { r: d.r.pid, x: r1(d.x), y: r1(d.y), n: d.n | 0, key: String(d.key) }); });
  onLocal('coins:pick', d => { if (isAuth(d.r)) out('cp', { id: String(d.id) }); });

  /* =================== olay alımı =================== */
  FM.on('net:event', m => {
    try {
      if (m && m.type === 'cd') { onCd(m); return; }
      if (!m || m.type !== 'b' || !isObj(m.data) || !Array.isArray(m.data.l) || !M.on) return;
      const D = m.data;
      if (D.mid !== M.mid || (D.rd | 0) !== M.round) return;          // başka maçın/turun (geç gelen) olayları
      const from = m.from, lat = num(m.lat) ? m.lat : 100;
      let delay = -1;
      for (const it of D.l.slice(0, 60)) {
        if (!Array.isArray(it) || typeof it[0] !== 'string' || !isObj(it[1]) || !H[it[0]]) continue;
        ST.recv[it[0]] = (ST.recv[it[0]] || 0) + 1;
        if (DELAYED[it[0]]) {
          if (delay < 0) delay = clamp(FM.net.delay(from) | 0, 0, 450);
          inQ.push({ at: now() + delay, from, type: it[0], d: it[1], lat, mid: M.mid, rd: M.round });
        } else apply(from, it[0], it[1], lat);
      }
    } catch (e) { errLog('net:event', e); }
  });
  function runQ(t) {
    let k = 0;
    while (k < inQ.length) {
      const q = inQ[k];
      if (q.at > t) { k++; continue; }
      inQ.splice(k, 1);
      if (q.mid === M.mid && q.rd === M.round) apply(q.from, q.type, q.d, q.lat);
    }
  }
  function apply(from, type, d, lat) {
    if (!S.netRole || !S.L) return;
    try { H[type](from, d, lat); ST.applied++; } catch (e) { errLog('olay ' + type, e); }
  }
  const nearXY = x => !!(game.near && game.near({ x: x - 14, w: 28 }));
  const H = {
    // eşya: aynı varlık herkesin dünyasında (sahibi = o yarışçı, hedefler kimlikle)
    it(from, d) {
      const r = own(from, d.r); if (!r || !hasKey(FM.ITEMS, d.k) || !num(d.x) || !num(d.y)) return;
      const p = unpackAim(d, { x: d.x, y: d.y, vx: num(d.vx) ? d.vx : 0, vy: num(d.vy) ? d.vy : 0, rx: num(d.rx) ? d.rx : r.x });
      if (d.k === 'mis') p.tgt = byRid.get(d.t) || null;
      if (d.k === 'bolt') p.tg = (Array.isArray(d.ts) ? d.ts.slice(0, 6) : []).map(id => byRid.get(id)).filter(Boolean);
      r.item = null;
      const ents = game.castItem(r, d.k, p);
      nidAssign(ents, from, d.n);
      FM.emit('item:use', { r, item: d.k, p, ents, net: true });
    },
    ab(from, d) {
      const r = own(from, d.r); if (!r || !num(d.x) || !num(d.y)) return;
      const p = unpackAim(d, { x: d.x, y: d.y, fy: num(d.fy) ? d.fy : d.y + C.RH / 2 });
      if (r.id === 'Caner' || (typeof d.t === 'string' && byRid.has(d.t))) p.tgt = byRid.get(d.t) || null;
      r.charge = 0;
      const ents = game.castAbility(r, p);
      nidAssign(ents, from, d.n);
      FM.emit('ability', { r, id: r.id, p, ents, net: true });
    },
    // uzak yarışçı kendi telefonunda vuruldu: görsel + öldüren/vuran yerelse görev sayacı (meta 'hit'); ağı tüketen varlık
    ht(from, d) {
      const v = own(from, d.v); if (!v) return;
      const src = byRid.get(d.s) || null, e = entByNid(d.n);
      if (e && e.type === 'net') { e.n = (e.n | 0) + 1; if (e.n >= 2) e.dead = true; FM.fx.sparks(e.x + 22, e.y + 38, 10, '#7be3ff', 300); }
      if (game.near(v)) {
        if (d.k === 'stun' || d.k === 'knock') FM.fx.burst(cx(v), v.y, ['#ffd23f', '#ffffff'], 8);
        else if (d.k === 'freeze') FM.fx.burst(cx(v), cy(v), ['#bfefff', '#ffffff'], 10, 160, 300, 'ice');
        else if (d.k === 'slow') FM.fx.burst(cx(v), cy(v), ['#a855f7', '#3cb371'], 8, 200, 100, 'note');
      }
      FM.emit('hit', { victim: v, src, kind: String(d.k || ''), cause: typeof d.c === 'string' ? d.c : null, net: true });
    },
    bl(from, d) {
      const r = own(from, d.r); if (!r) return;
      if (game.near(r)) {
        if (d.b === 'balloon') FM.fx.burst(cx(r), r.y - 14, ['#ff5a7a', '#ffffff'], 12);
        else FM.fx.burst(cx(r), cy(r), ['#7be3ff', '#ffffff'], 12);
      }
      FM.emit('blocked', { r, by: d.b === 'balloon' ? 'balloon' : 'shield', src: null, cause: null, net: true });
    },
    // uzak yarışçı öldü: akış + efekt; öldüren benim yetkimdeyse öldürme sayısı (durumla herkese gider)
    dt(from, d) {
      const r = own(from, d.r); if (!r) return;
      const killer = byRid.get(d.s) || null, cause = typeof d.c === 'string' ? d.c : 'env', self = !!d.sf;
      if (killer && killer !== r && isAuth(killer)) killer.kills++;
      const e = entByNid(d.n);
      if (e) {
        if (e.type === 'trap') { e.dead = true; e.snap = true; FM.fx.burst(e.x + 17, e.y, ['#888888', '#cccccc'], 10); FM.emit('trap:snap', { e, r, net: true }); }
        else if (e.type === 'saw') { e.k = (e.k | 0) + 1; if (e.k >= 2) { e.life = 0; FM.fx.sparks(e.x, e.y, 12, '#ffe9a0', 320); } }
      }
      const x = num(d.x) ? d.x : cx(r), y = num(d.y) ? d.y : cy(r);
      if (nearXY(x)) {
        FM.fx.burst(x, y, ['#ffffff', '#ffd23f', '#ff5a36', (FM.CH[r.id] || {}).col || '#ffffff'], 22, 340);
        FM.fx.puff(x, y, 8, 'rgba(255,255,255,.85)', 14, 90);
      }
      FM.fx.feed(killer ? killer.name : (self ? r.name : ''), game.deathIcon(cause), r.name);
      FM.emit('death', { r, src: killer, killer, cause, self, net: true });
    },
    fn(from, d) { const r = own(from, d.r); if (r && !r.finished) game.finishRacer(r, num(d.ft) ? d.ft : S.raceT, true); },
    gt(from, d) {
      const r = byRid.get(d.r); if (!r || (r !== own(from, d.r))) return;
      const g = S.L.gates.find(q => q.n === (d.g | 0)); if (g && !r.out) game.passGate(r, g, num(d.t) ? d.t : null);
    },
    // ev sahibinin kararları
    el(from, d) {
      if (from !== FM.net.host() || S.netRole === 'host') return;
      const r = byRid.get(d.r); if (!r) return;
      const g = S.L.gates.find(q => q.n === (d.g | 0)); if (g) g.done = true;
      if (r.out && r.offOut && !r.elim) { r.out = false; r.offOut = false; }
      if (!r.out) game.eliminate(r, num(d.g) ? d.g : -1);
      game.checkSurvivor();
    },
    mw(from, d, lat) {
      if (from !== FM.net.host() || S.netRole === 'host' || !num(d.x)) return;
      game.spawnMeteor(d.x, Math.max(.2, (num(d.t) ? d.t : 1.25) - (lat || 0) / 1000), num(d.y) ? d.y : undefined);
    },
    cd(from, d) { const r = own(from, d.r); if (r && num(d.x) && num(d.y) && d.n > 0 && typeof d.key === 'string') game.dropCoins(d.x, d.y, Math.min(999, d.n | 0), d.key.slice(0, 40)); },
    cp(from, d) { if (typeof d.id === 'string') game.takeDrop(d.id.slice(0, 50)); }
  };

  /* =================== start / next =================== */
  function validChar(c) { return hasKey(FM.CH, c) ? c : 'TAFTAF'; }
  function validCos(type, id, def) { const L = FM.COSMETICS && FM.COSMETICS[type]; return tok(id) && (!L || L.some(x => x.id === id)) ? id : def; }
  function sanitizeStart(P) {
    if (!isObj(P)) return null;
    const nT = FM.THEMES.length;
    let theme = num(P.theme) ? P.theme | 0 : FM.themeIndex(P.theme);
    if (!(theme >= 0 && theme < nT)) theme = 0;
    const rounds = clamp(int(P.rounds, 1), 1, 99), round = clamp(int(P.round, 1), 1, rounds);
    const d = {
      v: P.v, mid: tok(P.mid) ? P.mid : 'm0', seed: num(P.seed) ? P.seed | 0 : 1, theme,
      seq: Array.isArray(P.seq) ? P.seq.slice(0, 99).map(x => (num(x) && x >= 0 && x < nT ? x | 0 : theme)) : [],
      mode: FM.modeById(P.mode) ? P.mode : 'classic', round, rounds,
      an: P.an === 0 ? 0 : clamp(int(P.an, DEF.autoNext), 3, 120), bf: clamp(int(P.bf, 0), 0, MAXR),
      roster: [], bots: [], mods: isObj(P.mods) ? P.mods : null, tot: {}
    };
    const seen = new Set();
    for (const p of Array.isArray(P.roster) ? P.roster : []) {
      if (!isObj(p) || !tok(p.pid) || seen.has(p.pid) || d.roster.length >= MAXR) continue;
      seen.add(p.pid);
      d.roster.push({ pid: p.pid, nick: cleanNick(p.nick) || 'Oyuncu', char: validChar(p.char),
        skin: validCos('skins', p.skin, 'klasik'), trail: validCos('trails', p.trail, 'dust'), plate: validCos('plates', p.plate, 'basic') });
    }
    for (const b of Array.isArray(P.bots) ? P.bots : []) {
      if (!isObj(b) || typeof b.id !== 'string' || !/^b[0-9]{1,2}$/.test(b.id) || seen.has(b.id) || d.roster.length + d.bots.length >= MAXR) continue;
      seen.add(b.id);
      d.bots.push({ id: b.id, char: validChar(b.char), skin: validCos('skins', b.skin, 'klasik'), trail: validCos('trails', b.trail, 'dust'), plate: validCos('plates', b.plate, 'basic') });
    }
    if (isObj(P.tot)) for (const k in P.tot) if (tok(k) && num(P.tot[k])) d.tot[k] = Math.round(P.tot[k]);
    if (!d.seq.length) { for (let i = 0; i < rounds; i++) d.seq.push(theme); }
    d.seq[round - 1] = theme;
    return d.roster.length + d.bots.length ? d : null;
  }
  function ghost() {
    const g = game.mkRacer(validChar(FM.save && FM.save.selChar), 0, true);
    g.ctrl = 'spec'; g.pid = myPid(); g.name = g.nick = (FM.net && FM.net.nick()) || 'Oyuncu';
    g.ghost = true; g.out = true; g.spec = true; g.dead = 1e9; g.bot = true;
    return g;
  }
  function followGhost() {
    const g = S.player, t = S.spec;
    if (t && S.racers.indexOf(t) >= 0) { g.x = t.x; g.y = t.y; g.vx = t.vx; g.vy = t.vy; g.idx = t.idx; g.onGround = t.onGround; g.h = t.h; }
  }
  function beginRace(P, late) {
    const d = sanitizeStart(P);
    if (!d) return false;
    const me = myPid(), host = isHost();
    const newMatch = !M.on || d.mid !== M.mid;
    if (newMatch) { M.tot = {}; M.info = {}; M.raced = false; M.final = null; }
    Object.assign(M.tot, d.tot);
    Object.assign(M, { on: true, phase: 'race', mid: d.mid, round: d.round, rounds: d.rounds, mode: d.mode, an: d.an, lastStart: d,
      lastEnd: null, endAt: 0, autoAt: 0, late: !!late, lateT: now() });
    inQ.length = 0; smp.clear(); byRid.clear();
    K.q = Math.abs(d.seed | 0) % 100000;                // tur anahtarı: eski turun tampondaki örnekleri yok sayılır
    const mods = FM.meta && typeof FM.meta.mods === 'function' ? FM.meta.mods(null, { room: d.mods || true }) : null;
    // insanlar: lobi sırasıyla; takma ad aynıysa "Ali 2"
    const racers = [], nickN = Object.create(null);
    d.roster.forEach((p, i) => {
      const r = game.mkRacer(p.char, i, false);
      nickN[p.nick] = (nickN[p.nick] || 0) + 1;
      r.pid = p.pid; r.name = r.nick = nickN[p.nick] > 1 ? p.nick + ' ' + nickN[p.nick] : p.nick;
      r.ctrl = p.pid === me ? 'local' : 'remote';
      r.skin = p.skin; r.trail = p.trail; r.plate = p.plate;
      racers.push(r);
    });
    // botlar: yalnızca ev sahibinde simüle edilir; aynı karakterden ikinci bot "Kral 2"
    const botN = Object.create(null);
    d.bots.forEach((b, j) => {
      const r = game.mkRacer(b.char, d.roster.length + j, host);
      botN[b.char] = (botN[b.char] || 0) + 1;
      r.pid = b.id; r.nbot = true; r.name = r.nick = botN[b.char] > 1 ? b.char + ' ' + botN[b.char] : b.char;
      r.ctrl = host ? 'bot' : 'remote'; r.bot = host;
      r.skin = b.skin; r.trail = b.trail; r.plate = b.plate;
      racers.push(r);
    });
    for (const r of racers) {
      if (mods) { r.abLv = mods.abLv; r.chargeMul = mods.chargeMul; r.startItem = mods.startItem; }
      r.total = M.tot[r.pid] | 0; r.off = false;
      byRid.set(r.pid, r);
      M.info[r.pid] = { nick: r.name, char: r.id, skin: r.skin, bot: !!r.nbot };
    }
    S.racers = racers;
    const mine = racers.find(r => r.ctrl === 'local') || null;
    S.player = mine || ghost();
    M.spectating = !mine;
    if (mine) { M.raced = true; if (NG.autopilot) mine.bot = true; }
    S.ROUNDS = d.rounds; S.round = d.round; S.gameMode = d.mode; S.themeSeq = d.seq.slice();
    S.netRole = host ? 'host' : 'member';
    if (newMatch || !S.matchStats) S.matchStats = { startedAt: Date.now() };
    game.startRound({ seed: d.seed, themeIdx: d.theme });   // aynı seed + tema + mod → herkeste aynı harita; geri sayım başlar
    S.netRole = host ? 'host' : 'member';
    if (S.player.ghost) { S.player.x = 80; S.player.y = S.L.startY - C.RH; }
    // yarış sürerken geri döndük (sayfa yenilendi / uygulama yeniden açıldı) ve kadrodayız: kaldığımız yerden devam
    if (late && mine && snapRestore(mine, d)) FM.fx.toast('Yarışa geri döndün!', '#7be3ff');
    // saat: start mesajını aracı herkese aynı anda iletir → kendi rtt/2'm kadar geç aldım
    const half = (FM.net.rtt() || 0) / 2;
    if (late) { K.ok = false; K.lastT = -1; S.mode = 'race'; S.countT = 0; S.raceT = 0; S.lt = COUNT0; }
    else { K.t0 = now() - half; K.ok = true; K.lastT = -1; S.lt += half / 1000; S.countT -= half / 1000; }
    if (newMatch) FM.emit('match:start', { racers: S.racers, player: S.player, rounds: S.ROUNDS, mode: S.gameMode, mp: true });
    FM.emit('mp:start', { round: d.round, rounds: d.rounds, mode: d.mode, theme: S.L.theme, late: !!late, spectating: M.spectating, mid: d.mid, newMatch });
    if (M.spectating) FM.emit('mp:waiting', { round: d.round, rounds: d.rounds, late: !!late, phase: 'race' });
    return true;
  }
  function onStartMsg(d) {
    rejoining = null;
    if (CD.left != null) { clearTimeout(CD.timer); CD.timer = null; CD.left = null; CD.at = 0; cdEmit(null, 'start'); }
    beginRace(d, !!(d && d.late));
  }
  FM.on('net:start', d => { try { onStartMsg(d); } catch (e) { errLog('start', e); } });
  FM.on('net:next', d => { try { onStartMsg(d); } catch (e) { errLog('next', e); } });

  /* =================== tur sonu (ev sahibi karar verir, herkes aynen uygular) =================== */
  function mpRanking() {
    // bitirenler kendi telefonlarındaki bitiş süresine göre (saatler eşit), sonra mod kuralı; bitirmeden kopanlar en sonda
    const fin = S.racers.filter(r => r.finished).sort((a, b) => (a.ftime - b.ftime) || (a.place - b.place));
    fin.forEach((r, i) => { r.place = i + 1; });
    const rk = game.ranking();
    const gone = r => r.off && !r.finished;
    return rk.filter(r => !gone(r)).concat(rk.filter(gone));
  }
  function sendEnd() {
    if (!M.on || M.phase !== 'race' || !isHost()) { M.endAt = 0; return; }
    const t = now(); if (t - M.endTry < 900) return;
    M.endTry = t;
    const rk = mpRanking(), rp = game.roundPoints(rk);
    const payload = { v: NGV, mid: M.mid, round: M.round, rounds: M.rounds, mode: S.gameMode, last: M.round >= M.rounds, an: M.an,
      rk: rk.map((r, i) => ({ r: r.pid, rp: rp[i] | 0, t: (r.total | 0) + (rp[i] | 0), f: r.finished ? 1 : 0, p: r.place | 0, ft: r2(r.ftime) || 0,
        c: r.coins | 0, k: r.kills | 0, d: r.deaths | 0, o: r.off ? 1 : 0, e: r.out && r.elim ? 1 : 0, n: r.outN | 0 })) };
    if (FM.net.end(payload)) { M.endAt = 0; ST.endsSent++; }
  }
  function onRoundEnd(d) {
    if (!M.on || d.mid !== M.mid || (d.round | 0) !== M.round || M.phase !== 'race') return;
    M.phase = 'results'; M.endAt = 0;
    const order = [], rp = [], total = [];
    for (const e of Array.isArray(d.rk) ? d.rk.slice(0, MAXR + 4) : []) {
      if (!isObj(e) || !tok(e.r)) continue;
      const t = int(e.t);
      M.tot[e.r] = t;
      const r = byRid.get(e.r);
      if (!r || order.indexOf(r) >= 0) continue;
      r.finished = !!e.f; r.place = int(e.p); r.ftime = num(e.ft) ? e.ft : 0;
      if (!isAuth(r)) { r.coins = int(e.c); r.kills = int(e.k); r.deaths = int(e.d); }
      r.off = !!e.o;                                    // ev sahibinin kararı (yerelde geri dönüşü görmemiş olabiliriz)
      if (e.e && !r.elim) { r.out = r.elim = true; r.outN = int(e.n); r.dead = 1e9; }
      order.push(r); rp.push(int(e.rp)); total.push(t);
    }
    for (const r of S.racers) if (order.indexOf(r) < 0) { order.push(r); rp.push(0); total.push(r.total | 0); }
    M.lastEnd = {
      round: M.round, rounds: M.rounds, mode: S.gameMode, last: M.round >= M.rounds, spectator: M.spectating,
      ranking: order.map((r, i) => ({ pid: r.pid, nick: r.name, char: r.id, skin: r.skin, bot: !!r.nbot, me: r === S.player, rank: i + 1,
        rp: rp[i], total: total[i], finished: !!r.finished, place: r.place | 0, ftime: r.ftime || 0, coins: r.coins | 0, kills: r.kills | 0,
        deaths: r.deaths | 0, off: !!r.off, out: !!r.elim }))
    };
    if (S.netRole && (S.mode === 'count' || S.mode === 'race' || S.mode === 'end')) game.endRound({ ranking: order, rp, total });
    FM.emit('mp:end', M.lastEnd);
    // sonraki tura kalan süre HERKESTE (üyeler de geri sayımı gösterir); yalnız ev sahibi uygular (tick)
    armAuto(num(d.an) ? clamp(d.an, 0, 120) : M.an);
  }
  function standingsPayload() {
    const ids = Object.keys(M.tot);
    const lastRk = {}; (M.lastEnd ? M.lastEnd.ranking : []).forEach((e, i) => { lastRk[e.pid] = i; });
    ids.sort((a, b) => (M.tot[b] - M.tot[a]) || ((lastRk[a] != null ? lastRk[a] : 99) - (lastRk[b] != null ? lastRk[b] : 99)));
    return ids.slice(0, 30).map(id => { const i = M.info[id] || {}; return { r: id, t: M.tot[id] | 0, n: i.nick || id, c: i.char || 'TAFTAF', s: i.skin || 'klasik', b: i.bot ? 1 : 0 }; });
  }
  function onFinal(d) {
    if (!M.on || d.mid !== M.mid || M.phase === 'final') return;
    M.phase = 'final'; M.endAt = 0;
    const st = [];
    for (const e of Array.isArray(d.st) ? d.st.slice(0, 30) : []) {
      if (!isObj(e) || !tok(e.r)) continue;
      M.tot[e.r] = int(e.t);
      st.push({ pid: e.r, total: int(e.t), nick: cleanNick(e.n) || e.r, char: validChar(e.c), skin: validCos('skins', e.s, 'klasik'), bot: !!e.b, me: e.r === myPid() });
    }
    for (const r of S.racers) if (M.tot[r.pid] != null) r.total = M.tot[r.pid];
    M.final = { standings: st, rounds: M.rounds, champion: st.length && st[0].me ? true : false };
    // tur yarıştıysam normal maç sonu (meta ödülü + final ekranı); yalnızca izlediysem yalnızca mp:final
    if (M.raced && S.player && !S.player.ghost && S.racers.indexOf(S.player) >= 0 && S.netRole) game.endMatch();
    FM.emit('mp:final', M.final);
    armAuto(FINAL_AUTO);                                // herkes ~10 sn sonra lobiye döner (ev sahibi uygular, üyeler geri sayımı görür)
  }
  FM.on('net:end', d => { try { if (isObj(d) && d.final) onFinal(d); else if (isObj(d)) onRoundEnd(d); } catch (e) { errLog('end', e); } });
  FM.on('net:toLobby', () => {
    try {
      const was = M.on && !!S.netRole;
      resetMatch('lobby');
      if (was) game.startDemo();
      FM.emit('mp:lobby', { lobby: FM.net.lobby(), back: true });
    } catch (e) { errLog('toLobby', e); }
  });
  function armAuto(sec) { M.autoAt = sec > 0 ? now() + sec * 1000 : 0; }

  /* =================== ev sahibi işlemleri =================== */
  function normCfg(c) {
    c = isObj(c) ? c : {};
    let map = 'random';
    if (c.map != null && c.map !== 'random' && c.map !== '') { const i = FM.themeIndex(typeof c.map === 'string' && isFinite(+c.map) ? +c.map : c.map); if (i >= 0) map = FM.THEMES[i].id; }
    return {
      mode: FM.modeById(c.mode) ? c.mode : DEF.mode, map,
      rounds: num(+c.rounds) && +c.rounds >= 1 ? clamp(Math.round(+c.rounds), 1, 9) : DEF.rounds,
      bots: !(c.bots === false || c.bots === 0 || c.bots === '0'),
      fill: num(+c.fill) && +c.fill >= 2 ? clamp(Math.round(+c.fill), 2, MAXR) : DEF.fill,
      autoNext: c.autoNext === 0 || c.autoNext === '0' ? 0 : (num(+c.autoNext) && +c.autoNext > 0 ? clamp(Math.round(+c.autoNext), 3, AUTO_MAX) : DEF.autoNext)
    };
  }
  function humans() { return FM.net.players().filter(p => !p.off && (p.alive || p.me)); }
  function randomCos() {
    const sk = FM.COSMETICS.skins, tr = FM.COSMETICS.trails, pl = FM.COSMETICS.plates, R = Math.random;
    return { skin: R() < .7 ? 'klasik' : sk[1 + Math.floor(R() * (sk.length - 1))].id, trail: tr[1 + Math.floor(R() * (tr.length - 1))].id,
      plate: R() < .6 ? 'basic' : pl[Math.floor(R() * pl.length)].id };
  }
  function buildRound(o) {
    const roster = o.players.slice(0, MAXR).map(p => ({ pid: p.pid, nick: p.nick, char: p.char, skin: p.skin, trail: p.trail, plate: p.plate }));
    const nb = o.cfg.bots ? clamp(o.cfg.fill - roster.length, 0, MAXR - roster.length) : 0;
    const prev = Array.isArray(o.prevBots) ? o.prevBots : [], bots = [], used = new Set(roster.map(p => p.char));
    for (let i = 0; i < nb; i++) {
      let b = prev[i];
      if (!b) {
        const ids = new Set(bots.map(x => x.id).concat(prev.map(x => x.id)));
        let k = 0; while (ids.has('b' + k)) k++;
        const free = FM.ORDER.filter(c => !used.has(c));
        const ch = free.length ? free[(Math.random() * free.length) | 0] : FM.ORDER[(Math.random() * FM.ORDER.length) | 0];
        b = Object.assign({ id: 'b' + k, char: ch }, randomCos());
      }
      used.add(b.char); bots.push({ id: b.id, char: b.char, skin: b.skin, trail: b.trail, plate: b.plate });
    }
    return { v: NGV, mid: o.mid, seed: (Math.random() * 2147483647) | 0, theme: o.seq[o.round - 1] | 0, seq: o.seq, mode: o.cfg.mode,
      round: o.round, rounds: o.cfg.rounds, an: o.cfg.autoNext, bf: o.cfg.bots ? o.cfg.fill : 0, roster, bots,
      mods: FM.meta && typeof FM.meta.roomMods === 'function' ? FM.meta.roomMods() : null, tot: o.tot || {} };
  }
  /** Ev sahibi: lobi ayarlarıyla maçı başlat. over = ayarların üstüne yazılacaklar (isteğe bağlı). */
  function hostStart(over) {
    if (!isHost()) return false;
    const lob = FM.net.lobby(); if (!lob || lob.st === 'race') return false;
    const cfg = normCfg(Object.assign({}, lob.cfg, isObj(over) ? over : {}));
    const players = humans(); if (!players.length) return false;
    const seq = game.themeSeqFor(cfg.map, cfg.rounds);
    cdStop('start', true);                               // HEMEN BAŞLAT ya da geri sayım bitti
    return FM.net.start(buildRound({ round: 1, cfg, seq, mid: rid('m'), players, prevBots: [], tot: {} }));
  }
  /** Ev sahibi: sonraki tur (son turdan sonra final sıralaması; finalden sonra lobiye). */
  function hostNext() {
    if (!isHost() || !M.on) return false;
    if (M.phase === 'final') return hostToLobby();
    if (M.phase !== 'results') return false;
    M.autoAt = 0;
    if (M.round >= M.rounds) return FM.net.end({ v: NGV, final: 1, mid: M.mid, rounds: M.rounds, st: standingsPayload() });
    const st = M.lastStart; if (!st) return false;
    const cfg = { mode: st.mode, rounds: st.rounds, bots: st.bf > 0, fill: st.bf || DEF.fill, autoNext: st.an };
    return FM.net.next(buildRound({ round: M.round + 1, cfg, seq: st.seq, mid: M.mid, players: humans(), prevBots: st.bots, tot: Object.assign({}, M.tot) }));
  }
  function hostToLobby() { if (!isHost()) return false; M.autoAt = 0; return FM.net.toLobby({ mid: M.mid }); }

  /* =================== herkes hazır → 5 sn geri sayım → otomatik başlama (TUR5 §6) ===================
     Ev sahibi DAHİL odadaki tüm bağlı insanlar HAZIR ise ev sahibi 5 sn sayar ve her saniye üyelere 'cd' olayı yollar.
     Biri hazırı geri alır / yeni biri girer / biri çıkarsa iptal. Sayaç biterse hostStart(). Tek insan varken HAZIRIM da sayar.
     Her istemcide 'mp:countdown {left: 5..1 | null, reason?: 'unready'|'join'|'leave'|'start'}'; FM.netgame.countdown(). */
  const CD = { left: null, at: 0, ids: '', k: 0, cool: 0, timer: null, last: 0, src: null };
  function cdEmit(left, reason) { const d = { left }; if (reason) d.reason = reason; FM.emit('mp:countdown', d); }
  function cdSend(left, reason) { if (FM.net && FM.net.inRoom()) FM.net.sendEvent('cd', { l: left, k: CD.k, r: reason || undefined }); }
  function cdStop(reason, send) {
    clearTimeout(CD.timer); CD.timer = null;
    if (CD.left == null) return;
    CD.left = null; CD.at = 0; CD.cool = now() + CD_COOL;
    if (send) cdSend(null, reason);
    cdEmit(null, reason || undefined);
  }
  function cdStart(ids) {
    CD.k++; CD.ids = ids; CD.at = now() + CD_SEC * 1000; CD.left = CD_SEC; CD.src = myPid();
    cdSend(CD_SEC); cdEmit(CD_SEC);
    cdSched();
  }
  // saniye sınırlarında tam zamanında (4 Hz tikten bağımsız) bir sonraki sayı / başlatma
  function cdSched() {
    clearTimeout(CD.timer);
    if (CD.left == null) return;
    const rem = CD.at - now(), next = rem - Math.floor((rem - 1) / 1000) * 1000;
    CD.timer = setTimeout(cdStep, Math.max(20, Math.min(1000, next) + 5));
  }
  const cdStep = function () {
    try {
      CD.timer = null;
      if (CD.left == null || !isHost()) return;
      if (!lobbyCheck()) return;                         // iptal edildi
      const rem = CD.at - now();
      if (rem <= 30) { cdStop('start', true); hostStart(); return; }
      const left = Math.ceil(rem / 1000);
      if (left !== CD.left) { CD.left = left; cdSend(left); cdEmit(left); }
      cdSched();
    } catch (e) { errLog('cd', e); }
  };
  // ev sahibi: lobi durumunu değerlendir (geri sayımı başlat / iptal et). Geri sayım sürüyorsa true.
  function lobbyCheck() {
    const lob = inRoom() ? FM.net.lobby() : null;
    if (!isHost() || M.on || !lob || lob.st !== 'lobby') { if (CD.left != null && isHost()) cdStop(null, true); return false; }
    const hs = humans(), ids = hs.map(p => p.pid).sort().join(',');
    const all = hs.length > 0 && hs.every(p => p.ready);
    if (CD.left == null) { if (all && now() >= CD.cool) cdStart(ids); return CD.left != null; }
    if (ids !== CD.ids) {
      const prev = CD.ids.split(',');
      cdStop(hs.some(p => prev.indexOf(p.pid) < 0) ? 'join' : 'leave', true);
      return false;
    }
    if (!all) { cdStop('unready', true); return false; }
    return true;
  }
  // üye: ev sahibinin sayımı (kaybolan mesajda yerel tahminle sürer; ev sahibi susarsa söner)
  function onCd(m) {
    if (!isObj(m.data) || M.on || isHost() || !FM.net || m.from !== FM.net.host()) return;
    const d = m.data, l = d.l == null ? null : int(d.l);
    if (l != null && !(l >= 1 && l <= 9)) return;
    const reason = d.r === 'unready' || d.r === 'join' || d.r === 'leave' || d.r === 'start' ? d.r : undefined;
    CD.last = now(); CD.src = m.from;
    if (l == null) { if (CD.left != null) { CD.left = null; CD.at = 0; cdEmit(null, reason); } return; }
    CD.at = now() + l * 1000 - clamp(num(m.lat) ? m.lat : 0, 0, 600);
    if (l !== CD.left) { CD.left = l; cdEmit(l); }
  }
  function memberCdTick() {
    if (CD.left == null || isHost()) return;
    const t = now(), est = Math.ceil((CD.at - t) / 1000);
    if (t > CD.at + 2500 || (FM.net && CD.src !== FM.net.host())) { CD.left = null; CD.at = 0; cdEmit(null); return; }   // ev sahibi sustu / değişti
    if (est >= 1 && est < CD.left) { CD.left = est; cdEmit(est); }
  }

  /* =================== odaya geri dönüş (TUR5 §7) =================== */
  // {code, mins, nick (ev sahibinin takma adı | null)} | null — son 15 dk içinde girilen oda (şu an o odada değilsen)
  function rejoinInfo() {
    const rec = FM.net && typeof FM.net.lastRoom === 'function' ? FM.net.lastRoom() : null;
    if (!rec) return null;
    if (FM.net.busy() && FM.net.code() === rec.code) return null;
    return { code: rec.code, mins: Math.max(0, Math.round((Date.now() - rec.t) / 60000)), nick: rec.hn || null };
  }
  let rejoining = null;
  /** Son odaya geri dön. true = deneme başladı ('mp:rejoining {code}'; başarısızsa 'mp:left {reason: 'rejoin-failed'}'). */
  function rejoin() {
    const info = rejoinInfo(); if (!info || !FM.net.available()) return false;
    const rec = FM.net.lastRoom();
    rejoining = info.code;
    const ok = !!FM.net.joinRoom(info.code, { rejoin: true, broker: rec ? rec.broker : undefined });
    if (!ok) { rejoining = null; FM.emit('mp:left', { reason: 'rejoin-failed', code: info.code }); }
    return ok;
  }
  FM.on('net:rejoining', d => { try { rejoining = d && d.code || rejoining; FM.emit('mp:rejoining', { code: d && d.code }); } catch (e) { errLog('rejoining', e); } });
  FM.on('net:error', d => {
    try {
      if (!isObj(d) || !d.rejoin) return;
      rejoining = null;
      FM.emit('mp:left', { reason: 'rejoin-failed', code: typeof d.room === 'string' ? d.room : null, err: d.code });
    } catch (e) { errLog('rejoin-err', e); }
  });
  // açılışta: ?oda= linki yoksa ve başka sekme o odada değilse son odaya otomatik dön
  function autoRejoin() {
    const q = FM.params || {};
    if (q.oda || q.mp || q.rejoin === '0' || !FM.net || !FM.net.available() || FM.net.busy()) return;
    const rec = FM.net.lastRoom(); if (!rec) return;
    if (!rec.closed && Date.now() - rec.live < 12000) return;      // başka bir sekme şu an odada (kaydı tazeliyor)
    rejoin();
  }

  /* ---- yarış ortasında yenileme: aynı yarışçıya kaldığı yerden dönüş ---- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  let snapT = 0;
  function snapSave() {
    const r = S.player;
    if (!M.on || M.phase !== 'race' || !r || r.ctrl !== 'local' || !S.L || !(S.mode === 'race' || S.mode === 'end')) return;
    snapT = now();
    lsSet(SNAP_KEY, JSON.stringify({ mid: M.mid, rd: M.round, q: K.q, t: Date.now(), x: r1(r.x), y: r1(r.y),
      sx: r.safe ? r1(r.safe.x) : null, sy: r.safe ? r1(r.safe.y) : null, co: r.coins | 0, k: r.kills | 0, de: r.deaths | 0,
      g: r.gates | 0, ch: r.charge | 0, fin: r.finished ? 1 : 0, ft: r2(r.ftime) || 0, out: r.out && r.elim ? 1 : 0 }));
  }
  function snapRestore(r, d) {
    let o = null; try { o = JSON.parse(lsGet(SNAP_KEY) || 'null'); } catch (e) { o = null; }
    if (!isObj(o) || o.mid !== d.mid || o.rd !== d.round || o.q !== K.q || !num(o.t) || Math.abs(Date.now() - o.t) > 15 * 60000) return false;
    const L = S.L, okx = v => num(v) && v > 0 && v < L.end + 2000, oky = v => num(v) && v > -3000 && v < L.liq;
    if (okx(o.sx) && oky(o.sy)) { r.safe = { x: o.sx, y: o.sy }; r.x = o.sx - r.w / 2; r.y = o.sy - C.RH - 1; }
    else if (okx(o.x) && oky(o.y)) { r.x = o.x; r.y = o.y; }
    else return false;
    r.vx = 0; r.vy = 0; r.tp = (r.tp | 0) + 1; r.inv = 1.5;
    r.coins = clamp(int(o.co), 0, 9999); r.kills = clamp(int(o.k), 0, 999); r.deaths = clamp(int(o.de), 0, 999);
    r.gates = int(o.g) & 0x3ff; r.charge = clamp(int(o.ch), 0, 100);
    // geçtiğin altınları tekrar toplama (aynı altını iki kez sayma)
    const bit = 1 << r.idx; for (const co of L.coins) if (!co.drop && co.x < r.x - 40) co.got = (co.got | 0) | bit;
    if (o.fin) game.finishRacer(r, num(o.ft) ? o.ft : S.raceT, true);
    else if (o.out && S.gameMode === 'elim') { r.out = r.elim = true; r.dead = 1e9; r.item = null; }
    return true;
  }

  /* =================== ev sahibi göçü, kopanlar, odadan çıkış =================== */
  function adoptBot(r) {
    r.ctrl = 'bot'; r.bot = true; r._ns = null; r.stale = false;
    r.ai = { skip: 0, itemT: 1 + Math.random() * 2, abT: 0, slideT: 0, wait: 0 };
    r.ctl = { jh: false, jp: false, dh: false, dp: false, use: false, ab: false };
    r.coy = 0; r.slideT = 0; r.blocked = false; r.lastHitBy = null; r.lastHitT = -9; r.ccImm = 0; r.portCd = 0; r.ventCd = 0;
    // güvenli nokta: altındaki ya da gerideki en yakın sağlam zemin
    const x = cx(r);
    let best = null;
    for (const s of S.L.solids) {
      if (s.float && s.w < 200) continue;
      if (x >= s.x + 30 && x <= s.x + s.w - 30) { if (!best || Math.abs(s.y - (r.y + r.h)) < Math.abs(best.y - (r.y + r.h))) best = { x, y: s.y }; }
    }
    if (!best) for (const s of S.L.solids) if (!s.float && s.x + s.w < x && s.w >= 120 && (!best || s.x + s.w > best.e)) best = { x: s.x + s.w - 60, y: s.y, e: s.x + s.w };
    if (best) r.safe = { x: best.x, y: best.y };
    if (r.slide && r.h !== C.SH) r.h = C.SH;
  }
  FM.on('net:host', d => {
    try {
      if (!isObj(d)) return;
      // geçici aday (onay lobiyle gelir; aday doğru tahmin edildiyse ayrıca onay olayı GELMEZ) → arayüz bildirimi için yine yayınla
      if (d.pending) { FM.emit('mp:host', { me: false, pid: d.pid, prev: d.prev || null, pending: true }); return; }
      if (d.me) {
        if (M.on && S.netRole) {
          S.netRole = 'host';
          for (const r of S.racers) if (r.nbot && r.ctrl === 'remote') adoptBot(r);
        }
        // üyeyken saydığımız süre sürer (yoksa baştan kur)
        if (M.on && M.phase === 'results' && !M.autoAt) armAuto(M.an);
        else if (M.on && M.phase === 'final' && !M.autoAt) armAuto(FINAL_AUTO);
        if (CD.left != null) cdStop(null);               // eski ev sahibinin geri sayımı: yeniden değerlendir
      } else {
        if (S.netRole === 'host') S.netRole = 'member';
        for (const r of S.racers) if (r.nbot && r.ctrl === 'bot') { r.ctrl = 'remote'; r.bot = false; r._ns = null; r._src = d.pid; }
        M.endAt = 0;                                     // otomatik geçiş süresi (gösterim) kalır; uygulamak yeni ev sahibinin işi
      }
      FM.emit('mp:host', { me: !!d.me, pid: d.pid, prev: d.prev || null });
    } catch (e) { errLog('host', e); }
  });
  function markOff(r) {
    r.off = true;
    if (!r.out) { r.out = true; r.offOut = true; r.dead = 1e9; r.item = null; }
    if (S.mode === 'race' || S.mode === 'count') FM.fx.toast(r.name + ': bağlantı koptu', '#ffb3bd');
    FM.emit('mp:drop', { r, pid: r.pid, nick: r.name });
    game.checkSurvivor();
  }
  function markBack(r) {
    r.off = false;
    if (r.offOut && !r.elim) { r.out = false; r.dead = 0; r._ns = null; }
    r.offOut = false;
    FM.emit('mp:back', { r, pid: r.pid, nick: r.name });
  }
  function offScan() {
    if (!M.on || M.phase !== 'race' || !S.netRole) return;
    const map = {}; for (const p of FM.net.players()) map[p.pid] = p;
    for (const r of S.racers) {
      if (r.nbot || r.ctrl !== 'remote') continue;
      const p = map[r.pid], off = !p || p.off || !p.alive;
      if (off && !r.off) markOff(r); else if (!off && r.off) markBack(r);
    }
  }
  function resetMatch(phase) {
    Object.assign(M, { on: false, phase: phase || 'off', round: 0, rounds: 0, spectating: false, late: false, lastStart: null, endAt: 0, autoAt: 0 });
    inQ.length = 0; smp.clear(); byRid.clear(); K.ok = false;
  }
  function leftRoom(reason) {
    const racing = M.on && !!S.netRole;
    if (CD.left != null) { clearTimeout(CD.timer); CD.timer = null; CD.left = null; CD.at = 0; cdEmit(null); }
    resetMatch('off'); outQ.length = 0; M.lastEnd = null; M.final = null;
    if (racing) game.toMenu();
    FM.emit('mp:left', { reason: reason || 'left' });
  }
  /** Odadan çık ve ana menüye dön. */
  function leave() { const was = M.on || inRoom(); if (FM.net && FM.net.inRoom) FM.net.leaveRoom(); if (was && M.phase !== 'off') leftRoom('left'); return true; }
  FM.on('net:status', s => {
    try {
      const inn = !!(s && s.phase === 'in');
      if (s && !s.phase && (M.on || M.inRoom)) leftRoom('status');
      if (inn && !M.inRoom) {
        M.inRoom = true;
        if (!tickTimer && typeof setInterval === 'function') tickTimer = setInterval(tick, 250);
        const lob = FM.net.lobby();
        if (!M.on) { M.phase = 'lobby'; FM.emit('mp:lobby', { lobby: lob, back: false }); }
      } else if (!s || !s.phase) {
        M.inRoom = false;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      }
    } catch (e) { errLog('status', e); }
  });
  // lobi değişince (hazır, katılan, çıkan) geri sayım kararını hemen ver (tik 4 Hz'i beklemeden)
  FM.on('net:players', () => { try { if (!M.on && isHost()) lobbyCheck(); } catch (e) { errLog('players', e); } });
  FM.on('net:lobby', () => { try { if (!M.on && isHost()) lobbyCheck(); } catch (e) { errLog('lobby', e); } });
  FM.on('net:pagehide', () => { try { snapSave(); } catch (e) { errLog('pagehide', e); } });
  try { if (typeof document !== 'undefined' && document && document.addEventListener) document.addEventListener('visibilitychange', () => { try { if (document.hidden) snapSave(); } catch (e) { } }); } catch (e) { }
  FM.on('net:emoji', m => {
    try {
      if (!isObj(m) || typeof m.e !== 'string') return;
      const r = m.me ? S.player : byRid.get(m.from);
      if (r && M.on) r.emote = { id: m.e, t: EMOTE_T };
      FM.emit('mp:emote', { r: r || null, pid: m.from, e: m.e, me: !!m.me });
    } catch (e) { errLog('emoji', e); }
  });
  // 4 Hz: kopan oyuncu taraması, saat ince ayarı, otomatik sonraki tur, tur sonu yeniden deneme, olay kuyruğu
  const tick = function () {
    try {
      if (!M.on) { if (isHost()) lobbyCheck(); else memberCdTick(); return; }
      if (M.phase === 'race' && now() - snapT > 3000) snapSave();
      offScan();
      clockSync();
      const t = now();
      if (M.endAt && t >= M.endAt) sendEnd();
      if (M.autoAt && t >= M.autoAt && isHost()) { M.autoAt = 0; if (M.phase === 'results') hostNext(); else if (M.phase === 'final') hostToLobby(); }
      if (outQ.length && !outSched) { outSched = true; flushOut(); }
      if (inQ.length && !S.netRole) inQ.length = 0;
    } catch (e) { errLog('tick', e); }
  };

  /* =================== genel API =================== */
  const NG = FM.netgame = {
    VER: NGV, DEF: Object.assign({}, DEF), FLAGS: Object.assign({}, F),
    autopilot: false,                    // test: yerel yarışçıyı yapay zekâ sürer
    /** Ağ maçı sürüyor mu (start..toLobby). */
    active: () => M.on,
    /** Ağ yarışı ekranda (duraklatma YOK: main.js simülasyonu durdurmaz). */
    live: () => M.on && !!S.netRole && (S.mode === 'count' || S.mode === 'race' || S.mode === 'end' || S.mode === 'podium'),
    state: () => ({
      on: M.on, phase: M.phase, role: isHost() ? 'host' : (inRoom() ? 'member' : null), spectating: M.spectating, late: M.late,
      round: M.round, rounds: M.rounds, mode: M.mode, mid: M.mid, theme: S.L && S.L.theme ? S.L.theme.id : null,
      autoLeft: NG.autoLeft(), countdown: CD.left, lastEnd: M.lastEnd, final: M.final
    }),
    /** Otomatik sonraki tura / lobiye kalan sn (yoksa null) — HERKESTE (üyeler de); uygulayan ev sahibi. */
    autoLeft: () => (M.autoAt ? Math.max(0, Math.ceil((M.autoAt - now()) / 1000)) : null),
    cancelAuto: () => { M.autoAt = 0; return true; },
    /** Lobide "herkes hazır" geri sayımı: kalan sn (5..1) ya da null. Olay: 'mp:countdown {left, reason?}'. */
    countdown: () => CD.left,
    /** Son odaya geri dönüş: {code, mins, nick} | null / dene (bool) / kaydı unut. */
    rejoinInfo: () => { try { return rejoinInfo(); } catch (e) { errLog('rejoinInfo', e); return null; } },
    rejoin: () => { try { return rejoin(); } catch (e) { errLog('rejoin', e); return false; } },
    forgetRoom: () => { try { return !!(FM.net && FM.net.forgetRoom && FM.net.forgetRoom()); } catch (e) { return false; } },
    racer: id => byRid.get(id) || null,
    racers: () => S.racers.slice(),
    totals: () => Object.assign({}, M.tot),
    lastEnd: () => M.lastEnd,
    final: () => M.final,
    defaultCfg: () => normCfg({ mode: FM.save && FM.save.mode, map: 'random', rounds: 3 }),
    normCfg,
    hostStart, hostNext, hostToLobby,
    leave,
    emote: e => !!(FM.net && FM.net.emoji(e)),
    pack, unpack,
    /** Test/teşhis: JSON'a dönüştürülebilir anlık görüntü. */
    debug: () => ({
      M: { on: M.on, phase: M.phase, round: M.round, rounds: M.rounds, mode: M.mode, mid: M.mid, spectating: M.spectating, raced: M.raced, tot: M.tot },
      netRole: S.netRole, mode: S.mode, lt: Math.round((S.lt || 0) * 100) / 100, raceT: Math.round((S.raceT || 0) * 100) / 100, clock: K.ok,
      player: S.player ? { pid: S.player.pid, ghost: !!S.player.ghost, x: Math.round(S.player.x), finished: !!S.player.finished } : null,
      racers: S.racers.map(r => ({ pid: r.pid, name: r.name, id: r.id, ctrl: r.ctrl, idx: r.idx, x: Math.round(r.x), y: Math.round(r.y), dead: r.dead > 0 ? 1 : 0,
        fin: r.finished ? 1 : 0, place: r.place | 0, ft: Math.round((r.ftime || 0) * 100) / 100, out: r.out ? 1 : 0, off: r.off ? 1 : 0, elim: r.elim ? 1 : 0,
        coins: r.coins | 0, kills: r.kills | 0, deaths: r.deaths | 0, total: r.total | 0, rp: r.rp | 0, stale: r.stale ? 1 : 0, item: r.item || null })),
      ents: S.ents.length, nids: S.ents.filter(e => e.nid).length,
      gates: S.L && S.L.gates ? S.L.gates.map(g => (g.off ? '-' : g.done ? 'K' : 'A') + g.pass).join(' ') : '',
      lastEnd: M.lastEnd, final: M.final, stats: JSON.parse(JSON.stringify(ST)), inQ: inQ.length, outQ: outQ.length
    })
  };

  /* =================== geliştirici kancaları: ?dev=1&mp=host | ?dev=1&mp=join&room=KOD =================== */
  // host: &mode=elim&theme=0|id|random&rounds=2&fill=4&bots=0&want=2 (bu kadar oyuncu gelince başlar)&wait=40 (en geç sn)&mpauto=6&broker=1
  // Otomatik pilot varsayılan açık (&auto=0 kapatır). Test düzeneği: dev/mp-browser.js, dev/mp-bots.js
  FM.on('boot', () => {
    const P = FM.params || {};
    setTimeout(() => { try { autoRejoin(); } catch (e) { errLog('autoRejoin', e); } }, 450);   // ?oda= yoksa son odaya dön (TUR5 §7)
    if (!FM.DEV || !P.mp || !FM.net || !FM.net.available()) return;
    NG.autopilot = P.auto !== '0';
    setTimeout(() => {
      try {
        if (P.mp === 'host') {
          const cfg = normCfg({ mode: P.mode, map: P.theme != null ? P.theme : 'random', rounds: P.rounds || 1, bots: P.bots !== '0', fill: P.fill || 4, autoNext: P.mpauto || 6 });
          FM.net.createRoom({ cfg, broker: P.broker != null ? +P.broker : undefined });
          const want = Math.max(1, +P.want || 2), t0 = Date.now(), waitMs = (+P.wait || 60) * 1000;
          const iv = setInterval(() => {
            if (!inRoom()) { if (Date.now() - t0 > waitMs + 20000) clearInterval(iv); return; }
            const n = FM.net.players().filter(p => !p.off).length;
            if (n >= want || Date.now() - t0 > waitMs) { clearInterval(iv); hostStart(); }
          }, 500);
        } else if (P.mp === 'join' && P.room) FM.net.joinRoom(P.room);
      } catch (e) { errLog('dev', e); }
    }, 300);
  });
})(window.FM);

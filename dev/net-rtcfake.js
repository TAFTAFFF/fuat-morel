// Node testleri için SAHTE WebRTC (RTCPeerConnection + negotiated RTCDataChannel), aynı süreçteki hayaletler arasında bellek içi.
// Gerçek tarayıcı davranışının net.js'in kullandığı kısmını taklit eder: createDataChannel({negotiated, id}), createOffer/Answer,
// setLocal/RemoteDescription (SDP içinde sahte kimlik), onicecandidate (bir aday + bitiş), kanal open/message/close, connectionState.
// Ayarlar: gecikme (ms), titreme (sırasız kanal), kayıp oranı (sırasız kanal), kurulum süresi; fail: true → bu tarafın bağlantıları hiç açılmaz.
// Kullanım: const { makeRTC } = require('./net-rtcfake.js'); sandbox.RTCPeerConnection = makeRTC({ lat: 15 }, { fail: false });
'use strict';
const reg = new Map();
let seq = 0;
const NET = { lat: 15, jit: 10, loss: 0.01, setup: 120 };

function later(fn, ms) { setTimeout(() => { try { fn(); } catch (e) { console.error('[rtcfake]', e); } }, ms); }

class FakeChannel {
  constructor(pc, label, o) {
    this.pc = pc; this.label = label; this.id = o.id; this.readyState = 'connecting'; this.bufferedAmount = 0;
    this.lossy = o.maxRetransmits === 0 || o.ordered === false;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('kanal açık değil');
    const peer = this.pc.remote; if (!peer || peer.closedFlag) return;
    const ch = peer.ch[this.id]; if (!ch) return;
    if (this.lossy && Math.random() < NET.loss) return;
    later(() => { if (ch.readyState === 'open' && ch.onmessage) ch.onmessage({ data }); }, NET.lat + (this.lossy ? Math.random() * NET.jit : 0));
  }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; later(() => this.onclose && this.onclose(), 0); }
}

function makeRTC(net, opts) {
  if (net) Object.assign(NET, net);
  opts = opts || {};
  class FakePC {
    constructor(cfg) {
      this.cfg = cfg; this.ch = {}; this.uid = 'f' + (++seq); this.connectionState = 'new'; this.iceGatheringState = 'new';
      this.localDescription = null; this.remote = null; this.closedFlag = false; this.fail = !!opts.fail;
      this.onicecandidate = this.onconnectionstatechange = null;
      reg.set(this.uid, this);
    }
    createDataChannel(label, o) { const c = new FakeChannel(this, label, o || {}); this.ch[c.id] = c; return c; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\no=sahte ' + this.uid + ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'v=0\r\no=sahte ' + this.uid + ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' }); }
    setLocalDescription(d) {
      this.localDescription = d; this.iceGatheringState = 'gathering';
      later(() => {
        this.iceGatheringState = 'complete';
        if (this.onicecandidate) this.onicecandidate({ candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 50000 typ host' } });
        if (this.onicecandidate) this.onicecandidate({ candidate: null });
      }, 5);
      return Promise.resolve();
    }
    setRemoteDescription(d) {
      const m = /o=sahte (f\d+)/.exec(String(d && d.sdp)); const peer = m && reg.get(m[1]);
      if (!peer) return Promise.reject(new Error('sahte SDP çözülemedi'));
      this.remote = peer;
      if (d.type === 'answer') { peer.remote = this; if (!this.fail && !peer.fail) later(() => this.openBoth(), NET.setup); }
      return Promise.resolve();
    }
    openBoth() {
      for (const pc of [this, this.remote]) {
        if (!pc || pc.closedFlag) return;
      }
      for (const pc of [this, this.remote]) {
        pc.connectionState = 'connected'; if (pc.onconnectionstatechange) pc.onconnectionstatechange();
        for (const k in pc.ch) { const c = pc.ch[k]; c.readyState = 'open'; if (c.onopen) c.onopen(); }
      }
    }
    close() {
      if (this.closedFlag) return; this.closedFlag = true; this.connectionState = 'closed'; reg.delete(this.uid);
      for (const k in this.ch) this.ch[k].readyState = 'closed';
      const r = this.remote;
      if (r && !r.closedFlag) later(() => { for (const k in r.ch) r.ch[k].close(); r.connectionState = 'disconnected'; if (r.onconnectionstatechange) r.onconnectionstatechange(); }, 20);
    }
  }
  return FakePC;
}

module.exports = { makeRTC, NET };

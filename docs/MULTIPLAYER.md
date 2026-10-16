# FUAT MOREL — Çok Oyunculu Odalar, Modlar, Yeni Haritalar, Kalıcı Kayıt (tasarım)

Kullanıcının isteği (aynen): "Arkadaşlarla oda kurma, aynı anda 10 kişiye kadar beraber oynama. Herkes kendi telefonundan ama aynı oyunda. Ben arkadaşıma link atacağım, o kendi telefonundan, ben kendi telefonumdan. Farklı haritalar, farklı özellikler, farklı modlar. Girdiğimizde kendi gelişmelerimiz silinmemeli, otomatik olmalı."

Bu belge `docs/CONTRACT.md`'yi GENİŞLETİR (onu da oku). Asıl platform yine yatay telefon.

## 1. Ağ: sunucusuz, hesapsız — herkese açık MQTT aracıları (WebSocket)
GitHub Pages yalnızca statik dosya sunar. Oyuncuları birbirine bağlamak için herkese açık, ücretsiz MQTT aracıları (broker) kullanılır; WebRTC değil, çünkü mobil operatör NAT'larında WebRTC sık başarısız olur, MQTT ise düz WSS bağlantısıdır.
Test edildi (2026-10-16, bu bilgisayardan): 
- `wss://broker.emqx.io:8084/mqtt` — bağlantı ~1.2 sn, gidiş-dönüş ~150 ms
- `wss://test.mosquitto.org:8081/mqtt` — ~0.8 sn, ~80 ms
- `wss://broker.hivemq.com:8884/mqtt` — ~2.7 sn, ~350 ms
- (public.mqtthq.com çalışmadı)
Sıra: emqx → mosquitto → hivemq (UYGULAMADA mosquitto → emqx → hivemq oldu; gerekçe ve ölçüm: "Uygulama Notları"); bağlantı kopar/açılmazsa sıradakine geç. **Odadaki herkes aynı aracıda olmalı**: oda kodu aracı indeksini de taşır (ör. kodun son karakteri) ya da lobi mesajı hangi aracıda olduğunu yayınlar; katılan önce koddaki aracıyı dener.

`js/net.js`: Harici kütüphane YOK — kendi minimal MQTT 3.1.1 istemcimiz (WebSocket alt protokolü `mqtt`, ikili çerçeveler): CONNECT (clean session, keepalive 20 sn, Last Will), CONNACK, SUBSCRIBE/SUBACK, UNSUBSCRIBE, PUBLISH QoS 0 (+ retain bayrağı), PINGREQ/PINGRESP, DISCONNECT; kısmi çerçeve birleştirme; otomatik yeniden bağlanma (üstel bekleme); aracı yedeklemesi. dev/ altında node ile gerçek aracıya karşı test edilebilir (Node 24'te global WebSocket var).

### Konular (topic): `fuatmorel/v1/<ODA>/...`
| Konu | Kim yayınlar | İçerik |
|---|---|---|
| `lobby` (retain) | ev sahibi | oda durumu: oyuncular, mod, harita, tur, durum (lobby/race/results), ev sahibi pid, sürüm |
| `join` | katılan | `{pid, nick, char, skin, trail, plate, ver}` (ev sahibi kabul eder ve lobby'yi günceller) |
| `bye/<pid>` | Last Will / çıkan | ayrılma |
| `ctl` | ev sahibi | `start {seed, theme, mode, round, rounds, roster, botIds}`, `end {ranking}`, `next`, `toLobby`, `kick` |
| `s/<pid>` | her oyuncu (+ ev sahibi botlar için) | durum anlık görüntüsü ~10 Hz |
| `ev` | herkes | olaylar: eşya kullanımı, güç, ölüm, bitiş, kapı geçişi (eleme), emoji |
| `ping` | herkes | 2 sn'de bir canlılık (pid, rtt ölçümü için zaman damgası) |
Mesajlar kısa anahtarlı JSON (bant genişliği küçük). Oda kodu: 5 karakter, karışmayan harfler (A-Z, 2-9; O/0/I/1 yok).

### Yetki modeli ("herkes kendinden sorumlu")
- Her telefon KENDİ yarışçısını simüle eder (fizik, çarpışma, ölüm) ve durumunu yayınlar. Diğer oyuncular ekranda **uzak yarışçı (remote)** olarak, ~120 ms tamponlu ara değerlemeyle (interpolation) çizilir.
- Botlar yalnızca ev sahibinde simüle edilir; ev sahibi onların durumunu da yayınlar (diğerleri için onlar da remote).
- Eşya/güç kullanımı `ev` ile yayınlanır; her istemci aynı varlığı (testere, dinamit, füze...) kendi dünyasında oluşturur. **Hasar yalnızca istemcinin kendi yetkisindeki yarışçılara uygulanır** (kendi oyuncusu; ev sahibinde botlar). Uzak yarışçıya isabet yerelde uygulanmaz; kurban kendi telefonunda vurulduysa ölümünü `ev` ile yayınlar (öldüren pid ile) → herkes akışta görür, öldürenin istemcisi `kills` sayar.
- Alan etkili güçler (LUL yumruğu, Kral kükremesi, buz fırtınası, mıknatıs, mürekkep, yıldırım) kullanıcının konumu/hedefleriyle yayınlanır; her istemci kendi yetkisindeki yarışçılara uygular.
- Bitiş: her istemci bitiş süresini yayınlar; nihai sıralamayı ev sahibi belirler ve `ctl end` ile yayınlar.
- Ev sahibi düşerse: en küçük pid'li bağlı oyuncu ev sahibi olur (lobby'yi devralır). Yarış ortasındaysa yarış devam eder.
- Sürüm uyuşmazlığında "Sayfayı yenile" uyarısı.
- Çok oyunculuda duraklatma YOK (menü açılır ama yarış sürer).

## 2. game.js entegrasyonu (motor ajanı)
- Yarışçı alanları: `ctrl: 'local'|'bot'|'remote'`, `pid`, `nick` (görünen ad; yoksa karakter adı). `bot` boolean'ı geriye uyum için kalır (`ctrl==='bot'`).
- `remote` yarışçı: fizik yok; `FM.net` tamponundan konum/hız/durum bayrakları ara değerlenir; renderer'ların okuduğu alanlar (slide, h, climb, fly, dash, sled, shield, balloon, boost, padT, frozen, stun, netted, dead, finished, item, charge, ph, land, jumpT, skin, trail, plate) doldurulur. Kutu/altın toplamaz, tehlike çarpışması yok.
- Yarış başlatma: `FM.game.startNetRace({seed, theme, mode, roster, round, rounds})` — aynı seed ile aynı harita (genLevel deterministik, tema açıkça verilir). (UYGULAMA: ayrı bir startNetRace yok; `js/netgame.js` `net:start`/`net:next` yükünden kadroyu kurup `game.startRound` çağırır — bkz. "Uygulama Notları → netgame.js".)
- Sıralama: bitirenler sırayla, sonra x'e göre (uzaklar ara değerlenmiş x).
- 10 yarışçıya kadar: puan tablosu `FM.PTS` 10 kişiye genişletilir (ör. 15,12,10,8,6,5,4,3,2,1); kupa değişimi sıraya göre.
- Kutu bekleme dizisi `cd` uzunluğu 10. Altın bit maskesi 10 bit (sorun yok).

## 3. Modlar (`S.gameMode`) — tek oyunculu ve çok oyunculu ikisinde de
| id | Ad | Kural |
|---|---|---|
| `classic` | Klasik Yarış | Bitişe ilk varan kazanır (mevcut). |
| `elim` | Eleme | Haritada 3-4 eleme kapısı (L.gates). Hayattaki herkes bir kapıdan geçince en son geçen elenir (izleyici olur). Son kalan ya da bitişe ilk varan kazanır. |
| `coins` | Altın Avı | 75 sn süre. Çok daha fazla altın (kümeler, yüksek yollar). Sıralama toplanan altına göre; bitişe varan +15 altın bonus alır ve yarış onun için biter. Ölünce topladığının %20'sini düşürür (yerde parlayan altın). |
| `pure` | Saf Parkur | Eşya kutusu yok, özel güç var. Daha teknik harita (daha çok duvar, platform, ezici). |
| `chaos` | Kaos | Kutular 1.5 sn'de yenilenir, güç 2 kat hızlı dolar, saldırı eşyaları daha sık; ara ara gökten meteor yağar (uyarı gölgesiyle). |

## 4. Yeni haritalar (temalar) — her biri kendi mekaniğiyle
Mevcut: forest (orman), candy (şeker), snow (kar — **yeni mekanik: buzlu zemin parçaları, kaygan**), castle (kale/lav).
Yeni:
| id | Ad | Sıvı | Mekanik |
|---|---|---|---|
| `desert` | Çöl Tapınağı | `quicksand` (bataklık kum) | kum çukurları (yavaşlatan çamur yerine), tapınak sütunları, yuvarlanan kaya (ezici yerine yuvarlanan taş) |
| `space` | Uzay İstasyonu | `plasma` | düşük yerçekimi bölgeleri (mor alan; yerçekimi ×0.55), ışınlanma kapıları (portal çifti: A'ya giren B'den çıkar), neon platformlar |
| `city` | Gece Şehri | `neon` (zehirli yeşil su) | çatılar arası trambolinler, vinçler, neon tabelalar, rüzgâr bacası (yukarı iten hava akımı) |
| `tropic` | Tropik Ada | `water` (deniz) | gayzerler/buhar çıkışı (yukarı iten), palmiye, dalgalı deniz, sallanan köprüler |
Yeni seviye öğeleri: `vents [{x,y,w,h}]` (yukarı iten akım), `portals [{ax,ay,bx,by}]`, `lowg [{x,w}]`, `ice [{x,y,w}]` (kaygan zemin), `gates [{x,y,n}]` (eleme kapısı). Hepsi level.js'te üretilir, game.js'te fiziği, render-world.js'te çizimi.
Ev sahibi haritayı seçer (veya "Rastgele"), tur sayısı 1/3/5, mod, bot doldurma (açık/kapalı; 4 kişiden azsa botlar).

## 5. Kalıcı kayıt — "gelişmelerimiz silinmemeli, otomatik"
- Kayıt zaten otomatik (`FM.persist`) ve sürümlü anahtar (`fuatmorel_save_v2`) — güncellemelerde ASLA silinmez; yeni alanlar varsayılanla eklenir (göç).
- `navigator.storage.persist()` istenir (tarayıcı veriyi kendiliğinden silmesin).
- PWA: `manifest.webmanifest` (ad "Fuat Morel", yatay, tam ekran, ikonlar) + `sw.js` (çevrimdışı önbellek, sürümlü). "Ana ekrana ekle" önerisi: ana ekrandan açılınca hep aynı depolama → ilerleme kaybolmaz.
- UYARI: WhatsApp/Instagram uygulama-içi tarayıcı ayrı depolama kullanır. Link bu tarayıcılardan açılırsa "Chrome'da/Safari'de aç ve ana ekrana ekle" bilgisi göster.
- Kayıt aktarma: Ayarlar → "Kayıt Kodu": (a) kısa bulut kodu — kayıt JSON'u `fuatmorel/v1/save/<8 karakter>` konusuna retain ile yazılır (en iyi çaba; aracı yeniden başlarsa kaybolabilir); (b) uzun çevrimdışı kod (base64). İçe aktarırken ikisi de desteklenir.
- Kalıcı oyuncu kimliği `FM.save.pid` (rastgele) ve takma ad `FM.save.nick` (ilk açılışta sorulur; varsayılan karakter adı).

## 6. Arayüz (ui.js)
- Ana menüde dev "OYNA" yanında "ARKADAŞLARLA" düğmesi → Oda Kur / Koda Katıl.
- Lobi ekranı: büyük oda kodu, "Linki Paylaş" (`navigator.share`, yoksa WhatsApp `https://wa.me/?text=` ve panoya kopyala), oyuncu listesi (portre, takma ad, karakter, ping, hazır işareti, ev sahibi tacı), ev sahibi ayarları (mod, harita, tur, botlar), "BAŞLAT" (ev sahibi), "HAZIRIM" (diğerleri), emoji gönderme.
- Link: `...index.html?oda=KOD` → açılınca doğrudan katılma (takma ad yoksa önce sor).
- Bağlantı durumu göstergesi, yeniden bağlanma, ev sahibi değişimi bildirimi, oda dolu (10) uyarısı.
- Yarışta: 10 kişilik HUD, elenme/izleyici ekranı, Altın Avı sayacı, emoji balonları.
- Sonuç/kürsü: ilk 3 kürsüde, diğerleri listede; çok oyunculuda "Sonraki tur" yalnızca ev sahibinde, diğerlerinde "Ev sahibi bekleniyor".
- Tek oyunculu ekranda mod ve harita seçimi de olsun.

## 7. Test
- `dev/net-test.js`: node ile gerçek aracıya bağlanan 3-9 sahte oyuncu (durum yayınlar, olay yollar) → tarayıcıdaki oyunun odasına katılır.
- Headless Chrome iki sekme (ev sahibi + katılan) aynı odada yarış (YAVAŞ MOD: aynı anda en fazla 2 Chrome).

## Uygulama Notları (ajanlar)

### net.js — `FM.net` ağ katmanı (ağ ajanı)
Yükleme: `core.js → gfx.js → net.js → level.js → game.js …` (index.html; `dev/sim.js` de yükler). WebSocket yoksa (node sim) etkisizdir: oda çağrıları `false` döner + `net:error {code:'nows'}`. Oda işlemi yapılmadıkça bağlantı/zamanlayıcı AÇMAZ. Her giriş noktası try/catch korumalı, exception sızdırmaz. Teşhis: `FM.net.log()` (son 250 satır), `FM.net.debug = true` (konsola yazar).

**Kimlik.** `FM.save.pid` ('p' + 9 karakter [a-z0-9], kalıcı; `FM.resetSave()` sonrası aynı pid geri yazılır). `FM.save.nick` (yoksa seçili karakter adı) ve `FM.save.nickSet` (`false` = kullanıcı henüz takma ad seçmedi → UI ilk çok oyunculu girişte sorsun). `FM.net.setNick(s)` temizler (≤14 karakter), kaydeder, `nickSet=true` yapar, odadaysa herkese yayar. Kayıt içe aktarma (bölüm 5) `pid`'i ÜZERİNE YAZMAMALI (iki cihaz aynı pid → `dup`).

**Aracılar ve oda kodu.** `BROKERS` dizisinin sırası (0 EMQX, 1 Mosquitto, 2 HiveMQ) koda gömülüdür, değiştirme. Tercih/yedek sırası `FM.net.PREF = [1, 0, 2]` → **Mosquitto → EMQX → HiveMQ**. *Tasarımdan bilinçli sapma:* ölçümde herkese açık EMQX istemci başına 1 sn'de ~10 yayından fazlasını SESSİZCE atıyor ve gecikmesi ~2 kat (aşağıdaki tablo). net.js her aracı için kayan 1 sn pencereli yayın bütçesi uygular (EMQX ≤9/sn, durum 6.7 Hz; diğerlerinde durum 10 Hz); önemli mesajlar (ctl/ev/lobby/join/ping) bütçe dolunca sıraya girer, kaybolmaz. Odadaki herkes odanın aracısında kalır; aracı ~27 sn erişilemezse herkes aynı sırayla bir sonrakine geçer. Kod: 5 karakter, alfabe `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; ilk 4 rastgele, 5. karakter = sağlama (3 bit) × 4 + aracı indeksi (2 bit). `parseCode()` linki, küçük harfi, boşluk/tireyi kabul eder; yazım hatalarının çoğu anında `badcode` olur.

**API (`FM.net`)**

| Çağrı | Dönüş / not |
|---|---|
| `available()` | WebSocket var mı |
| `pid()`, `nick()`, `setNick(s)` | kimlik |
| `createRoom({cfg?, profile?, broker?})` | `true` = başladı. Bağlanınca kod üretilir; `net:status` (phase `creating`→`in`) ve `net:lobby` gelir; kod `code()` |
| `joinRoom(kodYaDaLink, {profile?})` | geçersiz kodsa `false` + `net:error badcode`. Kabul edilince phase `in`, `net:lobby` |
| `leaveRoom()` | ev sahibiysen odayı canlı en küçük pid'e devreder; son kişiysen retain lobiyi siler (oda kapanır) |
| `inRoom()`, `busy()` (kurulum/katılma dahil), `isHost()`, `code()`, `host()` (ev sahibi pid), `rtt()` | durum sorguları; rtt = kendi↔aracı gidiş-dönüş ms |
| `status()` | `{conn: 'idle'/'connecting'/'open'/'reconnecting', phase: null/'creating'/'joining'/'in', room, role: 'host'/'member'/null, inRoom, host, me, broker, brokerName, rtt}` |
| `statusText()` | Türkçe kısa durum ("Bağlantı koptu, yeniden bağlanılıyor…" vb.) |
| `lobby()` | `{code, host, me, isHost, st: 'lobby'/'race'/'results', cfg, epoch, v, players, max: 10}` |
| `players()` | `[{pid, nick, char, skin, trail, plate, ready, waiting, off, host, me, alive, ping, idx}]` lobi sırasıyla. `waiting` = yarış sürerken katıldı (bu turu izler, sonraki start/next'te katılır); `off` = yarış/sonuç sırasında düştü (geri gelirse temizlenir, lobiye dönünce silinir); `ping` = o oyuncunun kendi↔aracı rtt'si (ms ya da null) |
| `config()` | cfg kopyası |
| `setProfile({nick?, char?, skin?, trail?, plate?})` | varsayılanlar FM.save'den (selChar, equipped). Lobide karakter/kostüm değişince çağır |
| `setReady(bool)` | toLobby'de herkesinki sıfırlanır |
| `setConfig(obj)` | yalnız ev sahibi; sığ birleştirme, `null` anahtarı siler. Öneri: `{mode: 'classic'/'elim'/'coins'/'pure'/'chaos', map: 'random'/temaId, rounds: 1/3/5, bots: true}`. cfg SÜZÜLMEZ → UI'da `FM.esc` ile göster |
| `start(d)`, `next(d)`, `end(d)`, `toLobby(d?)` | yalnız ev sahibi, `bool`. `d` (JSON nesnesi) herkese AYNEN `net:start/next/end/toLobby` olarak gider — ev sahibine de (aracıdan dönen yankıyla, herkesle aynı anda; yankı 1 sn gelmezse yerelde). Lobi `st`: start/next → race, end → results, toLobby → lobby (çevrimdışılar silinir, hazırlar sıfırlanır) |
| `kick(pid)` | yalnız ev sahibi; atılan bu odaya tekrar giremez |
| `sendState(s, bots?)` | her karede çağrılabilir; aracıya göre ~10 Hz (EMQX 6.7 Hz) kısılır, o anki EN GÜNCEL durum gider. `bots` = `{botId: durum}` (yalnız ev sahibi) aynı mesajda. `s` her seferinde yeni nesne olmalı (`packRacer`) |
| `sample(id, delayMs?)` | id = pid ya da bot id. Ara değerlenmiş durum kopyası (x, y, vx, vy doğrusal; diğer alanlar eski örnekten) + `_age` (son mesajdan beri ms), `_stale` (1 = 1.5 sn'dir veri yok), `_ex` (1 = en fazla 90 ms doğrusal öngörü). Veri yoksa `null`. delay verilmezse göndericiye göre uyarlamalı (~130 ms) |
| `latest(id)`, `buffer(id)`, `delay(id)` | ham son örnek / tampon `[{t: yerel ms, d}]` (son ~1 sn) / uyarlamalı gecikme ms |
| `sendEvent(type, data)` | type `[A-Za-z0-9_-]{1,24}`, data JSON ≤ ~8 KB; KENDİNE GELMEZ; ~20/sn sınır |
| `emoji(e)` | ≤ 8 karakter, 0.7 sn'de bir |
| `packRacer(r, extra?)`, `applyRacer(r, d)`, `FIELDS` | yarışçı ↔ kısa anahtar dönüştürücü (aşağıda) |
| `shareLink(code?)` | sayfa adresi (diğer parametreler atılır) + `?oda=KOD` |
| `codeFromUrl()`, `clearUrlCode()` | açılış linkindeki geçerli kod (yoksa null) / adres çubuğundan `oda` parametresini sil (katıldıktan sonra) |
| `parseCode(s)` | `{code, broker}` ya da null |
| `alive(pid)`, `now()` | canlılık; `performance.now()` |
| `_dbg` | YALNIZ testler (kill, freeze, iç durum) — oyun kullanmaz |

**Olaylar (`FM.on`)**
- `net:status` → `status()` nesnesi (yalnız değişince).
- `net:lobby` → `lobby()` nesnesi (her lobi değişiminde).
- `net:players` → `{code, players}` (liste/canlılık/ping değişince, ≤ 2/sn).
- `net:start` → ev sahibinin start yükü. Yarış sürerken katılan (ya da sayfayı yenileyen) oyuncuya son start/next yükü **`late: true`** eklenmiş olarak gelir → aynı haritayı kur, bu turu izleyici olarak göster.
- `net:next`, `net:end`, `net:toLobby` → yük aynen. Maç başlamamış istemciye `net:next` gelirse start gibi ele al. Bağlantı koptuğu sırada kaçırılan kontrol mesajı, retain lobideki son kontrolle (`cl`) bir kez telafi edilir; aynı mesaj iki kez gelmez.
- `net:event` → `{from: pid, type, data, lat}` (`lat` ≈ tahmini tek yön gecikme ms; mermi vb. için ileri sarmada kullanılabilir).
- `net:emoji` → `{from, e, me, lat}` (kendi emojin de `me: true` ile hemen gelir).
- `net:host` → `{pid, me, prev, pending?}`. `me: true` → artık SEN ev sahibisin: botları son uzak durumlarından devralıp simüle et, `sendState(s, bots)` ile yayınla, sıralama/end senin işin. `pending: true` = geçici aday (onay lobiyle gelir). Eski ev sahibi geri dönünce `me: false` ile üye olur.
- `net:error` → `{code, msg, wasIn?}`; code ∈ `badcode | noroom | full | ver | conn | nows | dup | kicked`. `msg` Türkçe, doğrudan gösterilebilir. Hatadan sonra oda durumu sıfırlanmıştır.
- `net:kicked` → `{by, msg}` (odadan atıldın; oda durumu sıfırlandı).

**Davranış**
- Canlılık: 2 sn'de bir ping (durum akarken ping alanları durum mesajına eklenir, ayrı ping gitmez); 6 sn sessizlik = düştü. Lobi aşamasında düşen listeden çıkar; yarış/sonuçta `off` olur, aynı sayfa geri gelince otomatik yeniden katılır.
- Ev sahibi göçü: ev sahibi 6 sn susarsa (açıkça ayrılırsa hemen) canlı oyuncular arasında en küçük pid ev sahibi olur, `epoch` +1. Çatışmada büyük epoch, eşitse küçük pid kazanır. Yarış sürer.
- Kısa kopma: Last Will 5 sn toleranslı; ev sahibi kısa koparsa göç olmaz. Sayfa gizlenip dönünce / zamanlayıcı boşluğunda bağlantı yoklanır, retain lobi yeniden alınır, diğerlerine 3.5 sn tolerans verilir — oyun tarafında ek iş gerekmez.
- Aynı pid ikinci sekmede/cihazda odaya girerse eski oturum `net:error dup` alır; ev sahibinin kopyası reddedilir.
- Çok oyunculuda DURAKLATMA YOK: main.js `visibilitychange`'de `ui:pause {force: true}` yayıyor; game/ui ajanı çok oyunculu yarışta bunu duraklatmaya çevirmemeli.
- Mesajlar herkese açık aracıdan geçer: sır taşımaz; gelen her alan net.js'te tip/uzunluk süzgecinden geçer (cfg ve olay `data` hariç → bunları kullanan taraf doğrulasın).

**Konular** (`fuatmorel/v1/<KOD>/…`, kısa anahtarlı JSON)
- `lobby` (retain): `{v, h, e, st, cfg, p: [{id, n, c, sk, tr, pl, rd, w, o, sn}], x: [atılan pid], ck, cl: {t, d}, ts}`
- `join`: `{f, sn, v, n, c, sk, tr, pl, rd, re}` (profil/hazır güncellemesi de bu konudan)
- `ctl`: `{t: start/next/end/lobby/kick/rej, h, e, k, d}` (rej: `d = {to, sn, why}`)
- `s/<pid>`: `{t, s: {durum}, b?: {botId: {durum}}, sn?, cn?, p?, r?}`
- `ev`: `{f, e: tür, t, d}` · `ping`: `{f, sn, cn, t, r}` · `bye/<pid>`: `{f, sn, cn, w?}` (w = Last Will)

**Durum anahtarları** (`packRacer`/`applyRacer`; varsayılan 0/false/null GÖNDERİLMEZ; x, y, vx, vy, h hep gider; x/y 0.1, süreler 0.01 hassasiyet):
x→x, y→y, vx→vx, vy→vy, h→h, face→fc, onGround→g, slide→sl, climb→cl, slam→sm, jumps→ju, fly→fl, dash→da, sled→se, shield→sh, balloon→bl, boost→bo, padT→pd, frozen→fr, stun→st, netted→nt, dead→dd, inv→iv, inked→ik, slowT→sw, pull→pu, finished→fi, place→pc, ftime→ft, item→it, charge→ch, coins→co, kills→k, deaths→de, tp→j, elim→el, spec→sp.
- `tp` (ışınlanma sayacı): yeniden doğma/portal gibi ani konum değişiminde oyun `r.tp++` yapmalı → o aralıkta ara değerleme kaydırmaz (>400 px sıçrama da kaydırılmaz).
- `ph`, `land`, `jumpT` gönderilmez: uzak yarışçıda yerelde üret (koşu fazı vx'ten; `jumps` artınca jumpT = 1; `onGround` 0→1 olunca land = 1).
- skin/trail/plate durumda yok → roster / `players()`.
- Ek alan: `packRacer(r, {ek: 1})`; `sample()` aynen döndürür.
- Önerilen olay türleri (game ajanı kesinleştirsin): `item {k, x, y, vx, vy, tgt?}`, `ab {id, x, y, tgt?}`, `death {r, by, cause}`, `fin {r, time}`, `gate {r, g}`, `coin {r, i}`; ev sahibi botlar adına yollarken `r` = bot id.

**Ölçümler** (2026-10-16, bu bilgisayar, `dev/net-test.js`, 4 sahte oyuncu)

| Aracı | Oda kurma | Durum hızı | Durum gecikmesi (tek yön, ort.) | Görsel gecikme (ara değerlemeli) | Olay gecikmesi | Yeniden bağlanma | Göç |
|---|---|---|---|---|---|---|---|
| Mosquitto | 0.6–0.7 sn | ~9 Hz | 90–105 ms | ~200 ms | ~75 ms | ~0.85 sn | ~6.1–6.4 sn |
| EMQX | 0.6–1.1 sn | ~6 Hz | 180–240 ms | ~350 ms | 150–215 ms | 0.9–1.3 sn | ~6.3 sn |
| HiveMQ | ~0.7 sn (bazı denemeler askıda kalıyor → 6 sn zaman aşımı + yeniden deneme) | ~9 Hz | ~85 ms | ~190 ms | ~60 ms | ~0.85 sn | ~6.0 sn |

Start mesajı herkese 3–6 ms farkla ulaştı (ev sahibi dahil).

**Testler.** `node dev/net-test.js [0|1|2|all|cerceve]` — node sahte oyuncular, gerçek aracı: kurma, katılma, lobi eşitlemesi, ayar/hazır/profil, start, durum akışı + ara değerleme, olay/emoji, yok oda, sürüm, üye kopması, ev sahibi kısa kopması, ev sahibi düşüp göç, eski ev sahibinin dönüşü, end/next/toLobby, aynı pid ikinci oturum, atma, 10 kişilik dolu oda, retain temizliği (+ çevrimdışı MQTT çerçeve testi). `node dev/net-browser.js [aracı]` — gerçek oyun sayfası headless Chrome'da (1 Chrome) ev sahibi + 2 node oyuncu; sayfa dondurma (telefon arka planı) → göç → geri dönüş, `?oda=` linki, konsol hataları.

### Motor — modlar, yeni haritalar, 10 yarışçı (motor ajanı: core.js, level.js, game.js, main.js, dev/)
Tek oyunculu (botlarla) tamamen çalışır; ağ entegrasyonu henüz YOK ama aşağıdaki kancalar onun için kuruldu. Eski 4 temada klasik haritalar birebir aynı (aynı seed → önceki sürümle aynı harita; kar yalnızca ayrı bir RNG ile buz parçası kazandı).

**Başlatma.** `FM.game.startMatch({char, rounds, mode, theme, n, seed?, auto?})`
- `mode` ∈ `classic | elim | coins | pure | chaos` (yoksa `FM.save.mode`, o da yoksa classic).
- `theme`: `'random'` (her tur farklı, yalnızca "hazır" temalardan — aşağıda `readyThemes`) | indeks 0..7 | id (`'desert'`) → o tema TÜM turlarda. Yoksa `FM.save.map` (varsayılan 'random'). Eski `themeIdx` (geliştirici) hâlâ kabul edilir.
- `n`: toplam yarışçı 2..10 (yoksa `FM.save.rivals + 1`, varsayılan 4). 7'den fazla yarışçıda karakterler tekrar eder: ikinci kopya `name = nick = 'Kral 2'`, bot kopyalarına farklı kostüm.
- Tur başına tema `S.themeSeq[round-1]`; `game.next()` aynı modda sonraki tura geçer. `startMatch` her seferinde `S.netRole = null` yapar.

**core.js**
- `FM.MAXR = 10`. `FM.PTS = [15,12,10,8,6,5,4,3,2,1]`, `FM.TROPHY = [30,24,18,12,6,-2,-5,-8,-12,-15]`. n kişilik tablo: `FM.ptsFor(n)`, `FM.trophyFor(n)` (eşit aralıklı örnekleme; 4 kişi: puan 15/8/4/1, kupa 30/12/-5/-15 — eski kupa aynen; tek sayıda ortadaki kupa 0). PTS/TROPHY'yi doğrudan indekslemeyin.
- `FM.MODES = [{id, n, ic, d}]` (Türkçe ad/açıklama, arayüzde aynen gösterilebilir), `FM.modeById(id)`. `FM.COINS_TIME = 75`, `FM.COINS_FINISH = 15`.
- `FM.THEMES` 8 tema; SIRA KALICI (ağda indeks gider; yeni tema yalnızca sona). Yeni alanlar: `mech` (kısa Türkçe mekanik açıklaması, hepsinde), `base` (yalnızca yeni temalarda: desert/space/city → 'castle', tropic → 'forest'; render-world bilmediği temayı geçici olarak bununla çizebilir). Yeni sıvılar: desert `quicksand`, space `plasma`, city `neon`, tropic `water`.
- `FM.themeIndex(v)` → indeks ya da -1 (sayı veya id kabul eder).
- `FM.DECOR` yeni tipler (render-world hepsini çizmeli; bilinmeyen tip şimdilik atlanıyor):
  desert back `obelisk, temple_pillar, cactus_big, sphinx` / front `cactus_s, urn, bones, dry_bush` ·
  space back `antenna, fuel_tank, sat_dish, reactor` / front `sci_crate, cables, floor_lamp, canister` ·
  city back `streetlamp, neon_sign, water_tower, crane` / front `trash_can, hydrant, traffic_cone, ac_unit` ·
  tropic back `palm, palm_big, tiki, beach_hut` / front `shell, starfish, beach_grass, coconut`.
- `FM.ALLBITS = 1023` (level.js; 10 yarışçının altın biti).
- Kayıt: `FM.save.mode` ('classic'), `FM.save.map` ('random' | tema id), `FM.save.rivals` (1..9, varsayılan 3) — yoksa varsayılanla eklenir, bozuksa düzeltilir. Arayüz tek oyunculu seçimleri buraya yazıp `startMatch`'i parametresiz de çağırabilir.
- `FM.ITEMS.bolt.d` güncellendi: yıldırım artık en yakın 4 öndekini vurur.

**Harita** `FM.genLevel(round, {seed, theme, mode, len?})` — yalnızca (seed, tema, mod, len) ile belirlenir, yarışçı sayısından bağımsız; Math.random kullanmaz. Uzunluk ~16 bin (Altın Avı ~22 bin). Tüm yeni diziler her zaman var (boşsa `[]`), `L.mode` da var. Bölüm havuzu temaya göre: çöl ezici yerine kaya + kum çukuru, rota çamuru yerine bataklık kum; uzay + düşük yerçekimi çukuru + ışınlanma; şehir + çatı trambolini + rüzgâr bacası; tropik + gayzer + köprü; kar = eski harita + buz. Saf Parkur: kutu yok, daha çok duvar/platform/ezici/testere. Altın Avı: ~4 kat altın (kümeler, `stairs` yüksek yol basamakları). Kaos: kutular ~2 kat sık. Eleme: parkurun %24/44/64/84'ünde düz zeminde kapı.

**Yeni öğeler: fizik + ÇİZİM sözleşmesi** (koordinatlar dünya; "y = zemin üstü" = yürünen yüzey)
| Öğe | Veri | Fizik (game.js) | Çizim isteği |
|---|---|---|---|
| buz (kar) | `ice [{x,y,w}]` | üstünde hız ×1.1 (kayarken ×1.3), hızlanma ×0.35, yavaşlama ×0.15 (kayar) | zemin yüzeyinde parlak mavi-beyaz buz tabakası, x..x+w |
| bataklık kum (çöl) | `quicksand [{x,y,w}]` | hız ×0.45, zıplama ×0.82; güvenli nokta sayılmaz | zemine gömülü koyu, kabarcıklı/dönen kum çukuru, x..x+w (rota içinde genişi de olur) |
| kaya (çöl) | `boulders [{x0,x1,y,r=30,sp,warn,per,ph, bx,by,st,k,rot}]` | st 2'de değen ölür (yer tehlikesi: ertan kızağı/TAFTAF atılımı/kalkan korur). Döngü `game.boulderAt(b, t)` (saf) | x1'in hemen sağında tapınak kapısı/tünel ağzı (yüksekliği ~2r+20). st 0: kapı karanlık; st 1 (k 0→1, 0.8 sn): kapı sarsılır + toz, kaya kapıda (bx = x1+2r→x1) yarı görünür; st 2: (bx,by) merkezli kaya, `rot` radyan döner, arkasında toz; x0'da parçalanma efekti (k→1) |
| rüzgâr bacası (şehir) | `vents` `kind:'lift'` (hep `act`) | bölgede (x..x+w, y-h..y) yukarı ivme, en fazla 700 px/sn tırmanış; yüksek duvarın dibinde → asansör | duvar dibinde ızgaralı baca ağzı (x..x+w, y'de) + yukarı akan hava çizgileri/yapraklar, h boyunca |
| gayzer (tropik) | `vents` `kind:'burst'`, `per,on,ph`, anlık `act,k` | `act` iken ağzın üstünden geçen yukarı fırlar (vy −1250, tuş basılı sayılır) → yukarıdaki altınlı platform | ağız (x..x+w, y): k 0→1 kabarcık/titreme (fışkırma öncesi 0.6 sn), act iken ~h yüksekliğinde su/buhar sütunu |
| ışınlanma (uzay) | `portals [{ax,ay,bx,by,r=22,h=38}]` | A elipsine (ax±r, ay±h; havada, zıplayınca) giren B'ye taşınır (`r.tp++`, 1 sn bekleme) | A: (ax,ay) merkezli mor dönen halka/elips; B: (bx, by−40) merkezli turkuaz çıkış halkası (yerde). İkisini ince noktalı yay ile bağlamak okunabilirliği artırır |
| düşük yerçekimi (uzay) | `lowg [{x,w}]` | gövde merkezi x..x+w içindeyken yerçekimi ×0.55 | bölge boyunca hafif mor/yıldızlı dikey sis + yukarı süzülen parçacıklar (tüm yükseklik) |
| trambolin (şehir) | `tramp [{x,y,w=60,sq}]` | mantar gibi, vy −1400, tuş basılı sayılır → çatılar arası boşluğu hep aşar; `mush {r, kind:'tramp'}` | çatı kenarında çerçeveli trambolin; sq>0 iken esneme (sq en çok 0.35) |
| köprü (tropik) | `bridges [{x,y,w}]` + solids'te `{float:true, bridge:true}` | normal yüzen zemin | `bridge` katısını yüzen platform gibi ÇİZME; halat + tahtalı sallanan köprü çiz (görsel sallanma) |
| eleme kapısı | `gates [{x,y,n,off,pass,done}]` | x'i geçen kaydedilir (`r.gates`), eleme `checkGates` | x'te zeminde (y) büyük kemer/kapı; `off`: soluk/gri (bu yarışçı sayısında kullanılmıyor); açık iken yeşil/parlak; `done`: kapanmış/kırmızı. HUD sırada kaç kişinin geçtiğini `pass` ile gösterebilir |
| düşen altın (Altın Avı) | `coins` öğesi `{drop:true, v, id, t, ready, rest}` | ilk dokunan alır (`got = ALLBITS`), 12 sn ömür | normal altın gibi; `t < 3` iken yanıp sönsün, `v ≥ 3` ise biraz büyük çizilebilir |
| meteor (kaos) | `S.ents` `{type:'meteor', x,y,t,max,r=62,age}` | t=0'da (x, y−8) merkezli r yarıçaplı patlama (`explode`, sahipsiz, cause 'meteor') | render-fx: yerde (x,y) büyüyen kırmızı uyarı gölgesi (oran 1−t/max), son ~0.5 sn gökten çapraz düşen alevli kaya. Çizince `FM.R.meteorFx = true` yapın (game.js'teki yedek kırmızı parıltı kapanır) |

**Modlar (kurallar, game.js)**
- `classic`: değişmedi. İlk bitirenden sonra kalanlara 12 sn; 4'ten fazla yarışçıda kişi başı +1.5 sn (10 kişide 21 sn), kaosta +4.
- `elim`: yalnızca son `min(4, n−1)` kapı etkin (2 kişide 1 kapı). Etkin bir kapıda, hayattaki (elenmemiş) herkesten `k = max(1, floor((kalan−1)/kalan etkin kapı))` kişi dışında hepsi geçince geçemeyen k kişi elenir → son kapıda 1 kişi kalır ve kazanır (`finished`, `place 1`, `finish {survivor:true}`). Güvenlik: ilk geçişten 40 sn sonra en geridekiler elenir. Elenen: `r.out = r.elim = true`, `outN` (sıra), `dead = 1e9` (çizilmez/hedef alınmaz/doğmaz), `eliminated {r, gate}`; oyuncuysa kamera `S.spec`'i izler. Sıralama: bitirenler → kalanlar (x) → elenenler (son elenen önde). HERKES sırasına göre puan alır.
- `coins`: `S.limitT = 75` (kalan `game.timeLeft()`); süre dolunca `timeup {}` + tur biter. Sıralama altına göre (eşitlikte bitiren/önde olan). Bitişe varan +15 (`coins:bonus`) ve onun için yarış biter (12 sn kuralı yok). Ölen altınının %20'sini düşürür (`coins:drop`; çukurda öldüyse son güvenli zemine saçılır). Herkes sırasına göre puan alır. Botlar üstteki altınlar için zıplar.
- `pure`: kutu yok, başlangıç eşyası yok, özel güç var.
- `chaos`: kutu bekleme 1.5 sn (normalde 3.5), güç 2 kat hızlı dolar, saldırı eşyaları ×1.7 (savunma ×0.6), 6-8. sn'den itibaren 7-11 sn'de bir 3-5 meteorluk yağmur (hedef: rastgele bir yarışçının 1.25 sn sonraki tahmini yeri ± sapma). Botlar inişten hemen önce zıplayarak kaçar.
- Kalabalık yarış dengesi (tüm modlar): atılan testere en fazla 2 kişiyi biçip kırılır; yıldırım en yakın 4 öndekini vurur; 5+ kişide (kaos hariç) saldırı eşyası olasılığı %30'a kadar (yıldırım %50) azalır. Sonuç: 10 kişide yarışçı başına ölüm ~1.9 (4 kişide ~2.1).

**Yarışçı alanları (yeni)**: `ctrl` ('local'|'bot'|'remote'), `pid` (null), `nick`, `out`, `elim` (= out; net FIELDS `el`), `outN`, `outT`, `gates` (bit maskesi), `tp` (yeniden doğma ve portalda artar), `onIce`, `onSand`, `inLift`, `bounceT`, `portCd`, `ventCd`. `resetRace` `name/nick/ctrl/pid`'i korur.

**`FM.S` (yeni)**: `gameMode`, `themeSeq`, `lt` (seviye saati: her turun `resetRace`'inde 0, geri sayımda da akar; testere/kaya/gayzer evreleri buna bağlı — `S.T` değil), `limitT`, `spec`, `elimN`, `netRole` (null|'host'|'member'), `meteorT/meteorQ/timeUpSent/dropN` (iç).

**Olaylar (yeni)** — game.js yayınlar:
`portal {r,i,ax,ay,bx,by}` · `vent {r,i,kind:'lift'|'burst'}` (baca: girişte bir kez; gayzer: her fırlatmada) · `mush {r, kind:'tramp'}` (trambolin; mantar sesi/görevi aynen çalışsın diye 'mush' adıyla) · `gate {r,n}` (etkin kapıdan geçiş) · `eliminated {r,gate}` · `finish {r,place,time,survivor?}` · `meteor:shower {n}` · `meteor:warn {x,y,t}` · `meteor {x,y}` (+ her zamanki `explode {owner:null}`) · `coins:drop {r,x,y,n,key,ids}` · `coins:pick {r,id,n}` · `coins:bonus {r,n}` · `coin {r,x,y,n?,drop?}` (düşen altında n = değer) · `timeup {}` · `match:start`/`race:start`/`race:end` yüklerine `mode` (+ race:end'e `n`).

**`FM.game` (yeni API)**
| Çağrı | Not |
|---|---|
| `startMatch(opts)`, `startRound({seed?, themeIdx?})` | yukarıda. startRound temayı `S.themeSeq`'ten alır |
| `readyThemes()` | rastgele seçilebilen tema indeksleri: eski 4 + `FM.R.themeReady(id)` true dönen yeni temalar. **render-world yeni bir temayı tam çizebildiğinde `FM.R.themeReady = id => …` tanımlamalı**; o zamana kadar yeni temalar demo/rastgelede çıkmaz, yalnızca açıkça seçilince açılır |
| `themeSeqFor(theme, rounds, rnd?)` | 'random'/indeks/id → tur başına indeks dizisi (ağda ev sahibi kullanabilir) |
| `ranking()` | moda göre (yukarıda) |
| `timeLeft()` | Altın Avı kalan sn, yoksa null |
| `finishNow()` | yarıştaysa turu o anki sıralamayla bitirir (elenen oyuncuya "Sonuçlara geç" için) |
| `eliminate(r, gate)` | yarışçıyı ele (ağda üyeler ev sahibinin kararını böyle uygular) |
| `checkGates()`, `markGates(r)` | eleme kararı (yalnız `netRole !== 'member'`) / x'e göre kapı geçişi kaydı |
| `spawnMeteor(x, warn?, y?)` | meteor uyarısı başlatır (y verilmezse x'teki en üst zemin); `meteor:warn` yayar |
| `dropCoins(x, y, n, key)` → ids | key'den deterministik saçılma: aynı key her istemcide aynı parçalar (`key:i`) |
| `takeDrop(id)` | düşen altını herkes için kaldır (başkası aldı) |
| `boulderAt(b, t, out?)` | kayanın t seviye saatindeki `{st,k,bx,by}` durumu (saf) |
| `boulderContact(b, r)`, `inLowG(x)`, `focus()` | yapay zekâ/yardımcı: kaya temas süresi; düşük yerçekimi mi; efekt/kamera odağı (elenmişse izlenen) |
| `onRemote` (atanır) | `ctrl === 'remote'` yarışçılar için fizik YERİNE her adımda `game.onRemote(r, dt)` çağrılır (geri sayım dahil); ardından yarışta `markGates(r)` |
| `endRound()`, `die()`, `harm()`, `respawn()`, `nameDupes(racers)` | dışa açık iç fonksiyonlar (ağ/test) |

**main.js**: kamera, oyuncu `out` (ya da `spec`) iken `S.spec`'i izler (game.js her adımda öndeki bitirmemiş yarışçıyı seçer, 150 px eşikle; titremez). `?dev=1&scene=race&mode=elim&n=10&theme=desert` parametreleri eklendi (theme id de olur).

**Ağ entegrasyonu için (sonraki ajan)**
- Aynı harita: herkes `FM.genLevel(round, {seed, theme: indeks, mode})` (ya da `S.gameMode` + `S.themeSeq` kurup `game.startRound({seed})`). Kadroyu `game.mkRacer(id, idx, bot)` ile kurun; `idx` herkeste aynı sırada olsun (kutu `cd[idx]`, altın biti ve düşen altın `key = idx-ölüm` buna bağlı); uzaklara `ctrl:'remote'`, `pid`, `nick`/`name`; sonra `game.nameDupes` gerekirse. `startMatch` netRole'u sıfırlar → ağ yarışında başlattıktan SONRA `S.netRole = 'host'|'member'` yapın.
- `S.lt` geri sayım başında 0 → aynı anda başlayan herkeste kaya/testere/gayzer aynı evrede. Geç katılan: `S.lt = start'tan beri geçen süre` (geri sayım 3.6 sn dahil).
- `S.netRole === 'member'` iken game.js eleme kararı, meteor üretimi ve tur sonu (endRound) YAPMAZ; ev sahibinin yayınlarını uygulayın: `eliminated` → `game.eliminate(r, gate)`, `meteor:warn` → `game.spawnMeteor(x, t, y)` (gecikme kadar t'den düşün), bitiş → `net:end`. Ev sahibinde uzak yarışçının kapı geçişi `markGates` ile ara değerlenmiş x'ten otomatik kaydedilir (~130 ms gecikmeli; istenirse `gate` olayıyla da işaretlenebilir: `r.gates |= 1 << n`).
- Altın Avı: yerel ölümde game.js zaten düşürür ve `coins:drop {key,x,y,n}` yayar → diğerleri `game.dropCoins(x, y, n, key)`; yerel alım `coins:pick {id}` → diğerleri `game.takeDrop(id)`. Harita altınları yarışçı başına (bit) olduğundan eşitleme gerekmez; uzak altın sayısı durumdaki `co`'dan. Süre: ev sahibi `timeup`'ta bitirir.
- `r.elim` = `r.out` (FIELDS `el`). Geç katılan izleyici için öneri: yerel yarışçı `out = elim = spec = true`, `dead = 1e9`, `outN = 0` (sıralamada en sonda kalır; sonuçta gösterme) → kamera `S.spec`'i izler.

**Diğer ajanlara istekler**
- render-world: yeni 4 temanın paleti/arka planı/sıvıları (`quicksand`, `plasma`, `neon`; tropik `water` = deniz), yukarıdaki dekor tipleri ve öğe tablosundaki çizimler; geçici olarak `PAL[theme.id] || PAL[theme.base]` kullanılabilir; hazır olunca `FM.R.themeReady`.
- render-fx: `meteor` varlığı + `FM.R.meteorFx = true`; portal/gayzer/eleme için olay efektleri isteğe bağlı.
- render-hud: 10 kişilik HUD; Altın Avı sayacı (`game.timeLeft()`) ve altın sıralaması; elemede kalan kapı/kişi ve "ELENDİN — izliyorsun: `S.spec.name`" + "Sonuçlara geç" (`game.finishNow()`); kürsüde `ptsFor/trophyFor`.
- ui: tek oyunculu mod/harita/rakip seçimi (`FM.MODES`, `FM.THEMES[i].n/.mech`, `FM.save.mode/map/rivals`, `startMatch({mode, theme, n})`); yardım ekranındaki puan tablosu `FM.ptsFor(4)`/`FM.trophyFor(4)` olmalı (şu an PTS/TROPHY'nin ilk 4'ünü gösteriyor → 15/12/10/8 yanlış); sonuçta mod adı.
- meta: `race:end`'de `playerRank` 0..3'e kırpılıyor → n kişilik ödül (`res.n`); Altın Avı'nda toplanan altın 100-250 (ödül tavanı düşünülebilir), Altın Avı'nda "kazanma" bitişe değil altın sırasına göre (`res.mode === 'coins' && playerRank === 0`).
- audio: yeni olay sesleri (portal, vent, gate, eliminated, meteor:warn/meteor, coins:drop/pick/bonus, timeup) ve yeni temaların müziği (`theme.base` ile geçici).

**Testler** (`dev/`): `node dev/sim.js N [mod] [tema|all] [yarışçı]` (ör. `node dev/sim.js 8 elim all 10`) — her koşuda NaN/takılma (25 sn ilerlememe) denetimi, mod beklentisi (elemede 1 kalan, diğerlerinde herkes bitirir), olay sayaçları. `node dev/deathloop.js N SEED [tema 0..7|id] [mod]` — bitiremeyenlerin yerini ve son ölümlerini de yazar. Sonuçlar (bu bilgisayar): 5 mod × 8 tema, 4/6/7/10 yarışçı, toplam ~150 yarış: hata 0, takılma 0; klasik ~50-55 sn, eleme ~38-41 sn, Altın Avı 65-75 sn (çoğu bitirir, bazıları süreye takılır), kaos 10 kişide ~67 sn ve herkes bitiriyor. Deathloop 20'şer yarış (çöl/uzay/şehir/tropik/kar): kilitlenme yok (tek "bitiremeyen" bitişe 25 px kala süresi dolan bir yarışçı). Eski 4 temanın 100 klasik haritası önceki üreticiyle birebir aynı.

**Bilinen eksikler**: yeni öğeler ve temalar render-world/render-fx'e kadar görünmez (kaya, gayzer, kapı vb. çizilmiyor; yalnızca meteorun yedek parıltısı var) → bu yüzden yeni temalar rastgele/demoda kapalı (`readyThemes`). HUD/arayüz/meta/ses henüz modları bilmiyor (yukarıdaki istekler). Ağ entegrasyonu: `js/netgame.js` (aşağıda).

### netgame.js — `FM.netgame` ağ yarışı köprüsü (ağ-oyun ajanı)
Yükleme: `core → gfx → net → level → game → meta → netgame → audio → …` (index.html; `dev/sim.js` ve deathloop da yükler). `S.netRole` null iken (tek oyunculu, demo) HİÇBİR kancası çalışmaz. Çizim/DOM yok. Ağ yarışı, motor ajanının "Ağ entegrasyonu için" maddelerini uygular; aşağıdaki kurallar bağlayıcıdır.

**Yetki.** Yerel yetkili = `ctrl === 'local'` (kendi oyuncum) ya da `'bot'` (yalnızca ev sahibinde). `'remote'`: fizik/çarpışma/kutu/altın YOK; `game.onRemote` her adımda `FM.net.sample(pid)` örneğini (karede bir alınır) uygular → renderer alanları dolar (x, y, vx, vy, h, onGround, slide, climb, slam, balloon, face, fly, dash, sled, shield, boost, padT, frozen, stun, netted, dead, inv, inked, slowT, pull, bounceT, jumps, charge, coins, kills, deaths, tp, item, finished, out) + yerelde üretilenler: `ph` (koşu fazı), `jumpT` (jumps artınca 1), `land` (yere inince), zıplama/iniş/yeniden doğma tozu, mantar/trambolin esnemesi, gayzer buharı, ışınlanma parıltısı. `game.harm`/`game.die` uzak yarışçıya HİÇBİR ŞEY yapmaz (false) → hasar yalnızca kendi telefonunda hesaplanır; oradan olay gelir.

**Yarışçı alanları (ağda)**: `pid` = insanlarda oyuncu pid'i, botlarda `'b0'..'b9'` (ağ kimliği; olaylarda `r` hep budur) · `nbot` (true = ağ botu) · `name = nick` (insan: takma ad, aynı ad → "Ali 2"; bot: karakter adı, aynı karakter → "Kral 2") · `off` (bağlantı koptu: `out` da true olur, çizilmez; geri gelirse kalkar) · `offOut` (iç) · `stale` (1.5 sn'dir veri yok → donuk) · `emote` = `{id: emoji metni, t: kalan sn (3 → 0, sonra null)}` · `idx` herkeste aynı (roster sırası, sonra botlar).
**İzleyici (geç katılan)**: `S.player` S.racers'ta OLMAYAN bir hayalet nesnedir: `{ghost: true, ctrl: 'spec', out: true, spec: true, dead: 1e9, bot: true, pid: kendi pid, name: takma ad}`; x/y/vx/vy/idx her adım izlenen yarışçıdan (`S.spec`) kopyalanır → kamera, altın/kutu görünürlüğü (`player.idx`) ve HUD izleneni gösterir. `FM.netgame.state().spectating` true. Kontrolleri gizlemek arayüzün işi.

**API (`FM.netgame`)**
| Çağrı | Not |
|---|---|
| `hostStart(over?)` | ev sahibi: lobi `cfg`'si (+ `over`) ile maçı başlatır → `FM.net.start(yük)`. Oyuncular: `FM.net.players()` içinde `!off` ve canlı olanlar (lobi sırası). `false`: ev sahibi değil / zaten yarışta / oyuncu yok |
| `hostNext()` | ev sahibi: sonuçtayken sonraki tur (`FM.net.next`); son turdan sonra final sıralaması (`FM.net.end({final:1})`); finaldeyken lobiye |
| `hostToLobby()` | ev sahibi: herkes lobiye (`FM.net.toLobby`) |
| `leave()` | odadan çık + (yarıştaysa) ana menü (`game.toMenu`) |
| `emote(e)` | `FM.net.emoji(e)` (≤ 8 karakter, 0.7 sn'de bir); kendi yarışçına da `emote` düşer |
| `state()` | `{on, phase: 'off'/'lobby'/'race'/'results'/'final', role: 'host'/'member'/null, spectating, late, round, rounds, mode, mid, theme (id), autoLeft, lastEnd, final}` |
| `active()` / `live()` | maç sürüyor mu / ağ yarışı ekranda mı (count/race/end/podium; main.js buna göre DURAKLATMAZ) |
| `autoLeft()`, `cancelAuto()` | ev sahibinde otomatik sonraki tur/lobiye kalan sn (yoksa null) / iptal |
| `racer(pid)`, `racers()`, `totals()`, `lastEnd()`, `final()` | sorgular (`lastEnd`/`final` aşağıda) |
| `normCfg(cfg)`, `defaultCfg()`, `DEF` | lobi ayarı doğrulayıcı: `{mode, map: 'random'/tema id, rounds 1..9 (öneri 1/3/5), bots: bool, fill: 2..10 (bot doldurma hedefi, varsayılan 4), autoNext: sn (0 = kapalı, varsayılan 20)}`. Arayüz `FM.net.setConfig(...)` ile bu anahtarları yazmalı |
| `pack(r)`, `unpack(r, s)`, `FLAGS` | durum paketleyici (aşağıda) |
| `autopilot` | test: true → yerel yarışçıyı yapay zekâ sürer |
| `debug()` | test/teşhis anlık görüntüsü (yarışçılar, saat, olay sayaçları) |

**Olaylar (`FM.on`) — arayüz bunları kullanır**
- `mp:lobby {lobby, back}` — odaya girildi (yarış yoksa) ya da ev sahibi lobiye döndürdü (`back: true`; arka planda demo başlatılır). Lobi ayrıntısı için `net:lobby`/`net:players` de kullanılabilir.
- `mp:start {round, rounds, mode, theme, late, spectating, mid, newMatch}` — tur başladı (`race:start`'tan sonra; yeni maçta `match:start {…, mp: true}` da yayınlanır).
- `mp:waiting {round, rounds, late, phase: 'race'}` — bu turu izliyorsun (geç katıldın); sonraki turda otomatik yarışırsın.
- `mp:end` = `lastEnd()` = `{round, rounds, mode, last, spectator, ranking: [{pid, nick, char, skin, bot, me, rank, rp, total, finished, place, ftime, coins, kills, deaths, off, out}]}` — herkeste AYNI (ev sahibinin kararı). Ardından motor `race:end` (izleyicide YOK) + 1.5 sn sonra `ui:podium` (res'te `mp: true`, izleyicide `spectator: true`, `playerRank: -1`).
- `mp:final` = `final()` = `{standings: [{pid, total, nick, char, skin, bot, me}], rounds, champion}` — maç bitti (o maçta en az bir tur yarıştıysan önce `match:end`, meta maç ödülü dahil). Kopan/ayrılan katılımcılar da listede.
- `mp:host {me, pid, prev, pending?}` — ev sahibi değişti (`me: true` → artık sensin: botlar devralındı, otomatik ilerleme senin).
- `mp:drop {r, pid, nick}` / `mp:back {r, pid, nick}` — yarışta bağlantısı koptu / geri geldi (motor tostu da çıkar: "X: bağlantı koptu").
- `mp:emote {r, pid, e, me}` · `mp:left {reason}` — odadan çıkıldı/düşüldü (yarıştaysan ana menüye dönüldü; hata metni `net:error`'da).
- Ağdan uygulanan motor olayları (`item:use`, `ability`, `hit`, `blocked`, `death`, `finish`, `trap:snap`) `net: true` taşır; ses/görev dinleyicileri `r === FM.S.player` kontrolüyle zaten doğru çalışır (ör. uzak kurbanın ölümünde öldüren bensem meta `kills` görevini sayar).

**Tur akışı.** Ev sahibi `hostStart` → herkes `net:start` → kadro (roster sırası + botlar; `idx` herkeste aynı), `FM.meta.mods(null, {room: yük.mods})` herkese eşit (abLv/chargeMul/startItem), toplam puanlar yükteki `tot`'tan, `game.startRound({seed, themeIdx})` → aynı harita, geri sayım. Ev sahibinde tur sonu koşulu (`active===0`, bitiş sayacı, süre) → `game.onEndRound` → 0.6 sn bekle (son durumlar gelsin) → sıralama: bitirenler KENDİ telefonlarındaki bitiş süresine göre (saatler eşit), sonra mod kuralı (`game.ranking`), bitirmeden kopanlar en sonda → `FM.net.end(yük)` → herkes aynen `game.endRound({ranking, rp, total})` uygular. Ev sahibi `hostNext` (ya da `autoNext` sn sonra otomatik) → `net:next` (yeni seed/tema; o an odadaki herkes — geç katılanlar dahil — kadroya girer, kopanlar çıkar; bot sayısı yeniden hesaplanır, bot kimlikleri korunur) … son turdan sonra final → 30 sn sonra (ya da `hostNext`/`hostToLobby`) lobiye.
**Mevcut düğmeler ağda güvenli**: `game.next` (sonuç "SONRAKİ TUR") ağda yalnız ev sahibinde `hostNext`, üyede hiçbir şey; `game.quitRace` / `game.toMenu` ağda `leave()`; `game.startMatch` (tek oyunculu) odadaysan önce odadan çıkar. `game.finishNow` ağda false.
**Duraklatma yok**: main.js ağ yarışında (`FM.netgame.live()`) `S.paused` olsa da simülasyonu ve çizimi sürdürür; odak/görünürlük kaybında duraklatma menüsü açmaz. Duraklat düğmesi menüyü açar ama yarış sürer (arayüz metni buna göre olmalı).

**Saat.** `S.lt`/`S.raceT` herkeste aynı tutulur: start mesajı alındığında `t0 = şimdi − rtt/2`; üyeler ev sahibi durumundaki `L` (ev sahibinin `S.lt`'si) ile 4 Hz ince ayar yapar; fark > 0.12 sn ise atlanır (sekme arka planda kaldıysa vb.). Ölçüm: 10 oyuncuda fark ≤ 110 ms; geç katılan 5 sn içinde ±60 ms.

**Ağ biçimleri**
- start/next yükü: `{v:1, mid, seed, theme (indeks), seq: [tur başına tema], mode, round, rounds, an (autoNext sn), bf (bot doldurma hedefi, 0 = bot yok), roster: [{pid, nick, char, skin, trail, plate}], bots: [{id:'bN', char, skin, trail, plate}], mods, tot: {kimlik: toplam}}` (alıcıda tamamen süzülür).
- end yükü: `{v:1, mid, round, rounds, mode, last, rk: [{r, rp, t, f, p, ft, c, k, d, o, e, n}]}` (r kimlik, rp tur puanı, t toplam, f bitirdi, p sıra, ft süre, c altın, k öldürme, d ölüm, o koptu, e elendi, n outN). Final: `{v:1, final:1, mid, rounds, st: [{r, t, n, c, s, b}]}`.
- durum (`FM.net.sendState`, ~10 Hz; ev sahibi botları `b` içinde): `{x, y (0.1), vx, vy, f: bayraklar, h (≠42 ise), süreler (fl da se sh bo pd fr st nt dd iv ik sw pu bt; 0.01), tam sayılar (ju ch co k de j), it, ft+pc (bitirince), q: tur anahtarı (seed % 100000), L (yalnız ev sahibi: S.lt)}`. Bayrak bitleri `FLAGS`: g 1 yerde, sl 2 kayma, cl 4 tırmanma, sm 8 çakılma, bl 16 balon, fi 32 bitirdi, el 64 elendi, lf 128 sola bakıyor, sp 256 izleyici, ice 512, sand 1024, lift 2048. Elenmiş yarışçı yalnız `{x, y, f: 64, q}` yollar. **`q` farklı örnek (net.js tamponunda önceki turdan kalan durum) yok sayılır** — yoksa yeni turun başında uzaklar eski bitiş konumunda "bitirmiş" görünür ve ev sahibinin eski saati geri sayımı kısaltır.
- olaylar: karede bir toplu `sendEvent('b', {mid, rd: tur, l: [[tür, veri], …]})` (başka maçın/turun gecikmiş olayları atılır; bağlantı yoksa 4 sn'den eski olaylar düşer). Türler: `it {r, k: eşya, x, y, vx, vy, rx, t: hedef kimlik (füze), ts: [hedefler] (yıldırım), n}` · `ab {r, x, y, fy, t (Caner hedefi), n}` · `ht {v: kurban, s: vuran, k: tür, c: neden, n: varlık}` · `bl {r, b: 'shield'/'balloon', n}` · `dt {r, s: öldüren, c, x, y, sf, n}` · `fn {r, ft, sv}` · `gt {r, g: kapı, t: geçiş anı}` · `el {r, g}` (yalnız ev sahibi) · `mw {x, y, t}` (meteor, yalnız ev sahibi) · `cd {r, x, y, n, key}` · `cp {id}`. Varlık ağ kimliği `e.nid = gönderen pid + '.' + n (+ '.' + i)` → tuzak kapanması, testerenin 2. kurbanda kırılması, ağın 2 kişide kopması herkeste eşitlenir. it/ab/ht/bl/dt/fn/cd, gönderenin ara değerleme gecikmesi (`FM.net.delay`) kadar bekletilip uygulanır (ekrandaki konumla hizalı); gt/el/mw/cp hemen. Bir olay yalnızca o yarışçının sahibinden (insan: kendi pid'i; bot: ev sahibi) kabul edilir.

**game.js'e eklenenler (bu ajan)**: `onNetStep(dt)` (S.netRole varken her adım başında), `onEndRound()` (ev sahibinde tur sonu kararı kancası; `S.endReq`), `endRound(fixed)` (ağ sonucu aynen; oyuncu sıralamada yoksa kupa/`race:end` yok), `roundPoints(rk)`, `itemParams(r, it)` + `castItem(r, it, p)` + `castAbility(r, p)` (useItem/useAbility bunlara bölündü; tek oyunculu davranış birebir aynı; uzak kullanıcıda kendi hareketi uygulanmaz), `item:use`/`ability` olaylarına `p` ve `ents`, `hit`/`death`/`blocked` olaylarına `ent` (o an işlenen varlık), `finishRacer(r, ftime, net)` (bitiş kaydı tek yerde), `passGate(r, g, t)` + `r.gateT` (kapı geçiş anları), `checkSurvivor()`, `deathIcon(cause)`, `near(r)`. Elemede ağda karar 0.45 sn bekler ve en son GEÇEN (geçiş anına göre) elenir; tek oyunculu kural aynı. Altın Avı'nda ağda süre dolunca altın toplanmaz.

**Testler (bu bilgisayar, Mosquitto/EMQX)**: `node dev/mp-bots.js host N mod tema tur doldur [--hostdrop=SN] [--drop=SN] [--late=SN]` — N gerçek istemci (node, çizimsiz) tam maç oynar; denetler: start herkese, uzak konum ≈ gerçek konum, seviye saatleri eşit, emoji, her tur sonucu + final herkeste AYNI, olaylar karşıya geçti, otomatik lobiye dönüş, konsol hatası yok. `node dev/mp-bots.js join KOD N` — tarayıcıdaki odaya hayalet ekler. `node dev/mp-browser.js [hayalet] mod tema tur doldur [klasör] [--late]` — 2 headless Chrome (ev sahibi + katılan, `?dev=1&mp=host|join`) + hayaletler: aynı harita, iki yönde uzak konum, katılanın testeresinin ev sahibinde aynı ağ kimliğiyle sahibinin yanında belirmesi, eşya olayları iki yönde, tur sonucu/final aynı, konsol hatası yok, ekran görüntüleri; `--late`: katılan tarayıcı yarış sürerken girer → izleyici ekranı (saat farkı ~15 ms), sonraki turda yarışır. Tur başına bayat örnek denetimi: bitiş süresi < 15 sn olmamalı, tur başında saat farkı < 350 ms. Sonuçlar: klasik 3 kişi; eleme 4 kişi + geç katılan (2 tur); ev sahibi yarışta donunca göç (yeni ev sahibi botları devraldı, botlar bitirdi); oyuncu kopunca sonuçta "koptu" en sonda; Altın Avı 4 kişi (düşen/alınan altın olayları); 10 kişi Kaos (meteorlar); 2 Chrome klasik/kaos; 2 Chrome + 8 hayalet = 10 kişilik eleme (EMQX'te): hepsi geçti, 0 hata. Uzak görüntü ölçülen farkı 60–300 px (≈ 0.2–0.4 sn koşu).
Geliştirici kancaları: `index.html?dev=1&mp=host&want=2&wait=60&mode=elim&theme=0&rounds=2&fill=4&mpauto=6[&broker=1][&auto=0]` (want kişi gelince başlar) / `?dev=1&mp=join&room=KOD`; ikisinde de otomatik pilot (`auto=0` kapatır).

**Diğer ajanlara istekler (çok oyunculu)**
- ui: lobi ekranları `mp:*` olaylarıyla; ev sahibi düğmeleri `hostStart/hostNext/hostToLobby`, üyede "Ev sahibi bekleniyor" + `autoLeft()` geri sayımı; `leave()`; emoji `emote(e)`; izleyicide (`state().spectating` / `S.player.ghost`) dokunmatik kontrolleri gizle + "İZLİYORSUN — sonraki turda katılacaksın"; ağda duraklatma menüsü metni "DURAKLATILDI" olmasın (yarış sürer); telefon dik çevrilince ağda duraklatma menüsü açılmasın. **Hata (şimdiden görünüyor):** `showResults` satırındaki `me` kuralı `r === P || (r.id === P.id && !r.bot)` ağda aynı karakteri seçen İKİ oyuncuyu da "SEN" gösteriyor → `r === P` (ya da `r.ctrl === 'local'`) kullan. `res.spectator` iken ödül paneli gösterme.
- render-chars/render-hud: `r.emote` balonu (baş üstünde, `t` ile solarak), `r.off` ("bağlantı koptu": yarışçı çizilmez; listede/HUD'da gri), `r.stale` (yarı saydam), izleyicide HUD izleneni göstersin; 10 kişide "X: Gölge Atılımı!" tostları kalabalık → yalnız kendi/yakındakiler ya da en çok 3.

**Bilinen eksikler**: Ev sahibinin telefonu arka plana atılırsa (sayfa donar ama ping sürer) botlar durur ve tur sonu kararı ev sahibi dönene ya da 6 sn susup göç olana kadar bekler. Olaylar QoS0'dır: nadir kayıpta ölüm/bitiş/eleme durum bayraklarından yine anlaşılır ama varlık eşitlemesi (tuzak kapanması) kaçabilir. Yere düşen bir altını iki oyuncu aynı anda alırsa ikisi de sayar. Çekişmeli bitişte iki oyuncu da kendini önde görebilir (uzak görüntü ~0.2 sn geride); nihai sıra telefonların kendi bitiş süreleriyle (±50 ms) belirlenir.

### Kalıcı kayıt, kayıt aktarma, PWA, meta ödülleri (meta ajanı: meta.js, core.js kayıt kısmı, sw.js, manifest, icons/)

**Kayıt (core.js)**
- Yeni kayıt **500 altın** (`defaultSave`, meta `START_COINS` ile aynı). Eski kayıt ASLA silinmez: `FM.normSave(obj)` (göç + tip düzeltme; `loadSave` bunu kullanır). JSON bozuksa ham metin `fuatmorel_save_v2_bozuk_<ms>` anahtarına kopyalanır, sonra varsayılanla açılır. `FM.save.savedAt` (her yazımda ms) ve `FM.save.created` eklendi. `FM.SAVE_KEY`.
- Otomatik kayıt: core `visibilitychange(hidden)`, `pagehide`, `freeze` → `FM.persist(true)`; meta önemli olaylarda zaten yazar.
- `FM.askPersist()` → Promise<bool> (`navigator.storage.persist`); ilk dokunuşta ve PWA kurulunca kendiliğinden çağrılır. Sonuç `FM.storage.persisted`.

**Elmaslı kozmetik**: `FM.COSMETICS` öğesinde `cur: 'gems'` (yoksa altın). Şu an: kostüm `altin` = **25 elmas**, iz `spades` = **20 elmas** (önceden altınla alanlar sahip kalır). `FM.meta.currency(type, id)` → 'coins'|'gems'; `meta.cosmetics()` her öğeye `cur` ekler ve `can`'ı doğru bakiyeyle hesaplar; `meta.buyCosmetic` doğru birimden düşer (`meta:buy {…, cur}`). **ARAYÜZ İÇİN ZORUNLU**: ui.js'te `cosState`/`priceBtn(... {cur: 'coins', n: price})` ve satın alma onayındaki `coins() < it.price` kontrolleri `x.cur`'a göre (elmas simgesi + `FM.save.gems`) olmalı; yoksa bu iki öğe "25 altın" görünür.

**Meta ödülleri (race:end)**: sıra ödülü n kişiye ölçekli (`res.n`; 4 kişide eski tablo aynen: 120/70/40/20, 10 kişide 120…20). Altın Avı'nda sıra altına göre, "kazanma" = altın sırası 1.; toplanan altın ödülü ×0.6, en çok 150. Elemede elenmek yarım ödül sebebi değil. Çok oyunculuda (≥2 insan) "Arkadaşlarla yarış" bonusu 15 + 3×(insan−2) altın (≤40) + 10 XP. Sonuç `meta.lastRewards`'a `n, mode, mp, humans, win` eklendi. En iyi süre (`stats.best`) yalnız klasik modda.
- Yeni sayaçlar (`FM.save.stats`): `mpRaces, mpWins, mpTop3, mpMatches, mpChamps, mpKills, elimTop3, elimWins, coinsBest, coinsWins, meteorDodge, gemCos, imports`; haritalar `modeRaces{mod}`, `themeRaces{temaId}`. `FM.meta.mpStats()` → `{races, wins, top3, matches, champs, kills, winPct, byMode, byTheme}` (profil ekranı için).
- Meteor kaçışı: Kaos'ta oyuncunun ≤260 px yakınına düşüp onu öldürmeyen meteor.
- Yeni başarımlar: `mpRaces` Kanka, `mpWins` Odanın Kralı, `mpChamps` Ekibin Şampiyonu, `elimTop3` Hayatta Kalan, `coinsBest` Hazine Avcısı (80/150/250), `meteorDodge` Meteor Savar, `modes` Çok Yönlü, `maps` Gezgin, her tema için `th_<id>` "<Harita adı> Ustası" (1/10/30 yarış). Yeni günlük görevler: `mp2` (arkadaşlarla 2 yarış), `elim3`, `hunt80` (Altın Avı'nda 80 altın), `meteor3`. Hepsi mevcut `meta.missions()`/`claim()` akışında, arayüz değişikliği gerekmez.

**Kayıt aktarma API'si (`FM.meta`, arayüz Ayarlar → "Kayıt Kodu")** — hiçbiri reddetmez (Promise hep çözülür):
| Çağrı | Dönüş |
|---|---|
| `exportCode()` | Promise<string\|null> uzun çevrimdışı kod `FM1.<gzip base64url>.<sağlama>` (~1.5 KB; CompressionStream yoksa `FM0.`). pid ve ses/kalite ayarları DAHİL DEĞİL |
| `cloudSave()` | Promise<`{ok:true, code:'ABCD2345', text:'ABCD-2345', warn, servers}` \| `{ok:false, err}`>. 3 aracıya retain'li `fuatmorel/v1/save/<kod>` yazar (≈2 sn). `warn` (Türkçe) kullanıcıya gösterilmeli; son kod `FM.save.cloud = {code, t}` |
| `importCode(metin)` | Promise<`{ok:true, src:'code'\|'cloud', preview, current, apply()}` \| `{ok:false, err}`>. Uzun kodu da 8 karakterli bulut kodunu da (tire/boşluk/küçük harf olur) kabul eder; boşluk/satır sonu temizlenir. **Hiçbir şeyi değiştirmez**: `preview`/`current` = `{nick, level, coins, gems, trophies, races, wins, skins, savedAt}` → "Bu kayıt yüklensin mi?" onayı → `apply()` (bool). `nick` kullanıcı metni: `FM.esc` ile göster |
| `cloudLoad(kod)` | `importCode` ile aynı sonuç (≈0.7 sn; bulunamazsa ~4 sn sonra `err`) |
| `applyImport(tok?)` | son önizlemeyi uygular. Önce mevcut kaydı `fuatmorel_save_v2_yedek`'e yedekler (önceki yedek `…_yedek_onceki`); yarışta (`race/count/end`) ya da yedek yazılamazsa `false`. pid, ses/kalite ayarları bu cihazınki kalır. Sonra `save:import {src}` + `save:reset {import: true}` yayınlanır (arayüz yenilensin) |
| `backupInfo()` / `restoreBackup()` | yedeğin özeti ya da null / yedeği geri yükle (şimdiki kayıt yedeğe geçer → geri alınabilir) |
| `cloudCodeValid(s)` | bool |
`err` metinleri Türkçe ve doğrudan gösterilebilir.

**Platform (core.js)**
- `FM.inAppBrowser(ua?)` → `'whatsapp'|'instagram'|'facebook'|'messenger'|'tiktok'|'snapchat'|'twitter'|'telegram'|'linkedin'|'line'|'wechat'|'discord'|'pinterest'|'webview'|null`; görünen ad `FM.IN_APP_NAMES[k]`. Ana ekrandan açılınca null. Arayüz: null değilse "Bu tarayıcı ilerlemeni ayrı tutar. Sağ üstteki ⋮ / paylaş menüsünden **Chrome'da / Safari'de aç**, sonra **Ana ekrana ekle**" uyarısı göstersin (iOS WhatsApp SFSafariViewController tespit EDİLEMEZ).
- `FM.isStandalone()` → ana ekrandan (PWA) mı açıldı. `FM.pwa.canInstall()` / `FM.pwa.install()` → Promise<bool> (Android Chrome kurulum istemi; olaylar `pwa:installable`, `pwa:installed`). iOS'ta kurulum yalnızca Safari → Paylaş → "Ana Ekrana Ekle" (arayüz metinle anlatmalı).
- Service worker yalnız http(s)'te ve `?dev=1` DEĞİLKEN kaydolur (file:// ve geliştirici testleri etkilenmez). index.html'deki `<link rel="manifest">` head'deki küçük satır içi betikle YALNIZ http(s)'te eklenir (file:// altında CORS konsol hatası çıkmasın). Ön izleme/denetim: `node dev/pwa-check.js` (yerel http sunucusu + CDP: manifest hatası, kurulabilirlik, SW, sunucu kapalıyken çevrimdışı açılış, konsol hataları).

**PWA dosyaları**: `manifest.webmanifest` (Fuat Morel, `display: fullscreen`, `orientation: landscape`, `start_url/scope: .`, ikonlar 192/512 + maskable 512), `icons/` (icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png 180, favicon-64.png), `sw.js`. **sw.js `VERSION` sabiti**: oyun dosyası eklenince/kaldırılınca `PRECACHE` listesini güncelleyin; sürümü artırmak eski önbelleği siler. HTML/JS/CSS/manifest AĞ-ÖNCELİKLİ (çevrimiçiyken güncelleme hemen gelir; çevrimdışıysa önbellek), görseller/ikonlar önbellek-öncelikli, Google Fonts önbelleğe alınır. Sorgu dizgili açılış (`?oda=KOD`) çevrimdışıyken index.html'e düşer.

**Test**: `node dev/meta-test.js` (çevrimdışı: göç, 500 altın, elmaslı kozmetik, n kişilik ödül, Altın Avı/Eleme/çok oyunculu sayaçları, meteor, uzun kod + önizleme + yedek + geri alma, bozuk kayıt yedeği, uygulama-içi tarayıcı) · `node dev/meta-test.js bulut` (gerçek aracıya bulut kodu yaz/oku).

### Karakter işaretleri + efektler (karakter/efekt ajanı: render-chars.js, render-fx.js)
**render-chars (`FM.R`)**
- İsim plakası `r.nick || r.name` (en çok 18 karakter). **Oyuncu rengi**: `R.racerColor(r)` → `R.PLAYER_COLORS[r.idx % 10]` (`#ffd23f, #ff5a6e, #4fb3ff, #5ee07a, #c084fc, #ff9f43` (= render-hud `RCOL`, aynı sıra) + `#22d3e6, #ff6ec7, #a3e635, #f2f2f7`; ağda idx herkeste aynı → herkes aynı rengi görür). Renk etiketleri yalnızca ağ yarışında (`S.netRole`) ya da 4'ten fazla yarışçıda açılır (demo/4 kişilik tek oyunculu görünüm aynen): plakanın solunda renkli nokta + kenar rengi, ayak altında renkli halka, plakası sığmayan yarışçının işareti de bu renkte. **HUD'un 6 renkli `RCOL`'u 7.-10. yarışçıda renk tekrarlar → HUD/lobi `FM.R.racerColor(r)`'yi kullanırsa (typeof ile koruyun) plaka noktası/ayak halkasıyla 10 kişide birebir eşleşir.**
- `r.emote = {id, t}` → başın/plakanın üstünde çizilmiş konuşma balonu (emoji sistem yazı tipiyle; yalnız ASCII metin — ör. `GG` — altın başlık yazısıyla). t 3 → 0: açılışta zıplar, son 0.35 sn'de solar. Kalabalıkta balonlar yana/yukarı kayar (oyuncunun balonu önce yerleşir). **Emoji balonlarını dünya üzerinde render-chars çizer; HUD yarışçı üstüne ayrıca balon çizmesin.** Herhangi bir ≤8 karakterlik metin çalışır (önbellek 40 balonla sınırlı). İzleyici hayaletin (`S.player.ghost`) kendi emojisi dünyada çizilmez.
- `r.stale` → karakter + gölge %45 saydam, plakanın yanında kırmızı çizgili wifi simgesi. `r.off` / `r.out` (dead = 1e9) → çizilmez.
- İzleyici: `S.player.ghost` ya da `S.player.out` iken `S.spec` (elenmemişse) oyuncu gibi öne alınır: büyük plaka + camgöbeği "göz" oku (oyuncunun altın okunun yerine).
- **Çizim sırası değişti**: plakalar + emoji balonları `R.drawPlates(ctx)` ile, `R.drawParticles`'ın SONUNDA çizilir (füze, "!" nişan uyarısı, parçacıklar plakaların ALTINDA kalır). render-fx yüklü değilse (`R.platesLate` yok) eskisi gibi `drawRacers` içinde çizilir. main.js değişmedi.

**render-fx**
- `R.meteorFx = true` (game.js yedek parıltısı kapalı). Meteor: yerde (drawEnts, yarışçıların altında) büyüyen gölge + kırmızı→sarı nabız atan halka + içe kayan 4 ok + gökten iniş ışık sütunu; son 0.55 sn sağ-üstten (x+330, y−820) çapraz düşen dönen alevli kaya + alev izi + kıvılcım/duman parçacıkları; `meteor` olayında kaya parçaları, toz, kıvılcım, şok halkası, 4 sn sönen yanık izi, yakınsa ekran sarsıntısı.
- Durum izleyen efektler (uzak yarışçılarda da çalışır, olay gerekmez): **ışınlanma** — `r.tp` artıp yarışçı bir portalın B noktasına yakınsa A'da içe çeken mor girdap + yıldızlar, B'de dışa açılan turkuaz girdap · **gayzer** (`vents kind:'burst'`) — `k > 0` iken ağızda kabarcık/buğu, `act`'a geçişte su fışkırması + halka, `act` boyunca h yüksekliğine çıkan damlalar ve tepede buhar (sütunun kendisi render-world'ün işi) · **düşen altın** — `L.coins`'e eklenen `drop` parçaları (yerel ya da ağdan `dropCoins`) için parıltı + halka + "-N" yazısı.
- Olay efektleri: `eliminated` → duman, kırmızı kıvılcım, "ELENDİ!" yazısı, yükselip solan hayalet portre · `coins:bonus` → "+N" + yıldızlar · `gate` (yalnız kendi oyuncun) → yeşil halka + yıldızlar · `mp:drop` → gri duman + "BAĞLANTI KOPTU" yazısı (yarış/geri sayımda, görünürse).
- Füze nişanının "!" uyarısı artık hedefin sağ yanında ve %82 opak (plakanın üstüne binmez).

### render-hud.js — 10 kişilik HUD, mod göstergeleri, kürsü listesi (HUD ajanı)
Yalnızca `js/render-hud.js` değişti; yeni olay/alan YAYINLAMAZ, yalnız okur. Hepsi tek oyunculu ve çok oyunculuda aynı çalışır.
- **İlerleme çubuğu**: 5+ yarışçıda portreler küçülür (r 10, oyuncu 14.5) ve 3 şeride (ray, +19 altı, −18 üstü) dağılır; yer yoksa yana kayar (üst üste binmez). Elenen (`out`) ve kopan (`off`) gri + arkada; kopanın portresinde kırmızı "kesik bağlantı" rozeti; `stale` yarı saydam. Eleme kapıları (`L.gates`, `off` olmayan) çubukta çentik: yeşil = sıradaki, sarı = geçtin/bekleniyor, kırmızı = kapandı. İzleyicide (hayalet `S.player.ghost` ya da elenmiş oyuncu) büyük portre `S.spec`.
- **Sıra rozeti** 1..10 ve "/N" (eskiden 4'e/9'a kırpılıyordu → 5.+ sıralar "4." görünüyordu; düzeltildi). Bitiş madalyası gerçek sırayı yazar.
- **Mod HUD'ı** (ilerleme çubuğunun altında, ortada; bildirim yığını onun altına iner):
  - `elim`: `KAPI i/n · X m` + `KALAN k`; kapıyı geçtiysen yeşil `GEÇTİN! N kişi bekleniyor`; biri geçti ve sen geride kalan k kişidensen kırmızı yanıp sönen `HIZLAN! Elenmek üzeresin`. `eliminated` olayında (aynı kapıda 0.8 sn içinde gelenler birleşir) kırmızı kurdele `SONUNCU: X ELENDİ!` (birden çoksa `ELENDİ: X, Y`). Motorun "X elendi!" / "ELENDİN!" tostları HUD'da gösterilmez (bant/ekran onların yerine).
  - Elenen oyuncu: ilk 2.8 sn büyük `ELENDİN!` (bu sırada tost yok), sonra alt ortada `İZLİYORSUN: <S.spec.name>` (+ "Elendin — tur bitince sonuçlar gelecek"). Geç katılan hayalet: aynı hap + "Sonraki turda sen de yarışacaksın"; hayalette altın/eşya/güç/sıra rozeti çizilmez. **ui.js'e not**: tek oyunculuda elenen için "Sonuçlara geç" düğmesi (`FM.game.finishNow()`) DOM'da olmalı; HUD alt ortayı (`İZLİYORSUN` hapı, alttan ~60 px) kullanıyor.
  - `coins`: büyük geri sayım `game.timeLeft()` (son 10 sn kırmızı nabız) + sağda `ALTIN SIRASI` tablosu (ilk 3 + "Sen" satırı; telefonda sıra rozetinin altında, masaüstünde süre/altın haplarının altında). Bitirince "BİTİRDİN! +15 ALTIN", madalya altın sırası.
  - `chaos`: `meteor:shower`'da `METEOR YAĞMURU!` kurdelesi; her `meteor` varlığı (t>0) için iniş noktasının üstünde yanıp sönen "!" üçgeni, ekranın sağ dışındakiler için kenar oku.
  - `pure`: klavyeli düzende eşya yuvası çizilmez (güç halkası sola kayar); dokunmatikte EŞYA düğmesi ui.js'in işi.
- **Ağ durumu** (yalnız `S.netRole` varken): sinyal çubukları + ping (`FM.net.status().rtt`, `conn !== 'open'` → kırmızı "Bağlanıyor"/"Bağlantı yok"), insan sayısı (`!nbot && ctrl !== 'bot' && !off`, hayalet +1), ev sahibiysen taç (`FM.net.isHost()`); 0.5 sn'de bir okunur. Telefonda süre/TUR hapının altında, masaüstünde altın hapının solunda. Dar yerde sırayla " ms", taç, sayı atılır.
- **Geri sayım pankartı**: `[TUR x / y] [MOD ADI]` + harita kurdelesi + altında tek satır açıklama (klasik dışı modlarda `FM.MODES[].d`'nin ilk cümlesi, klasikte `theme.mech`). Geri sayım rakamı 22 px aşağı indi. Motorun mod adı tostu geri sayımda gizlenir.
- **Bildirimler**: aynı anda en yeni 3 tost (10 kişide kalabalık olmasın).
- **Kürsü**: 5+ kişide ilk 3 kürsüde (sahne küçülür, sola kayar), 4..N kürsünün sağında kompakt sıralı liste (sıra, portre, ad, Altın Avı'nda altın, tur puanı; elenen/kopan portresinde rozet; "Sen" satırı altın çerçeve) — sağ kenar sahne alanının (genişliğin %58'i) 30 birim içinde, sonuç paneline taşmaz. Ad plakaları sığmazsa "…" ile kısalır. Başlıkta mod hapı (klasik dışı); izleyicide (`res.spectator`) kupa hapı yok. Altın Avı'nda kürsü puan hapında altın sayısı, elemede (≤4 kişi) "ELENDİ · +N".
- **İkonlar** (`FM.R.icon` / `R.ICONS`): yeni `x_gate`, `x_meteor`, `x_boulder`, `x_sand`, `x_neon`; öldürme akışında 🚪 ☄️ 🪨 ⏳ ☢️ artık vektör ikon. Yeni tema vurgu renkleri (desert/space/city/tropic).

### render-world.js — yeni 4 tema + yeni öğe çizimleri (dünya ajanı)
- **`FM.R.themeReady(id)`** tanımlı → 8 temanın hepsi `true` (çöl/uzay/şehir/tropik artık rastgele/demo havuzunda: `game.readyThemes()` 8 indeks döner). `pal()` bilinmeyen temada önce `theme.base`'e, sonra forest'a düşer.
- **`FM.R.worldPalette()`** yeni temalarda da tam: `{id, ol, sky, haze, sun{…, moon?}, cloud, sunFy}` (şehirde `sun.moon = true`: ay çizilir).
- **Gökyüzü önbelleği**: gök gradyanı + güneş halesi/ışınları + temaya özel SABİT uzak katman (şeker: gökkuşağı; uzay: nebula + samanyolu + yıldız tozu; şehir: ufuk parıltısı) ekran boyutlu tek tuvalde (`farSky`, en çok 1.5× çözünürlük, anahtar = tema + VW×VH + ölçek + düşük kalite). Karede 1 drawImage; dikey parallax `P.sunFy`. Güneş diski ayrı ve keskin (`sunDisk`). Işın dönüşü artık yok (sabit açı).
- **Temalar**: çöl (piramit/mesa/tapınak kalıntısı siluetleri, kum tepeleri + vaha palmiyesi/dikilitaş/kaktüs siluetleri, sıcak hava titreşimi, kumtaşı + hiyeroglif zemin, kum kapak, kumtaşı yüzen blok), uzay (gezegen + halka, ay, kayan yıldız, istasyon modülleri ve yanıp sönen ikaz ışıkları, metal panel zemin + neon kenar, itici alevli hover platform), şehir (ay, arama ışıkları, 2 kat ışıklı gökdelen silueti + Türkçe neon tabelalar + vinç, çatı silueti, tuğla zemin + beton parapet, turuncu çelik kiriş platform, hafif yağmur), tropik (deniz ufku + güneş yansıması, yelkenli, palmiyeli adalar + deniz feneri, yakın dalga sırtları, kumlu/kabuklu zemin + çim, ebegümeci çiçekleri).
- **Sıvılar** (`LQ`): `quicksand` (yavaş dalga, dönen girdaplar), `plasma` (mor parıltı + elektrik arkları), `neon` (zehirli yeşil, kabarcık), tropikte `water` yerine `sea` (turkuaz, köpük kıvrımları). Çizim: `liquidNew` (eski 4 sıvı aynen).
- **Dekor**: `FM.DECOR`'daki 16 yeni tipin hepsi `DEC`'te (çöl/uzay/şehir/tropik). Animasyonlu: anten ışığı, reaktör parıltısı, zemin lambası, sokak lambası ışık konisi, cızırdayan neon tabela, tiki meşalesi. Ön katmanda eşya sanılabilecekler (`sci_crate`, `urn`, `canister`, `trash_can`, `ac_unit`) arka geçişte çizilir.
- **Yeni öğeler** (`drawWorldBack` içinde, yarışçıların arkasında): `drawLowG` (sıvıdan sonra; mor sütun + yükselen parçacık + kesikli sınır), `drawBoulderDoors` + `drawGates` (zeminden ÖNCE: arka düzlem yapıları, kapak tabanlarını örter), `drawBridges` + `drawIce` (zeminden sonra), `drawQuicksand` (çamur geometrisi + kum renkleri + girdap), `drawTramp` + `drawVents` (baca: ızgara + yükselen hava çizgileri + kâğıtlar + ok; gayzer: kaya ağzı, `k` ile kabarcık/buhar/titreme, `act` iken `S.lt`'den hesaplanan yükselme/sönme ile su sütunu + damlalar), `drawBoulders` (st 1: kapıda karanlıkta beliren kaya + kırmızı gözler + kapı sarsıntısı/tozu; st 2: dönen kaya + toz izi; k > 0.9 parçalanma; x0..x1 yol oluğu), `drawPortals` (A mor, B turkuaz kaide üstünde; akan noktalı yay; A üstünde zıpla oku), `drawMeteorWarn` (YALNIZCA `FM.R.meteorFx` yoksa — render-fx zaten çiziyor).
- **Düşen altın** (`co.drop`): son 3 sn hızlanarak yanıp söner, `v ≥ 3` ise 1.3× büyük; yerde zıplama salınımı yok.
- **Köprü tabanı** (`solids` `{float, bridge}`) yüzen platform olarak ÇİZİLMEZ (buildGeo atlar).
- Ölçüm (headless, telefon 844×390): arka plan karesi (önbellekle) eski temalarda 2.2–2.6 ms, yeni temalarda 0.65–1.4 ms; dünya 1.8–3.1 ms (kale 3.2 ile aynı düzey).

### Ses — yeni tema müzikleri, lobi müziği, mod ve çok oyunculu efektleri (ses ajanı: audio.js)
Yalnızca `js/audio.js` değişti; yeni olay YAYINLAMAZ, yalnız dinler. Ses kilitliyken (etkileşim yok) hiçbir şey çalmaz; müzik isteği kaydedilir.
- **Müzik** (`FM.audio.music(id)`): yeni şarkılar `desert` (Re hicaz, darbuka maqsum, ud + ney), `space` (Mi minör, 16'lık synth arpej, cam çanlar), `city` (La minör gece funk'ı: klavinet, slap bas; B bölümü synthwave), `tropic` (Sol majör çelik davul + kalipso/reggae org), `lobby` (Fa majör, sakin bekleme). Hepsi I-A-B-A2-C yapısında (lobi A-B-A2), seviyeleri eski şarkılarla aynı (±1 dB). `race:start` artık tema NESNESİ geçirir: şarkısı olmayan yeni bir tema eklenirse `theme.base`'in müziği çalar (sayı/id/nesne hepsi kabul).
- **Lobi müziği**: `mp:lobby` → `lobby`; `ui:menu` gelirse ve `FM.netgame.state().phase === 'lobby'` + `FM.net.inRoom()` ise lobi müziği SÜRER (menü müziğine dönmez); `mp:left` → menü müziği. Arayüz lobi ekranını açarken isterse `FM.emit('ui:lobby')` yayabilir (odadaysa lobi müziği; zorunlu değil).
- **Efekt adları** (`FM.audio.play(ad)`, `names()`): `portal`, `vent` (baca), `geyser`, `tramp`, `iceSlide`, `rumble`/`roll`/`boulderCrash` (kaya), `meteorAlarm`/`meteorWarn`/`meteorHit`, `gatePass`, `elimSelf`/`elimOther`, `clock` (Altın Avı tik-tak), `timeup`, `coinsDrop`/`coinsPick`/`coinsBonus`, `mpJoin`/`mpLeave`/`mpReady`/`mpStart`/`emoji`/`mpDrop`. Arayüz düğmelerinde `data-sfx="mpReady"` vb. kullanılabilir.
- **Dinlenen olaylar**: `portal`, `vent` (kind lift/burst), `mush {kind:'tramp'}`, `meteor:shower`, `meteor:warn {x,y,t}` (bip + `t−0.62` sn sonra düşen ıslık), `meteor`, `gate` (yalnız kendi), `eliminated` (kendin → üzgün trombon + müzik kısılır), `coins:drop`, `coin {drop:true}` (değerli altın sesi; `coins:pick` ayrıca ses çalmaz), `coins:bonus`, `timeup`, `net:players` (önceki listeyle fark: yeni pid → katıldı, giden → ayrıldı, `ready` false→true → hazır; ilk liste sessiz; yarışta `off` geçişleri yok sayılır çünkü `mp:drop`/`mp:back` çalar), `mp:lobby {back:false}` (odaya girdin), `net:start` (`late` değilse başlatma sesi), `mp:emote`, `mp:drop`, `mp:back`, `mp:left` (reason ≠ 'left' → kopma), `net:kicked`, `net:error` (conn/dup/kicked → kopma; diğer kodlar → `deny`).
- **Durum izleme** (`FM.R.updaters`): Altın Avı'nda `game.timeLeft() ≤ 10` iken saniyede bir `clock` (son 3'te zil); kendi oyuncun buzda kayarken (`onIce && slide`) `iceSlide`; kayalar `st` geçişleriyle (0→1 gürleme, 2'de tur başına gümleme, 2→0 parçalanma) — konumsal, ekrandan uzaksa duyulmaz.
- Geliştirici: `FM.audio._dev.counts()` → `{ses adı: çalma sayısı}`.
- Testler: sahte AudioContext (tüm şarkılar 70 sn; 10 yarış: 8 tema, klasik/kaos/Altın Avı/eleme, 4-10 kişi; çok oyunculu olay dizisi) ihlal 0, hata 0; gerçek oyun sayfası headless Chrome'da (çöl/kaos, uzay/Altın Avı, şehir/eleme 10 kişi, tropik + lobi akışı) konsol hatası 0.

### Arayüz — ARKADAŞLARLA, lobi, ağ menüsü, sonuç/final, kayıt kodu (arayüz ajanı: ui.js, style.css, dev/mp-ui.js)
Yalnızca `js/ui.js`, `css/style.css` ve yeni `dev/mp-ui.js` değişti; yeni olay YAYINLAMAZ. Tüm FM.net / FM.netgame / FM.meta / FM.pwa çağrıları korumalı (`ncall`/`gcall`/`mcall`; yoksa ekran yine açılır).
- **Ana menü**: OYNA → `solo` ekranı (mod kartları `FM.MODES`, 9 harita kartı = Rastgele + 8 tema, TUR 1/3/5, RAKİP 1..9 → `FM.save.mode/map/rounds/rivals`; BAŞLA = `startMatch({char, rounds, mode, theme, n})`). Masaüstünde Enter menüden doğrudan bu seçimlerle başlatır. Yeşil **ARKADAŞLARLA** → `friends` ekranı (ODA KUR / KODLA KATIL + takma ad). Odadaysan düğme "Odaya dön".
- **Takma ad**: `FM.save.nickSet !== true` ise ilk çok oyunculu girişte (oda kur / katıl / `?oda=` linki) pencere sorar → `FM.net.setNick`. Ayarlar → PROFİL'den değişir.
- **`?oda=KOD`**: ilk `ui:menu`'de (ya da geliştirici sahnesinde açılıştan 0.6 sn sonra) `FM.net.codeFromUrl()` → arkadaşlarla ekranı + (gerekirse takma ad) + `joinRoom`. Lobiye girince adres çubuğuna `?oda=KOD` yazılır (sayfa yenilenirse aynı odaya döner; ev sahibi dahil — yalnız `?dev=1` değilken); ayrılınca / hata (badcode, noroom, full, ver, kicked) olunca `clearUrlCode()`.
- **Lobi** (`showScreen('lobby')`, üst çubuksuz): `mp:lobby` (ilk giriş ve `back: true`) ile açılır; `net:lobby` / `net:players` / `net:status` parça parça yeniler (yalnızca HTML değişince). Oda kodu (dokun = linki kopyala), LİNKİ PAYLAŞ (dokunmatikte `navigator.share`; yoksa pencere: WhatsApp `wa.me` + KOPYALA, link panoya), bağlantı + ping + kişi sayısı, 2×5 oyuncu kartı (portre, takma ad, karakter, ping çubukları, HAZIR / BEKLİYOR / EV SAHİBİ, taç, SEN, emoji balonu 3 sn), bot doldurma kartları (`cfg.bots` ve `fill`), boş yer = davet. Ayarlar (yalnız ev sahibi değiştirir): MOD ‹ › , HARİTA ‹ › (Rastgele + 8), TUR 1/3/5, BOT aç/kapa → `FM.net.setConfig` (son ayar `localStorage['fm-mpcfg']`, yeni oda bununla kurulur). Alt çubuk: emoji paneli (`FM.netgame.emote`), KARAKTER (7 portreli seçici → `FM.net.setProfile`), ev sahibi BAŞLAT (hazır olmayan varsa onay sorar → `hostStart`), diğerleri HAZIRIM / HAZIRSIN (`setReady`). Geri / Esc = "Odadan ayrıl" onayı → `FM.netgame.leave()`.
- **Hata pencereleri** (`net:error`, `net:kicked`): KOD HATALI, ODA BULUNAMADI, ODA DOLU, YENİ SÜRÜM VAR (SAYFAYI YENİLE), BAĞLANTI YOK, BAŞKA SEKMEDE AÇIK, ODADAN ÇIKARILDIN — `msg` aynen gösterilir. Kurulum/katılmada "ODA KURULUYOR / ODAYA KATILINIYOR" bekleme penceresi (VAZGEÇ = leave). `mp:host` → "Artık ev sahibi sensin!" / "Ev sahibi değişti" bildirimi (pending'de yok).
- **Yarış (ağ)**: duraklat düğmesi "MENÜ" penceresi açar (YARIŞA DÖN, sesler, ODADAN AYRIL — iki dokunuşla), `S.paused` DEĞİŞMEZ; dik çevirmede de duraklatmaz. Duraklat düğmesinin altında turuncu emoji düğmesi → 8'li hızlı panel (👍 😂 😎 😡 🔥 💀 👋 GG). İzleyici / elenmiş (`S.player.ghost || S.player.out`) iken dokunmatik kontroller gizli (`.ly-race.spec`); tek oyunculuda elenince sağ altta "SONUÇLARA GEÇ" (`game.finishNow()`).
- **Sonuç**: `res.mp` → "SEN" yalnızca `r === P || r.ctrl === 'local'`; 5+ kişide tablo kaydırılır ve kendi satırına kayar; Altın Avı'nda süre yerine altın; elenen/koptu yazısı; `res.spectator` → ödül yerine "Bu turu izledin". Ev sahibinde SONRAKİ TUR / FİNAL + otomatik geri sayım (`autoLeft()`), diğerlerinde "EV SAHİBİ BEKLENİYOR"; ev kapısı = odadan ayrıl. **Final**: ağda `match:end` atlanır, `mp:final` çizer (takma adlar, `me`); ev sahibinde LOBİYE DÖN (+ geri sayım), diğerlerinde bekleniyor; AYRIL.
- **Ayarlar**: PROFİL (takma ad), KAYIT KODU (KODUMU AL → `cloudSave` kısa kod + `exportCode` uzun kod panoya; KOD GİR → `importCode` → Bu cihaz / Yüklenecek önizlemesi → YÜKLE = `apply()`), ANA EKRANA EKLE (`FM.pwa.canInstall()` ise EKLE düğmesi; Android/iPhone yönergesi; ana ekrandan açıldıysa "ilerlemen güvende").
- **Mağaza**: elmaslı kozmetik (`meta.currency` / `COSMETICS.cur`) elmas simgesi ve bakiyesiyle gösterilir/alınır.
- **Uygulama-içi tarayıcı**: `FM.inAppBrowser()` doluysa menü/arkadaşlar/lobide altta mavi bant (bir kez kapatılır: `localStorage['fm-iab-x']`).
- `FM.ui.state()` → `{view, screen, modal}`; yeni ekranlar `solo | friends | lobby`, pencereler `nick | mpwait | mperr | share | chpick | svexp | svimp`.
- Geliştirici: `?dev=1&scene=menu&ui=solo|friends|lobby|nick|wait|mperr|share|chpick|svexp|svimp|mpresults|mpfinal` (`lobby`: sahte oda, `&np=1..10&host=0`; `mperr&code=ver`; `mpresults&mode=coins` için `scene=podium&n=10`), `&iab=whatsapp` bandı zorlar.
- **Test**: `node dev/mp-ui.js [klasör] [--rounds=2] [--mode=elim]` — 2 headless Chrome, geliştirici kancası OLMADAN gerçek tıklamalarla: ARKADAŞLARLA → ODA KUR → takma ad → lobi → B `?oda=` linkiyle açılır → takma ad → lobi → karakter değiştir → HAZIRIM → ev sahibi ayarları → lobide emoji → BAŞLAT → ağ menüsü (duraklamaz) → yarışta emoji → sonuç (B'de bekleniyor, tek SEN) → FİNAL → LOBİYE DÖN → B ayrılır; konsol hatası 0. Sonuç (2026-10-16): hepsi geçti.
- Bilinen eksikler: ev sahibi oyuncu atamaz (arayüzde "at" yok; `FM.net.kick` hazır); lobide sohbet yok (yalnız emoji); telefon klavyesi açıkken takma ad penceresi gerçek cihazda denenmedi.

### 5. tur ağ eklemeleri (özet; ayrıntı: docs/TUR5.md §6–§8)
- Varlık konuları: `fuatmorel/v1/_on/<pid>` (nabız, retain yok, ~5 sn; yarışta seyrek; `pagehide`'da `{st:'off'}`) ve `fuatmorel/v1/_pr/<pid>` (profil kartı, RETAIN; `FM.meta.card()` + `ls` son görülme ms, dakikada bir ve gizlenince/kapanınca yenilenir). Çevrimiçi = son ~12 sn içinde nabız; arka planda 60 sn'yi geçen `away` ("Uzakta"), asla çevrimiçi sayılmaz. Oda bağlantısı aynı aracıdaysa paylaşılır.
- API: `FM.net.online()`, `FM.net.profiles()`, `FM.net.presence(on?)`; olaylar `net:online {list, n}`, `net:profiles {list}`, `net:came {p}`, `net:lobby-open {p}`, `net:presence`.
- Katılma alanları `ht/wn/dt` (şapka/kutlama/ölüm efekti) ve `ck` (son görülen kontrol anahtarı: lobiye dönüşte bayat "hazır" bayrağı geri sayımı başlatamaz); lobi girdilerinde `ht/wn/dt`; tur sonu yükünde `an` (otomatik sonraki tur sn); `cd` olayı (hazır geri sayımı → `mp:countdown {left, reason}`).
- `it`/`ab` mesajlarında `ax, ay` (nişan yönü, 2 ondalık; (0,0) ise gönderilmez) ve MOTOR'un ek sayısal p alanları için `q` nesnesi.
- Yeniden bağlanma: localStorage `fm-oda` ({code, broker, t, pid}; 15 dk geçerli; "ODADAN AYRIL" ile silinir) ve `fm-mpsnap` (yarış ortasında son güvenli konum/altın/kapılar; aynı yarışçı olarak dönülür).
- Test: yerel aracı `node dev/broker.js 1884` ve `index.html?dev=1&brokerUrl=ws://127.0.0.1:1884/mqtt`; `node dev/net-test.js yerel`, `node dev/mp-bots.js lobi --yerel`, `node dev/mp-browser.js --yerel --tur5`, `node dev/mp-ui.js` (yerel aracıyı kendisi başlatır).

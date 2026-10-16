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
- Yarış başlatma: `FM.game.startNetRace({seed, theme, mode, roster, round, rounds})` — aynı seed ile aynı harita (genLevel deterministik, tema açıkça verilir).
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

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

**Bilinen eksikler**: yeni öğeler ve temalar render-world/render-fx'e kadar görünmez (kaya, gayzer, kapı vb. çizilmiyor; yalnızca meteorun yedek parıltısı var) → bu yüzden yeni temalar rastgele/demoda kapalı (`readyThemes`). HUD/arayüz/meta/ses henüz modları bilmiyor (yukarıdaki istekler). Ağ entegrasyonu yok (kancalar hazır).

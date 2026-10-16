# ♠ Fuat Morel

Klanın kendi Fun Run'ı. Tarayıcıda oynanan, 4 kişilik, eşyalı ve özel güçlü 2D engelli koşu yarışı.

**Oyna:** GitHub Pages açıldıktan sonra `https://KULLANICI_ADIN.github.io/fuat-morel/`

## Karakterler
Hepsinin hızı, zıplaması ve güç dolumu aynı; fark sadece görünüş ve özel güçte.

| Karakter | Özel güç |
|---|---|
| TAFTAF (kedi) | Gölge Atılımı |
| Caner (karga) | Kızıl Ay Kargaları |
| LUL (goril) | Goril Yumruğu |
| ertan (penguen) | Buz Kızağı |
| Kral (aslan) | Kral Kükremesi |
| Nuss (baykuş) | Tüy Süzülüşü |
| baso (ayı) | Bas Dalgası |

## Kontroller
- **Zıpla:** Boşluk / ↑ / W (havada tekrar bas: çift zıplama, duvarda basılı tut: tırmanma)
- **Kay / yere çakıl:** ↓ / S
- **Eşya:** E / Shift
- **Özel güç:** Q / F
- **Duraklat:** Esc / P
- Telefonda ekrandaki düğmeler (telefonu yan çevir).

## GitHub Pages'te yayınlama
1. github.com'da **New repository** → adı `fuat-morel` → **Public** → Create.
2. Bu klasörde:
   ```
   git remote add origin https://github.com/KULLANICI_ADIN/fuat-morel.git
   git push -u origin main
   ```
3. Repo sayfasında **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. 1-2 dakika sonra oyun `https://KULLANICI_ADIN.github.io/fuat-morel/` adresinde açılır. Linki arkadaşlarına gönder.

İlerleme (altın, görevler, geliştirmeler) her oyuncunun kendi tarayıcısında saklanır.

## Geliştirici
- `node dev/sim.js 8 [mod] [tema|all] [yarışçı]` — oyun mantığını tarayıcısız simüle eder (ör. `node dev/sim.js 8 elim all 10`; mod: classic, elim, coins, pure, chaos; tema 0-7 ya da id).
- `node dev/deathloop.js 20 1000 [tema] [mod]` — ölüm döngüsü / bitiremeyen yarışçı avcısı.
- `node dev/shot.js "scene=race&t=8&theme=0" cikti.png 1280 720` — headless Chrome ile ekran görüntüsü (scene: race | podium | menu, theme: 0 orman, 1 şeker, 2 kar, 3 kale, 4 çöl, 5 uzay, 6 şehir, 7 tropik; mode=elim, n=10 gibi parametreler de olur).
- `node dev/net-test.js 1` — çok oyunculu ağ katmanını gerçek MQTT aracısına karşı sahte oyuncularla dener (0 EMQX, 1 Mosquitto, 2 HiveMQ, all).
- `node dev/net-browser.js` — oyunu headless Chrome'da ev sahibi yapıp node oyuncularla aynı odada dener.
- `node dev/mp-bots.js host 4 elim random 2 6 [--late=15] [--hostdrop=20] [--drop=16]` — node'da 4 gerçek istemci (çizimsiz) tam bir çok oyunculu maç oynar; sonuçların herkeste aynı olduğunu, uzak oyuncuların hareketini, olayları denetler. `node dev/mp-bots.js join KOD 3` — tarayıcıdaki odaya 3 "hayalet" oyuncu ekler.
- `node dev/mp-browser.js 0 classic 0 1 4 [klasör]` — iki headless Chrome (ev sahibi + katılan) aynı odada otomatik pilotla yarışır; iki ekranın görüntüsünü alır. 10 kişilik oda: `node dev/mp-browser.js 8 elim 0 1 10`; geç katılan izleyici: `node dev/mp-browser.js 1 classic 0 2 4 --late`.
- Tarayıcıda elle: `index.html?dev=1&mp=host&want=2` (iki kişi olunca başlar) ve `index.html?dev=1&mp=join&room=KOD`.
- Modül sözleşmesi: `docs/CONTRACT.md`; çok oyunculu tasarım, `FM.net` ve `FM.netgame` API'leri: `docs/MULTIPLAYER.md`.

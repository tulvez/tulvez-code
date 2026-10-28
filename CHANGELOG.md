# Changelog

## 0.3.2

- Yeni — İngilizce dil desteği. Arayüz, Ayarlar, menüler, hata ve bildirim mesajları, VS Code'daki
  komut adları ve ayar açıklamaları iki dilde. Yeni ayar `tulvez.language`: Otomatik (VS Code'un dili;
  Türkçe değilse İngilizce), Türkçe ya da İngilizce. Ayarlar → Kişiselleştirme → Dil · Language'dan
  değiştirilir; panel yeni dille yeniden yüklenir, sohbet kaybolmaz. Model de seçilen dilde yanıt verir
  (kullanıcı başka dilde yazarsa o dilde); /review, /explain, /diff ve /commit istemleri de dile uyar
- Değişiklik — Beceri açıklamaları Ayarlar'da ve / menüsünde 100 karakterde kısaltılır ve hep iki satır
  yer kaplar: bütün beceri satırları aynı yükseklikte görünür; açıklamanın tamamı üzerine gelince görünür

## 0.3.1

- Düzeltme — OpenCode: ücretsiz modeller (big-pickle, *-free) OpenCode'un kuralı gereği yalnız OpenCode
  uygulamasında çalışıyor; Tulvez Code bu hatayı "ücretsiz kota tükendi" diye gösteriyor ve 3 kez boşuna
  deniyordu. Artık ücretsiz modeller listede yok, seçiliyse istek gönderilmeden ne yapılacağı anlatılır,
  hata tekrar denenmez ve kota uyarısı çıkmaz
- Düzeltme — OpenCode modelleri doğru biçim ve adresle çağrılır: Claude → Anthropic, GPT/Grok → OpenAI
  Responses, Gemini → Google, açık modeller → OpenAI uyumlu (yeni opencode.ai/inference adresleri).
  Hangi modelin nasıl çağrılacağı OpenCode'un da kullandığı models.dev kataloğundan günde bir alınır;
  maliyet de oradan hesaplanır
- Yeni — OpenCode Go sağlayıcısı (aylık abonelik). Tulvez Code OpenCode'a kendini tanıtır (User-Agent
  tulvez-code/<sürüm>) ve her sohbet için sabit oturum kimliği (x-opencode-session) gönderir; Go bunu ister
- Değişiklik — OpenCode'da model seçilmezse varsayılan claude-sonnet-4-5 yerine ucuz deepseek-v4.1-flash
- Düzeltme — "Invalid credential" yanıtı artık "API anahtarı geçersiz" olarak gösterilir

## 0.3.0

- Yeni — Sohbet hafızası: Tulvez Code sonraki mesajlarda önceki turlarda okuduğu dosyaları ve komut
  çıktılarını hatırlar (önceden yalnız düz metin gidiyordu, ajan okuduğu her şeyi unutuyordu). Bağlam
  dolunca önce eski araç çıktıları kısaltılır, gerekirse en eski turlar atılır
- Yeni — Geri al: bir yanıtta Tulvez'in yazdığı bütün dosyalar tek düğmeyle önceki haline döner
  (oluşturduğu dosya silinir). Dosyayı sonradan sen değiştirdiysen önce onay istenir
- Yeni — Yapılacaklar listesi: çok adımlı işlerde ajan bir liste tutar; giriş kutusunun üstünde canlı
  görünür, iş bitince katlanır. Plan modu adımlarını da listeye yazar
- Yeni — `@dosya`: `@` yazınca projedeki dosyalar listelenir; seçilen dosyanın içeriği (klasörse
  içindekiler) mesajla birlikte gider
- Yeni — MCP sunucuları: `tulvez.mcpServers` ayarı ve projedeki `.mcp.json` (Claude Code / Cursor ile
  aynı biçim), yerel (stdio) ve uzak (http/sse). Proje sunucuları izin verilmeden başlamaz; araçlar
  yalnız Build modunda ve onayla çalışır. Ayarlar'da durum, araç sayısı ve hata görünür
- Yeni — Proje talimatları: `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`,
  `.cursorrules`, `.clinerules`, `.windsurfrules` her istekte okunur
- Yeni — `web_fetch` aracı: ajan belge, sürüm notu ve hata çözümü sayfalarını okuyabilir (onaylı)
- Değişiklik — Bir istekte en çok 12 yerine 50 adım; sınıra gelinirse "devam" yazman söylenir.
  Build modunda değişiklikten sonra derleme, tip denetimi ya da testle doğrulaması istenir
- Değişiklik — Beceri yükleme: herhangi bir adla .md dosyaları, birden çok seçim ve beceri koleksiyonu
  klasörü (içindeki her .md ve alt klasör ayrı beceri). Windows'ta .md dosyası seçilemiyordu, düzeldi

## 0.2.5

- Yeni — `/skill` (ya da `/skills`) yazınca kurulu beceriler açıklamalarıyla listelenir; yazdıkça
  süzülür, ok tuşları ve Enter/Tab ile seçilir. `/skill <ad> <isteğin>` biçimi de çalışır: beceri,
  isteğinle birlikte başlar
- Yeni — `/` menüsü yazdıkça süzülür ve klavyeyle gezilir (önceden yalnız tek başına "/" yazınca açılıyordu)
- Yeni — Ayarlar → Skills: kurulu bir beceriyi bilgisayara indir (klasör olarak) ya da bilgisayardan
  beceri yükle (içinde SKILL.md olan klasör ya da tek .md dosyası). Yüklenen beceri her projede çalışır
  ve aynı adlı GitHub becerisi onu ezmez
- Düzeltme — ayar dosyasında eski beceri deposu adresi (tulvez-code-skills, hiç yayımlanmadı) kayıtlı
  kalmışsa Ayarlar → Skills "404" gösteriyordu; bu adres artık yeni varsayılana (github.com/tulvez) çevrilir

## 0.2.4

- Yeni — Tulvez'in GitHub'daki becerileri kendiliğinden kurulur: github.com/tulvez altında kökünde
  SKILL.md olan her herkese açık depo bir beceridir. Becerinin bütün klasörü (betikler, belgeler)
  eklentinin kendi alanına iner, her projede çalışır ve 12 saatte bir güncellenir
- Yeni — Tulvez Code kurulu becerileri kendisi kullanır: isteğin bir becerinin açıklamasına uyarsa
  önce o becerinin SKILL.md dosyasını okur ve talimatına göre çalışır. `/skill <ad>` de çalışır
- Düzeltme — varsayılan skills deposu (tulvez/tulvez-code-skills) hiç yayımlanmamıştı, Ayarlar'daki
  liste hep "Depoya ulaşılamadı" gösteriyordu. Varsayılan artık https://github.com/tulvez
- Düzeltme — `/skill` bilinmeyen bir adla çağrılınca ilk beceriyi sessizce çalıştırıyordu; artık
  kurulu becerileri listeler
- Güvenlik — dosya araçları yalnız açık çalışma alanında çalışır. Önceden mutlak yol, `../` ya da
  sembolik bağla klasör dışındaki dosyalar okunup yazılabiliyordu; artık ajan hata alır. Kurulu
  becerilerin klasörü yalnız okunabilir
- Düzeltme — Plan modu artık gerçekten salt okur: dosya yazma ve komut araçları yalnız Build
  modunda verilir (önceden yalnız istem "kod yazma" diyordu)

## 0.2.3

- Düzeltme — "Durdur" düğmesi çalışmıyordu: durdurma sinyali ajana hiç iletilmiyordu, yanıt
  akmaya ve komutlar çalışmaya devam ediyordu. Artık yanıt hemen kesilir, çalışan terminal
  komutu kapatılır, açık izin kartı reddedilmiş sayılır ve "Yanıt durduruldu" görünür
- Düzeltme — istek gönderip başka bir görünüme (Kaynak Denetimi, Gezgin…) geçince yanıt ya da
  komut sonucu kayboluyordu, adım "Yarıda kaldı" görünüyordu. Panel artık gizlenince kapanmaz;
  geri dönünce yanıtın tamamı yerinde durur

## 0.2.2

- Düzeltme — Windows'ta çift tırnaklı komutlar bozuluyordu: `git commit -m "iki kelime"` gibi
  her komut "pathspec … did not match" hatası veriyordu, çünkü cmd.exe Node'un `\"` kaçışını
  tanımıyor. Komut artık cmd.exe'ye olduğu gibi gider (Node'un `shell: true` yöntemi)
- Windows'ta çok satırlı komutun yalnız ilk satırı çalışıyordu; satırlar artık `&&` ile bağlanır
- Ajana Windows'ta komutların cmd.exe ile çalıştığı ve çift tırnak kullanması gerektiği söylenir

## 0.2.1

0.2.0 etiketi yayın testinde durdu, Marketplace'e çıkmadı; aynı içerik bu sürümle çıkar.

Arayüz sıfırdan yeniden tasarlandı (Tulvez Noir). Eklentinin davranışı değişmedi.

- Tulvez kimliği: düz koyu zemin, tek vurgu pirinç `#E8C15A`, gölge ve gradyan yok;
  Manrope + IBM Plex Mono. VS Code açık temasında Tulvez'in açık paleti kullanılır
- Tek başlık: panelin içindeki ikinci "Tulvez Code" başlığı kaldırıldı; yeni sohbet,
  geçmiş ve ayarlar düğmeleri VS Code'un panel başlık çubuğunda
- Yeni ikon: etkinlik çubuğunda Tulvez yörünge işareti (tek renk, açık/koyu temaya uyar);
  uzantı listesinde renkli işaret
- Karşılama: "Bugün neyi inşa ediyoruz?"; klasör açık değilse "Klasör aç";
  ilk kurulum adım çubuklu tek kart
- Sohbet: yanıtlar balonsuz, mod işaretli başlıkla (Tulvez · BUILD); araç çağrıları
  açılır kapanır sıkı satırlar; terminal çıktısı başlıklı kart, hata kodu kırmızı;
  düşünüş açılır hap; hatalar "Tekrar dene" düğmeli kart
- Giriş kutusu: mod (Ask/Plan/Build) ve model seçici hap düğmeler; gönder düğmesi
  ve kenar modun renginde; altında klasörün son iki parçası, token, maliyet ve
  bağlam doluluk çubuğu
- Model adları sade: `deepseek/deepseek-v4.1-flash:free` → "DeepSeek v4.1 Flash",
  `claude-opus-5-5-…` → "Opus 5.5". Ham kimlik menüde ve ipucunda durur
- Komut ve araç onayları giriş kutusunun üstünde tek tip kart: "İzin ver", "Her zaman izin ver",
  "Reddet". "Her zaman izin ver" bundan sonraki bütün izinleri sorulmadan verir (çalışan yanıtın
  sıradaki komutları dahil); Ayarlar → İzinler'den "Onaylı"ya alınarak geri açılır
- `/commit`: commit mesajı kartı ve "Commit at" düğmesi kaldırıldı. Ajan değişikliklere bakar,
  gerekirse `git add` yapar ve `git commit`i kendisi çalıştırır; komut her zamanki gibi izin ister.
  Push yapmaz
- Copilot gibi, ajanın kendi commit'i: Tulvez commit'i kendisi atınca yazar Tulvez Code olur, kullanıcı
  `Co-authored-by` ile eklenir; böylece GitHub'da deponun katkıcılar listesinde tulvez-code[bot] görünür.
  Ayrı bir ayarı yok; "GitHub'da ek katkıcı" kapatılırsa Tulvez hiçbir commit'te görünmez. Kimlik yalnız
  o komutun ortamında verilir, git ayarına dokunulmaz; commit'i işleyen (committer) kullanıcı kalır.
  Kullanıcının kendi commit'leri değişmez
- Odak halkası hiçbir öğede yok
- Geçmiş: arama kutusu, Bugün / Dün / Bu hafta / Daha eski grupları
- Ayarlar sıfırdan: VS Code ayarları düzeni — arama, bölümler (Sağlayıcı, Model,
  Ajan, Gizlilik, Çalışma alanı, Kısayollar), açılır sağlayıcı ve model seçimi.
  İşlevsiz "Sohbette model seçici" anahtarı ve mod açıklama kartı kaldırıldı
- Kaldırılanlar: "Hızlı başla" kartları, "⋯" menüsü, işlevsiz "Ekle" düğmesi
  (commit için `/commit`)
- GitHub ek katkıcı: Tulvez Code'un attığı commit'lerde yazar kullanıcı kalır; mesajın
  sonuna `Co-authored-by: Tulvez Code <343685009+tulvez-code[bot]@users.noreply.github.com>`
  eklenir, GitHub commit'te yazarın yanında tulvez-code[bot] (GitHub App) görünür.
  "Commit at" düğmesi ve ajanın çalıştırdığı `git commit` komutları (`--trailer`) için geçerli.
  Ayarlar → GitHub'dan kapatılabilir (`tulvez.gitCoAuthor`)
- Eski davranış kaldırıldı: 0.1.x deponun `.git/config` dosyasına bot kimliğini yazıyordu,
  bu yüzden bütün commit'lerin yazarı bot oluyordu (`tulvez.gitIdentity` ayarı kalktı).
  Böyle bir depo açılınca bir kez sorulur; onaylanırsa yalnızca yerel ayar silinir
- Copilot gibi, commit anında: Tulvez Code'un değiştirdiği bir dosya commit'e girerse satır commit
  sırasında, mesaj kutusunda görünmeden eklenir (VS Code'un Copilot için yaptığının aynısı). VS Code'dan,
  terminalden ya da başka araçtan atılan commit fark etmez. Bunun için deponun `.git/hooks` klasörüne
  küçük bir `prepare-commit-msg` kancası kurulur; iz `.git/tulvez-ai-edits`'te tutulur (depoya girmez,
  VS Code kapansa da kalır). Commit'e giren ya da geri alınan dosyanın izi silinir; aynı dosya sonra elle
  değişirse satır eklenmez. Depoda başka bir kanca ya da `core.hooksPath` (husky vb.) varsa ona dokunulmaz,
  satır mesaj kutusuna yazılır. Başka ek katkıcılarla (ör. Copilot) aynı ek bloğuna yazılır. Ayar
  kapatılınca kanca ve iz silinir
- Yanıt dili: model kendinden birinci tekil şahısla bahseder, sistem istemini ya da modunu
  kullanıcıya aktarmaz (önce "Şu anda Sen Tulvez Code adlı … modundayım" diyebiliyordu)
- "Hangi moddasın?" sorusuna modunun adıyla yanıt verir (istem her modda modun adını taşır)
- Boş sohbet: üç katmanda süzülen (paralaks), parlayıp sönen yıldızlar ve birkaç saniyede bir
  farklı yerden kayan yıldızlar; başlık "Tulvez Code" + işaret. Hareketi azalt açıksa durağan
- Uzay: uzun beklemede gerçekçi Dünya yörüngede geçer (ilki ~20 sn, sonra 1,5–3 dk'da bir).
  Küre bağımlılıksız küçük bir WebGL çizimi: NASA Blue Marble gündüz ve Black Marble gece ışıkları
  dokusu (kamu malı, 1024×512, eklentiye gömülü — ağ isteği yok), 23,4° eksen eğikliği, gece/gündüz
  sınırı, okyanus parlaması, atmosfer; dönüş yönü gerçeğe uygun (batıdan doğuya). Yalnız ekrandayken
  çizer, 30 kare/sn (zayıf donanımda 20). WebGL yoksa gösterilmez
- Dünyadan sonra Ay ve uydu geçer. Ay aynı WebGL çizimiyle: NASA LRO renkli Ay dokusu (kamu malı,
  512×256, gömülü), atmosfersiz keskin gündüz/gece sınırı, regolitin ışığı geri yansıtması ve hafif Dünya
  ışığı. Uydu ISS benzeri SVG (kafes, dört çift güneş kanadı, modüller, radyatörler), yavaş döner ve
  geçişin ortasında paneline güneş vurur. Aynı anda tek cisim geçer, WebGL bağlamı da tektir
- Uzay yalnız boş sohbette bağlıdır; ayarlar/geçmişten dönünce baştan başlar (kaldığı yerden devam
  özelliği ayarlar ve geçmişin açılmasını bozduğu için kaldırıldı)
- Eski donanım: yalnız transform/opacity hareketi, 4 çekirdek ve altında yarı yıldız ve tek kayan
  yıldız, panel görünmezken bütün hareket durur
- Ayarlar Codex mantığında sıfırdan: panelde yalnız temel ajan ayarları — Bağlantı (sağlayıcı, anahtar,
  durum), Model, İzinler (Yalnız sohbet / Onaylı / Tam erişim; eski iki anahtarın yerine tek seçim),
  Kişiselleştirme ve Skills (ayrı alt sayfa). Altta "code_skills.md'yi aç" ve "Tüm ayarlar (VS Code)".
  Çalışma alanı oluşturma, kısayol listesi ve "yakında" satırı kaldırıldı
- Düzeltme — ayarlar bazen açılmıyordu: kenar çubuğu yeniden kurulurken başlık düğmesinin komutu
  webview hazır olmadan gidip kayboluyordu; artık hazır olana kadar bekletiliyor. ⚙ ve geçmiş düğmeleri
  aç/kapa değil, her basışta ilgili sayfayı açıyor
- F5 geliştirme günlüğü: `.tulvez-dev.log` (açılış adımları, yakalanmamış hatalar, webview hataları,
  ekran kartı); yalnız geliştirme kipinde yazılır. Dünya küresinin WebGL'i artık ilk geçişte kurulur ve
  yalnız donanım hızlandırmalı ortamda çalışır (açılışta ekran kartına dokunulmaz)
- Skills deposu: Ayarlar → Skills'te Tulvez'in resmî deposundaki skill'ler listelenir, tek tıkla kurulur
  ya da kaldırılır. Kurulan skill çalışma alanında `.tulvez/skills/<id>.md` olur ve `/skill <id>` ile
  çalışır. Depo adresi `tulvez.skillsRegistry` (varsayılan github.com/tulvez/tulvez-code-skills);
  `index.json` doğrulanır (yol kaçışı, geçersiz kimlik atılır), dosyalar 64 KB ile sınırlı
- Karşılama başlığı "[işaret] Tulvez Code"; işaret uygulamaya gömülü, yazıdan sonra belirmiyor.
  Alt metin kelime kelime belirir
- Yapay zekâ çalışırken giriş kutusunun kenarında mod renginde ışık döner (bağımlılıksız, border-beam benzeri)
- Dar panel: uyarı şeridi yok; 220 px altında yalnız "paneli genişlet" ekranı. Dizin adı dar
  panelde de görünür (maliyet/bağlam ipucuna geçer)
- Komutlar sırasıyla ve sonucuyla: yanıt metin → komut → metin bölümlerine ayrılır. Komut kartında
  `$ komut`, çalışıyor/tamam/hata durumu, süre ya da çıkış kodu ve çıktı; dosya okuma, arama ve düzenleme
  gibi araçlar tek satır ("Okunuyor…" → "Okundu"), açılınca sonucu gösterir. Kopyala düğmesi yanıtın
  bütün bölümlerini birlikte kopyalar; modele giden geçmişte bölümler tek yanıt olarak birleşir
- Geçmiş: açık sohbet geçmişe hemen yazılır (hatayla biten ya da yeni sohbet açmadan kapatılan sohbet
  de listede görünür). Düzeltme: yeniden yüklemede oturum ve mesaj kimlikleri 1'den başlayıp eski
  kayıtlarla çakışabiliyordu
- Özel uç nokta: örnek adresler (OpenRouter, LM Studio, vLLM) tıklanınca alana yazılır
- Kopyalama panoya yalnız düz metin koyar (HTML kopyası zengin metin alan yerlerde "──" çizgisine
  dönüşüyordu)
- Kopyalama: seçim kapalı bir düşünüş ya da araç bölümünü kapsıyorsa onun içeriği de kopyalanır;
  düşünüş ve araç başlıkları da seçilebilir
- Sohbeti Markdown olarak kaydet: başlık çubuğunda yeni sohbetin yanında. Sohbet adıyla
  `.tulvez/sohbetler/<tarih> <ad>.md` olarak yazılır (klasör git'e girmez) ve VS Code'da açılır;
  klasör açık değilse eklentinin kendi alanına yazılır
- Dar panelde (≤300 px) ikincil bilgiler gizlenir
- Düzeltme — uzun sohbette kaydırma takılması: akan yanıt parçaları 48 ms'de bir
  toplu çiziliyor ve yalnız akan mesaj yeniden işleniyor (önceden her parçada
  bütün mesajların markdown'ı yeniden işleniyordu). Alta yapışma ResizeObserver
  ile anlık; yukarı kaydırınca bırakılıyor, alta inince geri geliyor
- Düzeltme — "en alta git" düğmesi: kaydırma alanının dışında sabit; akış sırasında
  tıklanınca alta inip takibe dönüyor. Geçmiş/ayarlardan dönünce de çalışıyor
- Düzeltme — `code_skills.md` artık her istekte okunur: kimlik ve kurallar yalnız eklenti açılırken
  okunuyordu, dosyadaki değişiklik VS Code yeniden yüklenene kadar ajana ulaşmıyordu

## 0.1.0

> VS Code Marketplace, `package.json` içinde prerelease sürüm numaralarını
> desteklemediği için sürüm numarası daima düz semver olarak tutulur
> (örn. `0.1.0`). Prerelease yayınlamak istenirse git etiketi `v0.1.0-beta.1`
> şeklinde atılır; workflow `--pre-release` bayrağını otomatik ekler.

- İlk sürüm: Tulvez Code yapay zeka kodlama asistanı
- BYOK mimarisi: API anahtarı VS Code SecretStorage'da saklanır
- Sağlayıcılar: OpenAI, Anthropic, Google Gemini, Groq, Ollama
- Tool-calling döngüsü: `read_file`, `write_file`, `edit_file`, `list_files`, `run_command`
- Ask/Plan/Build modları ile rol tabanlı davranış
- Git yardımcıları: `/commit`, `/review`, `/diff`, `/explain`, `/run`
- Markdown render, thinking animasyonu, token/maliyet/bağlam istatistikleri
- Sohbet geçmişi ve kotalar Ayarlar'da

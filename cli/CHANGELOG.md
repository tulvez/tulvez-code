# Değişiklik günlüğü — Tulvez Code CLI

## 0.1.0

İlk sürüm. Tulvez Code eklentisinin ajanı terminalde.

- `tulvez`: bulunulan klasörde etkileşimli oturum; `tulvez "istek"`: tek istek, yanıt stdout'a, adımlar stderr'e.
- Terminal arayüzü: degrade renkli TULVEZ logosu ve "Code CLI" yazısı, ilk açılışta kurulum (sağlayıcı → anahtar →
  model, ok tuşlarıyla), mod renginde çerçeveli giriş kutusu, `/` komut menüsü, `@` dosya önerileri, düşünme
  göstergesi, markdown biçimli yanıt, seçmeli onaylar ("bu oturumda bir daha sorma"), Shift+Tab ile mod değiştirme,
  oturumlar arası komut geçmişi. Ek bağımlılık yok; çıktı yönlendirilince düz metne geçer.
- Boru hattı: `komut | tulvez "açıkla"` girdiyi isteğe ekler.
- Ask, Plan ve Build modları (`-m`, oturumda `/mod`); eklentiyle aynı araçlar, yapılacaklar listesi ve sohbet hafızası.
- Komutlar ve araçlar her seferinde onay ister (`-y` ile sorulmaz); girdi terminal değilse onay verilmez.
- `/undo`: son yanıtın yazdığı dosyaları eski haline döndürür.
- Sağlayıcılar: OpenAI, Anthropic, Gemini, Groq, OpenCode Zen, OpenRouter, Ollama, OpenAI uyumlu özel adres.
  OpenRouter'da model listesi yalnız araç destekleyen modelleri gösterir; desteklemeyen modelin hatası Türkçe.
- Ekran (pi-tui ile): tam ekran açılır, terminalin önceki komutları görünmez; çıkınca sohbet terminal geçmişine
  yazılır. Yalnız değişen satırlar çizilir (titreme yok). Fare tekerleği, PgUp/PgDn, Ctrl+Home/End ile kaydırma, "en
  alta in" düğmesi; sürükleyerek seçme ve panoya kopyalama, sağ tıkla yapıştırma; Windows'ta fare olayları yerel
  yardımcıyla açılır. 10 satırdan uzun yapıştırma kutuda katlanır. Node.js 22.19 ve üstü gerekir.
- Mesaj sırası: yanıt sürerken yazılıp Enter'a basılan mesaj sıraya eklenir, yanıt bitince gönderilir; Ctrl+S
  yanıtı durdurup sıradakini hemen gönderir, Esc durdurur ve sıradakileri kutuya geri koyar.
- Claude Code düzeni: `?` kısayollar, `!` ile komut doğrudan terminalde (çıktısı modele de gider), `#` ile not
  AGENTS.md'ye; araç adımları "● Oku(dosya) └ 42 satır okundu"; düzenlemelerde renkli fark; yanıt akarken canlı görünür.
- Hız sınırında istek bekleyip yinelenir; bekleme yalnız göstergede görünür (sohbete satır yazılmaz). 429 iletisindeki
  dakikalık token sınırı küçükse (Groq ücretsiz plan, ≤16.000) az token kipine geçilir: proje haritası gönderilmez,
  araç çıktıları sınıra göre kısalır. İstek modelin
  sınırından büyükse (Groq ücretsiz plan: dakikada 8.000 token) sınır öğrenilir, araç çıktıları kısaltılıp kaldığı yerden sürülür.
- Komutlar İngilizce (`/help`, `/mode`, `/model`, `/provider`, `/clear`, `/undo`, `/approve`, `/config`, `/logout`,
  `/exit`), her birinin yanında kısa Türkçe açıklama; eski Türkçe adlar da çalışır.
- Modelin düşünme metni ekrana dökülmez; yalnız "Düşünüyor…" göstergesi.
- Oturum kaydı: `tulvez -c` (`--continue`) bu klasördeki son oturumu, `tulvez -r` (`--resume`) ya da `/resume`
  listeden seçileni sürdürür; konuşma ekrana gelir, model araç sonuçları dahil hatırlar. Kayıtlar `sessions/`
  altında (izin 600, en çok 50).
- `/compact`: konuşma modele özetletilir, sonraki istekler özetle sürer; bağlam %80'e gelince kendiliğinden.
  `/context` ve durum satırında bağlam doluluğu.
- Web araması (`web_search`): Brave Search ya da Tavily anahtarı varsa onlar, yoksa anahtarsız Tulvez Arama;
  `cli.json` → `webSearch` ile seçilir ya da kapatılır.
- Görsel yapıştırma: Ctrl+V / Alt+V panodaki ekran görüntüsünü `[Görsel #1]` olarak ekler, mesajla modele gider
  (görsel destekli model gerekir). Eski turlarda ve oturum kaydında görsel yer tutucuya iner.
- İzin kuralları (`cli.json` → `permissions.allow/deny`, Claude Code biçimi: `Bash(npm test:*)`) ve hook'lar
  (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`; çıkış 2 engeller). `/permissions`, `/hooks`.
- `cli.json` → `webSearch` artık okunuyor (önceki sürümde yok sayılıyordu).
- Alt ajanlar (`task` aracı): geniş araştırma ayrı bağlamda, salt okuma araçlarıyla yürür, rapor ana ajana döner.
- Mesajın Claude Code'daki gibi arka planlı kutuda ("❯ metin"); `!` komutu ve `/` komutları da öyle.
- Yanıt altındaki sayaç girdi ve çıktıyı ayrı gösterir ("2.430 girdi · 14 çıktı"). Selamlaşma ve kısa sohbette
  ("merhaba", "nasılsın", "teşekkürler") modele proje talimatları, proje haritası ve araç tanımları gönderilmez.
- Sağlayıcı önbelleği: talimat + araçlar + proje haritası her istekte birebir aynı gider (harita 30 dakikada bir
  yenilenir), Groq gpt-oss / OpenAI / Gemini bunu otomatik önbelleğe alır (Groq'ta önbellekten gelen giriş dakikalık
  sınıra sayılmaz); Anthropic'te önbellek işareti konur. Sayaç önbellekten gelen kısmı gösterir. Son iki turdan
  eski araç çıktıları kısa özete iner.
- Hatalar Türkçe ve ne yapılacağıyla (hız sınırı, geçersiz anahtar, kota, bağlantı, model); kütüphane çıktısı
  ekran yerine `cli.log` dosyasına.
- API anahtarı: kurulumda kaydedilebilir (`anahtarlar.json`, izin 600; Windows, macOS, Linux); ortam değişkeni varsa
  önce o. Ayarlar `cli.json` dosyasında (anahtar içermez). `/logout` kaydı siler.
- MCP sunucuları: `cli.json` → `mcpServers`; projedeki `.mcp.json` sunucuları onay verilmeden başlamaz.
- Proje talimatları (AGENTS.md, CLAUDE.md…), `code_skills.md` ve kurulu beceriler eklentideki gibi okunur.

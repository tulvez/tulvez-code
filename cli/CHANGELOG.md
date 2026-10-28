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
- `/geri-al`: son yanıtın yazdığı dosyaları eski haline döndürür.
- Sağlayıcılar: OpenAI, Anthropic, Gemini, Groq, OpenCode Zen, Ollama, OpenAI uyumlu özel adres.
- Ekran: giriş kutusu ve durum satırı hep altta sabit; sohbet terminalin kendi geçmişine yazılır (kaydırma,
  seçme, sağ tıkla yapıştırma terminalde çalışır); boş sohbette ortada logo ve örnekler, ilk mesajla sohbet görünümü.
- Mesaj sırası: yanıt sürerken yazılıp Enter'a basılan mesaj sıraya eklenir, yanıt bitince gönderilir; Ctrl+S
  yanıtı durdurup sıradakini hemen gönderir, Esc durdurur ve sıradakileri kutuya geri koyar.
- Claude Code düzeni: `?` kısayollar, `!` ile komut doğrudan terminalde (çıktısı modele de gider), `#` ile not
  AGENTS.md'ye; araç adımları "● Oku(dosya) └ 42 satır okundu"; düzenlemelerde renkli fark; yanıt akarken canlı görünür.
- Hız sınırında istek bekleyip yinelenir ve bekleme ekranda görünür ("18 sn bekleyip devam ediyorum").
- Hatalar Türkçe ve ne yapılacağıyla (hız sınırı, geçersiz anahtar, kota, bağlantı, model); kütüphane çıktısı
  ekran yerine `cli.log` dosyasına.
- API anahtarı: kurulumda kaydedilebilir (`anahtarlar.json`, izin 600; Windows, macOS, Linux); ortam değişkeni varsa
  önce o. Ayarlar `cli.json` dosyasında (anahtar içermez). `/anahtar-sil` kaydı siler.
- MCP sunucuları: `cli.json` → `mcpServers`; projedeki `.mcp.json` sunucuları onay verilmeden başlamaz.
- Proje talimatları (AGENTS.md, CLAUDE.md…), `code_skills.md` ve kurulu beceriler eklentideki gibi okunur.

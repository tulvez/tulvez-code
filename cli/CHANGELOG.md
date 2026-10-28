# Değişiklik günlüğü — Tulvez Code CLI

## 0.1.0

İlk sürüm. Tulvez Code eklentisinin ajanı terminalde.

- `tulvez`: bulunulan klasörde etkileşimli oturum; `tulvez "istek"`: tek istek, yanıt stdout'a, adımlar stderr'e.
- Boru hattı: `komut | tulvez "açıkla"` girdiyi isteğe ekler.
- Ask, Plan ve Build modları (`-m`, oturumda `/mod`); eklentiyle aynı araçlar, yapılacaklar listesi ve sohbet hafızası.
- Komutlar ve araçlar her seferinde onay ister (`-y` ile sorulmaz); girdi terminal değilse onay verilmez.
- `/geri-al`: son yanıtın yazdığı dosyaları eski haline döndürür.
- Sağlayıcılar: OpenAI, Anthropic, Gemini, Groq, OpenCode Zen, Ollama, OpenAI uyumlu özel adres.
- API anahtarı yalnız ortam değişkeninden okunur; ayarlar `cli.json` dosyasında (anahtar içermez).
- MCP sunucuları: `cli.json` → `mcpServers`; projedeki `.mcp.json` sunucuları onay verilmeden başlamaz.
- Proje talimatları (AGENTS.md, CLAUDE.md…), `code_skills.md` ve kurulu beceriler eklentideki gibi okunur.

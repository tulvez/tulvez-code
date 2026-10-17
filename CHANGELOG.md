# Changelog

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

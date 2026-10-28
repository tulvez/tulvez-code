# Tulvez Code

Gizlilik odaklı, BYOK yapay zeka kodlama asistanı — VS Code için.

> 🇬🇧 [English below](#english)

---

## Özellikler

- **Ask / Plan / Build modları** — Soru sor, adım adım plan üret veya Tulvez'in kodu doğrudan yazmasını sağla
- **Çoklu sağlayıcı** — OpenAI, Anthropic, Google Gemini, Groq, OpenCode, OpenCode Go, Ollama (yerel/çevrimdışı)
- **Gerçek araç kullanımı** — `read_file`, `grep_files`, `write_file`, `replace_in_file`, `run_command` ile dosyalarına gerçekten dokunur; yalnız açık klasörde çalışır, Ask ve Plan modları salt okur
- **Beceriler (skills)** — Tulvez'in GitHub'daki becerileri ([scale-engineer](https://github.com/tulvez/scale-engineer) gibi) kendiliğinden kurulur ve güncellenir; isteğin bir beceriye uyarsa Tulvez onu kendisi kullanır; `/skill` yazınca listeden seçebilir, kendi becerini bilgisayardan yükleyebilir ya da indirebilirsin
- **Sohbet hafızası** — Tulvez önceki mesajlarda okuduğu dosyaları ve komut çıktılarını hatırlar; bağlam dolunca eski araç çıktılarını kendisi kısaltır
- **Geri al** — Bir yanıtta Tulvez'in değiştirdiği bütün dosyalar tek düğmeyle eski haline döner
- **Yapılacaklar listesi** — Çok adımlı işlerde ne yapıldığını, ne kaldığını canlı gösterir
- **`@dosya`** — `@` yazınca projedeki dosyaları seç; içerikleri mesajla birlikte gider
- **MCP** — Model Context Protocol sunucularıyla dış araçlar ekle (GitHub, veritabanı, tarayıcı…); Claude Code / Cursor yapılandırmasıyla aynı biçim
- **Proje talimatları** — `AGENTS.md`, `CLAUDE.md`, `.cursorrules` gibi dosyalar her istekte okunur
- **`web_fetch`** — Belge ve sürüm notu sayfalarını okuyabilir (onaylı)
- **Onay akışı** — Dosya düzenlemeleri otomatik uygulanır; terminal komutları onay ister (ayarlanabilir)
- **Git kısayolları** — `/commit`, `/review`, `/diff`, `/explain`
- **Markdown render**, düşünüş animasyonu, token / maliyet / bağlam istatistikleri
- **Türkçe ve İngilizce** — Arayüz ve yanıtlar VS Code'un dilini izler; Ayarlar'dan da seçilir
- **Tam BYOK** — API anahtarın yalnızca VS Code'un şifreli `SecretStorage`'ında saklanır. Tulvez sunucusuna hiçbir şey gönderilmez.

## Desteklenen Sağlayıcılar

| Sağlayıcı | Notlar |
|---|---|
| Google Gemini | Ücretsiz katman mevcut |
| OpenAI | GPT-4o, o1, o3… |
| Anthropic | Claude 3.5 / 3.7… |
| Groq | Çok hızlı çıkarım |
| OpenCode | Kullandıkça öde; Claude, GPT, Gemini ve açık modeller tek anahtarla. Ücretsiz modelleri (big-pickle, *-free) OpenCode'un kuralı gereği yalnız OpenCode uygulamasında çalışır |
| OpenCode Go | Aylık abonelik, açık modeller |
| Ollama | Yerel, API anahtarı gerekmez |
| Özel (OpenAI uyumlu) | OpenRouter, LM Studio, vLLM, Jan… |

## Kurulum

1. Marketplace'ten **Tulvez Code**'u yükle
2. Activity Bar'daki Tulvez Code ikonuna tıkla
3. Ayarlar sekmesinden API anahtarını gir (veya ilk açılışta karşılama kartından)
4. Sağlayıcı ve modeli seç — hazır

## Slash Komutları

| Komut | Açıklama |
|---|---|
| `/commit` | Staged değişikliklerden commit mesajı üret |
| `/review` | Aktif dosyayı AI ile incele |
| `/diff` | Mevcut git diff'i özetle |
| `/explain` | Seçili kodu açıkla |
| `/run <komut>` | Onaylı terminal komutu çalıştır |

## Gizlilik

- API anahtarları VS Code `SecretStorage`'da şifreli saklanır — makinenden çıkmaz.
- Kodun **doğrudan** seçtiğin sağlayıcıya gönderilir. Tulvez'in arka uç sunucusu yoktur.
- `tulvez.sendCodeContext` kapatılırsa aktif dosya isteklere eklenmez.

## Gereksinimler

- VS Code `^1.85.0`
- Seçilen sağlayıcı için API anahtarı (veya yerel Ollama)

## Eklenti Ayarları

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `tulvez.aiProvider` | `openai` | AI sağlayıcısı |
| `tulvez.model` | _(sağlayıcı varsayılanı)_ | Model adı |
| `tulvez.sendCodeContext` | `false` | Aktif dosyayı isteklere ekle |
| `tulvez.allowShellCommands` | `false` | Terminal komutlarına izin ver |
| `tulvez.autoApproveCommands` | `false` | Komutları otomatik onayla |
| `tulvez.showThinking` | `true` | Model düşünüşünü göster |

## Lisans

MIT — [LICENSE](LICENSE)

---

## English

Privacy-focused, BYOK AI coding assistant for VS Code.

### Features

- **Ask / Plan / Build modes** — Ask questions, generate step-by-step plans, or let Tulvez actively write and edit your code
- **Multi-provider** — OpenAI, Anthropic, Google Gemini, Groq, OpenCode, OpenCode Go, Ollama (local/offline)
- **Real tool use** — `read_file`, `grep_files`, `write_file`, `replace_in_file`, `run_command` — Tulvez actually touches your files, only inside the open folder; Ask and Plan modes are read-only
- **Skills** — Tulvez's skills on GitHub (such as [scale-engineer](https://github.com/tulvez/scale-engineer)) install and update themselves; when your request matches one, Tulvez uses it on its own; type `/skill` to pick one from a list, or upload and download your own skills
- **Conversation memory** — Tulvez remembers the files it read and the command output from earlier messages; when the context fills up it trims old tool output on its own
- **Undo** — One button restores every file Tulvez changed in a reply
- **To-do list** — For multi-step work, shows live what is done and what is left
- **`@file`** — Type `@` to pick files from your project; their contents go with your message
- **MCP** — Add external tools with Model Context Protocol servers (GitHub, databases, browsers…); same configuration format as Claude Code / Cursor
- **Project instructions** — Files such as `AGENTS.md`, `CLAUDE.md`, `.cursorrules` are read on every request
- **`web_fetch`** — Can read documentation and release-note pages (with approval)
- **Approval flow** — File edits are applied automatically; terminal commands require your confirmation (configurable)
- **Git shortcuts** — `/commit`, `/review`, `/diff`, `/explain`
- **Markdown rendering**, reasoning animation, token / cost / context-window stats
- **Turkish and English** — The interface and replies follow your VS Code language; you can also pick one in Settings
- **100% BYOK** — Your API key lives only in VS Code's encrypted `SecretStorage`. Nothing is sent to Tulvez servers.

### Supported Providers

| Provider | Notes |
|---|---|
| Google Gemini | Free tier available |
| OpenAI | GPT-4o, o1, o3… |
| Anthropic | Claude 3.5 / 3.7… |
| Groq | Very fast inference |
| OpenCode | Pay as you go; Claude, GPT, Gemini and open models with one key. Its free models (big-pickle, *-free) only work in the OpenCode app, by OpenCode's rule |
| OpenCode Go | Monthly subscription, open models |
| Ollama | Local, no API key needed |
| Custom (OpenAI-compatible) | OpenRouter, LM Studio, vLLM, Jan… |

### Getting Started

1. Install **Tulvez Code** from the Marketplace
2. Click the Tulvez Code icon in the Activity Bar
3. Enter your API key in the Settings tab (or the welcome card on first launch)
4. Pick your provider and model — done

### Privacy

- API keys are stored in VS Code `SecretStorage` — encrypted, never leaves your machine.
- Your code is sent **directly** to the provider you choose. Tulvez has no backend.
- Turn off `tulvez.sendCodeContext` to stop the active file from being included in requests.

### License

MIT — see [LICENSE](LICENSE)

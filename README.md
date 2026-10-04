# Tulvez Code

Gizlilik odaklı, BYOK yapay zeka kodlama asistanı — VS Code için.

> 🇬🇧 [English below](#english)

---

## Özellikler

- **Ask / Plan / Build modları** — Soru sor, adım adım plan üret veya Tulvez'in kodu doğrudan yazmasını sağla
- **Çoklu sağlayıcı** — OpenAI, Anthropic, Google Gemini, Groq, Ollama (yerel/çevrimdışı)
- **Gerçek araç kullanımı** — `read_file`, `write_file`, `edit_file`, `list_files`, `run_command` ile dosyalarına gerçekten dokunur
- **Onay akışı** — Dosya düzenlemeleri otomatik uygulanır; terminal komutları onay ister (ayarlanabilir)
- **Git kısayolları** — `/commit`, `/review`, `/diff`, `/explain`
- **Markdown render**, düşünüş animasyonu, token / maliyet / bağlam istatistikleri
- **Tam BYOK** — API anahtarın yalnızca VS Code'un şifreli `SecretStorage`'ında saklanır. Tulvez sunucusuna hiçbir şey gönderilmez.

## Desteklenen Sağlayıcılar

| Sağlayıcı | Notlar |
|---|---|
| Google Gemini | Ücretsiz katman mevcut |
| OpenAI | GPT-4o, o1, o3… |
| Anthropic | Claude 3.5 / 3.7… |
| Groq | Çok hızlı çıkarım |
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
- **Multi-provider** — OpenAI, Anthropic, Google Gemini, Groq, Ollama (local/offline)
- **Real tool use** — `read_file`, `write_file`, `edit_file`, `list_files`, `run_command` — Tulvez actually touches your files
- **Approval flow** — File edits are applied automatically; terminal commands require your confirmation (configurable)
- **Git shortcuts** — `/commit`, `/review`, `/diff`, `/explain`
- **Markdown rendering**, reasoning animation, token / cost / context-window stats
- **100% BYOK** — Your API key lives only in VS Code's encrypted `SecretStorage`. Nothing is sent to Tulvez servers.

### Supported Providers

| Provider | Notes |
|---|---|
| Google Gemini | Free tier available |
| OpenAI | GPT-4o, o1, o3… |
| Anthropic | Claude 3.5 / 3.7… |
| Groq | Very fast inference |
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

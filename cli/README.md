# Tulvez Code CLI

Tulvez Code'un terminal sürümü. VS Code eklentisindeki ajanın aynısı: dosyaları okur, düzenler,
onayınla komut çalıştırır. Sağlayıcı ve anahtar senin.

## Kurulum

```bash
npm install -g @tulvez-code/cli
```

Node.js 20 ya da üstü gerekir.

## Kullanım

```bash
cd projem
export OPENAI_API_KEY=...            # ya da sağlayıcının kendi değişkeni (aşağıda)

tulvez                               # etkileşimli oturum
tulvez "README'ye kurulum bölümü ekle"   # tek istek: yanıtı yazar ve çıkar
tulvez -m ask "bu depo ne yapıyor?"   # salt okuma
npm test 2>&1 | tulvez "neden kırıldı?"   # girdi isteğe eklenir
tulvez ayarlar                       # etkin ayarlar ve ayar dosyasının yeri
```

`tulvez` tam ekran açılır (Claude Code, opencode gibi): terminalin önceki komutları görünmez, çıkınca terminal eski
haline döner. Sohbet üstte kendi kaydırmasıyla akar; giriş kutusu ve durum satırı hep ekranın en altında sabittir ve
kaydırmaya katılmaz. Fare tekerleği, ↑ ↓ ve PgUp/PgDn sohbeti kaydırır; sürükleyerek seçme ve sağ tıkla yapıştırma
terminalin kendisinde çalışır. Boş sohbette ortada logo, örnek istekler ve kısayollar görünür; ilk mesajla sohbet
görünümüne geçilir (`/yeni` boş ekrana döner).

İlk açılışta kurulum ekranı gelir: sağlayıcıyı ok tuşlarıyla seçer, anahtarı yapıştırıp istersen kaydeder, modeli
listeden seçersin. Sohbette: mod renginde çerçeveli giriş kutusu, `/` ile komut menüsü, `@` ile dosya önerileri,
düşünme göstergesi, biçimlendirilmiş yanıt (başlık, liste, kod bloğu) ve seçmeli onay kutuları.

Çıktı bir dosyaya ya da başka bir komuta yönlendirilirse düz metne geçer: yanıt stdout'a, araç adımları stderr'e
yazılır (`tulvez "…" > yanit.md` yalnız yanıtı kaydeder).

### Kısayollar

| Tuş | |
|---|---|
| Enter | gönder · yanıt sürerken **sıraya ekler** (yanıt bitince sırayla gönderilir) |
| Ctrl+S | süren yanıtı durdur, sıradaki ilk mesajı hemen gönder (kutuda yazı varsa önce o) |
| Esc | süren yanıtı durdur; sıradaki mesajlar düzenlemek için kutuya geri gelir · boşta iki kez: girişi sil |
| `?` | kısayol listesi |
| `!komut` | komutu doğrudan terminalde çalıştır; çıktısı bir sonraki istekte modele de gider |
| `# not` | notu AGENTS.md'ye ekle (sonraki isteklerde proje kuralı olarak okunur) |
| `\` + Enter | yeni satır (yapıştırılan çok satırlı metin de olduğu gibi kalır) |
| Shift+Tab | modu değiştir: Build → Plan → Ask |
| Tekerlek · ↑ ↓ | sohbeti kaydır (giriş kutusu yerinde kalır) · PgUp/PgDn sayfa · Ctrl+End en alta |
| Ctrl+↑ ↓ | önceki istekler (oturumlar arası saklanır) |
| Sürükle · sağ tık | terminalin kendisi: seç, yapıştır |
| Ctrl+V | yapıştır; terminal yapıştırmazsa (cmd, VS Code) pano okunur: Windows PowerShell, macOS `pbpaste`, Linux `wl-paste`/`xclip`/`xsel` |
| Ctrl+C | girişi sil · yanıt sürerken durdur · boşken iki kez: çık |
| Ctrl+D | çık |

### Modlar

| Mod | Ne yapar |
|---|---|
| `ask` | Okur, açıklar; dosya değiştirmez, komut çalıştırmaz |
| `plan` | Adım adım plan çıkarır; değişiklik yapmaz |
| `build` (varsayılan) | Dosyaları düzenler, komut çalıştırır |

### Oturum komutları

| Komut | |
|---|---|
| `/mod <ask\|plan\|build>` | Modu değiştirir |
| `/model [kimlik]` | Modeli değiştirir (kimliksiz: sağlayıcının listesinden seç) |
| `/saglayici` | Sağlayıcı, anahtar ve modeli yeniden kurar |
| `/yeni` | Yeni sohbet (hafıza sıfırlanır, boş ekrana döner) |
| `/geri-al` | Son yanıtın yazdığı dosyaları eski haline döndürür |
| `/onay` | Komut onaylarını bu oturumda açar ya da kapatır |
| `/ayarlar` | Etkin ayarları gösterir |
| `/anahtar-sil` | Bu sağlayıcının kayıtlı anahtarını siler |
| `/temizle` | Ekranı temizler (sohbet hafızası kalır) |
| `/cikis` | Çıkar (Ctrl+D da olur) |

## Güvenlik

- Araçlar yalnız çalışma klasöründe (bulunulan klasör ya da `-C <klasör>`) okur ve yazar.
- Her terminal komutu ve web indirmesi çalışmadan önce onay ister. `-y` onayları sormadan verir; yalnız
  güvendiğin işlerde kullan.
- Girdi bir terminal değilse (boru hattı, CI) onay sorulamaz ve komut reddedilir; gerekiyorsa `-y` ver.
- Projedeki `.mcp.json` sunucuları kod çalıştırabileceği için onay verilmeden başlamaz.
- `/geri-al` yalnız Tulvez Code'un yazdığı dosyaları geri alır; terminal komutlarının yaptığı değişiklikleri değil.

## Sağlayıcı ve API anahtarı

Kurulum ekranında yapıştırdığın anahtarı **kaydedebilirsin** (Windows, macOS ve Linux'ta aynı):
`~/.config/tulvez/anahtarlar.json` (Windows: `%APPDATA%\tulvez\anahtarlar.json`). Dosya yalnız senin okuyabileceğin
izinle (600) yazılır; `cli.json`'a hiçbir zaman anahtar yazılmaz. `/anahtar-sil` kaydı siler.

Ortam değişkeni varsa önce o kullanılır (CI ve betikler için): `TULVEZ_API_KEY` her sağlayıcıda geçerlidir; yoksa
sağlayıcının kendi değişkenine bakılır. Sıra: ortam değişkeni → kayıtlı anahtar.

| Sağlayıcı (`--provider`) | Anahtar değişkeni |
|---|---|
| `openai` (varsayılan) | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `gemini` | `GEMINI_API_KEY` ya da `GOOGLE_GENERATIVE_AI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `opencode` | `OPENCODE_API_KEY` |
| `ollama` | gerekmez (`OLLAMA_HOST`, varsayılan `http://localhost:11434`) |
| `custom` | `TULVEZ_API_KEY`; adres `--base-url` ya da `TULVEZ_BASE_URL` (OpenAI uyumlu) |

Diğer değişkenler: `TULVEZ_PROVIDER`, `TULVEZ_MODEL`, `TULVEZ_CONFIG_DIR`, `NO_COLOR`.

## Ayar dosyası

`~/.config/tulvez/cli.json` (Windows: `%APPDATA%\tulvez\cli.json`). Öncelik: dosya < ortam değişkeni < komut satırı.

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "allowShellCommands": true,
  "gitCoAuthor": true,
  "mcpServers": {
    "dosyalar": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  }
}
```

Anahtar alanları (`apiKey` vb.) bu dosyada kullanılmaz.

## Proje talimatları ve beceriler

Eklentideki gibi: çalışma klasöründeki `AGENTS.md`, `CLAUDE.md`, `.cursorrules` vb. ve `code_skills.md` her istekte
okunur. GitHub becerileri ayar klasöründe (`skills/`) tutulur ve etkileşimli oturum açılırken 12 saatte bir eşitlenir.

## Lisans

MIT

# Tulvez Code CLI

Tulvez Code'un terminal sürümü. VS Code eklentisindeki ajanın aynısı: dosyaları okur, düzenler,
onayınla komut çalıştırır. Sağlayıcı ve anahtar senin.

## Kurulum

```bash
npm install -g @tulvez-code/cli
```

Node.js 22.19 ya da üstü gerekir.

## Kullanım

```bash
cd projem
export OPENAI_API_KEY=...            # ya da sağlayıcının kendi değişkeni (aşağıda)

tulvez                               # etkileşimli oturum
tulvez "README'ye kurulum bölümü ekle"   # tek istek: yanıtı yazar ve çıkar
tulvez -m ask "bu depo ne yapıyor?"   # salt okuma
npm test 2>&1 | tulvez "neden kırıldı?"   # girdi isteğe eklenir
tulvez ayarlar                       # etkin ayarlar ve ayar dosyasının yeri
tulvez -c                            # bu klasördeki son oturumu sürdür (--continue)
tulvez -r                            # kayıtlı oturumlardan seç (--resume)
```

`tulvez` tam ekran açılır (Claude Code'un tam ekran modu gibi): terminalin önceki komutları görünmez; çıkınca terminal
eski haline döner ve sohbet terminalin geçmişine yazılır. Sohbet üstte kendi kaydırmasıyla akar; giriş kutusu ve durum
satırı hep altta sabittir. Fare tekerleği ve PgUp/PgDn sohbeti kaydırır (yukarıdayken "en alta in" düğmesi çıkar),
fareyle sürükleyince seçilen metin panoya kopyalanır, sağ tık yapıştırır. 10 satırdan uzun yapıştırma kutuda
`[Yapıştırılan metin #1 · 40 satır]` olarak katlanır, gönderince tamamı gider. Boş sohbette ortada logo, örnek istekler
ve kısayollar görünür (`/clear` boş ekrana döner).

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
| ↑ ↓ | önceki istekler (oturumlar arası saklanır) |
| Tekerlek · PgUp/PgDn | sohbeti kaydır (giriş kutusu yerinde kalır) · Ctrl+Home/End başa/sona |
| Sürükle · sağ tık | seç ve panoya kopyala · yapıştır |
| Ctrl+V · Alt+V | yapıştır; panoda görsel (ekran görüntüsü) varsa kutuya `[Görsel #1]` olarak eklenir ve mesajla modele gider. Terminal yapıştırmazsa pano okunur: Windows/macOS yerel yardımcı, Linux `wl-paste`/`xclip`/`xsel` |
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
| `/mode <ask\|plan\|build>` | Modu değiştirir |
| `/model [kimlik]` | Modeli değiştirir (kimliksiz: sağlayıcının listesinden seç) |
| `/provider` | Sağlayıcı, anahtar ve modeli yeniden kurar |
| `/clear` | Yeni sohbet (hafıza sıfırlanır, boş ekrana döner) |
| `/resume` | Bu klasördeki kayıtlı bir oturumu sürdürür |
| `/compact` | Konuşmayı modele özetletir; sonraki istekler özetle sürer (bağlam %80'e gelince kendiliğinden) |
| `/context` | Bağlam doluluğu (durum satırında da %50'den sonra görünür) |
| `/undo` | Son yanıtın yazdığı dosyaları eski haline döndürür |
| `/approve` | Komut onaylarını bu oturumda açar ya da kapatır |
| `/config` | Etkin ayarları gösterir |
| `/permissions` | İzin kuralları |
| `/hooks` | Tanımlı hook'lar |
| `/logout` | Bu sağlayıcının kayıtlı anahtarını siler |
| `/help` | Komutlar ve kısayollar |
| `/exit` | Çıkar (Ctrl+D da olur) |

Eski Türkçe adlar (`/yeni`, `/geri-al`, `/saglayici`…) da çalışır.

## Alt ajanlar

Ajan geniş araştırmaları (birçok dosyayı taramak, bir özelliğin nerede yapıldığını bulmak) `task` aracıyla alt
ajana verir. Alt ajan kendi bağlamında, yalnız okuma araçlarıyla çalışır ve sonunda rapor döndürür; ana konuşmanın
bağlamı dolmaz. Adımları ekranda `● Alt ajan(görev)` altında görünür; izin kuralları ve hook'lar alt ajana da uygulanır.

## İzin kuralları

`cli.json` → `permissions` (Claude Code biçimi). `deny` önce bakılır: uyan araç hiç çalışmaz, gerekçe modele
gider. `allow`'a uyan araç onay sormadan çalışır. İkisine de uymayan her zamanki gibi sorulur.

```json
"permissions": {
  "allow": ["Bash(npm test:*)", "Bash(git status:*)", "web_fetch(https://docs.*)"],
  "deny": ["Bash(rm -rf:*)", "write_file(.env*)"]
}
```

Kalıplarda `*` ve `?` kullanılır; Claude Code adları (`Bash`, `Write`, `Edit`, `Read`, `WebFetch`, `WebSearch`) da geçer.

## Hook'lar

`cli.json` → `hooks`: belirli anlarda senin komutun çalışır. Yalnız kendi ayar dosyandan okunur; proje dosyaları
hook tanımlayamaz.

```json
"hooks": {
  "PostToolUse": [{ "matcher": "write_file|replace_in_file", "command": "npx prettier --write \"$TULVEZ_FILE\"" }],
  "PreToolUse": [{ "matcher": "run_command", "command": "node guard.js" }],
  "UserPromptSubmit": [{ "command": "git status --short" }],
  "Stop": [{ "command": "notify-send 'Tulvez Code bitti'" }]
}
```

Komut stdin'den JSON alır (`hook_event_name`, `tool_name`, `tool_input`, `tool_response`, `prompt`, `cwd`,
`session_id`); ortamda `TULVEZ_HOOK_EVENT`, `TULVEZ_TOOL`, `TULVEZ_FILE` vardır. **Çıkış 2**: PreToolUse aracı,
UserPromptSubmit isteği engeller (stderr gerekçe olur); PostToolUse'da stderr modele gider. UserPromptSubmit'in
stdout'u isteğe bağlam olarak eklenir. Her hook en çok 60 sn (`"timeout"` ile değişir).

## Web araması

Ajan güncel bilgi, hata iletisi ya da belge gerekince `web_search` ile arar, sonucu `web_fetch` ile açar (adres
indirme onay ister). Kaynak: `BRAVE_API_KEY` varsa Brave Search, `TAVILY_API_KEY` varsa Tavily, ikisi de yoksa
anahtarsız **Tulvez Arama** (tulvez.com). `cli.json` → `"webSearch": "off"` aramayı kapatır; `brave`, `tavily`,
`tulvez` kaynağı sabitler.

## Oturum kaydı

Her tamamlanan yanıttan sonra oturum ayar klasörüne (`sessions/`, dosya izni 600) kaydedilir; en çok 50 oturum
tutulur. `tulvez -c` bu klasördeki son oturumu, `tulvez -r` ya da `/resume` listeden seçileni açar: önceki konuşma
ekrana gelir ve model araç sonuçları dahil hatırlar. Kayıt okunan dosyaların içeriğini ve komut çıktılarını
barındırabilir.

## Güvenlik

- Araçlar yalnız çalışma klasöründe (bulunulan klasör ya da `-C <klasör>`) okur ve yazar.
- Her terminal komutu ve web indirmesi çalışmadan önce onay ister. `-y` onayları sormadan verir; yalnız
  güvendiğin işlerde kullan.
- Girdi bir terminal değilse (boru hattı, CI) onay sorulamaz ve komut reddedilir; gerekiyorsa `-y` ver.
- Projedeki `.mcp.json` sunucuları kod çalıştırabileceği için onay verilmeden başlamaz.
- `/undo` yalnız Tulvez Code'un yazdığı dosyaları geri alır; terminal komutlarının yaptığı değişiklikleri değil.

## Sağlayıcı ve API anahtarı

Kurulum ekranında yapıştırdığın anahtarı **kaydedebilirsin** (Windows, macOS ve Linux'ta aynı):
`~/.config/tulvez/anahtarlar.json` (Windows: `%APPDATA%\tulvez\anahtarlar.json`). Dosya yalnız senin okuyabileceğin
izinle (600) yazılır; `cli.json`'a hiçbir zaman anahtar yazılmaz. `/logout` kaydı siler.

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

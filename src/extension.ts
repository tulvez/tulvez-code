import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

// 3. parti SDK'ların Node deprecation uyarılarını susturur (VS Code terminalinde görünür gürültü)
process.noDeprecation = true;
import type { HostToWebviewMessage, NavigateTarget, TulvezSettings, WebviewToHostMessage } from './services/messages';
import { chatFileName } from './services/chatExport';
import { devLog, initDevLog, step } from './services/devLog';
import { fetchRegistry, installedSkills, installSkill, registryBase, removeSkill, type RegistrySkill } from './services/skillsRegistry';
import { runAgent, invalidateRepoMap } from './services/agent';
import { getConversation, saveConversation } from './services/conversation';
import { beginCheckpoint, endCheckpoint, undoCheckpoint } from './services/checkpoint';
import { mentionContext } from './services/mentions';
import { aiEditHooks, aiLineCountForActiveEditor, forgetAiEdits, refreshAiDecorations, getDiffContentProvider, openDiffForFile } from './services/tools';
import { createSkillsTemplate, matchSkill, parseSkills, skillsFileExists, skillsFileUri } from './services/skills';
import { listProviderModels } from './services/models';
import { isBotIdentity, readIdentity, removeBotIdentity, repoRoot, withCoAuthor } from './services/gitIdentity';
import { activateCoAuthorScm, noteAiEdit } from './services/coAuthorScm';
import { exportLocalSkill, githubOwner, importLocalSkills, localSkills, removeLocalSkill, setSkillsRoot, syncOrgSkills, type SyncResult } from './services/orgSkills';

const SKILLS_DISABLED_KEY = 'tulvez.skills.disabled';
const SKILLS_SYNCED_KEY = 'tulvez.skills.syncedAt';
const SKILLS_SYNC_EVERY_MS = 12 * 60 * 60 * 1000;

export function activate(context: vscode.ExtensionContext): void {
  initDevLog(context);
  devLog('activate başladı');
  const skillsRoot = vscode.Uri.joinPath(context.globalStorageUri, 'skills').fsPath;
  setSkillsRoot(skillsRoot);

  // GitHub becerileri: aynı anda tek eşitleme; açılışta 12 saatte bir, Ayarlar açılınca her zaman.
  let skillSync: Promise<SyncResult> | null = null;
  const syncSkills = (owner: string): Promise<SyncResult> => {
    skillSync ??= syncOrgSkills(owner, skillsRoot, context.globalState.get<string[]>(SKILLS_DISABLED_KEY, []))
      .then(async (r) => {
        await context.globalState.update(SKILLS_SYNCED_KEY, Date.now());
        if (r.updated.length) devLog('✓ beceriler güncellendi', r.updated.join(', '));
        if (r.errors.length) devLog('✗ beceri', r.errors.join(' | '));
        return r;
      })
      .finally(() => { skillSync = null; });
    return skillSync;
  };
  const createWebview = (webview: vscode.Webview, host: 'sidebar' | 'panel' = 'panel'): void => {
    devLog('webview hazırlanıyor', host);
    try {
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'resources'),
        ],
      };
      webview.html = getWebviewHtml(webview, context.extensionUri, host);
    } catch (err) {
      console.error('[Tulvez] Webview hazırlanamadı:', err);
    }
  };

  const getLogoUri = (webview: vscode.Webview): string =>
    webview
      .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'tulvez-logo.svg'))
      .with({ query: '' })
      .toString(false);

  const runShellCommand = (command: string): Promise<{ output: string; exitCode: number }> =>
    new Promise((resolve) => {
      cp.exec(command, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }, (err, stdout, stderr) => {
        resolve({
          output: (stdout + stderr).trim() || (err?.message ?? ''),
          exitCode: err?.code ?? 0,
        });
      });
    });

  const secretKeyFor = (provider: string): string => `tulvez.apiKey.${provider}`;

  const readApiKey = async (provider: string): Promise<string> => {
    const specific = await context.secrets.get(secretKeyFor(provider));
    if (specific) return specific;
    return (await context.secrets.get('tulvez.apiKey')) ?? '';
  };

  const readSettings = async (): Promise<TulvezSettings> => {
    const cfg = vscode.workspace.getConfiguration('tulvez');
    const provider = cfg.get<string>('aiProvider') ?? 'openai';
    return {
      aiProvider: provider as TulvezSettings['aiProvider'],
      model: cfg.get('model') ?? '',
      apiKey: await readApiKey(provider),
      ollamaUrl: cfg.get('ollamaUrl') ?? 'http://localhost:11434',
      baseUrl: cfg.get('baseUrl') ?? 'https://opencode.ai/zen/v1',
      autoApproveCommands: cfg.get('autoApproveCommands') ?? false,
      allowShellCommands: cfg.get('allowShellCommands') ?? false,
      telemetry: cfg.get('telemetry') ?? false,
      sendCodeContext: cfg.get('sendCodeContext') ?? false,
      showAiEdits: cfg.get('showAiEdits') ?? true,
      showModels: cfg.get('showModels') ?? false,
      showThinking: cfg.get('showThinking') ?? true,
      gitCoAuthor: cfg.get('gitCoAuthor') ?? true,
    };
  };

  const saveSettings = async (settings: TulvezSettings): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration('tulvez');
    await cfg.update('aiProvider', settings.aiProvider, vscode.ConfigurationTarget.Global);
    await cfg.update('model', settings.model, vscode.ConfigurationTarget.Global);
    await cfg.update('ollamaUrl', settings.ollamaUrl, vscode.ConfigurationTarget.Global);
    await cfg.update('baseUrl', settings.baseUrl, vscode.ConfigurationTarget.Global);
    await cfg.update('autoApproveCommands', settings.autoApproveCommands, vscode.ConfigurationTarget.Global);
    await cfg.update('allowShellCommands', settings.allowShellCommands, vscode.ConfigurationTarget.Global);
    await cfg.update('telemetry', settings.telemetry, vscode.ConfigurationTarget.Global);
    await cfg.update('sendCodeContext', settings.sendCodeContext, vscode.ConfigurationTarget.Global);
    await cfg.update('showAiEdits', settings.showAiEdits ?? true, vscode.ConfigurationTarget.Global);
    await cfg.update('showModels', settings.showModels ?? false, vscode.ConfigurationTarget.Global);
    await cfg.update('showThinking', settings.showThinking ?? true, vscode.ConfigurationTarget.Global);
    await cfg.update('gitCoAuthor', settings.gitCoAuthor ?? true, vscode.ConfigurationTarget.Global);
    if (settings.apiKey) {
      await context.secrets.store(secretKeyFor(settings.aiProvider), settings.apiKey);
    } else {
      await context.secrets.delete(secretKeyFor(settings.aiProvider));
    }
  };

  const pendingToolApprovals = new Map<string, (approved: boolean) => void>();

  let activeAbort: AbortController | null = null;
  let lastEditedFile: string | null = null;
  // Geri alma sonrası bir sonraki isteğe eklenen not (ajan hafızasındaki dosya halleri artık geçersiz)
  let undoNote = '';

  const runAgentFor = async (
    webview: vscode.Webview,
    settings: TulvezSettings,
    prompt: string,
    mode: 'ask' | 'plan' | 'build',
    history: { role: 'user' | 'assistant'; text: string }[],
    session?: { sessionId?: string; turns?: number },
  ): Promise<void> => {
    // Sohbet hafızası: tur sayısı tutuyorsa önceki turların araç sonuçları da modele gider
    const turns = session?.turns ?? 0;
    const memory = session?.sessionId ? {
      prior: getConversation(session.sessionId, turns),
      onConversation: (msgs: import('ai').ModelMessage[]) => saveConversation(session.sessionId, turns + 1, msgs),
    } : undefined;
    activeAbort?.abort();
    activeAbort = new AbortController();
    // Bu yanıtta yazılan dosyalar için geri alma noktası; yanıt nasıl biterse bitsin arayüze bildirilir
    const runId = `run-${Date.now()}`;
    beginCheckpoint(runId);
    const reportCheckpoint = (): void => {
      void endCheckpoint().then((cp) => {
        if (cp) void webview.postMessage({ type: 'checkpoint', id: cp.id, files: cp.files.map((f) => vscode.workspace.asRelativePath(f)) } satisfies HostToWebviewMessage);
      });
    };
    if (undoNote) {
      prompt = `${undoNote}\n\n${prompt}`;
      undoNote = '';
    }
    const signal = activeAbort.signal;
    // Durdur: bekleyen izin kartı "reddedildi" sayılır, yoksa ajan kartın cevabını sonsuza dek bekler
    signal.addEventListener('abort', () => {
      for (const resolve of pendingToolApprovals.values()) resolve(false);
      pendingToolApprovals.clear();
    }, { once: true });
    await runAgent(settings, prompt, mode, history, {
      onChunk: (chunk) => {
        void webview.postMessage({ type: 'assistantChunk', text: chunk } satisfies HostToWebviewMessage);
      },
      onReasoning: (chunk) => void webview.postMessage({ type: 'assistantReasoning', text: chunk } satisfies HostToWebviewMessage),
      onToolCall: (tool, summary, id) => {
        lastEditedFile = tool === 'write_file' || tool === 'replace_in_file' ? summary : lastEditedFile;
        void webview.postMessage({ type: 'toolCall', tool, summary, id } satisfies HostToWebviewMessage);
      },
      onToolResult: (r) => void webview.postMessage({
        type: 'toolResult', id: r.callId, tool: r.tool, output: r.output, status: r.status, exitCode: r.exitCode,
      } satisfies HostToWebviewMessage),
      onToolRequest: (id, tool, args) =>
        new Promise<boolean>((resolve) => {
          // "Her zaman izin ver" bu çalışmanın ortasında seçildiyse sıradaki istekler de sorulmaz
          if (vscode.workspace.getConfiguration('tulvez').get<boolean>('autoApproveCommands', false)) {
            resolve(true);
            return;
          }
          pendingToolApprovals.set(id, resolve);
          void webview.postMessage({ type: 'toolRequest', id, tool, args } satisfies HostToWebviewMessage);
        }),
      onDone: (usage) => {
        activeAbort = null;
        reportCheckpoint();
        if (lastEditedFile) {
          const target = lastEditedFile;
          lastEditedFile = null;
          setTimeout(() => {
            void openDiffForFile(
              path.isAbsolute(target)
                ? target
                : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', target),
            );
          }, 250);
        }
        void webview.postMessage({ type: 'assistantDone', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd, contextWindow: usage.contextWindow, model: usage.model } satisfies HostToWebviewMessage);
      },
      onCancelled: () => {
        activeAbort = null;
        reportCheckpoint();
        void webview.postMessage({ type: 'cancelled' } satisfies HostToWebviewMessage);
      },
      onError: (err) => {
        activeAbort = null;
        reportCheckpoint();
        void webview.postMessage({ type: 'error', message: friendlyError(err) } satisfies HostToWebviewMessage);
        const lower = err.toLowerCase();
        if (lower.includes('429') || lower.includes('quota') || lower.includes('503')) {
          const retry = /retry in (\d+)h(\d+)m/.exec(err);
          let retryAt: number | undefined;
          if (retry) {
            retryAt = Date.now() + (parseInt(retry[1], 10) * 3600 + parseInt(retry[2], 10) * 60) * 1000;
          }
          const modelMatch = /models\/([\w.-]+):/.exec(err) ?? /model: ([\w.-]+)/.exec(err);
          void webview.postMessage({
            type: 'quotaInfo',
            model: modelMatch?.[1] ?? settings.model ?? '',
            retryAt,
            limited: true,
          } satisfies HostToWebviewMessage);
        }
      },
    }, signal, memory);
  };

  const handleMessage = async (
    webview: vscode.Webview,
    message: WebviewToHostMessage,
  ): Promise<void> => {
    if (message.type === 'findFiles') {
      // @ menüsü: adında yazılan metin geçen dosyalar (gizli klasörler ve bağımlılıklar hariç)
      const q = message.query.replace(/[\\[\]{}*?!]/g, '');
      const exclude = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/target/**,**/.venv/**,**/__pycache__/**}';
      let files: string[] = [];
      try {
        const uris = await vscode.workspace.findFiles(q ? `**/*${q}*` : '**/*', exclude, 400);
        const lower = q.toLowerCase();
        files = uris.map((u) => vscode.workspace.asRelativePath(u, false))
          .sort((a, b) => {
            const an = path.basename(a).toLowerCase().startsWith(lower) ? 0 : 1;
            const bn = path.basename(b).toLowerCase().startsWith(lower) ? 0 : 1;
            return an - bn || a.length - b.length || a.localeCompare(b);
          })
          .slice(0, 30);
      } catch { /* klasör açık değil */ }
      await webview.postMessage({ type: 'fileMatches', query: message.query, files } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'undoCheckpoint') {
      try {
        const r = await undoCheckpoint(message.id, async (changed) => {
          const names = changed.map((f) => vscode.workspace.asRelativePath(f)).join(', ');
          const ok = await vscode.window.showWarningMessage(
            `Tulvez Code: şu dosyalar yanıttan sonra değişmiş: ${names}. Geri alınca bu değişiklikler de kaybolur.`,
            { modal: true }, 'Yine de geri al',
          );
          return ok === 'Yine de geri al';
        });
        for (const f of r.restored) forgetAiEdits(f);
        if (r.restored.length) {
          undoNote = `(Not: kullanıcı önceki yanıtındaki dosya değişikliklerini geri aldı; şu dosyalar o yanıttan önceki haline döndü: ${r.restored.map((f) => vscode.workspace.asRelativePath(f)).join(', ')}. Bu dosyaları yeniden okumadan içerikleri hakkında varsayımda bulunma.)`;
        }
        await webview.postMessage({ type: 'checkpointUndone', id: message.id, restored: r.restored.length, cancelled: r.cancelled } satisfies HostToWebviewMessage);
      } catch (err) {
        await webview.postMessage({ type: 'checkpointUndone', id: message.id, restored: 0, cancelled: false, error: err instanceof Error ? err.message : String(err) } satisfies HostToWebviewMessage);
      }
      return;
    }

    if (message.type === 'importSkill' || message.type === 'exportSkill') {
      // Bilgisayardan beceri yükle / kurulu beceriyi bilgisayara indir; sonra güncel liste gider.
      try {
        if (message.type === 'importSkill') {
          // Windows ve Linux'ta tek pencere hem dosya hem klasör seçtiremez (ikisi istenirse yalnız klasör açılır)
          const kind = await vscode.window.showQuickPick([
            { label: '$(file) .md dosyaları', description: 'Her dosya bir beceri; adı dosya adından gelir', files: true },
            { label: '$(folder) Klasörler', description: 'Betik ve belgeleriyle beceri ya da beceri koleksiyonu', files: false },
          ], { title: 'Beceri yükle', placeHolder: 'Ne yükleyeceksin? (birden çok seçebilirsin)' });
          const picked = kind && await vscode.window.showOpenDialog({
            title: kind.files ? 'Beceri yükle: .md dosyaları' : 'Beceri yükle: klasörler',
            openLabel: 'Yükle',
            canSelectFiles: kind.files,
            canSelectFolders: !kind.files,
            canSelectMany: true,
            filters: kind.files ? { 'Beceri (.md)': ['md'] } : undefined,
          });
          if (picked?.length) {
            const { imported, errors } = importLocalSkills(picked.map((u) => u.fsPath), skillsRoot);
            const ids = new Set(imported.map((s) => s.id));
            const disabled = context.globalState.get<string[]>(SKILLS_DISABLED_KEY, []).filter((d) => !ids.has(d));
            await context.globalState.update(SKILLS_DISABLED_KEY, disabled);
            if (imported.length) {
              void vscode.window.showInformationMessage(`Tulvez Code: ${imported.length} beceri yüklendi — ${[...ids].join(', ')}`);
            }
            if (errors.length) void vscode.window.showWarningMessage(`Tulvez Code: ${errors.length} öğe yüklenemedi — ${errors.join(' · ')}`);
          }
        } else {
          const picked = await vscode.window.showOpenDialog({
            title: `"${message.id}" becerisini kaydet: bir klasör seç`,
            openLabel: 'Buraya kaydet',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
          });
          if (picked?.[0]) {
            const dest = exportLocalSkill(skillsRoot, message.id, picked[0].fsPath);
            const open = await vscode.window.showInformationMessage(`Tulvez Code: beceri kaydedildi — ${dest}`, 'Klasörü aç');
            if (open) void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dest));
          }
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Tulvez Code: ${err instanceof Error ? err.message : String(err)}`);
      }
      await handleMessage(webview, { type: 'getSkillsRegistry' });
      return;
    }

    if (message.type === 'getSkillsRegistry' || message.type === 'installSkill' || message.type === 'removeSkill') {
      const source = registryBase();
      const owner = githubOwner(source);
      if (owner) {
        // GitHub hesabı: SKILL.md taşıyan her depo bir beceri, kendiliğinden kurulur.
        // Kaldırılan kapatılır (bir sonraki eşitlemede geri gelmez); Kur yeniden açar.
        const disabled = new Set(context.globalState.get<string[]>(SKILLS_DISABLED_KEY, []));
        if (message.type === 'removeSkill') {
          // Yalnız GitHub'dan gelen kapatılır (yoksa bir sonraki eşitlemede geri iner); yüklenen sadece silinir.
          const fromGithub = localSkills(skillsRoot).find((s) => s.id === message.id)?.source !== 'local';
          if (fromGithub) disabled.add(message.id);
          removeLocalSkill(skillsRoot, message.id);
        }
        if (message.type === 'installSkill') disabled.delete(message.id);
        await context.globalState.update(SKILLS_DISABLED_KEY, [...disabled]);
        let error: string | undefined;
        let catalog: SyncResult['catalog'] = [];
        try {
          const r = await syncSkills(owner);
          catalog = r.catalog;
          if (r.errors.length) error = r.errors[0];
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        const installed = localSkills(skillsRoot).filter((s) => !disabled.has(s.id));
        await webview.postMessage({
          type: 'skillsRegistry',
          source,
          // Ayarlarda açıklamanın ilk cümlesi yeter; tamamı istemde.
          skills: catalog.map(({ id, name, description, repo }) => ({ id, name, description: description.split(/(?<=\.)\s/)[0], tags: [repo], version: undefined })),
          installed: installed.map((s) => ({ id: s.id, name: s.name, source: s.source, description: s.description.split(/(?<=\.)\s/)[0] })),
          error,
        } satisfies HostToWebviewMessage);
        return;
      }
      // index.json deposu: liste, kur, kaldır. Her işlemden sonra güncel durum webview'a gider.
      const installedList = () => installedSkills().map((s) => ({ id: s.id, name: s.name }));
      let error: string | undefined;
      let catalog: RegistrySkill[] = [];
      try {
        catalog = await fetchRegistry(source);
        if (message.type === 'installSkill') {
          const entry = catalog.find((s) => s.id === message.id);
          if (!entry) throw new Error('Skill depoda bulunamadı');
          await installSkill(entry, source);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      if (message.type === 'removeSkill') removeSkill(message.id);
      await webview.postMessage({
        type: 'skillsRegistry',
        source,
        skills: catalog.map(({ id, name, description, tags, version }) => ({ id, name, description, tags, version })),
        installed: installedList(),
        error,
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'exportChat') {
      // Sohbet, adıyla birlikte Markdown dosyasına yazılır ve VS Code'da açılır.
      // Klasör açıksa <klasör>/.tulvez/sohbetler/ (git'e girmez), değilse eklentinin kendi alanı.
      if (!message.markdown.trim()) {
        void vscode.window.showInformationMessage('Tulvez Code: Kaydedilecek bir sohbet yok.');
        return;
      }
      try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const dir = folder
          ? vscode.Uri.joinPath(folder, '.tulvez', 'sohbetler')
          : vscode.Uri.joinPath(context.globalStorageUri, 'sohbetler');
        await vscode.workspace.fs.createDirectory(dir);
        if (folder) {
          const ignore = vscode.Uri.joinPath(dir, '.gitignore');
          try {
            await vscode.workspace.fs.stat(ignore);
          } catch {
            await vscode.workspace.fs.writeFile(ignore, Buffer.from('# Tulvez Code sohbet kayıtları — depoya girmez\n*\n', 'utf8'));
          }
        }
        const file = vscode.Uri.joinPath(dir, chatFileName(message.title, new Date()));
        await vscode.workspace.fs.writeFile(file, Buffer.from(message.markdown, 'utf8'));
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc, { preview: false });
        await webview.postMessage({
          type: 'systemNotice',
          text: `Sohbet kaydedildi: ${folder ? vscode.workspace.asRelativePath(file) : file.fsPath}`,
        } satisfies HostToWebviewMessage);
      } catch (err) {
        void vscode.window.showErrorMessage(`Tulvez Code: Sohbet kaydedilemedi — ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (message.type === 'cancelStream') {
      if (activeAbort) {
        activeAbort.abort(); // runAgent → onCancelled → 'cancelled'
        activeAbort = null;
      } else {
        // Çalışan istek yoksa da arayüz "bekliyor" durumunda kalmasın
        void webview.postMessage({ type: 'cancelled' } satisfies HostToWebviewMessage);
      }
      return;
    }

    if (message.type === 'toolApproval') {
      if (message.always) {
        // "Her zaman izin ver": bundan sonraki bütün araç izinleri sorulmadan verilir (Ayarlar → İzinler'den geri alınır)
        const cfg = vscode.workspace.getConfiguration('tulvez');
        await cfg.update('autoApproveCommands', true, vscode.ConfigurationTarget.Global);
        await cfg.update('allowShellCommands', true, vscode.ConfigurationTarget.Global);
      }
      const resolve = pendingToolApprovals.get(message.id);
      if (resolve) {
        resolve(message.approved);
        pendingToolApprovals.delete(message.id);
      }
      return;
    }

    if (message.type === 'openVsSettings') {
      // Codex'teki gibi: tüm ayarlar VS Code'un kendi ayar ekranında, eklentiye süzülmüş
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:tulvez.tulvez-code');
      return;
    }

    if (message.type === 'clientLog') {
      devLog(`webview ${message.level}`, message.text.slice(0, 2000));
      return;
    }

    if (message.type === 'ready') {
      devLog('webview hazır (ready)');
      const workspaceName = vscode.workspace.name ?? 'Çalışma alanı yok';
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      await webview.postMessage({
        type: 'initialized',
        workspaceName,
        workspacePath,
        logoUri: getLogoUri(webview),
      } satisfies HostToWebviewMessage);
      const settings = await readSettings();
      await webview.postMessage({ type: 'settingsData', settings } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'openSkillsFile') {
      if (!skillsFileExists()) createSkillsTemplate();
      const uri = skillsFileUri();
      if (uri) await vscode.window.showTextDocument(uri);
      return;
    }

    if (message.type === 'getSkills') {
      const uri = skillsFileUri();
      await webview.postMessage({
        type: 'skillsStatus',
        exists: skillsFileExists(),
        path: uri?.fsPath ?? '',
        skills: parseSkills().map((s) => s.name),
        items: parseSkills().map((s) => ({ name: s.name, description: s.description })),
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'openFolder') {
      void vscode.commands.executeCommand('vscode.openFolder');
      return;
    }

    if (message.type === 'expandSidebar') {
      vscode.window.showInformationMessage('Sidebar kenarını sürükleyerek genişletin.');
      return;
    }

    if (message.type === 'listModels') {
      const settings = await readSettings();
      try {
        const models = await listProviderModels(settings);
        await webview.postMessage({ type: 'modelsList', models } satisfies HostToWebviewMessage);
      } catch (err) {
        await webview.postMessage({ type: 'modelsList', models: [], error: err instanceof Error ? err.message : String(err) } satisfies HostToWebviewMessage);
      }
      return;
    }

    if (message.type === 'getSettings') {
      const settings = await readSettings();
      await webview.postMessage({ type: 'settingsData', settings } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'switchProvider') {
      const cfg = vscode.workspace.getConfiguration('tulvez');
      await cfg.update('aiProvider', message.provider, vscode.ConfigurationTarget.Global);
      await cfg.update('model', '', vscode.ConfigurationTarget.Global);
      await webview.postMessage({ type: 'settingsData', settings: await readSettings() } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'saveSettings') {
      await saveSettings(message.settings);
      await webview.postMessage({ type: 'settingsData', settings: await readSettings() } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'createWorkspace') {
      const name = message.name.trim();
      if (!name) return;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const parentUri = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(require('os').homedir());
      const newUri = vscode.Uri.joinPath(parentUri, name);
      await vscode.workspace.fs.createDirectory(newUri);
      await vscode.commands.executeCommand('vscode.openFolder', newUri, { forceNewWindow: false });
      return;
    }

    if (message.type === 'runCommand') {
      const result = await runShellCommand(message.command);
      await webview.postMessage({
        type: 'commandResult',
        output: result.output,
        exitCode: result.exitCode,
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'slash') {
      const settings = await readSettings();
      const mode = message.mode;
      const editor = vscode.window.activeTextEditor;

      const git = async (args: string): Promise<string> => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return new Promise((resolve) => {
          cp.exec(`git ${args}`, { cwd }, (err, stdout, stderr) => {
            resolve((stdout || stderr).trim() || (err?.message ?? ''));
          });
        });
      };

      let prompt = '';
      if (message.name === 'commit') {
        // Commit'i ajan kendisi atar: git komutları her zamanki gibi izin ister.
        const status = await git('status --short');
        if (!status) {
          await webview.postMessage({ type: 'error', message: "Commit'lenecek değişiklik yok." } satisfies HostToWebviewMessage);
          return;
        }
        if (!settings.allowShellCommands) {
          await webview.postMessage({ type: 'error', message: "Commit için terminal izni gerekli: Ayarlar → İzinler → Onaylı ya da Tam erişim." } satisfies HostToWebviewMessage);
          return;
        }
        let diff = await git('diff --cached');
        const staged = !!diff;
        if (!diff) diff = await git('diff');
        prompt = [
          "Çalışma alanındaki değişiklikleri commit'le.",
          staged
            ? "- Staged değişiklikler var: yalnız onları commit'le, başka dosya ekleme."
            : "- Hiçbir şey staged değil: ilgili dosyaları `git add` ile ekle.",
          "- Mesaj Türkçe, conventional commit biçiminde, kısa ve ne değiştiğini anlatan tek satır olsun.",
          '- `git commit -m "…"` komutunu run_command aracıyla kendin çalıştır. Push yapma.',
          '- Bitince commit\'i bir cümleyle özetle.',
          '',
          `git status:\n${status}`,
          '',
          `git diff${staged ? ' --cached' : ''}:\n${diff.slice(0, 12000)}`,
        ].join('\n');
        await runAgentFor(webview, settings, prompt, 'build', [], message);
        return;
      } else if (message.name === 'review') {
        let diff = await git('diff --cached');
        if (!diff) diff = await git('diff');
        prompt = diff
          ? `Aşağıdaki git diff'ini kod incelemesi açısından değerlendir. Türkçe, maddeler halinde; hata, risk, güvenlik ve iyileştirme fırsatlarını yaz:\n\n${diff.slice(0, 12000)}`
          : 'Çalışma alanında değişiklik yok. Lütfen önce değişiklik yapın.';
      } else if (message.name === 'diff') {
        const hasChanges = await safeCommand<boolean>('git.hasChanges').then((v) => !!v);
        if (hasChanges) {
          const opened = await safeCommand('git.openChange', 'working').then(() => true).catch(() => false);
          if (opened) {
            await webview.postMessage({
              type: 'systemNotice',
              text: 'Çalışma alanı değişiklikleri editörde açıldı.',
            } satisfies HostToWebviewMessage);
            return;
          }
        }
        const stat = (await git('diff --stat')) || (await git('status --short')) || 'Değişiklik yok.';
        prompt = `Şu git değişikliklerini özetle ve yorumla (Türkçe, kısa):\n\n${stat.slice(0, 6000)}`;
      } else if (message.name === 'explain') {
        const sel = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
        if (!sel) {
          await webview.postMessage({ type: 'error', message: 'Editörde seçili kod yok. Önce kod seçin.' } satisfies HostToWebviewMessage);
          return;
        }
        prompt = `Aşağıdaki kodu Türkçe olarak açıkla; ne yaptığını, önemli noktaları ve olası sorunları yaz:\n\n\`\`\`\n${sel.slice(0, 8000)}\n\`\`\``;
      } else if (message.name === 'skill') {
        const skills = parseSkills();
        if (skills.length === 0) {
          await webview.postMessage({ type: 'error', message: 'Kurulu beceri yok. Ayarlar > Skills\'ten GitHub becerilerini yükleyebilir ya da code_skills.md oluşturabilirsin.' } satisfies HostToWebviewMessage);
          return;
        }
        const hit = matchSkill(skills, message.arg ?? '');
        if (!hit) {
          await webview.postMessage({ type: 'error', message: `"${message.arg}" adlı beceri yok. Kurulu olanlar: ${skills.map((s) => s.name).join(', ')}` } satisfies HostToWebviewMessage);
          return;
        }
        prompt = `${hit.skill.text}\n\n(Bu talimat "${hit.skill.name}" becerisinden geldi.)`;
        if (hit.request) prompt += `\n\nKullanıcının isteği: ${hit.request}`;
      }

      await runAgentFor(webview, settings, prompt, mode, [], message);
      return;
    }

    if (message.type === 'sendMessage') {
      const text = message.text.trim();
      if (!text) return;

      const settings = await readSettings();
      let userText = text;

      if (settings.sendCodeContext) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const selection = !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
          if (selection) {
            userText = `${text}\n\nSeçili kod (${editor.document.fileName}):\n\`\`\`\n${selection.slice(0, 4000)}\n\`\`\``;
          }
        }
      }

      const mentioned = await mentionContext(text, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
      if (mentioned) userText = `${userText}\n\n${mentioned}`;

      const effective = { ...settings, model: message.model?.trim() ? message.model : settings.model };
      await runAgentFor(webview, effective, userText, message.mode, message.history ?? [], message);
    }
  };

  const sidebarProvider = new TulvezSidebarProvider(context, createWebview, handleMessage);
  context.subscriptions.push(
    // Panel gizlenince webview kapanmasın: ajan çalışırken başka görünüme geçilirse
    // (ör. git oturum açma penceresi) komut sonucu ve yanıt kayboluyor, adım "Yarıda kaldı" görünüyordu
    vscode.window.registerWebviewViewProvider('tulvez.sidebar', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Kenar çubuğu başlığındaki düğmeler (yeni sohbet, geçmiş, ayarlar) webview'a yönlendirilir;
  // böylece panelde ikinci bir "Tulvez Code" başlığına gerek kalmaz.
  const navigate = (to: NavigateTarget) => () => sidebarProvider.navigate(to);
  context.subscriptions.push(
    vscode.commands.registerCommand('tulvez.newChat', navigate('newChat')),
    vscode.commands.registerCommand('tulvez.exportChat', navigate('export')),
    vscode.commands.registerCommand('tulvez.showHistory', navigate('history')),
    vscode.commands.registerCommand('tulvez.openSettings', navigate('settings')),
  );

  const openPanel = () => {
    const panel = vscode.window.createWebviewPanel(
      'tulvezPanel', 'Tulvez Code', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true },
    );
    createWebview(panel.webview);
    panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => void handleMessage(panel.webview, msg),
      undefined, context.subscriptions,
    );
  };

  context.subscriptions.push(vscode.commands.registerCommand('tulvez.openPanel', openPanel));

  const aiStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  aiStatus.command = 'tulvez.openPanel';
  const updateAiStatus = (): void => {
    const count = aiLineCountForActiveEditor();
    if (count === null) {
      aiStatus.hide();
      return;
    }
    aiStatus.text = `$(sparkle) ${count} satır AI`;
    aiStatus.tooltip = 'Tulvez Code tarafından yazıldı olarak işaretlenen satırlar';
    aiStatus.show();
  };
  context.subscriptions.push(aiStatus);
    vscode.workspace.registerTextDocumentContentProvider('tulvez-before', getDiffContentProvider());
  aiEditHooks.onEdit = (filePath) => {
    invalidateRepoMap();
    updateAiStatus();
    noteAiEdit(filePath);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => { refreshAiDecorations(); updateAiStatus(); }),
    vscode.window.onDidChangeVisibleTextEditors(() => { refreshAiDecorations(); updateAiStatus(); }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    step('geliştirme paneli', () => openPanel());
  }

  void migrateBotIdentity(context).then(() => devLog('✓ bot kimliği denetimi'), (e) => devLog('✗ bot kimliği denetimi', String(e)));
  void activateCoAuthorScm(context).then(() => devLog('✓ ek katkıcı (Kaynak Denetimi)'), (e) => devLog('✗ ek katkıcı', String(e)));
  const skillsOwner = githubOwner(registryBase());
  const lastSync = context.globalState.get<number>(SKILLS_SYNCED_KEY, 0);
  if (skillsOwner && (Date.now() - lastSync > SKILLS_SYNC_EVERY_MS || localSkills(skillsRoot).length === 0)) {
    void syncSkills(skillsOwner).catch((e) => devLog('✗ beceri eşitleme', String(e)));
  }
  devLog('activate bitti');
}

/**
 * 0.1.x sürümleri deponun .git/config dosyasına bot kimliğini yazıyordu; bu yüzden
 * o depodaki bütün commit'lerin yazarı bot oluyor, GitHub'da bot ana katkıcı gibi
 * görünüyordu. Artık Tulvez Code yalnızca ek katkıcı (Co-authored-by) olarak eklenir.
 * Eski ayar bulunursa depo başına bir kez sorulur; onaylanırsa yalnızca yerel ayar silinir.
 */
async function migrateBotIdentity(context: vscode.ExtensionContext): Promise<void> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const cwd = folder.uri.fsPath;
    const root = await repoRoot(cwd);
    if (!root) return;

    const local = await readIdentity(cwd, undefined, '--local');
    if (!isBotIdentity(local)) return;

    const key = `tulvez.botIdentityMigrated.${root}`;
    if (context.workspaceState.get<boolean>(key)) return;

    const global = await readIdentity(cwd, undefined, '--global');
    if (!global?.email) {
      void vscode.window.showWarningMessage(
        'Tulvez Code: Bu depoda commit\'lerin yazarı hâlâ Tulvez Code botu. Artık yazar sen olmalısın, ' +
          'Tulvez Code ek katkıcı olarak eklenir. Önce kendi git kimliğini ayarla: ' +
          'git config --global user.name "Adın" ve git config --global user.email "GitHub noreply adresin".',
      );
      return;
    }

    const remove = 'Kaldır, yazar ben olayım';
    const keep = 'Şimdilik kalsın';
    // Modal değil: açılışta pencereyi kilitleyen bir dialog açmaz, köşede bildirim olarak durur
    const choice = await vscode.window.showInformationMessage(
      'Tulvez Code artık commit\'lerin yazarı olmuyor; ek katkıcı olarak ekleniyor. Bu depodaki eski bot ' +
        `kimliği kaldırılsın mı? Sonraki commit'ler ${global.name || global.email} adıyla atılır.`,
      remove,
      keep,
    );
    if (choice === undefined) return;
    await context.workspaceState.update(key, true);
    if (choice !== remove) return;

    await removeBotIdentity(root);
    void vscode.window.showInformationMessage('Tulvez Code: Bot kimliği kaldırıldı. Commit\'lerin yazarı artık sensin.');
  } catch (err) {
    console.warn('[Tulvez] Eski bot kimliği denetlenemedi:', err);
  }
}

export function deactivate(): void {
  devLog('deactivate (eklenti kapanıyor)');
}

class TulvezSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly createWebview: (webview: vscode.Webview, host: 'sidebar' | 'panel') => void,
    private readonly handleMessage: (webview: vscode.Webview, message: WebviewToHostMessage) => Promise<void>,
  ) {}

  // Webview gizlenip yeniden görünür olunca VS Code onu baştan kurar; uygulama
  // "ready" demeden gönderilen komut kaybolurdu (ayarlar "bazen açılmıyor" sorunu).
  // Komut, webview hazır olana kadar bekletilir.
  private ready = false;
  private pending: NavigateTarget | null = null;

  navigate(to: NavigateTarget): void {
    this.pending = to;
    if (!this.view) {
      // görünüm hiç açılmadıysa aç; resolveWebviewView + ready sonrası uygulanır
      void vscode.commands.executeCommand('tulvez.sidebar.focus');
      return;
    }
    this.view.show?.(true);
    if (this.ready) this.flush();
  }

  private flush(): void {
    if (!this.view || !this.pending) return;
    const to = this.pending;
    this.pending = null;
    void this.view.webview.postMessage({ type: 'navigate', to } satisfies HostToWebviewMessage);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) { this.view = undefined; this.ready = false; }
    });
    this.createWebview(webviewView.webview, 'sidebar');
    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        void this.handleMessage(webviewView.webview, msg);
        if (msg.type === 'ready' && this.view === webviewView) {
          this.ready = true;
          // ready mesajı dinleyici kurulduktan hemen sonra gelir; bir kare bekle
          setTimeout(() => this.flush(), 50);
        }
      },
      undefined, this.context.subscriptions,
    );
  }
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, host: 'sidebar' | 'panel'): string {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.css'));
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Tulvez Code</title>
</head>
<body data-host="${host}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let v = '';
  for (let i = 0; i < 32; i++) v += chars.charAt(Math.floor(Math.random() * chars.length));
  return v;
}

function safeCommand<T>(command: string, ...args: unknown[]): Promise<T> {
  return Promise.resolve(vscode.commands.executeCommand<T>(command, ...args));
}

function friendlyError(err: string): string {
  const m = err.toLowerCase();

  if (m.includes('no output generated')) {
    return 'Sağlayıcı boş yanıt döndürdü. Bu genelde kota, geçici yoğunluk veya model hatasıdır. Model değiştirip tekrar deneyebilirsin.';
  }
  if (m.includes('exceeded your current quota') || m.includes('quota exceeded') || m.includes('billing')) {
    const retry = /retry in (\d+)h(\d+)m/.exec(err);
    const wait = retry ? ` Yaklaşık ${retry[1]} saat ${retry[2]} dakika sonra sıfırlanır.` : '';
    return `Sağlayıcının ücretsiz kotası tükendi.${wait} Ücretli plana geçebilir, başka bir model/anahtar seçebilir veya Ollama kullanabilirsin.`;
  }
  if (m.includes('429')) {
    return 'Çok fazla istek gönderildi. Birkaç saniye bekleyip tekrar dene.';
  }
  if (m.includes('503') || m.includes('overloaded') || m.includes('high demand')) {
    return 'Model şu anda aşırı yoğun (sağlayıcı tarafı). Birkaç dakika sonra tekrar dene veya başka bir model seç.';
  }
  if (m.includes('failed to parse stream')) {
    return 'Cevap akışı sağlayıcı tarafında kesildi. Tekrar dene veya başka bir model seç.';
  }
  if (m.includes('zaman aşımına uğradı')) {
    return 'Cevap akışı zaman aşımına uğradı. Ağ bağlantını kontrol edip tekrar dene.';
  }
  if (m.includes('fetch failed') || m.includes('econnreset') || m.includes('network') || m.includes('enotfound')) {
    return 'Sağlayıcıya ulaşılamadı. İnternet bağlantını kontrol et veya Ollama kullanıyorsan sunucunun açık olduğundan emin ol.';
  }
  if (m.includes('api key') || m.includes('api anahtarı') || m.includes('unauthorized') || m.includes('401')) {
    return 'API anahtarı eksik veya geçersiz. Ayarlar\'dan anahtarını kontrol et.';
  }
  if (m.includes('model') && (m.includes('not found') || m.includes('404'))) {
    return 'Seçili model bulunamadı. Ayarlar → Model listesinden geçerli bir model seç.';
  }
  if (m.includes('tool') && m.includes('not supported')) {
    return 'Bu model araç (tool) çağrısını desteklemiyor. Araç kullanabilen bir model seç (ör. Claude Sonnet, GPT-4o, Gemini 2.5 Flash).';
  }
  return err.length > 400 ? `${err.slice(0, 400)}…` : err;
}

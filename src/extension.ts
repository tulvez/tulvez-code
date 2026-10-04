import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

// 3. parti SDK'ların Node deprecation uyarılarını susturur (VS Code terminalinde görünür gürültü)
process.noDeprecation = true;
import type { HostToWebviewMessage, TulvezSettings, WebviewToHostMessage } from './services/messages';
import { runAgent, invalidateRepoMap } from './services/agent';
import { aiEditHooks, aiLineCountForActiveEditor, refreshAiDecorations, getDiffContentProvider, openDiffForFile } from './services/tools';
import { createSkillsTemplate, parseSkills, skillsFileExists, skillsFileUri } from './services/skills';
import { listProviderModels } from './services/models';

export function activate(context: vscode.ExtensionContext): void {
  const createWebview = (webview: vscode.Webview): void => {
    try {
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(context.extensionUri, 'resources'),
        ],
      };
      webview.html = getWebviewHtml(webview, context.extensionUri);
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
    if (settings.apiKey) {
      await context.secrets.store(secretKeyFor(settings.aiProvider), settings.apiKey);
    } else {
      await context.secrets.delete(secretKeyFor(settings.aiProvider));
    }
  };

  const pendingToolApprovals = new Map<string, (approved: boolean) => void>();

  let activeAbort: AbortController | null = null;
  let lastEditedFile: string | null = null;
  let lastAssistantText = '';
  let pendingCommitText = '';

  const runAgentFor = async (
    webview: vscode.Webview,
    settings: TulvezSettings,
    prompt: string,
    mode: 'ask' | 'plan' | 'build',
    history: { role: 'user' | 'assistant'; text: string }[],
    opts: { commitMessage?: { staged: boolean } } = {},
  ): Promise<void> => {
    const commitMessage = opts.commitMessage;
    activeAbort?.abort();
    activeAbort = new AbortController();
    const signal = activeAbort.signal;
    await runAgent(settings, prompt, mode, history, {
      onChunk: (chunk) => {
        lastAssistantText += chunk;
        void webview.postMessage({ type: 'assistantChunk', text: chunk } satisfies HostToWebviewMessage);
      },
      onReasoning: (chunk) => void webview.postMessage({ type: 'assistantReasoning', text: chunk } satisfies HostToWebviewMessage),
      onToolCall: (tool, summary) => {
        lastEditedFile = tool === 'write_file' || tool === 'replace_in_file' ? summary : lastEditedFile;
        void webview.postMessage({ type: 'toolCall', tool, summary } satisfies HostToWebviewMessage);
      },
      onToolRequest: (id, tool, args) =>
        new Promise<boolean>((resolve) => {
          pendingToolApprovals.set(id, resolve);
          void webview.postMessage({ type: 'toolRequest', id, tool, args } satisfies HostToWebviewMessage);
        }),
      onDone: (usage) => {
        activeAbort = null;
        if (commitMessage) {
          pendingCommitText = lastAssistantText.trim();
          void webview.postMessage({
            type: 'commitMessage',
            text: pendingCommitText,
            staged: commitMessage.staged,
          } satisfies HostToWebviewMessage);
          lastAssistantText = '';
          pendingCommitText = '';
        }
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
        void webview.postMessage({ type: 'cancelled' } satisfies HostToWebviewMessage);
      },
      onError: (err) => {
        activeAbort = null;
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
    });
  };

  const handleMessage = async (
    webview: vscode.Webview,
    message: WebviewToHostMessage,
  ): Promise<void> => {
    if (message.type === 'applyCommit') {
      const msg = message.message.trim();
      if (!msg) return;
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const result = await new Promise<{ output: string; exitCode: number }>((resolve) => {
        cp.exec(`git commit -m ${JSON.stringify(msg)}`, { cwd }, (err, stdout, stderr) => {
          resolve({ output: `${stdout || ''}${stderr || ''}`.trim() || err?.message || '', exitCode: err?.code ?? 0 });
        });
      });
      await webview.postMessage({
        type: 'commitResult',
        output: result.exitCode === 0 ? result.output || 'Commit oluşturuldu.' : `Commit başarısız: ${result.output}`,
        exitCode: result.exitCode,
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'cancelStream') {
      activeAbort?.abort();
      activeAbort = null;
      return;
    }

    if (message.type === 'toolApproval') {
      const resolve = pendingToolApprovals.get(message.id);
      if (resolve) {
        resolve(message.approved);
        pendingToolApprovals.delete(message.id);
      }
      return;
    }

    if (message.type === 'ready') {
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
        let diff = await git('diff --cached');
        const staged = !!diff;
        if (!diff) diff = await git('diff');
        if (!diff) {
          await webview.postMessage({ type: 'error', message: 'Commitlenecek değişiklik yok. Önce git add çalıştırın.' } satisfies HostToWebviewMessage);
          return;
        }
        prompt = `Aşağıdaki değişiklikler için conventional commit formatında, Türkçe, tek satırlık kısa bir commit mesajı üret. Sadece mesaj metnini yaz, başlık/açıklama listesi yok, tırnak yok:\n\n${diff.slice(0, 12000)}`;
        await runAgentFor(webview, settings, prompt, mode, [], { commitMessage: { staged } });
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
        const wanted = (message.arg ?? '').trim().toLowerCase();
        const skills = parseSkills();
        if (skills.length === 0) {
          await webview.postMessage({ type: 'error', message: 'code_skills.md bulunamadı veya içinde Skills bölümü yok. Ayarlar\'dan oluşturabilirsin.' } satisfies HostToWebviewMessage);
          return;
        }
        const found = skills.find((s) => s.name.toLowerCase() === wanted) ?? skills[0];
        prompt = `${found.text}\n\n(Bu talimat code_skills.md içindeki "${found.name}" skill'inden geldi.)`;
      }

      await runAgentFor(webview, settings, prompt, mode, []);
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

      const effective = { ...settings, model: message.model?.trim() ? message.model : settings.model };
      await runAgentFor(webview, effective, userText, message.mode, message.history ?? []);
    }
  };

  const sidebarProvider = new TulvezSidebarProvider(context, createWebview, handleMessage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tulvez.sidebar', sidebarProvider),
  );

  const openPanel = () => {
    const panel = vscode.window.createWebviewPanel(
      'tulvezPanel', 'Tulvez Code', vscode.ViewColumn.Beside, { enableScripts: true },
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
  aiEditHooks.onEdit = () => {
    invalidateRepoMap();
    updateAiStatus();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => { refreshAiDecorations(); updateAiStatus(); }),
    vscode.window.onDidChangeVisibleTextEditors(() => { refreshAiDecorations(); updateAiStatus(); }),
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    try {
      openPanel();
    } catch (err) {
      console.error('[Tulvez] Panel açılamadı:', err);
      void vscode.window.showErrorMessage('Tulvez Code paneli açılamadı. Ayrıntı için Output → Extension Host loguna bakın.');
    }
  }
}

export function deactivate(): void {}

class TulvezSidebarProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly createWebview: (webview: vscode.Webview) => void,
    private readonly handleMessage: (webview: vscode.Webview, message: WebviewToHostMessage) => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.createWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => void this.handleMessage(webviewView.webview, msg),
      undefined, this.context.subscriptions,
    );
  }
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.css'));
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Tulvez Code</title>
</head>
<body>
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
  if (m.includes('429') || m.includes('quota exceeded') || m.includes('quota')) {
    const retry = /retry in (\d+)h(\d+)m/.exec(err);
    const wait = retry ? ` Yaklaşık ${retry[1]} saat ${retry[2]} dakika sonra tekrar dene.` : '';
    return `Sağlayıcı kotası doldu.${wait} Ücretsiz katmanda bu sınıra ulaştıysan başka bir model seçebilirsin.`;
  }
  if (m.includes('503') || m.includes('high demand')) {
    return 'Model şu anda aşırı yoğun (sağlayıcı tarafı). Birkaç dakika sonra tekrar dene veya başka bir model seç.';
  }
  if (m.includes('failed to parse stream')) {
    return 'Cevap akışı sağlayıcı tarafında kesildi. Tekrar dene veya başka bir model seç.';
  }
  if (m.includes('zaman aşımına uğradı')) {
    return 'Cevap akışı zaman aşımına uğradı. Ağ bağlantını kontrol edip tekrar dene.';
  }
  if (m.includes('fetch failed') || m.includes('econnreset') || m.includes('network')) {
    return 'Sağlayıcıya ulaşılamadı. İnternet bağlantını kontrol et veya Ollama kullanıyorsan sunucunun açık olduğundan emin ol.';
  }
  if (m.includes('api key') || m.includes('api anahtarı')) {
    return 'API anahtarı eksik veya geçersiz. Ayarlar\'dan anahtarını kontrol et.';
  }
  return err;
}

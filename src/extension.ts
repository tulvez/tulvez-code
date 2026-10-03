import * as cp from 'child_process';
import * as vscode from 'vscode';
import OpenAI from 'openai';
import type { HostToWebviewMessage, TulvezSettings, WebviewToHostMessage } from './services/messages';
import { runAgent } from './services/agent';

export function activate(context: vscode.ExtensionContext): void {
  const createWebview = (webview: vscode.Webview): void => {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(context.extensionUri, 'resources'),
      ],
    };
    webview.html = getWebviewHtml(webview, context.extensionUri);
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

  const readSettings = async (): Promise<TulvezSettings> => {
    const cfg = vscode.workspace.getConfiguration('tulvez');
    const apiKey = await context.secrets.get('tulvez.apiKey') ?? '';
    return {
      aiProvider: cfg.get('aiProvider') ?? 'openai',
      model: cfg.get('model') ?? '',
      apiKey,
      ollamaUrl: cfg.get('ollamaUrl') ?? 'http://localhost:11434',
      autoApproveCommands: cfg.get('autoApproveCommands') ?? false,
      allowShellCommands: cfg.get('allowShellCommands') ?? false,
      telemetry: cfg.get('telemetry') ?? false,
      sendCodeContext: cfg.get('sendCodeContext') ?? false,
    };
  };

  const saveSettings = async (settings: TulvezSettings): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration('tulvez');
    await cfg.update('aiProvider', settings.aiProvider, vscode.ConfigurationTarget.Global);
    await cfg.update('model', settings.model, vscode.ConfigurationTarget.Global);
    await cfg.update('ollamaUrl', settings.ollamaUrl, vscode.ConfigurationTarget.Global);
    await cfg.update('autoApproveCommands', settings.autoApproveCommands, vscode.ConfigurationTarget.Global);
    await cfg.update('allowShellCommands', settings.allowShellCommands, vscode.ConfigurationTarget.Global);
    await cfg.update('telemetry', settings.telemetry, vscode.ConfigurationTarget.Global);
    await cfg.update('sendCodeContext', settings.sendCodeContext, vscode.ConfigurationTarget.Global);
    if (settings.apiKey) {
      await context.secrets.store('tulvez.apiKey', settings.apiKey);
    } else {
      await context.secrets.delete('tulvez.apiKey');
    }
  };

  const pendingToolApprovals = new Map<string, (approved: boolean) => void>();

  const runAgentFor = async (
    webview: vscode.Webview,
    settings: TulvezSettings,
    prompt: string,
    mode: 'ask' | 'plan' | 'build',
    history: { role: 'user' | 'assistant'; text: string }[],
  ): Promise<void> => {
    await runAgent(settings, prompt, mode, history, {
      onChunk: (chunk) => void webview.postMessage({ type: 'assistantChunk', text: chunk } satisfies HostToWebviewMessage),
      onToolCall: (tool, summary) => void webview.postMessage({ type: 'toolCall', tool, summary } satisfies HostToWebviewMessage),
      onToolRequest: (id, tool, args) =>
        new Promise<boolean>((resolve) => {
          pendingToolApprovals.set(id, resolve);
          void webview.postMessage({ type: 'toolRequest', id, tool, args } satisfies HostToWebviewMessage);
        }),
      onDone: (usage) => void webview.postMessage({ type: 'assistantDone', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } satisfies HostToWebviewMessage),
      onError: (err) => void webview.postMessage({ type: 'error', message: err } satisfies HostToWebviewMessage),
    });
  };

  const handleMessage = async (
    webview: vscode.Webview,
    message: WebviewToHostMessage,
  ): Promise<void> => {
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
      await webview.postMessage({
        type: 'initialized',
        workspaceName,
        logoUri: getLogoUri(webview),
      } satisfies HostToWebviewMessage);
      const settings = await readSettings();
      await webview.postMessage({ type: 'settingsData', settings } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'expandSidebar') {
      vscode.window.showInformationMessage('Sidebar kenarını sürükleyerek genişletin.');
      return;
    }

    if (message.type === 'listModels') {
      const settings = await readSettings();
      try {
        let models: string[] = [];
        const provider = settings.aiProvider;
        if (provider === 'openai' || provider === 'groq') {
          const baseURL = provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined;
          const client = new OpenAI({ apiKey: settings.apiKey, ...(baseURL ? { baseURL } : {}) });
          const list = await client.models.list();
          models = list.data.map((m) => m.id).sort();
        } else if (provider === 'gemini') {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${settings.apiKey}`);
          const json = await res.json() as { models?: { name: string }[] };
          models = (json.models ?? []).map((m) => m.name.replace(/^models\//, '')).sort();
        } else if (provider === 'anthropic') {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: { 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' },
          });
          const json = await res.json() as { data?: { id: string }[] };
          models = (json.data ?? []).map((m) => m.id).sort();
        } else if (provider === 'ollama') {
          const res = await fetch(`${(settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`);
          const json = await res.json() as { models?: { name: string }[] };
          models = (json.models ?? []).map((m) => m.name).sort();
        }
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
        if (!diff) diff = await git('diff');
        if (!diff) {
          await webview.postMessage({ type: 'error', message: 'Commitlenecek değişiklik yok. Önce git add çalıştırın.' } satisfies HostToWebviewMessage);
          return;
        }
        prompt = `Aşağıdaki değişiklikler için conventional commit formatında, Türkçe, tek satırlık kısa bir commit mesajı üret. Ek açıklama ekleme, sadece mesajı ver:\n\n${diff.slice(0, 12000)}`;
      } else if (message.name === 'review') {
        let diff = await git('diff --cached');
        if (!diff) diff = await git('diff');
        prompt = diff
          ? `Aşağıdaki git diff'ini kod incelemesi açısından değerlendir. Türkçe, maddeler halinde; hata, risk, güvenlik ve iyileştirme fırsatlarını yaz:\n\n${diff.slice(0, 12000)}`
          : 'Çalışma alanında değişiklik yok. Lütfen önce değişiklik yapın.';
      } else if (message.name === 'diff') {
        const diff = (await git('diff --stat')) || (await git('status --short')) || 'Değişiklik yok.';
        prompt = `Şu git değişikliklerini özetle ve yorumla (Türkçe, kısa):\n\n${diff.slice(0, 12000)}`;
      } else if (message.name === 'explain') {
        const sel = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
        if (!sel) {
          await webview.postMessage({ type: 'error', message: 'Editörde seçili kod yok. Önce kod seçin.' } satisfies HostToWebviewMessage);
          return;
        }
        prompt = `Aşağıdaki kodu Türkçe olarak açıkla; ne yaptığını, önemli noktaları ve olası sorunları yaz:\n\n\`\`\`\n${sel.slice(0, 8000)}\n\`\`\``;
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

      await runAgentFor(webview, settings, userText, message.mode, message.history ?? []);
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

  if (context.extensionMode === vscode.ExtensionMode.Development) openPanel();
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

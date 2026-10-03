import * as cp from 'child_process';
import * as vscode from 'vscode';
import type { HostToWebviewMessage, TulvezSettings, WebviewToHostMessage } from './services/messages';

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
      apiKey,
      autoApproveCommands: cfg.get('autoApproveCommands') ?? false,
      allowShellCommands: cfg.get('allowShellCommands') ?? false,
      telemetry: cfg.get('telemetry') ?? false,
      sendCodeContext: cfg.get('sendCodeContext') ?? false,
    };
  };

  const saveSettings = async (settings: TulvezSettings): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration('tulvez');
    await cfg.update('aiProvider', settings.aiProvider, vscode.ConfigurationTarget.Global);
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

  const handleMessage = async (
    webview: vscode.Webview,
    message: WebviewToHostMessage,
  ): Promise<void> => {
    if (message.type === 'ready') {
      const workspaceName = vscode.workspace.name ?? 'Çalışma alanı yok';
      await webview.postMessage({
        type: 'initialized',
        workspaceName,
        logoUri: getLogoUri(webview),
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'expandSidebar') {
      vscode.window.showInformationMessage('Sidebar kenarını sürükleyerek genişletin.');
      return;
    }

    if (message.type === 'getSettings') {
      const settings = await readSettings();
      await webview.postMessage({ type: 'settingsData', settings } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'saveSettings') {
      await saveSettings(message.settings);
      vscode.window.showInformationMessage('Tulvez Code: Ayarlar kaydedildi.');
      return;
    }

    if (message.type === 'runCommand') {
      // İzin kontrolü webview onay kartında yapılıyor; burada direkt çalıştır
      const result = await runShellCommand(message.command);
      await webview.postMessage({
        type: 'commandResult',
        output: result.output,
        exitCode: result.exitCode,
      } satisfies HostToWebviewMessage);
      return;
    }

    if (message.type === 'sendMessage') {
      const text = message.text.trim();
      if (!text) return;
      await webview.postMessage({
        type: 'assistantMessage',
        text: `"${text}" — Yapay zeka sağlayıcısı henüz bağlanmadı. Ayarlar'dan API anahtarı ekleyin.`,
      } satisfies HostToWebviewMessage);
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

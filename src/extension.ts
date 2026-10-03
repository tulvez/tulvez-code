import * as vscode from 'vscode';
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from './services/messages';

export function activate(context: vscode.ExtensionContext): void {
  const createWebview = (webview: vscode.Webview): void => {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
      ],
    };
    webview.html = getWebviewHtml(webview, context.extensionUri);
  };

  const handleMessage = async (
    webview: vscode.Webview,
    message: WebviewToHostMessage,
  ): Promise<void> => {
    if (message.type === 'ready') {
      const workspaceName = vscode.workspace.name ?? 'Çalışma alanı yok';
      await webview.postMessage({ type: 'initialized', workspaceName });
      return;
    }

    if (message.type === 'expandSidebar') {
      await vscode.commands.executeCommand('workbench.action.resizeSideBarToFitContent');
      return;
    }

    if (message.type === 'sendMessage') {
      const text = message.text.trim();
      if (text.length === 0) {
        return;
      }

      await webview.postMessage({
        type: 'assistantMessage',
        text: 'Yapay zeka sağlayıcısı henüz yapılandırılmadı. Mesajınız alındı.',
      });
    }
  };

  const sidebarProvider = new TulvezSidebarProvider(context, createWebview, handleMessage);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('tulvez.sidebar', sidebarProvider),
  );

  const openPanel = () => {
    const panel = vscode.window.createWebviewPanel(
      'tulvezPanel',
      'Tulvez Code',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    createWebview(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => void handleMessage(panel.webview, message),
      undefined,
      context.subscriptions,
    );
  };

  const disposable = vscode.commands.registerCommand('tulvez.openPanel', openPanel);

  context.subscriptions.push(disposable);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    openPanel();
  }
}

export function deactivate(): void {}

class TulvezSidebarProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly createWebview: (webview: vscode.Webview) => void,
    private readonly handleMessage: (
      webview: vscode.Webview,
      message: WebviewToHostMessage,
    ) => Promise<void>,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.createWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => void this.handleMessage(webviewView.webview, message),
      undefined,
      this.context.subscriptions,
    );
  }
}

function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const webviewRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'assets', 'index.css'));
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

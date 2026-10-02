import * as vscode from 'vscode';
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from './services/messages';

export function activate(context: vscode.ExtensionContext): void {
  const openPanel = () => {
    const panel = vscode.window.createWebviewPanel(
      'tulvezPanel',
      'Tulvez Code',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          const workspaceName = vscode.workspace.name ?? 'No workspace';
          void postMessage(panel, { type: 'initialized', workspaceName });
          return;
        }

        if (message.type === 'sendMessage') {
          const text = message.text.trim();
          if (text.length === 0) {
            return;
          }

          void postMessage(panel, {
            type: 'assistantMessage',
            text: 'The AI provider is not configured yet. Your message was received.',
          });
        }
      },
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

async function postMessage(
  panel: vscode.WebviewPanel,
  message: HostToWebviewMessage,
): Promise<void> {
  await panel.webview.postMessage(message);
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
<html lang="en">
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

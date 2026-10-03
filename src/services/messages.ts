export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }
  | { type: 'expandSidebar' };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string }
  | { type: 'error'; message: string }
  | { type: 'assistantMessage'; text: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }
  | { type: 'expandSidebar' }
  | { type: 'runCommand'; command: string };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string; logoUri: string }
  | { type: 'error'; message: string }
  | { type: 'assistantMessage'; text: string }
  | { type: 'commandResult'; output: string; exitCode: number };

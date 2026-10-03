export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string }
  | { type: 'expandSidebar' }
  | { type: 'runCommand'; command: string; autoApprove?: boolean }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: TulvezSettings }
  | { type: 'createWorkspace'; name: string };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string; logoUri: string }
  | { type: 'error'; message: string }
  | { type: 'assistantMessage'; text: string }
  | { type: 'commandResult'; output: string; exitCode: number }
  | { type: 'settingsData'; settings: TulvezSettings };

export interface TulvezSettings {
  aiProvider: 'openai' | 'gemini' | 'anthropic';
  apiKey: string;
  autoApproveCommands: boolean;
  allowShellCommands: boolean;
  telemetry: boolean;
  sendCodeContext: boolean;
}

export interface TulvezSettings {
  aiProvider: 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'groq';
  model: string;
  apiKey: string;
  ollamaUrl: string;
  autoApproveCommands: boolean;
  allowShellCommands: boolean;
  telemetry: boolean;
  sendCodeContext: boolean;
}

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'sendMessage'; text: string; mode: 'ask' | 'plan' | 'build' }
  | { type: 'expandSidebar' }
  | { type: 'runCommand'; command: string }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: TulvezSettings }
  | { type: 'createWorkspace'; name: string };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string; logoUri: string }
  | { type: 'error'; message: string }
  | { type: 'assistantChunk'; text: string }
  | { type: 'assistantDone'; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: 'commandResult'; output: string; exitCode: number }
  | { type: 'settingsData'; settings: TulvezSettings };

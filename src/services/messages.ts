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
  | { type: 'openFolder' }
  | { type: 'sendMessage'; text: string; mode: 'ask' | 'plan' | 'build'; history: { role: 'user' | 'assistant'; text: string }[]; model?: string }
  | { type: 'slash'; name: 'commit' | 'review' | 'diff' | 'explain'; mode: 'ask' | 'plan' | 'build' }
  | { type: 'toolApproval'; id: string; approved: boolean }
  | { type: 'listModels' }
  | { type: 'expandSidebar' }
  | { type: 'runCommand'; command: string }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: TulvezSettings }
  | { type: 'createWorkspace'; name: string };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string; workspacePath?: string; logoUri: string }
  | { type: 'error'; message: string }
  | { type: 'assistantChunk'; text: string }
  | { type: 'assistantDone'; inputTokens: number; outputTokens: number; costUsd: number; contextWindow?: number }
  | { type: 'commandResult'; output: string; exitCode: number }
  | { type: 'settingsData'; settings: TulvezSettings }
  | { type: 'toolRequest'; id: string; tool: string; args: string }
  | { type: 'toolCall'; tool: string; summary: string }
  | { type: 'modelsList'; models: string[]; error?: string }
  | { type: 'quotaInfo'; model: string; retryAt?: number; limited: boolean };

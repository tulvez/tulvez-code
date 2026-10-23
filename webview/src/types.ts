export interface TulvezSettings {
  aiProvider: 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'groq' | 'opencode' | 'custom';
  model: string;
  apiKey: string;
  ollamaUrl: string;
  baseUrl: string;
  autoApproveCommands: boolean;
  allowShellCommands: boolean;
  telemetry: boolean;
  sendCodeContext: boolean;
  showAiEdits: boolean;
  showModels: boolean;
  showThinking: boolean;
  /** Tulvez Code'un attığı commit'lere ek katkıcı (Co-authored-by) satırı ekle */
  gitCoAuthor: boolean;
}

/** VS Code başlık çubuğu düğmelerinin webview'a ilettiği komutlar */
export type NavigateTarget = 'newChat' | 'history' | 'settings' | 'export';

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'exportChat'; title: string; markdown: string }
  | { type: 'getSkillsRegistry' }
  | { type: 'openVsSettings' }
  | { type: 'clientLog'; level: 'info' | 'error'; text: string }
  | { type: 'installSkill'; id: string }
  | { type: 'removeSkill'; id: string }
  | { type: 'openFolder' }
  | { type: 'sendMessage'; text: string; mode: 'ask' | 'plan' | 'build'; history: { role: 'user' | 'assistant'; text: string }[]; model?: string }
  | { type: 'slash'; name: 'commit' | 'review' | 'diff' | 'explain' | 'skill'; arg?: string; mode: 'ask' | 'plan' | 'build' }
  | { type: 'openSkillsFile' }
  | { type: 'getSkills' }
  | { type: 'openFolder' }
  | { type: 'toolApproval'; id: string; approved: boolean }
  | { type: 'listModels' }
  | { type: 'switchProvider'; provider: TulvezSettings['aiProvider'] }
  | { type: 'cancelStream' }
  | { type: 'applyCommit'; message: string }
  | { type: 'expandSidebar' }
  | { type: 'runCommand'; command: string; autoApprove?: boolean }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: TulvezSettings }
  | { type: 'createWorkspace'; name: string };

export type HostToWebviewMessage =
  | { type: 'initialized'; workspaceName: string; workspacePath?: string; logoUri: string }
  | { type: 'navigate'; to: NavigateTarget }
  | {
      type: 'skillsRegistry';
      source: string;
      skills: { id: string; name: string; description: string; tags: string[]; version?: string }[];
      installed: { id: string; name: string }[];
      error?: string;
      busy?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'systemNotice'; text: string }
  | { type: 'assistantChunk'; text: string }
  | { type: 'assistantReasoning'; text: string }
  | { type: 'assistantDone'; inputTokens: number; outputTokens: number; costUsd: number; contextWindow?: number; model?: string }
  | { type: 'commandResult'; output: string; exitCode: number }
  | { type: 'commitResult'; output: string; exitCode: number }
  | { type: 'commitMessage'; text: string; staged: boolean }
  | { type: 'settingsData'; settings: TulvezSettings }
  | { type: 'toolRequest'; id: string; tool: string; args: string }
  | { type: 'toolCall'; tool: string; summary: string }
  | { type: 'modelsList'; models: string[]; error?: string }
  | { type: 'quotaInfo'; model: string; retryAt?: number; limited: boolean }
  | { type: 'cancelled' }
  | { type: 'skillsStatus'; exists: boolean; path: string; skills: string[] };



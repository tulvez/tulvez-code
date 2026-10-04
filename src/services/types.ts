export type AgentMode = 'ask' | 'plan' | 'build';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}
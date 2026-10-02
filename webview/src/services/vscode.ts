import type { WebviewToHostMessage } from '../types';

interface VSCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

export const vscode = acquireVsCodeApi();

import { prettyModel } from './modelName';

// Sohbeti tek bir Markdown belgesine çevirir (Kaydet düğmesi).
// Düşünüşler katlanır <details> olarak, araç çağrıları ve terminal çıktıları kod bloğu olarak yazılır.

export interface ExportMessage {
  role: 'user' | 'assistant' | 'command' | 'tool';
  text: string;
  mode?: 'ask' | 'plan' | 'build';
  reasoning?: string;
  toolName?: string;
  exitCode?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  stopped?: boolean;
  output?: string;
  status?: 'running' | 'ok' | 'error' | 'rejected';
  cont?: boolean;
}

const MODE_LABEL = { ask: 'Ask', plan: 'Plan', build: 'Build' } as const;

/** İçerikte ``` varsa daha uzun bir çit seçer; blok erken kapanmaz. */
function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}${lang}\n${text.replace(/\s+$/, '')}\n${f}`;
}

export function chatTitle(messages: ExportMessage[]): string {
  return messages.find((m) => m.role === 'user')?.text.trim().split('\n')[0].slice(0, 60) || 'Sohbet';
}

export function chatToMarkdown(messages: ExportMessage[], opts: { workspace?: string; date?: Date } = {}): string {
  const date = opts.date ?? new Date();
  const when = date.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const out: string[] = [
    `# ${chatTitle(messages)}`,
    '',
    `> Tulvez Code sohbeti · ${when}${opts.workspace ? ` · ${opts.workspace}` : ''}`,
  ];

  let tokens = 0;
  let cost = 0;
  for (const m of messages) {
    out.push('');
    if (m.role === 'user') {
      out.push('## Sen', '', m.text.trim());
    } else if (m.role === 'assistant') {
      // Araçtan sonra gelen devam bölümü aynı yanıtın parçasıdır, başlık tekrarlanmaz
      if (!m.cont) out.push(`## Tulvez Code · ${MODE_LABEL[m.mode ?? 'build']}`, '');
      if (m.reasoning?.trim()) {
        out.push('<details>', '<summary>Düşünüş</summary>', '', m.reasoning.trim(), '', '</details>', '');
      }
      if (m.text.startsWith('❌')) out.push(`> **Hata:** ${m.text.replace(/^❌\s*/, '')}`);
      else if (m.text.trim()) out.push(m.text.trim());
      if (m.stopped) out.push('', '_Yanıt durduruldu._');
      if (m.inputTokens !== undefined && m.outputTokens !== undefined) {
        tokens += m.inputTokens + m.outputTokens;
        cost += m.costUsd ?? 0;
        const parts = [`${(m.inputTokens + m.outputTokens).toLocaleString('tr-TR')} token`];
        if (m.costUsd !== undefined) parts.push(m.costUsd === 0 ? 'ücretsiz' : `$${m.costUsd.toFixed(4)}`);
        if (m.model) parts.push(prettyModel(m.model));
        out.push('', `<sub>${parts.join(' · ')}</sub>`);
      }
    } else if (m.role === 'tool' && (m.toolName === 'run_command' || m.toolName === 'run_in_background')) {
      const failed = m.status === 'error' || (m.exitCode ?? 0) !== 0;
      const tag = m.status === 'rejected' ? ' · reddedildi' : failed ? ` · ${m.exitCode !== undefined ? `exit ${m.exitCode}` : 'hata'}` : '';
      out.push(`**Terminal${tag}**`, '', fence(`$ ${m.text}${m.output ? `\n${m.output}` : ''}`, 'text'));
    } else if (m.role === 'tool') {
      out.push(`**Araç · \`${m.toolName ?? 'araç'}\`** ${m.text.includes('\n') ? '' : `\`${m.text}\``}`.trimEnd());
      if (m.text.includes('\n')) out.push('', fence(m.text));
      if (m.output) out.push('', '<details>', '<summary>Sonuç</summary>', '', fence(m.output), '', '</details>');
    } else {
      const failed = (m.exitCode ?? 0) !== 0;
      out.push(`**Terminal${failed ? ` · exit ${m.exitCode}` : ''}**`, '', fence(m.text, 'text'));
    }
  }

  if (tokens > 0) {
    out.push('', '---', '', `<sub>Toplam ${tokens.toLocaleString('tr-TR')} token · ${cost === 0 ? 'ücretsiz' : `$${cost.toFixed(4)}`}</sub>`);
  }
  return `${out.join('\n')}\n`;
}

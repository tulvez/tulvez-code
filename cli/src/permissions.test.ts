import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parseHooks, runHooks } from './hooks';
import { decide, matchesRule } from './permissions';

describe('izin kuralları', () => {
  it('araç adı, kalıp ve Claude Code yazımı', () => {
    expect(matchesRule('run_command(npm test*)', 'run_command', { command: 'npm test -- --run' })).toBe(true);
    expect(matchesRule('Bash(git status:*)', 'run_command', { command: 'git status -s' })).toBe(true);
    expect(matchesRule('Bash(git status:*)', 'run_command', { command: 'git push' })).toBe(false);
    expect(matchesRule('write_file(.env*)', 'write_file', { path: '.env.local' })).toBe(true);
    expect(matchesRule('Read', 'read_files', { paths: ['a', 'b'] })).toBe(true);
    expect(matchesRule('read_files(src/*)', 'read_files', { paths: ['src/a.ts', 'gizli.txt'] })).toBe(false);
    expect(matchesRule('web_search', 'web_fetch', { url: 'x' })).toBe(false);
  });
  it('önce engel, sonra izin, yoksa sor', () => {
    const rules = { allow: ['Bash(npm:*)'], deny: ['Bash(npm publish:*)'] };
    expect(decide(rules, 'run_command', { command: 'npm publish' }).decision).toBe('deny');
    expect(decide(rules, 'run_command', { command: 'npm test' }).decision).toBe('allow');
    expect(decide(rules, 'run_command', { command: 'rm x' }).decision).toBe('ask');
    expect(decide(undefined, 'run_command', { command: 'ls' }).decision).toBe('ask');
  });
});

describe('hook\'lar', () => {
  it('bozuk tanımlar atlanır', () => {
    expect(parseHooks({ PreToolUse: [{ command: 'x' }, { nope: 1 }, { command: ' ' }], Bilinmeyen: [{ command: 'y' }] }))
      .toEqual({ PreToolUse: [{ command: 'x' }] });
  });
  it.skipIf(process.platform === 'win32')('çıkış 2 engeller, stderr gerekçe; stdin JSON ve ortam değişkenleri', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-hook-'));
    const hooks = parseHooks({
      PreToolUse: [
        { matcher: 'write_file|replace_in_file', command: 'cat > girdi.json; echo "$TULVEZ_TOOL $TULVEZ_FILE" > ortam.txt' },
        { matcher: 'run_command', command: 'echo "rm yasak" >&2; exit 2' },
      ],
    });
    const ok = await runHooks(hooks, 'PreToolUse', { cwd: dir, sessionId: 's1', tool: 'write_file', input: { path: 'a.ts' } });
    expect(ok.blocked).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'girdi.json'), 'utf8'))).toMatchObject({ hook_event_name: 'PreToolUse', tool_name: 'write_file', tool_input: { path: 'a.ts' }, session_id: 's1' });
    expect(fs.readFileSync(path.join(dir, 'ortam.txt'), 'utf8').trim()).toBe('write_file a.ts');
    const no = await runHooks(hooks, 'PreToolUse', { cwd: dir, sessionId: 's1', tool: 'run_command', input: { command: 'rm -rf /' } });
    expect(no).toMatchObject({ blocked: true, message: 'rm yasak' });
  });
});

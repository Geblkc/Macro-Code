import { describe, expect, it, vi } from 'vitest';
import { gitHelpLines, parseArgs, runGitCommand, type GitCommandContext } from './commands';
import type { GitApi } from './api';
import type { GitRepoInfo, GitStatus } from './types';
import type { CommandLine } from '../commands';
import { t } from '../i18n/core';

function repoInfo(over: Partial<GitRepoInfo> = {}): GitRepoInfo {
  return {
    installed: true,
    version: 'git version 2.50.0',
    isRepo: true,
    repoRoot: '/tmp/repo',
    bare: false,
    branch: 'main',
    detached: false,
    head: 'abc123',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    operation: null,
    outsideRepo: false,
    ...over,
  };
}

function gitStatus(over: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    detached: false,
    head: 'abc123',
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    files: [],
    clean: true,
    operation: null,
    ...over,
  };
}

function fakeApi(over: Partial<GitApi> = {}): GitApi {
  const base: GitApi = {
    detect: vi.fn(async () => repoInfo()),
    status: vi.fn(async () => gitStatus()),
    diff: vi.fn(async () => ({
      path: null,
      staged: false,
      text: '',
      binary: false,
      truncated: false,
      untracked: false,
    })),
    log: vi.fn(async () => []),
    show: vi.fn(async () => ({ sha: 'abc', text: '', truncated: false })),
    branches: vi.fn(async () => []),
    remotes: vi.fn(async () => []),
    stage: vi.fn(async () => gitStatus()),
    unstage: vi.fn(async () => gitStatus()),
    discard: vi.fn(async () => gitStatus()),
    commit: vi.fn(async () => ({
      sha: 'abcdef1234567890',
      short: 'abcdef1',
      author: 'A',
      email: 'a@b.c',
      timestamp: 1,
      subject: 'feat: x',
      body: '',
    })),
    switchBranch: vi.fn(async () => gitStatus()),
    fetch: vi.fn(async () => gitStatus()),
    pull: vi.fn(async () => gitStatus()),
    push: vi.fn(async () => gitStatus()),
    init: vi.fn(async () => repoInfo()),
  };
  return { ...base, ...over };
}

function ctx(api: GitApi, over: Partial<GitCommandContext> = {}): GitCommandContext & {
  lines: CommandLine[];
  confirmations: number;
} {
  const lines: CommandLine[] = [];
  const state = { confirmations: 0 };
  return {
    root: '/tmp/repo',
    api,
    push: (line) => lines.push(line),
    openPanel: vi.fn(),
    confirm: vi.fn(async () => {
      state.confirmations += 1;
      return true;
    }),
    get lines() {
      return lines;
    },
    get confirmations() {
      return state.confirmations;
    },
    ...over,
  } as GitCommandContext & { lines: CommandLine[]; confirmations: number };
}

describe('/git — argüman ayrıştırma', () => {
  it('tırnaklı ve tırnaksız argümanlar', () => {
    expect(parseArgs('src/a.ts "foo bar.txt" \'x y\'')).toEqual([
      'src/a.ts',
      'foo bar.txt',
      'x y',
    ]);
    expect(parseArgs('')).toEqual([]);
  });
});

describe('/git — yönlendirme ve tespit', () => {
  it('/git ile başlamayan girdi false döner', async () => {
    const c = ctx(fakeApi());
    expect(await runGitCommand('merhaba', c)).toBe(false);
    expect(await runGitCommand('/github', c)).toBe(false);
    expect(await runGitCommand('/gitx status', c)).toBe(false);
  });

  it('workspace yoksa hata satırı', async () => {
    const api = fakeApi();
    const c = ctx(api, { root: '' });
    expect(await runGitCommand('/git status', c)).toBe(true);
    expect(c.lines[0].type).toBe('err');
    expect(api.detect).not.toHaveBeenCalled();
  });

  it('repo dışı/missing/bare durumları status çağırmaz', async () => {
    for (const [over, type] of [
      [{ isRepo: false }, 'warn'],
      [{ outsideRepo: true }, 'err'],
      [{ installed: false }, 'err'],
      [{ bare: true }, 'err'],
    ] as const) {
      const status = vi.fn(async () => gitStatus());
      const api = fakeApi({ detect: vi.fn(async () => repoInfo(over)), status });
      const c = ctx(api);
      expect(await runGitCommand('/git status', c)).toBe(true);
      expect(c.lines[0].type).toBe(type);
      expect(status).not.toHaveBeenCalled();
    }
  });
});

describe('/git — salt okunur komutlar', () => {
  it('status özeti ve dosya işaretleri', async () => {
    const api = fakeApi({
      status: vi.fn(async () =>
        gitStatus({
          clean: false,
          files: [
            {
              path: 'src/a.ts',
              origPath: null,
              indexStatus: 'M',
              worktreeStatus: '.',
              staged: true,
              unstaged: false,
              kind: 'modified',
            },
            {
              path: 'src/b.ts',
              origPath: null,
              indexStatus: '.',
              worktreeStatus: 'M',
              staged: false,
              unstaged: true,
              kind: 'modified',
            },
          ],
        }),
      ),
    });
    const c = ctx(api);
    await runGitCommand('/git status', c);
    expect(c.lines[0].content).toContain('main');
    expect(c.lines[0].content).toContain('↑1');
    expect(c.lines.some((l) => l.content.includes('●'))).toBe(true);
    expect(c.lines.some((l) => l.content.includes('○'))).toBe(true);
  });

  it('temiz çalışma ağacı', async () => {
    const c = ctx(fakeApi());
    await runGitCommand('/git status', c);
    expect(c.lines.some((l) => l.content === t('git.clean'))).toBe(true);
  });

  it('diff çıktısı 200 satırda kesilir', async () => {
    const text = Array.from({ length: 250 }, (_, i) => `+satır ${i}`).join('\n');
    const api = fakeApi({
      diff: vi.fn(async () => ({
        path: 'a.ts',
        staged: false,
        text,
        binary: false,
        truncated: false,
        untracked: false,
      })),
    });
    const c = ctx(api);
    await runGitCommand('/git diff --staged a.ts', c);
    expect(api.diff).toHaveBeenCalledWith('/tmp/repo', 'a.ts', true);
    expect(c.lines.length).toBe(201);
    expect(c.lines[c.lines.length - 1].type).toBe('warn');
  });

  it('/git log limiti 1..50 aralığına kırpılır', async () => {
    const api = fakeApi();
    const c = ctx(api);
    await runGitCommand('/git log 999', c);
    expect(api.log).toHaveBeenCalledWith('/tmp/repo', 50);
  });

  it('/git help alt komutları listeler', async () => {
    const c = ctx(fakeApi());
    await runGitCommand('/git help', c);
    expect(c.lines.length).toBe(gitHelpLines().length);
    expect(c.lines[0].content).toBe(t('commands.help.gitSubcommands'));
  });

  it('/git help workspace olmadan da çalışır', async () => {
    const api = fakeApi();
    const c = ctx(api, { root: '' });
    await runGitCommand('/git help', c);
    expect(api.detect).not.toHaveBeenCalled();
    expect(c.lines.some((l) => l.content.includes('/git status'))).toBe(true);
  });

  it('bilinmeyen alt komut hata verir', async () => {
    const c = ctx(fakeApi());
    await runGitCommand('/git zzz', c);
    expect(c.lines[0].type).toBe('err');
    expect(c.lines[0].content).toContain('zzz');
  });
});

describe('/git — mutasyonlar ve onay', () => {
  it('add yolları API\'ye geçirir (onay istemez)', async () => {
    const api = fakeApi();
    const c = ctx(api);
    await runGitCommand('/git add "src/a.ts" src/b.ts', c);
    expect(api.stage).toHaveBeenCalledWith('/tmp/repo', ['src/a.ts', 'src/b.ts']);
    expect(c.confirmations).toBe(0);
    expect(c.lines.some((l) => l.content === t('git.stagedDone', { count: 2 }))).toBe(true);
  });

  it('add yol yoksa kullanım hatası', async () => {
    const api = fakeApi();
    const c = ctx(api);
    await runGitCommand('/git add', c);
    expect(api.stage).not.toHaveBeenCalled();
    expect(c.lines[0].type).toBe('err');
  });

  it('commit onay ister; onaylanınca mesajı iletir', async () => {
    const api = fakeApi();
    const c = ctx(api);
    await runGitCommand('/git commit feat: yeni şey', c);
    expect(c.confirmations).toBe(1);
    expect(api.commit).toHaveBeenCalledWith('/tmp/repo', 'feat: yeni şey', false);
    expect(c.lines[0].content).toContain('commit');
  });

  it('commit onaylanmazsa API çağrılmaz', async () => {
    const api = fakeApi();
    const c = ctx(api, { confirm: vi.fn(async () => false) });
    await runGitCommand('/git commit feat: x', c);
    expect(api.commit).not.toHaveBeenCalled();
    expect(c.lines).toEqual([]);
  });

  it('mesajsız commit paneli açar', async () => {
    const api = fakeApi();
    const openPanel = vi.fn();
    const c = ctx(api, { openPanel });
    await runGitCommand('/git commit', c);
    expect(openPanel).toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();
  });

  it('/git commit --amend mesajsız: son commit mesajını yeniden kullanır', async () => {
    const api = fakeApi({
      log: vi.fn(async () => [
        {
          sha: 'abcdef',
          short: 'abcdef',
          author: 'A',
          email: 'a@b.c',
          timestamp: 1,
          subject: 'feat: önceki',
          body: 'gövde metni',
        },
      ]),
    });
    const c = ctx(api);
    await runGitCommand('/git commit --amend', c);
    expect(c.confirmations).toBe(1);
    expect(api.commit).toHaveBeenCalledWith(
      '/tmp/repo',
      'feat: önceki\n\ngövde metni',
      true,
    );
  });

  it('switch -c yeni branch oluşturur, onay ister', async () => {
    const api = fakeApi();
    const c = ctx(api);
    await runGitCommand('/git switch -c feature/yeni', c);
    expect(c.confirmations).toBe(1);
    expect(api.switchBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/yeni', true);
    expect(c.lines[0].content).toContain('main');
  });

  it('push/pull onay ister, fetch istemez', async () => {
    const pushApi = fakeApi();
    const pushCtx = ctx(pushApi);
    await runGitCommand('/git push', pushCtx);
    expect(pushCtx.confirmations).toBe(1);
    expect(pushApi.push).toHaveBeenCalledWith('/tmp/repo');

    const fetchApi = fakeApi();
    const fetchCtx = ctx(fetchApi);
    await runGitCommand('/git fetch', fetchCtx);
    expect(fetchCtx.confirmations).toBe(0);
    expect(fetchApi.fetch).toHaveBeenCalledWith('/tmp/repo');
  });

  it('API hatası okunur hata satırına dönüşür', async () => {
    const api = fakeApi({
      stage: vi.fn(async () => {
        throw { code: 'E_INVALID_PATH', message: 'geçersiz yol' };
      }),
    });
    const c = ctx(api);
    await runGitCommand('/git add src/a.ts', c);
    expect(c.lines[0].type).toBe('err');
    expect(c.lines[0].content).toContain('geçersiz yol');
  });
});

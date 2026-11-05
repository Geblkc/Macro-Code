import { describe, expect, it } from 'vitest';
import {
  COMMIT_SYSTEM_PROMPT,
  buildCommitPrompt,
  normalizeCommitMessage,
} from './commitMessage';
import type { GitFile } from './types';

const file = (over: Partial<GitFile> = {}): GitFile => ({
  path: 'src/app.ts',
  origPath: null,
  indexStatus: 'M',
  worktreeStatus: '.',
  staged: true,
  unstaged: false,
  kind: 'modified',
  ...over,
});

describe('AI commit mesajı — prompt', () => {
  it('branch, dosya, geçmiş ve diff başlığını taşır', () => {
    const prompt = buildCommitPrompt({
      diff: 'diff --git a/a b/a\n+x',
      files: [
        file(),
        file({ path: 'src/yeni.ts', kind: 'added', indexStatus: 'A' }),
        file({ path: 'src/yeni ad.ts', origPath: 'src/eski.ts', kind: 'renamed' }),
      ],
      branch: 'feature/git',
      recentSubjects: ['feat: önceki', 'fix: hata'],
    });
    expect(prompt).toContain('Branch: feature/git');
    expect(prompt).toContain('- modified: src/app.ts');
    expect(prompt).toContain('- added: src/yeni.ts');
    expect(prompt).toContain('(from src/eski.ts)');
    expect(prompt).toContain('- feat: önceki');
    expect(prompt).toContain('```diff');
    expect(prompt).toContain('+x');
    expect(COMMIT_SYSTEM_PROMPT).toContain('Conventional Commits');
  });

  it('boş dosya/geçmiş listesi için yer tutucular', () => {
    const prompt = buildCommitPrompt({ diff: '', files: [], branch: '', recentSubjects: [] });
    expect(prompt).toContain('Branch: unknown');
    expect(prompt).toContain('(none listed)');
    expect(prompt).toContain('(none)');
  });
});

describe('AI commit mesajı — normalizasyon', () => {
  it('kod bloğu, tırnak ve madde işaretini temizler', () => {
    expect(normalizeCommitMessage('```text\nfeat: x\n```')).toBe('feat: x');
    expect(normalizeCommitMessage('"fix: y"')).toBe('fix: y');
    expect(normalizeCommitMessage('- chore: z.')).toBe('chore: z');
  });

  it('çok satırlı gövdeyi korur, ardışık boş satırları sadeleştirir', () => {
    const out = normalizeCommitMessage('feat: başlık\n\n\n\ngövde\n\n');
    expect(out).toBe('feat: başlık\n\ngövde');
  });

  it('boş/whitespace → boş string', () => {
    expect(normalizeCommitMessage('')).toBe('');
    expect(normalizeCommitMessage('   \n  ')).toBe('');
  });

  it('tek satırda sondaki noktayı atar, çok satırda dokunmaz', () => {
    expect(normalizeCommitMessage('feat: x.')).toBe('feat: x');
    expect(normalizeCommitMessage('feat: x.\ngövde.')).toBe('feat: x.\ngövde.');
  });
});

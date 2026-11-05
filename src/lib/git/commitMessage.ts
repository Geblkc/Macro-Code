/**
 * AI commit mesajı — saf yardımcılar (ağ yok, testli).
 *
 * Akış: staged diff → secret filtresi + kısaltma (`policy.filterDiffForAi`) →
 * prompt → sağlayıcı → `normalizeCommitMessage` → commit kutusu.
 * **Otomatik commit yoktur.**
 */
import type { GitFile } from './types';

export interface CommitPromptInput {
  diff: string;
  files: GitFile[];
  branch: string;
  recentSubjects: string[];
}

export const COMMIT_SYSTEM_PROMPT = [
  'You are a git commit message generator.',
  'Return ONLY the commit message — no markdown fences, no quotes, no explanation.',
  'Use the Conventional Commits format (e.g. "feat(scope): summary").',
  'First line max 72 characters, imperative mood, no trailing period.',
  'Add a short body only when it materially helps (wrap at 72 chars).',
  "Match the language of the recent commit subjects; if they are mixed or empty, use English.",
  'Never invent changes that are not present in the diff.',
].join(' ');

export function buildCommitPrompt(input: CommitPromptInput): string {
  const files = input.files
    .map((f) => `- ${f.kind}: ${f.path}${f.origPath ? ` (from ${f.origPath})` : ''}`)
    .join('\n');
  const recent = input.recentSubjects.length
    ? input.recentSubjects.map((s) => `- ${s}`).join('\n')
    : '(none)';
  return [
    `Branch: ${input.branch || 'unknown'}`,
    '',
    'Changed files:',
    files || '(none listed)',
    '',
    'Recent commit subjects (for style/language):',
    recent,
    '',
    'Staged diff:',
    '```diff',
    input.diff,
    '```',
  ].join('\n');
}

/** Model çıktısını güvenli/tek mesaja normalize eder. Boşsa boş string. */
export function normalizeCommitMessage(raw: string): string {
  let text = (raw ?? '').trim();
  // Kod bloğu çitlerini temizle.
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Baştaki/sondaki tırnak ve liste işaretlerini temizle.
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '');
  text = text.replace(/^[-*]\s+/, '');
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  // Ardışık boş satırları tek boşluğa indir.
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  let result = out.join('\n').trim();
  // Tek satırda model "feat: x." derse sondaki noktayı at (Conventional Commits).
  if (!result.includes('\n')) result = result.replace(/\.$/, '');
  return result;
}

/**
 * Git entegrasyonu — Rust (`commands/git.rs`) sözleşmesinin TS karşılıkları.
 *
 * Rust tarafı `#[serde(rename_all = "camelCase")]` kullanır; Tauri v2 çok
 * kelimeli parametreleri de camelCase'e çevirir (`contextLines` gibi).
 */

export interface GitError {
  code: string;
  message: string;
}

export interface GitRepoInfo {
  installed: boolean;
  version: string | null;
  isRepo: boolean;
  /** Workspace dışındaki (üst) repo kökü — yalnızca yönlendirme. */
  repoRoot: string | null;
  bare: boolean;
  branch: string | null;
  detached: boolean;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** merge | rebase | cherry-pick | revert | bisect */
  operation: string | null;
  /** Workspace bir üst repo'nun altındaysa true (mutasyon kapalı). */
  outsideRepo: boolean;
}

export type GitFileKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

export interface GitFile {
  path: string;
  origPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  kind: GitFileKind;
}

export interface GitStatus {
  branch: string;
  detached: boolean;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  clean: boolean;
  operation: string | null;
}

export interface GitDiff {
  path: string | null;
  staged: boolean;
  text: string;
  binary: boolean;
  truncated: boolean;
  untracked: boolean;
}

export interface GitCommit {
  sha: string;
  short: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  body: string;
}

export interface GitCommitDetail {
  sha: string;
  text: string;
  truncated: boolean;
}

export interface GitBranch {
  name: string;
  full: string;
  sha: string;
  upstream: string | null;
  current: boolean;
  remote: boolean;
}

export interface GitRemote {
  name: string;
  url: string;
}

export type GitTab = 'changes' | 'history' | 'branches';

/**
 * Git Tauri köprüsü — typed `invoke` sarmalayıcıları.
 *
 * Tarayıcı-dev'de Rust yok: anlamlı `E_TAURI_ONLY` hatası döner (mevcut
 * `/files` deseniyle aynı).
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../tauri';
import type {
  GitBranch,
  GitCommit,
  GitCommitDetail,
  GitDiff,
  GitError,
  GitRemote,
  GitRepoInfo,
  GitStatus,
} from './types';

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    const err: GitError = {
      code: 'E_TAURI_ONLY',
      message: 'git yalnızca masaüstü uygulamada çalışır',
    };
    throw err;
  }
  return invoke<T>(cmd, args);
}

export interface GitApi {
  detect(root: string): Promise<GitRepoInfo>;
  status(root: string): Promise<GitStatus>;
  diff(
    root: string,
    path?: string | null,
    staged?: boolean,
    contextLines?: number,
  ): Promise<GitDiff>;
  log(root: string, limit?: number, skip?: number): Promise<GitCommit[]>;
  show(root: string, sha: string): Promise<GitCommitDetail>;
  branches(root: string): Promise<GitBranch[]>;
  remotes(root: string): Promise<GitRemote[]>;
  stage(root: string, paths: string[]): Promise<GitStatus>;
  unstage(root: string, paths: string[]): Promise<GitStatus>;
  discard(root: string, paths: string[]): Promise<GitStatus>;
  commit(root: string, message: string, amend?: boolean): Promise<GitCommit>;
  switchBranch(root: string, branch: string, create?: boolean): Promise<GitStatus>;
  fetch(root: string): Promise<GitStatus>;
  pull(root: string): Promise<GitStatus>;
  push(root: string, setUpstream?: boolean): Promise<GitStatus>;
  init(root: string): Promise<GitRepoInfo>;
}

export const gitApi: GitApi = {
  detect: (root) => call('git_detect', { root }),
  status: (root) => call('git_status', { root }),
  diff: (root, path, staged, contextLines) =>
    call('git_diff', {
      root,
      path: path ?? null,
      staged: staged ?? false,
      contextLines: contextLines ?? 3,
    }),
  log: (root, limit, skip) => call('git_log', { root, limit: limit ?? 30, skip: skip ?? 0 }),
  show: (root, sha) => call('git_show', { root, sha }),
  branches: (root) => call('git_branches', { root }),
  remotes: (root) => call('git_remotes', { root }),
  stage: (root, paths) => call('git_stage', { root, paths }),
  unstage: (root, paths) => call('git_unstage', { root, paths }),
  discard: (root, paths) => call('git_discard', { root, paths }),
  commit: (root, message, amend) => call('git_commit', { root, message, amend: amend ?? false }),
  switchBranch: (root, branch, create) =>
    call('git_switch', { root, branch, create: create ?? false }),
  fetch: (root) => call('git_fetch', { root }),
  pull: (root) => call('git_pull', { root }),
  push: (root, setUpstream) => call('git_push', { root, setUpstream: setUpstream ?? false }),
  init: (root) => call('git_init', { root }),
};

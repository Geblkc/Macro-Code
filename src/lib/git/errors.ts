/**
 * Git hata kodları → i18n anahtarları.
 *
 * Rust `GitError { code, message }` döndürür. `message` ham git çıktısıdır ve
 * kullanıcıya ayrıca gösterilir; bu modül yalnızca başlık/öneri metnini seçer.
 */
import type { TranslationKey } from '../i18n/core';
import type { GitError } from './types';

const KEYS: Record<string, TranslationKey> = {
  E_GIT_MISSING: 'git.error.gitMissing',
  E_NOT_REPO: 'git.error.notRepo',
  E_REPO_OUTSIDE_WORKSPACE: 'git.error.outsideRepo',
  E_BARE_REPO: 'git.error.bareRepo',
  E_INVALID_ROOT: 'git.error.invalidRoot',
  E_INVALID_PATH: 'git.error.invalidPath',
  E_INVALID_BRANCH: 'git.error.invalidBranch',
  E_INVALID_MESSAGE: 'git.error.invalidMessage',
  E_INVALID_SHA: 'git.error.invalidSha',
  E_NOTHING_STAGED: 'git.error.nothingStaged',
  E_CONFLICT: 'git.error.conflict',
  E_OPERATION_IN_PROGRESS: 'git.error.operationInProgress',
  E_HOOK_FAILED: 'git.error.hookFailed',
  E_AUTH_REQUIRED: 'git.error.authRequired',
  E_NO_REMOTE: 'git.error.noRemote',
  E_NO_UPSTREAM: 'git.error.noUpstream',
  E_NOT_FAST_FORWARD: 'git.error.notFastForward',
  E_DETACHED: 'git.error.detached',
  E_UNTRACKED_DISCARD: 'git.error.untrackedDiscard',
  E_TIMEOUT: 'git.error.timeout',
  E_OUTPUT_TOO_LARGE: 'git.error.outputTooLarge',
  E_TAURI_ONLY: 'git.error.tauriOnly',
  E_GIT_FAILED: 'git.error.failed',
};

/** Hata koduna karşılık gelen i18n anahtarı (bilinmeyen → genel hata). */
export function errorKey(code: string | undefined): TranslationKey {
  return (code && KEYS[code]) || 'git.error.failed';
}

/** Bilinmeyen/objü olmayan reddetme değerini `GitError`'a normalize eder. */
export function asGitError(err: unknown): GitError {
  if (err && typeof err === 'object') {
    const v = err as Record<string, unknown>;
    if (typeof v.code === 'string' && typeof v.message === 'string') {
      return { code: v.code, message: v.message };
    }
    if (typeof v.message === 'string') {
      return { code: 'E_GIT_FAILED', message: v.message };
    }
  }
  if (typeof err === 'string') {
    return { code: 'E_GIT_FAILED', message: err };
  }
  return { code: 'E_GIT_FAILED', message: String(err ?? '') };
}

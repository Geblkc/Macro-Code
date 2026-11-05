import { useMemo } from 'react';
import { useT } from '../../lib/i18n';
import { showToast } from '../../lib/toast';
import { asGitError, errorKey } from '../../lib/git/errors';
import { isSecretPath } from '../../lib/git/policy';
import { useGitStore } from '../../store/git';
import type { GitFile } from '../../lib/git/types';
import { Icon } from '../icons';
import type { GitConfirmFn } from './types';

interface Props {
  confirm: GitConfirmFn;
  onSelect: (path: string, staged: boolean) => void;
}

interface Group {
  key: 'staged' | 'unstaged' | 'untracked' | 'conflicts';
  labelKey: 'git.staged' | 'git.unstaged' | 'git.untracked' | 'git.conflicted';
  files: GitFile[];
  staged: boolean;
}

function statusMark(f: GitFile, staged: boolean): string {
  const ch = staged ? f.indexStatus : f.worktreeStatus;
  return !ch || ch === '.' ? '·' : ch;
}

export default function GitChanges({ confirm, onSelect }: Props) {
  const t = useT();
  const status = useGitStore((s) => s.status);
  const selected = useGitStore((s) => s.selected);
  const stage = useGitStore((s) => s.stage);
  const unstage = useGitStore((s) => s.unstage);
  const discard = useGitStore((s) => s.discard);

  const groups = useMemo<Group[]>(() => {
    const files = status?.files ?? [];
    const conflicts = files.filter((f) => f.kind === 'conflicted');
    const staged = files.filter((f) => f.staged && f.kind !== 'conflicted');
    const untracked = files.filter((f) => f.kind === 'untracked');
    const unstaged = files.filter(
      (f) => f.unstaged && f.kind !== 'untracked' && f.kind !== 'conflicted',
    );
    return [
      { key: 'conflicts', labelKey: 'git.conflicted', files: conflicts, staged: false },
      { key: 'staged', labelKey: 'git.staged', files: staged, staged: true },
      { key: 'unstaged', labelKey: 'git.unstaged', files: unstaged, staged: false },
      { key: 'untracked', labelKey: 'git.untracked', files: untracked, staged: false },
    ].filter((g) => g.files.length > 0) as Group[];
  }, [status]);

  if (!status) return null;

  if (status.files.length === 0) {
    return (
      <div className="git-clean">
        <Icon name="check" size="lg" />
        <p>{t('git.cleanTitle')}</p>
        <span>{t('git.clean')}</span>
      </div>
    );
  }

  const fail = (e: unknown) => {
    const err = asGitError(e);
    showToast(`${t(errorKey(err.code))}: ${err.message}`, 'err');
  };

  const doStage = async (paths: string[]) => {
    try {
      await stage(paths);
    } catch (e) {
      fail(e);
    }
  };
  const doUnstage = async (paths: string[]) => {
    try {
      await unstage(paths);
    } catch (e) {
      fail(e);
    }
  };
  const doDiscard = async (files: GitFile[]) => {
    const usable = files.filter((f) => !isSecretPath(f.path));
    if (usable.length === 0) return;
    const names = usable.map((f) => f.path).join('\n');
    const ok = await confirm({
      title: t('git.discard'),
      message: `${t('git.discardConfirm')}\n\n${names}`,
      confirmLabel: t('git.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
      initialFocus: 'cancel',
    });
    if (!ok) return;
    try {
      await discard(usable.map((f) => f.path));
      showToast(t('git.discarded'), 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const allStageable = status.files
    .filter(
      (f) =>
        (f.unstaged || f.kind === 'untracked') &&
        f.kind !== 'conflicted' &&
        !isSecretPath(f.path),
    )
    .map((f) => f.path);
  const allUnstageable = status.files
    .filter((f) => f.staged && !isSecretPath(f.path))
    .flatMap((f) => (f.origPath ? [f.origPath, f.path] : [f.path]));

  return (
    <div className="git-changes">
      <div className="git-bulk">
        <button
          className="btn btn-sm"
          disabled={allStageable.length === 0}
          onClick={() => void doStage(allStageable)}
          title={t('git.stageAll')}
        >
          <Icon name="plus" size="sm" /> {t('git.stageAll')}
        </button>
        <button
          className="btn btn-sm"
          disabled={allUnstageable.length === 0}
          onClick={() => void doUnstage(allUnstageable)}
          title={t('git.unstageAll')}
        >
          <Icon name="x" size="sm" /> {t('git.unstageAll')}
        </button>
      </div>

      {status.operation ? (
        <div className="git-warn">
          <Icon name="alert-triangle" size="sm" />
          {t('git.operationInProgress', { operation: status.operation })}
        </div>
      ) : null}

      {groups.map((g) => (
        <div className="git-group" key={g.key}>
          <div className="git-group-head">
            <span>{t(g.labelKey)}</span>
            <span className="git-count">{g.files.length}</span>
            {g.key === 'unstaged' ? (
              <button
                className="git-link"
                onClick={() => void doDiscard(g.files)}
                title={t('git.discard')}
              >
                {t('git.discardAll')}
              </button>
            ) : null}
          </div>
          {g.files.map((f) => {
            const active = selected?.path === f.path && selected.staged === g.staged;
            const blocked =
              isSecretPath(f.path) || (f.origPath ? isSecretPath(f.origPath) : false);
            return (
              <div
                key={`${g.key}-${f.path}`}
                className={`git-file${active ? ' active' : ''}${blocked ? ' blocked' : ''}`}
                role={blocked ? undefined : 'button'}
                tabIndex={blocked ? undefined : 0}
                onClick={() => {
                  if (!blocked) onSelect(f.path, g.staged);
                }}
                onKeyDown={(e) => {
                  if (blocked) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(f.path, g.staged);
                  }
                }}
                title={
                  blocked
                    ? `${t('git.error.invalidPath')}: ${f.path}`
                    : f.origPath
                      ? `${f.origPath} → ${f.path}`
                      : f.path
                }
              >
                <span className={`git-mark kind-${f.kind}`}>{statusMark(f, g.staged)}</span>
                <span className="git-file-path">
                  <span className="git-file-name">{f.path.split('/').pop()}</span>
                  <span className="git-file-dir">
                    {f.path.includes('/')
                      ? f.path.slice(0, f.path.lastIndexOf('/') + 1)
                      : ''}
                  </span>
                </span>
                <span className="git-row-actions">
                  {g.key === 'staged' ? (
                    <button
                      className="icon-btn"
                      title={t('git.unstage')}
                      disabled={blocked}
                      onClick={(e) => {
                        e.stopPropagation();
                        void doUnstage(f.origPath ? [f.origPath, f.path] : [f.path]);
                      }}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  ) : g.key === 'conflicts' ? null : (
                    <button
                      className="icon-btn"
                      title={t('git.stage')}
                      disabled={blocked}
                      onClick={(e) => {
                        e.stopPropagation();
                        void doStage([f.path]);
                      }}
                    >
                      <Icon name="plus" size="sm" />
                    </button>
                  )}
                  {g.key === 'unstaged' ? (
                    <button
                      className="icon-btn"
                      title={t('git.discard')}
                      disabled={blocked}
                      onClick={(e) => {
                        e.stopPropagation();
                        void doDiscard([f]);
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

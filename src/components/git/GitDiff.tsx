import { useMemo } from 'react';
import { useT } from '../../lib/i18n';
import { displayPath, parseUnifiedDiff } from '../../lib/git/diff';
import type { GitDiff as GitDiffData } from '../../lib/git/types';
import { Icon } from '../icons';

interface Props {
  diff: GitDiffData | null;
  loading?: boolean;
}

/** Unified diff görüntüleyici (dosya → hunk → satır). */
export default function GitDiff({ diff, loading }: Props) {
  const t = useT();
  const parsed = useMemo(() => (diff ? parseUnifiedDiff(diff.text) : null), [diff]);

  if (loading) {
    return (
      <div className="git-diff-empty">
        <Icon name="refresh" size="sm" /> {t('common.loading')}
      </div>
    );
  }
  if (!diff) {
    return <div className="git-diff-empty">{t('git.diff.selectFile')}</div>;
  }
  if (diff.binary) {
    return <div className="git-diff-empty">{t('git.diff.binary')}</div>;
  }
  if (!diff.text.trim() || !parsed || parsed.files.length === 0) {
    return <div className="git-diff-empty">{t('git.diff.noChanges')}</div>;
  }

  return (
    <div className="git-diff">
      {diff.path ? (
        <div className="git-diff-head">
          <span className="git-diff-path" title={diff.path}>
            {diff.path}
          </span>
          <span className="git-diff-stat">
            +{parsed.additions} −{parsed.deletions}
          </span>
        </div>
      ) : null}
      {parsed.files.map((file, fi) => (
        <div className="git-diff-file" key={`${displayPath(file)}-${fi}`}>
          {parsed.files.length > 1 ? (
            <div className="git-diff-file-head">{displayPath(file)}</div>
          ) : null}
          {file.binary ? (
            <div className="git-diff-empty">{t('git.diff.binary')}</div>
          ) : (
            file.hunks.map((hunk, hi) => (
              <div className="git-hunk" key={`${hunk.header}-${hi}`}>
                <div className="git-hunk-head">{hunk.header}</div>
                <div className="git-hunk-body">
                  {hunk.lines.map((line, li) => (
                    <div
                      key={li}
                      className={`git-diff-line ${line.kind === 'nonewline' ? 'meta' : line.kind}`}
                    >
                      <span className="git-ln" aria-hidden="true">
                        {line.oldNo ?? ''}
                      </span>
                      <span className="git-ln" aria-hidden="true">
                        {line.newNo ?? ''}
                      </span>
                      <span className="git-diff-mark" aria-hidden="true">
                        {line.kind === 'add'
                          ? '+'
                          : line.kind === 'del'
                            ? '−'
                            : line.kind === 'nonewline'
                              ? '\\'
                              : ' '}
                      </span>
                      <span className="git-diff-text">{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
      {diff.truncated ? (
        <div className="git-diff-truncated">
          <Icon name="alert-triangle" size="sm" /> {t('git.diff.truncated')}
        </div>
      ) : null}
    </div>
  );
}

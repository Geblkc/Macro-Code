import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { showToast } from '../../lib/toast';
import { useWorkspaceStore } from '../../store/workspace';
import { useGitStore } from '../../store/git';
import { gitApi } from '../../lib/git/api';
import { asGitError } from '../../lib/git/errors';
import type { GitCommitDetail } from '../../lib/git/types';
import { Icon } from '../icons';

export default function GitHistory() {
  const t = useT();
  const root = useWorkspaceStore((s) => s.root);
  const log = useGitStore((s) => s.log);
  const loadLog = useGitStore((s) => s.loadLog);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (sha: string) => {
    if (!root) return;
    if (detail?.sha === sha) {
      setDetail(null);
      return;
    }
    setBusy(sha);
    try {
      setDetail(await gitApi.show(root, sha));
    } catch (e) {
      const err = asGitError(e);
      showToast(err.message, 'err');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      showToast(t('git.copied'), 'ok');
    } catch {
      showToast(t('git.copyFailed'), 'err');
    }
  };

  if (log.length === 0) {
    return <div className="git-diff-empty">{t('git.log.empty')}</div>;
  }

  return (
    <div className="git-history">
      {log.map((c) => (
        <div className="git-commit-item" key={c.sha}>
          <button className="git-commit-main" onClick={() => void open(c.sha)}>
            <span className="git-commit-subject">{c.subject}</span>
            <span className="git-commit-meta">
              <code>{c.short}</code>
              <span>{c.author}</span>
              {c.timestamp > 0 ? (
                <span>{new Date(c.timestamp * 1000).toLocaleDateString()}</span>
              ) : null}
            </span>
          </button>
          <div className="git-commit-actions">
            <button
              className="icon-btn"
              title={t('git.copySha')}
              onClick={() => void copy(c.sha)}
            >
              <Icon name="copy" size="sm" />
            </button>
          </div>
          {busy === c.sha ? (
            <div className="git-diff-empty">{t('common.loading')}</div>
          ) : null}
          {detail?.sha === c.sha ? (
            <div className="git-commit-detail">
              {c.body ? <p className="git-commit-body">{c.body}</p> : null}
              <pre className="git-commit-patch">{detail.text}</pre>
              {detail.truncated ? (
                <div className="git-diff-truncated">{t('git.diff.truncated')}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      <button className="btn btn-sm git-load-more" onClick={() => void loadLog(true)}>
        {t('git.log.loadMore')}
      </button>
    </div>
  );
}

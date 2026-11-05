import { useMemo, useState } from 'react';
import { useT } from '../../lib/i18n';
import { showToast } from '../../lib/toast';
import { useSettingsStore } from '../../store/settings';
import { useWorkspaceStore } from '../../store/workspace';
import { useGitStore } from '../../store/git';
import { gitApi } from '../../lib/git/api';
import { asGitError, errorKey } from '../../lib/git/errors';
import {
  buildCommitPrompt,
  normalizeCommitMessage,
} from '../../lib/git/commitMessage';
import { filterDiffForAi, isSecretPath, MAX_COMMIT_MESSAGE } from '../../lib/git/policy';
import { generateCommitMessage } from '../../lib/git/ai';
import { Icon } from '../icons';
import type { GitConfirmFn } from './types';

interface Props {
  confirm: GitConfirmFn;
}

export default function GitCommitBox({ confirm }: Props) {
  const t = useT();
  const root = useWorkspaceStore((s) => s.root);
  const status = useGitStore((s) => s.status);
  const log = useGitStore((s) => s.log);
  const commit = useGitStore((s) => s.commit);
  const model = useSettingsStore((s) => s.currentModel);

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const staged = useMemo(
    () => (status?.files ?? []).filter((f) => f.staged),
    [status],
  );
  const canCommit =
    (staged.length > 0 || amend) && message.trim().length > 0 && !aiBusy;

  const fail = (e: unknown) => {
    const err = asGitError(e);
    showToast(`${t(errorKey(err.code))}: ${err.message}`, 'err');
  };

  const suggest = async () => {
    if (!root) return;
    const ok = await confirm({
      title: t('git.aiSuggest'),
      message: t('git.aiConsent', { model }),
      confirmLabel: t('common.approve'),
      cancelLabel: t('common.cancel'),
      initialFocus: 'cancel',
    });
    if (!ok) return;

    setAiBusy(true);
    try {
      const diff = await gitApi.diff(root, null, true);
      const safeFiles = staged.filter((f) => !isSecretPath(f.path));
      const filtered = filterDiffForAi(diff.text);
      if (filtered.text.trim()) {
        let recentSubjects = log.slice(0, 5).map((c) => c.subject);
        if (recentSubjects.length === 0) {
          try {
            recentSubjects = (await gitApi.log(root, 5)).map((c) => c.subject);
          } catch {
            recentSubjects = [];
          }
        }
        const prompt = buildCommitPrompt({
          diff: filtered.text,
          files: safeFiles,
          branch: status?.branch ?? '',
          recentSubjects,
        });
        const suggestion = await generateCommitMessage(prompt);
        setMessage(normalizeCommitMessage(suggestion).slice(0, MAX_COMMIT_MESSAGE));
        const notes: string[] = [];
        if (filtered.excluded.length > 0) {
          notes.push(t('git.aiExcluded', { count: filtered.excluded.length }));
        }
        if (filtered.truncated) notes.push(t('git.diff.truncated'));
        if (notes.length > 0) showToast(notes.join(' · '), 'info');
      } else {
        showToast(t('git.ai.noDiff'), 'info');
      }
    } catch (e) {
      const err = asGitError(e);
      showToast(`${t('git.aiFailed')}: ${err.message}`, 'err');
    } finally {
      setAiBusy(false);
    }
  };

  const doCommit = async () => {
    if (!message.trim()) return;
    if (!canCommit) return;
    const ok = await confirm({
      title: amend ? t('git.amend') : t('git.commit'),
      message: `${t('git.hooksWarning')}${amend ? `\n\n${t('git.amendWarning')}` : ''}\n\n${message}`,
      confirmLabel: amend ? t('git.amend') : t('git.commit'),
      cancelLabel: t('common.cancel'),
      danger: amend,
      initialFocus: 'cancel',
    });
    if (!ok) return;
    try {
      const c = await commit(message, amend);
      showToast(
        t('git.commitDone', { sha: c.short || c.sha.slice(0, 7), subject: c.subject }),
        'ok',
      );
      setMessage('');
      setAmend(false);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="git-commit-box">
      <textarea
        className="git-commit-input"
        value={message}
        placeholder={t('git.commitPlaceholder')}
        rows={3}
        maxLength={MAX_COMMIT_MESSAGE}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void doCommit();
          }
        }}
      />
      <div className="git-commit-row">
        <span className="git-commit-count">
          {staged.length > 0
            ? t('git.stagedCount', { count: staged.length })
            : t('git.nothingStaged')}
        </span>
        <button
          className="btn btn-sm"
          disabled={aiBusy || staged.length === 0}
          onClick={() => void suggest()}
          title={t('git.aiSuggestHint')}
        >
          <Icon name="spark" size="sm" />
          {aiBusy ? t('git.aiRunning') : t('git.aiSuggest')}
        </button>
      </div>
      <div className="git-commit-row">
        <label className="git-amend">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
          />
          {t('git.amend')}
        </label>
        <button className="btn btn-primary btn-sm" disabled={!canCommit} onClick={() => void doCommit()}>
          <Icon name="check" size="sm" />
          {t('git.commit')}
        </button>
      </div>
      <span className="git-hint">{t('git.commitShortcut')}</span>
    </div>
  );
}

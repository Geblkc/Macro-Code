import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { showToast } from '../../lib/toast';
import { asGitError, errorKey } from '../../lib/git/errors';
import { branchNameError } from '../../lib/git/policy';
import { useGitStore } from '../../store/git';
import { Icon } from '../icons';
import type { GitConfirmFn } from './types';

interface Props {
  confirm: GitConfirmFn;
}

export default function GitBranches({ confirm }: Props) {
  const t = useT();
  const branches = useGitStore((s) => s.branches);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);

  const fail = (e: unknown) => {
    const err = asGitError(e);
    showToast(`${t(errorKey(err.code))}: ${err.message}`, 'err');
  };

  const doSwitch = async (branch: string, create: boolean) => {
    const ok = await confirm({
      title: create ? t('git.branch.create') : t('git.branch.switch'),
      message: create
        ? t('git.branch.createConfirm', { name: branch })
        : t('git.branch.switchConfirm', { name: branch }),
      confirmLabel: t('common.apply'),
      cancelLabel: t('common.cancel'),
      initialFocus: 'cancel',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await switchBranch(branch, create);
      setName('');
      showToast(t('git.branch.switched', { name: branch }), 'ok');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const v = name.trim();
    if (!v) return;
    const bad = branchNameError(v);
    if (bad) {
      showToast(t('git.error.invalidBranch'), 'err');
      return;
    }
    void doSwitch(v, true);
  };

  return (
    <div className="git-branches">
      <div className="git-new-branch">
        <input
          className="git-input"
          value={name}
          placeholder={t('git.branch.newPlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
        />
        <button className="btn btn-sm" disabled={busy || !name.trim()} onClick={create}>
          <Icon name="plus" size="sm" />
          {t('git.branch.create')}
        </button>
      </div>

      <div className="git-group-head">
        <span>{t('git.branch.local')}</span>
        <span className="git-count">{local.length}</span>
      </div>
      {local.map((b) => (
        <div className={`git-branch${b.current ? ' current' : ''}`} key={b.full}>
          <Icon name={b.current ? 'check' : 'branch'} size="sm" />
          <span className="git-branch-name" title={b.full}>
            {b.name}
          </span>
          {b.upstream ? <span className="git-branch-up">{b.upstream}</span> : null}
          {!b.current ? (
            <button
              className="git-link"
              disabled={busy}
              onClick={() => void doSwitch(b.name, false)}
            >
              {t('git.branch.switch')}
            </button>
          ) : (
            <span className="git-branch-current">{t('git.branch.current')}</span>
          )}
        </div>
      ))}

      {remote.length > 0 ? (
        <>
          <div className="git-group-head">
            <span>{t('git.branch.remote')}</span>
            <span className="git-count">{remote.length}</span>
          </div>
          {remote.map((b) => (
            <div className="git-branch remote" key={b.full}>
              <Icon name="globe" size="sm" />
              <span className="git-branch-name" title={b.full}>
                {b.name}
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

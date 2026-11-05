import { useCallback, useEffect, useRef } from 'react';
import { useT } from '../../lib/i18n';
import { showToast } from '../../lib/toast';
import { asGitError, errorKey } from '../../lib/git/errors';
import { useWorkspaceStore } from '../../store/workspace';
import { useGitStore } from '../../store/git';
import { Icon } from '../icons';
import GitEmpty from './GitEmpty';
import GitChanges from './GitChanges';
import GitDiff from './GitDiff';
import GitCommitBox from './GitCommitBox';
import GitHistory from './GitHistory';
import GitBranches from './GitBranches';
import type { GitConfirmFn } from './types';

interface Props {
  confirm: GitConfirmFn;
}

const POLL_MS = 6000;

export default function GitPanel({ confirm }: Props) {
  const t = useT();
  const root = useWorkspaceStore((s) => s.root);

  const open = useGitStore((s) => s.open);
  const width = useGitStore((s) => s.width);
  const tab = useGitStore((s) => s.tab);
  const info = useGitStore((s) => s.info);
  const status = useGitStore((s) => s.status);
  const diff = useGitStore((s) => s.diff);
  const selected = useGitStore((s) => s.selected);
  const loading = useGitStore((s) => s.loading);
  const error = useGitStore((s) => s.error);

  const setOpen = useGitStore((s) => s.setOpen);
  const setWidth = useGitStore((s) => s.setWidth);
  const setTab = useGitStore((s) => s.setTab);
  const refresh = useGitStore((s) => s.refresh);
  const selectFile = useGitStore((s) => s.selectFile);
  const clearSelection = useGitStore((s) => s.clearSelection);
  const fetchRemote = useGitStore((s) => s.fetch);
  const pull = useGitStore((s) => s.pull);
  const push = useGitStore((s) => s.push);
  const init = useGitStore((s) => s.init);

  const panelRef = useRef<HTMLElement>(null);

  // Açıkken ilk yükleme + görünürken periyodik yenileme.
  useEffect(() => {
    if (!open) return;
    void refresh(root);
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh(root);
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(root);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, root, refresh]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        setWidth(window.innerWidth - ev.clientX);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.classList.remove('git-resizing');
      };
      document.body.classList.add('git-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setWidth],
  );

  if (!open) return null;

  const fail = (e: unknown) => {
    const err = asGitError(e);
    showToast(`${t(errorKey(err.code))}: ${err.message}`, 'err');
  };

  const doFetch = async () => {
    try {
      await fetchRemote();
      showToast(t('git.fetchDone'), 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const doPull = async () => {
    const ok = await confirm({
      title: t('git.pull'),
      message: t('git.pullConfirm'),
      confirmLabel: t('git.pull'),
      cancelLabel: t('common.cancel'),
      initialFocus: 'cancel',
    });
    if (!ok) return;
    try {
      await pull();
      showToast(t('git.pullDone'), 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const doPush = async () => {
    const ok = await confirm({
      title: t('git.push'),
      message: t('git.pushConfirm'),
      confirmLabel: t('git.push'),
      cancelLabel: t('common.cancel'),
      initialFocus: 'cancel',
    });
    if (!ok) return;
    try {
      await push();
      showToast(t('git.pushDone'), 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const doInit = async () => {
    const ok = await confirm({
      title: t('git.init'),
      message: t('git.initConfirm'),
      confirmLabel: t('git.init'),
      cancelLabel: t('common.cancel'),
      initialFocus: 'cancel',
    });
    if (!ok) return;
    try {
      await init();
      showToast(t('git.initDone'), 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const canRemote = Boolean(info?.isRepo);
  const files = status?.files.length ?? 0;

  return (
    <aside
      className="git-panel"
      style={{ width }}
      aria-label={t('git.title')}
      ref={panelRef}
    >
      <div
        className="git-resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        title={t('git.resize')}
      />

      <div className="git-head">
        <div className="git-head-title">
          <Icon name="branch" size="sm" />
          <span>{t('git.title')}</span>
          {canRemote && status ? (
            <span className="git-branch-badge" title={status.upstream ?? status.branch}>
              {status.branch || 'HEAD'}
              {status.ahead > 0 ? ` ↑${status.ahead}` : ''}
              {status.behind > 0 ? ` ↓${status.behind}` : ''}
            </span>
          ) : null}
        </div>
        <div className="git-head-actions">
          <button
            className="icon-btn"
            title={t('common.refresh')}
            onClick={() => void refresh(root)}
            disabled={loading}
          >
            <Icon name="refresh" size="sm" />
          </button>
          <button className="icon-btn" title={t('git.close')} onClick={() => setOpen(false)}>
            <Icon name="x" size="sm" />
          </button>
        </div>
      </div>

      {canRemote ? (
        <div className="git-toolbar">
          <button className="btn btn-sm" onClick={() => void doFetch()} disabled={loading}>
            <Icon name="download" size="sm" /> {t('git.fetch')}
          </button>
          <button className="btn btn-sm" onClick={() => void doPull()} disabled={loading}>
            <Icon name="download" size="sm" /> {t('git.pull')}
          </button>
          <button className="btn btn-sm" onClick={() => void doPush()} disabled={loading}>
            <Icon name="upload" size="sm" /> {t('git.push')}
          </button>
        </div>
      ) : null}

      {canRemote ? (
        <div className="git-tabs" role="tablist" aria-label={t('git.title')}>
          {(
            [
              ['changes', t('git.tab.changes'), files],
              ['history', t('git.tab.history'), 0],
              ['branches', t('git.tab.branches'), 0],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`git-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {count > 0 ? <span className="git-count">{count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {error && canRemote ? (
        <div className="git-error-bar">
          <Icon name="alert-triangle" size="sm" />
          <span>{t(errorKey(error.code))}</span>
        </div>
      ) : null}

      <div className="git-body">
        {!info || !info.isRepo ? (
          <div className="git-body-scroll">
            <GitEmpty root={root} info={info} error={error} onInit={() => void doInit()} />
          </div>
        ) : (
          <>
            <div className="git-body-scroll">
              {tab === 'changes' ? (
                <>
                  <GitChanges
                    confirm={confirm}
                    onSelect={(path, staged) => {
                      if (selected?.path === path && selected.staged === staged) {
                        clearSelection();
                      } else {
                        void selectFile(path, staged).catch(fail);
                      }
                    }}
                  />
                  {selected ? <GitDiff diff={diff} loading={loading} /> : null}
                </>
              ) : null}
              {tab === 'history' ? <GitHistory /> : null}
              {tab === 'branches' ? <GitBranches confirm={confirm} /> : null}
            </div>
            {tab === 'changes' ? <GitCommitBox confirm={confirm} /> : null}
          </>
        )}
      </div>
    </aside>
  );
}

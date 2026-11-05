import { Icon } from '../icons';
import { useT } from '../../lib/i18n';
import { errorKey } from '../../lib/git/errors';
import type { GitError, GitRepoInfo } from '../../lib/git/types';

interface Props {
  root: string;
  info: GitRepoInfo | null;
  error?: GitError | null;
  onInit: () => void;
}

/**
 * Panel gövdesi için boş/hata durumları: workspace yok, git yok, repo yok,
 * üst repo'nun alt klasörü, bare repo.
 */
export default function GitEmpty({ root, info, error, onInit }: Props) {
  const t = useT();

  if (!root) {
    return (
      <div className="git-empty">
        <Icon name="folder" size="lg" />
        <p className="git-empty-title">{t('git.noWorkspace')}</p>
        <p className="git-empty-hint">{t('git.noWorkspaceHint')}</p>
      </div>
    );
  }

  if (!info) {
    if (error) {
      return (
        <div className="git-empty">
          <Icon name="alert-triangle" size="lg" />
          <p className="git-empty-title">{t(errorKey(error.code))}</p>
          <p className="git-empty-hint">{error.message}</p>
        </div>
      );
    }
    return (
      <div className="git-empty">
        <Icon name="refresh" size="lg" />
        <p className="git-empty-title">{t('common.loading')}</p>
      </div>
    );
  }

  if (!info.installed) {
    return (
      <div className="git-empty">
        <Icon name="alert-triangle" size="lg" />
        <p className="git-empty-title">{t('git.error.gitMissing')}</p>
        <p className="git-empty-hint">{t('git.gitMissingHint')}</p>
      </div>
    );
  }

  if (info.bare) {
    return (
      <div className="git-empty">
        <Icon name="alert-triangle" size="lg" />
        <p className="git-empty-title">{t('git.error.bareRepo')}</p>
      </div>
    );
  }

  if (info.outsideRepo) {
    return (
      <div className="git-empty">
        <Icon name="alert-triangle" size="lg" />
        <p className="git-empty-title">{t('git.outsideRepo')}</p>
        <p className="git-empty-hint">
          {t('git.outsideRepoHint', { path: info.repoRoot ?? '' })}
        </p>
      </div>
    );
  }

  if (!info.isRepo) {
    return (
      <div className="git-empty">
        <Icon name="branch" size="lg" />
        <p className="git-empty-title">{t('git.notRepo')}</p>
        <p className="git-empty-hint">{t('git.notRepoHint')}</p>
        <button className="btn btn-primary" onClick={onInit}>
          <Icon name="plus" size="sm" />
          {t('git.init')}
        </button>
      </div>
    );
  }

  return null;
}

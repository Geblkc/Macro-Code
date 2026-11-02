import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../../lib/i18n';
import { APP_NAME, APP_VERSION, LICENSE, PLATFORMS, REPO_URL } from '../../lib/appInfo';
import { isTauri } from '../../lib/tauri';
import { ALL_MODELS, PROVIDER_IDS } from '../../lib/providers';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  downloadPercent,
  formatBytes,
  openReleasePage,
  releasePageUrl,
  updateSupport,
  type UpdateInfo,
  type UpdateSupport,
} from '../../lib/update';
import { useSettingsStore } from '../../store/settings';
import { copyText } from '../../lib/clipboard';
import { Icon } from '../icons';
import Switch from '../Switch';
import { toast } from '../../lib/toast';

/** Veri konumları (Rust `get_app_paths` komutundan). */
interface AppPaths {
  data_dir: string;
  keys_file: string;
  sessions_db: string;
}

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'installing'; info: UpdateInfo; percent: number; downloaded: number; total: number }
  | { kind: 'error'; message: string; phase: 'check' | 'install' };

/**
 * Hakkında sekmesi — sürüm, lisans, kaynak bağlantısı, veri konumları.
 *
 * Sürüm **sabit değil**: `package.json`'dan build sırasında gömülür
 * (`lib/appInfo.ts` → `APP_VERSION`).
 */
export default function AboutTab() {
  const t = useT();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [support, setSupport] = useState<UpdateSupport | null>(null);
  const autoUpdateCheck = useSettingsStore((s) => s.autoUpdateCheck);
  const lastUpdateCheck = useSettingsStore((s) => s.lastUpdateCheck);
  const setAutoUpdateCheck = useSettingsStore((s) => s.setAutoUpdateCheck);
  const setLastUpdateCheck = useSettingsStore((s) => s.setLastUpdateCheck);
  const setIgnoredUpdateVersion = useSettingsStore((s) => s.setIgnoredUpdateVersion);

  useEffect(() => {
    let alive = true;
    void updateSupport().then((s) => {
      if (alive) setSupport(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = useCallback(async () => {
    setStatus({ kind: 'checking' });
    try {
      const info = await checkForUpdate();
      setLastUpdateCheck(Date.now());
      setIgnoredUpdateVersion('');
      setStatus(info ? { kind: 'available', info } : { kind: 'uptodate' });
    } catch (e) {
      setStatus({
        kind: 'error',
        phase: 'check',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setLastUpdateCheck, setIgnoredUpdateVersion]);

  const install = useCallback((info: UpdateInfo) => {
    setStatus({ kind: 'installing', info, percent: 0, downloaded: 0, total: 0 });
    void downloadAndInstallUpdate((p) => {
      setStatus({
        kind: 'installing',
        info,
        percent: downloadPercent(p),
        downloaded: p.downloaded,
        total: p.total,
      });
    }).catch((e: unknown) => {
      setStatus({
        kind: 'error',
        phase: 'install',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }, []);

  const openPage = useCallback(async (url?: string) => {
    try {
      await openReleasePage(url);
    } catch {
      // Durum satırını bozmadan yalnızca toast göster.
      toast.err(t('update.openFailed', { url: url || releasePageUrl() }));
    }
  }, [t]);

  const copyLink = useCallback(async (url: string) => {
    const ok = await copyText(url);
    if (ok) toast.ok(t('settings.about.copied'));
    else toast.err(t('settings.about.copyFailed'));
  }, [t]);

  // Veri konumları yalnızca Tauri'de anlamlı (tarayıcı-dev'de localStorage).
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<AppPaths>('get_app_paths')
      .then((p) => {
        if (alive) setPaths(p);
      })
      .catch(() => {
        // Konum alınamazsa sessiz geç (bölüm boş kalır).
      });
    return () => {
      alive = false;
    };
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok(t('settings.about.copied'));
    } catch {
      toast.err(t('settings.about.copyFailed'));
    }
  };

  const copyVersion = () =>
    void copy(`${APP_NAME} v${APP_VERSION} · ${LICENSE} · BYOK`);

  return (
    <div>
      <div className="sec">
        <div className="about-row">
          <img className="about-logo" src="/macrocode-logo.svg" alt="" aria-hidden="true" />
          <div>
            <div className="about-name">
              {APP_NAME} <span className="about-ver">v{APP_VERSION}</span>
            </div>
            <div className="about-sub">{t('settings.about.subtitle')}</div>
          </div>
        </div>

        <div className="row mb-2">
          <button className="btn btn-sm" onClick={copyVersion}>
            <Icon name="copy" size="sm" />
            {t('settings.about.copyVersion')}
          </button>
          {REPO_URL ? (
            <a
              className="btn btn-sm"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="branch" size="sm" />
              {t('settings.about.source')}
            </a>
          ) : null}
          <a
            className="btn btn-sm"
            href="https://www.gnu.org/licenses/old-licenses/gpl-2.0.html"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('settings.about.license')} · {LICENSE}
          </a>
        </div>

        <div className="info-grid">
          <div className="info-cell">
            <span className="info-key">{t('settings.about.version')}</span>
            <span className="info-val">{APP_VERSION}</span>
          </div>
          <div className="info-cell">
            <span className="info-key">{t('settings.about.license')}</span>
            <span className="info-val">{LICENSE}</span>
          </div>
          <div className="info-cell">
            <span className="info-key">{t('settings.about.platform')}</span>
            <span className="info-val">{PLATFORMS}</span>
          </div>
          <div className="info-cell">
            <span className="info-key">{t('settings.about.catalog')}</span>
            <span className="info-val">
              {t('settings.about.modelCount', {
                count: ALL_MODELS.length,
                providers: PROVIDER_IDS.length,
              })}
            </span>
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">{t('update.title')}</div>
        <div className="row mb-2">
          <span className="info-key">{t('update.currentVersion')}</span>
          <span className="info-val">v{APP_VERSION}</span>
          <Switch
            checked={autoUpdateCheck}
            onChange={setAutoUpdateCheck}
            label={t('update.autoCheck')}
          />
          <span className="info-val">{t('update.autoCheck')}</span>
        </div>
        <div className="field-note mb-2">{t('update.autoCheckDesc')}</div>
        <div className="field-note mb-2">
          {lastUpdateCheck > 0
            ? t('update.lastChecked', {
                date: new Date(lastUpdateCheck).toLocaleString(),
              })
            : t('update.neverChecked')}
        </div>

        <div className="row mb-2">
          <button
            className="btn btn-sm"
            onClick={() => void check()}
            disabled={status.kind === 'checking' || status.kind === 'installing'}
          >
            <Icon name="refresh" size="sm" />
            {status.kind === 'checking' ? t('update.checkingShort') : t('update.checkNow')}
          </button>
          <button className="btn btn-sm" onClick={() => void openPage()}>
            <Icon name="branch" size="sm" />
            {t('update.manualInstall')}
          </button>
        </div>

        {status.kind === 'uptodate' ? (
          <div className="field-note">{t('update.upToDate', { current: APP_VERSION })}</div>
        ) : null}

        {status.kind === 'available' ? (
          <div className="mb-2">
            <div className="info-val">
              {t('update.available', {
                version: status.info.version,
                current: status.info.currentVersion,
              })}
            </div>
            {status.info.date ? (
              <div className="field-note">
                {t('update.releasedAt', { date: status.info.date })}
              </div>
            ) : null}
            {support && !support.supported ? (
              <div className="field-note mb-2">
                {t('update.unsupported', { kind: support.kind })}
              </div>
            ) : null}
            <div className="row">
              {support?.supported ? (
                <button className="btn btn-sm" onClick={() => install(status.info)}>
                  <Icon name="download" size="sm" />
                  {t('update.installNow')}
                </button>
              ) : null}
              <button
                className="btn btn-sm"
                onClick={() => void openPage(status.info.url)}
              >
                <Icon name="branch" size="sm" />
                {t('update.manualInstall')}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => void copyLink(status.info.url)}
              >
                <Icon name="copy" size="sm" />
                {t('update.copyLink')}
              </button>
            </div>
          </div>
        ) : null}

        {status.kind === 'installing' ? (
          <div className="field-note">
            {status.percent >= 0
              ? t('update.downloadProgress', {
                  percent: status.percent,
                  downloaded: formatBytes(status.downloaded),
                  total: formatBytes(status.total),
                })
              : t('update.downloadProgressUnknown', {
                  downloaded: formatBytes(status.downloaded),
                })}
          </div>
        ) : null}

        {status.kind === 'error' ? (
          <div className="field-note">
            {status.phase === 'install'
              ? t('update.installFailed', { message: status.message })
              : t('update.checkFailed', { message: status.message })}
          </div>
        ) : null}
      </div>

      <div className="sec">
        <div className="sec-title">{t('settings.about.dataTitle')}</div>
        <div className="field-note mb-2">{t('settings.about.privacy')}</div>
        {paths ? (
          <div className="path-list">
            <div className="path-row">
              <span className="info-key">{t('settings.about.keysFile')}</span>
              <code className="path-val">{paths.keys_file}</code>
              <button
                className="mini-btn"
                onClick={() => void copy(paths.keys_file)}
                title={t('settings.about.copyPath')}
              >
                <Icon name="copy" size="sm" />
              </button>
            </div>
            <div className="path-row">
              <span className="info-key">{t('settings.about.sessionsFile')}</span>
              <code className="path-val">{paths.sessions_db}</code>
              <button
                className="mini-btn"
                onClick={() => void copy(paths.sessions_db)}
                title={t('settings.about.copyPath')}
              >
                <Icon name="copy" size="sm" />
              </button>
            </div>
          </div>
        ) : (
          <div className="field-note">{t('settings.about.dataFiles')}</div>
        )}
      </div>
    </div>
  );
}

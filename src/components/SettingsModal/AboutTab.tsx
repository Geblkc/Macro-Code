import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useT } from '../../lib/i18n';
import { APP_NAME, APP_VERSION, LICENSE, PLATFORMS, REPO_URL } from '../../lib/appInfo';
import { isTauri } from '../../lib/tauri';
import { ALL_MODELS, PROVIDER_IDS } from '../../lib/providers';
import { Icon } from '../icons';
import { toast } from '../../lib/toast';

/** Veri konumları (Rust `get_app_paths` komutundan). */
interface AppPaths {
  data_dir: string;
  keys_file: string;
  sessions_db: string;
}

/**
 * Hakkında sekmesi — sürüm, lisans, kaynak bağlantısı, veri konumları.
 *
 * Sürüm **sabit değil**: `package.json`'dan build sırasında gömülür
 * (`lib/appInfo.ts` → `APP_VERSION`).
 */
export default function AboutTab() {
  const t = useT();
  const [paths, setPaths] = useState<AppPaths | null>(null);

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
            href="https://opensource.org/licenses/MIT"
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

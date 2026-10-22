import { LOCALES, LOCALE_META } from '../../lib/i18n/types';
import { useT } from '../../lib/i18n';
import Switch from '../Switch';
import type { Draft } from './types';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}

/**
 * Görünüm & Dil ayarları.
 *
 * Önceden iki sekmede dağınık duruyordu (ChatTab "Görünüm" + LangTab):
 * yüksek kontrast ve saat biçimi **iki yerde** tanımlıydı. Artık tek yerde.
 */
export default function AppearanceTab({ draft, patch }: Props) {
  const t = useT();
  return (
    <div>
      <div className="sec">
        <div className="sec-title">{t('settings.appearance.viewSection')}</div>

        <div className="field">
          <label className="field-label">{t('settings.appearance.fontSize', { size: draft.fontSize })}</label>
          <input
            className="slider"
            type="range"
            min={11}
            max={20}
            value={draft.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
          />
          <div className="slider-scale">
            <span>11px</span>
            <span>20px</span>
          </div>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.contrast === 'high'}
            onChange={(v) => patch({ contrast: v ? 'high' : 'normal' })}
            label={t('settings.appearance.highContrast')}
          />
          <span>{t('settings.appearance.highContrastNote')}</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.uiFont === 'inter'}
            onChange={(v) => patch({ uiFont: v ? 'inter' : 'mono' })}
            label={t('settings.appearance.uiFont')}
          />
          <span>
            {t('settings.appearance.uiFontValue', {
              font: draft.uiFont === 'inter' ? 'Inter' : 'JetBrains Mono',
            })}
          </span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.clockFormat === '12h'}
            onChange={(v) => patch({ clockFormat: v ? '12h' : '24h' })}
            label={t('settings.appearance.clockFormat')}
          />
          <span>
            {t('settings.appearance.clockFormatValue', {
              format: draft.clockFormat === '12h' ? t('settings.appearance.clock12') : t('settings.appearance.clock24'),
            })}
          </span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.showTimestamps}
            onChange={(v) => patch({ showTimestamps: v })}
            label={t('settings.appearance.timestamps')}
          />
          <span>{t('settings.appearance.timestampsNote')}</span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">{t('settings.appearance.langSection')}</div>

        <div className="field">
          <label className="field-label">{t('settings.appearance.interface')}</label>
          <select
            className="input"
            value={draft.language}
            onChange={(e) => patch({ language: e.target.value as Draft['language'] })}
          >
            <option value="auto">{t('settings.appearance.system')}</option>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_META[l].label}
              </option>
            ))}
          </select>
          <span className="field-note">{t('settings.appearance.interfaceNote')}</span>
        </div>

        <div className="field">
          <label className="field-label">{t('settings.appearance.numberFormat')}</label>
          <span className="field-note">{t('settings.appearance.numberFormatNote')}</span>
        </div>
      </div>
    </div>
  );
}

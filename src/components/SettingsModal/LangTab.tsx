import Switch from '../Switch';
import type { Draft } from './types';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}

/** Dil ve bölge ayarları. */
export default function LangTab({ draft, patch }: Props) {
  return (
    <div>
      <div className="sec">
        <div className="sec-title">Dil</div>

        <div className="field">
          <label className="field-label">Arayüz dili</label>
          <select className="input" value="tr" disabled onChange={() => {}}>
            <option value="tr">Türkçe</option>
          </select>
          <span className="field-note">
            İngilizce arayüz çeviri dosyaları hazırlandığında eklenecek. Şu an yalnızca Türkçe.
          </span>
        </div>

        <div className="field">
          <label className="field-label">Saat biçimi</label>
          <div className="row">
            <button
              className={`btn btn-sm${draft.clockFormat === '24h' ? ' btn-primary' : ''}`}
              style={{ flex: 1 }}
              onClick={() => patch({ clockFormat: '24h' })}
            >
              24 saat
            </button>
            <button
              className={`btn btn-sm${draft.clockFormat === '12h' ? ' btn-primary' : ''}`}
              style={{ flex: 1 }}
              onClick={() => patch({ clockFormat: '12h' })}
            >
              12 saat
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field-label">Sayı biçimi</label>
          <div className="row">
            <button className="btn btn-sm" style={{ flex: 1 }} disabled>
              1.234,56
            </button>
            <button className="btn btn-sm" style={{ flex: 1 }} disabled>
              1,234.56
            </button>
          </div>
          <span className="field-note">
            Sayı biçimi şu an tarayıcı yerel ayarından gelir; elle seçim yakında.
          </span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">Erişilebilirlik</div>

        <div className="checkrow">
          <Switch
            checked={draft.contrast === 'high'}
            onChange={(v) => patch({ contrast: v ? 'high' : 'normal' })}
            label="Yüksek kontrast"
          />
          <span>Yüksek kontrast modu</span>
        </div>
        <span className="field-note">
          Sistem “yüksek kontrast” tercihini de destekler; açık seçim onu geçersiz kılar.
        </span>
      </div>
    </div>
  );
}

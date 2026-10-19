export const APP_VERSION = '0.1.0';
const GITHUB_URL = '';

/** Hakkında sekmesi. */
export default function AboutTab() {
  const copyVersion = () => {
    const text = `MacroCode v${APP_VERSION} · MIT · BYOK`;
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div>
      <div className="sec">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <svg
            style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }}
            viewBox="0 0 512 512"
            aria-hidden="true"
          >
            <rect width="512" height="512" rx="112" fill="#000" />
            <g
              transform="translate(-4,-14)"
              fill="none"
              stroke="#00E676"
              strokeWidth="36"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M90 335 V205 M90 250 C90 220 115 205 138 205 C163 205 185 220 185 250 V335 M185 250 C185 220 208 205 232 205 C257 205 280 220 280 250 V335" />
              <path d="M430 165 L340 270 L430 375" />
            </g>
          </svg>
          <div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: 600 }}>
              MacroCode <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>v{APP_VERSION}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              MIT lisansı · BYOK · Windows / macOS / Linux
            </div>
          </div>
        </div>

        <div className="row">
          <button className="btn btn-sm" onClick={copyVersion}>
            Sürüm bilgisini kopyala
          </button>
          {GITHUB_URL ? (
            <a className="btn btn-sm" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
          ) : null}
          <button className="btn btn-sm" disabled title="otomatik güncelleme henüz yok">
            Güncelleme yok
          </button>
        </div>
        <span className="field-note" style={{ marginTop: 10 }}>
          Otomatik güncelleme altyapısı kurulmadı; sürümler elle dağıtılır.
        </span>
      </div>

      <div className="sec">
        <div className="sec-title">Gizlilik</div>
        <span className="field-note">
          API anahtarları cihazında saklanır (keys.json) ve asla dışarı gönderilmez. Oturumlar
          yerel SQLite veritabanında tutulur. Ağ trafiği yalnızca seçtiğiniz sağlayıcıya gider.
        </span>
      </div>
    </div>
  );
}

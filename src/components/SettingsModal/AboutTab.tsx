export const APP_VERSION = '0.1.0';
const GITHUB_URL = '';

/** Görsel Hakkında sekmesi (gerçek updater Faz 4 sonrası ayrı iş). */
export default function AboutTab() {
  return (
    <div>
      <div className="modal-section-title">Güncelleme ve hakkında</div>
      <div className="field-note" style={{ marginBottom: 8 }}>
        MacroCode v{APP_VERSION} · MIT lisansı
      </div>
      <span className="field-row">
        <button className="mini-btn" disabled title="otomatik güncelleme henüz yok">
          şimdi kontrol et
        </button>
        {GITHUB_URL ? (
          <a className="mini-btn" href={GITHUB_URL}>
            GitHub
          </a>
        ) : null}
      </span>
      <div className="field-note" style={{ marginTop: 8 }}>
        Otomatik güncelleme, kanal seçimi ve hata bildirme bağlantıları daha sonra eklenecek.
      </div>
    </div>
  );
}

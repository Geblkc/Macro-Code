/** Faz 4 yer tutucu: arayüz dili + tarih/sayı biçimi. */
export default function LangTab() {
  return (
    <div>
      <div className="modal-section-title">Dil ve bölge</div>
      <label className="field">
        <span className="field-label">Arayüz dili</span>
        <select className="field-input" value="tr" disabled onChange={() => {}}>
          <option value="tr">Türkçe</option>
        </select>
      </label>
      <div className="field-note">
        İngilizce arayüz ve tarih/sayı biçimi Faz 4&apos;te. Şimdilik yalnızca Türkçe.
      </div>
    </div>
  );
}

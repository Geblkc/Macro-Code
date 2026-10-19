import { useMemo } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS, resolveModels, visibleModels } from '../../lib/providers';
import type { ApiKeys, Provider } from '../../types';
import type { Draft } from './types';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}

const EMPTY_KEYS: ApiKeys = {
  anthropic: '',
  openai: '',
  gemini: '',
  ollamaUrl: '',
  openrouter: '',
  deepseek: '',
  xai: '',
};

/** Faz 1: mevcut davranış kontrolleri + Faz 2: özetleyici model (profiller Faz 3). */
export default function ChatTab({ draft, patch }: Props) {
  const all = resolveModels(draft.customModels);
  // API anahtarı olmayan sağlayıcının modelleri listelenmez.
  const keyed = useMemo(() => {
    const keys = { ...EMPTY_KEYS } as ApiKeys;
    for (const p of PROVIDER_IDS) {
      if (p === 'ollama') continue;
      const sec = draft.secrets[p];
      keys[p] = sec && !sec.deleted ? sec.value.trim() || sec.hint : '';
    }
    return keys;
  }, [draft.secrets]);
  const visible = useMemo(() => visibleModels(all, keyed), [all, keyed]);
  const summarizerKnown =
    !draft.summarizerModel || all.some((m) => m.id === draft.summarizerModel);
  return (
    <div>
      <div className="modal-section-title">Sohbet davranışı</div>
      <label className="field">
        <span className="field-label">System prompt</span>
        <textarea
          className="field-input field-area"
          value={draft.systemPrompt}
          spellCheck={false}
          rows={3}
          placeholder="örn: Türkçe, kısa ve net cevap ver"
          onChange={(e) => patch({ systemPrompt: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">Yazı boyutu ({draft.fontSize}px)</span>
        <input
          type="range"
          min={10}
          max={20}
          value={draft.fontSize}
          onChange={(e) => patch({ fontSize: Number(e.target.value) })}
        />
      </label>
      <label className="field-row">
        <input
          type="checkbox"
          checked={draft.showThinking}
          onChange={(e) => patch({ showThinking: e.target.checked })}
        />
        <span className="field-label" style={{ margin: 0 }}>
          Düşünme (reasoning) bloğunu göster
        </span>
      </label>
      <label className="field-row">
        <input
          type="checkbox"
          checked={draft.cachePrompts}
          onChange={(e) => patch({ cachePrompts: e.target.checked })}
        />
        <span className="field-label" style={{ margin: 0 }}>
          Prompt önbelleği (token maliyetini düşürür · sağlayıcı tarafında saklanır)
        </span>
      </label>
      <label className="field">
        <span className="field-label">Ek shell komutları (satır başına bir, örn: docker ps)</span>
        <textarea
          className="field-input field-area"
          value={draft.customAllowList.join('\n')}
          spellCheck={false}
          rows={2}
          placeholder={'docker ps\nhtop'}
          onChange={(e) => patch({ customAllowList: e.target.value.split('\n') })}
        />
      </label>
      <label className="field-row">
        <input
          type="checkbox"
          checked={draft.auditEnabled}
          onChange={(e) => patch({ auditEnabled: e.target.checked })}
        />
        <span className="field-label" style={{ margin: 0 }}>Denetim kaydını tut</span>
      </label>
      <div className="modal-section-title">Özetleyici model (compaction)</div>
      <label className="field">
        <span className="field-label">Sağlayıcı (boş = aktif)</span>
        <select
          className="field-input"
          value={draft.summarizerProvider}
          onChange={(e) => patch({ summarizerProvider: e.target.value as Provider | '' })}
        >
          <option value="">aktif modeli kullan</option>
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Model (boş = aktif)</span>
        <select
          className="field-input"
          value={draft.summarizerModel}
          onChange={(e) => patch({ summarizerModel: e.target.value })}
        >
          <option value="">aktif modeli kullan</option>
          {!summarizerKnown && (
            <option value={draft.summarizerModel}>{draft.summarizerModel} (özel)</option>
          )}
          {PROVIDER_IDS.map((p) => {
            const models = visible.filter((m) => m.provider === p);
            if (models.length === 0) return null;
            return (
              <optgroup key={p} label={PROVIDER_DEFS[p]?.label ?? p}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      <div className="field-note">
        Boş bırakılırsa özetlemede aktif model kullanılır. Ucuz bir model seçmek maliyeti düşürür.
      </div>
      <div className="field-note">
        Hazır profiller ve gönderme tuşu Faz 3&apos;te.
      </div>
    </div>
  );
}

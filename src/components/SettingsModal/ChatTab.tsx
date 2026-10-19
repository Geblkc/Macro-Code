import { useMemo } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS, resolveModels, visibleModels } from '../../lib/providers';
import type { ApiKeys, Provider } from '../../types';
import Switch from '../Switch';
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

/** Sohbet davranışı + görünüm ayarları. */
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
      <div className="sec">
        <div className="sec-title">Görünüm</div>

        <div className="field">
          <label className="field-label">Yazı boyutu — {draft.fontSize}px</label>
          <input
            className="slider"
            type="range"
            min={11}
            max={20}
            value={draft.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
          />
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.contrast === 'high'}
            onChange={(v) => patch({ contrast: v ? 'high' : 'normal' })}
            label="Yüksek kontrast"
          />
          <span>Yüksek kontrast modu</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.uiFont === 'inter'}
            onChange={(v) => patch({ uiFont: v ? 'inter' : 'mono' })}
            label="Arayüz fontu"
          />
          <span>Arayüz fontu: {draft.uiFont === 'inter' ? 'Inter' : 'JetBrains Mono'}</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.clockFormat === '12h'}
            onChange={(v) => patch({ clockFormat: v ? '12h' : '24h' })}
            label="12 saat biçimi"
          />
          <span>Saat biçimi: {draft.clockFormat === '12h' ? '12 saat' : '24 saat'}</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.showThinking}
            onChange={(v) => patch({ showThinking: v })}
            label="Düşünme bloğu"
          />
          <span>Düşünme (reasoning) bloğunu göster</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.cachePrompts}
            onChange={(v) => patch({ cachePrompts: v })}
            label="Prompt önbelleği"
          />
          <span>Prompt önbelleği (token maliyetini düşürür · sağlayıcı tarafında saklanır)</span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">Sohbet davranışı</div>

        <div className="field">
          <label className="field-label">System prompt</label>
          <textarea
            className="input input-area-lg"
            value={draft.systemPrompt}
            spellCheck={false}
            rows={3}
            placeholder="örn: Türkçe, kısa ve net cevap ver"
            onChange={(e) => patch({ systemPrompt: e.target.value })}
          />
        </div>

        <div className="field">
          <label className="field-label">Özetleyici model — sağlayıcı</label>
          <select
            className="input"
            value={draft.summarizerProvider}
            onChange={(e) => patch({ summarizerProvider: e.target.value as Provider | '' })}
          >
            <option value="">aktif modeli kullan</option>
            {PROVIDER_IDS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_DEFS[p]?.label ?? p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">Özetleyici model — model</label>
          <select
            className="input"
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
          <span className="field-note">
            Boş bırakılırsa özetlemede aktif model kullanılır. Ucuz bir model seçmek maliyeti düşürür.
          </span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">Araçlar</div>

        <div className="field">
          <label className="field-label">Ek shell komutları (satır başına bir, örn: docker ps)</label>
          <textarea
            className="input input-area-md"
            value={draft.customAllowList.join('\n')}
            spellCheck={false}
            rows={2}
            placeholder={'docker ps\nhtop'}
            onChange={(e) => patch({ customAllowList: e.target.value.split('\n') })}
          />
          <span className="field-note">
            Bu komutlar onay ekranındaki “her zaman çalıştır” kutusuyla otomatik eklenir.
          </span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.auditEnabled}
            onChange={(v) => patch({ auditEnabled: v })}
            label="Denetim kaydı"
          />
          <span>Denetim kaydını tut</span>
        </div>
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { PROVIDER_DEFS, PROVIDER_IDS } from '../../lib/providers';
import { useT } from '../../lib/i18n';
import type { Provider } from '../../types';
import Switch from '../Switch';
import type { Draft } from './types';
import { modelView } from './modelList';
import { allowListIssues } from './types';

interface Props {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}

/**
 * Sohbet davranışı: system prompt, özetleyici model, düşünme bloğu,
 * prompt önbelleği, shell allowlist ve denetim kaydı.
 *
 * Görünüm ayarları (yazı boyutu, kontrast, saat) `AppearanceTab`'e taşındı —
 * önceden burada ve `LangTab`'da **iki kez** tanımlıydı.
 */
export default function ChatTab({ draft, patch }: Props) {
  const t = useT();
  // API anahtarı olmayan sağlayıcının modelleri listelenmez.
  const view = useMemo(() => modelView(draft), [draft]);
  const summarizerKnown = !draft.summarizerModel || view.all.some((m) => m.id === draft.summarizerModel);
  // Geçersiz allowlist satırları motor tarafında yok sayılır — kullanıcıya bildir.
  const badAllowLines = useMemo(
    () => allowListIssues(draft.customAllowList),
    [draft.customAllowList],
  );

  return (
    <div>
      <div className="sec">
        <div className="sec-title">{t('settings.chat.behaviorSection')}</div>

        <div className="field">
          <label className="field-label">{t('settings.chat.systemPrompt')}</label>
          <textarea
            className="input input-area-lg"
            value={draft.systemPrompt}
            spellCheck={false}
            rows={3}
            placeholder={t('settings.chat.systemPromptPlaceholder')}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
          />
          <div className="field-row mt-1">
            <span className="status-dim">
              {t('settings.chat.systemPromptCount', { count: draft.systemPrompt.length })}
            </span>
            <span className="sp" />
            <button
              className="mini-btn"
              disabled={!draft.systemPrompt}
              onClick={() => patch({ systemPrompt: '' })}
            >
              {t('settings.chat.systemPromptReset')}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field-label">{t('settings.chat.summarizerProvider')}</label>
          <select
            className="input"
            value={draft.summarizerProvider}
            onChange={(e) => patch({ summarizerProvider: e.target.value as Provider | '' })}
          >
            <option value="">{t('settings.chat.useActiveModel')}</option>
            {PROVIDER_IDS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_DEFS[p]?.label ?? p}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">{t('settings.chat.summarizerModel')}</label>
          <select
            className="input"
            value={draft.summarizerModel}
            onChange={(e) => patch({ summarizerModel: e.target.value })}
          >
            <option value="">{t('settings.chat.useActiveModel')}</option>
            {!summarizerKnown && (
              <option value={draft.summarizerModel}>
                {t('settings.chat.customModel', { model: draft.summarizerModel })}
              </option>
            )}
            {PROVIDER_IDS.map((p) => {
              const models = view.visible.filter((m) => m.provider === p);
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
          <span className="field-note">{t('settings.chat.summarizerNote')}</span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">{t('settings.chat.answerSection')}</div>

        <div className="checkrow">
          <Switch
            checked={draft.showThinking}
            onChange={(v) => patch({ showThinking: v })}
            label={t('settings.chat.thinkingBlock')}
          />
          <span>{t('settings.chat.thinkingBlockNote')}</span>
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.cachePrompts}
            onChange={(v) => patch({ cachePrompts: v })}
            label={t('settings.chat.cachePrompts')}
          />
          <span>{t('settings.chat.cachePromptsNote')}</span>
        </div>
      </div>

      <div className="sec">
        <div className="sec-title">{t('settings.chat.toolsSection')}</div>

        <div className="field">
          <label className="field-label">{t('settings.chat.allowList')}</label>
          <textarea
            className="input input-area-md"
            value={draft.customAllowList.join('\n')}
            spellCheck={false}
            rows={2}
            placeholder={'docker ps\nhtop'}
            onChange={(e) => patch({ customAllowList: e.target.value.split('\n') })}
          />
          <span className="field-note">{t('settings.chat.allowListNote')}</span>
          {badAllowLines.length > 0 ? (
            <div className="form-err">
              {t('settings.chat.allowListInvalid', {
                count: badAllowLines.length,
                lines: badAllowLines.slice(0, 3).join(', '),
              })}
            </div>
          ) : null}
        </div>

        <div className="checkrow">
          <Switch
            checked={draft.auditEnabled}
            onChange={(v) => patch({ auditEnabled: v })}
            label={t('settings.chat.audit')}
          />
          <span>{t('settings.chat.auditNote')}</span>
        </div>
      </div>
    </div>
  );
}

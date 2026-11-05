/**
 * AI commit mesajı üretimi — aktif sohbet sağlayıcısını kullanır.
 *
 * Çağrı YALNIZCA kullanıcı onayından sonra yapılır (panel onay diyaloğu).
 * Diff, `policy.filterDiffForAi` ile secret dosyalardan arındırılıp kısaltılır;
 * üretilen mesaj commit kutusuna yazılır, **otomatik commit yapılmaz**.
 */
import { getProvider, getProviderForModel, resolveModels } from '../providers';
import { DEFAULT_OLLAMA_URL } from '../providers/ollama';
import { withRetry } from '../providers/common';
import { providerNeedsKey, useSettingsStore } from '../../store/settings';
import { t } from '../i18n/core';
import { COMMIT_SYSTEM_PROMPT, normalizeCommitMessage } from './commitMessage';

/** Sağlayıcıya gönderilecek prompt'tan commit mesajı üretir. */
export async function generateCommitMessage(prompt: string): Promise<string> {
  const s = useSettingsStore.getState();
  const model = s.currentModel;
  const provider =
    getProviderForModel(model, s.customModels) ?? s.currentProvider;
  const apiKey =
    provider === 'ollama'
      ? s.apiKeys.ollamaUrl || DEFAULT_OLLAMA_URL
      : (s.apiKeys[provider] ?? '');

  if (providerNeedsKey(provider) && !apiKey.trim()) {
    throw new Error(t('git.ai.noKey', { provider }));
  }

  const override = s.baseUrlOverride[provider]?.trim();
  let out = '';
  await withRetry(
    () =>
      getProvider(provider).stream({
        apiKey,
        model,
        systemPrompt: COMMIT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        onChunk: (c) => {
          if (c.text) out += c.text;
        },
        ...(override ? { baseUrl: override } : {}),
        registry: resolveModels(s.customModels),
      }),
    { retries: 1 },
  );

  const msg = normalizeCommitMessage(out);
  if (!msg) throw new Error(t('git.ai.empty'));
  return msg;
}

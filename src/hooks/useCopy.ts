import { useCallback } from 'react';
import { copyText } from '../lib/clipboard';
import { toast } from '../lib/toast';
import { useT } from '../lib/i18n';

/**
 * Panoya kopyalama + toast geri bildirimi (`message.copyOk` / `message.copyFail`).
 * Terminal satırı ve /copy komutu ortak kullanır.
 */
export function useCopy(): (text: string) => Promise<void> {
  const t = useT();
  return useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) toast.ok(t('message.copyOk'));
      else toast.err(t('message.copyFail'));
    },
    [t],
  );
}

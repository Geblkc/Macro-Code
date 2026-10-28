/**
 * Panoya kopyalama — tek kaynak (clipboard API + textarea fallback).
 *
 * Sıfır bağımlılık; React dışı modüllerden de çağrılabilir.
 * Dönen değer: `true` = kopyalandı, `false` = tarayıcı/WebView engelledi.
 */
export function copyText(text: string): Promise<boolean> {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    const clipboard = nav?.clipboard;
    if (clipboard?.writeText) {
      return clipboard.writeText(text).then(
        () => true,
        () => false,
      );
    }
  } catch {
    // Asagidaki fallback'e dus.
  }
  try {
    const doc = globalThis.document;
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

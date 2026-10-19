/** Tauri runtime kontrolü — tek tanım, her yerden buradan import edilir. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

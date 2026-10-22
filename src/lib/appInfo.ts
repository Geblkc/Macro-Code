/**
 * Uygulama kimliği — **tek kaynak `package.json`**.
 *
 * `vite.config.ts` build sırasında `__APP_VERSION__` / `__REPO_URL__`
 * sabitlerini gömülür (bkz. `src/vite-env.d.ts`). Böylece sürüm üç yerde
 * (package.json · tauri.conf.json · About sekmesi) elle güncellenmez.
 */

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';

/** Kaynak kod bağlantısı (yoksa boş string — link gösterilmez). */
export const REPO_URL: string = typeof __REPO_URL__ === 'string' ? __REPO_URL__ : '';

/** Lisans metni. */
export const LICENSE = 'MIT';

/** Desteklenen platformlar (About sekmesi). */
export const PLATFORMS = 'Windows / macOS / Linux';

/** Paket adı. */
export const APP_NAME = 'MacroCode';

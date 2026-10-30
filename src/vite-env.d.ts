/// <reference types="vite/client" />

/**
 * Build sırasında gömülen sabitler (bkz. `vite.config.ts` → `define`).
 *
 * Tek kaynak `package.json`'dır — uygulama içinde sürüm sabiti yazılmaz.
 */

/** `package.json` → `version` (ör. "0.2.1"). */
declare const __APP_VERSION__: string;

/** `package.json` → `repository.url` veya `homepage` (yoksa boş string). */
declare const __REPO_URL__: string;

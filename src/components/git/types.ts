import type { GitConfirmRequest } from '../../lib/git/commands';

/** App kökündeki tek ConfirmDialog'u kullanan onay köprüsü. */
export type GitConfirmFn = (req: GitConfirmRequest) => Promise<boolean>;

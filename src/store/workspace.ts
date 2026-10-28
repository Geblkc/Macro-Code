import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ApprovalMode } from '../lib/engine/types';
import { labelOfRoot } from '../lib/workspace';

interface WorkspaceStore {
  root: string;
  label: string;
  approvalMode: ApprovalMode;
  /** Son kullanılan klasörler (en yeni başta, max RECENT_MAX; secret içermez). */
  recent: WorkspaceRecentEntry[];
  setWorkspace: (root: string, label: string) => void;
  clearWorkspace: () => void;
  setApprovalMode: (m: ApprovalMode) => void;
  /** Recents'ten tek öğe siler ("kaldır" satırı). */
  removeRecent: (root: string) => void;
  removeRecentAll: () => void;
}

/** Recents kaydı — yalnızca yol + görünen ad; anahtar/secret taşımaz. */
export type WorkspaceRecentEntry = { root: string; label: string };

/** Recents tavanı — Titlebar dropdown'unda hep 5 öğe gösterilir. */
export const RECENT_MAX = 5;

/** Recents saf güncelleme: aynı root başa taşınır, tavan kırpılır. */
export function pushRecent(
  list: WorkspaceRecentEntry[],
  root: string,
): WorkspaceRecentEntry[] {
  const rest = list.filter((e) => e.root !== root);
  return [{ root, label: labelOfRoot(root) }, ...rest].slice(0, RECENT_MAX);
}

const noopStorage = {
  getItem: (_name: string): string | null => null,
  setItem: (_name: string, _value: string): void => {},
  removeItem: (_name: string): void => {},
};

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      root: '',
      label: '',
      approvalMode: 'manual',
      recent: [],
      setWorkspace: (root, label) =>
        set((s) => ({ root, label, recent: pushRecent(s.recent ?? [], root) })),
      clearWorkspace: () => set({ root: '', label: '' }),
      setApprovalMode: (approvalMode) => set({ approvalMode }),
      removeRecent: (root) =>
        set((s) => ({ recent: (s.recent ?? []).filter((e) => e.root !== root) })),
      removeRecentAll: () => set({ recent: [] }),
    }),
    {
      name: 'macrocode-workspace',
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
    },
  ),
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ApprovalMode } from '../lib/engine/types';

interface WorkspaceStore {
  root: string;
  label: string;
  approvalMode: ApprovalMode;
  setWorkspace: (root: string, label: string) => void;
  clearWorkspace: () => void;
  setApprovalMode: (m: ApprovalMode) => void;
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
      setWorkspace: (root, label) => set({ root, label }),
      clearWorkspace: () => set({ root: '', label: '' }),
      setApprovalMode: (approvalMode) => set({ approvalMode }),
    }),
    {
      name: 'macrocode-workspace',
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
    },
  ),
);

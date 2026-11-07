import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getUsageEventsWithFilters, aggregateTimeSeries, computeMetrics, generateHeatmapData } from '../lib/stats';

export interface StatsStore {
  budgetLimit: number;
  setBudgetLimit: (limit: number) => void;
  
  filters: {
    startDate?: Date;
    endDate?: Date;
    project?: string;
    model?: string;
    provider?: string;
  };
  setFilters: (filters: Partial<StatsStore['filters']>) => void;
  
  metrics: ReturnType<typeof computeMetrics> | null;
  timeSeries: ReturnType<typeof aggregateTimeSeries> | null;
  heatmap: ReturnType<typeof generateHeatmapData> | null;
  loading: boolean;
  
  loadStats: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

export const useStatsStore = create<StatsStore>()(
  persist(
    (set, get) => ({
      budgetLimit: 0,
      setBudgetLimit: (limit: number) => set({ budgetLimit: limit }),
      
      filters: {},
      setFilters: (filters) => set((state) => ({
        filters: { ...state.filters, ...filters },
      })),
      
      metrics: null,
      timeSeries: null,
      heatmap: null,
      loading: false,
      
      loadStats: async () => {
        set({ loading: true });
        try {
          const { filters } = get();
          const events = await getUsageEventsWithFilters({
            startDate: filters.startDate,
            endDate: filters.endDate,
            project: filters.project,
            model: filters.model,
            provider: filters.provider,
          });
          
          const metrics = computeMetrics(events);
          const timeSeries = aggregateTimeSeries(events);
          const heatmap = generateHeatmapData(events);
          
          set({ metrics, timeSeries, heatmap, loading: false });
        } catch (error) {
          console.error('Failed to load stats:', error);
          set({ loading: false });
        }
      },
      
      refreshStats: () => get().loadStats(),
    }),
    {
      name: 'macrocode-stats',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        budgetLimit: s.budgetLimit,
        filters: s.filters,
      }),
    },
  ),
);
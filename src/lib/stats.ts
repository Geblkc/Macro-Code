import type { UsageEvent } from '../types';
import { readUsageEvents } from './db';

/** Get usage events filtered by criteria */
export const getUsageEventsWithFilters = async ({ 
  startDate, 
  endDate, 
  project, 
  model, 
  provider 
}: {
  startDate?: Date;
  endDate?: Date;
  project?: string;
  model?: string;
  provider?: string;
}): Promise<UsageEvent[]> => {
  const allEvents = await readUsageEvents();
  let filteredEvents = allEvents;

  if (startDate) {
    filteredEvents = filteredEvents.filter(e => e.ts >= startDate.getTime());
  }
  if (endDate) {
    filteredEvents = filteredEvents.filter(e => e.ts <= endDate.getTime());
  }
  if (project) {
    filteredEvents = filteredEvents.filter(e => e.project === project);
  }
  if (model) {
    filteredEvents = filteredEvents.filter(e => e.model === model);
  }
  if (provider) {
    filteredEvents = filteredEvents.filter(e => e.provider === provider);
  }

  return filteredEvents;
};

/** Aggregate time series data for graphing */
export const aggregateTimeSeries = (events: UsageEvent[]) => {
  const grouped = events.reduce((acc, event) => {
    const date = new Date(event.ts);
    const day = date.toISOString().split('T')[0];
    const hour = date.getHours();
    const key = `${day} ${hour}`;
    if (!acc[key]) {
      acc[key] = {
        timestamp: event.ts,
        cost: 0,
        tokens: 0,
        requests: 0,
      };
    }
    acc[key].cost += event.costUsd;
    acc[key].tokens += event.inputTokens + event.outputTokens;
    acc[key].requests += 1;
    return acc;
  }, {} as Record<string, {
    timestamp: number;
    cost: number;
    tokens: number;
    requests: number;
  }>);

  return Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);
};

/** Calculate cache savings (difference between raw and cached tokens) */
export const calculateCacheSavings = (events: UsageEvent[]) => {
  return events.reduce((sum, event) => sum + event.cacheReadTokens + event.cacheWriteTokens, 0);
};

export interface UsageBucket {
  cost: number;
  tokens: number;
  requests: number;
}

/** Model bazlı kırılım (stats ekranındaki "Model Bazlı" bölümü). */
export const aggregateByModel = (events: UsageEvent[]): Record<string, UsageBucket> => {
  const grouped: Record<string, UsageBucket> = {};
  for (const event of events) {
    const key = event.model || 'unknown';
    const bucket = grouped[key] ?? { cost: 0, tokens: 0, requests: 0 };
    bucket.cost += event.costUsd;
    bucket.tokens += event.inputTokens + event.outputTokens;
    bucket.requests += 1;
    grouped[key] = bucket;
  }
  return grouped;
};

/** Compute KPI metrics from events */
export const computeMetrics = (events: UsageEvent[]) => {
  const totalCost = events.reduce((sum, event) => sum + event.costUsd, 0);
  const totalTokens = events.reduce((sum, event) => sum + event.inputTokens + event.outputTokens, 0);
  const totalSessions = new Set(events.map(e => e.sessionId)).size;
  const totalRequests = events.length;
  const cacheSavings = calculateCacheSavings(events);
  const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;

  return {
    totalCost,
    totalTokens,
    totalSessions,
    totalRequests,
    cacheSavings,
    avgCostPerSession,
    byModel: aggregateByModel(events),
  };
};

/** Generate heatmap data for activity visualization */
export const generateHeatmapData = (events: UsageEvent[]) => {
  const hours: Record<string, number> = {};
  events.forEach(event => {
    const date = new Date(event.ts);
    const hour = date.getHours();
    const key = `${date.toISOString().split('T')[0]}T${hour.toString().padStart(2, '0')}`;
    if (!hours[key]) hours[key] = 0;
    hours[key] += 1;
  });

  return Object.entries(hours).map(([timestamp, count]) => ({
    timestamp,
    count,
  }));
};
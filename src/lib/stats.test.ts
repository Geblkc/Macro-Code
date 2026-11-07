import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '../types';
import {
  aggregateByModel,
  aggregateTimeSeries,
  computeMetrics,
  generateHeatmapData,
} from './stats';

const ev = (over: Partial<UsageEvent> = {}): UsageEvent => ({
  id: Math.random().toString(36).slice(2),
  ts: Date.UTC(2026, 10, 7, 10, 0, 0),
  sessionId: 's1',
  provider: 'openai',
  model: 'm1',
  inputTokens: 1000,
  outputTokens: 500,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  latencyMs: 0,
  ttftMs: 0,
  status: 'ok',
  costUsd: 0.01,
  estimated: 0,
  toolMs: 0,
  ...over,
});

describe('stats', () => {
  it('computeMetrics toplam ve model kırılımını hesaplar', () => {
    const events = [
      ev({ sessionId: 's1', model: 'm1', costUsd: 0.01 }),
      ev({ sessionId: 's1', model: 'm1', costUsd: 0.02, cacheReadTokens: 200 }),
      ev({ sessionId: 's2', model: 'm2', costUsd: 0.03 }),
    ];
    const m = computeMetrics(events);
    expect(m.totalCost).toBeCloseTo(0.06, 8);
    expect(m.totalTokens).toBe(3 * 1500);
    expect(m.totalSessions).toBe(2);
    expect(m.totalRequests).toBe(3);
    expect(m.cacheSavings).toBe(200);
    expect(m.avgCostPerSession).toBeCloseTo(0.03, 8);
    expect(m.byModel.m1.requests).toBe(2);
    expect(m.byModel.m2.cost).toBeCloseTo(0.03, 8);
  });

  it('aggregateByModel saatlik seri üretir', () => {
    const events = [
      ev({ ts: Date.UTC(2026, 10, 7, 10, 1) }),
      ev({ ts: Date.UTC(2026, 10, 7, 10, 30) }),
      ev({ ts: Date.UTC(2026, 10, 7, 11, 5) }),
    ];
    const series = aggregateTimeSeries(events);
    expect(series).toHaveLength(2);
    expect(series[0].requests).toBe(2);
    expect(series[1].requests).toBe(1);
  });

  it('generateHeatmapData saat bazında sayar', () => {
    const events = [ev(), ev()];
    const points = generateHeatmapData(events);
    expect(points).toHaveLength(1);
    expect(points[0].count).toBe(2);
  });

  it('boş olay listesinde sıfır döner', () => {
    const m = computeMetrics([]);
    expect(m).toMatchObject({
      totalCost: 0,
      totalTokens: 0,
      totalSessions: 0,
      totalRequests: 0,
      cacheSavings: 0,
      avgCostPerSession: 0,
    });
    expect(aggregateByModel([])).toEqual({});
  });
});

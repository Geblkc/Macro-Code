import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCost, formatTokens } from '../lib/pricing';
import { useStatsStore } from '../store/stats';
import { useT } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

const CHART_PRESETS = [
  { labelKey: 'stats.range.7d' as const, days: 7 },
  { labelKey: 'stats.range.30d' as const, days: 30 },
  { labelKey: 'stats.range.90d' as const, days: 90 },
];

type SeriesKey = 'cost' | 'tokens' | 'requests';

export default function StatsScreen({ open, onClose }: Props) {
  const t = useT();
  const metrics = useStatsStore((s) => s.metrics);
  const timeSeries = useStatsStore((s) => s.timeSeries) ?? [];
  const loading = useStatsStore((s) => s.loading);
  const setFilters = useStatsStore((s) => s.setFilters);
  const loadStats = useStatsStore((s) => s.loadStats);

  const [days, setDays] = useState(30);
  const [project, setProject] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('cost');

  useEffect(() => {
    if (open) void loadStats();
  }, [open, loadStats]);

  const chartData = useMemo(
    () =>
      timeSeries.map((p) => ({
        name: new Date(p.timestamp).toLocaleDateString(),
        cost: Number(p.cost.toFixed(4)),
        tokens: Math.round(p.tokens),
        requests: p.requests,
      })),
    [timeSeries],
  );

  const byModel = useMemo(
    () =>
      Object.entries(metrics?.byModel ?? {}).sort((a, b) => b[1].cost - a[1].cost),
    [metrics],
  );

  if (!open) return null;

  const applyFilters = () => {
    const endDate = new Date();
    const startDate = new Date(Date.now() - days * 86_400_000);
    setFilters({
      startDate,
      endDate,
      project: project || undefined,
      model: model || undefined,
      provider: provider || undefined,
    });
    void loadStats();
  };

  const m = metrics;
  const hasData = (m?.totalRequests ?? 0) > 0;

  const kpis: Array<{ label: string; value: string }> = [
    { label: t('stats.kpi.totalCost'), value: formatCost(m?.totalCost ?? 0) },
    { label: t('stats.kpi.totalTokens'), value: formatTokens(m?.totalTokens ?? 0) },
    { label: t('stats.kpi.totalSessions'), value: String(m?.totalSessions ?? 0) },
    { label: t('stats.kpi.totalRequests'), value: String(m?.totalRequests ?? 0) },
    { label: t('stats.kpi.cacheSavings'), value: formatTokens(m?.cacheSavings ?? 0) },
    { label: t('stats.kpi.avgCost'), value: formatCost(m?.avgCostPerSession ?? 0) },
  ];

  return (
    <div className="stats-overlay" onClick={onClose}>
      <div
        className="stats-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('stats.screen.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stats-header">
          <h2>
            <Icon name="bar-chart" size="sm" /> {t('stats.screen.title')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size="sm" />
          </button>
        </div>

        <div className="stats-filters">
          <label>
            {t('stats.filter.days')}
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {CHART_PRESETS.map((p) => (
                <option key={p.days} value={p.days}>
                  {t(p.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('stats.filter.project')}
            <input
              className="input"
              value={project}
              placeholder={t('stats.filter.all')}
              onChange={(e) => setProject(e.target.value)}
            />
          </label>
          <label>
            {t('stats.filter.model')}
            <input
              className="input"
              value={model}
              placeholder={t('stats.filter.all')}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label>
            {t('stats.filter.provider')}
            <input
              className="input"
              value={provider}
              placeholder={t('stats.filter.all')}
              onChange={(e) => setProvider(e.target.value)}
            />
          </label>
          <button className="btn" onClick={applyFilters}>
            {t('stats.screen.apply')}
          </button>
        </div>

        <div className="stats-content">
          <div className="stats-kpi-grid">
            {kpis.map((k) => (
              <div className="stats-kpi-card" key={k.label}>
                <div className="stats-kpi-label">{k.label}</div>
                <div className="stats-kpi-value">{k.value}</div>
              </div>
            ))}
          </div>

          {loading ? <p className="stats-note">{t('stats.loading')}</p> : null}
          {!loading && !hasData ? <p className="stats-note">{t('stats.empty')}</p> : null}

          {hasData ? (
            <>
              <div className="stats-chart-section">
                <h3>{t('stats.chart.title')}</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                    <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
                    <YAxis stroke="var(--text-tertiary)" fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="var(--accent)"
                      fill="var(--accent)"
                      fillOpacity={0.2}
                      name={t('stats.chart.cost')}
                    />
                    <Area
                      type="monotone"
                      dataKey="tokens"
                      stroke="#3498db"
                      fill="#3498db"
                      fillOpacity={0.15}
                      name={t('stats.chart.tokens')}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="stats-chart-section">
                <div className="stats-series-switch">
                  {(['cost', 'tokens', 'requests'] as SeriesKey[]).map((key) => (
                    <button
                      key={key}
                      className={`btn btn-sm${seriesKey === key ? ' active' : ''}`}
                      onClick={() => setSeriesKey(key)}
                    >
                      {t(`stats.chart.${key}` as const)}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                    <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={12} />
                    <YAxis stroke="var(--text-tertiary)" fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey={seriesKey} stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {byModel.length > 0 ? (
                <div className="stats-breakdown">
                  <h3>{t('stats.breakdown.model')}</h3>
                  <div className="stats-breakdown-grid">
                    {byModel.map(([modelId, data]) => (
                      <div key={modelId} className="stats-breakdown-item">
                        <div className="stats-breakdown-label" title={modelId}>
                          {modelId}
                        </div>
                        <div className="stats-breakdown-value">
                          {formatCost(data.cost)} · {formatTokens(data.tokens)} · {data.requests}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="stats-note">
                {t('stats.screen.sessions', { count: m?.totalSessions ?? 0 })}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

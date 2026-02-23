import os from 'node:os';
import { formatDurationMs } from '../../../../src/shared/time-format.js';

export const formatDuration = (ms) => formatDurationMs(ms);

export const formatGb = (mb) => `${(mb / 1024).toFixed(1)} GB`;

export const formatLoc = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${Math.floor(value)}`;
};

export const stripMaxOldSpaceFlag = (options) => {
  if (!options) return '';
  return options
    .replace(/--max-old-space-size=\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getRecommendedHeapMb = () => {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
};

export const formatMetricSummary = (summary) => {
  if (!summary) return 'Metrics: pending';
  const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
  const parts = [];
  for (const backend of backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hitRate = summary.hitRate?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hitRate) ? `${(hitRate * 100).toFixed(1)}%` : 'n/a';
    parts.push(`${backend} ${latencyText} hit ${hitText}`);
  }
  if (summary.embeddingProvider) {
    parts.push(`embed ${summary.embeddingProvider}`);
  }
  return parts.length ? `Metrics: ${parts.join(' | ')}` : 'Metrics: pending';
};

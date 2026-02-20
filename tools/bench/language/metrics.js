import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';
import { readTextFile } from '../../../src/shared/encoding.js';
import { countLinesForEntries } from '../../../src/shared/file-stats.js';
import { formatDurationMs } from '../../../src/shared/time-format.js';
import { getTriageConfig } from '../../shared/dict-utils.js';
import { emitBenchLog } from './logging.js';

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

const resolveMaxFileBytes = (userConfig) => {
  const raw = userConfig?.indexing?.maxFileBytes;
  const parsed = Number(raw);
  if (raw === false || raw === 0) return null;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return 5 * 1024 * 1024;
};

export const buildLineStats = async (repoPath, userConfig) => {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoPath, userConfig });
  const skippedByMode = { code: [], prose: [], 'extracted-prose': [], records: [] };
  const maxFileBytes = resolveMaxFileBytes(userConfig);
  const triageConfig = getTriageConfig(repoPath, userConfig);
  const recordsConfig = userConfig.records || null;
  const entriesByMode = await discoverFilesForModes({
    root: repoPath,
    modes,
    recordsDir: triageConfig.recordsDir,
    recordsConfig,
    ignoreMatcher,
    skippedByMode,
    maxFileBytes
  });
  const linesByFile = {
    code: new Map(),
    prose: new Map(),
    'extracted-prose': new Map(),
    records: new Map()
  };
  const totals = { code: 0, prose: 0, 'extracted-prose': 0, records: 0 };
  const concurrency = Math.max(1, Math.min(32, os.cpus().length * 2));
  for (const mode of modes) {
    const entries = entriesByMode[mode] || [];
    if (!entries.length) continue;
    const lineCounts = await countLinesForEntries(entries, { concurrency });
    for (const [rel, lines] of lineCounts) {
      linesByFile[mode].set(rel, lines);
      totals[mode] += lines;
    }
  }
  return { totals, linesByFile };
};

export const validateEncodingFixtures = async (scriptRoot, { onLog = null } = {}) => {
  const warn = (message) => emitBenchLog(onLog, message, 'warn');
  const fixturePath = path.join(scriptRoot, 'tests', 'fixtures', 'encoding', 'latin1.js');
  if (!fs.existsSync(fixturePath)) return;
  try {
    const { text, usedFallback } = await readTextFile(fixturePath);
    const expected = 'caf\u00e9';
    if (!text.includes(expected) || !usedFallback) {
      warn(`[bench] Encoding fixture did not decode as expected: ${fixturePath}`);
    }
  } catch (err) {
    warn(`[bench] Encoding fixture read failed: ${err?.message || err}`);
  }
};

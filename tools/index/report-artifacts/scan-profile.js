import { getOwn, setOwn } from '../../../src/shared/object-record.js';
import path from 'node:path';
import { mergeReuseSummaries } from '../../../src/shared/reuse-diagnostics.js';
import { readJsonFileSyncSafe } from '../../../src/shared/file-read.js';
import { resolveExtractionQuality } from '../../../src/shared/extraction-quality.js';
import { buildExtractionQualityRecord } from '../../../src/index/build/artifacts/reporting.js';

import { SCAN_PROFILE_SCHEMA_VERSION, SCAN_PROFILE_MODES } from '../../../src/contracts/scan-profile.js';
import { observedScanNumber, observedScanCount, observedScanRate, summarizeScanObservations } from './scan-observations.js';
export { SCAN_PROFILE_SCHEMA_VERSION } from '../../../src/contracts/scan-profile.js';

const MODE_KEYS = SCAN_PROFILE_MODES;
const INDEX_METRICS_KEY_BY_MODE = {
  code: 'code',
  prose: 'prose',
  'extracted-prose': 'extractedProse',
  records: 'records'
};
const ARTIFACT_BYTES_KEY_BY_MODE = {
  code: 'indexCode',
  prose: 'indexProse',
  'extracted-prose': 'indexExtractedProse',
  records: 'indexRecords'
};

const toFiniteOrNull = observedScanNumber;
const toNonNegativeIntOrNull = observedScanCount;

const toNonNegativeCountMap = (value) => {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const count = toNonNegativeIntOrNull(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;
    setOwn(result,String(key),count);
  }
  return result;
};

const toLanguageLines = (value) => {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [language, bucket] of Object.entries(value)) {
    const lines = toNonNegativeIntOrNull(bucket?.lines);
    if (!Number.isFinite(lines) || lines <= 0) continue;
    setOwn(result,String(language),lines);
  }
  return result;
};

const computeRate = observedScanRate;

const readExtractionQuality = (metrics) => {
  const indexDir = metrics?.indexDir;
  const state = typeof indexDir === 'string' && indexDir.trim()
    ? readJsonFileSyncSafe(path.join(indexDir, 'index_state.json'), null) : null;
  const extractionReport = typeof indexDir === 'string' && indexDir.trim()
    ? readJsonFileSyncSafe(path.join(indexDir, 'extraction_report.json'), null) : null;
  const resolved = resolveExtractionQuality({ state, extractionReport, timings: metrics?.timings });
  const normalized = buildExtractionQualityRecord({ mode: 'extracted-prose',
    state: { extractedProseLowYieldBailout: resolved.lowYieldBailout } });
  return { observation: resolved.observation, source: resolved.source, lowYieldBailout: normalized.lowYieldBailout };
};

export const createEmptyModeProfile = (modeKey) => ({
  mode: modeKey,
  indexDir: null,
  cache: {
    hits: null,
    misses: null,
    hitRate: null
  },
  files: {
    candidates: null,
    scanned: null,
    skipped: null,
    skippedByReason: {}
  },
  chunks: {
    total: null,
    avgTokens: null
  },
  tokens: {
    total: null,
    vocab: null
  },
  lines: {
    total: null,
    byLanguage: {}
  },
  bytes: {
    source: null,
    artifact: null
  },
  artifacts: {
    filterIndex: null
  },
  timings: null,
  throughput: {
    totalMs: null,
    writeMs: null,
    filesPerSec: null,
    chunksPerSec: null,
    tokensPerSec: null,
    bytesPerSec: null,
    linesPerSec: null,
    writeBytesPerSec: null
  },
  queues: {
    postings: null
  },
  quality: {
    observation: modeKey === 'extracted-prose' ? 'unknown' : 'not-applicable',
    source: null,
    lowYieldBailout: null
  },
  reuse: null
});

const buildModeScanProfile = ({
  modeKey,
  indexMetrics,
  featureMetrics,
  throughput,
  artifactBytes
}) => {
  const empty = createEmptyModeProfile(modeKey);
  const metricsKey = INDEX_METRICS_KEY_BY_MODE[modeKey];
  const metrics = indexMetrics?.[metricsKey] || null;
  const featureMode = featureMetrics?.modes?.[modeKey] || null;
  const featureTotals = featureMode?.totals || null;
  const languageLines = toLanguageLines(featureMode?.languages || null);
  const totalMs = toFiniteOrNull(throughput?.totalMs) ?? toFiniteOrNull(metrics?.timings?.totalMs);
  const writeMs = toFiniteOrNull(throughput?.writeMs) ?? toFiniteOrNull(metrics?.timings?.writeMs);
  const linesTotal = toNonNegativeIntOrNull(featureTotals?.lines);
  const filesScanned = toNonNegativeIntOrNull(metrics?.files?.scanned);
  const filesSkipped = toNonNegativeIntOrNull(metrics?.files?.skipped);
  const filesCandidates = toNonNegativeIntOrNull(metrics?.files?.candidates);
  const chunksTotal = toNonNegativeIntOrNull(metrics?.chunks?.total);
  const tokensTotal = toNonNegativeIntOrNull(metrics?.tokens?.total);
  const artifactTotalBytes = toNonNegativeIntOrNull(artifactBytes);

  const cacheHitRate = toFiniteOrNull(metrics?.cache?.hitRate);
  return {
    ...empty,
    indexDir: typeof metrics?.indexDir === 'string' ? metrics.indexDir : null,
    cache: {
      hits: toNonNegativeIntOrNull(metrics?.cache?.hits),
      misses: toNonNegativeIntOrNull(metrics?.cache?.misses),
      hitRate: cacheHitRate !== null && cacheHitRate <= 1 ? cacheHitRate : null
    },
    files: {
      candidates: filesCandidates,
      scanned: filesScanned,
      skipped: filesSkipped,
      skippedByReason: toNonNegativeCountMap(metrics?.files?.skippedByReason)
    },
    chunks: {
      total: chunksTotal,
      avgTokens: toFiniteOrNull(metrics?.chunks?.avgTokens)
    },
    tokens: {
      total: tokensTotal,
      vocab: toNonNegativeIntOrNull(metrics?.tokens?.vocab)
    },
    lines: {
      total: linesTotal,
      byLanguage: languageLines
    },
    bytes: {
      source: toNonNegativeIntOrNull(featureTotals?.bytes),
      artifact: artifactTotalBytes
    },
    artifacts: {
      filterIndex: metrics?.artifacts?.filterIndex || null
    },
    timings: metrics?.timings && typeof metrics.timings === 'object'
      ? metrics.timings
      : null,
    throughput: {
      totalMs,
      writeMs,
      filesPerSec: computeRate(filesCandidates, totalMs),
      chunksPerSec: computeRate(chunksTotal, totalMs),
      tokensPerSec: computeRate(tokensTotal, totalMs),
      bytesPerSec: computeRate(artifactTotalBytes, totalMs),
      linesPerSec: computeRate(linesTotal, totalMs),
      writeBytesPerSec: computeRate(artifactTotalBytes, writeMs)
    },
    queues: {
      postings: metrics?.queues?.postings || null
    },
    quality: modeKey === 'extracted-prose' ? readExtractionQuality(metrics) : empty.quality,
    reuse: metrics?.reuse && typeof metrics.reuse === 'object'
      ? metrics.reuse
      : null
  };
};

export const buildScanProfile = ({
  artifactReport,
  indexMetrics,
  featureMetrics,
  throughput
}) => {
  const repo = artifactReport?.repo || {};
  const modes = {};
  const languageLines = {};
  let reuseSummary = null;
  const requiredModes = [];

  for (const modeKey of MODE_KEYS) {
    const artifactBytesKey = ARTIFACT_BYTES_KEY_BY_MODE[modeKey];
    const selected = artifactReport?.health?.modes?.[modeKey]?.selected;
    const explicitlyUnselected = selected === false;
    const modeProfile = buildModeScanProfile({
      modeKey,
      indexMetrics: explicitlyUnselected ? null : indexMetrics,
      featureMetrics: explicitlyUnselected ? null : featureMetrics,
      throughput: explicitlyUnselected ? null : throughput?.[INDEX_METRICS_KEY_BY_MODE[modeKey]] || null,
      artifactBytes: explicitlyUnselected ? null : repo?.artifacts?.[artifactBytesKey]
    });
    setOwn(modes,modeKey,modeProfile);
    reuseSummary = mergeReuseSummaries(reuseSummary, modeProfile.reuse);
    const metricsKey = INDEX_METRICS_KEY_BY_MODE[modeKey];
    if (!explicitlyUnselected && (selected === true || typeof repo.indexDirs?.[modeKey] === 'string' || indexMetrics?.[metricsKey] != null
      || featureMetrics?.modes?.[modeKey] != null || throughput?.[metricsKey] != null || repo.artifacts?.[artifactBytesKey] != null)) requiredModes.push(modeKey);
    for (const [language, lines] of Object.entries(modeProfile.lines.byLanguage || {})) {
      setOwn(languageLines,language,(getOwn(languageLines,language) || 0) + lines);
    }
  }

  const { totals, coverage } = summarizeScanObservations(modes, requiredModes);

  return {
    schemaVersion: SCAN_PROFILE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'report-artifacts',
    repo: {
      root: typeof repo?.root === 'string' ? repo.root : null,
      cacheRoot: typeof repo?.cacheRoot === 'string' ? repo.cacheRoot : null
    },
    modes,
    totals,
    coverage,
    languageLines,
    reuse: reuseSummary
  };
};

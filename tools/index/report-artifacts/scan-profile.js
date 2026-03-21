import path from 'node:path';
import { readJsonFileSyncSafe } from '../../shared/json-utils.js';

export const SCAN_PROFILE_SCHEMA_VERSION = 1;

const MODE_KEYS = ['code', 'prose', 'extracted-prose', 'records'];
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

const toFiniteOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toNonNegativeIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.trunc(numeric);
};

const toNonNegativeCountMap = (value) => {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [key, rawCount] of Object.entries(value)) {
    const count = toNonNegativeIntOrNull(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;
    result[String(key)] = count;
  }
  return result;
};

const toLanguageLines = (value) => {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [language, bucket] of Object.entries(value)) {
    const lines = toNonNegativeIntOrNull(bucket?.lines);
    if (!Number.isFinite(lines) || lines <= 0) continue;
    result[String(language)] = lines;
  }
  return result;
};

const computeRate = (count, elapsedMs) => {
  const total = Number(count);
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(total) || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  return total / (elapsed / 1000);
};

const readExtractionReportLowYieldBailout = (indexDir) => {
  if (typeof indexDir !== 'string' || !indexDir.trim()) return null;
  const report = readJsonFileSyncSafe(path.join(indexDir, 'extraction_report.json'), null);
  return report?.quality?.lowYieldBailout && typeof report.quality.lowYieldBailout === 'object'
    ? report.quality.lowYieldBailout
    : null;
};

const createEmptyModeProfile = (modeKey) => ({
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
    lowYieldBailout: null
  }
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
  const totalMs = toFiniteOrNull(throughput?.totalMs ?? metrics?.timings?.totalMs);
  const writeMs = toFiniteOrNull(throughput?.writeMs ?? metrics?.timings?.writeMs);
  const linesTotal = toNonNegativeIntOrNull(featureTotals?.lines);
  const filesScanned = toNonNegativeIntOrNull(metrics?.files?.scanned);
  const filesSkipped = toNonNegativeIntOrNull(metrics?.files?.skipped);
  const filesCandidates = toNonNegativeIntOrNull(metrics?.files?.candidates);
  const chunksTotal = toNonNegativeIntOrNull(metrics?.chunks?.total);
  const tokensTotal = toNonNegativeIntOrNull(metrics?.tokens?.total);
  const artifactTotalBytes = toNonNegativeIntOrNull(artifactBytes);

  return {
    ...empty,
    indexDir: typeof metrics?.indexDir === 'string' ? metrics.indexDir : null,
    cache: {
      hits: toNonNegativeIntOrNull(metrics?.cache?.hits),
      misses: toNonNegativeIntOrNull(metrics?.cache?.misses),
      hitRate: toFiniteOrNull(metrics?.cache?.hitRate)
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
    timings: metrics?.timings && typeof metrics.timings === 'object'
      ? metrics.timings
      : null,
    throughput: {
      totalMs,
      writeMs,
      filesPerSec: toFiniteOrNull(throughput?.filesPerSec) ?? computeRate(filesCandidates, totalMs),
      chunksPerSec: toFiniteOrNull(throughput?.chunksPerSec) ?? computeRate(chunksTotal, totalMs),
      tokensPerSec: toFiniteOrNull(throughput?.tokensPerSec) ?? computeRate(tokensTotal, totalMs),
      bytesPerSec: toFiniteOrNull(throughput?.bytesPerSec) ?? computeRate(artifactTotalBytes, totalMs),
      linesPerSec: computeRate(linesTotal, totalMs),
      writeBytesPerSec: toFiniteOrNull(throughput?.writeBytesPerSec) ?? computeRate(artifactTotalBytes, writeMs)
    },
    queues: {
      postings: metrics?.queues?.postings || null
    },
    quality: {
      lowYieldBailout: modeKey === 'extracted-prose'
        ? readExtractionReportLowYieldBailout(metrics?.indexDir)
        : null
    }
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
  const totals = {
    files: {
      candidates: 0,
      scanned: 0,
      skipped: 0
    },
    chunks: 0,
    tokens: 0,
    lines: 0,
    bytes: {
      source: 0,
      artifact: 0
    },
    durationMs: 0,
    filesPerSec: null,
    chunksPerSec: null,
    tokensPerSec: null,
    bytesPerSec: null,
    linesPerSec: null
  };
  let observedLines = false;
  let observedDuration = false;
  let observedSourceBytes = false;

  for (const modeKey of MODE_KEYS) {
    const artifactBytesKey = ARTIFACT_BYTES_KEY_BY_MODE[modeKey];
    const modeProfile = buildModeScanProfile({
      modeKey,
      indexMetrics,
      featureMetrics,
      throughput: throughput?.[INDEX_METRICS_KEY_BY_MODE[modeKey]] || null,
      artifactBytes: repo?.artifacts?.[artifactBytesKey]
    });
    modes[modeKey] = modeProfile;
    if (Number.isFinite(modeProfile.files.candidates)) totals.files.candidates += modeProfile.files.candidates;
    if (Number.isFinite(modeProfile.files.scanned)) totals.files.scanned += modeProfile.files.scanned;
    if (Number.isFinite(modeProfile.files.skipped)) totals.files.skipped += modeProfile.files.skipped;
    if (Number.isFinite(modeProfile.chunks.total)) totals.chunks += modeProfile.chunks.total;
    if (Number.isFinite(modeProfile.tokens.total)) totals.tokens += modeProfile.tokens.total;
    if (Number.isFinite(modeProfile.lines.total)) {
      totals.lines += modeProfile.lines.total;
      observedLines = true;
    }
    if (Number.isFinite(modeProfile.bytes.source)) {
      totals.bytes.source += modeProfile.bytes.source;
      observedSourceBytes = true;
    }
    if (Number.isFinite(modeProfile.bytes.artifact)) totals.bytes.artifact += modeProfile.bytes.artifact;
    if (Number.isFinite(modeProfile.throughput.totalMs)) {
      totals.durationMs += modeProfile.throughput.totalMs;
      observedDuration = true;
    }
    for (const [language, lines] of Object.entries(modeProfile.lines.byLanguage || {})) {
      languageLines[language] = (languageLines[language] || 0) + lines;
    }
  }

  totals.lines = observedLines ? totals.lines : null;
  totals.bytes.source = observedSourceBytes ? totals.bytes.source : null;
  totals.durationMs = observedDuration ? totals.durationMs : null;
  totals.filesPerSec = computeRate(totals.files.candidates, totals.durationMs);
  totals.chunksPerSec = computeRate(totals.chunks, totals.durationMs);
  totals.tokensPerSec = computeRate(totals.tokens, totals.durationMs);
  totals.bytesPerSec = computeRate(totals.bytes.artifact, totals.durationMs);
  totals.linesPerSec = computeRate(totals.lines, totals.durationMs);

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
    languageLines
  };
};

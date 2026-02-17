import fs from 'node:fs/promises';
import path from 'node:path';

export const RESOURCE_WARNING_CODES = Object.freeze({
  INDEX_SIZE_GROWTH_ABNORMAL: 'op_resource_index_growth_abnormal',
  RETRIEVAL_MEMORY_GROWTH_ABNORMAL: 'op_resource_retrieval_memory_growth_abnormal'
});

export const RESOURCE_GROWTH_THRESHOLDS = Object.freeze({
  indexSizeRatio: 2,
  indexSizeDeltaBytes: 256 * 1024 * 1024,
  retrievalRssRatio: 1.5,
  retrievalRssDeltaBytes: 96 * 1024 * 1024
});

const toFinitePositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const toText = (value) => String(value || '').trim();

const toMiB = (bytes) => bytes / (1024 * 1024);

/**
 * Evaluate growth against ratio + absolute delta thresholds. Requiring both
 * keeps warnings low-noise on small baselines while still catching large spikes.
 */
export const evaluateResourceGrowth = ({
  baselineBytes,
  currentBytes,
  ratioThreshold,
  deltaThresholdBytes
} = {}) => {
  const baseline = toFinitePositiveNumber(baselineBytes);
  const current = toFinitePositiveNumber(currentBytes);
  if (!baseline || !current) {
    return {
      baselineBytes: baseline || 0,
      currentBytes: current || 0,
      deltaBytes: 0,
      ratio: 1,
      abnormal: false
    };
  }
  const deltaBytes = Math.max(0, current - baseline);
  const ratio = baseline > 0 ? current / baseline : 1;
  const ratioGate = toFinitePositiveNumber(ratioThreshold) || 1;
  const deltaGate = toFinitePositiveNumber(deltaThresholdBytes) || 0;
  return {
    baselineBytes: baseline,
    currentBytes: current,
    deltaBytes,
    ratio,
    abnormal: ratio >= ratioGate && deltaBytes >= deltaGate
  };
};

export const formatResourceGrowthWarning = ({
  code,
  component,
  metric,
  growth,
  nextAction
} = {}) => {
  const baselineMiB = toMiB(growth?.baselineBytes || 0).toFixed(1);
  const currentMiB = toMiB(growth?.currentBytes || 0).toFixed(1);
  const deltaMiB = toMiB(growth?.deltaBytes || 0).toFixed(1);
  const ratio = Number(growth?.ratio || 1).toFixed(2);
  return (
    `[ops-resource] code=${toText(code)} component=${toText(component)} metric=${toText(metric)} `
    + `baselineMiB=${baselineMiB} currentMiB=${currentMiB} deltaMiB=${deltaMiB} ratio=${ratio} `
    + `next="${toText(nextAction)}"`
  );
};

export const captureProcessMemoryRss = () => (
  Number(process.memoryUsage()?.rss) || 0
);

/**
 * Read index artifact bytes from pieces manifest metadata. Returns null if the
 * manifest is absent or doesn't publish piece byte sizes.
 * @param {string} indexDir
 * @returns {Promise<number|null>}
 */
export const readIndexArtifactBytes = async (indexDir) => {
  const dir = toText(indexDir);
  if (!dir) return null;
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  const manifest = parsed?.fields && typeof parsed.fields === 'object'
    ? parsed.fields
    : parsed;
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  if (!pieces.length) return null;
  let total = 0;
  let seen = false;
  for (const piece of pieces) {
    if (!Number.isFinite(piece?.bytes)) continue;
    total += Number(piece.bytes);
    seen = true;
  }
  return seen ? total : null;
};

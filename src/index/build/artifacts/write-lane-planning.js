import { isValidationCriticalArtifact } from './write-strategy.js';

/**
 * Resolve deterministic write ordering weight for batch scheduling.
 *
 * Weight uses explicit priority first, then a fixed validation-critical boost,
 * and finally a logarithmic size bonus only for entries that already opted into
 * priority ordering. Equal weights always fall back to FIFO `seq`.
 *
 * @param {object} entry
 * @returns {number}
 */
export const resolveArtifactWriteWeight = (entry) => {
  if (!entry || typeof entry !== 'object') return 0;
  let weight = Number.isFinite(entry.priority) ? entry.priority : 0;
  if (isValidationCriticalArtifact(entry.label)) {
    // Keep strict-validation-critical artifacts ahead of optional debug/derived
    // outputs when the write queue is saturated.
    weight += 500;
  }
  // Keep FIFO ordering unless a write has explicit priority.
  if (weight > 0 && Number.isFinite(entry.estimatedBytes) && entry.estimatedBytes > 0) {
    weight += Math.log2(entry.estimatedBytes + 1);
  }
  return weight;
};

/**
 * Return write entries ordered by scheduler weight and stable enqueue order.
 *
 * @param {object[]} entries
 * @returns {object[]}
 */
export const scheduleArtifactWrites = (entries) => (
  Array.isArray(entries)
    ? entries.slice().sort((a, b) => {
      const delta = resolveArtifactWriteWeight(b) - resolveArtifactWriteWeight(a);
      if (delta !== 0) return delta;
      const aSeq = Number.isFinite(a?.seq) ? a.seq : 0;
      const bSeq = Number.isFinite(b?.seq) ? b.seq : 0;
      return aSeq - bSeq;
    })
    : []
);

/**
 * Match a label against a set of forced lane patterns.
 *
 * @param {RegExp[]} patterns
 * @param {string} label
 * @returns {boolean}
 */
const hasLanePatternMatch = (patterns, label) => (
  Array.isArray(patterns) && patterns.some((pattern) => pattern.test(label))
);

/**
 * Partition scheduled writes into lane classes for adaptive dispatch.
 *
 * Lane precedence is deterministic:
 * 1. Massive (`forcedMassive` or `massiveWriteThresholdBytes`)
 * 2. Heavy (`forcedHeavy` or `heavyWriteThresholdBytes`)
 * 3. Ultra-light (`forcedUltraLight` or `ultraLightWriteThresholdBytes`)
 * 4. Light fallback
 *
 * Massive/heavy precedence intentionally wins over ultra-light hints so
 * tail-heavy artifacts are never downgraded into low-latency lanes.
 *
 * @param {object} input
 * @param {object[]} input.entries
 * @param {number} input.heavyWriteThresholdBytes
 * @param {number} input.ultraLightWriteThresholdBytes
 * @param {number} input.massiveWriteThresholdBytes
 * @param {RegExp[]} input.forcedHeavyWritePatterns
 * @param {RegExp[]} input.forcedUltraLightWritePatterns
 * @param {RegExp[]} input.forcedMassiveWritePatterns
 * @returns {{ultraLight:object[],massive:object[],light:object[],heavy:object[]}}
 */
export const splitScheduledArtifactWriteLanes = ({
  entries,
  heavyWriteThresholdBytes,
  ultraLightWriteThresholdBytes,
  massiveWriteThresholdBytes,
  forcedHeavyWritePatterns,
  forcedUltraLightWritePatterns,
  forcedMassiveWritePatterns
}) => {
  const ordered = scheduleArtifactWrites(entries);
  const lanes = {
    ultraLight: [],
    light: [],
    heavy: [],
    massive: []
  };
  for (const entry of ordered) {
    const estimated = Number(entry?.estimatedBytes);
    const label = typeof entry?.label === 'string' ? entry.label : '';
    const isForcedMassive = hasLanePatternMatch(forcedMassiveWritePatterns, label);
    const isForcedHeavy = hasLanePatternMatch(forcedHeavyWritePatterns, label);
    const isForcedUltraLight = hasLanePatternMatch(forcedUltraLightWritePatterns, label);
    const isMassiveBySize = Number.isFinite(estimated) && estimated >= massiveWriteThresholdBytes;
    const isMassive = isForcedMassive || isMassiveBySize;
    const isHeavyBySize = Number.isFinite(estimated) && estimated >= heavyWriteThresholdBytes;
    const isHeavy = isForcedHeavy || isHeavyBySize;
    const isUltraLightBySize = Number.isFinite(estimated)
      && estimated > 0
      && estimated <= ultraLightWriteThresholdBytes;
    if (isMassive) {
      lanes.massive.push(entry);
    } else if (isHeavy) {
      lanes.heavy.push(entry);
    } else if (isForcedUltraLight || isUltraLightBySize) {
      lanes.ultraLight.push(entry);
    } else {
      lanes.light.push(entry);
    }
  }
  return lanes;
};

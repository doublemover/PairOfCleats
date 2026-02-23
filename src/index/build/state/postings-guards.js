import { isDocsPath, isFixturePath } from '../mode-routing.js';

const POSTINGS_GUARD_SAMPLES = 5;

export const POSTINGS_GUARDS = Object.freeze({
  phrase: Object.freeze({ maxUnique: 1000000, maxPerChunk: 20000 }),
  chargram: Object.freeze({ maxUnique: 2000000, maxPerChunk: 50000 })
});

const POSTINGS_GUARD_TIER_MAX_PER_CHUNK = Object.freeze({
  docs: Object.freeze({ phrase: 12000, chargram: 24000 }),
  fixtures: Object.freeze({ phrase: 6000, chargram: 12000 })
});

export const resolvePostingsGuardTier = (file) => {
  if (!file || typeof file !== 'string') return null;
  if (isFixturePath(file)) return 'fixtures';
  if (isDocsPath(file)) return 'docs';
  return null;
};

export const resolveGuardMaxPerChunk = (guard, kind, tier) => {
  const base = Number.isFinite(guard?.maxPerChunk) ? Math.max(0, Math.floor(guard.maxPerChunk)) : 0;
  if (!base || !tier) return base;
  const tierCap = Number.isFinite(POSTINGS_GUARD_TIER_MAX_PER_CHUNK[tier]?.[kind])
    ? Math.max(0, Math.floor(POSTINGS_GUARD_TIER_MAX_PER_CHUNK[tier][kind]))
    : 0;
  if (!tierCap) return base;
  return Math.min(base, tierCap);
};

export const createGuardEntry = (label, limits) => ({
  label,
  maxUnique: limits.maxUnique,
  maxPerChunk: limits.maxPerChunk,
  effectiveMaxPerChunk: limits.maxPerChunk,
  disabled: false,
  reason: null,
  dropped: 0,
  truncatedChunks: 0,
  peakUnique: 0,
  samples: []
});

export const recordGuardSample = (guard, context) => {
  if (!guard || !context) return;
  if (guard.samples.length >= POSTINGS_GUARD_SAMPLES) return;
  guard.samples.push({
    file: context.file || null,
    chunkId: context.chunkId ?? null
  });
};

const formatGuardSample = (sample) => {
  if (!sample) return null;
  const file = sample.file || 'unknown';
  const chunkId = Number.isFinite(sample.chunkId) ? `#${sample.chunkId}` : '';
  return `${file}${chunkId}`;
};

/**
 * Build warning messages from postings guard counters.
 * @param {object} state
 * @returns {string[]}
 */
export function getPostingsGuardWarnings(state) {
  const guards = state?.postingsGuard;
  if (!guards) return [];
  const warnings = [];
  for (const guard of Object.values(guards)) {
    if (!guard) continue;
    const samples = (guard.samples || [])
      .map(formatGuardSample)
      .filter(Boolean);
    const sampleSuffix = samples.length ? ` Examples: ${samples.join(', ')}` : '';
    if (guard.disabled && guard.maxUnique) {
      warnings.push(
        `[postings] ${guard.label} postings capped at ${guard.maxUnique} unique terms; further entries skipped.${sampleSuffix}`
      );
    }
    const effectiveMaxPerChunk = Number.isFinite(guard.effectiveMaxPerChunk)
      ? guard.effectiveMaxPerChunk
      : guard.maxPerChunk;
    if (guard.truncatedChunks && effectiveMaxPerChunk) {
      warnings.push(
        `[postings] ${guard.label} postings truncated for ${guard.truncatedChunks} chunk(s) (limit ${effectiveMaxPerChunk} per chunk).${sampleSuffix}`
      );
    }
  }
  return warnings;
}

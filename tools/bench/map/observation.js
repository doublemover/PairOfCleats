import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { MAP_MODEL_VERSION } from '../../../src/map/model-version.js';

export const MAP_BENCH_KIND = 'map-publication-benchmark-v2';
export const MAP_BENCH_MARKER = 'map-benchmark-owner.json';
export const MAP_BENCH_INPUT = 'map-input.json';
export const MAP_BENCH_MAX_BYTES = 64 * 1024 * 1024;

export const observeMapProcessMemory = ({ before, after, through }, { resourceUsage = () => process.resourceUsage() } = {}) => {
  const observedBoundaryMax = {};
  for (const key of ['heapUsed', 'rss', 'external', 'arrayBuffers']) {
    const values = [before?.[key], after?.[key]].filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    observedBoundaryMax[key] = values.length ? Math.max(...values) : null;
  }
  const scope = { scope: 'fresh-child-process-lifetime', through, includes: 'startup-input-admission-and-any-warmup',
    method: 'node.process.resourceUsage.maxRSS', rawUnit: 'KiB', outputUnit: 'bytes' };
  let usage;
  try { usage = resourceUsage(); }
  catch (error) {
    const failure = describeStorageFailure(error, { phase: 'map-benchmark-memory-observation' });
    return { observedBoundaryMax, boundaryPolicy: 'before-and-after-only;transients-unobserved', sampleCount: 2,
      processLifetimeRss: { ...scope, state: 'unavailable', bytes: null, rawMaxRSS: null, reason: failure.code } };
  }
  const rawMaxRSS = usage?.maxRSS;
  const value = Number.isSafeInteger(rawMaxRSS) && rawMaxRSS > 0 ? rawMaxRSS * 1024 : null;
  const valid = value !== null && Number.isSafeInteger(value);
  const consistent = valid && (observedBoundaryMax.rss === null || value + 1023 >= observedBoundaryMax.rss);
  return { observedBoundaryMax, boundaryPolicy: 'before-and-after-only;transients-unobserved', sampleCount: 2,
    processLifetimeRss: { ...scope, state: consistent ? 'observed' : valid ? 'inconsistent' : 'unavailable',
      bytes: consistent ? value : null, rawMaxRSS: Number.isSafeInteger(rawMaxRSS) ? rawMaxRSS : null,
      reason: consistent ? null : valid ? 'high-water-below-current-observation' : 'maxRSS-not-observed' } };
};

export const describeMapWorkload = (model, serializedBytes = null) => {
  if (model?.version !== MAP_MODEL_VERSION || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) throw new TypeError('Current map arrays/version are required.');
  const counts = { files: model.nodes.length, members: model.nodes.reduce((sum, node) => sum + (node.members?.length || 0), 0), edges: model.edges.length };
  const declared = model.summary?.counts;
  if (!declared || Object.keys(counts).some(key => declared[key] !== counts[key])) throw new Error('Map workload summary differs from actual serialized content.');
  return { version: model.version, counts, inventory: model.summary.inventory || null, dropped: model.summary.dropped || null,
    truncated: model.summary.truncated === true, effectiveLimits: model.summary.limits || model.options?.limits || null,
    effectiveOptions: model.options || null, sectionHashes: model.sectionHashes || null, warnings: model.warnings || [], serializedBytes,
    task: 'JSON-serialization-of-an-already-materialized-map' };
};

import { performance } from 'node:perf_hooks';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

export const createMapBuildTimer = ({ memoryUsage = () => process.memoryUsage(), now = () => performance.now() } = {}) => {
  const stages = [], observedBoundaryMax = { heapUsed: null, rss: null, external: null, arrayBuffers: null };
  const memoryObservation = { policy: 'stage-boundaries-plus-final-model', sampleCount: 0, includesFinalModel: false,
    scope: 'current-process-boundary-observations', transientCoverage: 'unobserved', legacyPeakAlias: 'observedBoundaryMax' };
  let complete = false;
  const observe = () => {
    const raw = memoryUsage(), observed = {};
    for (const key of Object.keys(observedBoundaryMax)) {
      const value = typeof raw?.[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : null;
      observed[key] = value;
      if (value !== null) observedBoundaryMax[key] = Math.max(observedBoundaryMax[key] ?? 0, value);
    }
    memoryObservation.sampleCount++; return observed;
  };
  return { stages, peak: observedBoundaryMax, observedBoundaryMax, memoryObservation,
    async track(stage, run) {
      if (complete) throw new Error('Map build timing is already complete.');
      observe(); const start = now();
      let result, primary, failed = false;
      try { result = await run(); } catch (error) { failed = true; primary = error; }
      try {
        const elapsed = now() - start, memory = observe();
        if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Map build clock is not monotonic.');
        stages.push({ stage, elapsedMs: Math.round(elapsed * 100) / 100, memory, status: failed ? 'failed' : 'completed' });
      } catch (error) {
        primary = failed ? addStorageFailureContext(primary, { phase: 'map-build-measurement' }, error, { secondaryPresent: true }) : error;
        failed = true;
      }
      if (failed) throw primary;
      return result;
    },
    complete() {
      if (complete) return;
      observe(); memoryObservation.includesFinalModel = true; complete = true;
    }
  };
};

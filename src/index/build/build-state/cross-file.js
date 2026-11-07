import { updateBuildState } from '../build-state.js';

const count = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => Object.assign(new Error('Invalid cross-file work receipt.'), {
  code: 'ERR_CROSS_FILE_PROGRESS'
});

/** Reuse the required build-state owner. Observed mutable effects are never a
 * resumable prefix: an interruption restarts this phase from durable Stage1. */
export const createCrossFileWorkReporter = ({ buildRoot, buildId, mode,
  write = updateBuildState, now = () => new Date().toISOString() }) => {
  if (typeof buildRoot !== 'string' || !buildRoot || typeof buildId !== 'string' || !buildId
    || typeof mode !== 'string' || !mode) throw fail();
  let startedAt = null;
  let fingerprint = null;
  let totalChunks = null;
  let observedCompletedChunks = 0;
  return async event => {
    if (!event || !['running', 'done', 'failed'].includes(event.status)
      || !count(event.totalChunks) || !count(event.observedCompletedChunks)
      || event.observedCompletedChunks > event.totalChunks
      || event.observedCompletedChunks < observedCompletedChunks
      || typeof event.fingerprint !== 'string' || !/^[a-f0-9]{40}$/.test(event.fingerprint)
      || (fingerprint !== null && event.fingerprint !== fingerprint)
      || (totalChunks !== null && event.totalChunks !== totalChunks)
      || (event.status === 'done' && event.observedCompletedChunks !== event.totalChunks)) throw fail();
    const timestamp = now();
    startedAt ||= timestamp;
    fingerprint = event.fingerprint;
    totalChunks = event.totalChunks;
    observedCompletedChunks = event.observedCompletedChunks;
    const terminal = event.status !== 'running';
    const stats = event.stats || event;
    const counters = Object.fromEntries(['linkedCalls', 'linkedCallSummaries', 'linkedUsages',
      'inferredReturns', 'riskFlows'].map(key => [key, count(stats[key]) ? stats[key] : null]));
    const entry = {
      status: event.status, startedAt, updatedAt: timestamp,
      ...(terminal ? { finishedAt: timestamp } : {}),
      detail: {
        schemaVersion: 1, generation: { buildId, mode }, fingerprint,
        fidelity: event.fidelity || null,
        observedCompletedChunks, totalChunks,
        // Cross-chunk mutation means even a completed input bundle can affect
        // an unsealed target. Do not advance a durable cursor for those writes.
        durableCompletedChunks: 0,
        resume: { strategy: 'restart-phase', boundary: 'durable-stage1', sealedOutput: false },
        computation: event.status === 'done' ? 'complete' : 'incomplete',
        publication: 'pending',
        cacheHit: event.cacheHit === true,
        canceled: event.canceled === true,
        errorCode: event.status === 'failed' ? event.errorCode || 'Error' : null,
        counters, sourceReadCoverage: event.stats?.sourceReadCoverage || null,
        analysisCoverage: 'unknown'
      }
    };
    await write(buildRoot, { phases: { ['cross-file:' + mode]: entry } });
    return entry;
  };
};

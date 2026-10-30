import * as tasks from '../../../src/index/build/workers/indexer-worker.js';

// No wait, sleep or termination override: signal entry, then run the original
// bounded production task immediately. A too-fast task is refused by its caller.
const wrap = name => async input => {
  const { __qualificationStarted, ...payload } = input;
  const flags = __qualificationStarted ? new Int32Array(__qualificationStarted) : null;
  if (flags) { Atomics.store(flags, 0, 1); Atomics.notify(flags, 0); }
  try { return await tasks[name](payload); }
  finally { if (flags) { Atomics.store(flags, 1, 1); Atomics.notify(flags, 1); } }
};
export const tokenizeChunk = wrap('tokenizeChunk');
export const tokenizeBatch = wrap('tokenizeBatch');
export const quantizeVectors = wrap('quantizeVectors');
export const analyzeFile = wrap('analyzeFile');

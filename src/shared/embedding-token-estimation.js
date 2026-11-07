import { observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';

const terminalFailures = new WeakSet();
const terminal = error => { if (error !== null && ['object', 'function'].includes(typeof error)) terminalFailures.add(error); return error; };
export const isTerminalEmbeddingTokenEstimateFailure = error => error !== null && ['object', 'function'].includes(typeof error) && terminalFailures.has(error);

/** Optional batch estimates may fall back after ordinary failures. Unknown
 * original work, cancellation, aggregate failure and inspection failures must
 * retain their owners rather than disappear as a missing heuristic estimate. */
export const createEmbeddingTokenEstimator = ({ estimate, receiver = null, fallback }) => {
  if (typeof estimate !== 'function') return null;
  if (typeof fallback !== 'function') throw new TypeError('Embedding token fallback required.');
  return async texts => {
    let original = null, inspectionFailed = false, boundaryFailed = false, release = null, estimatedValue = null;
    const requireSettled = observation => {
      try { observation?.requireSettled(); } catch (error) { boundaryFailed = true; throw terminal(error); }
    };
    const requireOriginal = () => requireSettled(original);
    const read = (value, field, observation) => {
      requireSettled(observation); let result;
      try { result = value?.[field]; }
      catch (inspection) { inspectionFailed = true; throw terminal(observation.retain(inspection, { inspectionPresent: true })); }
      requireSettled(observation); return result;
    };
    const releaseInvalidResult = async () => {
      if (!release) return;
      const ownedRelease = release; release = null;
      try {
        const completion = await Reflect.apply(ownedRelease, estimatedValue, []);
        requireSettled(observeStorageResource(completion, { phase: 'embedding-invalid-token-estimate-release' }));
      } catch (error) { inspectionFailed = true; throw terminal(original.retain(error, { inspectionPresent: true })); }
    };
    const releaseAfterFailure = async primary => {
      try { await releaseInvalidResult(); }
      catch (cleanup) { throw terminal(addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true })); }
    };
    try {
      const estimated = await Reflect.apply(estimate, receiver, [texts]);
      estimatedValue = estimated;
      original = observeStorageResource(estimated, { phase: 'embedding-token-estimate-result' }); requireOriginal();
      const originalRelease = read(estimated, 'release', original);
      release = typeof originalRelease === 'function' ? originalRelease : null;
      if (!Array.isArray(estimated) || read(estimated, 'length', original) !== texts.length) { await releaseInvalidResult(); return null; }
      const counts = new Array(texts.length);
      for (let index = 0; index < counts.length; index++) {
        const value = read(estimated, index, original);
        const numeric = ['number', 'string', 'bigint', 'boolean'].includes(typeof value) ? Math.floor(Number(value)) : NaN; requireOriginal();
        counts[index] = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback(texts[index]); requireOriginal();
      }
      if (release) Object.defineProperty(counts, 'release', {
        value: (...args) => Reflect.apply(originalRelease, estimated, args)
      });
      release = null;
      return counts;
    } catch (error) {
      if (boundaryFailed || inspectionFailed || isTerminalEmbeddingTokenEstimateFailure(error)) throw error;
      requireOriginal();
      const observation = observeStorageResource(error, { phase: 'embedding-token-estimation' }); requireSettled(observation);
      if (error instanceof AggregateError || read(error, 'name', observation) === 'AbortError' || read(error, 'code', observation) === 'ABORT_ERR') {
        await releaseAfterFailure(error); throw error;
      }
      await releaseAfterFailure(error);
      return null;
    }
  };
};

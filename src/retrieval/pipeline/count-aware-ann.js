import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../../shared/stable-json.js';
import { throwIfAborted } from '../../shared/abort.js';
import { decodeDenseVectorValidity } from '../../shared/dense-vector-validity.js';

export const COUNT_AWARE_ANN_VERSION = 1;
const bounds = Object.freeze({ exactRows: 512, coordinateWork: 8 * 1024 * 1024,
  maxAttempts: 4, requestedHitWork: 16384, maxTopN: 4096, maxMs: 2000 });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = message => Object.assign(new Error(message), { code: 'ERR_COUNT_AWARE_ANN_POLICY' });

/** No tuned route thresholds are shipped. Opt-in callers declare all bounds. */
export const resolveCountAwareAnnPolicy = input => {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'enabled' && !Object.hasOwn(bounds, key))) throw fail('Unknown count-aware ANN policy fields.');
  if (input.enabled === false) return null;
  if (input.enabled !== true) throw fail('Count-aware ANN opt-in must be explicit.');
  for (const [key, maximum] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(input[key]) || input[key] < (key === 'exactRows' ? 0 : 1)
      || input[key] > maximum) throw fail(`Explicit bounded ${key} is required.`);
  }
  const policy = { schemaVersion: COUNT_AWARE_ANN_VERSION,
    ...Object.fromEntries(Object.keys(bounds).map(key => [key, input[key]])) };
  return Object.freeze({ ...policy, key: digest(policy) });
};

/** A missing/unsupported cardinality is unknown, never an explicit empty set.
 * Lexical candidates are deliberately absent from this interface.
 */
export const eligibleAnnCardinality = (ids, documentCount = null) => {
  const count = ids == null ? documentCount : ids instanceof Set || Array.isArray(ids) ? ids.size ?? ids.length
    : typeof ids.getSize === 'function' ? ids.getSize()
      : typeof ids.size === 'function' ? ids.size() : ids.size;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

/** Copy just the admitted eligible uint8 rows. Full source ordinals stay outside
 * the dense temporary buffer, and sorted source IDs preserve production ties.
 * Unknown row coverage/quantization refuses exactness instead of guessing.
 */
export const snapshotCountAwareStoredDense = ({ dense, eligibleIds = null, documentCount, policy, signal }) => {
  const dims = dense?.dims, levels = dense?.levels, minVal = dense?.minVal, maxVal = dense?.maxVal;
  if (!Number.isSafeInteger(dims) || dims < 1 || !Number.isSafeInteger(levels) || levels < 2 || levels > 256
    || !Number.isFinite(minVal) || !Number.isFinite(maxVal) || !(maxVal > minVal)) return null;
  const scale = (maxVal - minVal) / (levels - 1);
  if (!Number.isFinite(scale) || dense.scale != null && dense.scale !== scale) return null;
  const sourceCount = dense.buffer instanceof Uint8Array ? dense.buffer.length / dims
    : Array.isArray(dense.vectors) ? dense.vectors.length : null;
  if (!Number.isSafeInteger(sourceCount) || sourceCount !== documentCount) return null;
  const iterator = eligibleIds == null ? (function* () { for (let id = 0; id < documentCount; id++) yield id; })()
    : typeof eligibleIds[Symbol.iterator] === 'function' ? eligibleIds : null;
  if (!iterator) return null;
  const sourceIds = [], seen = new Set();
  for (const id of iterator) {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(id) || id < 0 || id >= sourceCount || seen.has(id)
      || sourceIds.length >= policy.exactRows || (sourceIds.length + 1) * dims > policy.coordinateWork) return null;
    sourceIds.push(id); seen.add(id);
  }
  sourceIds.sort((a, b) => a - b);
  const bits = decodeDenseVectorValidity(dense), vectors = [];
  for (const id of sourceIds) {
    throwIfAborted(signal);
    if (bits && !(bits[id >> 3] & (1 << (id & 7)))) { vectors.push(new Uint8Array(0)); continue; }
    const row = dense.buffer instanceof Uint8Array ? dense.buffer.subarray(id * dims, (id + 1) * dims) : dense.vectors[id];
    if (!row?.length && !bits) { vectors.push(new Uint8Array(0)); continue; }
    if ((!Array.isArray(row) && !(row instanceof Uint8Array)) || row.length !== dims
      || row.some(value => !Number.isInteger(value) || value < 0 || value >= levels)) return null;
    vectors.push(Uint8Array.from(row));
  }
  return { sourceIds, index: { denseVec: { dims, levels, minVal, maxVal, scale, vectors } },
    retainedVectorBytes: sourceIds.length * dims };
};

export const planCountAwareAnn = ({ policy, eligibleIds = null, documentCount = null, dims = null,
  storedDenseAvailable = false, requestedTopN }) => {
  const count = eligibleAnnCardinality(eligibleIds, documentCount);
  const coordinates = count !== null && Number.isSafeInteger(dims) && dims > 0
    && Number.isSafeInteger(count * dims) ? count * dims : null;
  const route = count === 0 ? 'empty' : count !== null && count <= policy.exactRows
    && storedDenseAvailable && coordinates !== null && coordinates <= policy.coordinateWork ? 'stored-exhaustive' : 'ann';
  const reason = route === 'empty' ? 'eligible-empty' : route === 'stored-exhaustive' ? 'bounded-known-eligible-stored-set'
    : count === null ? 'eligible-count-unknown' : !storedDenseAvailable ? 'stored-dense-unavailable'
      : count > policy.exactRows ? 'eligible-set-above-exact-limit' : 'coordinate-work-unavailable-or-over-limit';
  return { schemaVersion: COUNT_AWARE_ANN_VERSION, policyKey: policy.key, route, reason,
    eligibleCount: count, countSource: eligibleIds == null ? 'selected-source-document-domain' : 'authoritative-eligible-id-domain',
    requestedTopN, target: count === null ? requestedTopN : Math.min(count, requestedTopN),
    storedCoordinateWork: coordinates };
};

/** One request owns all attempts and their requested effort. Native provider
 * internal work remains unknown unless separately measured; output fill is not
 * a recall certificate. Late native work is awaited by the normal provider path.
 */
export const createCountAwareAnnWork = ({ policy, plan, signal = null }) => {
  const deadline = performance.now() + policy.maxMs;
  const receipt = { ...plan, attempts: [], requestedHitWork: 0, coordinatesScored: 0,
    vectorsScored: 0, complete: false, exactness: 'unknown', reasonEnded: null,
    actualProviderWork: null, recallCertified: false };
  return { receipt,
    reserve(provider, topN, { exact = false } = {}) {
      throwIfAborted(signal);
      if (!Number.isSafeInteger(topN) || topN < 1) throw fail('An attempt requires a positive finite requested-hit bound.');
      if (receipt.reasonEnded === 'deadline') return null;
      const remaining = Math.ceil(deadline - performance.now());
      const reason = remaining <= 0 ? 'deadline' : receipt.attempts.length >= policy.maxAttempts ? 'attempt-limit'
        : topN > policy.maxTopN || receipt.requestedHitWork + topN > policy.requestedHitWork ? 'requested-hit-work-limit' : null;
      if (reason) { receipt.reasonEnded = reason; return null; }
      receipt.requestedHitWork += topN;
      const timeout = AbortSignal.timeout(remaining);
      const attempt = { provider, topN, route: exact ? 'stored-exhaustive' : 'ann', status: 'running', returned: null, nativeWork: null };
      receipt.attempts.push(attempt);
      return { attempt, timeout, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
    },
    finish({ hits = [], exact = false, empty = false, metrics = null } = {}) {
      if (metrics) { receipt.coordinatesScored = metrics.coordinatesScored || 0; receipt.vectorsScored = metrics.vectorsScored || 0; }
      receipt.returned = hits.length;
      receipt.complete = exact || empty;
      receipt.exactness = empty ? 'eligible-empty' : exact ? 'stored-affine-uint8-dot;not-original-fp32' : 'approximate-or-unknown';
      receipt.unscorableEligible = exact && plan.eligibleCount !== null ? plan.eligibleCount - receipt.vectorsScored : null;
      receipt.outputOmittedEligible = plan.eligibleCount !== null ? Math.max(0, plan.eligibleCount - hits.length) : null;
      if (!receipt.complete && !receipt.reasonEnded) receipt.reasonEnded = hits.length >= plan.target ? 'output-filled-recall-unknown' : 'underfilled-or-provider-unavailable';
      return receipt;
    }
  };
};

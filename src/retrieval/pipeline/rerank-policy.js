import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { createTopKReducer } from './topk.js';
import { captureRerankerAdapter } from './reranker-evidence-admission.js';

export const RERANK_POOL_POLICY_VERSION = 1;
const allowed = new Set(['enabled', 'candidateCap', 'poolCap', 'maxMs']);
const originalPolicies = new WeakMap();
const bind = (value, adapter = null, captured = null) => {
  const policy = Object.freeze(value); originalPolicies.set(policy, { adapter, captured, key: policy.key, value: policy }); return policy;
};
const capturePolicy = original => {
  if (original == null) return {};
  if (typeof original !== 'object' || Array.isArray(original)
    || Reflect.ownKeys(original).some(name => !allowed.has(name))) throw new TypeError('Unsupported rerank pool policy.');
  const value = {};
  for (const name of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(original, name);
    if (!descriptor) { if (name in original) throw new TypeError('Rerank pool policy requires original own data.'); continue; }
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Rerank pool policy requires original passive data.');
    value[name] = descriptor.value;
  }
  if (Object.hasOwn(value, 'enabled') && typeof value.enabled !== 'boolean') throw new TypeError('Rerank pool enabled requires original boolean data.');
  return value;
};
export const resolveRerankPoolPolicy = ({ adapter, policy = null, finalOutputCap }) => {
  policy = capturePolicy(policy);
  if (policy.enabled !== true) return bind({ schemaVersion: RERANK_POOL_POLICY_VERSION,
    enabled: false, finalOutputCap, poolCap: finalOutputCap, candidateCap: null, maxMs: 2000, key: null });
  if (!adapter) throw new TypeError('Experimental rerank pools require a pinned adapter identity.');
  const captured = captureRerankerAdapter(adapter);
  if (!/^[a-f0-9]{64}$/u.test(captured.identityKey || '')) throw new TypeError('Experimental rerank pools require a pinned adapter identity.');
  const value = { schemaVersion: RERANK_POOL_POLICY_VERSION, enabled: true, finalOutputCap,
    poolCap: policy.poolCap ?? 32, candidateCap: policy.candidateCap ?? 256, maxMs: policy.maxMs ?? 2000 };
  if (!Number.isSafeInteger(finalOutputCap) || finalOutputCap < 1 || finalOutputCap > 64
    || !Number.isSafeInteger(value.poolCap) || value.poolCap < finalOutputCap || value.poolCap > 64
    || !Number.isSafeInteger(value.candidateCap) || value.candidateCap < value.poolCap || value.candidateCap > 4096
    || !Number.isSafeInteger(value.maxMs) || value.maxMs < 1 || value.maxMs > 10000) throw new RangeError('Rerank candidate/pool/output/deadline policy exceeds its bounded domain.');
  return bind({ ...value, key: createHash('sha256').update(stableStringify({ ...value,
    adapter: captured.identityKey, candidateSelection: 'raw-fusion-score-then-ordinal.v1',
    poolSelection: 'production-gate-boost-diversity-graph.v1', finalSelection: 'rerank-score-then-source-rank.v1' })).digest('hex') }, adapter, captured);
};

/** A live expanded pool uses its original resolved policy producer and adapter
 * snapshot. Copied fields or a sibling adapter cannot authorize pinned work. */
export const assertRerankPoolAdapter = (policy, adapter, captured, policyKey, { finalOutputCap, maxMs, poolSize }) => {
  const original = originalPolicies.get(policy);
  if (!original || original.key !== policyKey) throw new TypeError('Rerank pool requires its original resolved policy identity.');
  if (original.value.finalOutputCap !== finalOutputCap || original.value.maxMs !== maxMs || poolSize > original.value.poolCap) {
    throw new TypeError('Rerank request differs from its original resolved pool/output/deadline policy.');
  }
  if (!original.captured) return;
  if (original.adapter !== adapter || ['id', 'identityKey', 'formattingIdentity', 'minimum', 'maximum', 'originalCallback']
    .some(name => original.captured[name] !== captured[name])) throw new TypeError('Rerank adapter changed after its original pinned policy was resolved.');
};

/** Candidate membership is capped deterministically before boosts. Eligibility
 * remains in the production rank owner for every retained member. This bound
 * is distinct from both the64-member model pool and final display output. */
export const capRerankCandidates = (scores, policy) => {
  if (!policy.enabled) return scores;
  const reducer = createTopKReducer({ k: policy.candidateCap });
  const entries = Array.isArray(scores) ? scores : scores.entries;
  const count = Array.isArray(scores) ? scores.length : scores.count;
  for (let index = 0; index < count; index++) {
    const row = entries[index];
    reducer.pushRaw(row.score, row.idx, index, { ...row });
  }
  return reducer.finish();
};

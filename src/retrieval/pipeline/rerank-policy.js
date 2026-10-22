import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { createTopKReducer } from './topk.js';

export const RERANK_POOL_POLICY_VERSION = 1;
const allowed = new Set(['enabled', 'candidateCap', 'poolCap', 'maxMs']);
export const resolveRerankPoolPolicy = ({ adapter, policy = null, finalOutputCap }) => {
  if (policy && (typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some(name => !allowed.has(name)))) throw new TypeError('Unsupported rerank pool policy.');
  if (policy?.enabled !== true) return Object.freeze({ schemaVersion: RERANK_POOL_POLICY_VERSION,
    enabled: false, finalOutputCap, poolCap: finalOutputCap, candidateCap: null, maxMs: 2000, key: null });
  if (!adapter || !/^[a-f0-9]{64}$/u.test(adapter.identityKey || '')) throw new TypeError('Experimental rerank pools require a pinned adapter identity.');
  const value = { schemaVersion: RERANK_POOL_POLICY_VERSION, enabled: true, finalOutputCap,
    poolCap: policy.poolCap ?? 32, candidateCap: policy.candidateCap ?? 256, maxMs: policy.maxMs ?? 2000 };
  if (!Number.isSafeInteger(finalOutputCap) || finalOutputCap < 1 || finalOutputCap > 64
    || !Number.isSafeInteger(value.poolCap) || value.poolCap < finalOutputCap || value.poolCap > 64
    || !Number.isSafeInteger(value.candidateCap) || value.candidateCap < value.poolCap || value.candidateCap > 4096
    || !Number.isSafeInteger(value.maxMs) || value.maxMs < 1 || value.maxMs > 10000) throw new RangeError('Rerank candidate/pool/output/deadline policy exceeds its bounded domain.');
  return Object.freeze({ ...value, key: createHash('sha256').update(stableStringify({ ...value,
    adapter: adapter.identityKey, candidateSelection: 'raw-fusion-score-then-ordinal.v1',
    poolSelection: 'production-gate-boost-diversity-graph.v1', finalSelection: 'rerank-score-then-source-rank.v1' })).digest('hex') });
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

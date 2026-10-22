import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { comparePairedQuality } from './paired-quality.js';
import { QUALITY_COMPARISON_VERSION } from '../../contracts/schemas/quality-comparison.js';
import { VECTOR_EVALUATION_VERSION } from '../../contracts/schemas/vector-evaluation.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const getters = Object.freeze({ annCandidateRecall: receipt => receipt.metrics?.annCandidateRecall?.value,
  annTopKRecall: receipt => receipt.metrics?.annTopKRecall?.value,
  quantizationAgreement: receipt => receipt.metrics?.quantizationAgreement?.value });
const fail = message => Object.assign(new Error(message), { code: 'ERR_PAIRED_QUALITY_INPUT' });
const hash = /^[a-f0-9]{64}$/u;

/** Existing independently produced oracle receipts remain authoritative.
 * Missing provenance refuses comparison rather than silently dropping a failed
 * task. Cutoff/work policy must agree across both saved receipt populations.
 */
export const compareVectorOracleQuality = async ({ baseline, candidate, metric = 'annCandidateRecall',
  seed = 'vector-quality-v1', cluster = 'repository', families = {}, resamples = 256,
  signal = null, limits = {}, resumeKey = null } = {}) => {
  if (!Object.hasOwn(getters, metric) || !Array.isArray(baseline) || !Array.isArray(candidate)
    || baseline.length > 256 || candidate.length > 256) throw fail('Bounded explicit oracle receipt populations and supported metric required.');
  const identities = new Set(), policies = new Set();
  const observations = receipts => receipts.map(receipt => {
    const provenance = receipt?.provenance, corpus = provenance?.corpus, query = provenance?.query;
    if (receipt?.schemaVersion !== VECTOR_EVALUATION_VERSION || receipt.kind !== 'retrieval-vector-oracle-receipt'
      || typeof receipt.complete !== 'boolean' || !hash.test(receipt.recordKey || '') || !hash.test(receipt.policyKey || '')
      || typeof corpus?.id !== 'string' || !corpus.id || corpus.id.length > 256 || !hash.test(corpus.sourceDigest || '')
      || !hash.test(corpus.generation || '') || typeof query?.id !== 'string' || !query.id || query.id.length > 256
      || !hash.test(query.textDigest || '') || !hash.test(query.filterDigest || '') || !provenance.embedding) throw fail('Incomplete oracle source/query/cutoff identity cannot authorize pairing.');
    const familyId = families && Object.hasOwn(families, corpus.id) ? families[corpus.id] : null;
    if (familyId !== null && (typeof familyId !== 'string' || !familyId || familyId.length > 256)) throw fail('Repository-family assignments require bounded explicit string identities.');
    if (cluster === 'family' && !familyId) throw fail('Family resampling requires an explicit repository-family assignment.');
    policies.add(receipt.policyKey);
    identities.add(digest([provenance.embedding, receipt.recordKey, corpus.generation]));
    const value = receipt.complete ? getters[metric](receipt) : null;
    const status = receipt.complete ? Number.isFinite(value) ? 'complete' : 'missing'
      : receipt.reason === 'cancelled' ? 'cancelled' : receipt.reason === 'deadline' ? 'timeout' : 'failed';
    const taskKey = digest([corpus.id, query.id, query.textDigest, query.filterDigest]);
    return { taskKey, inputKey: digest([corpus.sourceDigest, query.id, query.textDigest, query.filterDigest, metric]),
      repoId: corpus.id, familyId: familyId || corpus.id, slice: 'vector-oracle', status,
      value: status === 'complete' ? value : null };
  });
  const left = observations(baseline), baselineIdentities = [...identities].sort(); identities.clear();
  const right = observations(candidate), candidateIdentities = [...identities].sort();
  if (policies.size > 1) throw fail('Oracle cutoff/work policies differ; quality definitions cannot be paired.');
  return comparePairedQuality({ schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
    metric: { name: metric, definitionKey: digest(['independent-vector-oracle-quality.v1', metric, [...policies][0] || null]), unit: 'quality-unit-interval' },
    baselineKey: digest(baselineIdentities), candidateKey: digest(candidateIdentities), cluster, seed, resamples,
    slices: [], baseline: left, candidate: right }, { signal, limits, resumeKey });
};

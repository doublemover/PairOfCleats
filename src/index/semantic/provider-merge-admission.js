import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const MAX_INPUT_BYTES = 64 * 1024 * 1024, MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_DESCRIPTOR_VISITS = 262144, MAX_WORK = 4000000;
const exhausted = allowance => Object.assign(new RangeError('Semantic provider batch exceeds ' + allowance + '.'),
  { code: 'ERR_SEMANTIC_PROVIDER_BUDGET', allowance });

/** Invocation-local passive snapshots and index admission. These bound logical
 * JSON/index bytes and structural visits, not caller storage or process RSS.
 * No captured object, root or verification receipt is reused by another merge.
 */
export const createProviderMergeAdmission = signal => {
  const work = { inputBytes: 0, indexBytes: 0, work: 0, descriptorVisits: 0,
    rootDerivations: 0, generationKeys: 0, groupPreparations: 0, inventoryPreparations: 0,
    contextSourceVisits: 0, memberRowsValidated: 0, currentFiles: 0 };
  const check = () => { throwIfAborted(signal); if (++work.work > MAX_WORK) throw exhausted('structural-work'); };
  const capture = value => {
    check(); const remaining = MAX_INPUT_BYTES - work.inputBytes;
    if (remaining < 1) throw exhausted('aggregate-input-bytes');
    const canonical = canonicalSemanticJson(value, { maxBytes: remaining, check });
    work.inputBytes += Buffer.byteLength(canonical);
    return { value: JSON.parse(canonical), canonical };
  };
  const identity = value => {
    check(); const remaining = MAX_INDEX_BYTES - work.indexBytes;
    if (remaining < 1) throw exhausted('prepared-index-bytes');
    const canonical = canonicalSemanticJson(value, { maxBytes: remaining, check });
    work.indexBytes += Buffer.byteLength(canonical);
    return canonical;
  };
  return {
    work, check, capture, identity,
    visit() {
      check(); if (++work.descriptorVisits > MAX_DESCRIPTOR_VISITS) throw exhausted('descriptor-visits');
      if (128 > MAX_INDEX_BYTES - work.indexBytes) throw exhausted('prepared-index-bytes');
      work.indexBytes += 128;
    },
    matchesCurrent(value, canonical) {
      check();
      return canonicalSemanticJson(value, { maxBytes: Math.max(1, Buffer.byteLength(canonical)), check }) === canonical;
    },
    snapshot: () => Object.freeze({ ...work })
  };
};

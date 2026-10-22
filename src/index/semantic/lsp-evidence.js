import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { retainSemanticBytes } from './disk-writes.js';
export const SEMANTIC_EVIDENCE_MAX_BYTES = 1048576;
/** Own protocol data under the same allowance used by the durable sidecar. */
export const encodeSemanticEvidence = (value, { signal = null, maxBytes = SEMANTIC_EVIDENCE_MAX_BYTES } = {}) => {
  throwIfAborted(signal);
  try { return canonicalSemanticJson(value, { maxBytes, check: () => throwIfAborted(signal) }); }
  catch (error) {
    if (error?.code !== 'ERR_SEMANTIC_JSON_BUDGET') throw error;
    throw Object.assign(new Error('Semantic evidence exceeds immutable sidecar budget.', { cause: error }), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
  }
};
/** Immutable registered sidecar. No URI/path in server data is used as a write path. */
export const persistSemanticEvidence = async ({ value, stagingRoot, relativeRoot, diskAccount, inventory, signal = null, maxBytes = SEMANTIC_EVIDENCE_MAX_BYTES }) => {
  const encoded = encodeSemanticEvidence(value, { maxBytes, signal });
  const bytes = Buffer.from(encoded);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const relative = 'semantic-evidence/' + hash + '.json';
  const record = { path: (relativeRoot ? relativeRoot.replaceAll('\\', '/') + '/' : '') + relative, hash, bytes: bytes.length };
  const prior = inventory.find(entry => entry.path === record.path);
  if (prior && (prior.hash !== hash || prior.bytes !== bytes.length)) throw new Error('Evidence inventory collision.');
  const directory = path.join(stagingRoot, 'semantic-evidence'), target = path.join(directory, hash + '.json');
  await retainSemanticBytes({ filename: target, bytes, diskAccount, signal });
  if (!prior) inventory.push(record);
  return record.path;
};

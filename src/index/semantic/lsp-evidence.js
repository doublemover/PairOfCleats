import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { retainSemanticBytes } from './disk-writes.js';
/** Immutable registered sidecar. No URI/path in server data is used as a write path. */
export const persistSemanticEvidence = async ({ value, stagingRoot, relativeRoot, diskAccount, inventory, signal = null, maxBytes = 1048576 }) => {
  throwIfAborted(signal);
  const bytes = Buffer.from(canonicalSemanticJson(value));
  if (bytes.length > maxBytes) throw Object.assign(new Error('Semantic evidence exceeds immutable sidecar budget.'), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
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

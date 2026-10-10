import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Immutable registered sidecar. No URI/path in server data is used as a write path. */
export const persistSemanticEvidence = async ({ value, stagingRoot, relativeRoot, diskAccount, inventory, signal = null, maxBytes = 1048576 }) => {
  throwIfAborted(signal);
  const bytes = Buffer.from(canonicalSemanticJson(value));
  if (bytes.length > maxBytes) throw Object.assign(new Error('Semantic evidence exceeds immutable sidecar budget.'), { code: 'ERR_SEMANTIC_EVIDENCE_BUDGET' });
  const hash = createHash('sha256').update(bytes).digest('hex');
  const relative = 'semantic-evidence/' + hash + '.json';
  const record = { path: (relativeRoot ? relativeRoot.replaceAll('\\', '/') + '/' : '') + relative, hash, bytes: bytes.length };
  const prior = inventory.find(entry => entry.path === record.path);
  if (prior) { if (prior.hash !== hash || prior.bytes !== bytes.length) throw new Error('Evidence inventory collision.'); return record.path; }
  const directory = path.join(stagingRoot, 'semantic-evidence'), target = path.join(directory, hash + '.json');
  await fs.mkdir(directory, { recursive: true });
  diskAccount.reserve(bytes.length);
  let handle, created = false;
  try {
    try { handle = await fs.open(target, 'wx'); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await fs.readFile(target); if (!existing.equals(bytes)) throw new Error('Evidence sidecar hash collision.'); }
    if (handle) { await handle.writeFile(bytes); throwIfAborted(signal); await handle.sync(); await handle.close(); handle = null; }
    inventory.push(record); return record.path;
  } catch (error) { if (handle) await handle.close(); if (created) await fs.rm(target, { force: true }); diskAccount.release(bytes.length); throw error; }
};

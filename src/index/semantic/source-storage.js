import path from 'node:path';
import { createHash } from 'node:crypto';
import { retainSemanticBytes } from './disk-writes.js';

/** Persist exact original UTF-8 bytes once, without replacing an existing blob. */
export const retainSemanticSource = async ({ root, source, bytes, diskAccount, signal = null }) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== source.byteLength
    || createHash('sha256').update(bytes).digest('hex') !== source.byteHash) {
    throw new Error('Semantic source bytes do not match the exact source manifest.');
  }
  await retainSemanticBytes({ filename: path.join(root, 'semantic-sources', source.byteHash + '.utf8'), bytes, diskAccount, signal });
};

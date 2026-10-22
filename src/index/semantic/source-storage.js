import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { retainSemanticBytes, withSemanticDiskWriter } from './disk-writes.js';
import { readSemanticSourceCapability } from './source-capability.js';
import { throwIfAborted } from '../../shared/abort.js';

const receiptsByAccount = new WeakMap();
const MAX_RECEIPTS = 256;
const authorityKey = stat => stat?.isFile() && !stat.isSymbolicLink() && stat.ino > 0n && stat.dev !== 0n
  && typeof stat.mtimeNs === 'bigint' && typeof stat.ctimeNs === 'bigint' && stat.ctimeNs > 0n
  ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':') : null;

/** Exact source retention; receipts never retain source bytes or cross accounts. */
export const retainSemanticSource = async ({ root, source, bytes, sourceCapability = null, diskAccount, signal = null }) => {
  throwIfAborted(signal);
  const capability = readSemanticSourceCapability(sourceCapability);
  let owned = null;
  if (sourceCapability && !capability) throw new TypeError('Unrecognized semantic source capability.');
  if (capability) {
    if (capability.byteLength !== source.byteLength || capability.byteHash !== source.byteHash) throw new Error('Semantic source capability identity mismatch.');
  } else {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Exact source bytes are required.');
    // Raw callers remain untrusted, including changes after an awaited IO call.
    owned = Buffer.from(bytes);
    if (owned.length !== source.byteLength || createHash('sha256').update(owned).digest('hex') !== source.byteHash) throw new Error('Semantic source bytes do not match the exact source manifest.');
  }
  const filename = path.resolve(root, 'semantic-sources', source.byteHash + '.utf8');
  let receipts = receiptsByAccount.get(diskAccount);
  if (!receipts) { receipts = new Map(); receiptsByAccount.set(diskAccount, receipts); }
  const receiptKey = filename + ':' + source.byteHash + ':' + source.byteLength;
  return withSemanticDiskWriter(diskAccount, filename, async () => {
    throwIfAborted(signal);
    const previous = receipts.get(receiptKey);
    if (previous) {
      try {
        const current = authorityKey(await fs.lstat(filename, { bigint: true }));
        if (current && current === previous) {
          receipts.delete(receiptKey); receipts.set(receiptKey, previous);
          return;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      receipts.delete(receiptKey);
    }
    const payload = owned || Buffer.from(capability.text, 'utf8');
    const verified = await retainSemanticBytes({ filename, bytes: payload, diskAccount, signal });
    throwIfAborted(signal);
    const authority = authorityKey(verified);
    if (authority) {
      receipts.set(receiptKey, authority);
      while (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value);
    }
  });
};

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { throwIfAborted } from '../../shared/abort.js';

/** Persist exact original UTF-8 bytes once, without replacing an existing blob. */
export const retainSemanticSource = async ({ root, source, bytes, diskAccount, signal = null }) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== source.byteLength
    || createHash('sha256').update(bytes).digest('hex') !== source.byteHash) {
    throw new Error('Semantic source bytes do not match the exact source manifest.');
  }
  const directory = path.join(root, 'semantic-sources');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, source.byteHash + '.utf8');
  const verifyExisting = async () => {
    const existing = await fs.readFile(target);
    if (existing.byteLength !== bytes.byteLength
      || createHash('sha256').update(existing).digest('hex') !== source.byteHash) {
      throw new Error('Conflicting semantic source blob.');
    }
  };
  try { await verifyExisting(); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  throwIfAborted(signal);
  diskAccount.reserve(bytes.byteLength);
  const temporary = path.join(directory, '.source-' + randomUUID());
  let retained = false;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    throwIfAborted(signal);
    try {
      await fs.link(temporary, target);
      retained = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verifyExisting();
    }
  } finally {
    await fs.rm(temporary, { force: true });
    if (!retained) diskAccount.release(bytes.byteLength);
  }
};

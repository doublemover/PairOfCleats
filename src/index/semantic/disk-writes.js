import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { syncParentDirectory } from '../../shared/io/persistence-helpers.js';
import { throwIfAborted } from '../../shared/abort.js';

const writers = new WeakMap();
export const withSemanticDiskWriter = async (account, filename, write) => {
  let pending = writers.get(account);
  if (!pending) { pending = new Map(); writers.set(account, pending); }
  const key = path.resolve(filename), prior = pending.get(key) || Promise.resolve();
  const operation = prior.catch(() => {}).then(write);
  pending.set(key, operation);
  try { return await operation; }
  finally { if (pending.get(key) === operation) pending.delete(key); }
};

/** Mutable metadata keeps both old and temporary bytes admitted until rename.
 * Uncertain failures retain credits; reopening counts the physical inventory.
 */
export const writeSemanticJson = async ({ filename, value, diskAccount, signal = null }) => {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  return withSemanticDiskWriter(diskAccount, filename, async () => {
    throwIfAborted(signal);
    let oldBytes = 0;
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Semantic metadata must be a regular file.');
      oldBytes = stat.nlink === 1 ? stat.size : 0;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    diskAccount.reserve(bytes.length);
    await atomicWriteText(filename, bytes, { newline: false });
    diskAccount.release(oldBytes);
    return bytes.length;
  });
};

/** Immutable publication never exposes a partial final name. The winner and
 * its parent directory are durable before its caller may record a reference.
 */
export const retainSemanticBytes = async ({ filename, bytes, diskAccount, signal = null }) => {
  const verify = async () => {
    const listed = await fs.lstat(filename, { bigint: true });
    if (!listed.isFile() || listed.isSymbolicLink()) throw new Error('Semantic immutable storage must be a regular file.');
    const handle = await fs.open(filename, 'r');
    let primaryError = null;
    try {
      const before = await handle.stat({ bigint: true });
      if (before.dev !== listed.dev || before.ino !== listed.ino || before.size !== BigInt(bytes.byteLength)) throw new Error('Semantic immutable storage authority changed.');
      const actual = await handle.readFile();
      const expected = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (!actual.equals(expected)) throw Object.assign(new Error('Conflicting immutable semantic bytes.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
      const after = await handle.stat({ bigint: true }), current = await fs.lstat(filename, { bigint: true });
      const stable = stat => stat.isFile() && !stat.isSymbolicLink() && stat.dev === before.dev && stat.ino === before.ino
        && stat.size === before.size && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs;
      if (!stable(after) || !stable(current)) throw new Error('Semantic immutable storage changed during verification.');
      return after;
    } catch (error) { primaryError = error; throw error; }
    finally {
      try { await handle.close(); } catch (error) { if (primaryError) primaryError.cleanupError = error; else throw error; }
    }
  };
  throwIfAborted(signal);
  try { return await verify(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(filename), { recursive: true });
  diskAccount.reserve(bytes.length);
  const temporary = path.join(path.dirname(filename), '.pending-' + randomUUID());
  let retained = false;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    throwIfAborted(signal);
    try { await fs.link(temporary, filename); retained = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await verify(); }
    await syncParentDirectory(filename);
    await syncParentDirectory(path.dirname(filename));
    return await verify();
  } finally {
    await fs.rm(temporary, { force: true });
    if (!retained) diskAccount.release(bytes.length);
  }
};

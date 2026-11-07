import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from './io/atomic-write.js';

const ownedFileBytes = async filename => {
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size)) {
      throw new TypeError('Merge disk accounting requires a regular task-owned file.');
    }
    // A second hard link may keep these physical bytes alive after replacement.
    return stat.nlink === 1 ? stat.size : 0;
  } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};

/** Reuse the caller's disk owner. Old and atomic replacement bytes coexist
 * until the writer confirms publication. Uncertain failed writes keep credits
 * until the existing recovery inventory reopens the physical working set. */
export const beginMergeDiskOutput = async (filename, diskAccount = null) => {
  if (diskAccount && (typeof diskAccount.reserve !== 'function' || typeof diskAccount.release !== 'function')) {
    throw new TypeError('Shared merge disk account required.');
  }
  const oldBytes = diskAccount ? await ownedFileBytes(filename) : 0;
  let reserved = 0, committed = false;
  return {
    reserve(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || committed) throw new TypeError('Invalid merge disk reservation.');
      diskAccount?.reserve(bytes); reserved += bytes;
    },
    async commit() {
      if (committed) throw new Error('Merge disk output committed twice.');
      if (diskAccount) {
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== reserved) {
          throw new Error('Merge disk output differs from its admitted encoded bytes.');
        }
        diskAccount.release(oldBytes);
      }
      committed = true;
    }
  };
};

export const writeMergeDiskJson = async (filename, value, { diskAccount = null, spaces = 0 } = {}) => {
  const output = await beginMergeDiskOutput(filename, diskAccount);
  output.reserve(Buffer.byteLength(JSON.stringify(value, null, spaces)));
  await atomicWriteJson(filename, value, { spaces, newline: false });
  await output.commit();
};

/** Only call after the task's readers have closed. Removal failure retains its
 * credits; missing paths do not authorize release of an imagined file. */
export const removeMergeDiskFile = async (filename, diskAccount = null) => {
  const bytes = diskAccount ? await ownedFileBytes(filename) : 0;
  await fs.rm(filename, { force: true });
  diskAccount?.release(bytes);
};

export const removeMergeDiskDirectory = async (directory, diskAccount = null) => {
  if (!diskAccount) { await fs.rm(directory, { recursive: true, force: true }); return; }
  let bytes = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new TypeError('Merge working directory cannot contain symbolic links.');
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(current)) pending.push(path.join(current, name));
    } else bytes += await ownedFileBytes(current);
  }
  await fs.rm(directory, { recursive: true, force: true });
  diskAccount.release(bytes);
};

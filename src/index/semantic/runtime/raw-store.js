import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';

export const runtimeImportError = (message, code = 'ERR_RUNTIME_IMPORT_INTEGRITY') => Object.assign(new Error(message), { code });
export const runtimeByteHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const assertRuntimeDiskReserve = async ({ destination, diskReserveBytes, additionalBytes = 0 }) => {
  const stat = await fs.statfs(destination, { bigint: true });
  if (stat.bavail * stat.bsize < BigInt(diskReserveBytes) + BigInt(additionalBytes)) {
    throw runtimeImportError('Runtime import would violate minimum free disk reserve.', 'ERR_RUNTIME_DISK_RESERVE');
  }
};

/** Fixed working buffer; exact hash and size dominate all caller-supplied metadata. */
export const hashRuntimeFile = async ({ filename, expectedHash, expectedBytes, maxBytes, signal = null }) => {
  const handle = await fs.open(filename, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes || stat.size !== expectedBytes) throw runtimeImportError('Runtime raw size exceeds authority or allowance.');
    for (;;) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > maxBytes || bytes > expectedBytes) throw runtimeImportError('Runtime raw input changed while reading.');
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    if (bytes !== expectedBytes || hash.digest('hex') !== expectedHash) throw runtimeImportError('Runtime raw checksum differs from import authority.');
    return bytes;
  } finally { await handle.close(); }
};

/** Retain a byte-for-byte immutable CAS copy. Existing blobs are verified, never overwritten. */
export const retainRuntimeRaw = async ({ destination, inputPath, artifact, maxBytes, diskAccount,
  diskReserveBytes, signal = null }) => {
  await hashRuntimeFile({ filename: inputPath, expectedHash: artifact.hash, expectedBytes: artifact.byteLength, maxBytes, signal });
  const rawDirectory = path.join(destination, 'raw');
  await fs.mkdir(rawDirectory, { recursive: true });
  const destinationReal = await fs.realpath(destination);
  const rawReal = await fs.realpath(rawDirectory);
  if (path.relative(destinationReal, rawReal).startsWith('..')) throw runtimeImportError('Runtime raw store escapes destination.');
  const storageRef = 'raw/' + artifact.hash + '.bin';
  const finalPath = path.join(destination, storageRef);
  const verify = () => hashRuntimeFile({ filename: finalPath, expectedHash: artifact.hash,
    expectedBytes: artifact.byteLength, maxBytes, signal });
  try { await fs.access(finalPath); await verify(); return { ...artifact, retained: true, storageRef }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pending = await fs.mkdtemp(path.join(rawReal, '.pending-'));
  const temporary = path.join(pending, 'bytes');
  let reserved = false;
  let retained = false;
  try {
    await assertRuntimeDiskReserve({ destination, diskReserveBytes, additionalBytes: artifact.byteLength });
    diskAccount.reserve(artifact.byteLength); reserved = true;
    const source = await fs.open(inputPath, 'r');
    let target = null;
    const buffer = Buffer.alloc(64 * 1024);
    try {
      target = await fs.open(temporary, 'wx');
      let size = 0;
      for (;;) {
        throwIfAborted(signal);
        const read = await source.read(buffer, 0, buffer.length, null);
        if (!read.bytesRead) break;
        size += read.bytesRead;
        if (size > artifact.byteLength) throw runtimeImportError('Runtime input grew during retention.');
        await target.writeFile(buffer.subarray(0, read.bytesRead));
      }
      await target.sync();
    } finally { await source.close(); if (target) await target.close(); }
    await hashRuntimeFile({ filename: temporary, expectedHash: artifact.hash, expectedBytes: artifact.byteLength, maxBytes, signal });
    await assertRuntimeDiskReserve({ destination, diskReserveBytes });
    throwIfAborted(signal);
    try { await fs.link(temporary, finalPath); retained = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await verify(); }
    return { ...artifact, retained: true, storageRef };
  } finally {
    await fs.rm(pending, { recursive: true, force: true });
    if (reserved && !retained) diskAccount.release(artifact.byteLength);
  }
};

/** UTF-8 byte ranges remain exact even for CRLF and non-ASCII. Oversize lines are discarded, not accumulated. */
export async function* readRuntimeLines({ filename, maxLineBytes, signal = null }) {
  const handle = await fs.open(filename, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  let fragments = [], length = 0, start = 0, position = 0, oversized = false;
  try {
    for (;;) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      let cursor = 0;
      for (let i = 0; i < read.bytesRead; i += 1) if (buffer[i] === 10) {
        length += i - cursor;
        if (!oversized && length <= maxLineBytes) fragments.push(Buffer.from(buffer.subarray(cursor, i)));
        else { oversized = true; fragments = []; }
        const end = position + i + 1;
        yield { bytes: oversized ? null : Buffer.concat(fragments, length), start, end, terminated: true, oversized };
        start = end; fragments = []; length = 0; oversized = false; cursor = i + 1;
      }
      length += read.bytesRead - cursor;
      if (!oversized && length <= maxLineBytes) fragments.push(Buffer.from(buffer.subarray(cursor, read.bytesRead)));
      else { oversized = true; fragments = []; }
      position += read.bytesRead;
    }
    if (length) yield { bytes: oversized ? null : Buffer.concat(fragments, length), start, end: position, terminated: false, oversized };
  } finally { await handle.close(); }
}

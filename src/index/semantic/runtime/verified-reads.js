import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openContainedFile, readVerifiedContainedFile, verifyContainedFileHandle } from '../../../shared/contained-file.js';
import { closeRuntimeResources } from './close-resources.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { runtimeImportError } from './raw-store.js';

export const readRuntimeMemberBytes = async ({ root, relativePath, expectedHash = null,
  expectedBytes = null, maxBytes, signal = null, metrics = null }) => {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.startsWith('/')
    || relativePath.split('/').some(part => !part || part === '.' || part === '..')) throw runtimeImportError('Invalid runtime member path.');
  try {
    return await readVerifiedContainedFile(root, path.join(root, relativePath), { maxBytes,
      expectedHash, expectedBytes, signal, metrics });
  } catch (error) {
    if (['ERR_FILE_TOO_LARGE', 'ERR_FILE_CHANGED', 'ERR_FILE_INTEGRITY', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) {
      throw runtimeImportError(error.message);
    }
    throw error;
  }
};
export const readRuntimeMemberJson = async options => {
  const read = await readRuntimeMemberBytes(options);
  return { ...read, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.buffer)) };
};

/** Hash one contained descriptor and retain that same opened immutable object. */
export const openVerifiedRuntimeMember = async ({ root, relativePath, expectedHash, expectedBytes,
  maxBytes, signal = null, metrics = null }) => {
  const filename = path.join(root, relativePath);
  const handle = await openContainedFile(root, filename);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== expectedBytes || stat.size > maxBytes) throw runtimeImportError('Runtime member size exceeds its pinned allowance.');
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let position = 0;
    for (;;) {
      throwIfAborted(signal);
      const read = await handle.read(buffer, 0, buffer.length, position);
      if (!read.bytesRead) break;
      position += read.bytesRead;
      if (position > expectedBytes) throw runtimeImportError('Runtime member grew during verification.');
      hash.update(buffer.subarray(0, read.bytesRead));
      if (metrics) metrics.verificationBytes = (metrics.verificationBytes || 0) + read.bytesRead;
    }
    const after = await handle.stat(), current = await fs.stat(filename);
    if (position !== expectedBytes || hash.digest('hex') !== expectedHash
      || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => stat[key] !== after[key])
      || current.dev !== stat.dev || current.ino !== stat.ino) throw runtimeImportError('Runtime member changed during verification.');
    verifyContainedFileHandle(handle, root, filename);
    return handle;
  } catch (error) {
    if (error.code === 'ERR_UNSAFE_FILE_PATH') error = runtimeImportError(error.message);
    await closeRuntimeResources([handle], error);
  }
};

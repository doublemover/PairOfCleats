import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { BACKEND_INVENTORY_LIMITS, listBackendPayloadEntries as listPayload } from '../../../src/shared/artifact-io/backend-payload-inventory.js';
export { inventoryBackendPayload } from '../../../src/shared/artifact-io/backend-payload-inventory.js';

const MAX_FILES = BACKEND_INVENTORY_LIMITS.entries, MAX_INVENTORY_BYTES = BACKEND_INVENTORY_LIMITS.bytes, WINDOW_BYTES = BACKEND_INVENTORY_LIMITS.windowBytes;
const changed = () => Object.assign(new Error('Immutable native backend bytes changed during reuse.'), { code: 'ERR_ANN_REUSE_INTEGRITY' });
const sameStat = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const digestFor = async checksum => {
  const match = /^(sha256|sha1|xxh64):([a-f0-9]+)$/i.exec(checksum || '');
  if (!match || match[2].length !== ({ sha256: 64, sha1: 40, xxh64: 16 })[match[1].toLowerCase()]) throw changed();
  return { expected: match[2].toLowerCase(), hasher: match[1].toLowerCase() === 'xxh64'
    ? await createXxhash64Hasher() : createHash(match[1].toLowerCase()) };
};

/** Copy descriptor bytes into private staging, verifying the declared digest.
 * No source payload buffer or native handle survives one bounded window. */
export const copyBackendPayloadFile = async ({ sourceRoot, source, target, bytes, checksum, signal = null, metrics = null }) => {
  const { expected, hasher } = await digestFor(checksum);
  throwIfAborted(signal);
  const input = await openContainedFile(sourceRoot, source);
  let output = null, primary = null;
  try {
    const before = await input.stat({ bigint: true });
    if (!Number.isSafeInteger(bytes) || bytes < 0 || before.size !== BigInt(bytes)) throw changed();
    await fs.mkdir(path.dirname(target), { recursive: true });
    output = await fs.open(target, 'wx');
    const window = Buffer.alloc(Math.min(WINDOW_BYTES, Math.max(1, bytes)));
    let position = 0;
    while (position < bytes) {
      throwIfAborted(signal);
      const remaining = Math.min(window.length, bytes - position);
      const { bytesRead } = await input.read(window, 0, remaining, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > remaining) throw changed();
      hasher.update(window.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        throwIfAborted(signal);
        const progress = (await output.write(window, written, bytesRead - written, position + written)).bytesWritten;
        if (!Number.isSafeInteger(progress) || progress <= 0 || progress > bytesRead - written) throw changed();
        written += progress;
      }
      position += bytesRead;
      if (metrics) metrics.copiedBytes = (metrics.copiedBytes || 0) + bytesRead;
    }
    verifyContainedFileHandle(input, sourceRoot, source);
    if (!sameStat(before, await input.stat({ bigint: true })) || hasher.digest('hex') !== expected) throw changed();
    await output.sync();
  } catch (error) { primary = error; if (output) error.backendCopyTargetCreated = true; throw error; }
  finally {
    const errors = [];
    for (const handle of [output, input]) try { await handle?.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw Object.assign(new AggregateError(primary ? [primary, ...errors] : errors,
      'Native backend copy failed to close its descriptors.', { cause: primary || errors[0] }), { backendCopyTargetCreated: output !== null });
  }
};

export const copyBackendPayloadInventory = async ({ sourceRoot, targetRoot, inventory, signal = null, metrics = null }) => {
  if (inventory?.version !== 1 || !Array.isArray(inventory.entries) || inventory.entries.length > MAX_FILES
    || Buffer.byteLength(JSON.stringify(inventory)) > MAX_INVENTORY_BYTES) throw changed();
  const actual = await listPayload(sourceRoot, signal), names = new Set();
  const expected = inventory.entries.map(({ checksum: unused, ...entry }) => { void unused; return entry; });
  if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) throw changed();
  await fs.mkdir(targetRoot);
  try { for (const entry of inventory.entries) {
    throwIfAborted(signal);
    if (typeof entry.path !== 'string' || names.has(entry.path) || !entry.path || entry.path.includes('\\') || entry.path.includes(':')
      || path.posix.isAbsolute(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw changed();
    names.add(entry.path);
    const target = path.join(targetRoot, entry.path);
    if (entry.kind === 'dir') await fs.mkdir(target, { recursive: true });
    else if (entry.kind === 'file') await copyBackendPayloadFile({ sourceRoot, source: path.join(sourceRoot, entry.path), target,
      bytes: entry.bytes, checksum: entry.checksum, signal, metrics });
    else throw changed();
  } } catch (error) { error.backendCopyTargetCreated = true; throw error; }
};

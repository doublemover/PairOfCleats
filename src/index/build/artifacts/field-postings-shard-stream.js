import { createHash } from 'node:crypto';
import { withContainedFile } from '../../../shared/contained-file.js';
import { readExactAt } from '../../../shared/io/read-exact.js';
import { throwIfAborted } from '../../../shared/abort.js';

const PREFIX = Buffer.from('{"fields":{');
const SUFFIX = Buffer.from('}}\n');
const fail = message => Object.assign(new Error('[field-postings] ' + message), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
const same = (left, right) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => left[key] === right[key]);
/** Copy only body bytes from a freshly matched, completed shard; no whole-shard UTF-8 string exists. */
export const streamFieldPostingsShardBody = async ({ root, filename, expected, onStart = null, onChunk,
  signal = null, metrics = {}, fragment = false }) => {
  const prefixBytes = fragment ? 0 : PREFIX.length, suffixBytes = fragment ? 0 : SUFFIX.length;
  if (!Number.isSafeInteger(expected?.bytes) || expected.bytes < prefixBytes + suffixBytes
    || expected.checksumAlgo !== 'sha1' || typeof expected.checksum !== 'string' || !/^[0-9a-f]{40}$/.test(expected.checksum)) {
    throw fail('Completed shard integrity receipt is required.');
  }
  throwIfAborted(signal);
  const populated = await withContainedFile(root, filename, async handle => {
    const before = await handle.stat();
    if (before.size !== expected.bytes) throw fail('Completed shard length changed.');
    const prefix = Buffer.alloc(prefixBytes), suffix = Buffer.alloc(suffixBytes);
    const first = await readExactAt(handle, prefix, 0, prefix.length, 0, { signal });
    const last = await readExactAt(handle, suffix, 0, suffix.length, before.size - suffix.length, { signal });
    if (first.bytesRead !== prefix.length || last.bytesRead !== suffix.length
      || (!fragment && (!prefix.equals(PREFIX) || !suffix.equals(SUFFIX)))) throw fail('Completed shard framing changed.');
    const hash = createHash('sha1').update(prefix);
    const end = before.size - suffix.length;
    let position = prefix.length;
    const buffer = Buffer.alloc(Math.min(65536, Math.max(1, end - position)));
    if (position < end) await onStart?.();
    while (position < end) {
      throwIfAborted(signal);
      const length = Math.min(buffer.length, end - position);
      const { bytesRead } = await readExactAt(handle, buffer, 0, length, position, { signal });
      if (bytesRead !== length) throw fail('Completed shard was truncated.');
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      // Writable acceptance may precede actual consumption; transfer a private bounded copy.
      await onChunk(Buffer.from(chunk));
      position += bytesRead;
      metrics.readBytes = (metrics.readBytes || 0) + bytesRead;
      metrics.readChunkBytesHighWater = Math.max(metrics.readChunkBytesHighWater || 0, bytesRead);
    }
    hash.update(suffix);
    if (hash.digest('hex') !== expected.checksum) throw fail('Completed shard checksum changed.');
    const after = await handle.stat(); handle.verify();
    if (!same(before, after)) throw fail('Completed shard changed during merge.');
    throwIfAborted(signal);
    return end > prefix.length;
  });
  // Completion is a witness only after the original read/close owner settles.
  metrics.shardsRead = (metrics.shardsRead || 0) + 1;
  metrics.readBytes = (metrics.readBytes || 0) + prefixBytes + suffixBytes;
  return populated;
};

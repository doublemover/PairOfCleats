import { iterateContainedFile } from '../../../shared/contained-file.js';
import { VFS_COLD_METADATA_MAX_BYTES, VFS_COLD_MAX_ENTRIES, VFS_COLD_MAX_ROW_BYTES } from './cold-start-owner.js';

const fail = reason => { throw Object.assign(new Error(`VFS cold cache input rejected: ${reason}.`), {
  code: 'ERR_VFS_COLD_CACHE_INPUT', reason
}); };
const keys = ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'];

/** One bounded raw chunk and line, no full-file text or row array. Original
 * descriptor work/close is joined by the shared contained generator owner. */
export const readColdStartRows = (root, file, counters) => iterateContainedFile(root, file, async function* (descriptor) {
  const before = await descriptor.stat({ bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(VFS_COLD_METADATA_MAX_BYTES)) fail('file-admission');
  counters.cacheFileBytes = Number(before.size);
  const chunk = Buffer.alloc(65536), line = Buffer.alloc(VFS_COLD_MAX_ROW_BYTES), decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0, lineBytes = 0, lines = 0;
  const parse = () => {
    if (++lines > VFS_COLD_MAX_ENTRIES) fail('row-count');
    const text = decoder.decode(line.subarray(0, lineBytes)).trim(); lineBytes = 0;
    return text ? { present: true, row: JSON.parse(text) } : { present: false };
  };
  while (offset < Number(before.size)) {
    const requested = Math.min(chunk.length, Number(before.size) - offset);
    const { bytesRead } = await descriptor.read(chunk, 0, requested, offset);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0 || bytesRead > requested) fail('read-progress');
    offset += bytesRead; counters.loadedInputBytes += bytesRead;
    let start = 0;
    while (start < bytesRead) {
      const newline = chunk.indexOf(10, start), end = newline >= 0 && newline < bytesRead ? newline : bytesRead;
      const length = end - start;
      if (lineBytes + length > line.length) fail('row-bytes');
      chunk.copy(line, lineBytes, start, end); lineBytes += length; start = end;
      if (end < bytesRead) {
        const value = parse(); if (value.present) { counters.loadedRows++; yield value.row; }
        start++;
      }
    }
  }
  if (lineBytes) { const value = parse(); if (value.present) { counters.loadedRows++; yield value.row; } }
  const after = await descriptor.stat({ bigint: true }); descriptor.verify();
  if (keys.some(key => before[key] !== after[key])) fail('file-changed');
});

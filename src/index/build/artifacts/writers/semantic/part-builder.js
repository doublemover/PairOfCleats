import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { syncParentDirectory } from '../../../../../shared/io/persistence-helpers.js';
import { validateOffsetsAgainstFile } from '../../../../../shared/artifact-io/offsets.js';

const NEWLINE = Buffer.from('\n');
const writeExact = async (handle, bytes, position, signal) => {
  let offset = 0;
  while (offset < bytes.length) {
    throwIfAborted(signal);
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) {
      throw Object.assign(new Error('Semantic staging write made invalid or no progress.'), { code: 'ERR_SEMANTIC_WRITE_PROGRESS' });
    }
    offset += bytesWritten;
  }
};
/** Private append builders retain descriptors and hashes, never producer row buffers. */
export const createSemanticPartBuilders = ({ directory, prefix, members, counts, hashes, reserve,
  batchRows, batchBytes, scheduleIo, signal, metrics }) => {
  const active = new Map();
  const bump = (key, amount = 1) => { metrics[key] = (metrics[key] || 0) + amount; };
  const sync = async handle => { await handle.sync(); bump('partSyncCalls'); };
  const close = async part => {
    const failures = [];
    for (const key of ['dataHandle', 'offsetsHandle']) {
      if (!part[key]) continue;
      try { await part[key].close(); part[key] = null; bump('partCloseCalls'); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Semantic part handles did not close.');
  };
  const open = async member => {
    const filename = member + '-' + String(members[member].length).padStart(6, '0') + '.jsonl';
    const filePath = path.join(directory, filename);
    const part = { member, filename, filePath, dataPath: filePath + '.building',
      offsetsPath: filePath + '.offsets.building', dataHandle: null, offsetsHandle: null,
      bytes: 0, rows: 0, firstRow: counts[member], hash: createHash('sha256'), offsetsHash: createHash('sha256') };
    active.set(member, part);
    part.dataHandle = await fs.open(part.dataPath, 'wx'); bump('partOpenCalls');
    part.offsetsHandle = await fs.open(part.offsetsPath, 'wx'); bump('partOpenCalls');
    await syncParentDirectory(part.dataPath); bump('partDirectorySyncCalls');
    metrics.activePartHighWater = Math.max(metrics.activePartHighWater || 0, active.size);
    return part;
  };
  const roll = async part => {
    throwIfAborted(signal);
    // append() already synced each acknowledged fragment. Re-sync at the completed-part boundary.
    if (part.dataHandle) await sync(part.dataHandle);
    if (part.offsetsHandle) await sync(part.offsetsHandle);
    await close(part);
    await fs.rename(part.dataPath, part.filePath);
    await fs.rename(part.offsetsPath, part.filePath + '.offsets');
    await syncParentDirectory(part.filePath); bump('partDirectorySyncCalls');
    await validateOffsetsAgainstFile(part.filePath, part.filePath + '.offsets'); bump('partOffsetValidations');
    throwIfAborted(signal);
    members[part.member].push({ path: prefix + '/' + part.filename,
      offsetsPath: prefix + '/' + part.filename + '.offsets', hash: part.hash.digest('hex'),
      offsetsHash: part.offsetsHash.digest('hex'), count: part.rows, bytes: part.bytes, firstRow: part.firstRow });
    active.delete(part.member); bump('partsCompleted');
    metrics.partBytesHighWater = Math.max(metrics.partBytesHighWater || 0, part.bytes);
    metrics.partRowsHighWater = Math.max(metrics.partRowsHighWater || 0, part.rows);
    const bucket = part.bytes <= 4096 ? 'le4KiB' : part.bytes <= 65536 ? 'le64KiB' : part.bytes <= 1048576 ? 'le1MiB' : 'over1MiB';
    metrics.partSizeHistogram ||= {}; metrics.partSizeHistogram[bucket] = (metrics.partSizeHistogram[bucket] || 0) + 1;
  };
  return {
    async append(member, buffers) {
      if (!buffers.length) return;
      await scheduleIo(async () => {
        let index = 0;
        while (index < buffers.length) {
          throwIfAborted(signal);
          let part = active.get(member) || await open(member);
          // Source manifests were already indivisible outside producer-batch limits. Keep that contract.
          const byteLimit = member === 'semantic_sources' ? Math.max(batchBytes, buffers[index].length + 1) : batchBytes;
          if (part.rows && (part.rows >= batchRows || part.bytes + buffers[index].length + 1 > byteLimit)) {
            await roll(part); part = await open(member);
          }
          const start = index; let dataBytes = 0;
          while (index < buffers.length && part.rows + index - start < batchRows
            && part.bytes + dataBytes + buffers[index].length + 1 <= byteLimit) {
            dataBytes += buffers[index].length + 1; index += 1;
          }
          if (index === start) throw Object.assign(new Error('Semantic row exceeds the existing part byte bound.'), { code: 'ERR_SEMANTIC_CONTRACT' });
          const rowCount = index - start;
          const offsets = Buffer.alloc(rowCount * 8);
          const pieces = []; let position = part.bytes;
          for (let offset = 0; offset < rowCount; offset += 1) {
            offsets.writeBigUInt64LE(BigInt(position), offset * 8);
            const buffer = buffers[start + offset]; pieces.push(buffer, NEWLINE); position += buffer.length + 1;
          }
          const data = Buffer.concat(pieces, dataBytes);
          reserve(data.length + offsets.length);
          await writeExact(part.dataHandle, data, part.bytes, signal);
          await writeExact(part.offsetsHandle, offsets, part.rows * 8, signal);
          part.hash.update(data); part.offsetsHash.update(offsets); hashes[member].update(data);
          part.bytes += data.length; part.rows += rowCount; counts[member] += rowCount;
          bump('partDataBytesWritten', data.length); bump('partOffsetBytesWritten', offsets.length); bump('rowsWritten', rowCount);
          // Existing per-producer-batch durability remains mandatory, even for a partly filled builder.
          await sync(part.dataHandle); await sync(part.offsetsHandle);
          if (part.rows >= batchRows || part.bytes >= byteLimit) await roll(part);
        }
      });
    },
    async finish() { for (const part of [...active.values()]) await scheduleIo(() => roll(part)); },
    async closeForAbort() {
      const settled = await Promise.allSettled([...active.values()].map(part => close(part)));
      const failures = settled.filter(item => item.status === 'rejected').map(item => item.reason);
      if (failures.length) throw new AggregateError(failures, 'Semantic builder cleanup did not close all owned handles.');
      active.clear();
    }
  };
};

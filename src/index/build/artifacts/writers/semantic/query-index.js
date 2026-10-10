import { syncParentDirectory } from '../../../../../shared/io/persistence-helpers.js';
import { assertSemanticQueryIndex } from '../../../../../contracts/validators/semantic-query-index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRowSpillCollector } from '../../helpers.js';
import { mergeSortedRuns } from '../../../../../shared/merge.js';
import { createJsonlBatchWriter } from '../../../../../shared/json-stream/jsonl-batch.js';
import { canonicalSemanticJson } from '../../../../semantic/identity.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { compareQueryIndexRows, queryIndexKey } from '../../../../../semantic/query-index.js';

const members = ['semantic_operands', 'semantic_lookup', 'semantic_ownership', 'semantic_records', 'semantic_edges'];
/** Publication-time physical index; canonical partition identities exclude this layout. */
export const writeSemanticQueryIndex = async ({ root, generation, partitions, store,
  diskAccount, signal = null, scheduleIo = (fn) => fn(), batchRows = 1024, batchBytes = 1048576,
  maxOpenRuns = 16, entries = null, compareRows = compareQueryIndexRows, keyForRow = queryIndexKey, validateIndex = assertSemanticQueryIndex, directoryPrefix = 'semantic-query-index-', schemaVersion = 1 }) => {
  if (!diskAccount?.reserve || !diskAccount?.release) throw new TypeError('Shared semantic disk account required.');
  for (const limit of [batchRows, batchBytes, maxOpenRuns]) if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Positive query index bounds required.');
  if (maxOpenRuns < 2) throw new TypeError('Query index merge fan-in must be at least two.');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.toNamespacedPath(path.join(root, directoryPrefix)));
  const prefix = path.basename(directory);
  let workingReserved = 0, finalReserved = 0;
  const reserveWork = (bytes) => { diskAccount.reserve(bytes); workingReserved += bytes; };
  const reserveFinal = (bytes) => { diskAccount.reserve(bytes); finalReserved += bytes; };
  const collector = createRowSpillCollector({ outDir: directory, runPrefix: 'query-index',
    compare: compareRows, maxBufferRows: batchRows, maxBufferBytes: batchBytes,
    maxJsonBytes: batchBytes, serialize: canonicalSemanticJson, scheduleIo });
  const pieces = [];
  const inventory = [...partitions].sort((a, b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0);
  let rowCount = 0;
  try {
    if (entries) {
      for await (const entry of entries) {
        throwIfAborted(signal); const line = canonicalSemanticJson(entry);
        reserveWork(Buffer.byteLength(line) + 1); await collector.append(entry, { line });
      }
    } else for (const partition of inventory) for (const member of members) {
      let rowOrdinal = 0;
      for await (const row of store.iterateRows(partition.partitionId, member, { signal, batchRows: Math.min(128, batchRows) })) {
        throwIfAborted(signal);
        if (member === 'semantic_records' && (row.kind !== 'occurrence' || !row.data.expression)) { rowOrdinal += 1; continue; }
        const owner = member === 'semantic_records' ? row.data.expression : member === 'semantic_operands' ? row.parent : member === 'semantic_ownership' ? row.recordRef
          : { partitionId: partition.partitionId, localId: row.id };
        const owners = member === 'semantic_edges' ? [row.from, ...(canonicalSemanticJson(row.from) === canonicalSemanticJson(row.to) ? [] : [row.to])] : [owner];
        for (const endpoint of owners) {
          const entry = { owner: endpoint, member, partitionId: partition.partitionId, rowOrdinal };
          const line = canonicalSemanticJson(entry);
          reserveWork(Buffer.byteLength(line) + 1);
          await collector.append(entry, { line });
        }
        rowOrdinal += 1;
      }
    }
    const collected = await collector.finalize();
    let runs = collected.runs || [];
    let pass = 0;
    // Bounded merge fan-in; retain accounting for all temporary copies until cleanup.
    while (runs.length > maxOpenRuns) {
      const next = [];
      for (let start = 0; start < runs.length; start += maxOpenRuns) {
        throwIfAborted(signal);
        const target = path.join(directory, `merge-${pass}-${start}.jsonl`);
        const writer = createJsonlBatchWriter(target, { compression: null, atomic: false, signal });
        try {
          for await (const entry of mergeSortedRuns(runs.slice(start, start + maxOpenRuns), { compare: compareRows, validateComparator: true })) {
            throwIfAborted(signal);
            const line = canonicalSemanticJson(entry), bytes = Buffer.byteLength(line) + 1;
            reserveWork(bytes);
            await writer.writeLine(line, bytes);
          }
          await writer.close();
        } catch (error) { await writer.destroy(error); throw error; }
        next.push(target);
      }
      runs = next; pass += 1;
    }
    const rows = runs.length ? mergeSortedRuns(runs, { compare: compareRows, validateComparator: true }) : collected.rows;
    let batch = [], bytes = 0, previous = null;
    const flush = async () => {
      if (!batch.length) return;
      throwIfAborted(signal);
      const filename = `index-${String(pieces.length).padStart(6, '0')}.jsonl`;
      const file = path.join(directory, filename);
      const offsets = Buffer.alloc(batch.length * 8);
      const hash = createHash('sha256');
      let position = 0;
      reserveFinal(bytes + offsets.length);
      await scheduleIo(async () => {
        const writer = createJsonlBatchWriter(file, { compression: null, atomic: false, signal });
        try {
          for (let i = 0; i < batch.length; i += 1) {
            throwIfAborted(signal);
            offsets.writeBigUInt64LE(BigInt(position), i * 8);
            const line = canonicalSemanticJson(batch[i]);
            const length = Buffer.byteLength(line) + 1;
            await writer.writeLine(line, length);
            hash.update(line).update('\n'); position += length;
          }
          await writer.close();
        } catch (error) { await writer.destroy(error); throw error; }
        const offsetsHandle = await fs.open(file + '.offsets', 'wx');
        try { await offsetsHandle.writeFile(offsets); await offsetsHandle.sync(); } finally { await offsetsHandle.close(); }
        const dataHandle = await fs.open(file, 'r+');
        try { await dataHandle.sync(); } finally { await dataHandle.close(); }
        await syncParentDirectory(file);
        await syncParentDirectory(directory);
      });
      pieces.push({ path: prefix + '/' + filename, offsetsPath: prefix + '/' + filename + '.offsets',
        hash: hash.digest('hex'), offsetsHash: createHash('sha256').update(offsets).digest('hex'),
        count: batch.length, bytes: position, firstRow: rowCount,
        firstKey: keyForRow(batch[0]), lastKey: keyForRow(batch[batch.length - 1]) });
      rowCount += batch.length; batch = []; bytes = 0;
    };
    for await (const entry of rows) {
      throwIfAborted(signal);
      if (previous && compareRows(previous, entry) >= 0) throw new Error('Duplicate or unordered query index row.');
      previous = entry;
      const length = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (length > batchBytes) throw new Error('Query index row exceeds allowance.');
      if (batch.length && (batch.length >= batchRows || bytes + length > batchBytes)) await flush();
      batch.push(entry); bytes += length;
    }
    await flush();
    await collected.cleanup();
    for (const file of await fs.readdir(directory)) if (file.startsWith('merge-')) await fs.rm(path.join(directory, file));
    diskAccount.release(workingReserved); workingReserved = 0;
    return validateIndex({ schemaVersion, generation, partitionHashes: inventory.map(({ partitionId, canonicalHash }) => ({ partitionId, canonicalHash })), pieces, rowCount });
  } catch (error) {
    // The directory is a verified child created here, never a live generation root.
    await fs.rm(directory, { recursive: true, force: true });
    diskAccount.release(workingReserved + finalReserved);
    throw error;
  }
};

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
import { createContainedFileResource } from '../../../../../shared/contained-file-resource.js';
import { observeStorageResource } from '../../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../../shared/storage/operation-error.js';

const members = ['semantic_operands', 'semantic_lookup', 'semantic_ownership', 'semantic_records', 'semantic_edges'];
const withOwnedHandle = async (file, flags, run) => {
  const handle = await fs.open(file, flags);
  const owner = createContainedFileResource({ handle, sync: false });
  return owner.run(() => {
    const writeFile = handle.writeFile, sync = handle.sync;
    if (typeof writeFile !== 'function' || typeof sync !== 'function') throw new TypeError('Query index descriptor lacks its original write/sync operations.');
    return run(Object.freeze({ writeFile: (...args) => writeFile.call(handle, ...args), sync: () => sync.call(handle) }));
  });
};
const failWriter = async (writer, primary) => {
  const observation = observeStorageResource(primary, { phase: 'semantic-query-index-writer' });
  try { await writer.destroy(primary); }
  catch (secondary) {
    throw addStorageFailureContext(observation.retain(), { cleanupError: secondary }, secondary, { secondaryPresent: true });
  }
  throw observation.retain();
};

/** Publication-time physical index; canonical partition identities exclude this layout. */
export const writeSemanticQueryIndex = async ({ root, generation, partitions, store,
  diskAccount, signal = null, scheduleIo = (fn) => fn(), batchRows = 1024, batchBytes = 1048576,
  maxOpenRuns = 16, entries = null, orderedEntries = null, compareRows = compareQueryIndexRows, keyForRow = queryIndexKey,
  validateIndex = assertSemanticQueryIndex, directoryPrefix = 'semantic-query-index-', schemaVersion = 1,
  metrics = null, onMergeGroup = null, offsetsSuffix = '.offsets' }) => {
  if (orderedEntries !== null && entries !== null) throw new TypeError('Choose one query index entry producer.');
  if (!/^\.[a-z0-9.]+$/.test(offsetsSuffix)) throw new TypeError('Invalid query index offsets suffix.');
  if (!diskAccount?.reserve || !diskAccount?.release) throw new TypeError('Shared semantic disk account required.');
  for (const limit of [batchRows, batchBytes, maxOpenRuns]) if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Positive query index bounds required.');
  if (maxOpenRuns < 2) throw new TypeError('Query index merge fan-in must be at least two.');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.toNamespacedPath(path.join(root, directoryPrefix)));
  const prefix = path.basename(directory);
  let workingReserved = 0, finalReserved = 0;
  const ownedRuns = new Map();
  const observeWork = () => {
    if (metrics) {
      metrics.workingBytes = workingReserved;
      metrics.peakWorkingBytes = Math.max(metrics.peakWorkingBytes || 0, workingReserved);
    }
  };
  const reserveWork = (bytes) => { diskAccount.reserve(bytes); workingReserved += bytes; observeWork(); };
  const reserveFinal = (bytes) => { diskAccount.reserve(bytes); finalReserved += bytes; };
  const retire = async runs => {
    for (const filename of runs) {
      const bytes = ownedRuns.get(filename);
      if (bytes === undefined) throw new Error('Query spill run is not owned by this computation.');
      await fs.unlink(filename);
      ownedRuns.delete(filename); diskAccount.release(bytes); workingReserved -= bytes;
      if (metrics) { metrics.retiredRuns = (metrics.retiredRuns || 0) + 1; metrics.retiredBytes = (metrics.retiredBytes || 0) + bytes; }
      observeWork();
    }
  };
  const collector = createRowSpillCollector({ outDir: directory, runPrefix: 'query-index',
    compare: compareRows, maxBufferRows: batchRows, maxBufferBytes: batchBytes,
    maxJsonBytes: batchBytes, serialize: canonicalSemanticJson, scheduleIo });
  const pieces = [];
  const inventory = [...partitions].sort((a, b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0);
  let rowCount = 0;
  try {
    if (orderedEntries) {
      // The final loop still verifies strict increasing order for every row.
    } else if (entries) {
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
    const collected = orderedEntries ? { rows: orderedEntries, async cleanup() {} } : await collector.finalize();
    let runs = collected.runs || [];
    for (const filename of runs) ownedRuns.set(filename, (await fs.stat(filename)).size);
    if (runs.length && [...ownedRuns.values()].reduce((sum, bytes) => sum + bytes, 0) !== workingReserved) {
      throw new Error('Query spill accounting differs from the physical run inventory.');
    }
    let pass = 0;
    // A completed replacement owns the computation before retiring its closed inputs.
    while (runs.length > maxOpenRuns) {
      const next = [];
      for (let start = 0; start < runs.length; start += maxOpenRuns) {
        throwIfAborted(signal);
        const inputs = runs.slice(start, start + maxOpenRuns);
        const target = path.join(directory, `merge-${pass}-${start}.jsonl`);
        const writer = createJsonlBatchWriter(target, { compression: null, atomic: false, signal });
        let targetBytes = 0;
        try {
          for await (const entry of mergeSortedRuns(inputs, { compare: compareRows, validateComparator: true })) {
            throwIfAborted(signal);
            const line = canonicalSemanticJson(entry), bytes = Buffer.byteLength(line) + 1;
            reserveWork(bytes);
            targetBytes += bytes;
            await writer.writeLine(line, bytes);
          }
          await writer.close();
        } catch (error) {
          await failWriter(writer, error);
        }
        ownedRuns.set(target, targetBytes);
        next.push(target);
        await retire(inputs);
        if (metrics) metrics.mergeGroups = (metrics.mergeGroups || 0) + 1;
        await onMergeGroup?.({ pass, start, target, inputCount: inputs.length, workingBytes: workingReserved });
      }
      runs = next; pass += 1;
      if (metrics) metrics.mergePasses = pass;
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
        } catch (error) {
          await failWriter(writer, error);
        }
        await withOwnedHandle(file + offsetsSuffix, 'wx', async handle => { await handle.writeFile(offsets); await handle.sync(); });
        await withOwnedHandle(file, 'r+', handle => handle.sync());
        await syncParentDirectory(file);
        await syncParentDirectory(directory);
      });
      pieces.push({ path: prefix + '/' + filename, offsetsPath: prefix + '/' + filename + offsetsSuffix,
        hash: hash.digest('hex'), offsetsHash: createHash('sha256').update(offsets).digest('hex'),
        count: batch.length, bytes: position, firstRow: rowCount,
        firstKey: keyForRow(batch[0]), lastKey: keyForRow(batch[batch.length - 1]) });
      rowCount += batch.length; batch = []; bytes = 0;
    };
    for await (const entry of rows) {
      throwIfAborted(signal);
      if (previous) {
        const order = compareRows(previous, entry);
        if (!Number.isFinite(order) || order >= 0) throw new Error('Duplicate or unordered query index row.');
      }
      previous = entry;
      const length = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (length > batchBytes) throw new Error('Query index row exceeds allowance.');
      if (batch.length && (batch.length >= batchRows || bytes + length > batchBytes)) await flush();
      batch.push(entry); bytes += length;
    }
    await flush();
    if (runs.length) await retire(runs);
    await collected.cleanup();
    diskAccount.release(workingReserved); workingReserved = 0;
    observeWork();
    return validateIndex({ schemaVersion, generation, partitionHashes: inventory.map(({ partitionId, canonicalHash }) => ({ partitionId, canonicalHash })), pieces, rowCount });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'semantic-query-index-retirement' });
    const retained = { semanticQueryIndexDirectory: directory,
      semanticQueryIndexReservedBytes: workingReserved + finalReserved };
    const requireRetirement = () => {
      try { observation.requireSettled(); }
      catch (pending) { throw addStorageFailureContext(pending, retained); }
    };
    requireRetirement();
    const failure = observation.retain();
    requireRetirement();
    // The directory is a verified child created here, never a live generation root.
    try {
      await fs.rm(directory, { recursive: true, force: true });
      requireRetirement();
      diskAccount.release(workingReserved + finalReserved);
      workingReserved = 0; finalReserved = 0; ownedRuns.clear(); observeWork();
    } catch (cleanupError) {
      // A failed deletion leaves recoverable physical bytes and their credits.
      // Preserve the original quota/IO/cancellation error as the primary cause.
      throw addStorageFailureContext(failure, { ...retained, cleanupError }, cleanupError, { secondaryPresent: true });
    }
    throw failure;
  }
};

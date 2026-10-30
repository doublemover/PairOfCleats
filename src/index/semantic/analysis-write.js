import { semanticByteAdmissionFor } from './planning.js';
import { createSemanticPartitionSink, abortSemanticPartitionOnFailure } from '../build/artifacts/writers/semantic/partition.js';
import { prepareSemanticBatchEntry, semanticBatchEntryBytes } from './prepared-batch.js';
/** Shared pull sink for derived rows; analysis never edits syntax partitions.
 * A producer must bound construction before each yield. This writer owns one
 * prepared batch plus one lookahead entry, then awaits append before advancing.
 * Its queue admission does not bound source/parser state or producer traversal.
 */
export const writeSemanticAnalysis = async ({ rows, policy, ...options }) => {
  const sink = await createSemanticPartitionSink({ ...options, byteAdmission: semanticByteAdmissionFor(options.diskAccount, policy.storage.maxQueuedBytes),
    batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
  let batch = [], byteCount = 0, sequence = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sink.appendBatch({ partitionId: options.partitionId, sequence: sequence++, rows: batch, byteCount });
    batch = []; byteCount = 0;
  };
  try {
    for await (const rawEntry of rows) {
      const entry = prepareSemanticBatchEntry(rawEntry);
      const bytes = semanticBatchEntryBytes(entry);
      if (batch.length && (batch.length >= policy.storage.batchRows || byteCount + bytes > policy.storage.batchBytes)) await flush();
      batch.push(entry); byteCount += bytes;
    }
    await flush();
    return await sink.finalizeSource();
  } catch (error) { await abortSemanticPartitionOnFailure(sink, error); }
};

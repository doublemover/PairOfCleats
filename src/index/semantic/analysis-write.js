import { createSemanticPartitionSink } from '../build/artifacts/writers/semantic/partition.js';
import { canonicalSemanticJson } from './identity.js';
/** Shared bounded sink for derived rows; analysis never edits syntax partitions. */
export const writeSemanticAnalysis = async ({ rows, policy, ...options }) => {
  const sink = await createSemanticPartitionSink({ ...options,
    batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
  let batch = [], byteCount = 0, sequence = 0;
  const flush = async () => {
    if (!batch.length) return;
    await sink.appendBatch({ partitionId: options.partitionId, sequence: sequence++, rows: batch, byteCount });
    batch = []; byteCount = 0;
  };
  try {
    for await (const entry of rows) {
      const bytes = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
      if (batch.length && (batch.length >= policy.storage.batchRows || byteCount + bytes > policy.storage.batchBytes)) await flush();
      batch.push(entry); byteCount += bytes;
    }
    await flush();
    return await sink.finalizeSource();
  } catch (error) { await sink.abort(); throw error; }
};

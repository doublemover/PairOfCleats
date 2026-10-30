import { createSemanticQueryIndexIntake } from './query-index.js';
import { validateSemanticPartitions } from '../../../../semantic/reconcile.js';
import { queryIndexEntriesForRow } from '../../../../../semantic/query-index.js';
import { operationRecordEntries, operationOwnershipEntries, compareOperationIndexRows } from '../../../../../semantic/operation-index.js';
import { assertSemanticOperationIndex } from '../../../../../contracts/validators/semantic-operation-index.js';
import { runWithSettledConcurrency } from '../../../../../shared/concurrency/run-with-queue.js';
import { throwIfAborted } from '../../../../../shared/abort.js';
import { addStorageFailureContext } from '../../../../../shared/storage/operation-error.js';

/** Provisional physical projections consume the canonical traversal, never its
 * receipt. The validator still owns every count/hash/source/reference check.
 * Two canonical batches of128 rows, at most128 ownership rows and one128-row
 * hydration retain the former512-row working envelope. At most three piece
 * readers fit inside the former four-reader ceiling. Final merges start after
 * those readers close, retaining the original two independent writer buffers.
 */
export const writeValidatedSemanticIndexes = async ({ root, generation, partitions, store,
  diskAccount, signal = null, onValidatedRow = null, afterValidation = null }) => {
  if (onValidatedRow !== null && typeof onValidatedRow !== 'function') throw new TypeError('Host semantic row observer must be callable.');
  if (afterValidation !== null && typeof afterValidation !== 'function') throw new TypeError('Semantic validation completion must be callable.');
  const intakes = [];
  try {
    for (const operation of [false, true]) intakes.push(await createSemanticQueryIndexIntake({
      root, generation, partitions, diskAccount, signal,
      batchRows: 512, batchBytes: 1048576, maxOpenRuns: 8,
      ...(operation ? { compareRows: compareOperationIndexRows, keyForRow: row => row,
        validateIndex: assertSemanticOperationIndex, directoryPrefix: 'semantic-operation-index-', schemaVersion: 2 } : {})
    }));
    const [query, operation] = intakes;
    const sourcePaths = new Map(); // One path per captured inventory entry, never record rows.
    let ownership = [];
    const flushOwnership = async () => {
      for await (const entry of operationOwnershipEntries(store, ownership, signal)) await operation.append(entry);
      ownership = [];
    };
    const project = async event => {
      throwIfAborted(signal);
      await onValidatedRow?.(event);
      const { partition, member, row } = event;
      if (member === 'semantic_sources') sourcePaths.set(partition.partitionId, row.path);
      for (const entry of queryIndexEntriesForRow({ ...event, partitionId: partition.partitionId })) await query.append(entry);
      if (member === 'semantic_records') {
        for (const entry of operationRecordEntries(partition, row, sourcePaths.get(partition.partitionId))) await operation.append(entry);
      }
      if (member === 'semantic_ownership') {
        ownership.push(row);
        if (ownership.length === 128) await flushOwnership();
      }
    };
    // Each of the at most two original validation workers awaits its own
    // callback. Thus this serialization retains at most two pending rows,
    // not an unbounded producer promise chain. A failed append is never retried.
    let tail = Promise.resolve(), refused = false, originalFailure;
    const observe = event => {
      const work = tail.then(() => {
        if (refused) throw originalFailure;
        return project(event);
      });
      tail = work.then(() => {}, error => {
        if (!refused) { refused = true; originalFailure = error; }
      });
      return work;
    };
    await validateSemanticPartitions({ store, partitions, signal, partitionConcurrency: 2, onValidatedRow: observe });
    // Remaining ownership is bounded by127 rows; cross-partition getRecords
    // remains authoritative even when the referenced partition was visited later.
    await flushOwnership();
    await afterValidation?.();
    throwIfAborted(signal);
    return await runWithSettledConcurrency(intakes, 2, intake => intake.finalize(), { signal, collectResults: true });
  } catch (error) {
    // Validation and finalization drain their original admitted operations before
    // arriving here. Retirement reuses each writer's resource/accounting guard;
    // pending native closure retains paths and credits rather than deleting them.
    const outcomes = await Promise.allSettled(intakes.map(intake => intake.retire(error)));
    let failure = error;
    for (const outcome of outcomes) {
      const retained = outcome.status === 'rejected' ? outcome.reason : outcome.value;
      if (retained !== error) failure = addStorageFailureContext(failure, {}, retained, { secondaryPresent: true });
    }
    throw failure;
  }
};

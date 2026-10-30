import { discoveryIndexEntry, DISCOVERY_INDEX_FIELDS } from './discovery-facts.js';
export const OPERATION_SELECTOR_FIELDS = Object.freeze(['astKind', 'operation', 'invocationKind', 'sourcePath', 'sourceUnitId', 'chunkUid']);
export const OPERATION_INDEX_FIELDS = Object.freeze([...OPERATION_SELECTOR_FIELDS, ...DISCOVERY_INDEX_FIELDS]);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const compareOperationIndexRows = (a,b) => compare(a.field,b.field) || compare(a.value,b.value) || compare(a.ref.partitionId,b.ref.partitionId) || a.ref.localId-b.ref.localId;
export function* operationRecordEntries(partition, row, sourcePath) {
  const ref = { partitionId: partition.partitionId, localId: row.id };
  const discovery = discoveryIndexEntry(row, ref);
  if (discovery) yield discovery;
  if (row.kind !== 'expression') return;
  for (const field of ['astKind', 'operation', 'invocationKind']) if (typeof row.data[field] === 'string' && row.data[field].length) yield { field, value: row.data[field], ref };
  yield { field: 'sourceUnitId', value: partition.sourceUnitId, ref };
  if (sourcePath) yield { field: 'sourcePath', value: sourcePath, ref };
}
/** Ownership may refer to a different partition, including one not visited yet.
 * Keep the store's bounded qualified lookup rather than a seen-record cache. */
export async function* operationOwnershipEntries(store, batch, signal) {
  if (!batch.length) return;
  if (batch.length > 128) throw new RangeError('Operation ownership hydration exceeds its original batch.');
  const records = await store.getRecords(batch.map(row => row.recordRef), ['data'], { signal });
  for (let index = 0; index < batch.length; index++) if (records[index]?.kind === 'expression') {
    yield { field: 'chunkUid', value: batch[index].chunkUid, ref: batch[index].recordRef };
  }
}
/** Derived lookup only: source/ownership facts remain authoritative, including overlaps. */
export const operationIndexEntries = async function* (store, partitions, signal) {
  for (const partition of partitions) {
    let sourcePath = null;
    for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
      if (source.sourceUnitId === partition.sourceUnitId) sourcePath = source.path;
    }
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records', { signal })) {
      yield* operationRecordEntries(partition, row, sourcePath);
    }
    // Ownership has its own partition. Hydrate bounded batches rather than
    // retaining every source node or scanning the fact inventory at query time.
    let batch = [];
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_ownership', { signal })) {
      batch.push(row);
      if (batch.length === 128) { yield* operationOwnershipEntries(store, batch, signal); batch = []; }
    }
    if (batch.length) yield* operationOwnershipEntries(store, batch, signal);
  }
};

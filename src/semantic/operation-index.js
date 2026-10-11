export const OPERATION_SELECTOR_FIELDS = Object.freeze(['astKind', 'operation', 'invocationKind', 'sourcePath', 'sourceUnitId', 'chunkUid']);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const compareOperationIndexRows = (a,b) => compare(a.field,b.field) || compare(a.value,b.value) || compare(a.ref.partitionId,b.ref.partitionId) || a.ref.localId-b.ref.localId;
/** Derived lookup only: source/ownership facts remain authoritative, including overlaps. */
export const operationIndexEntries = async function* (store, partitions, signal) {
  for (const partition of partitions) {
    let sourcePath = null;
    for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
      if (source.sourceUnitId === partition.sourceUnitId) sourcePath = source.path;
    }
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records', { signal })) {
      if (row.kind !== 'expression') continue;
      const ref = { partitionId: partition.partitionId, localId: row.id };
      for (const field of ['astKind', 'operation', 'invocationKind']) if (typeof row.data[field] === 'string' && row.data[field].length) yield { field, value: row.data[field], ref };
      yield { field: 'sourceUnitId', value: partition.sourceUnitId, ref };
      if (sourcePath) yield { field: 'sourcePath', value: sourcePath, ref };
    }
    // Ownership has its own partition. Hydrate bounded batches rather than
    // retaining every source node or scanning the fact inventory at query time.
    let batch = [];
    const project = async function* () {
      const records = await store.getRecords(batch.map(row => row.recordRef), ['data'], { signal });
      for (let i = 0; i < batch.length; i += 1) if (records[i]?.kind === 'expression') {
        yield { field: 'chunkUid', value: batch[i].chunkUid, ref: batch[i].recordRef };
      }
    };
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_ownership', { signal })) {
      batch.push(row);
      if (batch.length === 128) { yield* project(); batch = []; }
    }
    if (batch.length) yield* project();
  }
};

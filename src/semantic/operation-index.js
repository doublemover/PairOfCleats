const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const compareOperationIndexRows = (a,b) => compare(a.field,b.field) || compare(a.value,b.value) || compare(a.ref.partitionId,b.ref.partitionId) || a.ref.localId-b.ref.localId;
export const operationIndexEntries = async function* (store, partitions, signal) {
  for (const partition of partitions) for await (const row of store.iterateRows(partition.partitionId, 'semantic_records', { signal })) {
    if (row.kind !== 'expression') continue;
    for (const field of ['astKind', 'operation', 'invocationKind']) if (typeof row.data[field] === 'string' && row.data[field].length) yield { field, value: row.data[field], ref: { partitionId: partition.partitionId, localId: row.id } };
  }
};

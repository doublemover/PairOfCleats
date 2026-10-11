import greedyNumberPartitioning from 'greedy-number-partitioning';

/**
 * Partition independent work using the existing deterministic shard balancer.
 * Keeps each item exactly once; an all-zero workload uses round-robin fallback.
 * Input arrays and items are not mutated. Callers restore dependency/order
 * constraints within each batch; this helper only assigns independent work.
 * Pure synchronous planning, with no cache, IO, locks or path interpretation.
 *
 * @param {any[]} items
 * @param {number} batchCount
 * @param {{resolveWeight?:Function,resolveTieBreaker?:Function}} [options]
 * @returns {any[][]} Nonempty balanced batches.
 */
export function planWeightedBatches(items, batchCount, { resolveWeight, resolveTieBreaker } = {}) {
  const list = Array.isArray(items) ? items : [];
  const count = Number.isFinite(batchCount) ? Math.max(1, Math.floor(batchCount)) : 1;
  if (!list.length) return [];
  if (count <= 1) return [list.slice()];
  const tieBreakScale = list.length > 0 ? (list.length + 1) : 1;
  const weightedItems = list.map((item, index) => {
    const value = resolveWeight ? resolveWeight(item, index) : 0;
    const baseWeight = Number.isFinite(value) && value > 0 ? value : 0;
    const tieBreak = baseWeight > 0 ? ((index + 1) / tieBreakScale) * 1e-6 : 0;
    return {
      item,
      weight: baseWeight,
      partitionWeight: baseWeight + tieBreak
    };
  });
  const weights = weightedItems.map((entry) => entry.partitionWeight);
  const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) {
    const buckets = Array.from({ length: count }, () => []);
    list.forEach((item, index) => {
      buckets[index % count].push(item);
    });
    return buckets.filter((bucket) => bucket.length);
  }
  const partitions = greedyNumberPartitioning(weights.slice(), count);
  const resolveTie = resolveTieBreaker
    ? (item, index) => resolveTieBreaker(item, index)
    : (item, index) => index;
  const weightQueues = new Map();
  list.forEach((item, index) => {
    const weight = weights[index];
    const entry = weightQueues.get(weight) || { items: [], offset: 0 };
    entry.items.push({ item, tie: resolveTie(item, index) });
    weightQueues.set(weight, entry);
  });
  for (const entry of weightQueues.values()) {
    entry.items.sort((a, b) => {
      const aKey = a.tie ?? '';
      const bKey = b.tie ?? '';
      if (aKey < bKey) return -1;
      if (aKey > bKey) return 1;
      return 0;
    });
  }
  const takeNext = (weight) => {
    const entry = weightQueues.get(weight);
    if (!entry || entry.offset >= entry.items.length) return null;
    const item = entry.items[entry.offset];
    entry.offset += 1;
    return item;
  };
  const batches = partitions.map((partition) => {
    const batch = [];
    for (const weight of partition) {
      const item = takeNext(weight);
      if (item) batch.push(item.item);
    }
    return batch;
  });
  const assignedCount = batches.reduce((sum, batch) => sum + batch.length, 0);
  if (assignedCount < list.length) {
    const remainder = [];
    for (const entry of weightQueues.values()) {
      for (let i = entry.offset; i < entry.items.length; i += 1) {
        remainder.push(entry.items[i].item);
      }
    }
    if (remainder.length) {
      const target = batches.reduce((best, batch) => (batch.length < best.length ? batch : best), batches[0]);
      target.push(...remainder);
    }
  }
  return batches.filter((batch) => batch.length);
}

/** Pack a bounded admitted window without changing source ownership or inputs. */
export const planEmbeddingBatches = ({ estimates, maxItems, tokenBudget, groups = null }) => {
  const sourceOrder = estimates.map((_, index) => index);
  const pack = (order, strategy) => {
    const batches = [];
    let current = [], tokens = 0;
    for (const index of order) {
      const estimated = estimates[index];
      if (current.length && (current.length >= maxItems
        || (tokenBudget > 0 && tokens + estimated > tokenBudget))) {
        batches.push(current);
        current = [];
        tokens = 0;
      }
      // An oversized item remains intact in its own batch, as before.
      current.push(index);
      tokens += estimated;
    }
    if (current.length) batches.push(current);
    const paddedTokens = batches.reduce((total, batch) => total
      + batch.reduce((max, index) => Math.max(max, estimates[index]), 0) * batch.length, 0);
    return { batches, paddedTokens, strategy };
  };
  const baseline = pack(sourceOrder, 'source-order');
  const hasGroups = Array.isArray(groups) && groups.length === estimates.length;
  const groupOrder = new Map();
  for (const group of hasGroups ? groups : []) {
    if (!groupOrder.has(group?.groupId)) groupOrder.set(group?.groupId, groupOrder.size);
  }
  const bucket = index => Math.ceil(Math.log2(estimates[index]));
  let selected = baseline;
  // First establish the optimized ungrouped bound. Group-local tie ordering
  // must improve that actual alternative, not only the source-order baseline.
  for (const grouped of hasGroups ? [false, true] : [false]) {
    const bound = selected;
    for (const exact of [false, true]) for (const direction of [1, -1]) {
      const length = exact ? index => estimates[index] : bucket;
      const order = sourceOrder.slice().sort((a, b) => direction * (length(a) - length(b))
        || (grouped ? groupOrder.get(groups[a]?.groupId) - groupOrder.get(groups[b]?.groupId) : 0) || a - b);
      const candidate = pack(order, `${exact ? 'exact' : 'bucket'}-length-${direction === 1 ? 'ascending' : 'descending'}`);
      if (candidate.batches.length > bound.batches.length || candidate.paddedTokens > bound.paddedTokens) continue;
      if (candidate.paddedTokens < selected.paddedTokens
        || (candidate.paddedTokens === selected.paddedTokens && candidate.batches.length < selected.batches.length)) {
        selected = candidate;
      }
    }
  }
  return { ...selected, baselinePaddedTokens: baseline.paddedTokens };
};

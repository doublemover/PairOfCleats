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
  // Ascending buckets can strand long items in the final short batch. Compare
  // both directions against the unchanged source-order plan. Never trade more
  // calls or more estimated padded work for an unmeasured locality benefit.
  for (const exact of [false, true]) for (const direction of [1, -1]) {
    const length = exact ? index => estimates[index] : bucket;
    const order = sourceOrder.slice().sort((a, b) => direction * (length(a) - length(b))
      || (hasGroups ? groupOrder.get(groups[a]?.groupId) - groupOrder.get(groups[b]?.groupId) : 0) || a - b);
    const candidate = pack(order, `${exact ? 'exact' : 'bucket'}-length-${direction === 1 ? 'ascending' : 'descending'}`);
    if (candidate.batches.length > baseline.batches.length || candidate.paddedTokens > baseline.paddedTokens) continue;
    if (candidate.paddedTokens < selected.paddedTokens
      || (candidate.paddedTokens === selected.paddedTokens && candidate.batches.length < selected.batches.length)) {
      selected = candidate;
    }
  }
  return { ...selected, baselinePaddedTokens: baseline.paddedTokens };
};

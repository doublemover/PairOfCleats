/** Invocation-owned interval lookup; results retain original input order. */
export const createIntervalIndex = (values, getStart, getEnd) => {
  const entries = Array.from(values, (value, order) => ({ value, order, start: getStart(value), end: getEnd(value) }))
    .sort((a, b) => a.start - b.start || a.order - b.order);
  const build = (low, high) => {
    if (low >= high) return null;
    const middle = (low + high) >>> 1;
    const node = { ...entries[middle], left: build(low, middle), right: build(middle + 1, high) };
    node.maxEnd = Math.max(node.end, node.left?.maxEnd ?? -Infinity, node.right?.maxEnd ?? -Infinity);
    return node;
  };
  const root = build(0, entries.length);
  return Object.freeze({
    find(start, end) {
      const selected = [], stack = root ? [root] : [];
      while (stack.length) {
        const node = stack.pop();
        if (node.maxEnd < start) continue;
        if (node.left) stack.push(node.left);
        if (node.start > end) continue;
        if (node.end >= start) selected.push(node);
        if (node.right) stack.push(node.right);
      }
      selected.sort((a, b) => a.order - b.order);
      return selected.map(entry => entry.value);
    }
  });
};

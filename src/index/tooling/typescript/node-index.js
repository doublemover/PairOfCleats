/** One document scan per live Program; nodes never cross the provider boundary. */
export const createTypeScriptNodeIndex = (ts, sourceFile, getName) => {
  const rows = [], names = new Map(), spans = new Map(), stack = [sourceFile];
  while (stack.length) {
    const node = stack.pop();
    const name = getName(ts, node, sourceFile);
    const row = { node, name, start: node.getStart(sourceFile), end: node.getEnd() };
    rows.push(row);
    const key = row.start + ":" + row.end;
    if (!spans.has(key)) spans.set(key, []);
    spans.get(key).push(node);
    if (name) {
      let bucket = names.get(name);
      if (!bucket) names.set(name, bucket = []);
      bucket.push(row);
    }
    const children = [];
    ts.forEachChild(node, child => { children.push(child); });
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  rows.sort((a, b) => a.start - b.start || a.end - b.end);
  const build = (lo, hi) => {
    if (lo >= hi) return null;
    const mid = (lo + hi) >>> 1, left = build(lo, mid), right = build(mid + 1, hi), row = rows[mid];
    return { row, left, right, maxEnd: Math.max(row.end, left?.maxEnd ?? -1, right?.maxEnd ?? -1) };
  };
  const root = build(0, rows.length);
  return {
    nodeCount: rows.length,
    nodes: () => ({ *[Symbol.iterator]() { for (const row of rows) yield row.node; } }),
    exact: (start, end) => spans.get(start + ":" + end) || [],
    named: name => names.get(name) || [],
    overlapping(range) {
      if (!range || range.end <= range.start) return [];
      const matches = [], pending = [root];
      while (pending.length) {
        const entry = pending.pop();
        if (!entry || entry.maxEnd <= range.start) continue;
        const { row } = entry;
        if (row.end > row.start && row.end > range.start && row.start < range.end) matches.push(row);
        pending.push(entry.left);
        if (row.start < range.end) pending.push(entry.right);
      }
      return matches;
    }
  };
};

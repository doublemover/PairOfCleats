/** Internal computation over the relational owner's original state. This
 * returns staged rows/arrangements, never a relation or publication authority. */
export const prepareInnerJoinMaintenance = ({ state, left, right, leftRows, rightRows, tick, key, project, fail, budget }) => {
  if (state.definition.operator !== 'inner-join') return null;
  const parentKey = row => key([row.occurrenceId, row.supportId]);
  const pairKey = (a, b) => key([a.occurrenceId, a.supportId, b.occurrenceId, b.supportId]);
  const oldRows = state.report.rows, leftChanges = left.supportChanges, rightChanges = right.supportChanges;
  const fullMinimum = leftRows.length * 2 + rightRows.length;
  const copyCost = (leftChanges.length ? state.leftByTo.size : 0) + (rightChanges.length ? state.rightByKey.size : 0);
  const baseCost = copyCost + (leftChanges.length + rightChanges.length) * 4 + oldRows.length * 2;
  if (baseCost >= fullMinimum) return null;
  const update = (original, changes, field) => {
    if (!changes.length) return original;
    const next = new Map(), changed = new Map();
    for (const [group, rows] of original) { tick(); next.set(group, rows); }
    for (const change of changes) {
      tick(); const group = change[field];
      if (!changed.has(group)) {
        const rows = new Map();
        for (const row of original.get(group) ?? []) { tick(); rows.set(parentKey(row), row); }
        changed.set(group, rows);
      }
      const rows = changed.get(group), id = parentKey(change);
      const count = BigInt(rows.get(id)?.multiplicity ?? '0') + BigInt(change.multiplicity);
      if (count < 0n) throw fail('Original join arrangement support underflow.');
      if (count === 0n) rows.delete(id); else rows.set(id, { ...change, multiplicity: count.toString() });
    }
    for (const [group, rows] of changed) {
      tick(); if (rows.size) next.set(group, [...rows.values()]); else next.delete(group);
    }
    return next;
  };
  const leftByTo = update(state.leftByTo, leftChanges, 'to');
  let terms = 0;
  for (const change of leftChanges) { tick(); terms += state.rightByKey.get(change.to)?.length ?? 0; }
  for (const change of rightChanges) { tick(); terms += leftByTo.get(change.from)?.length ?? 0; }
  // Bound the entire staged pair inventory before allocation. A dense
  // intermediate can cancel to a tiny final bag; full recomputation owns it.
  if (oldRows.length + terms > state.limits.outputSupports
    || baseCost + terms * 3 + oldRows.length * Math.ceil(Math.log2(oldRows.length + terms + 1)) >= fullMinimum) return null;
  const rightByKey = update(state.rightByKey, rightChanges, 'from'), pairs = new Map();
  for (const row of oldRows) {
    tick(); pairs.set(pairKey(row.parents.left, row.parents.right), { previous: row, count: BigInt(row.multiplicity), a: null, b: null });
  }
  const add = (a, b) => {
    tick(); const id = pairKey(a, b);
    let pair = pairs.get(id);
    if (!pair) { pair = { previous: null, count: 0n, a, b }; pairs.set(id, pair); }
    pair.a = a; pair.b = b;
    pair.count += BigInt(a.multiplicity) * BigInt(b.multiplicity);
  };
  // Role-ordered telescoping: deltaL*oldR + newL*deltaR includes the
  // new/new term exactly once, including aliases of the same bag relation.
  for (const change of leftChanges) for (const oldRight of state.rightByKey.get(change.to) ?? []) add(change, oldRight);
  for (const change of rightChanges) for (const newLeft of leftByTo.get(change.from) ?? []) add(newLeft, change);
  const rows = []; let supportHashes = 0;
  for (const pair of pairs.values()) {
    tick();
    if (pair.count < 0n) throw fail('Original joined support underflow.');
    if (pair.count === 0n) continue;
    // Intermediate signed products may cancel. Only the final atomic
    // coefficient belongs to the existing persisted 128-digit contract.
    if (pair.count.toString().length > 128) throw budget('coefficientDigits');
    if (!pair.a) rows.push(pair.previous);
    else { rows.push(project(pair.a, pair.b, pair.count, pair.previous)); if (!pair.previous) supportHashes++; }
  }
  return { rows, leftByTo, rightByKey, supportHashes, pairTerms: terms };
};

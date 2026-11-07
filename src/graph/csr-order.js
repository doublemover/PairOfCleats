const admitted = new WeakSet();

export const hasAdmittedCsrOrder = csr => admitted.has(csr);

/** A complete family must match normalized IDs and contain unique ascending rows. */
export const admitCsrFamily = (csr, idTable) => {
  admitted.delete(csr);
  const ids = idTable.ids;
  if (!Array.isArray(csr?.ids) || csr.ids.length !== ids.length
    || !ids.every((id, index) => csr.ids[index] === id)
    || !(csr.offsets instanceof Uint32Array) || !(csr.edges instanceof Uint32Array)
    || csr.offsets.length !== ids.length + 1 || csr.offsets[0] !== 0
    || csr.offsets[ids.length] !== csr.edges.length) return false;
  for (let row = 0; row < ids.length; row += 1) {
    const start = csr.offsets[row], end = csr.offsets[row + 1];
    if (end < start || end > csr.edges.length) return false;
    let previous = -1;
    for (let offset = start; offset < end; offset += 1) {
      const target = csr.edges[offset];
      if (target >= ids.length || target <= previous) return false;
      previous = target;
    }
  }
  admitted.add(csr);
  return true;
};

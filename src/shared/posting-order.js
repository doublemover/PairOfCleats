const sortedPostings = new WeakSet();

/** Validate ordering once at immutable generation admission, without a second corpus copy. */
export const admitSortedPostings = index => {
  for (const posting of Array.isArray(index?.postings) ? index.postings : []) {
    if (!Array.isArray(posting)) continue;
    sortedPostings.delete(posting);
    let previous = -1, sorted = true;
    for (const row of posting) {
      const id = row?.[0];
      if (!Number.isSafeInteger(id) || id < 0 || id <= previous) { sorted = false; break; }
      previous = id;
    }
    if (sorted) sortedPostings.add(posting);
  }
  return index;
};

export const hasAdmittedPostingOrder = posting => sortedPostings.has(posting);

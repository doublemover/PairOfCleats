const sortedPostings = new WeakSet();
const completeVocabularies = new WeakSet();

/** Validate ordering once at immutable generation admission, without a second corpus copy. */
export const admitSortedPostings = (index, { completeVocabulary = false } = {}) => {
  let allOrdered = Array.isArray(index?.postings) && Array.isArray(index?.vocab)
    && index.postings.length === index.vocab.length;
  for (const posting of Array.isArray(index?.postings) ? index.postings : []) {
    if (!Array.isArray(posting)) { allOrdered = false; continue; }
    sortedPostings.delete(posting);
    let previous = -1, sorted = true;
    for (const row of posting) {
      const id = row?.[0];
      if (!Number.isSafeInteger(id) || id < 0 || id <= previous) { sorted = false; break; }
      previous = id;
    }
    if (sorted) sortedPostings.add(posting);
    else allOrdered = false;
  }
  if (index && typeof index === 'object') {
    completeVocabularies.delete(index);
    if (allOrdered && completeVocabulary) completeVocabularies.add(index);
  }
  return index;
};

export const hasAdmittedPostingOrder = posting => sortedPostings.has(posting);
export const hasCompletePostingVocabulary = index => completeVocabularies.has(index);

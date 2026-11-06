const sortedPostings = new WeakSet();
const completeVocabularies = new WeakSet();

/** Vocabulary positions and postings are one identity domain. A duplicate term
 * cannot be repaired by choosing whichever map entry happens to survive.
 */
export const postingVocabularyError = (vocab, postings) => {
  if (vocab.length !== postings.length) return 'vocab and postings must have equal cardinality';
  const seen = new Set();
  for (const term of vocab) {
    if (typeof term !== 'string') return 'vocab entries must be strings';
    if (seen.has(term)) return 'vocab entries must be unique';
    seen.add(term);
  }
  return null;
};

/** Validate ordering once at immutable generation admission, without a second corpus copy. */
export const admitSortedPostings = (index, { completeVocabulary = false } = {}) => {
  if (index && typeof index === 'object') completeVocabularies.delete(index);
  if (Array.isArray(index?.vocab) && Array.isArray(index?.postings)) {
    const reason = postingVocabularyError(index.vocab, index.postings);
    if (reason) {
      for (const posting of index.postings) sortedPostings.delete(posting);
      throw Object.assign(new Error(`Invalid postings vocabulary: ${reason}.`), { code: 'ERR_ARTIFACT_INVALID' });
    }
  }
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
    if (allOrdered && completeVocabulary) completeVocabularies.add(index);
  }
  return index;
};

export const hasAdmittedPostingOrder = posting => sortedPostings.has(posting);
export const hasCompletePostingVocabulary = index => completeVocabularies.has(index);

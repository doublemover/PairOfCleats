export const RETRIEVAL_SPARSE_UNAVAILABLE_CODE = 'retrieval_sparse_unavailable';

const pushIfEnabled = (target, enabled, names) => {
  if (!enabled) return;
  for (const name of names) target.add(name);
};

export const resolveSparseRequiredTables = (postingsConfig = {}) => {
  const required = new Set([
    'token_vocab',
    'token_postings',
    'doc_lengths',
    'token_stats'
  ]);
  pushIfEnabled(required, postingsConfig?.enablePhraseNgrams !== false, [
    'phrase_vocab',
    'phrase_postings'
  ]);
  pushIfEnabled(required, postingsConfig?.enableChargrams !== false, [
    'chargram_vocab',
    'chargram_postings'
  ]);
  return Array.from(required.values());
};

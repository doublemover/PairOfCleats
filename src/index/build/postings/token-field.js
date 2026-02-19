import { sortStrings } from './constants.js';

/**
 * Build token-level and field-level sparse posting artifacts.
 *
 * @param {{
 *   sparseEnabled?: boolean,
 *   tokenPostings: Map<any, unknown>,
 *   tokenIdMap?: Map<any, string>|null,
 *   fieldPostings?: Record<string, Map<string, unknown>>|null,
 *   fieldDocLengths?: Record<string, number[]>|null,
 *   normalizedDocLengths?: number[],
 *   requestYield?: (() => Promise<void> | null)|null,
 *   normalizeTfPostingList: (value: unknown) => Array<[number, number]>
 * }} [input]
 * @returns {Promise<{
 *   tokenVocab: string[],
 *   tokenVocabIds: Array<string|number>|null,
 *   tokenPostingsList: Array<Array<[number, number]>>,
 *   avgDocLen: number,
 *   fieldPostingsResult: { fields: Record<string, {
 *     vocab: string[],
 *     postings: Array<Array<[number, number]>>,
 *     docLengths: number[],
 *     avgDocLen: number,
 *     totalDocs: number
 *   }>}|null
 * }>}
 */
export const buildTokenAndFieldPostings = async ({
  sparseEnabled,
  tokenPostings,
  tokenIdMap,
  fieldPostings,
  fieldDocLengths,
  normalizedDocLengths,
  requestYield,
  normalizeTfPostingList
} = {}) => {
  let tokenVocab = [];
  let tokenVocabIds = [];
  let tokenPostingsList = [];
  if (sparseEnabled) {
    let includeTokenIds = tokenIdMap && tokenIdMap.size > 0;
    const tokenEntries = [];
    for (const id of tokenPostings.keys()) {
      const mapped = tokenIdMap?.get(id);
      if (!mapped) includeTokenIds = false;
      const token = mapped ?? (typeof id === 'string' ? id : String(id));
      tokenEntries.push({ id, token });
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
    tokenEntries.sort((a, b) => sortStrings(a.token, b.token));
    tokenVocab = new Array(tokenEntries.length);
    tokenVocabIds = includeTokenIds ? new Array(tokenEntries.length) : null;
    tokenPostingsList = new Array(tokenEntries.length);
    for (let i = 0; i < tokenEntries.length; i += 1) {
      const entry = tokenEntries[i];
      tokenVocab[i] = entry.token;
      if (tokenVocabIds) tokenVocabIds[i] = entry.id;
      tokenPostingsList[i] = normalizeTfPostingList(tokenPostings.get(entry.id));
      tokenPostings.delete(entry.id);
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
  }
  if (typeof tokenPostings?.clear === 'function') tokenPostings.clear();
  const avgDocLen = normalizedDocLengths.length
    ? normalizedDocLengths.reduce((sum, len) => sum + len, 0) / normalizedDocLengths.length
    : 0;

  /**
   * Build per-field sparse postings with deterministic token order.
   *
   * @returns {Promise<{ fields: Record<string, {
   *   vocab: string[],
   *   postings: Array<Array<[number, number]>>,
   *   docLengths: number[],
   *   avgDocLen: number,
   *   totalDocs: number
   * }>}|null>}
   */
  const buildFieldPostings = async () => {
    if (!sparseEnabled) return null;
    if (!fieldPostings || !fieldDocLengths) return null;
    const fields = {};
    const fieldEntries = Object.entries(fieldPostings).sort((a, b) => sortStrings(a[0], b[0]));
    for (const [field, postingsMap] of fieldEntries) {
      if (!postingsMap || typeof postingsMap.keys !== 'function') continue;
      const vocab = [];
      for (const token of postingsMap.keys()) {
        vocab.push(token);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      vocab.sort(sortStrings);
      const postings = new Array(vocab.length);
      for (let i = 0; i < vocab.length; i += 1) {
        const token = vocab[i];
        postings[i] = normalizeTfPostingList(postingsMap.get(token));
        postingsMap.delete(token);
        const waitForYield = requestYield?.();
        if (waitForYield) await waitForYield;
      }
      if (typeof postingsMap.clear === 'function') postingsMap.clear();
      const lengthsRaw = fieldDocLengths[field] || [];
      const lengths = Array.isArray(lengthsRaw)
        ? lengthsRaw.map((len) => (Number.isFinite(len) ? len : 0))
        : [];
      const avgLen = lengths.length
        ? lengths.reduce((sum, len) => sum + len, 0) / lengths.length
        : 0;
      fields[field] = {
        vocab,
        postings,
        docLengths: lengths,
        avgDocLen: avgLen,
        totalDocs: lengths.length
      };
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
    return Object.keys(fields).length ? { fields } : null;
  };

  return {
    tokenVocab,
    tokenVocabIds,
    tokenPostingsList,
    avgDocLen,
    fieldPostingsResult: await buildFieldPostings()
  };
};

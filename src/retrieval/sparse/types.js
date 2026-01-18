/**
 * @typedef {object} SparseSearchParams
 * @property {object} idx
 * @property {string[]} queryTokens
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {number} topN
 * @property {Set<number>|null} [allowedIds]
 * @property {object|null} [fieldWeights]
 * @property {number} [k1]
 * @property {number} [b]
 * @property {object|null} [tokenIndexOverride]
 * @property {object} [options]
 */

/**
 * @typedef {object} SparseSearchResult
 * @property {Array<{idx:number,score:number}>} hits
 * @property {string} type
 */

/**
 * @typedef {object} SparseProvider
 * @property {string} id
 * @property {(params: SparseSearchParams) => SparseSearchResult} search
 */

export const SPARSE_PROVIDER_IDS = Object.freeze({
  SQLITE_FTS: 'sqlite-fts',
  JS_BM25: 'js-bm25',
  TANTIVY: 'tantivy'
});

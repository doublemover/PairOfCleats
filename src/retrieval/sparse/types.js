/**
 * @typedef {object} SparseSearchParams
 * @property {object} idx
 * @property {string[]} queryTokens
 * @property {'code'|'prose'|'records'|'extracted-prose'} mode
 * @property {number} topN
 * @property {import('../ann/types.js').AnnCandidateSet|null} [allowedIds]
 * @property {object|null} [fieldWeights]
 * @property {number} [k1]
 * @property {number} [b]
 * @property {object|null} [tokenIndexOverride]
 * @property {object} [options]
 * @property {boolean} [includeZeroScores]
 * @property {object|null} [work]
 * @property {(()=>void)|null} [throwIfAborted]
 */

/** Native FTS compilation/execution remains distinct from ordinary BM25. The
 * matcher must reach ranking: generic token matching is not equivalent to the
 * selected native tokenizer's eligibility decision.
 * @typedef {'unicode61'|'trigram'|'porter'} FtsVariant
 * @typedef {{table:string,tokenizer:string,variant:FtsVariant}} SparseFtsExecution
 * @typedef {{code:string,reason:'db_unavailable'|'missing_table'|'query_failed',mode:'code'|'prose'|'records'|'extracted-prose',message:string|null}} SparseFtsDiagnostic
 * @typedef {{rowCap:number,timeBudgetMs:number,rowsScanned:number,rowsMatched:number,canPushdown:boolean,filteredByAllowedIds:boolean,truncated:boolean,elapsedMs:number}} SparseFtsOverfetch
 * @typedef {(idx:object,id:number,chunk:object,semanticCandidate?:boolean)=>boolean} SparseQueryMatcher
 * @typedef {Omit<SparseSearchParams,'allowedIds'> & {allowedIds?:ReadonlySet<number>|null,ftsMatch?:string|null,ftsVariant?:FtsVariant,queryAst?:import('../query-types.js').QueryAst|null,onDiagnostic?:(diagnostic:SparseFtsDiagnostic)=>void,onOverfetch?:(stats:SparseFtsOverfetch)=>void}} SqliteFtsSearchParams
 */

/**
 * @typedef {object} SparseRankedResult
 * @property {Array<{idx:number,score:number}>} hits
 * @property {'bm25'|'bm25-fielded'|'tantivy'} type
 */

/**
 * @typedef {object} SqliteFtsSearchResult
 * @property {Array<{idx:number,score:number}>} hits
 * @property {'fts'} type
 * @property {SparseFtsExecution|null} execution
 * @property {SparseQueryMatcher|null} matchesQueryAst
 */

/** @typedef {SparseRankedResult|SqliteFtsSearchResult} SparseSearchResult */

/** Specific factory capability: caller sees the native FTS inputs and outputs.
 * @typedef {SparseProvider<SqliteFtsSearchParams,SqliteFtsSearchResult> & {requireTables:(input?:{variant?:FtsVariant,mode?:'code'|'prose'|'records'|'extracted-prose'})=>string[]}} SqliteFtsProvider
 */

/**
 * @template {SparseSearchParams} [Params=SparseSearchParams]
 * @template {SparseSearchResult} [Result=SparseSearchResult]
 * @typedef {object} SparseProvider
 * @property {string} id
 * @property {{booleanUniverse?:'eligible-id-completion'}} [capabilities]
 * @property {(params: Params) => Result} search
 */

export const SPARSE_PROVIDER_IDS = Object.freeze({
  SQLITE_FTS: 'sqlite-fts',
  JS_BM25: 'js-bm25',
  TANTIVY: 'tantivy'
});

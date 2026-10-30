// Compile-only consumer corpus. Never emitted/executed; no backend is opened.
import type { AnnEmbedding, AnnCandidateSet, AnnProvider, AnnQueryParams } from '../../src/retrieval/ann/types.js';
import type { SparseSearchResult, SqliteFtsSearchParams, SqliteFtsSearchResult, SqliteFtsProvider } from '../../src/retrieval/sparse/types.js';
import type { QueryAst } from '../../src/retrieval/query-types.js';

const embedding: AnnEmbedding = new Float32Array([0.1, 0.2]);
const candidates: AnnCandidateSet = { size: () => 2, has: id => id === 1 || id === 2,
  toArray: () => new Uint32Array([1, 2]) };
const ann: AnnQueryParams = { idx: {}, mode: 'code', embedding, topN: 5, candidateSet: candidates,
  signal: new AbortController().signal };
const readonlyEmbedding: AnnEmbedding = [0.1, 0.2] as const;
const nullableAnn: AnnQueryParams = { ...ann, embedding: null, candidateSet: null, signal: null };
const annProvider: AnnProvider = { id: 'fixture', isAvailable: params => params.embedding !== null,
  query: async params => params.signal?.aborted ? [] : [{ idx: 1, sim: 0.5 }] };
void annProvider.query(ann); void readonlyEmbedding; void nullableAnn;

// @ts-expect-error An arbitrary ArrayLike is not a supported numeric container.
const arrayLike: AnnEmbedding = { 0: 0.1, length: 1 };
// @ts-expect-error DataView is not an indexed numeric embedding.
const dataView: AnnEmbedding = new DataView(new ArrayBuffer(8));
// @ts-expect-error BigInt vectors do not satisfy the numeric provider contract.
const bigInts: AnnEmbedding = new BigInt64Array([1n]);
// @ts-expect-error A membership-only object omits cardinality and enumeration.
const incompleteCandidates: AnnCandidateSet = { has: (_id: number) => true };
// @ts-expect-error Cancellation requires an actual AbortSignal contract.
const falseSignal: AnnQueryParams = { ...ann, signal: { aborted: true } };

const queryAst: QueryAst = { type: 'and', implicit: false,
  left: { type: 'term', value: 'running' }, right: { type: 'not', child: { type: 'phrase', value: 'old code' } } };
const fts: SqliteFtsSearchParams = { idx: {}, queryTokens: ['running'], mode: 'prose', topN: 5,
  allowedIds: new Set([1]), ftsMatch: '"running"', ftsVariant: 'porter', queryAst,
  onDiagnostic: diagnostic => { const message: string | null = diagnostic.message; void message; },
  onOverfetch: stats => { const rows: number = stats.rowsScanned; const truncated: boolean = stats.truncated; void rows; void truncated; } };
const unavailable: SqliteFtsSearchResult = { type: 'fts', hits: [], execution: null, matchesQueryAst: null };
const ftsProvider: SqliteFtsProvider = { id: 'sqlite-fts', requireTables: () => ['chunks', 'chunks_fts'],
  search: _params => ({ type: 'fts', hits: [{ idx: 1, score: 0.5 }],
    execution: { table: 'chunks_fts_porter', tokenizer: 'porter unicode61', variant: 'porter' },
    matchesQueryAst: (_idx, id, _chunk, semanticCandidate = false) => id === 1 && !semanticCandidate }) };
const result: SparseSearchResult = ftsProvider.search(fts);
if (result.type === 'fts') {
  const variant = result.execution?.variant;
  const eligible: boolean | undefined = result.matchesQueryAst?.({}, 1, {}, false);
  void variant; void eligible;
}
void unavailable;
// @ts-expect-error A native FTS result must expose availability of both execution and eligibility.
const missingEligibility: SparseSearchResult = { type: 'fts', hits: [] };
// @ts-expect-error Ordinary BM25 cannot claim the native eligibility result capability.
const inventedFts: SparseSearchResult = { type: 'bm25', hits: [], execution: null };
// @ts-expect-error An overfetch callback receives structured work observations, not text.
const wrongCallback: SqliteFtsSearchParams = { ...fts, onOverfetch: (_stats: string) => {} };
// @ts-expect-error Native eligibility is a boolean decision.
const wrongMatcher: SqliteFtsSearchResult = { ...unavailable, matchesQueryAst: () => 'eligible' };
// @ts-expect-error Unsupported tokenizer names cannot become an execution variant.
const wrongVariant: SqliteFtsSearchParams = { ...fts, ftsVariant: 'invented-tokenizer' };
// @ts-expect-error Native FTS receives normalized set membership/cardinality, not the generic bitmap/array union.
const unnormalizedFtsIds: SqliteFtsSearchParams = { ...fts, allowedIds: [1, 2] };
// @ts-expect-error Boolean operators require complete owned operand shapes.
const wrongAst: QueryAst = { type: 'and', left: { type: 'term', value: 'one' } };

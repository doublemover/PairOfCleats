import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';
import { createSqliteFtsProvider } from '../../src/retrieval/sparse/providers/sqlite-fts.js';
import { isEmbeddingReady } from '../../src/retrieval/ann/utils.js';

// UNVALIDATED: narrow checked consumer/leaf declarations plus actual FTS adapter.
// Full repository checked-JS, real SQLite/native and backend cancellation stay
// with their existing behavioral owners. No backend opens in this fixture.
const roots = ['tests/retrieval/provider-contracts.fixture.ts', 'src/retrieval/ann/types.js',
  'src/retrieval/sparse/types.js', 'src/retrieval/query-types.js'].map(file => path.resolve(file));
const program = ts.createProgram(roots, { noEmit: true, allowJs: true, checkJs: true, strict: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => process.cwd(), getCanonicalFileName: file => file, getNewLine: () => '\n'
}));
assert.equal(isEmbeddingReady({ 0: 0.1, length: 1 }), false);
assert.equal(isEmbeddingReady(new DataView(new ArrayBuffer(8))), false);
assert.equal(isEmbeddingReady(new Float32Array([0.1])), true);
assert.equal(isEmbeddingReady([0.1]), true);

const execution = { table: 'chunks_fts_porter', tokenizer: 'porter unicode61', variant: 'porter' };
const matcher = (_idx, id) => id === 7;
const diagnostic = { code: 'retrieval_fts_unavailable', reason: 'missing_table', mode: 'prose', message: null };
const overfetch = { rowCap: 20, timeBudgetMs: 90, rowsScanned: 10, rowsMatched: 1,
  canPushdown: true, filteredByAllowedIds: true, truncated: false, elapsedMs: 1 };
let request, options, observedDiagnostic, observedOverfetch;
const provider = createSqliteFtsProvider({ rankSqliteFts: (...args) => {
  request = args; options = args[6];
  options.onExecution(execution); options.onEligibility(matcher);
  options.onDiagnostic(diagnostic); options.onOverfetch(overfetch);
  return [{ idx: 7, score: 1 }];
} });
const queryAst = { type: 'term', value: 'running' }, allowedIds = new Set([7]);
const result = provider.search({ idx: {}, queryTokens: ['running'], mode: 'prose', topN: 5, allowedIds,
  ftsMatch: '"running"', ftsVariant: 'porter', queryAst,
  onDiagnostic: value => { observedDiagnostic = value; }, onOverfetch: value => { observedOverfetch = value; } });
assert.equal(request[5], allowedIds); assert.equal(options.queryAst, queryAst);
assert.equal(options.ftsVariant, 'porter'); assert.equal(options.ftsMatch, '"running"');
assert.equal(result.type, 'fts'); assert.equal(result.execution, execution);
assert.equal(result.matchesQueryAst, matcher); assert.equal(result.matchesQueryAst({}, 7, {}), true);
assert.equal(result.matchesQueryAst({}, 8, {}), false);
assert.equal(observedDiagnostic, diagnostic); assert.equal(observedOverfetch, overfetch);
const unavailable = createSqliteFtsProvider({ rankSqliteFts: () => [] }).search({ idx: {}, queryTokens: ['one'], mode: 'code', topN: 5 });
assert.equal(unavailable.execution, null); assert.equal(unavailable.matchesQueryAst, null);
console.log('ANN/FTS checked consumer declarations and actual eligibility handoff controls passed');

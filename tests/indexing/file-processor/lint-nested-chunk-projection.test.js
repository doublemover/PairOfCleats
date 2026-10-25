import assert from 'node:assert/strict';
import { createLintChunkResolver } from '../../../src/index/build/file-processor/process-chunks/lint-intervals.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { createDisabledAnalysisPolicy, createProcessChunksFixtureContext, processFixtureChunks } from './process-chunks-fixture.js';
import { buildIncrementalSignaturePayload } from '../../../src/index/build/indexer/signatures.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { createLintPolicy, createLintSource, lintCacheKey } from '../../../src/index/lint-policy.js';

const entries = [
  { id: 'later', line: 7, endLine: 7, message: 'later method only' },
  { id: 'file-level', message: 'first chunk only' },
  { id: 'spanning', line: 3, endLine: 6, message: 'closed intersection' },
  { id: 'early', line: 2, endLine: 2, message: 'early method only' }
].map(Object.freeze);
const expected = (start, end, unscoped) => entries.filter(entry => {
  if (entry.line === undefined) return unscoped;
  return entry.line <= end && (entry.endLine ?? entry.line) >= start;
});
const ids = items => items.map(item => item.id);
const resolve = createLintChunkResolver(entries);
assert.deepEqual(ids(resolve(1, 10, true)), ['later', 'file-level', 'spanning', 'early']);
assert.deepEqual(ids(resolve(2, 4)), ['spanning', 'early']);
assert.deepEqual(ids(resolve(6, 8)), ['later', 'spanning'], 'future diagnostics survive the nested early method');
assert.equal(resolve.stats.sourceAdvances, 3); assert.equal(resolve.stats.retainedEntries, 2);
const ranges = [[1, 10], [1, 1], [2, 4], [2, 8], [6, 8], [9, 10], [3, 3], [0, 20], [7, 7]];
for (const unscoped of [false, true]) {
  const resolver = createLintChunkResolver(entries);
  for (const [start, end] of ranges) assert.deepEqual(resolver(start, end, unscoped), expected(start, end, unscoped));
  assert.ok(resolver.stats.fallbackQueries > 0);
  assert.ok(resolver.stats.sourceAdvances <= entries.length, 'cursor admission is reused rather than restarting every query');
}
const text = ['class Demo {', '  early() {', '    const a = 1;', '  }', '',
  '  later() {', '    const b = 2;', '  }', '', '}'].join('\n');
const structural = buildJsChunks(text);
assert.deepEqual(structural.map(chunk => chunk.name), ['Demo', 'Demo.early', 'Demo.later']);
const { context } = createProcessChunksFixtureContext({ text, tokenizeEnabled: false,
  analysisPolicy: createDisabledAnalysisPolicy(), riskAnalysisEnabled: false, typeInferenceEnabled: false,
  overrides: { sc: structural.map(chunk => ({ ...chunk, segment: { languageId: 'javascript', segmentUid: 'lint-fixture' } })),
    lintEnabled: true, root: process.cwd() } });
const policy = createLintPolicy(context.root), source = createLintSource(text, context.rel, policy);
const completed = { receipt: { schemaVersion: 1, status: 'completed', reason: null, source, producer: policy.producer,
  policy: { mode: policy.mode, identity: policy.identity, rootHash: policy.rootHash }, clean: false,
  diagnostics: { total: entries.length, shown: entries.length, omitted: 0, truncated: false } }, messages: entries };
let reads = 0, writes = 0;
context.lintCache = { get(key) { reads++; assert.equal(key, lintCacheKey(policy, source)); return completed; },
  set() { writes++; throw new Error('the completed file result must not invoke lint once per chunk'); } };
const result = await processFixtureChunks(context);
assert.equal(result.skip, undefined); assert.equal(result.chunks.length, 3);
const chunks = new Map(result.chunks.map(chunk => [chunk.name, chunk]));
assert.deepEqual(ids(chunks.get('Demo').lint), ['later', 'file-level', 'spanning', 'early']);
assert.deepEqual(ids(chunks.get('Demo.early').lint), ['spanning', 'early']);
assert.deepEqual(ids(chunks.get('Demo.later').lint), ['later', 'spanning']);
assert.deepEqual([chunks.get('Demo.early').startLine, chunks.get('Demo.early').endLine], [2, 4]);
assert.deepEqual([chunks.get('Demo.later').startLine, chunks.get('Demo.later').endLine], [6, 8]);
assert.equal(reads, 1); assert.equal(writes, 0);
assert.equal(buildIncrementalSignaturePayload({ lintEnabled: true }, 'code', null).features.lintProjectionProducer,
  SEMANTIC_ANALYSIS_VERSIONS.lintProjection);
assert.equal(buildIncrementalSignaturePayload({ lintEnabled: false }, 'code', null).features.lintProjectionProducer, undefined);
console.log('nested source chunks receive exactly intersecting diagnostics in original provider order');

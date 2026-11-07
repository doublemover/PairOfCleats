import assert from 'node:assert/strict';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { chunkSegments } from '../../../src/index/segments.js';
import { buildPythonChunksFromAst, buildPythonHeuristicChunks, extractPythonDocMeta } from '../../../src/lang/python.js';
import { preparePythonChunkContext, resolvePythonPreparedChunks } from '../../../src/lang/python/prepared-chunks.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

// Authored actual converter/adapter/dispatch/segment controls. AST metadata below
// is explicit synthetic input; actual interpreter preparation has its own case.
ensureTestingEnv(process.env);
const text = 'def control(value):\n    return value\n';
const ast = { defs: [{ name: 'control', startLine: 1, startCol: 0, endLine: 2, endCol: 16,
  signature: 'control(value)', params: ['value'], docstring: 'original metadata' }] };
let astCalls = 0, heuristicCalls = 0;
const convert = {
  ast(source, input) { astCalls++; return buildPythonChunksFromAst(source, input); },
  heuristic(source) { heuristicCalls++; return buildPythonHeuristicChunks(source); }
};
const prepared = preparePythonChunkContext({ text, pythonAst: ast }, convert);
assert.deepEqual([astCalls, heuristicCalls], [1, 0]);
assert.equal(resolvePythonPreparedChunks(text, prepared, convert), prepared.pythonChunks);
assert.equal(resolvePythonPreparedChunks(text, { ...prepared }, convert), prepared.pythonChunks, 'actual context spread retains the receipt');
const dispatched = smartChunk({ text, ext: '.py', mode: 'code', context: prepared });
assert.deepEqual(dispatched, prepared.pythonChunks);
assert.equal(dispatched[0], prepared.pythonChunks[0], 'limit application can allocate an array without rebuilding chunk objects');
assert.deepEqual([astCalls, heuristicCalls], [1, 0], 'dispatch does not repeat AST conversion');
assert.equal(extractPythonDocMeta(prepared.pythonChunks[0], null, prepared).doc, 'original metadata');
const native = [{ start: 0, end: text.length, kind: 'NativeFixture', name: 'native', meta: {} }];
assert.equal(resolvePythonPreparedChunks(text, { ...prepared, pythonTreeChunks: native }, convert), prepared.pythonChunks,
  'prepared AST keeps original AST-before-native priority');

const python = LANGUAGE_REGISTRY.find(adapter => adapter.id === 'python');
const disabled = await python.prepare({ text, mode: 'code', relPath: 'source.py', options: { pythonAst: { enabled: false } } });
assert.equal(disabled.pythonAst, null);
assert.equal(smartChunk({ text, ext: '.py', mode: 'code', context: disabled })[0], disabled.pythonChunks[0],
  'actual AST-disabled preparation reaches the real dispatcher without rebuilding chunk objects');
assert.deepEqual(disabled.pythonChunks, buildPythonHeuristicChunks(text));
const freshOptions = await python.prepare({ text, mode: 'code', relPath: 'source.py', options: {
  pythonAst: { enabled: false }, astDataflowEnabled: false, controlFlowEnabled: false
} });
assert.notEqual(freshOptions.pythonChunkPreparation, disabled.pythonChunkPreparation,
  'each actual options preparation has its own receipt rather than a stale cross-invocation cache');
assert.notEqual(freshOptions.pythonChunks, disabled.pythonChunks);
assert.deepEqual(freshOptions.pythonChunks, disabled.pythonChunks);
assert.equal(resolvePythonPreparedChunks(text, { ...disabled, pythonTreeChunks: native }, convert), native,
  'native chunks still precede a prepared heuristic fallback');

const emptyAst = preparePythonChunkContext({ text, pythonAst: { defs: [] } }, convert);
assert.deepEqual([astCalls, heuristicCalls], [2, 1]);
assert.equal(resolvePythonPreparedChunks(text, emptyAst, convert), emptyAst.pythonChunks);
assert.deepEqual([astCalls, heuristicCalls], [2, 1]);
const noDefinitions = preparePythonChunkContext({ text: 'value = 1\n', pythonAst: { defs: [] } }, convert);
assert.equal(noDefinitions.pythonChunks, null);
const beforeEmpty = [astCalls, heuristicCalls];
assert.equal(resolvePythonPreparedChunks('value = 1\n', noDefinitions, convert), null);
assert.deepEqual([astCalls, heuristicCalls], beforeEmpty, 'a prepared null is distinct from a missing receipt');
const fallback = smartChunk({ text: 'value = 1\n', ext: '.py', mode: 'code', context: noDefinitions });
assert.equal(fallback[0].kind, 'Module');
assert.equal(fallback[0].end, 'value = 1\n'.length);
const explicitlyEmpty = preparePythonChunkContext({ text: '' }, { heuristic: () => [], ast: () => assert.fail('no AST input') });
assert.equal(resolvePythonPreparedChunks('', explicitlyEmpty), explicitlyEmpty.pythonChunks);

const changedText = 'def replacement():\n    return 2\n';
const changed = resolvePythonPreparedChunks(changedText, { ...prepared, pythonTreeChunks: native }, convert);
assert.equal(changed[0].name, 'replacement', 'old source cannot supply old AST/native ranges');
assert.notEqual(changed, prepared.pythonChunks);
const replacementAst = { defs: [{ name: 'replacement', startLine: 1, endLine: 2, endCol: 12 }] };
assert.equal(resolvePythonPreparedChunks(changedText, { ...prepared, pythonAst: replacementAst }, convert)[0].name, 'replacement');
assert.notEqual(resolvePythonPreparedChunks(text, { ...prepared, pythonChunks: [...prepared.pythonChunks] }, convert), prepared.pythonChunks);
assert.notEqual(resolvePythonPreparedChunks(text, { ...prepared, pythonChunkPreparation: {} }, convert), prepared.pythonChunks,
  'a copied public receipt shape cannot authorize reuse');
assert.equal(resolvePythonPreparedChunks(text, { pythonAst: ast, pythonTreeChunks: native }, convert)[0].name, 'control');
assert.equal(resolvePythonPreparedChunks(text, { pythonTreeChunks: native }, convert), native, 'direct native context remains supported');

const limited = smartChunk({ text, ext: '.py', mode: 'code', context: { ...prepared, chunking: { maxLines: 1 } } });
assert.ok(limited.length > prepared.pythonChunks.length, 'current limits run after reuse');
assert.deepEqual(prepared.pythonChunks, buildPythonChunksFromAst(text, ast), 'limits cannot mutate the original prepared projection');
const prefix = '# container prefix\n', container = prefix + text;
const containerContext = await python.prepare({ text: container, mode: 'code', options: { pythonAst: { enabled: false } } });
const embedded = chunkSegments({ text: container, ext: '.py', mode: 'code', relPath: 'source.py', context: containerContext,
  segments: [{ start: prefix.length, end: container.length, type: 'embedded', languageId: 'python', segmentId: 'fixture', meta: {} }] });
assert.equal(embedded.length, 1);
assert.equal(embedded[0].start, prefix.length);
assert.equal(embedded[0].end, container.length);
assert.equal(embedded[0].name, 'control', 'slice uses its own local conversion and rebases once');
console.log('Python prepared converter/adapter/dispatch/segment controls authored; execution deferred.');

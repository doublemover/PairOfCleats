import assert from 'node:assert/strict';
import { buildCssChunks } from '../../../src/lang/css.js';
import { buildLuaChunks } from '../../../src/lang/lua.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { SEMANTIC_ANALYSIS_VERSIONS, semanticAnalysisPolicyIdentity } from '../../../src/index/semantic/analysis-versions.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/specialized-native-projection-admission/')[1];
assert.ok(['css', 'lua'].includes(selected));
const cssNames = Array.from({ length: 96 }, (_, index) => `.item${index}[data-label="a  b"]`);
const sources = selected === 'css' ? {
  wide: { text: cssNames.map(name => name + ' { color: red; }').join('\n'), names: cssNames },
  deep: { text: '@media screen {\n'.repeat(24) + '.inside { color: red; }\n' + '}\n'.repeat(24),
    names: [...Array(24).fill('@media screen'), '.inside'] },
  roles: { text: '/* 😀 café */\r\n[data-x="{;a  b"] { color: red; }\r\n@scope (.panel) to (.nested) { .title { color: blue; } }',
    names: ['[data-x="{;a  b"]', '@scope (.panel) to (.nested)', '.title'] }
} : {
  wide: { text: 'function owner()\n' + Array.from({ length: 128 }, (_, index) => `target${index}()`).join('\n') + '\nowner()\nend',
    names: ['owner'], calls: [...Array.from({ length: 128 }, (_, index) => 'target' + index), 'owner'] },
  deep: { text: 'function owner()\n' + 'if ready then\n'.repeat(24) + 'target()\n' + 'end\n'.repeat(24) + 'end', names: ['owner'], calls: ['target'] },
  roles: { text: '-- 😀 café\r\nlocal make = function(value) return target(value) end\r\nfunction recur(n) return recur(n-1) end\r\n',
    names: ['make', 'recur'], calls: ['target', 'recur'] }
};
const build = selected === 'css' ? buildCssChunks : buildLuaChunks, ext = '.' + selected;
const parser = getNativeTreeSitterParser(selected); assert.ok(parser, 'locked installed native grammar is required');
const first = parser.parse(sources.roles.text); let syntaxNode;
try { syntaxNode = first.rootNode; assert.equal(syntaxNode.hasError, false); }
finally { first.delete?.(); parser.reset?.(); }
const restores = [], reads = {};
let controller = null, abortAfter = null, parseCalls = 0, resetCalls = 0;
const totalReads = () => Object.values(reads).reduce((sum, count) => sum + count, 0);
for (const key of ['namedChild', 'namedChildCount', 'child', 'childCount', 'childForFieldName', 'childrenForFieldName', 'parent']) {
  let prototype = Object.getPrototypeOf(syntaxNode), descriptor;
  while (prototype && !(descriptor = Object.getOwnPropertyDescriptor(prototype, key))) prototype = Object.getPrototypeOf(prototype);
  assert.ok(descriptor, 'actual public native API: ' + key); assert.equal(descriptor.configurable, true); reads[key] = 0;
  const observe = () => { reads[key]++; if (abortAfter !== null && totalReads() === abortAfter) controller.abort(); };
  const replacement = descriptor.value ? { ...descriptor, value: function(...args) {
    observe(); return Reflect.apply(descriptor.value, this, args);
  } } : { ...descriptor, get: function() { observe(); return Reflect.apply(descriptor.get, this, []); } };
  Object.defineProperty(prototype, key, replacement); restores.push(() => Object.defineProperty(prototype, key, descriptor));
}
const originalParse = parser.parse, originalReset = parser.reset;
parser.parse = function(...args) { parseCalls++; return Reflect.apply(originalParse, this, args); };
parser.reset = function(...args) { resetCalls++; return Reflect.apply(originalReset, this, args); };
restores.push(() => { parser.parse = originalParse; parser.reset = originalReset; });
const high = { maxAstNodes: 200000, maxAstStack: 200000, maxChunkNodes: 5000 };
const options = budget => ({ treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false,
  ...high, byLanguage: { [selected]: budget } }, astDataflowEnabled: false, controlFlowEnabled: false });
const measure = (text, budget = high) => {
  for (const key of Object.keys(reads)) reads[key] = 0;
  const before = { ...treeSitterState.metrics }, parsed = parseCalls, reset = resetCalls;
  const chunks = build(text, options(budget));
  assert.equal(parseCalls - parsed, 1); assert.equal(resetCalls - reset, 1, 'the original parser is reset on each completed native projection');
  const work = Object.fromEntries(Object.entries(treeSitterState.metrics).filter(([key]) => key.startsWith('projection'))
    .map(([key, value]) => [key.slice(10), value - (before[key] || 0)]));
  assert.ok(totalReads() <= work.Operations, 'independent native child/field/ancestor accesses are charged');
  assert.ok(work.Operations <= budget.maxAstNodes); assert.ok(work.MaxFrontier <= budget.maxAstStack);
  return { chunks, work, nativeReads: { ...reads } };
};
const partial = (chunks, text) => {
  assert.equal(chunks.length, 1); assert.equal(chunks[0].start, 0); assert.equal(chunks[0].end, text.length);
  assert.equal(chunks[0].name, 'file'); assert.equal(chunks[0].kind, 'File'); assert.equal(chunks[0].meta.wholeFile, true);
  assert.deepEqual(chunks[0].meta.syntaxCalls, []); assert.match(chunks[0].meta.syntaxCallCoverage, /^partial-projection-budget:/u);
};
const samples = [];
try {
  for (const [shape, spec] of Object.entries(sources)) {
    const actualSyntax = Reflect.apply(originalParse, parser, [spec.text]);
    try { assert.equal(actualSyntax.rootNode.hasError, false, selected + '/' + shape); }
    finally { actualSyntax.delete?.(); Reflect.apply(originalReset, parser, []); }
    const cold = measure(spec.text), warm = measure(spec.text);
    assert.deepEqual(cold.chunks.map(chunk => chunk.name), spec.names); assert.deepEqual(warm.chunks, cold.chunks);
    assert.ok(cold.chunks.every(chunk => !chunk.meta.wholeFile));
    if (selected === 'lua') {
      const calls = cold.chunks.flatMap(chunk => chunk.meta.syntaxCalls || []);
      assert.deepEqual(calls.map(call => call.callee).sort(), [...spec.calls].sort());
      assert.ok(calls.every(call => Object.isFrozen(call) && call.start >= 0 && call.end <= spec.text.length));
      for (const call of calls) assert.ok(spec.text.slice(call.start, call.end).startsWith(call.callee));
    }
    // Exact observed operation/output boundary and one fewer admitted unit.
    const exact = { ...high, maxAstNodes: cold.work.Operations, maxChunkNodes: cold.work.OutputRows };
    assert.deepEqual(measure(spec.text, exact).chunks, cold.chunks);
    partial(measure(spec.text, { ...exact, maxAstNodes: exact.maxAstNodes - 1 }).chunks, spec.text);
    assert.deepEqual(measure(spec.text, { ...high, maxAstStack: cold.work.MaxFrontier }).chunks, cold.chunks);
    if (cold.work.MaxFrontier > 1) partial(measure(spec.text, { ...high, maxAstStack: cold.work.MaxFrontier - 1 }).chunks, spec.text);
    if (exact.maxChunkNodes > 1) partial(measure(spec.text, { ...high, maxChunkNodes: exact.maxChunkNodes - 1 }).chunks, spec.text);
    for (const budget of [{ ...high, maxAstNodes: 1 }, { ...high, maxAstStack: 1 }]) partial(measure(spec.text, budget).chunks, spec.text);
    samples.push({ shape, sourceUtf8Bytes: Buffer.byteLength(spec.text), sourceUtf16Units: spec.text.length, work: cold.work, nativeReads: cold.nativeReads });
  }
  controller = new AbortController(); abortAfter = 8;
  for (const key of Object.keys(reads)) reads[key] = 0;
  const parsed = parseCalls, reset = resetCalls;
  assert.throws(() => build(sources.wide.text, { ...options(high), abortSignal: controller.signal }),
    error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
  assert.equal(totalReads(), abortAfter); assert.equal(parseCalls - parsed, 1); assert.equal(resetCalls - reset, 1);
  abortAfter = null;
} finally { for (const restore of restores.reverse()) restore(); }

// Actual registered language preparation, canonical IDs and payload/schema
// consumers must preserve the explicit partial envelope, without lexical retry.
for (const signalKey of ['abortSignal', 'signal']) {
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => build(sources.roles.text, { ...options(high), [signalKey]: cancelled.signal }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
}
const registered = await prepareRegisteredLanguage({ text: sources.roles.text, ext, options: options({ maxAstNodes: 1 }) });
partial(registered.chunks, sources.roles.text); assert.ok(registered.chunks[0].chunkUid);
assert.ok(registered.payloads.every(row => row.kind === 'File' && row.metaV2));
const persisted = JSON.parse(JSON.stringify(registered.payloads.map((row, id) => ({ ...row, id }))));
const validation = validateArtifact('chunk_meta', persisted); assert.equal(validation.ok, true, validation.errors?.join('; '));
assert.ok(persisted.every(row => /^partial-projection-budget:/u.test(row.codeRelations.callCoverage)));
assert.ok(registered.projected.every(row => !row.calls?.length));
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.sourceChunking, '54');
assert.notEqual(semanticAnalysisPolicyIdentity({ enrichment: {}, storage: {} }),
  semanticAnalysisPolicyIdentity({ enrichment: {}, storage: {} }, { ...SEMANTIC_ANALYSIS_VERSIONS, sourceChunking: '53' }));
console.log(JSON.stringify({ selected, samples, scope: 'original native parser/metadata APIs; bounded projection only, native parse work excluded' }));

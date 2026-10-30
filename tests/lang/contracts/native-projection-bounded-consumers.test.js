import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { createCallSites, enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/native-projection-bounded-consumers/')[1];
const shapes = {
  wide: 'def owner(): Int = {\n' + Array.from({ length: 110 }, (_, i) => `target${i}()`).join('\n') + '\nowner()\n1\n}',
  declarations: Array.from({ length: 48 }, (_, i) => `def owner${i}(): Int = target${i}()`).join('\n'),
  deep: 'def owner(): Int = {\n' + 'if (ready) {\n'.repeat(32) + 'target()\n' + '}\n'.repeat(32) + '1\n}',
  unicode: '// 😀 λ preserve original UTF-16 coordinates\r\ndef owner(): Int = { target(); target(); 1 }\r\n'
};
assert.ok(Object.hasOwn(shapes, selected));
const text = shapes[selected], expectedTargets = selected === 'wide' ? [...Array.from({ length: 110 }, (_, i) => `target${i}`), 'owner']
  : selected === 'declarations' ? Array.from({ length: 48 }, (_, i) => `target${i}`) : selected === 'deep' ? ['target'] : ['target', 'target'];
const parser = getNativeTreeSitterParser('scala'); assert.ok(parser, 'actual prepared Scala parser is required');
const syntax = parser.parse(text);
let syntaxNode;
try { assert.equal(syntax.rootNode.hasError, false); syntaxNode = syntax.rootNode; }
finally { syntax.delete?.(); parser.reset?.(); }
const findDescriptor = key => {
  for (let prototype = Object.getPrototypeOf(syntaxNode); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) return { prototype, descriptor };
  }
  throw new Error('Missing public native SyntaxNode API: ' + key);
};
const originals = [], reads = { namedChild: 0, namedChildCount: 0, childForFieldName: 0, parent: 0 };
let controller = null, abortAfter = null;
const totalReads = () => Object.values(reads).reduce((sum, value) => sum + value, 0);
for (const key of Object.keys(reads)) {
  const { prototype, descriptor } = findDescriptor(key); assert.equal(descriptor.configurable, true);
  const observe = () => { reads[key]++; if (abortAfter !== null && totalReads() === abortAfter) controller.abort(); };
  const replacement = typeof descriptor.value === 'function' ? { ...descriptor, value: function(...args) {
    observe(); return Reflect.apply(descriptor.value, this, args);
  } } : { ...descriptor, get: function() { observe(); return Reflect.apply(descriptor.get, this, []); } };
  originals.push(() => Object.defineProperty(prototype, key, descriptor)); Object.defineProperty(prototype, key, replacement);
}
const resetReads = () => { for (const key of Object.keys(reads)) reads[key] = 0; };
const metrics = () => ({ ...treeSitterState.metrics });
const delta = before => Object.fromEntries(Object.entries(treeSitterState.metrics)
  .filter(([key, value]) => key.startsWith('projection') && typeof value === 'number')
  .map(([key, value]) => [key, value - (before[key] || 0)]));
const samples = [], budget = { maxAstNodes: 100000, maxAstStack: 100000, maxChunkNodes: 1000 };
const options = useQueries => ({ treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false, useQueries, ...budget } });
const calls = chunks => chunks.flatMap(chunk => chunk.meta?.syntaxCalls || []);
let complete, identity;
try {
  for (const useQueries of [false, true]) for (const temperature of ['cold', 'warm']) {
    resetReads(); const before = metrics(), cpu = process.cpuUsage(), memory = process.memoryUsage(), started = performance.now();
    const chunks = buildTreeSitterChunks({ text, languageId: 'scala', ext: '.scala', options: options(useQueries) });
    const elapsedMs = performance.now() - started, work = delta(before), facts = calls(chunks);
    assert.deepEqual(facts.map(fact => fact.callee).sort(), [...expectedTargets].sort(), 'all original native occurrences survive admission');
    assert.ok(chunks.every(chunk => !chunk.meta.syntaxCallCoverage?.includes('budget')));
    assert.ok(work.projectionOperations <= budget.maxAstNodes); assert.ok(work.projectionMaxFrontier <= budget.maxAstStack);
    assert.ok(work.projectionOperations >= totalReads(), 'independent original native metadata accesses are charged');
    assert.equal(work.projectionOutputRows, chunks.length);
    if (useQueries) assert.ok((treeSitterState.metrics.queryExecutions || 0) > (before.queryExecutions || 0), 'native Query actually executes');
    for (const fact of facts) {
      assert.ok(fact.start >= 0 && fact.end <= text.length && fact.end > fact.start);
      assert.equal(text.slice(fact.start, fact.start + fact.callee.length), fact.callee, 'source coordinates identify the original invocation');
      assert.ok(Object.isFrozen(fact));
    }
    const nextIdentity = chunks.map(chunk => ({ start: chunk.start, end: chunk.end, name: chunk.name, kind: chunk.kind, calls: chunk.meta.syntaxCalls }));
    if (identity) assert.deepEqual(nextIdentity, identity, 'query/walk and cold/warm have equal owner/role/range occurrence evidence');
    identity = nextIdentity; complete = chunks;
    samples.push({ selected, useQueries, temperature, elapsedMs, cpuMicros: process.cpuUsage(cpu), nativeReads: { ...reads }, work,
      inputUtf8Bytes: Buffer.byteLength(text), inputUtf16Units: text.length, outputJsonBytes: Buffer.byteLength(JSON.stringify(chunks)),
      memoryBefore: memory, memoryAfter: process.memoryUsage(), processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
  }
  for (const useQueries of [false, true]) for (const maximum of [1, 16]) {
    resetReads(); const before = metrics();
    const bounded = buildTreeSitterChunks({ text, languageId: 'scala', ext: '.scala',
      options: { treeSitter: { ...options(useQueries).treeSitter, maxAstNodes: maximum, maxAstStack: 1 } } });
    assert.equal(bounded.length, 1); assert.equal(bounded[0].start, 0); assert.equal(bounded[0].end, text.length);
    assert.deepEqual(bounded[0].meta.syntaxCalls, []); assert.match(bounded[0].meta.syntaxCallCoverage, /^partial-projection-budget:/u);
    assert.ok(delta(before).projectionOperations <= maximum); assert.ok(totalReads() <= maximum);
    assert.ok(delta(before).projectionMaxFrontier <= 1, 'rejected native child expansion does not allocate a wider JS frontier');
  }
  controller = new AbortController(); abortAfter = 8; resetReads();
  assert.throws(() => buildTreeSitterChunks({ text, languageId: 'scala', ext: '.scala',
    options: { ...options(false), abortSignal: controller.signal } }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
  assert.equal(totalReads(), abortAfter, 'original native metadata access stops at cancellation, with no later projection callback');
} finally { for (const restore of originals.reverse()) restore(); }

if (selected === 'wide') {
  const { dir } = await prepareIsolatedTestCacheDir('native-projection-call-spill');
  const chunks = complete.map((chunk, id) => ({ ...chunk, id, file: 'fixture.scala', lang: 'scala', chunkUid: 'actual-native-owner-' + id,
    codeRelations: { callDetails: chunk.meta.syntaxCalls.map(detail => ({ ...detail })) } }));
  const expected = createCallSites({ chunks }); assert.equal(expected.length, 111);
  try {
    for (const compression of [null, 'gzip']) {
      const outDir = path.join(dir, compression || 'plain'); await fs.mkdir(outDir);
      const jobs = [], pieces = [], state = { chunks };
      const result = await enqueueCallSitesArtifacts({ state, outDir, maxJsonBytes: 4096, spillBufferRows: 1, spillBufferBytes: 1024,
        compression, enqueueWrite: (_label, write) => jobs.push(write), formatArtifactLabel: value => value,
        addPieceFile: (entry, file) => pieces.push({ entry, file }) });
      assert.equal(result.totalEntries, expected.length);
      assert.ok((await fs.readdir(path.join(outDir, 'call_sites.runs'))).length > 32, 'actual native facts force bounded multi-pass merge');
      for (const job of jobs) await job();
      const actual = [];
      for (const piece of pieces.filter(piece => piece.entry.name === 'call_sites')) {
        for await (const row of readJsonLinesIterator(piece.file, { maxBytes: 1024 * 1024 })) actual.push(row);
      }
      assert.deepEqual(actual, expected); assert.equal(state.callSitesCoverage.status, 'complete'); assert.equal(state.callSitesCoverage.dropped, 0);
      await assert.rejects(fs.stat(path.join(outDir, 'call_sites.runs')), { code: 'ENOENT' });
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ kind: 'actual-native-projection-work', samples,
  resourceScope: 'serial correctness/work observations: CPU, endpoint memory, and process-lifetime OS maxRSS; not continuous per-case peak sampling' }));

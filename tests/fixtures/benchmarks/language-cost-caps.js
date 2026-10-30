import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { buildLineIndex } from '../../../src/lang/python/normalize.js';
import { createPythonByteColumnResolver } from '../../../src/lang/python/byte-columns.js';
import { chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { chunkCacheRetentionObservation } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const [scenario, destination] = process.argv.slice(2);
assert.ok(['python-inline', 'python-lines', 'yaml'].includes(scenario));
assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const observations = [], started = performance.now();
const memory = () => ({ ...process.memoryUsage() });
const measure = (name, operation, validate, iterations = 16) => {
  const samples = []; let result;
  for (let index = 0; index < iterations; index++) {
    const before = memory(), cpu = process.threadCpuUsage(), at = performance.now();
    result = operation();
    samples.push({ wallMs: performance.now() - at, cpu: process.threadCpuUsage(cpu), before, after: memory() });
    validate(result); // Correctness and output accounting stay outside timed work.
  }
  const row = { name, iterations, samples, outputBytes: Buffer.byteLength(JSON.stringify(result)), outputSha256: digest(result) };
  observations.push(row); return { row, result };
};
const allocationSample = (name, operation) => observeHeapAllocations({ destination, name, operation });
if (scenario === 'python-inline') {
  for (const count of [64, 256, 1024]) for (const unicode of [false, true]) {
    const expected = Array.from({ length: count }, (_, index) => `${unicode ? '包' : 'dep'}_${String(index).padStart(5, '0')}`);
    const inline = expected.map(name => `if TYPE_CHECKING: import ${name}; value = {'import phantom': 1}\n`).join('');
    const multiline = expected.map(name => `if TYPE_CHECKING:\n import ${name}\n value = {'import phantom': 1}\n`).join('');
    const check = result => assert.deepEqual(result.imports, expected);
    for (const [shape, text] of [['inline', inline], ['multiline', multiline]]) {
      const { row } = measure(shape + '-' + count + (unicode ? '-unicode' : '-ascii'), () => collectPythonImports(text), check);
      row.source = { bytes: Buffer.byteLength(text), sha256: digest(text), imports: count };
      row.allocations = await allocationSample(row.name, () => collectPythonImports(text));
    }
  }
} else if (scenario === 'python-lines') {
  for (const size of [8192, 65536, 262144]) for (const newline of ['\n', '\r\n', '\r']) for (const unicode of [false, true]) {
    for (const longLine of [false, true]) {
      const unit = unicode ? 'é😀中' : 'abcd';
      const line = longLine ? unit.repeat(Math.ceil(size / Buffer.byteLength(unit))) : unit.repeat(8);
      const count = longLine ? 1 : Math.ceil(size / (Buffer.byteLength(line) + Buffer.byteLength(newline)));
      const text = Array.from({ length: count }, () => line).join(newline);
      const starts = []; let offset = 0;
      for (let index = 0; index < count; index++) { starts.push(offset); offset += line.length + newline.length; }
      const columns = [0, Buffer.byteLength(line.slice(0, 3)), Buffer.byteLength(line)];
      const operation = () => {
        const index = buildLineIndex(text), resolve = createPythonByteColumnResolver(text, index);
        const witnesses = [];
        for (let selected = 0; selected < count; selected++) {
          witnesses.push(columns.map(column => resolve(selected + 1, column)));
        }
        return { index, resolve, witnesses };
      };
      const check = result => {
        assert.deepEqual(result.index, starts);
        assert.deepEqual(result.witnesses, starts.map(start => [start, start + 3, start + line.length]));
      };
      const { row } = measure(`${longLine ? 'long' : 'many'}-${size}-${digest(newline).slice(0, 6)}-${unicode ? 'unicode' : 'ascii'}`, operation, check);
      row.source = { bytes: Buffer.byteLength(text), utf16Units: text.length, lines: count, newline, sha256: digest(text) };
      // Capture actual source-owned checkpoint arrays, separately from clean
      // timing. This counts table payloads, not all JS/native allocations.
      const original = Uint32Array.from, tables = [];
      try {
        Uint32Array.from = function(...args) { const array = Reflect.apply(original, this, args); tables.push(array.byteLength); return array; };
        const held = operation(); check(held);
        row.checkpoints = { arrays: tables.length, bytes: tables.reduce((sum, value) => sum + value, 0),
          lineIndexEntries: held.index.length, capturedOriginalUint32ArrayFrom: true,
          scope: 'actual byte/unit checkpoint payloads after touching every physical line;lineIndex is a JS array;no whole-heap attribution' };
        assert.equal(tables.length, unicode ? count * 2 : 0);
        assert.ok(row.checkpoints.bytes <= 8 * (Math.ceil(Buffer.byteLength(text) / 256) + count));
      } finally { Uint32Array.from = original; }
      row.allocations = await allocationSample(row.name, operation);
    }
  }
} else {
  const documents = Array.from({ length: 8 }, (_, document) => `---\n# document ${document} 😀\n`
    + Array.from({ length: 16 }, (_, index) => `key_${document}_${index}: value_${index}\n`).join(''));
  const body = documents.join('');
  const corpus = Array.from({ length: 32 }, (_, index) => body + '# corpus ' + String(index).padStart(2, '0') + '\n');
  let selectedText;
  const canonical = rows => rows.map(row => ({ start: row.start, end: row.end, name: row.name, kind: row.kind,
    documentIndex: row.meta.documentIndex,
    documentRange: { start: row.meta.documentRange.start, end: row.meta.documentRange.end } }));
  const make = (enabled, useQueries, caching) => {
    let cursor = 0;
    return () => {
      selectedText = corpus[cursor++ % corpus.length];
      return chunkYaml(selectedText, 'measured.yaml', { yamlChunking: { mode: 'top-level' },
        treeSitter: { enabled, strict: true, adaptive: false, configChunking: enabled, useQueries,
          chunkCache: caching, chunkCacheMaxEntries: 128, cachePersistent: false, cacheKey: digest(selectedText) } });
    };
  };
  const expected = [];
  let documentStart = 0;
  for (const [documentIndex, document] of documents.entries()) {
    const range = { start: documentStart, end: documentStart + document.length };
    const headings = Array.from({ length: 16 }, (_, index) => documentStart + document.indexOf(`key_${documentIndex}_${index}:`));
    for (let index = 0; index < headings.length; index++) expected.push({ start: index === 0 ? documentStart : headings[index],
      end: headings[index + 1] ?? (documentIndex === documents.length - 1 ? corpus[0].length : range.end),
      name: `key_${documentIndex}_${index}`, kind: 'ConfigSection', documentIndex, documentRange: range });
    documentStart = range.end;
  }
  const nativeWitnesses = new Map();
  const stableNative = rows => rows.map(({ meta, ...row }) => {
    // The canonical YAML owner writes wall-clock parseMetrics per invocation.
    // All semantic and native section metadata remain part of the witness.
    const { parseMetrics: _timing, ...facts } = meta;
    return { ...row, meta: facts };
  });
  const check = rows => { assert.deepEqual(canonical(rows), expected);
    assert.equal(rows.map(row => selectedText.slice(row.start, row.end)).join(''), selectedText);
    assert.ok(rows.every(row => row.meta.parser === 'yaml-syntax-nodes' && row.meta.parserCoverage === 'partial'
      && row.meta.parserFallbackReason === null)); };
  for (const [name, enabled, useQueries, caching] of [['canonical', false, false, false], ['walk', true, false, false],
    ['query', true, true, false], ['warm-walk', true, false, true], ['warm-query', true, true, true]]) {
    const operation = make(enabled, useQueries, caching);
    const verify = rows => {
      check(rows);
      if (!enabled) return;
      for (const chunk of rows) {
        assert.equal(chunk.meta.nativeParser, 'tree-sitter');
        for (const section of chunk.meta.nativeSections) assert.ok(section.start >= chunk.start && section.end <= chunk.meta.documentRange.end);
      }
      const key = JSON.stringify([useQueries, digest(selectedText)]), hash = digest(stableNative(rows));
      if (caching) assert.equal(hash, nativeWitnesses.get(key), 'Warm cache retains every native/semantic field beyond invocation timing.');
      else nativeWitnesses.set(key, hash);
    };
    const retentionBefore = chunkCacheRetentionObservation(), primingBefore = { ...treeSitterState.metrics };
    for (let index = 0; index < corpus.length; index++) verify(operation());
    const before = { ...treeSitterState.metrics }, canonicalSamples = [];
    const { row } = measure(name, operation, rows => {
      verify(rows);
      const metrics = rows[0].meta.parseMetrics;
      assert.ok(metrics.tokenCount > 0 && metrics.cstNodeCount > 0 && metrics.nodeCount > 0);
      canonicalSamples.push({ sourceSha256: digest(selectedText), ...metrics });
    });
    row.source = { entries: corpus.map(text => ({ bytes: Buffer.byteLength(text), sha256: digest(text) })), documents: 8, headings: 128,
      priorWork: '32 distinct inputs primed;different text avoids the canonical one-entry structure cache;native warm cohorts reuse all32 admitted entries' };
    row.metrics = Object.fromEntries(Object.entries(treeSitterState.metrics).filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => [key, value - (before[key] || 0)]));
    row.primingMetrics = Object.fromEntries(Object.entries(before).filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => [key, value - (primingBefore[key] || 0)]));
    row.canonicalSamples = canonicalSamples;
    row.cacheRetention = { before: retentionBefore, after: chunkCacheRetentionObservation(),
      scope: 'canonical logical byte charges and retained copies;not attributed or native heap bytes' };
    if (enabled) row.semanticWitnesses = [...nativeWitnesses].filter(([key]) => JSON.parse(key)[0] === useQueries);
    if (caching) assert.equal(row.metrics.chunkCacheHits, 16);
    else if (enabled) assert.ok(row.metrics.projectionVisits > 0);
    if (enabled && useQueries && !caching) {
      assert.ok(row.primingMetrics.projectionQueryExecutions > 0 && row.metrics.projectionQueryExecutions > 0);
      assert.equal(row.primingMetrics.queryFailures, 0); assert.equal(row.metrics.queryFailures, 0);
    }
    row.allocations = await allocationSample(name, operation);
  }
}
assert.ok(performance.now() - started < 30000);
await fs.writeFile(path.join(destination, 'receipt.json'), JSON.stringify({ schemaVersion: 1, scenario, status: 'passed',
  node: process.version, platform: process.platform, architecture: process.arch, observations, elapsedMs: performance.now() - started,
  scope: 'bounded actual source operations;clean CPU/wall separate from allocation sampling;no historical speedup or whole-index/native-allocation claim' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ scenario, status: 'passed', observations: observations.length }));

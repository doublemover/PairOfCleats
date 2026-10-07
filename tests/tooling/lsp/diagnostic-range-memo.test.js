#!/usr/bin/env node
import assert from 'node:assert/strict';
import { shapeDiagnosticsByChunkUid } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';
import { buildTargetLookupIndex, findTargetForOffsets, findTargetForOffsetsLinear } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const uri = 'file:///diagnostic-fixture.js';
const range = (start = 1, end = 3) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } });
const targets = [
  { virtualRange: { start: 0, end: 2000 }, chunkRef: { chunkUid: 'outer' } },
  { virtualRange: { start: 1, end: 4 }, chunkRef: { chunkUid: 'first-inner' } },
  { virtualRange: { start: 1, end: 4 }, chunkRef: { chunkUid: 'tied-inner' } }
];
const shape = (diagnostics, options = {}) => {
  let indexReads = 0;
  const checks = [];
  const built = buildTargetLookupIndex(options.targets || targets);
  const index = { get entries() { indexReads += 1; return built.entries; } };
  const output = shapeDiagnosticsByChunkUid({
    captureDiagnostics: true, diagnosticsByUri: new Map([[uri, diagnostics]]),
    docs: [{ virtualPath: 'fixture.js', text: options.text || 'alpha 😀 omega\r\nnext' }],
    openDocs: new Map([['fixture.js', { uri }]]),
    targetIndexesByPath: new Map([['fixture.js', index]]),
    diskPathMap: new Map(), resolvedRoot: '/tmp', resolvedScheme: 'file',
    lineIndexFactory: buildLineIndex, maxDiagnosticsPerChunk: options.maxDiagnosticsPerChunk ?? 1000,
    checks, checkFlags: {}, positionEncoding: options.encoding || 'utf-16',
    findTargetForOffsets: options.custom ? (targetIndex, offsets) => {
      const indexed = findTargetForOffsets(targetIndex, offsets);
      assert.equal(indexed, findTargetForOffsetsLinear(options.targets || targets, offsets));
      return indexed;
    } : findTargetForOffsets
  });
  return { output, lookups: indexReads / 2, checks };
};

const repeated = Array.from({ length: 50 }, (_, i) => ({ range: range(), message: `message-${i}`, code: i }));
const first = shape(repeated);
assert.equal(shape([]).lookups, 0);
assert.deepEqual(shape([repeated[0]]).output.diagnosticsByChunkUid['first-inner'], [repeated[0]]);
assert.equal(first.lookups, 1, 'equal coordinate values should reuse one document-scoped lookup');
assert.deepEqual(first.output.diagnosticsByChunkUid['first-inner'], repeated);
assert.equal(first.output.diagnosticsCount, 50);
assert.deepEqual(first.output, shape(repeated, { custom: true }).output);
assert.equal(shape(repeated, { custom: true }).lookups, 50, 'custom callbacks keep their invocation semantics');
const capped = shape(repeated, { maxDiagnosticsPerChunk: 2 });
assert.equal(capped.lookups, 1);
assert.deepEqual(capped.output.diagnosticsByChunkUid['first-inner'], repeated.slice(0, 2));
assert.equal(capped.checks.length, 1);
assert.equal(capped.checks[0].name, 'tooling_diagnostics_per_chunk_capped');
const duplicates = shape([repeated[0], { ...repeated[0], range: range() }]);
assert.equal(duplicates.output.diagnosticsCount, 1, 'range memoization must not replace diagnostic-key dedupe');
assert.equal(duplicates.lookups, 1);
const misses = shape(repeated, { targets: [] });
assert.equal(misses.lookups, 1, 'stable misses may be reused inside one document');
assert.equal(misses.output.diagnosticsCount, 0);

for (const encoding of ['utf-8', 'utf-16', 'utf-32']) {
  const diagnostics = Array.from({ length: 20 }, (_, i) => ({ range: range(i % 5, 7 + i % 5), message: String(i) }));
  const result = shape(diagnostics, { encoding });
  assert.deepEqual(result.output, shape(diagnostics, { encoding, custom: true }).output);
  assert.equal(result.lookups, 5);
  assert.equal(result.output.diagnosticsCount, 20);
}

// Bound cache entries even when a direct caller supplies more than the collector
// default. Late unique values keep using the ordinary exact lookup path.
const many = Array.from({ length: 205 }, (_, i) => ({ range: range(i, i + 1), message: String(i) }));
const bounded = shape([...many, ...many.map((diag) => ({ ...diag, message: `again-${diag.message}` }))], { text: 'x'.repeat(1000) });
assert.equal(bounded.lookups, 210, 'only the first 200 coordinate keys may be retained');
assert.equal(bounded.output.diagnosticsCount, 410);

// Malformed/non-integer coordinates are not memoized; retain the conversion
// helper's coercion behavior rather than creating ambiguous cache keys.
const malformed = [{ range: range('1', 3), message: 'a' }, { range: range('1', 3), message: 'b' }];
assert.equal(shape(malformed).lookups, 2);

// Same coordinates in a new call and a new document use their own target state.
const changedTargets = [{ virtualRange: { start: 0, end: 30 }, chunkRef: { chunkUid: 'changed' } }];
assert.deepEqual(shape(repeated, { targets: changedTargets }).output.diagnosticsByChunkUid.changed, repeated);
let perDocumentIndexReads = 0;
const observedIndex = (rows) => {
  const built = buildTargetLookupIndex(rows);
  return { get entries() { perDocumentIndexReads += 1; return built.entries; } };
};
const twoDocuments = shapeDiagnosticsByChunkUid({
  captureDiagnostics: true,
  diagnosticsByUri: new Map([[uri, repeated], ['poc-vfs:///second', repeated]]),
  docs: [{ virtualPath: 'fixture.js', text: 'alpha' }, { virtualPath: 'second.js', text: 'beta' }],
  openDocs: new Map([['fixture.js', { uri }], ['second.js', { uri: 'poc-vfs:///second' }]]),
  targetIndexesByPath: new Map([
    ['fixture.js', observedIndex(targets)],
    ['second.js', observedIndex(changedTargets)]
  ]),
  diskPathMap: new Map(), resolvedRoot: '/tmp', resolvedScheme: 'file',
  lineIndexFactory: buildLineIndex, maxDiagnosticsPerChunk: 1000,
  checks: [], checkFlags: {},
  findTargetForOffsets
});
assert.equal(perDocumentIndexReads / 2, 2, 'identical coordinates in different documents cannot share target results');
assert.equal(twoDocuments.diagnosticsByChunkUid['first-inner'].length, 50);
assert.equal(twoDocuments.diagnosticsByChunkUid.changed.length, 50);
console.log('LSP diagnostic range memoization, cap, encoding, ranking and lifetime contracts passed');

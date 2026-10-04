#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { createDiagnosticsCollector, shapeDiagnosticsByChunkUid } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';
import { buildTargetLookupIndex, findTargetForOffsets } from '../../../src/integrations/tooling/providers/lsp/target-index.js';

const text = 'é😀abc\r\nend';
const ranges = {
  inner: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } },
  outer: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  absent: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }
};
const diagnostics = Array.from({ length: 48 }, (_, id) => ({ code: id, message: `diagnostic ${id}`, range: ranges.inner }));
const shape = (input, { cap = 100, finder = findTargetForOffsets, encoding = 'utf-16', twoDocs = false } = {}) => {
  const paths = twoDocs ? ['one.py', 'two.py'] : ['one.py'];
  const docs = paths.map((virtualPath) => ({ virtualPath, text }));
  const openDocs = new Map();
  const targetIndexesByPath = new Map();
  const diagnosticsByUri = new Map();
  let indexReads = 0;
  for (const virtualPath of paths) {
    const uri = `poc-vfs:///${virtualPath}`;
    openDocs.set(virtualPath, { uri, text, lineIndex: buildLineIndex(text) });
    diagnosticsByUri.set(uri, input);
    const targets = [
      { virtualRange: { start: 0, end: 8 }, chunkRef: { chunkUid: `${virtualPath}:outer` } },
      { virtualRange: { start: 3, end: 5 }, chunkRef: { chunkUid: `${virtualPath}:inner` } },
      { virtualRange: { start: 3, end: 5 }, chunkRef: { chunkUid: `${virtualPath}:tie` } }
    ];
    const built = buildTargetLookupIndex(targets);
    targetIndexesByPath.set(virtualPath, { get entries() { indexReads += 1; return built.entries; } });
  }
  const checks = [];
  const checkFlags = {};
  const output = shapeDiagnosticsByChunkUid({
    captureDiagnostics: true, diagnosticsByUri, docs, openDocs, targetIndexesByPath,
    diskPathMap: new Map(), resolvedRoot: process.cwd(), resolvedScheme: 'poc-vfs',
    lineIndexFactory: buildLineIndex, maxDiagnosticsPerChunk: cap, checks, checkFlags,
    findTargetForOffsets: finder, positionEncoding: encoding
  });
  return { output, checks, checkFlags, indexReads };
};
const baseline = shape(diagnostics, { finder: (index, offsets) => findTargetForOffsets(index, offsets) });
const repeated = shape(diagnostics);
assert.deepEqual(repeated.output, baseline.output);
assert.equal(repeated.output.diagnosticsCount, 48);
assert.equal(repeated.output.diagnosticsByChunkUid['one.py:inner'].length, 48, 'original target order wins tied spans');
assert.equal(baseline.indexReads, 96);
assert.equal(repeated.indexReads, 2, 'adjacent identical offsets should perform one actual target-index lookup');

for (const options of [{ cap: 2 }, { twoDocs: true }, { encoding: 'utf-8' }, { encoding: 'utf-32' }]) {
  const actual = shape([...diagnostics, diagnostics[0]], options);
  const expected = shape([...diagnostics, diagnostics[0]], { ...options, finder: (index, offsets) => findTargetForOffsets(index, offsets) });
  assert.deepEqual(actual.output, expected.output);
  assert.deepEqual(actual.checks, expected.checks);
  assert.deepEqual(actual.checkFlags, expected.checkFlags);
  assert.equal(actual.indexReads, options.twoDocs ? 4 : 2, 'the scalar lookup is scoped to one document');
}
const changed = shape([
  { message: 'inner', range: ranges.inner }, { message: 'outer', range: ranges.outer },
  { message: 'inner again', range: ranges.inner }
]);
assert.equal(changed.indexReads, 6, 'changing ranges do not retain a growing lookup cache');
assert.equal(changed.output.diagnosticsCount, 3);
const absent = shape(Array.from({ length: 5 }, (_, id) => ({ message: `absent ${id}`, range: ranges.absent })));
assert.equal(absent.indexReads, 2);
assert.equal(absent.output.diagnosticsCount, 0);
let customCalls = 0;
shape(diagnostics, { finder: (index, offsets) => { customCalls += 1; return findTargetForOffsets(index, offsets); } });
assert.equal(customCalls, diagnostics.length, 'custom callback invocation semantics remain unchanged');

// URI/version/close admission remains owned by the existing collector.
const collector = createDiagnosticsCollector({ captureDiagnostics: true, checks: [], checkFlags: {}, maxDiagnosticUris: 2, maxDiagnosticsPerUri: 100, requireOwnedDocuments: true });
collector.registerDocument('poc-vfs:///one.py', 2);
collector.onNotification({ method: 'textDocument/publishDiagnostics', params: { uri: 'poc-vfs:///one.py', version: 1, diagnostics } });
assert.equal(collector.diagnosticsByUri.size, 0);
collector.onNotification({ method: 'textDocument/publishDiagnostics', params: { uri: 'poc-vfs:///one.py', version: 2, diagnostics } });
assert.equal(collector.diagnosticsByUri.size, 1);
collector.unregisterDocument('poc-vfs:///one.py');
assert.equal(collector.diagnosticsByUri.size, 0);
console.log('Diagnostic repeated-range lookup passed: actual index96 to2 reads, nested ties, encodings, docs, caps/dedupe and custom-callback parity');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';
import { throwIfAborted, isAbortError } from '../../../src/shared/abort.js';
import { canonicalBundleSourceKey } from '../../../src/shared/bundle-source-key.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/cache-only-enumeration-bound/')[1];
assert.ok(['unselected-chunk-rows', 'duplicate-file-metadata-rows', 'original-iterator-return-pending'].includes(mode));
const source = await fs.readFile(new URL('../../../tools/build/embeddings/runner/cache-only.js', import.meta.url), 'utf8');
const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .flatMap(node => (node.type === 'ExportNamedDeclaration' ? node.declaration : node)?.declarations ?? []);
const declaration = declarations.find(row => row.id.name === 'planStage3CacheOnly')?.init; assert.ok(declaration);
const trace = { chunkRows: 0, fileRows: 0, returns: 0, settled: false, compacted: 0, cacheReads: 0, codeReads: 0 };
const original = new Error('original explicit iterator retirement remains pending');
Object.defineProperties(original, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => trace.settled },
  code: { get() { trace.codeReads++; throw new Error('unsafe diagnostic accessor'); } } }); Object.freeze(original);
const chunks = {
  [Symbol.asyncIterator]() { return this; },
  next: async () => {
    if (trace.chunkRows === 100) return { done: true };
    trace.chunkRows++;
    return { done: false, value: mode === 'duplicate-file-metadata-rows' ? { fileId: 1 } : { file: 'discarded.js' } };
  },
  return: async () => { trace.returns++; if (mode === 'original-iterator-return-pending') throw original;
    trace.settled = true; return { done: true }; }
};
const context = { path, throwIfAborted, isAbortError, canonicalBundleSourceKey, observeStorageResource,
  // Explicit finite owner model tightens only this source-function fixture.
  // Production constants and existing actual cache-only controls stay intact.
  MAX_FILES: 3, MAX_CHUNKS: 3, MAX_VECTOR_BYTES: 1024,
  embeddingArtifactReusable: () => true, buildEmbeddingIdentityKey: () => 'fixture-identity',
  loadChunkMetaRows: () => chunks,
  loadFileMetaRows: async function* () { for (let i = 0; i < 100; i++) { trace.fileRows++; yield { id: 0, file: 'duplicate.js' }; } },
  createDeterministicFileStreamSampler: () => ({ considerFile: () => ({ selected: false }) }),
  resolveCacheDir: () => { trace.cacheReads++; throw new Error('enumeration refusal must precede cache reads'); }
};
const create = vm.runInThisContext('"use strict";\n(({' + Object.keys(context).join(',') + '}) => '
  + source.slice(declaration.start, declaration.end) + ')');
const plan = create(context);
const input = { roots: [['code', 'explicit-model-root']], identity: { stub: false, dims: 2, modelId: 'fixture',
  provider: 'onnx', pooling: 'mean', inputFormatting: {}, modelArtifact: {} }, identityKey: 'fixture-identity',
readManifest: () => ({ manifest: { files: {} } }), readState: () => null,
compactChunk: () => { trace.compacted++; throw new Error('filtered rows must not be compacted'); },
sampling: mode === 'duplicate-file-metadata-rows' ? {} : { maxFiles: 1 } };
if (mode === 'original-iterator-return-pending') {
  const contains = (error, target, seen = new Set()) => {
    if (error === target) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) return false; seen.add(error);
    return contains(Object.getOwnPropertyDescriptor(error, 'cause')?.value, target, seen)
      || (Object.getOwnPropertyDescriptor(error, 'errors')?.value ?? []).some(row => contains(row, target, seen));
  };
  await assert.rejects(plan(input), error => contains(error, original));
  assert.equal(trace.settled, false); assert.equal(trace.returns, 1); assert.equal(trace.codeReads, 0);
  assert.equal(trace.chunkRows, 4, 'only one admitted-boundary probe is delivered');
} else {
  const result = await plan(input); assert.equal(result.eligible, false);
  assert.equal(result.reason, mode === 'duplicate-file-metadata-rows' ? 'preflight-file-budget' : 'preflight-coverage-budget');
  assert.equal(trace.settled, true); assert.equal(trace.returns, 1);
  if (mode === 'duplicate-file-metadata-rows') {
    assert.equal(trace.fileRows, 4); assert.equal(result.work.fileMetaRowsVisited, 4);
    assert.equal(result.work.chunkRowsVisited, 1);
  } else {
    assert.equal(trace.chunkRows, 4); assert.equal(result.work.chunkRowsVisited, 4); assert.equal(result.work.fileMetaRowsVisited, 0);
  }
  assert.equal(result.work.chunksChecked, 0, 'checked vector coverage remains separate from visited metadata');
}
assert.equal(trace.compacted, 0); assert.equal(trace.cacheReads, 0);
console.log('Cache-only preflight accounts for unselected/duplicate metadata and retains original iterator retirement.');

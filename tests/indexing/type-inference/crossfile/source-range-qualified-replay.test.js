import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { createCrossFileSourceReader } from '../../../../src/index/type-inference-crossfile/source-inputs.js';
import { buildCrossFileFingerprint } from '../../../../src/index/type-inference-crossfile/cache.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-source-ranges-'));
const text = '😀\nfunction creator() { return new Widget(); }';
const makeChunk = () => ({ file: 'source.js', fileHash: sha1(text), fileHashAlgo: 'sha1',
  chunkUid: 'creator', name: 'creator', kind: 'function', start: 0, end: text.length,
  docmeta: {}, codeRelations: {} });
const fingerprint = chunk => buildCrossFileFingerprint({ chunks: [chunk], enableTypeInference: true,
  enableRiskCorrelation: false, useTooling: false });
const run = chunk => applyCrossFileInference({ rootDir: root, buildRoot: root,
  cacheRoot: path.join(root, 'cache'), chunks: [chunk], enabled: true, cacheEnabled: true,
  useTooling: false, enableTypeInference: true, enableRiskCorrelation: false, log: () => {} });
try {
  await fs.writeFile(path.join(root, 'source.js'), text);
  const chunk = makeChunk(), reader = createCrossFileSourceReader({ rootDir: root, chunks: [chunk] });
  let reads = 0;
  const guarded = createCrossFileSourceReader({ rootDir: root, chunks: [chunk],
    read: async () => { reads += 1; return Buffer.from(text); } });
  await assert.rejects(guarded.getChunkText({ ...chunk, start: null }), { code: 'ERR_CROSS_FILE_SOURCE_RANGE' });
  assert.equal(reads, 0, 'malformed pinned range shape is rejected before source acquisition');
  assert.equal(await reader.getChunkText(chunk), text);
  assert.equal(await reader.getChunkText({ ...chunk, start: 0, end: 2 }), '😀');
  assert.equal(await reader.getChunkText({ ...chunk, start: text.length, end: text.length }), '');
  assert.equal(reader.coverage().status, 'qualified');
  for (const range of [
    { start: -1, end: text.length }, { start: 0.5, end: text.length },
    { start: 0, end: text.length + 1 }, { start: 4, end: 3 },
    { start: 1, end: 2 }, { start: 0, end: 1 },
    { start: undefined, end: text.length }, { start: '0', end: text.length },
    { start: null, end: text.length }, { start: NaN, end: text.length },
    { start: Infinity, end: text.length }, { start: 0, end: undefined },
    { start: 0, end: '0' }, { start: 0, end: 0.5 },
    { start: 0, end: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    await assert.rejects(reader.getChunkText({ ...chunk, ...range }), { code: 'ERR_CROSS_FILE_SOURCE_RANGE' });
  }
  const unknownChunk = makeChunk();
  delete unknownChunk.fileHash;
  delete unknownChunk.fileHashAlgo;
  const legacy = createCrossFileSourceReader({ rootDir: root, chunks: [unknownChunk] });
  assert.equal(await legacy.getChunkText({ ...unknownChunk, end: text.length + 100 }), text);
  assert.equal(legacy.coverage().status, 'unqualified', 'legacy coercion/clamping does not acquire replay authority');

  const cold = makeChunk();
  assert.equal((await run(cold)).cacheHit, false);
  assert.ok(cold.docmeta.inferredTypes.returns.some(row => row.type === 'Widget'));
  const warm = makeChunk();
  assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(warm, cold);
  for (const range of [{ start: undefined }, { start: '0' }, { start: null },
    { start: 0.5 }, { end: text.length + 1 }, { start: 1 }]) {
    const invalid = { ...makeChunk(), ...range };
    assert.notEqual(fingerprint(invalid), fingerprint(makeChunk()), 'invalid offset must not alias an already cached valid source slice');
    await assert.rejects(run(invalid), { code: 'ERR_CROSS_FILE_SOURCE_RANGE' }, 'invalid pinned range cannot hit cache or clamp into a complete source expression');
  }
  const zero = { ...makeChunk(), end: 0 };
  for (const end of [undefined, null, '0', false, NaN, 0.5]) {
    assert.notEqual(fingerprint({ ...zero, end }), fingerprint(zero), 'invalid end must not alias a valid empty range');
  }
  assert.equal((await run(makeChunk())).cacheHit, true, 'failed range admission cannot replace a valid completed cache entry');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('pinned cross-file UTF-16 range admission and cache alias controls passed');

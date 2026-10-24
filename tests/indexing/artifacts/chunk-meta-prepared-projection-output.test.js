import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChunkMetaIterator, enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { readPreparedJsonlRow } from '../../../src/shared/json-stream/prepared-row.js';
import { resolveJsonlLine } from '../../../src/shared/json-stream/jsonl-write.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-prepared-output-'));
const makeChunk = id => ({ id, chunkId: `chunk-${id}`, chunkUid: `uid-${id}`, file: `src/雪-${id}.js`,
  start: id * 10, end: id * 10 + 5, startLine: id + 1, endLine: id + 1, kind: 'code',
  tokens: ['before', '雪'], tokenIds: ['0000000000000001', '0000000000000002'],
  preContext: `before-${id}`, postContext: `after-${id}`, metaV2: { chunkUid: `uid-${id}`, nested: { stable: true } } });
const iterator = (chunks, options = {}) => createChunkMetaIterator({ chunks, fileIdByPath: new Map(),
  resolvedTokenMode: 'full', tokenSampleSize: 10, maxJsonBytes: 8192, ...options });
try {
  const source = [makeChunk(0), makeChunk(1)];
  const bounded = iterator(source, { prepareRows: true, preparedRowsOptions: { maxCacheRows: 1 } });
  const first = [...bounded()], second = [...bounded()];
  assert.equal(first[0], second[0], 'bounded admitted base projection/packed tokens are reused');
  assert.notEqual(first[1], second[1], 'reuse exhaustion reprojects without growing the cache');
  assert.deepEqual(first, second);
  assert.equal(bounded.preparedStats.retainedRows, 1);
  assert.ok(bounded.preparedStats.retainedBytes <= 4 * 1024 * 1024);
  assert.ok(readPreparedJsonlRow(first[0]));
  assert.equal(readPreparedJsonlRow(first[1]), null);
  source[0].tokens[0] = 'late mutation'; source[0].metaV2.nested.stable = false;
  assert.equal([...bounded()][0].tokens[0], 'before');
  assert.equal([...bounded()][0].metaV2.nested.stable, true);
  assert.throws(() => { first[0].metaV2.nested.stable = false; }, TypeError);

  const oversized = makeChunk(0); oversized.preContext = '😀'.repeat(10000);
  const originalTrim = iterator([oversized], { maxJsonBytes: 512 });
  const preparedTrim = iterator([oversized], { maxJsonBytes: 512, prepareRows: true });
  const baseline = [...originalTrim(0, 1, true)], admitted = [...preparedTrim(0, 1, true)];
  assert.equal(resolveJsonlLine(admitted[0]), JSON.stringify(baseline[0]));
  assert.deepEqual(preparedTrim.stats, originalTrim.stats);
  const trimStats = structuredClone(preparedTrim.stats);
  preparedTrim.resetStats();
  assert.equal([...preparedTrim(0, 1, true)][0], admitted[0]);
  assert.deepEqual(preparedTrim.stats, trimStats, 'cached trim outcomes replay identical counters and reasons');
  assert.ok(preparedTrim.stats.trimmedEntries > 0);

  for (const compression of [null, 'gzip']) {
    const outDir = path.join(root, compression || 'raw'); await fs.mkdir(outDir);
    const chunks = [makeChunk(0), makeChunk(1)];
    let tokenProjectionReads = 0;
    for (const chunk of chunks) {
      const ids = chunk.tokenIds;
      Object.defineProperty(chunk, 'tokenIds', { get() { tokenProjectionReads++; return ids; } });
    }
    const chunkMetaIterator = iterator(chunks), jobs = [];
    const registry = createArtifactPieceRegistry({ outDir });
    await enqueueChunkMetaArtifacts({ outDir, mode: 'code', chunkMetaIterator,
      chunkMetaPlan: { chunkMetaFormat: 'jsonl', chunkMetaStreaming: false, chunkMetaUseJsonl: true,
        chunkMetaUseShards: false, chunkMetaUseColumnar: false, chunkMetaBinaryColumnar: true,
        chunkMetaEstimatedJsonlBytes: 1024, chunkMetaShardSize: 10, chunkMetaCount: chunks.length, maxJsonBytes: 8192 },
      compression, enqueueWrite: (label, job) => jobs.push({ label, job }),
      enqueueJsonArray() { assert.fail('unexpected array copy'); }, ...registry });
    // Output must preserve the already admitted immutable snapshot, including
    // cold fields, when the caller later changes its original nested storage.
    chunks[0].tokens[0] = 'late token'; chunks[0].metaV2.nested.stable = false;
    for (const { job } of jobs) await job();
    assert.equal(tokenProjectionReads, chunks.length, 'scan, hot/cold output and binary fileRef output share base token packing');
    const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: registry.listPieceEntries() };
    for (const preferBinaryColumnar of [false, true]) {
      const loaded = await loadChunkMeta(outDir, { manifest, preferBinaryColumnar });
      assert.equal(loaded.length, 2);
      assert.deepEqual(loaded.map(row => row.file), chunks.map(row => row.file));
      assert.deepEqual(loaded.map(row => row.preContext), ['before-0', 'before-1']);
      assert.equal(loaded[0].tokens[0], 'before');
      assert.equal(loaded[0].metaV2.nested.stable, true);
      assert.equal(Object.hasOwn(loaded[0], '__jsonl'), false);
    }
  }
  const customDir = path.join(root, 'custom-reused'); await fs.mkdir(customDir);
  const customJobs = [], customRegistry = createArtifactPieceRegistry({ outDir: customDir });
  const customIterator = function* () {
    const row = { id: 0, start: 0, end: 1, file: 'reused.js', nested: { value: '' }, preContext: '' };
    for (let id = 0; id < 2; id++) {
      row.id = id; row.nested.value = `value-${id}`; row.preContext = `before-${id}`; yield row;
    }
    row.id = -1; row.nested.value = 'cleared';
  };
  await enqueueChunkMetaArtifacts({ outDir: customDir, chunkMetaIterator: customIterator,
    chunkMetaPlan: { chunkMetaFormat: 'jsonl', chunkMetaStreaming: false, chunkMetaUseJsonl: true,
      chunkMetaUseShards: false, chunkMetaUseColumnar: false, chunkMetaBinaryColumnar: false,
      chunkMetaEstimatedJsonlBytes: 1024, chunkMetaShardSize: 10, chunkMetaCount: 2, maxJsonBytes: 8192 },
    enqueueWrite: (_label, job) => customJobs.push(job), ...customRegistry });
  for (const job of customJobs) await job();
  const customHot = (await fs.readFile(path.join(customDir, 'chunk_meta.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(customHot.map(row => [row.id, row.nested.value]), [[0, 'value-0'], [1, 'value-1']],
    'mutable custom iterator yields never impersonate immutable cached base projections');
  const forged = { id: 7, nested: { value: 'current' }, __jsonl: '{"id":999}' };
  assert.equal(resolveJsonlLine(forged), JSON.stringify(forged), 'public fields cannot impersonate a private encoded receipt');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Bounded chunk-meta preparation reuses projections/packing, preserves trim replay and writes correct hot/cold/fileRef layouts.');

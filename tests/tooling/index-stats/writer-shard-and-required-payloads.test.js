import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import { enqueueChunkMetaArtifacts } from '../../../src/index/build/artifacts/writers/chunk-meta/writer.js';
import { resolveRequiredArtifactsForProfile, buildIndexProfileState } from '../../../src/contracts/index-profile.js';
import { createBaseIndex } from '../../indexing/validate/helpers.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const { dir } = await prepareIsolatedTestCacheDir('stats-writer-shards');
const env = applyTestEnv({ extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const run = async indexDir => {
  const result = await spawnSubprocess(process.execPath, [path.resolve('tools/index/stats.js'), '--index-dir', indexDir, '--json', '--verify'],
    { env, timeoutMs: 5000, maxOutputBytes: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  return { result, report: JSON.parse(result.stdout) };
};
try {
  const fixture = await createBaseIndex({ rootDir: dir }), outDir = fixture.indexDir;
  const manifestPath = path.join(outDir, 'pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.pieces = manifest.pieces.filter(piece => piece.name !== 'chunk_meta');
  const queued = [], registered = [];
  const chunks = Array.from({ length: 5 }, (_value, id) => ({ id, file: `src/${id}.js`, text: `row-${id}`,
    start: id, end: id + 1, tokenCount: 1 }));
  const iterator = createChunkMetaIterator({ chunks, fileIdByPath: new Map(chunks.map(row => [row.file, row.id])),
    resolvedTokenMode: 'normal', tokenSampleSize: 0, maxJsonBytes: 4096 });
  await enqueueChunkMetaArtifacts({ outDir, mode: 'code', chunkMetaIterator: iterator,
    chunkMetaPlan: { chunkMetaFormat: 'jsonl', chunkMetaStreaming: true, chunkMetaUseJsonl: true,
      chunkMetaUseShards: true, chunkMetaUseColumnar: false, chunkMetaBinaryColumnar: true,
      chunkMetaEstimatedJsonlBytes: 8192, chunkMetaShardSize: 3, chunkMetaCount: 5, maxJsonBytes: 4096 },
    maxJsonBytes: 4096, enqueueJsonArray() {}, enqueueWrite: (label, job) => queued.push({ label, job }),
    addPieceFile: (piece, file) => registered.push({ ...piece, path: path.relative(outDir, file).replaceAll('\\', '/') }),
    formatArtifactLabel: file => path.relative(outDir, file), stageCheckpoints: null });
  for (const { job } of queued) await job({ setPhase() {} });
  assert.deepEqual(registered.filter(piece => piece.name === 'chunk_meta').map(piece => piece.count), [3, 2]);
  for (const piece of registered) piece.bytes = (await fs.stat(path.join(outDir, piece.path))).size;
  manifest.pieces.push(...registered);
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const first = await run(outDir); assert.equal(first.result.exitCode, 0, first.result.stderr);
  assert.equal(first.report.modes.code.chunkMeta.rows, 5); assert.equal(first.report.totals.chunkCount, 5);
  assert.equal(first.report.modes.code.chunkMeta.parts, 2);
  assert.ok(registered.some(piece => piece.name === 'chunk_meta_binary_columnar'), 'actual alternative payload is not counted twice');
  const unknown = structuredClone(manifest); delete unknown.pieces.find(piece => piece.name === 'chunk_meta').count;
  await fs.writeFile(manifestPath, JSON.stringify(unknown));
  const unknownStats = await run(outDir);
  assert.equal(unknownStats.report.modes.code.chunkMeta.rows, null); assert.equal(unknownStats.report.totals.chunkCount, null);
  for (const profile of ['default', 'vector_only']) {
    const baseline = structuredClone(manifest); baseline.profile = buildIndexProfileState(profile);
    if (profile === 'vector_only') {
      await fs.writeFile(path.join(outDir, 'dense_vectors.json'), JSON.stringify({ dims: 2, vectors: [[1, 2]] }));
      baseline.pieces = baseline.pieces.filter(piece => piece.name !== 'token_postings');
      baseline.pieces.push({ name: 'dense_vectors', format: 'json', path: 'dense_vectors.json', count: 1 });
    }
    await fs.writeFile(manifestPath, JSON.stringify(baseline));
    assert.equal((await run(outDir)).result.exitCode, 0, `${profile} valid sharded/binary companions`);
    for (const family of resolveRequiredArtifactsForProfile(profile)) {
      const changed = structuredClone(baseline);
      changed.pieces = changed.pieces.map(piece => piece.name === family ? { ...piece, name: family + '_metadata_only' } : piece);
      await fs.writeFile(manifestPath, JSON.stringify(changed));
      const invalid = await run(outDir);
      assert.notEqual(invalid.result.exitCode, 0, `${profile}/${family} metadata alone cannot be a required payload`);
      assert.ok(invalid.report.verify.errors.some(message => message.includes(family)));
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual uneven sharded writer counts and alternative encodings feed stats; every required profile family rejects metadata-only inventory.');

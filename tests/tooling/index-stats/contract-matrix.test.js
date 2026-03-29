#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getRepoCacheRoot, getRepoId, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'index', 'stats.js');

{
  const tempRoot = resolveTestCachePath(root, 'index-stats-aggregate');
  const indexRoot = path.join(tempRoot, 'build-root');
  await fs.rm(tempRoot, { recursive: true, force: true });

  const writeModeManifest = async (mode, values) => {
    const modeDir = path.join(indexRoot, `index-${mode}`);
    await fs.mkdir(path.join(modeDir, 'pieces'), { recursive: true });
    await fs.writeFile(path.join(modeDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: `compat-${mode}`
    }, null, 2), 'utf8');
    await fs.writeFile(path.join(modeDir, 'pieces', 'manifest.json'), JSON.stringify({
      version: 2,
      buildId: 'build-aggregate',
      compatibilityKey: `compat-${mode}`,
      artifactSurfaceVersion: 'surf-1',
      pieces: [
        { name: 'chunk_meta', path: 'chunk_meta.json', bytes: values.chunkMeta, count: values.chunkRows },
        { name: 'token_postings', path: 'token_postings.json', bytes: values.tokenPostings, count: values.tokenRows },
        { name: 'phrase_ngrams', path: 'phrase_ngrams.json', bytes: values.phraseNgrams, count: values.phraseRows },
        { name: 'chargram_postings', path: 'chargram_postings.json', bytes: values.chargramPostings, count: values.chargramRows },
        { name: 'symbols', path: 'symbols.json', bytes: values.symbols, count: values.symbolRows },
        { name: 'symbol_occurrences', path: 'symbol_occurrences.json', bytes: values.symbolOccurrences, count: values.symbolOccurrenceRows },
        { name: 'symbol_edges', path: 'symbol_edges.json', bytes: values.symbolEdges, count: values.symbolEdgeRows },
        { name: 'graph_relations', path: 'graph_relations.json', bytes: values.graphRelations, count: values.graphRows },
        { name: 'call_sites', path: 'call_sites.json', bytes: values.callSites, count: values.callRows },
        { name: 'file_meta', path: 'file_meta.json', bytes: values.fileMeta, count: values.fileRows },
        { name: 'dense_vectors', path: 'dense_vectors.json', bytes: values.denseVectors, count: values.denseCount },
        { name: 'dense_vectors_hnsw', path: 'dense_vectors_hnsw.bin', bytes: values.hnsw },
        { name: 'dense_vectors_lancedb', path: 'dense_vectors_lancedb.db', bytes: values.lancedb }
      ]
    }, null, 2), 'utf8');
  };

  await writeModeManifest('code', {
    chunkMeta: 10, chunkRows: 2, tokenPostings: 20, tokenRows: 5, phraseNgrams: 30, phraseRows: 7,
    chargramPostings: 40, chargramRows: 8, symbols: 50, symbolRows: 3, symbolOccurrences: 60,
    symbolOccurrenceRows: 4, symbolEdges: 70, symbolEdgeRows: 5, graphRelations: 80, graphRows: 6,
    callSites: 90, callRows: 7, fileMeta: 11, fileRows: 4, denseVectors: 100, denseCount: 9, hnsw: 110, lancedb: 120
  });
  await writeModeManifest('prose', {
    chunkMeta: 4, chunkRows: 1, tokenPostings: 6, tokenRows: 2, phraseNgrams: 8, phraseRows: 3,
    chargramPostings: 10, chargramRows: 4, symbols: 12, symbolRows: 1, symbolOccurrences: 14,
    symbolOccurrenceRows: 1, symbolEdges: 16, symbolEdgeRows: 1, graphRelations: 18, graphRows: 1,
    callSites: 20, callRows: 1, fileMeta: 5, fileRows: 2, denseVectors: 22, denseCount: 3, hnsw: 24, lancedb: 26
  });

  const run = spawnSync(process.execPath, [toolPath, '--index-dir', indexRoot, '--json'], {
    encoding: 'utf8',
    env: applyTestEnv({ syncProcess: false })
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(payload.modes), ['code', 'prose']);
  assert.equal(payload.totals.chunkCount, 3);
  assert.equal(payload.totals.fileCount, 6);
  assert.equal(payload.totals.bytesByFamily.chunks, 14);
  assert.equal(payload.totals.bytesByFamily.postings, 114);
  assert.equal(payload.totals.bytesByFamily.symbols, 222);
  assert.equal(payload.totals.bytesByFamily.relations, 208);
  assert.equal(payload.totals.bytesByFamily.embeddings, 402);
  assert.equal(payload.totals.totalBytes, 960);
}

{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-explicit-repo-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const explicitRepoPath = path.join(tempRoot, 'explicit-repo');
  await fs.mkdir(explicitRepoPath, { recursive: true });
  await fs.writeFile(path.join(explicitRepoPath, '.pairofcleats.json'), JSON.stringify({
    cache: { root: path.join(tempRoot, 'parent-cache-root') }
  }, null, 2), 'utf8');

  const explicitUserConfig = loadUserConfig(explicitRepoPath);
  const explicitRepoCacheRoot = getRepoCacheRoot(explicitRepoPath, explicitUserConfig);
  const buildRoot = path.join(explicitRepoCacheRoot, 'builds', 'build-child');
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"tokens":["alpha"]}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
    compatibilityKey: 'compat-child'
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
    version: 2,
    repoId: getRepoId(explicitRepoPath),
    buildId: 'build-child',
    compatibilityKey: 'compat-child',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', bytes: Buffer.byteLength('[{"id":1}]', 'utf8'), count: 1 },
      { name: 'token_postings', path: 'token_postings.json', bytes: Buffer.byteLength('{"tokens":["alpha"]}', 'utf8'), count: 1 }
    ]
  }, null, 2), 'utf8');
  await fs.mkdir(path.join(explicitRepoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(explicitRepoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'build-child',
    buildRoot
  }, null, 2), 'utf8');

  const run = spawnSync(process.execPath, [toolPath, '--repo', explicitRepoPath, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot }
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.repoId, getRepoId(explicitRepoPath));
  assert.equal(toRealPathSync(payload.indexRoot), toRealPathSync(buildRoot));
}

{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-json-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');

  const userConfig = loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1},{"id":2}]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"tokens":["alpha"]}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'phrase_ngrams.json'), '{"rows":1}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'chargram_postings.json'), '{"rows":1}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'file_meta.json'), '[{"path":"a.js"},{"path":"b.js"}]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ compatibilityKey: 'compat-build-1' }, null, 2), 'utf8');

  const chunkBytes = Buffer.byteLength('[{"id":1},{"id":2}]', 'utf8');
  const tokenBytes = Buffer.byteLength('{"tokens":["alpha"]}', 'utf8');
  const phraseBytes = Buffer.byteLength('{"rows":1}', 'utf8');
  const chargramBytes = Buffer.byteLength('{"rows":1}', 'utf8');
  const fileMetaBytes = Buffer.byteLength('[{"path":"a.js"},{"path":"b.js"}]', 'utf8');

  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
    version: 2,
    repoId: 'repo-manifest-id',
    buildId: 'build-1',
    compatibilityKey: 'compat-build-1',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', bytes: chunkBytes, count: 2 },
      { name: 'token_postings', path: 'token_postings.json', bytes: tokenBytes, count: 3 },
      { name: 'phrase_ngrams', path: 'phrase_ngrams.json', bytes: phraseBytes, count: 1 },
      { name: 'chargram_postings', path: 'chargram_postings.json', bytes: chargramBytes, count: 1 },
      { name: 'file_meta', path: 'file_meta.json', bytes: fileMetaBytes, count: 2 }
    ]
  }, null, 2), 'utf8');
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'build-1',
    buildRoot
  }, null, 2), 'utf8');

  const run = spawnSync(process.execPath, [toolPath, '--repo', repoRoot, '--json'], {
    encoding: 'utf8',
    env: applyTestEnv({ syncProcess: false })
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.buildId, 'build-1');
  assert.equal(payload.compatibilityKey, 'compat-build-1');
  assert.equal(payload.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  assert.deepEqual(Object.keys(payload.modes), ['code']);
  assert.equal(payload.modes.code.chunkMeta.rows, 2);
  assert.equal(payload.modes.code.tokenPostings.rows, 3);
  assert.equal(payload.modes.code.fileMeta.rows, 2);
  assert.equal(payload.totals.chunkCount, 2);
  assert.equal(payload.totals.fileCount, 2);
  assert.equal(payload.totals.bytesByFamily.chunks, chunkBytes);
  assert.equal(payload.totals.bytesByFamily.postings, tokenBytes + phraseBytes + chargramBytes);
}

{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-missing-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');

  const userConfig = loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildRoot = path.join(repoCacheRoot, 'builds', 'build-verify');
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ compatibilityKey: 'compat-verify' }, null, 2), 'utf8');
  await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
    version: 2,
    buildId: 'build-verify',
    compatibilityKey: 'compat-verify',
    pieces: [
      { name: 'chunk_meta', path: 'chunk_meta.json', bytes: 10, count: 1, checksum: 'xxh64:deadbeef' },
      { name: 'token_postings', path: 'token_postings.json', bytes: 24, count: 2 }
    ]
  }, null, 2), 'utf8');
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId: 'build-verify',
    buildRoot
  }, null, 2), 'utf8');

  const run = spawnSync(process.execPath, [toolPath, '--repo', repoRoot, '--verify', '--json'], {
    encoding: 'utf8',
    env: applyTestEnv({ syncProcess: false })
  });
  assert.equal(run.status, 1);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.verify?.ok, false);
  assert.ok(payload.verify.errors.some((entry) => entry.includes('missing artifact token_postings.json')));
  assert.ok(payload.verify.warnings.some((entry) => entry.includes('checksum mismatch')));
}

console.log('index stats contract matrix test passed');

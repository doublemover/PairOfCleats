#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-current-build-pointer-case-insensitive');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const swapCase = (value) => String(value).replace(/[A-Za-z]/g, (ch) => (
  ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
));

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
applyTestEnv({ cacheRoot });

const userConfig = {
  cache: { root: cacheRoot },
  indexing: {
    postings: {
      enablePhraseNgrams: false,
      enableChargrams: false,
      fielded: false
    }
  },
  search: { annDefault: false },
  sqlite: { use: false },
  lmdb: { use: false }
};

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildId = 'build-case';
const buildRoot = path.join(buildsRoot, buildId);
const indexDir = path.join(buildRoot, 'index-code');

await writeJson(path.join(indexDir, 'chunk_meta.json'), [
  {
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 1,
    chunkId: 'chunk_0',
    chunkUid: 'ck:test:chunk_0',
    virtualPath: 'src/a.js'
  }
]);
await writeJson(path.join(indexDir, 'file_meta.json'), [
  { id: 0, file: 'src/a.js', ext: '.js' }
]);
await writeJson(path.join(indexDir, 'token_postings.json'), {
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1],
  avgDocLen: 1,
  totalDocs: 1
});
await writeJson(path.join(indexDir, 'index_state.json'), {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
});
await writeJson(path.join(indexDir, '.filelists.json'), {
  generatedAt: new Date().toISOString(),
  scanned: { count: 1, sample: [] },
  skipped: { count: 0, sample: [] }
});
await writeJson(path.join(indexDir, 'pieces', 'manifest.json'), {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ]
});

const mixedCaseBuildRoot = process.platform === 'win32' ? swapCase(buildRoot) : buildRoot;
await writeJson(path.join(buildsRoot, 'current.json'), {
  buildId,
  buildRoot: mixedCaseBuildRoot,
  modes: ['code'],
  promotedAt: new Date().toISOString(),
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
});

const report = await validateIndexArtifacts({
  root: repoRoot,
  modes: ['code'],
  userConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

const escapeIssues = report.issues.filter((issue) => issue.includes('escapes repo cache root'));
assert.equal(
  escapeIssues.length,
  0,
  `expected mixed-case cache-scoped build pointers to be accepted: ${report.issues.join('; ')}`
);
assert.ok(report.ok, `expected strict validation to pass, got issues: ${report.issues.join('; ')}`);

console.log('index-validate current build pointer case-insensitive test passed');

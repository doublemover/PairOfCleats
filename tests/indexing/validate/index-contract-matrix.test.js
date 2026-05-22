#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { readJsonFile } from '../../../src/shared/artifact-io.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { updatePiecesManifest } from '../../helpers/pieces-manifest.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveIndexDir, isManifestPathSafe } from '../../../src/index/validate/paths.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();

const runValidation = async ({ repoRoot, indexRoot, strict = true }) => validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict,
  sqliteEnabled: false,
  lmdbEnabled: false
});

const assertValidationIssue = (report, expectedText, message) => {
  assert.equal(report.ok, false, message || `expected validation failure containing ${expectedText}`);
  assert.ok(
    report.issues.some((issue) => issue.includes(expectedText)),
    `expected validation issue containing ${expectedText}; got: ${report.issues.join('; ')}`
  );
};

const createTempRoot = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  return tempRoot;
};

const createManifestPieces = (overridesByName = {}) => [
  { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', ...overridesByName.chunk_meta },
  { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json', ...overridesByName.token_postings },
  { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json', ...overridesByName.index_state },
  { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json', ...overridesByName.filelists }
];

const cases = [
  {
    name: 'manifest path safety helper rejects native absolute and escape paths',
    async run() {
      const isWin = process.platform === 'win32';
      assert.equal(isManifestPathSafe('C:/repo/file.txt'), !isWin);
      assert.equal(isManifestPathSafe('/abs/file.txt'), false);
      assert.equal(isManifestPathSafe('../escape.txt'), false);
    }
  },
  {
    name: 'resolveIndexDir accepts compressed artifact variants across cache and local roots',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-artifact-variants');
      const repoRoot = path.join(tempRoot, 'repo');
      const cacheRoot = path.join(tempRoot, 'cache');
      await fs.mkdir(repoRoot, { recursive: true });
      await fs.writeFile(
        path.join(repoRoot, '.pairofcleats.json'),
        JSON.stringify({ cache: { root: cacheRoot } }, null, 2),
        'utf8'
      );

      const userConfig = loadUserConfig(repoRoot);
      const cachedDir = getIndexDir(repoRoot, 'code', userConfig);
      const localDir = path.join(repoRoot, 'index-code');
      await fs.mkdir(cachedDir, { recursive: true });
      await fs.mkdir(localDir, { recursive: true });

      await fs.writeFile(path.join(cachedDir, 'chunk_meta.json.gz'), 'cached-compressed', 'utf8');
      let resolved = resolveIndexDir(repoRoot, 'code', userConfig, null, false);
      assert.equal(resolved, cachedDir);

      await fs.rm(path.join(cachedDir, 'chunk_meta.json.gz'), { force: true });
      await fs.writeFile(path.join(localDir, 'chunk_meta.jsonl.gz'), 'local-compressed', 'utf8');
      resolved = resolveIndexDir(repoRoot, 'code', userConfig, null, false);
      assert.equal(resolved, localDir);
    }
  },
  {
    name: 'strict validation accepts a healthy baseline index',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-strict');
      const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.ok(report.ok, `expected strict validation ok, got issues: ${report.issues.join('; ')}`);
    }
  },
  {
    name: 'non-strict validation tolerates optional file_meta manifest omissions',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-optional-file-meta');
      const { indexRoot } = await createBaseIndex({
        rootDir: tempRoot,
        manifestPieces: createManifestPieces()
      });
      const report = await runValidation({ repoRoot: tempRoot, indexRoot, strict: false });
      const fileMetaLoadIssue = report.issues.find((entry) => String(entry).includes('file_meta load failed'));
      assert.equal(fileMetaLoadIssue, undefined);
    }
  },
  {
    name: 'strict validation rejects repo map file-name collisions',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-name-collision');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });

      const repoMap = [
        { file: 'src/a.js', name: 'dup', kind: 'Function' },
        { file: 'src/a.js', name: 'dup', kind: 'Function' }
      ];
      await fs.writeFile(path.join(indexDir, 'repo_map.json'), JSON.stringify(repoMap, null, 2));
      await updatePiecesManifest(indexDir, (manifest) => {
        manifest.pieces.push({ type: 'chunks', name: 'repo_map', format: 'json', path: 'repo_map.json' });
      });

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'ERR_ID_COLLISION');
    }
  },
  {
    name: 'strict validation trusts manifest bytes when chunk-meta rows exceed test json byte caps',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-large-manifest-budget');
      const repoRoot = tempRoot;
      const indexRoot = path.join(tempRoot, '.index-root');
      const indexDir = path.join(indexRoot, 'index-code');
      await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });

      const chunkMetaPayload = [
        {
          id: 0,
          file: 'src/a.js',
          virtualPath: 'src/a.js',
          chunkId: 'chunk_0',
          chunkUid: 'ck:test:chunk_0',
          fileId: 0,
          start: 0,
          end: 1,
          metaV2: {
            chunkId: 'chunk_0',
            chunkUid: 'ck:test:chunk_0',
            virtualPath: 'src/a.js',
            file: 'src/a.js'
          },
          docmeta: { note: 'x'.repeat(512) }
        }
      ];
      const chunkMetaPath = path.join(indexDir, 'chunk_meta.json');
      await writeJsonArrayFile(chunkMetaPath, chunkMetaPayload, { atomic: true });
      const chunkMetaStat = await fs.stat(chunkMetaPath);

      const tokenPostings = {
        vocab: ['alpha'],
        postings: [[[0, 1]]],
        docLengths: [1],
        avgDocLen: 1,
        totalDocs: 1
      };
      await writeJsonObjectFile(path.join(indexDir, 'token_postings.json'), { fields: tokenPostings, atomic: true });
      await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), { fields: {
        generatedAt: new Date().toISOString(),
        mode: 'code',
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION
      }, atomic: true });
      await writeJsonArrayFile(path.join(indexDir, 'file_meta.json'), [
        { id: 0, file: 'src/a.js', ext: '.js' }
      ], { atomic: true });
      await writeJsonObjectFile(path.join(indexDir, '.filelists.json'), { fields: {
        generatedAt: new Date().toISOString(),
        scanned: { count: 1, sample: [] },
        skipped: { count: 0, sample: [] }
      }, atomic: true });

      const manifest = {
        version: 2,
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        pieces: [
          { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', bytes: chunkMetaStat.size },
          { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
          { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
          { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
          { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
        ]
      };
      await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), { fields: manifest, atomic: true });

      applyTestEnv({
        extraEnv: { PAIROFCLEATS_TEST_MAX_JSON_BYTES: '128' }
      });
      const report = await validateIndexArtifacts({
        root: repoRoot,
        indexRoot,
        modes: ['code'],
        userConfig: {
          indexing: { postings: { enablePhraseNgrams: false, enableChargrams: false, fielded: false } },
          sqlite: { use: false },
          lmdb: { use: false }
        },
        strict: true,
        sqliteEnabled: false,
        lmdbEnabled: false
      });

      assert.ok(!report.issues.some((issue) => issue.includes('chunk_meta load failed')));
    }
  },
  {
    name: 'strict validation accepts binary-columnar manifest artifact names',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-binary-columnar-names');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });

      const sidecars = [
        'chunk_meta.binary-columnar.bin',
        'chunk_meta.binary-columnar.offsets.bin',
        'chunk_meta.binary-columnar.lengths.varint',
        'chunk_meta.binary-columnar.meta.json',
        'token_postings.binary-columnar.bin',
        'token_postings.binary-columnar.offsets.bin',
        'token_postings.binary-columnar.lengths.varint',
        'token_postings.binary-columnar.meta.json'
      ];
      for (const relPath of sidecars) {
        const fullPath = path.join(indexDir, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, relPath.endsWith('.json') ? '{}' : '');
      }

      const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
      const manifest = readJsonFile(manifestPath) || {};
      manifest.pieces.push(
        { type: 'chunks', name: 'chunk_meta_binary_columnar', format: 'binary-columnar', path: 'chunk_meta.binary-columnar.bin' },
        { type: 'chunks', name: 'chunk_meta_binary_columnar_offsets', format: 'binary', path: 'chunk_meta.binary-columnar.offsets.bin' },
        { type: 'chunks', name: 'chunk_meta_binary_columnar_lengths', format: 'binary', path: 'chunk_meta.binary-columnar.lengths.varint' },
        { type: 'chunks', name: 'chunk_meta_binary_columnar_meta', format: 'json', path: 'chunk_meta.binary-columnar.meta.json' },
        { type: 'postings', name: 'token_postings_binary_columnar', format: 'binary-columnar', path: 'token_postings.binary-columnar.bin' },
        { type: 'postings', name: 'token_postings_binary_columnar_offsets', format: 'binary', path: 'token_postings.binary-columnar.offsets.bin' },
        { type: 'postings', name: 'token_postings_binary_columnar_lengths', format: 'binary', path: 'token_postings.binary-columnar.lengths.varint' },
        { type: 'postings', name: 'token_postings_binary_columnar_meta', format: 'json', path: 'token_postings.binary-columnar.meta.json' }
      );
      await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.ok(!report.issues.some((issue) => issue.includes('unknown artifact name')));
    }
  },
  {
    name: 'strict validation fails when the manifest is missing',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-missing-manifest');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      await fs.rm(path.join(indexDir, 'pieces', 'manifest.json'), { force: true });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'pieces/manifest.json missing');
    }
  },
  {
    name: 'strict validation fails when a manifest-declared piece is missing',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-missing-piece');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      await fs.rm(path.join(indexDir, 'chunk_meta.json'), { force: true });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.equal(report.ok, false, 'expected missing manifest-declared piece to fail validation');
      assert.ok(
        report.issues.some((issue) => issue.includes('chunk_meta.json') && issue.includes('missing')),
        `expected missing chunk_meta issue; got: ${report.issues.join('; ')}`
      );
    }
  },
  {
    name: 'strict validation fails on manifest paths that are not safe',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-manifest-safety');
      const manifestPieces = createManifestPieces({
        chunk_meta: { path: '..\\chunk_meta.json' }
      });
      const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'manifest path is not safe');
    }
  },
  {
    name: 'strict validation fails on manifest paths that escape through symlinks',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-manifest-symlink-escape');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      const outsideRoot = path.join(tempRoot, 'outside-artifacts');
      await fs.mkdir(outsideRoot, { recursive: true });
      await fs.writeFile(path.join(outsideRoot, 'chunk_meta.json'), '[]\n', 'utf8');

      const symlinkDir = path.join(indexDir, 'linked');
      let symlinkCreated = false;
      try {
        await fs.symlink(outsideRoot, symlinkDir, process.platform === 'win32' ? 'junction' : 'dir');
        symlinkCreated = true;
      } catch {}

      if (!symlinkCreated) {
        console.log('index contract matrix: symlink escape case skipped (symlink unavailable)');
        return;
      }

      const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.pieces = manifest.pieces.map((piece) => (
        piece?.name === 'chunk_meta'
          ? { ...piece, path: 'linked/chunk_meta.json' }
          : piece
      ));
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'manifest path escapes index root');
    }
  },
  {
    name: 'strict validation fails on unknown manifest artifacts',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-unknown-artifact');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      await fs.writeFile(path.join(indexDir, 'mystery.json'), JSON.stringify({ ok: true }));
      await updatePiecesManifest(indexDir, (manifest) => {
        manifest.pieces.push({ type: 'misc', name: 'mystery_artifact', format: 'json', path: 'mystery.json' });
      });

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'unknown artifact name');
    }
  },
  {
    name: 'strict validation fails when manifest checksum does not match piece contents',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-checksum-mismatch');
      const manifestPieces = createManifestPieces({
        chunk_meta: { checksum: 'sha1:deadbeef' }
      });
      const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assertValidationIssue(report, 'piece checksum mismatch', 'expected manifest checksum mismatch to fail validation');
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('index validate contract matrix test passed');

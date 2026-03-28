#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { updatePiecesManifest } from '../../helpers/pieces-manifest.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

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

const createTempRoot = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  return tempRoot;
};

const cases = [
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
        manifestPieces: [
          { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
          { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
          { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
          { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
        ]
      });
      const report = await runValidation({ repoRoot: tempRoot, indexRoot, strict: false });
      const fileMetaLoadIssue = report.issues.find((entry) => String(entry).includes('file_meta load failed'));
      assert.equal(fileMetaLoadIssue, undefined);
    }
  },
  {
    name: 'strict validation fails when the manifest is missing',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-missing-manifest');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      await fs.rm(path.join(indexDir, 'pieces', 'manifest.json'), { force: true });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.ok(!report.ok);
      assert.ok(report.issues.some((issue) => issue.includes('pieces/manifest.json missing')));
    }
  },
  {
    name: 'strict validation fails when a manifest-declared piece is missing',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-missing-piece');
      const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
      await fs.rm(path.join(indexDir, 'chunk_meta.json'), { force: true });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.ok(!report.ok);
      assert.ok(report.issues.some((issue) => issue.includes('chunk_meta.json') && issue.includes('missing')));
    }
  },
  {
    name: 'strict validation fails on manifest paths that are not safe',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-manifest-safety');
      const manifestPieces = [
        { type: 'chunks', name: 'chunk_meta', format: 'json', path: '..\\chunk_meta.json' },
        { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
        { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
        { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
      ];
      const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });
      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.ok(!report.ok);
      assert.ok(report.issues.some((issue) => issue.includes('manifest path is not safe')));
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
      assert.equal(report.ok, false);
      assert.ok(report.issues.some((issue) => issue.includes('manifest path escapes index root')));
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
      assert.ok(!report.ok);
      assert.ok(report.issues.some((issue) => issue.includes('unknown artifact name')));
    }
  },
  {
    name: 'strict validation fails when manifest checksum does not match piece contents',
    async run() {
      const tempRoot = await createTempRoot('index-validate-contract-checksum-mismatch');
      const manifestPieces = [
        { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', checksum: 'sha1:deadbeef' },
        { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
        { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
        { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
      ];
      const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });

      const report = await runValidation({ repoRoot, indexRoot, strict: true });
      assert.equal(report.ok, false, 'expected manifest checksum mismatch to fail validation');
      assert.ok(report.issues.some((issue) => issue.includes('piece checksum mismatch')));
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('index validate contract matrix test passed');

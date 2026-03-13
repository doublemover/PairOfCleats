#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-manifest-symlink-escape');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

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
  console.log('index-validate manifest symlink escape test skipped (symlink unavailable)');
  process.exit(0);
}

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.pieces = manifest.pieces.map((piece) => (
  piece?.name === 'chunk_meta'
    ? { ...piece, path: 'linked/chunk_meta.json' }
    : piece
));
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.equal(report.ok, false, 'expected manifest symlink escape to fail validation');
assert.ok(
  report.issues.some((issue) => issue.includes('manifest path escapes index root')),
  `expected index-root escape issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate manifest symlink escape test passed');

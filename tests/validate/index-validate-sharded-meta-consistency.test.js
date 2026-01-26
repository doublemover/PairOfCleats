#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { ARTIFACT_SURFACE_VERSION, SHARDED_JSONL_META_SCHEMA_VERSION } from '../../src/contracts/versioning.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-sharded-meta');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const manifestPieces = [
  { type: 'chunks', name: 'chunk_meta_meta', format: 'json', path: 'chunk_meta.meta.json' },
  { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
  { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
  { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
];

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });

await fs.rm(path.join(indexDir, 'chunk_meta.json'), { force: true });
const partsDir = path.join(indexDir, 'chunk_meta.parts');
await fs.mkdir(partsDir, { recursive: true });
const partName = 'chunk_meta.part-00000.jsonl';
const partPath = path.join(partsDir, partName);
await fs.writeFile(partPath, JSON.stringify({ id: 0, start: 0, end: 1 }) + '\n');
const stat = await fs.stat(partPath);
const metaPayload = {
  schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
  artifact: 'chunk_meta',
  format: 'jsonl-sharded',
  generatedAt: new Date().toISOString(),
  compression: 'none',
  totalRecords: 1,
  totalBytes: stat.size,
  maxPartRecords: 1,
  maxPartBytes: stat.size,
  targetMaxBytes: null,
  parts: [{ path: path.posix.join('chunk_meta.parts', partName), records: 1, bytes: stat.size }]
};
await fs.writeFile(path.join(indexDir, 'chunk_meta.meta.json'), JSON.stringify(metaPayload, null, 2));

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = {
  version: 2,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: manifestPieces
};
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected sharded meta consistency check to fail');
assert.ok(
  report.issues.some((issue) => issue.includes('Manifest missing shard path')),
  `expected manifest shard path issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate sharded meta consistency test passed');


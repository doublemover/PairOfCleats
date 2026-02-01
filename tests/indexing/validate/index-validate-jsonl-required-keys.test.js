#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-jsonl-required');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });

await fs.rm(path.join(indexDir, 'chunk_meta.json'), { force: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.jsonl'), '{"id":1,"start":0}\n');

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const chunkEntry = manifest.pieces.find((piece) => piece.name === 'chunk_meta');
if (chunkEntry) {
  chunkEntry.path = 'chunk_meta.jsonl';
  chunkEntry.format = 'jsonl';
} else {
  manifest.pieces.push({ type: 'chunks', name: 'chunk_meta', format: 'jsonl', path: 'chunk_meta.jsonl' });
}
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

assert.ok(!report.ok, 'expected JSONL required key validation to fail');
assert.ok(
  report.issues.some((issue) => issue.includes('chunk_meta load failed')),
  `expected chunk_meta load failure, got: ${report.issues.join('; ')}`
);

console.log('index-validate JSONL required keys test passed');


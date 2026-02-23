#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-binary-columnar-manifest-names');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

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

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(
  !report.issues.some((issue) => issue.includes('unknown artifact name')),
  `expected binary-columnar names to be accepted, got: ${report.issues.join('; ')}`
);

console.log('index-validate binary-columnar manifest names test passed');

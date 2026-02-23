#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-manifest-checks');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const manifestPieces = [
  { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json', checksum: 'sha1:deadbeef' },
  { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
  { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
  { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
];

const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, manifestPieces });

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected manifest checksum mismatch to fail validation');
assert.ok(
  report.issues.some((issue) => issue.includes('piece checksum mismatch')),
  `expected checksum mismatch issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate manifest checks test passed');

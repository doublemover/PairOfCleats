#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-validate-optional-file-meta-nonstrict');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { indexRoot } = await createBaseIndex({
  rootDir: tempRoot,
  manifestPieces: [
    { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
    { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
    { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
    { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' }
  ]
});

const report = await validateIndexArtifacts({
  root: tempRoot,
  indexRoot,
  userConfig: defaultUserConfig,
  strict: false,
  modes: ['code'],
  sqliteEnabled: false
});

const fileMetaLoadIssue = report.issues.find((entry) => String(entry).includes('file_meta load failed'));
assert.equal(
  fileMetaLoadIssue,
  undefined,
  `expected non-strict validation to skip optional file_meta manifest-entry misses, got: ${report.issues.join('; ')}`
);

console.log('index-validate optional file_meta non-strict test passed');

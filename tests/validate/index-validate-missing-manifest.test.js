#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-missing-manifest');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
await fs.rm(path.join(indexDir, 'pieces', 'manifest.json'), { force: true });

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected strict validation to fail without manifest');
assert.ok(
  report.issues.some((issue) => issue.includes('pieces/manifest.json missing')),
  `expected missing manifest issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate missing manifest test passed');


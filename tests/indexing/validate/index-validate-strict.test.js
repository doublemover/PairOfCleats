#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-strict');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot });

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(report.ok, `expected strict validation ok, got issues: ${report.issues.join('; ')}`);

console.log('index-validate strict test passed');


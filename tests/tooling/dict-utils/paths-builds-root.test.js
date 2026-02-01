#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getBuildsRoot, getRepoId } from '../../../tools/dict-utils/paths.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'dict-utils-builds');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const savedEnv = { ...process.env };
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    process.env[key] = value;
  }
};

process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = path.join(tempRoot, 'cache');

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const expected = path.join(
  process.env.PAIROFCLEATS_CACHE_ROOT,
  'repos',
  getRepoId(repoRoot),
  'builds'
);

assert.equal(getBuildsRoot(repoRoot), expected);

restoreEnv();

console.log('dict-utils builds root test passed');

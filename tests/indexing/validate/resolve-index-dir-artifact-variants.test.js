#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveIndexDir } from '../../../src/index/validate/paths.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'resolve-index-dir-artifact-variants');
const repoRoot = path.join(testRoot, 'repo');
const cacheRoot = path.join(testRoot, 'cache');

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ cache: { root: cacheRoot } }, null, 2),
  'utf8'
);

const userConfig = loadUserConfig(repoRoot);
const cachedDir = getIndexDir(repoRoot, 'code', userConfig);
const localDir = path.join(repoRoot, 'index-code');

await fs.mkdir(cachedDir, { recursive: true });
await fs.mkdir(localDir, { recursive: true });

await fs.writeFile(path.join(cachedDir, 'chunk_meta.json.gz'), 'cached-compressed', 'utf8');
let resolved = resolveIndexDir(repoRoot, 'code', userConfig, null, false);
assert.equal(resolved, cachedDir, 'expected cached index dir when compressed chunk_meta exists in cache');

await fs.rm(path.join(cachedDir, 'chunk_meta.json.gz'), { force: true });
await fs.writeFile(path.join(localDir, 'chunk_meta.jsonl.gz'), 'local-compressed', 'utf8');
resolved = resolveIndexDir(repoRoot, 'code', userConfig, null, false);
assert.equal(resolved, localDir, 'expected local index dir fallback when cache is missing but local compressed chunk_meta exists');

console.log('resolve index dir artifact variant tests passed');

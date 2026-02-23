#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { needsIndexArtifacts } from '../../../tools/bench/language/repos.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'language-needs-index-artifacts-compressed');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ cache: { root: cacheRoot } }, null, 2)
);

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);

await fs.mkdir(codeDir, { recursive: true });
await fs.mkdir(path.join(proseDir, 'chunk_meta.parts'), { recursive: true });
await fs.writeFile(path.join(codeDir, 'chunk_meta.jsonl.gz'), 'compressed', 'utf8');
await fs.writeFile(
  path.join(proseDir, 'chunk_meta.meta.json'),
  JSON.stringify({ parts: [] }, null, 2),
  'utf8'
);

assert.equal(
  needsIndexArtifacts(repoRoot),
  false,
  'expected compressed/sharded chunk_meta artifacts to satisfy bench preflight checks'
);

console.log('language needsIndexArtifacts compressed test passed');

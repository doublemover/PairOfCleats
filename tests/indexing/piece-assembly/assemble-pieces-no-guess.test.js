#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'assemble-pieces-no-guess');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const repoRoot = path.join(cacheRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const inputDir = path.join(cacheRoot, 'input', 'index-code');
await fs.mkdir(inputDir, { recursive: true });
await fs.writeFile(
  path.join(inputDir, 'chunk_meta.json'),
  JSON.stringify([{ id: 0, file: 'alpha.js', ext: '.js', start: 0, end: 1 }])
);
await fs.writeFile(
  path.join(inputDir, 'token_postings.json'),
  JSON.stringify({
    fields: { avgDocLen: 1, totalDocs: 1 },
    arrays: { vocab: ['alpha'], postings: [[[0, 1]]], docLengths: [1] }
  })
);

const outDir = path.join(cacheRoot, 'out', 'index-code');
const assemblePath = path.join(root, 'tools', 'index', 'assemble-pieces.js');
const result = spawnSync(
  process.execPath,
  [
    assemblePath,
    '--repo',
    repoRoot,
    '--mode',
    'code',
    '--out',
    outDir,
    '--input',
    inputDir,
    '--force'
  ],
  { encoding: 'utf8' }
);

assert.notEqual(result.status, 0, 'expected assemble-pieces to fail without manifest');
const combined = getCombinedOutput(result);
assert.ok(combined.toLowerCase().includes('manifest'), 'expected manifest-related error');

console.log('assemble-pieces manifest requirement test passed');


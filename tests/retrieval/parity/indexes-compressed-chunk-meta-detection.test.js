#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readParityArtifactState } from '../../../tools/shared/parity-indexes.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'parity-indexes-compressed-detection');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'index-code'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'index-prose', 'chunk_meta.parts'), { recursive: true });

await fs.writeFile(path.join(tempRoot, 'index-code', 'chunk_meta.jsonl.gz'), '{"id":"c1"}\n');

const state = readParityArtifactState({
  root: tempRoot,
  userConfig: {},
  modes: ['code', 'prose']
});

assert.equal(state.missingIndex.length, 0, 'expected compressed/parts chunk meta artifacts to be detected');
assert.equal(state.indexByMode.code?.exists, true, 'expected code mode artifact presence');
assert.equal(state.indexByMode.prose?.exists, true, 'expected prose mode artifact presence');
assert.ok(
  String(state.indexByMode.code?.metaPath || '').endsWith('chunk_meta.jsonl.gz'),
  'expected code mode to resolve compressed chunk meta path'
);
assert.ok(
  String(state.indexByMode.prose?.metaPath || '').endsWith('chunk_meta.parts'),
  'expected prose mode to resolve chunk_meta.parts path'
);

console.log('parity indexes compressed chunk-meta detection test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { reuseCachedBundle } from '../../src/index/build/file-processor/cached-bundle.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'file-caps-cached-bundle');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const abs = path.join(outDir, 'cached.ts');
await fs.writeFile(abs, 'line1\nline2\nline3\n', 'utf8');
const fileStat = await fs.lstat(abs);

const cachedBundle = {
  chunks: [
    { start: 0, end: 10, endLine: 42, metaV2: { chunkId: 'c1' } }
  ],
  fileRelations: {}
};

const fileCaps = {
  default: { maxLines: 10, maxBytes: null },
  byLanguage: { typescript: { maxLines: 10 } }
};

const outcome = reuseCachedBundle({
  abs,
  relKey: 'cached.ts',
  fileIndex: 0,
  fileStat,
  fileHash: null,
  fileHashAlgo: null,
  ext: '.ts',
  fileCaps,
  maxFileBytes: null,
  cachedBundle,
  incrementalState: { manifest: { files: {} } },
  fileStructural: null,
  toolInfo: null,
  analysisPolicy: null,
  fileStart: Date.now(),
  knownLines: null,
  fileLanguageId: 'typescript',
  mode: 'code'
});

assert.ok(outcome?.skip, 'expected cached bundle to be skipped');
assert.equal(outcome.skip.reason, 'oversize');
assert.equal(outcome.skip.stage, 'cached-reuse');
assert.equal(outcome.skip.maxLines, 10);

console.log('file-caps cached bundle cap test passed');


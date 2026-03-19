#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  __testScmChunkAuthorHydration,
  hydrateChunkAuthorIndexes
} from '../../../src/retrieval/cli/load-indexes/chunk-author-loader.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const runGit = (cwd, args, env = null) => {
  const result = spawnSync('git', args, {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    timeout: 15000
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
};

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-load-indexes-chunk-authors-'));
const repoRoot = path.join(rootDir, 'repo');
const indexDir = path.join(repoRoot, 'index-prose');
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'alpha.txt'), 'alpha beta\nalpha gamma\n', 'utf8');

runGit(repoRoot, ['init']);
runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
runGit(repoRoot, ['config', 'user.name', 'Test User']);
runGit(repoRoot, ['add', 'alpha.txt']);
runGit(repoRoot, ['commit', '-m', 'add alpha', '--author', 'Alice <alice@example.com>']);

const createIndexPayload = () => ({
  indexDir,
  chunkMeta: [
    {
      id: 1,
      file: 'alpha.txt',
      startLine: 1,
      endLine: 2
    }
  ]
});

__testScmChunkAuthorHydration.reset();

const idxProseCold = createIndexPayload();
await hydrateChunkAuthorIndexes({
  idxCode: null,
  idxProse: idxProseCold,
  idxExtractedProse: null,
  idxRecords: null,
  runCode: false,
  runProse: true,
  runRecords: false,
  resolvedLoadExtractedProse: false,
  rootDir: repoRoot,
  userConfig: {},
  fileChargramN: 3,
  filtersActive: true,
  chunkAuthorFilterActive: true,
  emitOutput: false
});

assert.deepEqual(
  idxProseCold.chunkMeta[0].chunk_authors,
  ['Alice'],
  'expected cold chunk-author hydration to annotate prose chunk authors'
);

const coldStats = __testScmChunkAuthorHydration.getStats();
assert.equal(coldStats.cacheMisses, 1, 'expected first hydration to miss cache');
assert.equal(coldStats.cacheHits, 0, 'expected no cache hits before second hydration');

const idxProseWarm = createIndexPayload();
await hydrateChunkAuthorIndexes({
  idxCode: null,
  idxProse: idxProseWarm,
  idxExtractedProse: null,
  idxRecords: null,
  runCode: false,
  runProse: true,
  runRecords: false,
  resolvedLoadExtractedProse: false,
  rootDir: repoRoot,
  userConfig: {},
  fileChargramN: 3,
  filtersActive: true,
  chunkAuthorFilterActive: true,
  emitOutput: false
});

assert.deepEqual(
  idxProseWarm.chunkMeta[0].chunk_authors,
  ['Alice'],
  'expected cached chunk-author hydration to preserve annotated authors'
);

const warmStats = __testScmChunkAuthorHydration.getStats();
assert.equal(warmStats.cacheMisses, 1, 'expected second hydration to reuse prior cache entry');
assert.equal(warmStats.cacheHits, 1, 'expected second hydration to hit cache');

console.log('load-indexes chunk-author cache test passed');

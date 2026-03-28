#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cliEntryPath = path.join(root, 'tools', 'search', 'cli-entry.js');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args) => spawnSync(process.execPath, [cliEntryPath, ...args], {
  cwd: root,
  encoding: 'utf8',
  env
});

const version = runCli(['--version']);
assert.equal(version.status, 0);
assert.match(stripAnsi(version.stdout), /PairOfCleats Search/);
assert.match(stripAnsi(version.stdout), /v\d+\.\d+\.\d+/);

const invalidMode = runCli(['--mode', 'wat', '--', 'alpha']);
assert.equal(invalidMode.status, 1);
assert.match(stripAnsi(invalidMode.stderr), /Search Error/);
assert.match(stripAnsi(invalidMode.stderr), /code invalid_request/);
assert.match(stripAnsi(invalidMode.stderr), /next choose one of code, prose, both, extracted-prose, records, or all/);
assert.match(stripAnsi(invalidMode.stderr), /Invalid --mode wat/);

const removedFlag = runCli(['--human', '--', 'alpha']);
assert.equal(removedFlag.status, 1);
assert.match(stripAnsi(removedFlag.stderr), /Search Error/);
assert.match(stripAnsi(removedFlag.stderr), /flag --human/);
assert.match(stripAnsi(removedFlag.stderr), /next switch to --json/);

const tempRoot = resolveTestCachePath(root, 'search-non-result-missing-index');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const missingIndex = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'alpha', '--mode', 'code', '--no-ann', '--repo', repoRoot],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAIROFCLEATS_CACHE_ROOT: cacheRoot,
      PAIROFCLEATS_EMBEDDINGS: 'stub'
    }
  }
);
assert.notEqual(missingIndex.status, 0);
assert.match(stripAnsi(`${missingIndex.stdout || ''}\n${missingIndex.stderr || ''}`), /build-index/i);

console.log('non-result search surfaces test passed');

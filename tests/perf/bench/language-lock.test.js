#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-lock');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const configPath = path.join(tempRoot, 'repos.json');
const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
const repoId = 'test/lock-repo';
const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoPath, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoPath, 'README.md'), 'bench lock test');

const config = {
  javascript: {
    label: 'JavaScript',
    queries: queriesPath,
    repos: {
      small: [repoId]
    }
  }
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const repoCacheRoot = getRepoCacheRoot(repoPath, { cache: { root: cacheRoot } });
const lockDir = path.join(repoCacheRoot, 'locks');
await fsPromises.mkdir(lockDir, { recursive: true });
await fsPromises.writeFile(
  path.join(lockDir, 'index.lock'),
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
);

const scriptPath = path.join(root, 'tools', 'bench/language-repos.js');
const result = runNode(
  [
    scriptPath,
    '--config',
    configPath,
    '--root',
    reposRoot,
    '--cache-root',
    cacheRoot,
    '--results',
    resultsRoot,
    '--no-clone',
    '--dry-run',
    '--lock-mode',
    'fail-fast',
    '--json'
  ],
  'bench language lock dry-run',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

if (result.status !== 0) {
  console.error(result.stderr || 'bench-language-lock test failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
const task = Array.isArray(payload.tasks) ? payload.tasks[0] : null;
if (!task || !task.skipped) {
  console.error('Expected bench task to be skipped due to lock.');
  process.exit(1);
}
if (task.skipReason !== 'lock') {
  console.error(`Expected skipReason=lock, got ${task.skipReason}`);
  process.exit(1);
}

// Retain the original dry-run control, then exercise actual finalization with
// cleanup enabled. A normal lock refusal must never acquire deletion authority.
execFileSync('git', ['init', '--quiet', repoPath], { stdio: 'pipe' });
const sentinel = path.join(repoCacheRoot, 'original-cache-sentinel.txt');
await fsPromises.writeFile(sentinel, 'live-owner-cache');
const lockBefore = await fsPromises.readFile(path.join(lockDir, 'index.lock'), 'utf8');
const normal = runNode([scriptPath, '--config', configPath, '--root', reposRoot, '--cache-root', cacheRoot,
  '--results', resultsRoot, '--no-clone', '--no-provision', '--lock-mode', 'fail-fast', '--json'],
'bench language live lock with cleanup enabled', root, process.env,
{ stdio: 'pipe', encoding: 'utf8', allowFailure: true, timeoutMs: 25000 });
const actual = JSON.parse(normal.stdout || '{}');
const skipped = actual.tasks?.[0];
assert.equal(skipped?.skipReason, 'lock', normal.stderr);
assert.equal(skipped.cacheCleanup?.status, 'not-owned');
assert.equal(await fsPromises.readFile(sentinel, 'utf8'), 'live-owner-cache');
assert.equal(await fsPromises.readFile(path.join(lockDir, 'index.lock'), 'utf8'), lockBefore);

console.log('bench-language lock test passed');


#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-duplicate-tier-warning');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const configPath = path.join(tempRoot, 'repos.json');
const logPath = path.join(tempRoot, 'bench.log');
const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
const repoId = 'test/duplicate-tier-repo';
const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoPath, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoPath, 'README.md'), 'duplicate-tier warning test');

const config = {
  javascript: {
    label: 'JavaScript',
    queries: queriesPath,
    repos: {
      small: [repoId],
      huge: [repoId]
    }
  }
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const scriptPath = path.join(root, 'tools', 'bench', 'language-repos.js');
const result = spawnSync(
  process.execPath,
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
    '--log',
    logPath,
    '--no-clone',
    '--dry-run',
    '--json'
  ],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'bench-language duplicate-tier warning test failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.tasks), 'expected tasks array in bench payload');
assert.ok(payload.tasks.length >= 1, 'expected at least one scheduled bench task');

const combinedLogs = await fsPromises.readFile(logPath, 'utf8');
assert.ok(
  combinedLogs.includes('appears in multiple tiers'),
  'expected duplicate-tier warning in bench config logs'
);

console.log('bench-language duplicate-tier warning test passed');

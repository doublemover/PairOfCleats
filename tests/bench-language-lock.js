#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'bench-language-lock');
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
      typical: [repoId]
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

const scriptPath = path.join(root, 'tools', 'bench-language-repos.js');
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
    '--no-clone',
    '--dry-run',
    '--lock-mode',
    'fail-fast',
    '--json'
  ],
  { encoding: 'utf8' }
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

console.log('bench-language lock test passed');

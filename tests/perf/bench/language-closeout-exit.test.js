#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-closeout-exit');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const configPath = path.join(tempRoot, 'repos.json');
const logPath = path.join(resultsRoot, 'bench-run.log');
const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
const repoId = 'test/closeout-repo';
const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoPath, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoPath, 'README.md'), 'bench closeout exit test');

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
    '--quiet'
  ],
  {
    encoding: 'utf8',
    timeout: 15000
  }
);

if (result.error?.code === 'ETIMEDOUT') {
  console.error('bench-language closeout exit test timed out waiting for process to exit');
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'bench-language closeout exit test failed');
  process.exit(result.status ?? 1);
}
if (!fs.existsSync(logPath)) {
  console.error('expected bench log path to exist');
  process.exit(1);
}
const logText = await fsPromises.readFile(logPath, 'utf8');
if (!logText.includes('Completed 1 benchmark runs.')) {
  console.error('expected completion marker in bench log');
  process.exit(1);
}

console.log('bench-language closeout exit test passed');

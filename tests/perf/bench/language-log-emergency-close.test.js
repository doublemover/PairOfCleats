#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createBenchLogger } from '../../../tools/bench/language-repos/logging.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-log-emergency-close');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const masterLogPath = path.join(resultsRoot, 'logs', 'bench-language', 'run-log-emergency-close.log');
const display = {
  log: () => {},
  warn: () => {},
  error: () => {},
  logLine: () => {}
};

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(reposRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });

const logger = createBenchLogger({
  display,
  configPath: path.join(tempRoot, 'repos.json'),
  reposRoot,
  cacheRoot,
  resultsRoot,
  masterLogPath,
  runSuffix: 'run-log-emergency-close',
  repoLogsEnabled: true
});

logger.initMasterLog();
const repoLogPath = await logger.initRepoLog({
  label: 'owner/repo-emergency',
  tier: 'small',
  repoPath: path.join(reposRoot, 'repo-emergency'),
  slug: 'repo-emergency'
});
logger.writeLog('[test] emergency close line');
logger.closeLogsSync();

const [masterText, repoText] = await Promise.all([
  fsPromises.readFile(masterLogPath, 'utf8'),
  fsPromises.readFile(repoLogPath, 'utf8')
]);
assert.match(masterText, /\[test\] emergency close line/, 'expected emergency close to preserve master log line');
assert.match(repoText, /\[test\] emergency close line/, 'expected emergency close to preserve repo log line');

console.log('bench language log emergency close test passed');

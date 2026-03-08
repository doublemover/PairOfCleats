#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createBenchLogger } from '../../../tools/bench/language-repos/logging.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-bench-logger-durability-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const masterLogPath = path.join(tempRoot, 'bench.log');
const display = {
  log() {},
  warn() {},
  error() {},
  logLine() {}
};
const logger = createBenchLogger({
  display,
  configPath: path.join(tempRoot, 'repos.json'),
  reposRoot: path.join(tempRoot, 'repos'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: path.join(tempRoot, 'results'),
  masterLogPath,
  runSuffix: 'bench-run',
  repoLogsEnabled: true
});

logger.initMasterLog();
const repoLogPath = await logger.initRepoLog({
  label: 'demo/repo',
  tier: 'small',
  repoPath: path.join(tempRoot, 'repos', 'demo-repo'),
  slug: 'demo-repo'
});
assert.ok(repoLogPath, 'expected per-repo log path to be created');
logger.writeLog('[status] indexing started');

const waitForFileContent = async (filePath, substring, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      if (text.includes(substring)) return text;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${filePath} to contain ${substring}`);
};

const repoText = await waitForFileContent(repoLogPath, '[status] indexing started');
assert.match(repoText, /Target: demo\/repo tier=small/, 'expected repo header to be flushed before close');
const masterText = await waitForFileContent(masterLogPath, '[log] Repo log for demo/repo');
assert.match(masterText, /\[status\] indexing started/, 'expected master log to receive active writes before close');

await logger.closeRepoLog();
await logger.closeMasterLog();

console.log('bench logger durability test passed');

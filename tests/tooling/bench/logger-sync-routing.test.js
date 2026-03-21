#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createBenchLogger } from '../../../tools/bench/language-repos/logging.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-bench-logger-sync-routing-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const masterLogPath = path.join(tempRoot, 'bench.log');
const displayEvents = [];
const display = {
  log(message, meta) {
    displayEvents.push({ level: 'info', message, meta });
  },
  warn(message, meta) {
    displayEvents.push({ level: 'warn', message, meta });
  },
  error(message, meta) {
    displayEvents.push({ level: 'error', message, meta });
  },
  logLine(message, meta) {
    displayEvents.push({ level: 'status', message, meta });
  }
};
const logger = createBenchLogger({
  display,
  configPath: path.join(tempRoot, 'repos.json'),
  reposRoot: path.join(tempRoot, 'repos'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: path.join(tempRoot, 'results'),
  masterLogPath,
  runSuffix: 'bench-run',
  repoLogsEnabled: false
});

logger.appendLogSync('[bench-language] Fatal: simulated', 'error', { forceOutput: true });

const masterText = await fs.readFile(masterLogPath, 'utf8');
assert.match(masterText, /\[bench-language\] Fatal: simulated/, 'expected sync append to write the master log');
assert.equal(displayEvents.length, 1, 'expected one display event');
assert.equal(displayEvents[0].level, 'error', 'expected sync append to route through display.error');
assert.equal(displayEvents[0].message, '[bench-language] Fatal: simulated');

console.log('bench logger sync routing test passed');

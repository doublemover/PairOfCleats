#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createCrashLogger } from '../../src/index/build/crash-log.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crash-log-announcement');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const previous = process.env.PAIROFCLEATS_CRASH_LOG_ANNOUNCE;
const messages = [];
process.env.PAIROFCLEATS_CRASH_LOG_ANNOUNCE = '0';
try {
  await createCrashLogger({
    repoCacheRoot: tempRoot,
    enabled: true,
    log: (line) => messages.push(String(line))
  });
} finally {
  if (previous === undefined) delete process.env.PAIROFCLEATS_CRASH_LOG_ANNOUNCE;
  else process.env.PAIROFCLEATS_CRASH_LOG_ANNOUNCE = previous;
}

assert.equal(
  messages.some((line) => line.includes('Crash logging enabled:')),
  false,
  'crash log announcement should be suppressible from console feed'
);

const logPath = path.join(tempRoot, 'logs', 'index-crash.log');
let logText = '';
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    logText = await fs.readFile(logPath, 'utf8');
  } catch {
    logText = '';
  }
  if (logText.includes('crash-logger initialized')) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
assert.match(logText, /crash-logger initialized/, 'crash logger initialization should still be file-logged');

console.log('crash log announcement test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configureLogger, log } from '../../../src/shared/progress.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'progress-logger');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const logPath = path.join(tempRoot, 'pretty.log');
configureLogger({
  enabled: true,
  pretty: true,
  level: 'info',
  destination: logPath,
  redact: { paths: ['secret'], censor: '[redacted]' }
});

log('progress logger test', { secret: 'super-secret', ok: true });

let output = '';
for (let i = 0; i < 10; i += 1) {
  try {
    output = await fs.readFile(logPath, 'utf8');
  } catch {
    output = '';
  }
  if (output) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}

assert.ok(output.includes('progress logger test'), 'expected log output to be written');
assert.ok(!output.includes('super-secret'), 'expected secret to be redacted');
assert.ok(output.includes('[redacted]'), 'expected redacted marker');

configureLogger({ enabled: false });

console.log('progress configure logger pino10 transport test passed');


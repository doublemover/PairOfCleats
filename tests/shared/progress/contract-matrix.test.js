#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createDisplay } from '../../../src/shared/cli/display.js';
import { configureLogger, getRecentLogEvents, log, showProgress } from '../../../src/shared/progress.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'progress-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

{
  configureLogger({ enabled: false });
  const meta = { name: 'circular' };
  meta.self = meta;
  log('circular meta test', meta);
  const events = getRecentLogEvents();
  const last = events[events.length - 1];
  assert.ok(last);
  assert.notStrictEqual(last.meta, meta);
  assert.equal(typeof last.meta, 'string');
  assert.ok(last.meta.includes('[Circular]'));
}

{
  const writes = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalIsTTY = process.stderr.isTTY;
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    try {
      Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    } catch {}
    showProgress('Test', 0, 0);
  } finally {
    process.stderr.write = originalWrite;
    try {
      Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, configurable: true });
    } catch {}
  }
  const output = writes.join('');
  assert.ok(!output.includes('NaN'));
  assert.ok(!output.includes('Infinity'));
}

{
  const writes = [];
  const stream = {
    isTTY: false,
    write: (chunk) => {
      writes.push(String(chunk));
      return true;
    }
  };
  const display = createDisplay({
    stream,
    isTTY: false,
    progressMode: 'tty',
    json: false
  });
  assert.equal(display.progressMode, 'log');
  assert.equal(display.interactive, false);
  display.showProgress('Test', 1, 2);
  assert.ok(writes.join('').includes('Test'));
  display.close();
}

{
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

  assert.ok(output.includes('progress logger test'));
  assert.ok(!output.includes('super-secret'));
  assert.ok(output.includes('[redacted]'));
  configureLogger({ enabled: false });
}

console.log('progress contract matrix test passed');

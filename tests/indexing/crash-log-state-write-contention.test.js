#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../helpers/test-env.js';
import { createCrashLogger } from '../../src/index/build/crash-log.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'crash-log-state-write-contention');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const originalRename = fsPromises.rename;
const originalWarn = console.warn;
let blockedRenameAttempts = 0;
const warningLines = [];

fsPromises.rename = async (...args) => {
  const [, targetPath] = args;
  if (String(targetPath || '').includes('index-crash-state.json') && blockedRenameAttempts < 8) {
    blockedRenameAttempts += 1;
    const err = new Error(`ephemeral rename lock ${blockedRenameAttempts}`);
    err.code = 'EPERM';
    throw err;
  }
  return originalRename(...args);
};
console.warn = (...args) => {
  warningLines.push(args.map((value) => String(value)).join(' '));
};

try {
  const logger = await createCrashLogger({
    repoCacheRoot: tempRoot,
    enabled: true,
    log: null
  });
  logger.updatePhase('scan:code');

  const statePath = path.join(tempRoot, 'logs', 'index-crash-state.json');
  let state = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch {
      state = null;
    }
    if (state?.phase === 'scan:code') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(blockedRenameAttempts, 8, 'expected EPERM contention path to be exercised');
  assert.ok(state && state.phase === 'scan:code', 'expected crash state write to succeed after transient rename contention');
  assert.equal(
    warningLines.some((line) => line.includes('[crash-log] write crash state failed')),
    false,
    'expected transient rename contention to be absorbed without crash-state write warnings'
  );
} finally {
  fsPromises.rename = originalRename;
  console.warn = originalWarn;
}

console.log('crash log state write contention test passed');

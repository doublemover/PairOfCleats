#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../src/index/build/lock.js';

const root = process.cwd();
const baseDir = path.join(root, 'tests', '.cache', 'index-lock');
const repoCacheRoot = path.join(baseDir, 'repo');
const lockDir = path.join(repoCacheRoot, 'locks');
const lockPath = path.join(lockDir, 'index.lock');
const staleMs = 24 * 60 * 60 * 1000;

await fsPromises.rm(baseDir, { recursive: true, force: true });
await fsPromises.mkdir(lockDir, { recursive: true });

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() })
);

const lock = await acquireIndexLock({ repoCacheRoot, staleMs, log: () => {} });
if (!lock) {
  console.error('index-lock test failed: dead pid lock was not cleared.');
  process.exit(1);
}
await lock.release();

await fsPromises.writeFile(
  lockPath,
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
);

const lockActive = await acquireIndexLock({ repoCacheRoot, staleMs, log: () => {} });
if (lockActive) {
  await lockActive.release();
  console.error('index-lock test failed: active lock should not be acquired.');
  process.exit(1);
}

if (fs.existsSync(lockPath)) {
  await fsPromises.rm(lockPath, { force: true });
}

console.log('index-lock test passed');

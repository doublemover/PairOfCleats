#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { waitForStableFile } from '../src/index/build/watch.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-watch-'));
const filePath = path.join(tempRoot, 'partial.txt');

await fs.writeFile(filePath, 'start');

const appendPromise = new Promise((resolve) => {
  setTimeout(() => {
    void fs.appendFile(filePath, 'more').then(resolve);
  }, 50);
});

const started = Date.now();
const stable = await waitForStableFile(filePath, { checks: 3, intervalMs: 100 });
const elapsed = Date.now() - started;
await appendPromise;

assert.equal(stable, true, 'stability guard should eventually resolve true');
assert.ok(elapsed >= 150, 'stability guard should wait for file to settle');

console.log('watch stability guard tests passed');

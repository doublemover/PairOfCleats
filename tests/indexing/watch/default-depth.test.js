#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMaxDepthCap } from '../../../src/index/build/watch/guardrails.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFilesForModes } from '../../../src/index/build/discover.js';

assert.equal(resolveMaxDepthCap(null), null, 'an absent watch depth must stay unbounded');
assert.equal(resolveMaxDepthCap(undefined), null);
assert.equal(resolveMaxDepthCap(0), 0, 'explicit zero retains root-only behavior');
assert.equal(resolveMaxDepthCap(2), 2);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-default-depth-'));
try {
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'root.js'), 'export const rootValue = 1;');
  await fs.writeFile(path.join(root, 'src', 'nested.js'), 'export const nestedValue = 2;');
  const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: {} });
  const discover = depth => discoverFilesForModes({ root, modes: ['code'], ignoreMatcher,
    maxDepth: resolveMaxDepthCap(depth), skippedByMode: {} });
  assert.deepEqual((await discover(null)).code.map(entry => entry.rel), ['root.js', 'src/nested.js']);
  assert.deepEqual((await discover(0)).code.map(entry => entry.rel), ['root.js']);
  console.log('Default watch depth retains nested source; explicit zero remains root-only.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

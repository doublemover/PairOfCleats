#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tooling-doctor-xxhash');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {},
  strict: false
}, null, { log: () => {} });

assert.ok(report.identity?.chunkUid?.available, 'expected xxhash backend to be available');
assert.notEqual(report.identity?.chunkUid?.backend, 'none');

console.log('tooling doctor xxhash backend test passed');

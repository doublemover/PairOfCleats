#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tooling-doctor');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {},
  strict: false
}, null, { log: () => {} });

const reportPath = path.join(tempRoot, 'tooling_report.json');
const raw = await fs.readFile(reportPath, 'utf8');
const parsed = JSON.parse(raw);

assert.ok(report, 'expected report object');
assert.ok(parsed.identity?.chunkUid, 'expected identity chunkUid section');
assert.ok(parsed.providers, 'expected providers section');

console.log('tooling doctor report emission test passed');

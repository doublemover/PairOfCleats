#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-report-emission-${process.pid}-${Date.now()}`);
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'index.js'), 'export const value = 1;\n', 'utf8');

applyTestEnv({ cacheRoot });
registerDefaultToolingProviders();

const report = await runToolingDoctor({
  repoRoot,
  buildRoot: tempRoot,
  toolingConfig: {},
  strict: false
}, [], {
  log: () => {},
  probeTimeoutMs: 750,
  handshakeTimeoutMs: 750
});

assert.ok(report, 'expected report object');
assert.ok(report.repoRoot, 'expected repoRoot');
assert.ok(report.config, 'expected config section');
assert.ok(report.xxhash, 'expected xxhash section');
assert.ok(Array.isArray(report.providers), 'expected providers array');
assert.ok(report.summary, 'expected summary section');

const typescript = report.providers.find((entry) => entry.id === 'typescript');
assert.ok(typescript, 'expected typescript provider entry');
assert.ok(Object.prototype.hasOwnProperty.call(typescript, 'enabled'), 'expected enabled field');

assert.ok(report.identity?.chunkUid?.available, 'expected xxhash backend to be available');
assert.notEqual(report.identity?.chunkUid?.backend, 'none');

const reportPath = path.join(tempRoot, 'tooling_doctor_report.json');
const raw = await fs.readFile(reportPath, 'utf8');
const parsed = JSON.parse(raw);
assert.ok(parsed.identity?.chunkUid, 'expected identity chunkUid section');
assert.ok(parsed.providers, 'expected providers section');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('tooling doctor report emission contract matrix test passed');

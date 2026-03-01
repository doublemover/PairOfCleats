#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor');
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

const reportPath = path.join(tempRoot, 'tooling_doctor_report.json');
const raw = await fs.readFile(reportPath, 'utf8');
const parsed = JSON.parse(raw);

assert.ok(report, 'expected report object');
assert.ok(parsed.identity?.chunkUid, 'expected identity chunkUid section');
assert.ok(parsed.providers, 'expected providers section');

console.log('tooling doctor report emission test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-json');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {},
  strict: false
}, null, { log: () => {} });

assert.ok(report.repoRoot, 'expected repoRoot');
assert.ok(report.config, 'expected config section');
assert.ok(report.xxhash, 'expected xxhash section');
assert.ok(Array.isArray(report.providers), 'expected providers array');
assert.ok(report.summary, 'expected summary section');

const typescript = report.providers.find((entry) => entry.id === 'typescript');
assert.ok(typescript, 'expected typescript provider entry');
assert.ok(Object.prototype.hasOwnProperty.call(typescript, 'enabled'), 'expected enabled field');

console.log('tooling doctor JSON schema test passed');

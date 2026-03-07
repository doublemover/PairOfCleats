#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { createDoctorCommandResolver } from '../../helpers/tooling-doctor-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-gating');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'index.js'), 'export const value = 1;\n', 'utf8');

applyTestEnv({ cacheRoot });

registerDefaultToolingProviders();
const resolveCommandProfile = createDoctorCommandResolver({
  available: ['clangd', 'typescript-language-server']
});
const report = await runToolingDoctor({
  repoRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['clangd'],
    disabledTools: ['typescript']
  },
  strict: false
}, null, {
  log: () => {},
  resolveCommandProfile,
  probeTimeoutMs: 750,
  handshakeTimeoutMs: 750
});

const providers = Array.isArray(report.providers) ? report.providers : [];
const typescript = providers.find((entry) => entry.id === 'typescript');
assert.ok(typescript, 'expected typescript provider entry');
assert.equal(typescript.enabled, false, 'expected typescript provider disabled');
assert.ok(typescript.reasonsDisabled.includes('disabled-by-config') || typescript.reasonsDisabled.includes('not-in-enabled-tools'));

console.log('tooling doctor gating reasons test passed');

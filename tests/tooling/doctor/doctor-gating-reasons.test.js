#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'tooling-doctor-gating');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['clangd'],
    disabledTools: ['typescript']
  },
  strict: false
}, null, { log: () => {} });

const providers = Array.isArray(report.providers) ? report.providers : [];
const typescript = providers.find((entry) => entry.id === 'typescript');
assert.ok(typescript, 'expected typescript provider entry');
assert.equal(typescript.enabled, false, 'expected typescript provider disabled');
assert.ok(typescript.reasonsDisabled.includes('disabled-by-config') || typescript.reasonsDisabled.includes('not-in-enabled-tools'));

console.log('tooling doctor gating reasons test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-preflight-capabilities-report');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

registerDefaultToolingProviders();

const report = await runToolingDoctor({
  repoRoot: root,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['sourcekit', 'clangd', 'typescript']
  },
  strict: false
}, ['sourcekit', 'clangd', 'typescript'], {
  log: () => {},
  probeHandshake: false
});

const sourcekit = (report.providers || []).find((entry) => entry.id === 'sourcekit');
assert.ok(sourcekit, 'expected sourcekit provider in doctor report');
assert.equal(sourcekit.preflight?.supported, true, 'expected sourcekit preflight support metadata');
assert.equal(
  sourcekit.preflight?.id,
  'sourcekit.package-resolution',
  'expected sourcekit preflight id in doctor report'
);
assert.equal(
  sourcekit.preflight?.class,
  'dependency',
  'expected sourcekit preflight class metadata'
);
assert.equal(
  sourcekit.preflight?.policy,
  'required',
  'expected sourcekit preflight policy metadata'
);
assert.equal(
  Array.isArray(sourcekit.preflight?.runtimeRequirements)
  && sourcekit.preflight.runtimeRequirements.some((entry) => entry?.id === 'swift'),
  true,
  'expected sourcekit preflight runtime requirement metadata'
);

const clangd = (report.providers || []).find((entry) => entry.id === 'clangd');
assert.ok(clangd, 'expected clangd provider in doctor report');
assert.equal(clangd.preflight?.supported, true, 'expected clangd preflight support metadata');
assert.equal(
  clangd.preflight?.id,
  'clangd.workspace-model',
  'expected clangd preflight id in doctor report'
);
assert.equal(
  clangd.preflight?.class,
  'workspace',
  'expected clangd preflight class metadata'
);
assert.equal(
  clangd.preflight?.policy,
  'optional',
  'expected clangd preflight policy metadata'
);

const typescript = (report.providers || []).find((entry) => entry.id === 'typescript');
assert.ok(typescript, 'expected typescript provider in doctor report');
assert.equal(
  typescript.preflight?.supported,
  false,
  'expected typescript provider to report no preflight support'
);

console.log('tooling doctor preflight capabilities report test passed');

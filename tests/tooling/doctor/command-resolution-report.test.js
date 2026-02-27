#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';


import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-command-resolution');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const report = await runToolingDoctor({
    repoRoot: root,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['clangd', 'pyright', 'sourcekit']
    },
    strict: false
  }, null, { log: () => {}, handshakeTimeoutMs: 1500 });

  assert.equal(report.schemaVersion, 2, 'expected doctor report schema version 2');
  assert.equal(report.reportFile, 'tooling_doctor_report.json', 'expected canonical doctor report filename');
  assert.equal(
    path.basename(report.reportPath || ''),
    'tooling_doctor_report.json',
    'expected doctor report path to use tooling_doctor_report.json'
  );

  const providers = Array.isArray(report.providers) ? report.providers : [];
  const clangd = providers.find((entry) => entry.id === 'clangd');
  assert.ok(clangd, 'expected clangd provider report');
  assert.ok(clangd.command && typeof clangd.command === 'object', 'expected command profile in provider report');
  assert.equal(
    Array.isArray(clangd.command?.probe?.attempted),
    true,
    'expected probe attempts in provider command profile'
  );
  assert.ok(clangd.handshake && typeof clangd.handshake === 'object', 'expected handshake probe details');
} finally {
  restorePath();
}

console.log('tooling doctor command resolution report test passed');

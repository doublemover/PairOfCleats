#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-generic-preset-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

const expectedProviders = [
  { id: 'lsp-gopls', commandCheck: 'lsp-gopls-command' },
  { id: 'lsp-rust-analyzer', commandCheck: 'lsp-rust-analyzer-command' },
  { id: 'lsp-yaml-language-server', commandCheck: 'lsp-yaml-language-server-command' },
  { id: 'lsp-lua-language-server', commandCheck: 'lsp-lua-language-server-command' },
  { id: 'lsp-zls', commandCheck: 'lsp-zls-command' }
];

try {
  const report = await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: [
          { preset: 'gopls' },
          { preset: 'rust-analyzer' },
          { preset: 'yaml-language-server' },
          { preset: 'lua-language-server' },
          { preset: 'zls' }
        ]
      }
    },
    strict: false
  }, expectedProviders.map((entry) => entry.id), {
    log: () => {},
    probeHandshake: false
  });

  for (const expected of expectedProviders) {
    const provider = (report.providers || []).find((entry) => entry.id === expected.id);
    assert.ok(provider, `expected provider report for ${expected.id}`);
    const commandCheck = (provider.checks || []).find((check) => check.name === expected.commandCheck);
    assert.ok(commandCheck, `expected command check for ${expected.id}`);
    assert.equal(
      commandCheck.status === 'ok' || commandCheck.status === 'warn',
      true,
      `expected command check status ok/warn for ${expected.id}`
    );
  }

  const zlsProvider = (report.providers || []).find((entry) => entry.id === 'lsp-zls');
  const zlsCompatibility = (zlsProvider?.checks || []).find((check) => check.name === 'zls-zig-compatibility');
  assert.ok(zlsCompatibility, 'expected zls-zig compatibility check');
  assert.equal(
    zlsCompatibility.status === 'ok' || zlsCompatibility.status === 'warn',
    true,
    'expected zls-zig compatibility check status ok/warn'
  );

  console.log('tooling doctor generic preset matrix test passed');
} finally {
  await restorePath();
}


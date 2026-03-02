#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-preflight-capabilities-configured-rust');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const report = await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-rust-analyzer'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'rust-analyzer',
          preset: 'rust-analyzer',
          cmd: 'rust-analyzer',
          languages: ['rust'],
          uriScheme: 'poc-vfs'
        }]
      }
    },
    strict: false
  }, ['lsp-rust-analyzer'], {
    log: () => {},
    probeHandshake: false
  });

  const provider = (report.providers || []).find((entry) => entry.id === 'lsp-rust-analyzer');
  assert.ok(provider, 'expected configured rust-analyzer provider in doctor report');
  assert.equal(provider.preflight?.supported, true, 'expected configured rust preflight capability');
  assert.equal(
    provider.preflight?.id,
    'lsp-rust-analyzer.workspace-model',
    'expected configured rust preflight id'
  );
  assert.equal(report.summary?.preflight?.supported, 1, 'expected one supported preflight provider');
  assert.equal(report.summary?.preflight?.enabled, 1, 'expected one enabled preflight provider');
  assert.ok(
    Array.isArray(report.summary?.preflight?.ids)
    && report.summary.preflight.ids.includes('lsp-rust-analyzer.workspace-model'),
    'expected summary preflight ids to include configured rust preflight'
  );
} finally {
  await restorePath();
}

console.log('tooling doctor preflight capabilities configured rust test passed');

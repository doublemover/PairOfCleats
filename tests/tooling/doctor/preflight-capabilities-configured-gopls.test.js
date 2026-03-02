#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-preflight-capabilities-configured-gopls');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const report = await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-gopls'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'gopls',
          preset: 'gopls',
          cmd: 'gopls',
          languages: ['go'],
          uriScheme: 'poc-vfs'
        }]
      }
    },
    strict: false
  }, ['lsp-gopls'], {
    log: () => {},
    probeHandshake: false
  });

  const provider = (report.providers || []).find((entry) => entry.id === 'lsp-gopls');
  assert.ok(provider, 'expected configured gopls provider in doctor report');
  assert.equal(provider.preflight?.supported, true, 'expected configured gopls preflight capability');
  assert.equal(
    provider.preflight?.id,
    'lsp-gopls.workspace-model',
    'expected configured gopls preflight id'
  );
  assert.equal(
    provider.preflight?.class,
    'workspace',
    'expected configured gopls preflight class'
  );
  assert.equal(report.summary?.preflight?.supported, 1, 'expected one supported preflight provider');
  assert.equal(report.summary?.preflight?.enabled, 1, 'expected one enabled preflight provider');
  assert.ok(
    Array.isArray(report.summary?.preflight?.ids)
    && report.summary.preflight.ids.includes('lsp-gopls.workspace-model'),
    'expected summary preflight ids to include configured gopls preflight'
  );
} finally {
  await restorePath();
}

console.log('tooling doctor preflight capabilities configured gopls test passed');

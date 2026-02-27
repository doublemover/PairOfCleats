#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-zls-zig-compat');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const report = await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: [{
          preset: 'zls',
          languages: ['zig']
        }]
      }
    },
    strict: false
  }, ['lsp-zls'], {
    log: () => {},
    probeHandshake: false
  });

  const zlsProvider = (report.providers || []).find((provider) => provider.id === 'lsp-zls');
  assert.ok(zlsProvider, 'expected zls provider report entry');
  const compatibilityCheck = (zlsProvider.checks || []).find((check) => check.name === 'zls-zig-compatibility');
  assert.ok(compatibilityCheck, 'expected zls-zig compatibility check');
  assert.equal(compatibilityCheck.status, 'ok', 'expected zls-zig compatibility check to pass');

  console.log('tooling doctor zls zig compatibility test passed');
} finally {
  restorePath();
}

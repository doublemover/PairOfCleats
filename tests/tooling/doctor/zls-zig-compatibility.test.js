#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv({ extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-doctor-zls-zig-compat');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  const fixtureZls = path.join(root, 'tests', 'fixtures', 'lsp', 'bin',
    process.platform === 'win32' ? 'zls.cmd' : 'zls');
  const report = await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([tempRoot]) }, () => runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: [{
          preset: 'zls',
          cmd: fixtureZls,
          languages: ['zig']
        }]
      }
    },
    strict: false
  }, ['lsp-zls'], {
    log: () => {},
    probeHandshake: false
  }));

  const zlsProvider = (report.providers || []).find((provider) => provider.id === 'lsp-zls');
  assert.ok(zlsProvider, 'expected zls provider report entry');
  const compatibilityCheck = (zlsProvider.checks || []).find((check) => check.name === 'zls-zig-compatibility');
  assert.ok(compatibilityCheck, 'expected zls-zig compatibility check');
  assert.equal(compatibilityCheck.status, 'ok', 'expected zls-zig compatibility check to pass');

  console.log('tooling doctor zls zig compatibility test passed');
} finally {
  await restorePath();
}


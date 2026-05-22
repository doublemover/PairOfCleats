#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const env = applyTestEnv();

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'setup', 'postinstall.js');

const withPatchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-patches-'));
const withoutPatchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-nopatches-'));

try {
  await fs.mkdir(path.join(withPatchDir, 'patches'), { recursive: true });
  await fs.writeFile(path.join(withPatchDir, 'patches', 'sample+1.0.0.patch'), 'diff --git a/x b/x\n');

  const missingPatchPkgWithPatches = runNode([scriptPath], 'postinstall patches without patch-package', withPatchDir, env, {
    stdio: 'pipe',
    allowFailure: true
  });
  assert.equal(
    missingPatchPkgWithPatches.status,
    1,
    'postinstall should fail when patches exist and patch-package is unavailable'
  );
  assert.match(
    `${missingPatchPkgWithPatches.stdout || ''}\n${missingPatchPkgWithPatches.stderr || ''}`,
    /patch-package is required/i
  );

  const missingPatchPkgWithPatchesOmittedDev = runNode(
    [scriptPath],
    'postinstall patches without patch-package omitted dev',
    withPatchDir,
    {
      ...env,
      npm_config_omit: 'dev'
    },
    {
      stdio: 'pipe',
      allowFailure: true
    }
  );
  assert.equal(
    missingPatchPkgWithPatchesOmittedDev.status,
    1,
    'postinstall should fail when patches exist, patch-package is unavailable, and dev dependencies are omitted'
  );
  assert.match(
    `${missingPatchPkgWithPatchesOmittedDev.stdout || ''}\n${missingPatchPkgWithPatchesOmittedDev.stderr || ''}`,
    /required patches exist/i
  );

  const missingPatchPkgNoPatches = runNode([scriptPath], 'postinstall no patches without patch-package', withoutPatchDir, env, {
    stdio: 'pipe'
  });
  assert.equal(
    missingPatchPkgNoPatches.status,
    0,
    'postinstall should succeed when no patches exist and patch-package is unavailable'
  );
  assert.match(
    `${missingPatchPkgNoPatches.stdout || ''}\n${missingPatchPkgNoPatches.stderr || ''}`,
    /no patch files found; skipping patch step/i
  );

  console.log('postinstall patch enforcement test passed');
} finally {
  await fs.rm(withPatchDir, { recursive: true, force: true });
  await fs.rm(withoutPatchDir, { recursive: true, force: true });
}

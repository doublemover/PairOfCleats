#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'setup', 'postinstall.js');

const withPatchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-patches-'));
const withoutPatchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-nopatches-'));

try {
  await fs.mkdir(path.join(withPatchDir, 'patches'), { recursive: true });
  await fs.writeFile(path.join(withPatchDir, 'patches', 'sample+1.0.0.patch'), 'diff --git a/x b/x\n');

  const missingPatchPkgWithPatches = spawnSync(process.execPath, [scriptPath], {
    cwd: withPatchDir,
    encoding: 'utf8'
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

  const missingPatchPkgWithPatchesOmittedDev = spawnSync(process.execPath, [scriptPath], {
    cwd: withPatchDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_omit: 'dev'
    }
  });
  assert.equal(
    missingPatchPkgWithPatchesOmittedDev.status,
    0,
    'postinstall should succeed when patches exist, patch-package is unavailable, and dev dependencies are omitted'
  );
  assert.match(
    `${missingPatchPkgWithPatchesOmittedDev.stdout || ''}\n${missingPatchPkgWithPatchesOmittedDev.stderr || ''}`,
    /omitted-dev install; skipping patch application/i
  );

  const missingPatchPkgNoPatches = spawnSync(process.execPath, [scriptPath], {
    cwd: withoutPatchDir,
    encoding: 'utf8'
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

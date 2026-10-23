#!/usr/bin/env node
// Authored selected-layout consumer fixture. Inert selected command bytes are
// never executed; canonical configuration and actual child session owners run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planStorageConfiguration, applyStorageConfiguration } from '../../../src/shared/storage/configuration.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { identifyProvisioningExecutable } from '../../../tools/tooling/provisioning-plan.js';
import { runOperationalChildWithStorage } from '../../../tools/tooling/operational-storage.js';

const temporary = await makeTempDir('poc-operational-selected-layout-');
try {
  const home = path.join(temporary, 'home'), repoRoot = path.join(temporary, 'repo'), toolingRoot = path.join(temporary, 'tooling');
  await fs.mkdir(repoRoot);
  const command = path.join(repoRoot, 'explicit-trusted-graphviz-fixture'); await fs.writeFile(command, 'inert selected command bytes');
  const env = { PAIROFCLEATS_HOME: home }, layout = resolveStorageLayout({ env, overrides: { tooling: toolingRoot } });
  const targets = {};
  for (const category of ['shared', 'tmp', 'state']) {
    const currentPath = layout.descriptors[category].path, target = path.join(temporary, 'selected-' + category);
    await fs.mkdir(currentPath, { recursive: true });
    const reviewed = await planStorageConfiguration({ layout, category, currentPath, target });
    await applyStorageConfiguration(reviewed, { approvedPlanId: reviewed.planId, home, category, target });
    targets[category] = target;
  }
  const coordinationRoot = path.join(targets.state, 'storage-access');
  let scratch, cache;
  const result = await runOperationalChildWithStorage({ id: 'graphviz', toolingRoot, repoRoot, command,
    identity: identifyProvisioningExecutable(command), env }, async ({ env: routed, plan }) => {
    scratch = routed.TMP; cache = routed.XDG_CACHE_HOME;
    assert.ok(scratch.startsWith(path.join(targets.tmp, 'managed-children') + path.sep));
    assert.ok(cache.startsWith(path.join(targets.shared, 'managed-children') + path.sep));
    assert.equal(plan.locations.some(location => location.environmentKey === 'XDG_CACHE_HOME' && location.external === false), true);
    assert.equal((await inspectStorageAccess(scratch, { coordinationRoot })).protected, true);
    assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, true);
    return { exitCode: 0, stdout: '<svg/>' };
  });
  assert.equal(result.exitCode, 0);
  assert.equal((await inspectStorageAccess(scratch, { coordinationRoot })).protected, false);
  assert.equal((await inspectStorageAccess(cache, { coordinationRoot })).protected, false);
  await assert.rejects(fs.stat(path.join(layout.descriptors.tmp.path, 'managed-children')), { code: 'ENOENT' },
    'selected category authority never prepares obsolete default scratch routes');
} finally { await rmDirRecursive(temporary); }
console.log('Operational preparation and session authorization use the same canonical selected cache/tmp/state descriptors.');

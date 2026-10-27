import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getToolingRegistry, selectInstallPlan } from '../../../tools/tooling/utils.js';
import { GOPLS_PACKAGE } from '../../../tools/tooling/gopls-recipe.js';
import { resolveDeclaredInstallAdmission, bindDeclaredInstallAdmission, runToolInstallChild } from '../../../tools/tooling/install-execution.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { GO_SDK_ARCHIVE_LIMITS, GO_SDK_MAX_DOWNLOAD_BYTES } from '../../../src/shared/managed-go.js';
import { createToolInstallPreview } from '../../../tools/tooling/install-preview.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('gopls-allocation-recipe');
const home = path.join(dir, 'home'), toolingRoot = path.join(home, 'tooling');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null
} });
const tool = getToolingRegistry(toolingRoot, dir).find(entry => entry.id === 'gopls');
const selected = selectInstallPlan(tool, 'cache', false), recipe = selected.plan;
assert.deepEqual(recipe.args, ['install', GOPLS_PACKAGE]);
assert.equal(recipe.minimumGoVersion, 'go1.27.0');
const declared = resolveDeclaredInstallAdmission(recipe);
assert.equal(declared.state, 'estimate-declared', 'the actual canonical gopls recipe must not be unconditionally blocked for a missing declaration');
assert.equal(declared.source, 'canonical-recipe-build-forecast'); assert.equal(declared.measured, false);
assert.ok(declared.writes.every(write => Number.isSafeInteger(write.requiredBytes) && write.requiredBytes > 0));
const sdk = resolveDeclaredInstallAdmission({ storageEstimate: recipe.goSdkStorageEstimate });
assert.equal(sdk.basis, 'bounded-archive-owner-v1');
assert.ok(sdk.writes[0].requiredBytes >= GO_SDK_ARCHIVE_LIMITS.maxBytes + GO_SDK_MAX_DOWNLOAD_BYTES);
const layout = resolveStorageLayout({ home, overrides: { tooling: toolingRoot }, env: {} });
const plan = planManagedChildStorage({ layout, baseEnv: recipe.env, command: recipe.cmd, cwd: dir,
  family: 'go', managed: true, toolId: tool.id, toolIdentity: GOPLS_PACKAGE });
const admission = bindDeclaredInstallAdmission(declared, { storagePlan: plan, artifactRoot: toolingRoot });
assert.ok(admission, 'every actual canonical Go cache/temp/output destination needs an estimate');
for (const location of plan.locations) {
  assert.ok(admission.writes.some(write => isPathWithinRoot(location.path, write.root)), location.environmentKey);
}
const temporary = plan.locations.find(location => location.environmentKey === 'GOTMPDIR');
assert.ok(temporary); assert.equal(temporary.retention, 'temporary'); assert.equal(temporary.cleanupAuthority, false);
assert.ok(isPathWithinRoot(temporary.path, plan.scratch));
const override = path.join(dir, 'explicit-go-work');
const external = planManagedChildStorage({ layout, baseEnv: { ...recipe.env, GOTMPDIR: override }, command: recipe.cmd,
  cwd: dir, family: 'go', managed: true, toolId: tool.id, toolIdentity: GOPLS_PACKAGE });
assert.equal(external.env.GOTMPDIR, override, 'an explicit Go temp choice is not silently overwritten');
assert.equal(external.locations.find(location => location.environmentKey === 'GOTMPDIR').cleanupAuthority, false);
assert.equal(bindDeclaredInstallAdmission(declared, { storagePlan: external, artifactRoot: toolingRoot }), null,
  'an uncovered external override cannot borrow the canonical scratch estimate');
if (process.platform === 'win32') {
  const platformTemp = path.join(dir, 'platform-temp');
  const nativeCase = planManagedChildStorage({ layout, baseEnv: { ...recipe.env, TMP: platformTemp.toUpperCase() },
    command: recipe.cmd, cwd: dir, platformTemp, family: 'go', managed: true, toolId: tool.id, toolIdentity: GOPLS_PACKAGE });
  assert.equal(nativeCase.env.TMP, nativeCase.scratch, 'Windows case aliases of the platform default are the same temporary location');
}
let probes = 0;
const preview = createToolInstallPreview({ tools: [tool], scope: 'cache' }, {
  locate: () => { probes++; return { path: null, source: null }; }, provisioning: () => ({ steps: [] })
});
assert.equal(probes, 1); assert.equal(preview.entries[0].admission.source, 'canonical-recipe-build-forecast');
assert.equal(preview.entries[0].blockers.some(blocker => blocker.code === 'storage-estimate-unavailable'), false);
assert.equal(preview.execution, 'none');
let launches = 0;
const unknown = await runToolInstallChild({ command: 'unqualified-builder', args: [], options: { cwd: dir },
  storagePlan: plan, layout, artifactRoot: toolingRoot, spawn: async () => { launches++; } });
assert.equal(unknown.storage.admission, 'deferred-unknown-allocation'); assert.equal(launches, 0);
await assert.rejects(fs.stat(plan.scratch), { code: 'ENOENT' });
await assert.rejects(fs.stat(toolingRoot), { code: 'ENOENT' });
console.log('Canonical gopls forecasts cover actual managed Go routes; no install, compiler, download or measured-peak qualification.');

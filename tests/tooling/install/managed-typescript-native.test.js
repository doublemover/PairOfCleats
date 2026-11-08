import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveManagedTypeScriptNativeRecipe, verifyManagedTypeScriptNative } from '../../../tools/tooling/managed-typescript-native.js';
import { TYPESCRIPT_NATIVE_VERSION, TYPESCRIPT_NATIVE_PROFILE, TYPESCRIPT_NATIVE_PRESET,
  resolveTypeScriptNativeCommand, assertTypeScriptNativeInitialize, admitTypeScriptNativeInputs } from '../../../src/index/tooling/typescript-native-profile.js';
import { installPinnedManagedTool, validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { resolveDeclaredInstallAdmission } from '../../../tools/tooling/install-allocation-contract.js';
import { getToolingRegistry, resolveToolsForLanguages } from '../../../tools/tooling/utils.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-typescript-native/')[1];
const scope = path.resolve('.tmp/tasks/typescript-native-fixture'); await fs.mkdir(scope, { recursive: true });
const root = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID(); await fs.writeFile(path.join(root, '.owned-fixture'), marker);
const home = path.join(root, 'home'), toolingRoot = path.join(home, 'tooling'), project = path.join(root, 'project'); await fs.mkdir(project);
let primaryFailure = null;
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([project]) }), async () => {
    const canonical = resolveManagedTypeScriptNativeRecipe({ platform: 'win32', arch: 'x64' });
    if (mode === 'canonical-archive-bounds') {
      for (const arch of ['x64', 'arm64']) {
        const recipe = resolveManagedTypeScriptNativeRecipe({ platform: 'win32', arch });
        validatePinnedInstallDescriptor(recipe.managedDescriptor, { approvedOrigins: recipe.approvedOrigins, platform: 'win32', arch });
        assert.equal(recipe.managedDescriptor.version, '7.0.2'); assert.equal(recipe.managedDescriptor.command, 'lib/tsc.exe');
        assert.equal(resolveDeclaredInstallAdmission(recipe).state, 'estimate-declared');
        assert.equal(recipe.storageEstimate.writes[0].requiredBytes, 1024 * 1024 * 1024 + recipe.managedDescriptor.archive.bytes + 32 * 1024 * 1024);
        assert.deepEqual(recipe.managedDescriptor.args, []); assert.equal(Object.hasOwn(recipe, 'cmd'), false, 'no npm/build wrapper');
      }
      for (const platform of ['linux', 'darwin']) assert.equal(resolveManagedTypeScriptNativeRecipe({ platform, arch: 'x64' }), null);
      assert.equal(resolveManagedTypeScriptNativeRecipe({ platform: 'win32', arch: 'ia32' }), null); return;
    }
    if (mode === 'explicit-profile-and-source-authority') {
      const normalized = normalizeServerConfig({ preset: 'typescript-native' }, 0);
      assert.equal(normalized.protocolProfile, TYPESCRIPT_NATIVE_PROFILE); assert.deepEqual(normalized.args, ['--lsp', '--stdio']);
      assert.equal(normalized.requiresWorkspaceExecution, true);
      assert.equal(normalized.initializationOptions.settings['js/ts'].tsserver.automaticTypeAcquisition.enabled, false);
      const documents = ['src/a.ts', 'src/b.jsx', 'src/c.mts', 'view.vue'].map(virtualPath => ({ virtualPath }));
      documents.push({ containerPath: 'view.svelte', virtualPath: 'view.svelte#script.ts' }, { containerPath: 'missing.ts' });
      const admitted = admitTypeScriptNativeInputs({ documents, targets: documents.map(doc => ({ virtualPath: doc.virtualPath })) });
      assert.deepEqual(admitted.documents.map(doc => doc.virtualPath), ['src/a.ts', 'src/b.jsx', 'src/c.mts']);
      assert.equal(admitted.targets.length, 3); assert.equal(admitted.checks[0].name, 'typescript_native_unsupported_document');
      assertTypeScriptNativeInitialize({ serverInfo: { name: 'typescript-go', version: TYPESCRIPT_NATIVE_VERSION } });
      for (const serverInfo of [null, { name: 'typescript-go', version: '6.0.3' }, { name: 'typescript-language-server', version: TYPESCRIPT_NATIVE_VERSION }]) {
        assert.throws(() => assertTypeScriptNativeInitialize({ serverInfo }), { code: 'ERR_TOOLING_TYPESCRIPT_NATIVE_IDENTITY' });
      }
      assert.equal(TYPESCRIPT_NATIVE_PRESET.explicitOnly, true);
      assert.equal(resolveToolsForLanguages(['javascript', 'typescript'], toolingRoot, project).some(tool => tool.id === 'typescript-native'), false);
      assert.equal(resolveToolsForLanguages(['typescript'], toolingRoot, project, { enabledTools: ['typescript-native'] })[0].id, 'typescript-native'); return;
    }
    if (mode === 'verification-and-original-settlement') {
      const input = { root: path.join(root, 'generation'), command: path.join(root, 'generation/lib/tsc.exe'),
        descriptor: canonical.managedDescriptor, toolingRoot, resourceId: 'native-ts-fixture' };
      let calls = 0;
      const probe = async (command, args) => { calls++; assert.equal(command, input.command); assert.deepEqual(args, ['--version']);
        return { ok: true, stdout: 'Version ' + TYPESCRIPT_NATIVE_VERSION + '\n' }; };
      assert.equal((await verifyManagedTypeScriptNative(input, { probe })).ok, true);
      assert.equal((await verifyManagedTypeScriptNative(input, { probe: async () => ({ ok: true, stdout: 'Version 6.0.3\n' }) })).ok, false);
      const controller = new AbortController(); controller.abort(false);
      await assert.rejects(() => verifyManagedTypeScriptNative({ ...input, signal: controller.signal }, { probe }), error => error.cause === false || error === false);
      assert.equal(calls, 1);
      let settled = true, stdoutReads = 0;
      const pending = { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled,
        get ok() { settled = false; return true; }, get stdout() { stdoutReads++; settled = true; return 'Version ' + TYPESCRIPT_NATIVE_VERSION; } };
      await assert.rejects(() => verifyManagedTypeScriptNative(input, { probe: async () => pending }));
      assert.equal(stdoutReads, 0, 'later fields cannot erase original pending work'); return;
    }
    if (mode !== 'managed-publication-and-selection') throw new Error('Unknown native TypeScript case: ' + mode);
    assert.equal(resolveTypeScriptNativeCommand(toolingRoot), '', 'missing native selection cannot route to PATH tsc/tsserver');
    // Explicit inert bytes exercise publication and retained identities only.
    // Actual native vendor execution is a separate Windows qualification.
    const body = Buffer.from('explicit native TypeScript publication fixture');
    const descriptor = { ...canonical.managedDescriptor, platform: process.platform, arch: process.arch,
      archive: { ...canonical.managedDescriptor.archive, url: 'https://fixture.invalid/native-ts.tgz', bytes: body.length,
        sha512: createHash('sha512').update(body).digest('hex') },
      storageEstimate: { complete: true, basis: 'bounded-archive-owner-v1', writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } };
    const options = { toolingRoot, descriptor, approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => ({ body, sourceUrl: url }),
      extract: async (_archive, target) => { for (const name of descriptor.requiredFiles) {
        const file = path.join(target, 'package', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'explicit inert native fixture\n');
      } },
      verify: async ({ resourceId }) => ({ ok: true, level: 'explicit-inert-publication-fixture', settlement: { resourceId, settled: true, pending: false } }) };
    const installed = await installPinnedManagedTool(options); assert.equal(installed.ok, true);
    const selected = resolveTypeScriptNativeCommand(toolingRoot); assert.ok(path.isAbsolute(selected));
    assert.equal((await installPinnedManagedTool(options)).reused, true);
    const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'typescript-native');
    assert.equal(tool.detect.cmd, selected);
    await fs.writeFile(selected, 'changed unqualified executable');
    assert.equal(resolveTypeScriptNativeCommand(toolingRoot), '', 'changed native generation cannot fall back to the old compiler');
  });
} catch (error) { primaryFailure = error; throw error; }
finally {
  const access = await inspectStorageAccess(toolingRoot, { coordinationRoot: path.join(home, 'state/storage-access') });
  if (access.protected) {
    const pending = new Error('Original native TypeScript fixture resources remain protected; retain for original recovery.');
    throw primaryFailure ? new AggregateError([primaryFailure, pending], pending.message, { cause: primaryFailure }) : pending;
  }
  assertNoSymlinkPath(path.parse(root).root, root);
  const physical = await fs.realpath(root); assert.equal(path.dirname(physical), await fs.realpath(scope));
  assert.equal(await fs.readFile(path.join(physical, '.owned-fixture'), 'utf8'), marker); await fs.rm(physical, { recursive: true });
}
console.log('Managed native TypeScript case passed: ' + mode);

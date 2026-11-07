import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';
import { TYPESCRIPT_API7_VERSION, TYPESCRIPT_API7_PROFILE, resolveManagedTypeScriptApi7Recipes,
  verifyManagedTypeScriptApi7Sdk, verifyManagedTypeScriptApi7Native } from '../../../tools/tooling/managed-typescript-api7.js';
import { resolveManagedTypeScriptNativeRecipe } from '../../../tools/tooling/managed-typescript-native.js';
import { validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-typescript-api7-components/')[1];
assert.ok(['exact-pins-and-targets', 'versioned-component-owners', 'closed-preparation', 'sdk-real-fixture-exports',
  'sdk-invalid-fixture-exports', 'original-before-fields', 'guarded-activation-result'].includes(mode));
const temporary = await makeTempDir('poc-api7-components-'), sdkRoot = path.join(temporary, 'sdk'), toolingRoot = path.join(temporary, 'tools');
const adapter = await getOfflineEvaluationAdapter(TYPESCRIPT_API7_PROFILE);
let ready = true;
try {
  if (mode === 'exact-pins-and-targets' || mode === 'versioned-component-owners') {
    for (const arch of ['x64', 'arm64']) {
      const pair = resolveManagedTypeScriptApi7Recipes({ platform: 'win32', arch });
      for (const [role, recipe] of Object.entries(pair)) {
        const descriptor = recipe.managedDescriptor, pinned = validatePinnedInstallDescriptor(descriptor, { ...recipe, platform: 'win32', arch });
        assert.equal(descriptor.version, TYPESCRIPT_API7_VERSION); assert.equal(descriptor.schemaVersion, 1);
        assert.deepEqual(recipe.approvedOrigins, ['https://registry.npmjs.org']); assert.equal(descriptor.archive.type, 'tar.gz');
        assert.match(descriptor.archive.sha512, /^[a-f0-9]{128}$/); assert.ok(descriptor.archive.bytes > 0);
        assert.ok(descriptor.storageEstimate.complete && descriptor.storageEstimate.writes[0].requiredBytes >= 1024 ** 3 + descriptor.archive.bytes);
        assert.equal(pinned.descriptorId, validatePinnedInstallDescriptor(JSON.parse(JSON.stringify(descriptor)), { ...recipe, platform: 'win32', arch }).descriptorId);
        assert.ok(descriptor.toolId.includes(TYPESCRIPT_API7_VERSION) && descriptor.toolId.endsWith('win32-' + arch));
        assert.ok(descriptor.requiredFiles.includes(descriptor.command));
        if (role === 'sdk') { assert.equal(descriptor.archive.bytes, 576463); assert.equal(descriptor.command, 'dist/api/async/api.js'); assert.deepEqual(descriptor.executables, []); }
        else { assert.equal(descriptor.command, 'lib/tsc.exe'); assert.equal(descriptor.archive.bytes, arch === 'x64' ? 10283326 : 9385247); }
      }
      assert.notEqual(pair.sdk.managedDescriptor.toolId, pair.native.managedDescriptor.toolId);
      assert.notEqual(pair.native.managedDescriptor.toolId, resolveManagedTypeScriptNativeRecipe({ platform: 'win32', arch }).managedDescriptor.toolId);
    }
    for (const platform of ['linux', 'darwin', 'freebsd']) assert.equal(resolveManagedTypeScriptApi7Recipes({ platform, arch: 'x64' }), null);
    assert.equal(resolveManagedTypeScriptApi7Recipes({ platform: 'win32', arch: 'ia32' }), null);
  } else if (mode === 'closed-preparation') {
    assert.deepEqual(adapter.capabilities, ['prepare']);
    const before = await fs.readdir(temporary), controller = new AbortController(); controller.abort(null);
    await assert.rejects(adapter.prepare({ toolingRoot, signal: controller.signal }), error => error?.name === 'AbortError' || error === null);
    for (const input of [{ toolingRoot: 'relative' }, { toolingRoot, install: true }, { toolingRoot, download: () => {} }, { toolingRoot, signal: {} }]) {
      await assert.rejects(adapter.prepare(input));
    }
    let reads = 0;
    await assert.rejects(adapter.prepare({ get toolingRoot() { reads++; return toolingRoot; } })); assert.equal(reads, 0);
    if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch)) await assert.rejects(adapter.prepare({ toolingRoot }), { code: 'ERR_TYPESCRIPT_API7_PLATFORM' });
    assert.deepEqual(await fs.readdir(temporary), before);
  } else {
    const pair = resolveManagedTypeScriptApi7Recipes(), resourceId = 'explicit-api7-component-verification';
    if (!pair) {
      let probes = 0;
      await assert.rejects(verifyManagedTypeScriptApi7Sdk({ root: sdkRoot, command: path.join(sdkRoot, 'dist/api/async/api.js'), toolingRoot,
        descriptor: resolveManagedTypeScriptApi7Recipes({ platform: 'win32', arch: 'x64' }).sdk.managedDescriptor, resourceId },
      { probe: async () => { probes++; throw new Error('unsupported target must not launch'); } }));
      assert.equal(probes, 0, 'explicit unsupported-platform coverage, not a skipped positive');
    } else {
      const descriptor = pair.sdk.managedDescriptor, command = path.join(sdkRoot, descriptor.command), input = { root: sdkRoot, command, descriptor, toolingRoot, resourceId };
      if (mode === 'sdk-real-fixture-exports' || mode === 'sdk-invalid-fixture-exports') {
        // Explicit trusted inert SDK modules. This is real Node transport/close
        // coverage for the verifier, not official archive or API qualification.
        await fs.mkdir(path.dirname(command), { recursive: true }); await fs.mkdir(toolingRoot);
        await fs.writeFile(path.join(sdkRoot, 'package.json'), JSON.stringify({ type: 'module', name: 'typescript', version: TYPESCRIPT_API7_VERSION }));
        await fs.writeFile(command, mode === 'sdk-real-fixture-exports' ? 'export class API { async close() {} }' : 'export class API {}');
        await fs.writeFile(path.join(sdkRoot, 'dist', 'api', 'fs.js'), 'export const createFileSystem = () => ({});');
        await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([sdkRoot]) }), async () => {
          const result = await verifyManagedTypeScriptApi7Sdk(input);
          assert.equal(result.ok, mode === 'sdk-real-fixture-exports'); assert.equal(result.runtimeQualified, false);
          assert.equal(result.cacheOwnershipReleased(), true); assert.equal(result.settlement.resourceId, resourceId);
          if (!result.ok) assert.equal(result.cause.ok, true, 'a successful child with the wrong SDK surface remains a verifier refusal');
        });
      } else {
        let reads = 0, probes = 0;
        const original = { cacheOwnershipPending: true, cacheOwnershipReleased: () => ready };
        Object.defineProperties(original, { ok: { get() { reads++; return true; } },
          stdout: { get() { reads++; ready = true; return JSON.stringify({ name: 'typescript', version: TYPESCRIPT_API7_VERSION,
            api: 'function', close: 'function', fileSystem: 'function' }); } } });
        if (mode === 'original-before-fields') ready = false;
        const result = await verifyManagedTypeScriptApi7Sdk(input, { probe: async (executable, args, options) => {
          probes++; assert.equal(executable, process.execPath); assert.equal(args[0], '--input-type=module');
          assert.equal(options.timeoutMs, 4000); assert.equal(options.maxOutputBytes, 65536); return original;
        } }).catch(error => error);
        assert.equal(probes, 1);
        if (mode === 'original-before-fields') {
          assert.equal(errorGraphIncludes(result, original), true); assert.equal(reads, 0); assert.equal(Object.hasOwn(result, 'settlement'), false);
          original.cacheOwnershipReleased = () => true; assert.equal(result.cacheOwnershipReleased(), false);
          ready = true; assert.equal(result.cacheOwnershipReleased(), true);
        } else {
          assert.equal(result.ok, true); assert.equal(result.runtimeQualified, false); assert.equal(reads, 2);
          ready = false; original.cacheOwnershipReleased = () => true; assert.equal(result.cacheOwnershipReleased(), false);
          ready = true; assert.equal(result.cacheOwnershipReleased(), true);
          assert.equal(Object.keys(result).includes('cacheOwnershipReleased'), false);
        }
        const nativeDescriptor = pair.native.managedDescriptor;
        const wrong = await verifyManagedTypeScriptApi7Native({ ...input, descriptor: nativeDescriptor, command: path.join(sdkRoot, nativeDescriptor.command) },
          { probe: async () => ({ ok: true, stdout: 'Version 7.0.2' }) });
        assert.equal(wrong.ok, false); assert.equal(wrong.runtimeQualified, false); assert.equal(wrong.cause.stdout, 'Version 7.0.2');
      }
    }
  }
} finally { ready = true; await rmDirRecursive(temporary, { retries: 0 }); }
console.log('Pinned API7 SDK/native components retain versioned ownership, bounded activation and explicit platform/runtime qualification boundaries.');

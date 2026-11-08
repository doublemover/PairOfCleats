import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createManagedVerificationObservation } from '../../../tools/tooling/managed-verification-observation.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { probeProvisioningCommand } from '../../../tools/tooling/provisioning-plan.js';
import { probeInstalledClangd } from '../../../tools/tooling/install-clangd.js';
import { verifyManagedPyright, resolveManagedPyrightRecipe } from '../../../tools/tooling/managed-pyright.js';
import { verifyManagedTypeScriptNative, resolveManagedTypeScriptNativeRecipe } from '../../../tools/tooling/managed-typescript-native.js';
import { verifyManagedCsharpLs, resolveManagedCsharpLsRecipe } from '../../../tools/tooling/csharp-ls-recipe.js';
import { verifyManagedDotnetSdk, resolveManagedDotnetSdkRecipe, DOTNET_SDK_VERSION, DOTNET_RUNTIME_VERSION } from '../../../tools/tooling/managed-dotnet-sdk.js';
import { verifyManagedAstGrep, resolveAstGrepManagedRecipe, AST_GREP_VERSION } from '../../../tools/tooling/managed-ast-grep.js';
import { verifyManagedTypeScriptApi7Sdk, verifyManagedTypeScriptApi7Native } from '../../../tools/tooling/managed-typescript-api7.js';
import { resolveManagedTypeScriptApi7Recipes, TYPESCRIPT_API7_VERSION } from '../../../src/shared/typescript-api7-pins.js';
import { installPinnedManagedTool, inspectManagedInstallation } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { normalizeEnvPathKeys } from '../../../src/shared/env-path.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-verification-retention/')[1];
const scope = path.resolve('.tmp/tests/managed-verifier-retention');
assertNoSymlinkPath(process.cwd(), scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), home = path.join(temporary, 'home');
const root = path.join(temporary, 'generation'), toolingRoot = path.join(home, 'tooling'), resourceId = 'original-verification-fixture';
const opendir = fs.opendir, guarded = [];
const own = fields => {
  const state = { released: true, calls: 0 };
  const original = fields;
  Object.defineProperties(original, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: {
    configurable: true, writable: true, value() { assert.equal(this, original, 'the callback belongs to its exact original receiver'); state.calls++; return state.released; }
  } });
  guarded.push(state); return { original, state };
};
const checkRetained = (report, originals, states) => {
  const observed = observeStorageResource(report);
  assert.equal(observed.isSettled(), true);
  for (const original of originals) assert.equal(errorGraphIncludes(report, original), true);
  assert.equal(Object.keys(report).includes('cacheOwnershipReleased'), false);
  const stable = JSON.stringify(report);
  for (const state of states) {
    state.released = false; assert.equal(observed.isSettled(), false, 'late original revocation stays binding');
    assert.throws(() => observed.requireSettled()); state.released = true; assert.equal(observed.isSettled(), true);
  }
  assert.equal(JSON.stringify(report), stable, 'resource observations do not alter the persisted verification DTO');
};
try {
  await fs.mkdir(root);
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null }), async () => {
    if (mode === 'helper-original-and-independent-observations') {
      const observation = createManagedVerificationObservation(), first = own({ ok: true }), second = own({ ok: true });
      observation.remember(first.original); observation.remember(second.original);
      const report = observation.finish({ ok: true });
      checkRetained(report, [first.original, second.original], [first.state, second.state]);
      first.original.cacheOwnershipReleased = () => true;
      first.state.released = false; assert.equal(report.cacheOwnershipReleased(), false, 'replacement cannot replace the captured callback');
      first.state.released = true;
      observation.rememberComposition(report); assert.equal(observation.isSettled(), true, 'the owner does not observe its own report as another resource');
      return;
    }
    if (mode === 'helper-field-failure-and-projection') {
      const observation = createManagedVerificationObservation(), sentinel = Object.freeze(new Error('original field failure'));
      const { original, state } = own({ ok: true });
      Object.defineProperty(original, 'stdout', { enumerable: true, get() { state.released = false; throw sentinel; } });
      let caught; try { observation.project(original); } catch (error) { caught = observation.failure(error); }
      assert.ok(caught); assert.equal(errorGraphIncludes(caught, sentinel), true); assert.equal(errorGraphIncludes(caught, original), true);
      assert.equal(caught.cacheOwnershipReleased(), false); state.released = true; assert.equal(caught.cacheOwnershipReleased(), true);
      const control = own({ ok: true, stdout: 'verified' }), copied = createManagedVerificationObservation();
      const report = copied.finish(copied.project(control.original));
      assert.equal(report.stdout, 'verified'); checkRetained(report, [control.original], [control.state]); return;
    }
    if (mode === 'helper-pending-before-fields') {
      const observation = createManagedVerificationObservation(), source = own({}); let reads = 0;
      Object.defineProperty(source.original, 'ok', { enumerable: true, get() { reads++; source.state.released = true; return true; } });
      source.state.released = false;
      let caught; try { observation.project(source.original); } catch (error) { caught = observation.failure(error); }
      assert.ok(caught); assert.equal(reads, 0); assert.equal(errorGraphIncludes(caught, source.original), true);
      source.state.released = true; assert.equal(caught.cacheOwnershipReleased(), true); return;
    }
    if (mode.startsWith('probe-') || mode === 'clangd-original-spawn-result') {
      const source = own({ exitCode: mode === 'probe-nonzero-result' ? 2 : 0, stdout: 'clangd version 23.1.0\n', stderr: '', signal: null });
      if (mode === 'probe-nested-capture') {
        const nested = own({ truncated: false }); source.original.outputCapture = { stdout: nested.original };
        const report = await probeProvisioningCommand('explicit-inert-command', ['--version'], { spawn: async () => source.original });
        checkRetained(report, [source.original], [source.state, nested.state]); return;
      }
      if (mode === 'probe-settled-error') {
        const failure = own(Object.assign(new Error('explicit spawn refusal'), { code: 'ENOENT' }));
        const report = await probeProvisioningCommand('explicit-inert-command', [], { spawn: async () => { throw failure.original; } });
        assert.equal(report.ok, false); assert.equal(report.outcome, 'missing');
        checkRetained(report, [failure.original], [failure.state]); return;
      }
      if (mode === 'probe-revocation-between-fields') {
        let reads = 0;
        Object.defineProperty(source.original, 'exitCode', { get() { source.state.released = false; return 0; } });
        Object.defineProperty(source.original, 'stdout', { get() { reads++; source.state.released = true; return ''; } });
        await assert.rejects(probeProvisioningCommand('explicit-inert-command', [], { spawn: async () => source.original }), error => errorGraphIncludes(error, source.original));
        assert.equal(reads, 0); return;
      }
      if (mode === 'probe-field-failure') {
        const sentinel = Object.freeze(new Error('original stdout inspection failed'));
        Object.defineProperty(source.original, 'stdout', { get() { throw sentinel; } });
        await assert.rejects(probeProvisioningCommand('explicit-inert-command', [], { spawn: async () => source.original }), error =>
          errorGraphIncludes(error, sentinel) && errorGraphIncludes(error, source.original));
        return;
      }
      const report = mode === 'clangd-original-spawn-result'
        ? await probeInstalledClangd('explicit-inert-command', { cwd: root, env: {}, resourceId }, { spawn: async () => source.original })
        : await probeProvisioningCommand('explicit-inert-command', [], { spawn: async () => source.original });
      assert.equal(report.ok, mode !== 'probe-nonzero-result'); checkRetained(report, [source.original], [source.state]);
      source.original.cacheOwnershipReleased = () => true; source.state.released = false; assert.equal(report.cacheOwnershipReleased(), false); return;
    }
    if (mode === 'publication-after-original-revocation') {
      const pinned = resolveManagedPyrightRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor;
      const make = label => {
        const body = Buffer.from(label);
        return { body, descriptor: { ...pinned, platform: process.platform, arch: process.arch,
          archive: { ...pinned.archive, url: `https://fixture.invalid/${label}.tgz`, bytes: body.length, sha512: createHash('sha512').update(body).digest('hex') },
          storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 ** 2 }] } } };
      };
      const dependencies = value => ({ toolingRoot, descriptor: value.descriptor, approvedOrigins: ['https://fixture.invalid'],
        download: async ({ url }) => ({ sourceUrl: url, body: value.body }), extract: async (_archive, target) => {
          for (const filename of value.descriptor.requiredFiles) {
            const file = path.join(target, 'package', filename); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value.body);
          }
        } });
      const previous = await installPinnedManagedTool({ ...dependencies(make('previous')), verify: async ({ resourceId: id }) => ({ ok: true, settlement: { resourceId: id, settled: true, pending: false } }) });
      const source = own({ ok: true, stdout: 'pyright ' + pinned.version }); let armed = false, revoked = false;
      let failure;
      fs.opendir = async (filename, ...args) => {
        if (armed && path.basename(String(filename)) === 'package') { revoked = true; source.state.released = false; }
        return opendir(filename, ...args);
      };
      try {
        await installPinnedManagedTool({ ...dependencies(make('candidate')), verify: async input => {
          const report = await verifyManagedPyright(input, { probe: async () => source.original }); armed = true; return report;
        } });
      } catch (error) { failure = error; } finally { fs.opendir = opendir; }
      assert.equal(revoked, true); assert.ok(failure); assert.equal(errorGraphIncludes(failure, source.original), true);
      const recovery = failure.managedInstallSession; assert.ok(recovery); assert.ok((await fs.stat(recovery.stage)).isDirectory());
      const coordinationRoot = path.join(home, 'state', 'storage-access');
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      await assert.rejects(recovery.releaseAfterSettlement({ resourceId: recovery.resourceId, settled: true, pending: false }));
      source.state.released = true; assert.equal(await recovery.releaseAfterSettlement({ resourceId: recovery.resourceId, settled: true, pending: false }), true);
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
      assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'pyright' })).receipt.installId, previous.installId); return;
    }
    const [, family, scenario] = /^(.*?)-(prior-probe-revocation|positive|refusal)$/.exec(mode) || [];
    const refused = scenario === 'refusal', sources = [];
    let verify, descriptor, command, inputEnv = { ...process.env };
    if (family === 'pyright') { verify = verifyManagedPyright; descriptor = resolveManagedPyrightRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor; }
    else if (family === 'native-typescript') { verify = verifyManagedTypeScriptNative; descriptor = resolveManagedTypeScriptNativeRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor; }
    else if (family === 'csharp') {
      verify = verifyManagedCsharpLs; descriptor = resolveManagedCsharpLsRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor;
      const bin = path.join(temporary, 'host'); await fs.mkdir(bin); const host = path.join(bin, process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet');
      await fs.writeFile(host, 'explicit inert host, only the injected probe is executed', { mode: 0o755 });
      const selected = normalizeEnvPathKeys(inputEnv); inputEnv[selected.key] = bin;
    } else if (family === 'dotnet') { verify = verifyManagedDotnetSdk; descriptor = resolveManagedDotnetSdkRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor; }
    else if (family === 'ast-grep') { verify = verifyManagedAstGrep; descriptor = resolveAstGrepManagedRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor; }
    else if (family === 'api7-sdk' || family === 'api7-native') {
      verify = family === 'api7-sdk' ? verifyManagedTypeScriptApi7Sdk : verifyManagedTypeScriptApi7Native;
      descriptor = resolveManagedTypeScriptApi7Recipes({ platform: 'win32', arch: 'x64' })[family.slice(5)].managedDescriptor;
      if (process.platform !== 'win32' || process.arch !== 'x64') {
        let called = false;
        await assert.rejects(verify({ root, command: path.join(root, descriptor.command), descriptor, toolingRoot, resourceId }, { probe: async () => { called = true; } }));
        assert.equal(called, false, 'unsupported host cannot activate this exact target'); return;
      }
    } else assert.fail('Unknown independently bounded verification case: ' + mode);
    command = path.join(root, descriptor.command); await fs.mkdir(path.dirname(command), { recursive: true }); await fs.writeFile(command, 'explicit inert selected command');
    const probe = async (_command, args) => {
      let stdout;
      if (family === 'pyright') stdout = 'pyright ' + descriptor.version;
      else if (family === 'native-typescript' || family === 'api7-native') stdout = 'Version ' + descriptor.version;
      else if (family === 'api7-sdk') stdout = JSON.stringify({ name: 'typescript', version: TYPESCRIPT_API7_VERSION, api: 'function', close: 'function', fileSystem: 'function' });
      else if (family === 'csharp') stdout = `csharp-ls, ${descriptor.version} fixture`;
      else if (family === 'ast-grep') stdout = args[0] === '--version' ? 'ast-grep ' + AST_GREP_VERSION : JSON.stringify([{ text: 'console.log("pairofcleats-managed-probe")' }]);
      else if (args[0] === '--list-sdks') stdout = `${DOTNET_SDK_VERSION} [${path.join(root, 'sdk')}]`;
      else if (args[0] === '--list-runtimes') stdout = `Microsoft.NETCore.App ${DOTNET_RUNTIME_VERSION} [${path.join(root, 'shared/Microsoft.NETCore.App')}]`;
      else stdout = 'Host:\n Architecture: x64\n RID: win-x64\n';
      if (scenario === 'prior-probe-revocation' && sources.length === 1) sources[0].state.released = false;
      const source = own({ ok: true, stdout: refused ? 'unrelated executable output' : stdout, stderr: '' }); sources.push(source); return source.original;
    };
    const input = { root, command, descriptor, toolingRoot, resourceId, env: inputEnv };
    if (scenario === 'prior-probe-revocation') {
      let failure; try { await verify(input, { probe }); } catch (error) { failure = error; }
      assert.ok(failure); assert.equal(sources.length, 2, 'revoked earlier probe prevents subsequent host probes or success');
      assert.equal(errorGraphIncludes(failure, sources[0].original), true); assert.equal(errorGraphIncludes(failure, sources[1].original), true);
      assert.equal(failure.cacheOwnershipReleased(), false); sources[0].state.released = true; assert.equal(failure.cacheOwnershipReleased(), true);
    } else {
      const report = await verify(input, { probe }); assert.equal(report.ok, !refused);
      assert.equal(sources.length, !refused && family === 'dotnet' ? 3 : !refused && family === 'ast-grep' ? 2 : 1);
      checkRetained(report, sources.map(value => value.original), sources.map(value => value.state));
    }
  });
} finally {
  fs.opendir = opendir; for (const state of guarded) state.released = true;
  assertNoSymlinkPath(scope, temporary); assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope));
  await fs.rm(temporary, { recursive: true, force: false });
}
console.log('Original child and multi-probe observations remain binding through verifier reports and actual publication recovery.');

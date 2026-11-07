import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveManagedPyrightRecipe, verifyManagedPyright } from '../../../tools/tooling/managed-pyright.js';
import { PYRIGHT_MANAGED_VERSION, resolveManagedNodePackageLaunch } from '../../../src/shared/managed-node-package.js';
import { resolveToolingRuntimeLaunch } from '../../../src/index/tooling/runtime-launch.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { resolveManagedToolInstallation } from '../../../src/shared/managed-installation.js';
import { resolveDeclaredInstallAdmission } from '../../../tools/tooling/install-allocation-contract.js';
import { getToolingRegistry, detectTool } from '../../../tools/tooling/utils.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';
import { resolveToolingCommandSelection, probeLspInitializeHandshake } from '../../../src/index/tooling/command-resolver.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { spawnResolvedSubprocess } from '../../../src/shared/subprocess/command-invocation.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { writeRuntimeCommandFixture } from '../../helpers/runtime-command-fixture.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-pyright-package/')[1];
const scope = path.resolve('.tmp/tasks/managed-pyright-fixture'); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fs.writeFile(path.join(temporary, '.owned-fixture'), marker);
const home = path.join(temporary, 'home'), toolingRoot = path.join(home, 'tooling'), project = path.join(temporary, 'project'); await fs.mkdir(project);
const canonical = resolveManagedPyrightRecipe({ platform: 'win32', arch: 'x64' });
const input = { root: path.join(temporary, 'verification'), command: path.join(temporary, 'verification/langserver.index.js'),
  descriptor: canonical.managedDescriptor, toolingRoot, resourceId: 'managed-pyright-verification-fixture' };
let primaryFailure = null;
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([project]) }), async () => {
    if (mode === 'canonical-windows-bundle-bound') {
      assert.equal(canonical.managedDescriptor.version, '1.1.414'); assert.equal(canonical.managedDescriptor.archive.bytes, 4226827);
      assert.equal(canonical.managedDescriptor.archive.sha512,
        '14f6596f9d637a90d7e1e3fb4c460378d16d984dd683092411c269bc7dff426512b23d04032dcb5eefb10784ff1560de8edb179427c5affadb5858f0bb0b97c3');
      assert.equal(canonical.managedDescriptor.root, 'package'); assert.equal(canonical.managedDescriptor.command, 'langserver.index.js');
      assert.ok(canonical.managedDescriptor.requiredFiles.includes('dist/typeshed-fallback/stdlib/builtins.pyi'));
      assert.equal(resolveDeclaredInstallAdmission(canonical).state, 'estimate-declared');
      assert.equal(canonical.storageEstimate.writes[0].requiredBytes, 1024 * 1024 * 1024 + 4226827 + 32 * 1024 * 1024);
      for (const platform of ['linux', 'darwin']) assert.equal(resolveManagedPyrightRecipe({ platform, arch: 'x64' }), null);
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'pyright');
      assert.equal(resolveDeclaredInstallAdmission(tool.install.cache).state, process.platform === 'win32' ? 'estimate-declared' : 'deferred-unknown-allocation');
      assert.equal(tool.prerequisites.find(row => row.id === 'node').command, process.execPath);
      assert.equal(tool.install.user.cmd, 'npm', 'explicit user package scope retains its existing selected owner');
      return;
    }
    if (mode === 'external-default-without-managed-selection') {
      const binDir = path.join(project, 'node_modules/.bin');
      const command = await writeRuntimeCommandFixture({ binDir, name: 'pyright-langserver' });
      const stub = new URL('../../fixtures/lsp/stub-lsp-server.js', import.meta.url).href;
      await fs.writeFile(path.join(binDir, 'pyright-langserver.fixture.js'), 'import(' + JSON.stringify(stub) + ');\n');
      const selection = resolveToolingCommandSelection({ providerId: 'pyright', cmd: 'pyright-langserver', args: ['--stdio'],
        repoRoot: project, toolingConfig: { dir: toolingRoot } });
      assert.equal(selection.resolved.cmd, command); assert.equal(selection.resolved.mode, 'direct');
      const handshake = await probeLspInitializeHandshake({ providerId: 'pyright', cmd: 'pyright-langserver', args: ['--stdio'],
        cwd: project, toolingConfig: { dir: toolingRoot }, timeoutMs: 4000 });
      assert.equal(handshake.ok, true, JSON.stringify(handshake));
      assert.equal(resolveManagedToolInstallation(toolingRoot, 'pyright'), null);
      return;
    }
    if (mode === 'verification-observation-and-cancellation') {
      let calls = 0;
      const controller = new AbortController(); controller.abort(null);
      await assert.rejects(verifyManagedPyright({ ...input, signal: controller.signal }, { probe: async () => { calls++; } }),
        error => error.name === 'AbortError' && error.cause === null && error.settlement.settled === true);
      assert.equal(calls, 0);
      const good = await verifyManagedPyright(input, { probe: async (command, args) => {
        assert.equal(command, process.execPath); assert.deepEqual(args, [path.join(input.root, 'index.js'), '--version']);
        return { ok: true, stdout: 'pyright ' + PYRIGHT_MANAGED_VERSION + '\n' };
      } });
      assert.equal(good.ok, true); assert.equal(good.level, 'pinned-node-entry-and-cli-version');
      assert.equal((await verifyManagedPyright(input, { probe: async () => ({ ok: true, stdout: 'unrelated executable' }) })).ok, false);
      let ready = true, stdoutReads = 0;
      const result = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, result); return ready; },
        get ok() { ready = false; return true; }, get stdout() { stdoutReads++; ready = true; return 'pyright ' + PYRIGHT_MANAGED_VERSION; } });
      await assert.rejects(verifyManagedPyright(input, { probe: async () => result }), error => error.cacheOwnershipPending === true);
      assert.equal(stdoutReads, 0, 'a later display field cannot erase the original pending interval'); ready = true;
      return;
    }
    // Explicit inert archive fixture exercises the real storage/publication,
    // Node child and LSP framing owners. It is not vendor Pyright qualification.
    const body = Buffer.from('explicit pinned prebuilt-node-package fixture'), counters = { download: 0, extract: 0 };
    const descriptor = { ...canonical.managedDescriptor, platform: process.platform, arch: process.arch,
      archive: { ...canonical.managedDescriptor.archive, url: 'https://fixture.invalid/pyright-1.1.414.tgz', bytes: body.length,
        sha512: createHash('sha512').update(body).digest('hex') },
      storageEstimate: { complete: true, basis: 'bounded-archive-owner-v1', writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } };
    const stub = new URL('../../fixtures/lsp/stub-lsp-server.js', import.meta.url).href;
    const dependencies = { approvedOrigins: ['https://fixture.invalid'], verify: verifyManagedPyright,
      download: async ({ url }) => { counters.download++; return { body, sourceUrl: url }; },
      extract: async (_archive, target) => {
        counters.extract++; const root = path.join(target, 'package');
        for (const name of descriptor.requiredFiles) {
          const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true });
          const code = name === 'index.js' ? 'console.log("pyright ' + PYRIGHT_MANAGED_VERSION + '");\n'
            : name === 'langserver.index.js' ? 'if (process.argv.some(arg => ["--help", "--version"].includes(arg))) { console.log("explicit fixture transport"); } else { import(' + JSON.stringify(stub) + '); }\n'
              : name === 'package.json' ? '{"name":"explicit-inert-pyright-fixture","type":"commonjs"}\n' : 'explicit inert fixture\n';
          await fs.writeFile(file, code);
        }
      } };
    const installed = await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies });
    assert.equal(installed.ok, true); assert.equal(counters.download, 1); assert.equal(counters.extract, 1);
    const selected = resolveManagedToolInstallation(toolingRoot, 'pyright'); assert.ok(selected);
    const launchInput = { command: selected.command, args: ['--stdio'], providerId: 'pyright', toolingRoot };
    if (mode === 'managed-publication-and-reuse') {
      const reused = await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies });
      assert.equal(reused.reused, true); assert.equal(reused.installId, installed.installId); assert.equal(counters.download, 1); assert.equal(counters.extract, 1);
      assert.equal(reused.receipt.source.sha512, descriptor.archive.sha512);
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'pyright');
      assert.equal(tool.detect.cmd, selected.command); assert.equal(tool.managedInstallation.installId, installed.installId);
    } else if (mode === 'runtime-selection-and-stale-entry') {
      const launch = resolveManagedNodePackageLaunch(launchInput);
      assert.equal(launch.command, process.execPath); assert.deepEqual(launch.args, [selected.command, '--stdio']);
      assert.equal(launch.managedRuntimeCommands[0].installId, installed.installId);
      assert.deepEqual(resolveToolingRuntimeLaunch(launchInput), launch);
      assert.deepEqual(resolveManagedNodePackageLaunch({ ...launchInput, command: process.execPath, args: launch.args }), launch, 'already framed launch is not double-prefixed');
      const external = { ...launchInput, command: path.join(temporary, 'external-pyright.cmd') };
      assert.equal(resolveManagedNodePackageLaunch(external).command, external.command);
      assert.throws(() => resolveManagedNodePackageLaunch({ ...launchInput, command: path.join(selected.owner, 'generations', '0'.repeat(64), 'langserver.index.js') }), /selected physical generation/);
      assert.throws(() => resolveManagedNodePackageLaunch({ ...launchInput, command: path.join(temporary, 'node.exe'), args: launch.args }), /different Node runtime/);
      assert.throws(() => resolveManagedNodePackageLaunch({ ...launchInput, command: path.join(temporary, 'another-host.exe'), args: launch.args }), /different Node runtime/);
      assert.throws(() => resolveManagedNodePackageLaunch({ ...launchInput, command: process.execPath, args: ['--inspect=0', ...launch.args] }), /first Node argument/);
      assert.throws(() => resolveManagedNodePackageLaunch({ ...launchInput, command: process.execPath, args: [path.join(project, 'external.js'), ...launch.args] }), /first Node argument/);
      const profile = resolveToolingCommandSelection({ providerId: 'pyright', cmd: selected.command, args: ['--stdio'], repoRoot: project, toolingConfig: { dir: toolingRoot } });
      assert.equal(profile.resolved.cmd, process.execPath); assert.deepEqual(profile.resolved.args, launch.args); assert.equal(profile.probe.ok, null);
      const selector = path.join(selected.owner, 'current.json'), selectorBytes = await fs.readFile(selector);
      const ambient = path.join(project, 'node_modules/.bin', process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver');
      await fs.mkdir(path.dirname(ambient), { recursive: true }); await fs.writeFile(ambient, 'explicit external command; never executed', { mode: 0o755 });
      await fs.writeFile(selector, '{}');
      try {
        const blocked = resolveToolingCommandSelection({ providerId: 'pyright', cmd: 'pyright-langserver', args: ['--stdio'], repoRoot: project, toolingConfig: { dir: toolingRoot } });
        assert.equal(blocked.resolved.mode, 'blocked'); assert.equal(blocked.resolved.reason, 'ERR_TOOLING_NODE_RUNTIME_UNAVAILABLE');
        const bare = { id: 'pyright', toolingRoot, detect: { cmd: 'pyright-langserver', args: ['--help'], binDirs: [path.dirname(ambient)] } };
        await assert.rejects(detectToolOwned(bare), /missing or changed/); assert.throws(() => detectTool(bare), /missing or changed/);
        const explicit = resolveToolingCommandSelection({ providerId: 'pyright', cmd: ambient, args: [], repoRoot: project, toolingConfig: { dir: toolingRoot } });
        assert.equal(explicit.resolved.cmd, ambient); assert.equal(explicit.resolved.mode, 'direct', 'an explicit external selection keeps its own authority');
      } finally { await fs.writeFile(selector, selectorBytes); }
    } else if (mode === 'owned-probe-and-generation-lease') {
      let spawned = 0;
      const coordinationRoot = path.join(home, 'state', 'storage-access');
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'pyright');
      const detected = await detectToolOwned(tool, {}, { spawn: async (command, args, options) => {
        spawned++; assert.equal(command, process.execPath); assert.equal(args[0], selected.command);
        assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, true);
        return spawnResolvedSubprocess(command, args, options);
      } });
      assert.equal(detected.probe.ok, true); assert.ok(spawned > 0);
      assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, false);
      assert.equal(detectTool(tool).probe.ok, true, 'the sync compatibility probe uses the same Node/script closure and original raw child settlement');
      const handshake = await probeLspInitializeHandshake({ providerId: 'pyright', cmd: selected.command, args: ['--stdio'], cwd: project,
        toolingConfig: { dir: toolingRoot }, timeoutMs: 4000 });
      assert.equal(handshake.ok, true, JSON.stringify(handshake));
      assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, false);
    } else if (mode === 'strict-digest-and-previous-generation') {
      const before = counters.extract;
      await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: { ...descriptor, version: '1.1.415',
        archive: { ...descriptor.archive, sha512: '0'.repeat(128) } }, ...dependencies }), /immutable digest mismatch/);
      assert.equal(counters.extract, before); assert.equal(resolveManagedToolInstallation(toolingRoot, 'pyright').installId, installed.installId);
      const bytes = await fs.readFile(selected.command); await fs.writeFile(selected.command, 'changed unqualified entry');
      try { assert.throws(() => resolveManagedNodePackageLaunch(launchInput), /missing or changed/); }
      finally { await fs.writeFile(selected.command, bytes); }
      const vendor = path.join(selected.root, 'dist/vendor.js'), vendorBytes = await fs.readFile(vendor);
      await fs.writeFile(vendor, 'changed package dependency'); let launches = 0;
      try {
        const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'pyright');
        await assert.rejects(detectToolOwned(tool, {}, { spawn: async () => { launches++; assert.fail('Changed dependency cannot reach a child'); } }), /unavailable|repair-required/);
        assert.equal(launches, 0, 'the whole generation is checked before Node admission, not only the entry script');
      } finally { await fs.writeFile(vendor, vendorBytes); }
    } else throw new Error('Unknown managed Pyright case: ' + mode);
  });
} catch (error) { primaryFailure = error; throw error; }
finally {
  const access = await inspectStorageAccess(toolingRoot, { coordinationRoot: path.join(home, 'state', 'storage-access') });
  if (access.protected) {
    const pending = new Error('Original managed fixture resources remain protected; preserve the fixture for explicit recovery.');
    throw primaryFailure ? new AggregateError([primaryFailure, pending], pending.message, { cause: primaryFailure }) : pending;
  }
  assertNoSymlinkPath(path.parse(temporary).root, temporary);
  const physicalScope = await fs.realpath(scope), physicalTemporary = await fs.realpath(temporary);
  assert.equal(path.dirname(physicalTemporary), physicalScope);
  assert.equal(await fs.readFile(path.join(physicalTemporary, '.owned-fixture'), 'utf8'), marker);
  await fs.rm(physicalTemporary, { recursive: true, force: false });
}
console.log('Managed prebuilt Node package case passed: ' + mode);

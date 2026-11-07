import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveManagedCsharpLsRecipe, verifyManagedCsharpLs } from '../../../tools/tooling/csharp-ls-recipe.js';
import { CSHARP_LS_VERSION, CSHARP_LS_PACKAGE_ENTRY } from '../../../src/index/tooling/csharp-ls-profile.js';
import { resolveToolingRuntimeLaunch, managedRuntimeProbePrefix } from '../../../src/index/tooling/runtime-launch.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { resolveManagedToolInstallation } from '../../../src/shared/managed-installation.js';
import { resolveDeclaredInstallAdmission } from '../../../tools/tooling/install-allocation-contract.js';
import { getToolingRegistry, detectTool } from '../../../tools/tooling/utils.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';
import { resolveToolingCommandProfile, resolveToolingCommandSelection, probeLspInitializeHandshake } from '../../../src/index/tooling/command-resolver.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { createRetainedLspClient } from '../../../src/integrations/tooling/lsp/managed-client.js';
import { pathToFileURL } from 'node:url';
import { createManagedCommandFixture } from '../../helpers/managed-command-fixture.js';
import { writeRuntimeCommandFixture } from '../../helpers/runtime-command-fixture.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { normalizeEnvPathKeys, resolveEnvPath } from '../../../src/shared/env-path.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/managed-csharp-package/')[1];
const scope = path.resolve('.tmp/tasks/managed-csharp-fixture'); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fs.writeFile(path.join(temporary, '.owned-fixture'), marker);
const home = path.join(temporary, 'home'), project = path.join(temporary, 'project'); await fs.mkdir(project);
const canonical = resolveManagedCsharpLsRecipe({ platform: 'win32', arch: 'x64' });
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([project]) }), async () => {
    if (mode === 'canonical-prebuilt-closure') {
      assert.equal(canonical.managedDescriptor.version, '0.28.0');
      assert.equal(canonical.managedDescriptor.command, CSHARP_LS_PACKAGE_ENTRY);
      assert.equal(canonical.managedDescriptor.archive.bytes, 21643814);
      assert.equal(canonical.managedDescriptor.archive.sha512,
        'a138b9c8f9de9dd6343e9b0d0c8f4d51637bba7e38606b7c2b08b1d91e8eefa39f12123057f6625f425812b4361e52841bd2856704ec127ff50144ce05170a99');
      assert.equal(resolveDeclaredInstallAdmission(canonical).state, 'estimate-declared');
      assert.equal(canonical.storageEstimate.writes[0].requiredBytes, 1024 * 1024 * 1024 + 21643814 + 32 * 1024 * 1024);
      assert.ok(canonical.managedDescriptor.requiredFiles.some(file => file.includes('BuildHost-netcore/')));
      for (const platform of ['linux', 'darwin']) assert.equal(resolveManagedCsharpLsRecipe({ platform, arch: 'x64' }), null);
      assert.equal(resolveManagedCsharpLsRecipe({ platform: 'win32', arch: 'ia32' }), null);
      if (process.platform === 'win32') {
        const tool = getToolingRegistry(path.join(home, 'tooling'), project).find(tool => tool.id === 'csharp-ls');
        assert.equal(resolveDeclaredInstallAdmission(tool.install.cache).state, 'estimate-declared');
        assert.ok(tool.prerequisites.some(step => step.family === 'dotnet' && step.phase === 'launch'));
        assert.equal(tool.install.cache.cmd, undefined, 'the immutable package does not invoke NuGet/build tooling');
      }
      return;
    }
    const commandName = process.platform === 'win32' ? 'dotnet.cmd' : 'dotnet';
    const shellLiteral = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    const hostScript = `import fs from 'node:fs';import {fileURLToPath} from 'node:url';
      const args=process.argv.slice(2);
      if(args[0]==='--list-sdks'){console.log('10.0.403 ['+fileURLToPath(new URL('./sdk',import.meta.url))+']');}
      else if(args[0]==='--list-runtimes'){console.log('Microsoft.NETCore.App 10.0.14 ['+fileURLToPath(new URL('./shared/Microsoft.NETCore.App',import.meta.url))+']');}
      else if(args[0]?.endsWith('CSharpLanguageServer.dll')){
        if(fs.readFileSync(args[0],'utf8')!=='explicit inert CLR fixture')throw new Error('Unqualified fixture assembly');
        if(args[1]==='--version'||args[1]==='--help'){console.log('csharp-ls, ${CSHARP_LS_VERSION} (explicit inert CLR fixture)');}
        else{process.argv.splice(2,process.argv.length-2,'--mode','csharp');await import(${JSON.stringify(new URL('../../fixtures/lsp/stub-lsp-server.js', import.meta.url).href)});}
      }else{process.exitCode=21;}
    `;
    const sdk = await createManagedCommandFixture(temporary, { toolId: 'dotnet-sdk', installId: 'c'.repeat(64), commandRelative: commandName,
      commandContent: process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "%~dp0host.mjs" %*\r\n`
        : `#!/bin/sh\nexec ${shellLiteral(process.execPath)} "$(dirname "$0")/host.mjs" "$@"\n`,
      additionalFiles: [{ path: 'host.mjs', content: hostScript }] });
    if (process.platform !== 'win32') await fs.chmod(sdk.command, 0o755);
    const toolingRoot = sdk.toolingRoot, env = { ...process.env };
    const selectedPath = normalizeEnvPathKeys(env);
    env[selectedPath.key] = sdk.root + path.delimiter + selectedPath.value;
    assert.equal(resolveEnvPath(env).split(path.delimiter)[0], sdk.root, 'the explicitly selected fixture host precedes ambient .NET hosts');
    const verificationRoot = path.join(temporary, 'verification');
    const input = { root: verificationRoot, command: path.join(verificationRoot, CSHARP_LS_PACKAGE_ENTRY), descriptor: canonical.managedDescriptor,
      toolingRoot, env, resourceId: 'csharp-verification-fixture' };
    if (mode === 'original-verification-observation') {
      let released = false, projected = 0;
      const original = { cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return released; },
        get ok() { projected++; return true; }, stdout: `csharp-ls, ${CSHARP_LS_VERSION} fixture`, stderr: '' };
      await assert.rejects(verifyManagedCsharpLs(input, { probe: async () => original }), error => {
        assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false); return true;
      });
      assert.equal(projected, 0); released = true;
      const accepted = await verifyManagedCsharpLs(input, { probe: async () => original }); assert.equal(accepted.ok, true); assert.equal(projected, 1);
      const warned = await verifyManagedCsharpLs(input, { probe: async () => ({ ok: true, stdout: `csharp-ls, ${CSHARP_LS_VERSION} fixture`, stderr: 'unexpected warning' }) });
      assert.equal(warned.ok, false);
      const controller = new AbortController(); controller.abort(); let called = 0;
      await assert.rejects(verifyManagedCsharpLs({ ...input, signal: controller.signal }, { probe: async () => { called++; } }));
      assert.equal(called, 0); return;
    }
    const body = Buffer.from('explicit inert CLR fixture archive'), counters = { download: 0, extract: 0 };
    const descriptor = { ...canonical.managedDescriptor, platform: process.platform, arch: process.arch,
      archive: { ...canonical.managedDescriptor.archive, url: 'https://fixture.invalid/csharp-ls.nupkg', bytes: body.length,
        sha512: createHash('sha512').update(body).digest('hex') },
      storageEstimate: { complete: true, basis: 'bounded-archive-owner-v1', writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } };
    const dependencies = { approvedOrigins: ['https://fixture.invalid'], env, verify: verifyManagedCsharpLs,
      download: async ({ url }) => { counters.download++; return { body, sourceUrl: url }; },
      extract: async (_archive, target) => { counters.extract++; for (const name of descriptor.requiredFiles) {
        const file = path.join(target, name); await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, name === CSHARP_LS_PACKAGE_ENTRY ? 'explicit inert CLR fixture' : 'explicit package dependency fixture');
      } } };
    const installed = await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies }); assert.equal(installed.ok, true);
    const selected = resolveManagedToolInstallation(toolingRoot, 'csharp-ls'); assert.ok(selected);
    const launchInput = { command: selected.command, args: [], providerId: 'csharp-ls', toolingRoot, baseEnv: env };
    if (mode === 'managed-publication-and-reuse') {
      const reused = await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies });
      assert.equal(reused.reused, true); assert.equal(reused.installId, installed.installId);
      assert.equal(counters.download, 1); assert.equal(counters.extract, 1);
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'csharp-ls');
      assert.equal(tool.detect.cmd, selected.command); assert.equal(tool.managedInstallation.installId, installed.installId);
    } else if (mode === 'runtime-host-and-assembly-identity') {
      const launch = resolveToolingRuntimeLaunch(launchInput);
      assert.equal(launch.command, sdk.command); assert.deepEqual(launch.args, [selected.command]);
      assert.deepEqual(launch.managedRuntimeCommands.map(entry => entry.toolId), ['csharp-ls', 'dotnet-sdk']);
      assert.deepEqual(managedRuntimeProbePrefix({ ...launch, args: [...launch.args, '--solution', 'project.sln'] }), [selected.command]);
      assert.deepEqual(resolveToolingRuntimeLaunch({ ...launchInput, command: 'csharp-ls' }), launch);
      assert.deepEqual(resolveToolingRuntimeLaunch({ ...launchInput, command: launch.command, args: launch.args }), launch, 'host framing is not duplicated');
      const alias = { ...launchInput, command: path.join(path.dirname(selected.command), 'replacement.dll') };
      assert.throws(() => resolveToolingRuntimeLaunch({ ...alias, command: sdk.command, args: [alias.command] }), /missing|unreadable/);
      const selector = path.join(selected.owner, 'current.json'), saved = await fs.readFile(selector);
      await fs.writeFile(selector, '{}');
      try { assert.throws(() => resolveToolingRuntimeLaunch({ ...launchInput, command: 'csharp-ls' }), /missing or changed/); }
      finally { await fs.writeFile(selector, saved); }
    } else if (mode === 'external-host-does-not-adopt-managed-sdk') {
      const external = await writeRuntimeCommandFixture({ binDir: path.join(temporary, 'external'), name: 'dotnet', stdout: 'explicit external SDK' });
      const selector = path.join(sdk.owner, 'current.json'), saved = await fs.readFile(selector); await fs.writeFile(selector, '{}');
      try {
        const launch = resolveToolingRuntimeLaunch({ ...launchInput, command: external, args: [selected.command] });
        assert.equal(launch.command, external); assert.deepEqual(launch.args, [selected.command]);
        assert.deepEqual(launch.managedRuntimeCommands.map(entry => entry.toolId), ['csharp-ls']);
        assert.throws(() => resolveToolingRuntimeLaunch({ ...launchInput, command: 'csharp-ls' }), /requires an intact/);
      } finally { await fs.writeFile(selector, saved); }
    } else if (mode === 'sync-probe-and-workspace-trust') {
      const profile = resolveToolingCommandProfile({ providerId: 'csharp-ls', cmd: 'csharp-ls', args: [], repoRoot: project, toolingConfig: { dir: toolingRoot } });
      assert.equal(profile.probe.ok, true, JSON.stringify(profile.probe));
      assert.deepEqual(profile.resolved.args, [selected.command]);
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'csharp-ls');
      assert.equal(detectTool(tool).probe.ok, true);
      await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
        const denied = resolveToolingCommandSelection({ providerId: 'csharp-ls', cmd: 'csharp-ls', args: [], repoRoot: project, toolingConfig: { dir: toolingRoot } });
        assert.equal(denied.resolved.mode, 'blocked'); assert.match(denied.resolved.reason, /workspace_trust_required/);
      });
    } else if (mode === 'external-host-requires-own-command-trust') {
      const hostileDir = path.join(project, 'hostile-host');
      await writeRuntimeCommandFixture({ binDir: hostileDir, name: 'dotnet' });
      const witness = path.join(temporary, 'untrusted-host-executed');
      await fs.writeFile(path.join(hostileDir, 'dotnet.fixture.js'), `require('node:fs').writeFileSync(${JSON.stringify(witness)},'unexpected');console.log('csharp-ls, ${CSHARP_LS_VERSION} fixture');`);
      const selector = path.join(sdk.owner, 'current.json'), parked = selector + '.parked'; await fs.rename(selector, parked);
      try {
        await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]', PATH: hostileDir }, async () => {
          const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'csharp-ls');
          const result = detectTool(tool);
          assert.equal(result.probe.ok, false); assert.equal(result.probe.outcome, 'untrusted-repository-command');
          await assert.rejects(fs.access(witness), { code: 'ENOENT' });
        });
      } finally { await fs.rename(parked, selector); }
    } else if (mode === 'framed-initialize-and-original-generation-lease') {
      const coordinationRoot = path.join(home, 'state', 'storage-access');
      const handshake = await probeLspInitializeHandshake({ providerId: 'csharp-ls', cmd: selected.command, args: [], cwd: project,
        toolingConfig: { dir: toolingRoot }, timeoutMs: 4000 });
      assert.equal(handshake.ok, true, JSON.stringify(handshake));
      assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, false);
      assert.equal((await inspectStorageAccess(sdk.owner, { coordinationRoot })).protected, false);
      const launch = resolveToolingRuntimeLaunch(launchInput);
      const client = await createRetainedLspClient({ cmd: launch.command, args: launch.args, env: launch.environment,
        toolingRoot, managedRuntimeCommands: launch.managedRuntimeCommands, cwd: project });
      try {
        await client.initialize({ rootUri: pathToFileURL(project).href, capabilities: {}, timeoutMs: 4000 });
        assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, true);
        assert.equal((await inspectStorageAccess(sdk.owner, { coordinationRoot })).protected, true);
      } finally { await client.shutdownAndExit(); assert.equal(await client.releaseManagedInstallation(), true); }
      assert.equal((await inspectStorageAccess(selected.owner, { coordinationRoot })).protected, false);
      assert.equal((await inspectStorageAccess(sdk.owner, { coordinationRoot })).protected, false);
      // Async detection retains the same original server/SDK closure. Transport
      // children below are real fixture processes, not a native CLR assertion.
      const tool = getToolingRegistry(toolingRoot, project).find(tool => tool.id === 'csharp-ls');
      const detected = await detectToolOwned(tool, { env }); assert.equal(detected.probe.ok, true, JSON.stringify(detected.probe));
    } else throw new Error(`Unknown managed C# case: ${mode}`);
  });
} finally {
  assert.equal(isPathWithinRoot(temporary, scope), true); assertNoSymlinkPath(scope, temporary);
  assert.equal(await fs.readFile(path.join(temporary, '.owned-fixture'), 'utf8'), marker);
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log(`managed C# package passed: ${mode}`);

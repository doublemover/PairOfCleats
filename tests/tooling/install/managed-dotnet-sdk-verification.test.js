#!/usr/bin/env node
// UNRUN source regression. The Windows contract is simulated through explicitly
// selected inert commands and trusted probe adapters; no SDK binary is fetched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { DOTNET_RUNTIME_VERSION, DOTNET_SDK_VERSION, resolveManagedDotnetSdkRecipe, verifyManagedDotnetSdk } from '../../../tools/tooling/managed-dotnet-sdk.js';
import { validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('poc-dotnet-sdk-native-contract-');
try {
  for (const arch of ['x64', 'ia32', 'arm64']) {
    const recipe = resolveManagedDotnetSdkRecipe({ platform: 'win32', arch });
    const descriptor = validatePinnedInstallDescriptor(recipe.managedDescriptor, { ...recipe, platform: 'win32', arch });
    assert.equal(descriptor.version, DOTNET_SDK_VERSION); assert.match(descriptor.archive.sha512, /^[a-f0-9]{128}$/);
    assert.equal(Object.hasOwn(descriptor.archive, 'sha256'), false);
    assert.equal(new URL(descriptor.archive.url).origin, 'https://dotnetcli.blob.core.windows.net');
    assert.ok(descriptor.archive.bytes > 256 * 1024 * 1024 && descriptor.archive.bytes < 1024 * 1024 * 1024);
    assert.ok(descriptor.requiredFiles.includes(`sdk/${DOTNET_SDK_VERSION}/Roslyn/bincore/csc.dll`));
    assert.ok(descriptor.requiredFiles.includes(`shared/Microsoft.NETCore.App/${DOTNET_RUNTIME_VERSION}/coreclr.dll`));
  }
  for (const [platform, arch] of [['win32', 'arm'], ['linux', 'x64'], ['darwin', 'arm64']]) {
    assert.equal(resolveManagedDotnetSdkRecipe({ platform, arch }), null, 'unsupported targets never substitute a package manager');
  }
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tooling'), root = path.join(temporary, 'explicit-sdk');
  await fs.mkdir(root); const command = path.join(root, 'dotnet.exe'); await fs.writeFile(command, 'inert explicitly selected native host fixture');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, TMP: null, TEMP: null, TMPDIR: null }, async () => {
    const descriptor = resolveManagedDotnetSdkRecipe({ platform: 'win32', arch: 'x64' }).managedDescriptor;
    let variant = 'valid', calls = 0;
    const input = { root, command, toolingRoot, descriptor, resourceId: 'explicit-dotnet-fixture',
      env: { ...process.env, DOTNET_ROOT_X64: 'ambient-override', DOTNET_HOST_PATH: 'ambient-host', MSBuildSDKsPath: 'ambient-sdk' } };
    const probe = async (selected, args, options) => {
      calls++; assert.equal(selected, command, 'only the explicitly selected inert fixture command reaches the probe adapter');
      assert.equal(options.env.DOTNET_ROOT, root); assert.equal(options.env.DOTNET_ROOT_X64, root);
      assert.equal(options.env.DOTNET_HOST_PATH, command); assert.equal(options.env.MSBuildSDKsPath, undefined);
      assert.equal(options.env.DOTNET_MULTILEVEL_LOOKUP, '0');
      const coordinationRoot = path.join(home, 'state', 'storage-access');
      assert.equal((await inspectStorageAccess(options.env.TMP, { coordinationRoot })).protected, true);
      assert.ok(path.resolve(options.env.DOTNET_CLI_HOME).startsWith(path.resolve(home) + path.sep));
      if (args[0] === '--list-sdks') return { ok: true, stdout: `${variant === 'old-sdk' ? '9.0.305' : DOTNET_SDK_VERSION} [${path.join(variant === 'foreign-sdk-root' ? temporary : root, 'sdk')}]\n` };
      if (args[0] === '--list-runtimes') return { ok: true, stdout: `${variant === 'missing-core-runtime' ? 'Microsoft.AspNetCore.App' : 'Microsoft.NETCore.App'} ${DOTNET_RUNTIME_VERSION} [${path.join(root, 'shared', 'Microsoft.NETCore.App')}]\n` };
      assert.deepEqual(args, ['--info']);
      return { ok: variant !== 'host-dependency-failed', stdout: `Host:\n  Architecture: ${variant === 'wrong-architecture' ? 'arm64' : 'x64'}\n  RID: ${variant === 'wrong-rid' ? 'linux-x64' : 'win-x64'}\n` };
    };
    const verified = await verifyManagedDotnetSdk(input, { probe });
    assert.equal(verified.ok, true); assert.equal(calls, 3); assert.equal(verified.consumerQualified, false);
    assert.equal(verified.level, 'pinned-dotnet-sdk-runtime-and-native-host');
    for (variant of ['old-sdk', 'foreign-sdk-root', 'missing-core-runtime', 'wrong-architecture', 'wrong-rid', 'host-dependency-failed']) {
      assert.equal((await verifyManagedDotnetSdk(input, { probe })).ok, false, variant);
    }
    await assert.rejects(verifyManagedDotnetSdk({ ...input, command: path.join(root, 'other-host.exe') }, { probe }), /exact launch-selected roots/);
    await assert.rejects(verifyManagedDotnetSdk({ ...input, descriptor: { ...descriptor, arch: 'arm' } }, { probe }), /exact launch-selected roots/);
  });
} finally { await rmDirRecursive(temporary); }
console.log('Pinned portable Windows SDK recipes verify exact packs, host target and actual managed child storage without claiming language readiness.');

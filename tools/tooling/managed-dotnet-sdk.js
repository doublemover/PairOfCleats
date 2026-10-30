import path from 'node:path';
import { identifyProvisioningExecutable, probeProvisioningCommand } from './provisioning-plan.js';
import { verifyInstallerRequirementProbe } from './install-requirements.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { bindManagedDotnetEnvironment } from './dotnet-environment.js';

// Official release metadata + Azure Blob HEAD lengths observed 2026-10-29.
// No archive was downloaded/executed for this source receipt.
// https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
export const DOTNET_SDK_VERSION = '10.0.403';
export const DOTNET_RUNTIME_VERSION = '10.0.14';
const WINDOWS = Object.freeze({
  x64: ['x64', 300745255, '7a114c318fa7f1d9822991b534b2814d0e78386ceda816b371f5141acefe741d87ccb606ede06cadac8f9ac5070e32b708a67bbd1619ff5e5a7858a27874ef48'],
  ia32: ['x86', 287234824, '5b5e61d1552c606868d7ce9003c8e77ec22f49d209db5beb3b2440ff99d70b9787a7c3fafba53f730f923575a4e8bc5c5ce0a56e0d3b80b5be0168745402a4fc'],
  arm64: ['arm64', 291061166, 'f78ecd8b48e24fd72ee604687b75f1bbb81505e8343f7d52e4baf9ea32372557eb30e88facaaad195bf2646fcce117fd941e49da0d5bdee1d60d63d836968429']
});

export const resolveManagedDotnetSdkRecipe = ({ platform = process.platform, arch = process.arch } = {}) => {
  const asset = platform === 'win32' ? WINDOWS[arch] : null;
  if (!asset) return null;
  const [target, bytes, sha512] = asset;
  const storageEstimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }] };
  return { managedDescriptor: { schemaVersion: 1, toolId: 'dotnet-sdk', recipeId: 'microsoft-dotnet-sdk-portable-zip',
    version: DOTNET_SDK_VERSION, platform, arch, archive: { type: 'zip', bytes, sha512,
      url: `https://dotnetcli.blob.core.windows.net/dotnet/Sdk/${DOTNET_SDK_VERSION}/dotnet-sdk-${DOTNET_SDK_VERSION}-win-${target}.zip` },
    command: 'dotnet.exe', args: [], requiredFiles: ['dotnet.exe', `host/fxr/${DOTNET_RUNTIME_VERSION}/hostfxr.dll`,
      `shared/Microsoft.NETCore.App/${DOTNET_RUNTIME_VERSION}/coreclr.dll`,
      `shared/Microsoft.NETCore.App/${DOTNET_RUNTIME_VERSION}/System.Private.CoreLib.dll`,
      `sdk/${DOTNET_SDK_VERSION}/dotnet.dll`, `sdk/${DOTNET_SDK_VERSION}/Roslyn/bincore/csc.dll`],
    storageEstimate }, storageEstimate, approvedOrigins: ['https://dotnetcli.blob.core.windows.net'] };
};

/** Native host + exact SDK/runtime packs are prerequisites, not an LSP/project
 * qualification. Every bounded no-provision probe owns its cache/scratch session.
 */
export const verifyManagedDotnetSdk = async (input, { probe = probeProvisioningCommand } = {}) => {
  const { root, command, toolingRoot, descriptor, resourceId, signal } = input;
  if (descriptor.toolId !== 'dotnet-sdk' || descriptor.version !== DOTNET_SDK_VERSION
    || !resolveManagedDotnetSdkRecipe(descriptor) || !path.isAbsolute(root || '') || !path.isAbsolute(toolingRoot || '')
    || path.resolve(command || '') !== path.join(root, 'dotnet.exe')) {
    throw new Error('Managed .NET verification requires its canonical pinned SDK and exact launch-selected roots.');
  }
  const identity = identifyProvisioningExecutable(command, { signal });
  const env = resolveNoProvisionToolingEnvironment(bindManagedDotnetEnvironment(input.env || process.env, root, command, descriptor.arch),
    { command, providerId: 'dotnet-sdk', cwd: root, toolingRoot });
  const run = args => runOperationalChildWithStorage({ id: 'dotnet-sdk', toolingRoot, repoRoot: toolingRoot, command, identity, env, cwd: root },
    ({ env: routed }) => probe(command, args, { cwd: root, env: routed, signal, timeoutMs: 4000, maxOutputBytes: 65536 }));
  const settlement = { resourceId, settled: true, pending: false };
  const normalize = value => descriptor.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const sdks = verifyInstallerRequirementProbe('dotnet', await run(['--list-sdks']), { versionRange: DOTNET_SDK_VERSION });
  if (!sdks.ok || !sdks.identity.sdks.some(sdk => sdk.version === DOTNET_SDK_VERSION && normalize(sdk.path) === normalize(path.join(root, 'sdk')))) {
    return { ok: false, level: 'pinned-dotnet-sdk-pack-rejected', settlement };
  }
  const runtimes = verifyInstallerRequirementProbe('dotnet-runtime', await run(['--list-runtimes']), {
    versionRange: DOTNET_RUNTIME_VERSION, requiredComponents: ['Microsoft.NETCore.App'] });
  if (!runtimes.ok || !runtimes.identity.runtimes.some(runtime => runtime.component === 'Microsoft.NETCore.App'
    && runtime.version === DOTNET_RUNTIME_VERSION && normalize(runtime.path) === normalize(path.join(root, 'shared', 'Microsoft.NETCore.App')))) {
    return { ok: false, level: 'pinned-dotnet-runtime-pack-rejected', settlement };
  }
  const info = await run(['--info']);
  const architecture = /^\s*Architecture:\s*(x64|x86|arm64)\s*$/mu.exec(info.stdout || '')?.[1];
  const rid = /^\s*RID:\s*(win-(?:x64|x86|arm64))\s*$/mu.exec(info.stdout || '')?.[1];
  const expected = descriptor.arch === 'ia32' ? 'x86' : descriptor.arch;
  const ok = info.ok && architecture === expected && rid === `win-${expected}`;
  return { ok, level: ok ? 'pinned-dotnet-sdk-runtime-and-native-host' : 'dotnet-host-target-rejected',
    identity: { family: 'dotnet-sdk', version: DOTNET_SDK_VERSION, runtimeVersion: DOTNET_RUNTIME_VERSION,
      platform: descriptor.platform, arch: descriptor.arch }, consumerQualified: false, settlement };
};

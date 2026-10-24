import path from 'node:path';
import { identifyProvisioningExecutable, probeProvisioningCommand } from './provisioning-plan.js';
import { verifyInstallerRequirementProbe } from './install-requirements.js';
import { runOperationalChildWithStorage } from './operational-storage.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { bindManagedDotnetEnvironment } from './dotnet-environment.js';

// Official release metadata + Azure Blob HEAD lengths observed 2026-10-23.
// No archive was downloaded/executed for this source receipt.
// https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
export const DOTNET_SDK_VERSION = '10.0.402';
export const DOTNET_RUNTIME_VERSION = '10.0.13';
const WINDOWS = Object.freeze({
  x64: ['x64', 300755826, 'ae4fd528cb7e9f6af6aaf7de36715a69f761f183744f1bb3025d19f5a92447090ec561410e46266c1d10a63781ed6f3de771760bc76c876d87daabc367b898cd'],
  ia32: ['x86', 287249583, 'ce6d67d39958e46c97bb899dae19b402a27d382df5ba58f107187d5acda9306440d911fabd218c0a3b64146f1e6b0dcd85c90377bc167d8ef1220ab52cd69196'],
  arm64: ['arm64', 291070603, 'd736fefa5c089ed5e1e854e1c07e5686e1e22638d627f6797633b92b60b1b5daddb607650be07c9f178cdbed1a944646c1a5cf3f12fb6aeef7c8cf149c9ba328']
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

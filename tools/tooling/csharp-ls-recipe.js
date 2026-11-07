import path from 'node:path';
import { CSHARP_LS_VERSION, CSHARP_LS_MANAGED_RECIPE, CSHARP_LS_PACKAGE_ENTRY } from '../../src/index/tooling/csharp-ls-profile.js';
import { probeProvisioningCommand, identifyProvisioningExecutable } from './provisioning-plan.js';
import { findBinaryOnPath } from '../../src/index/tooling/binary-utils.js';
import { resolveEnvPath } from '../../src/shared/env-path.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { createManagedVerificationObservation } from './managed-verification-observation.js';
import { throwIfAborted } from '../../src/shared/abort.js';
export { CSHARP_LS_VERSION } from '../../src/index/tooling/csharp-ls-profile.js';

// Official NuGet package and nuspec at publisher source 72671fc7fa810c158864e72485db68e8b9b25c3d,
// audited 2026-11-07. The package includes its complete prebuilt runtime assets
// and MSBuild child host; dotnet tool install/build/restore do not run here.
const ARCHIVE_BYTES = 21643814;
const SHA512 = 'a138b9c8f9de9dd6343e9b0d0c8f4d51637bba7e38606b7c2b08b1d91e8eefa39f12123057f6625f425812b4361e52841bd2856704ec127ff50144ce05170a99';
export const resolveManagedCsharpLsRecipe = ({ platform = process.platform, arch = process.arch } = {}) => {
  if (platform !== 'win32' || !['x64', 'arm64'].includes(arch)) return null;
  const storageEstimate = { complete: true, basis: 'bounded-archive-owner-v1', writes: [
    { destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + ARCHIVE_BYTES + 32 * 1024 * 1024 }
  ] };
  return { storageEstimate, approvedOrigins: ['https://api.nuget.org'], managedDescriptor: {
    schemaVersion: 1, toolId: 'csharp-ls', recipeId: CSHARP_LS_MANAGED_RECIPE, version: CSHARP_LS_VERSION, platform, arch,
    archive: { url: `https://api.nuget.org/v3-flatcontainer/csharp-ls/${CSHARP_LS_VERSION}/csharp-ls.${CSHARP_LS_VERSION}.nupkg`,
      type: 'zip', bytes: ARCHIVE_BYTES, sha512: SHA512 }, command: CSHARP_LS_PACKAGE_ENTRY, args: [], executables: [], storageEstimate,
    requiredFiles: ['csharp-ls.nuspec', 'README.md', CSHARP_LS_PACKAGE_ENTRY,
      'tools/net10.0/any/DotnetToolSettings.xml', 'tools/net10.0/any/CSharpLanguageServer.deps.json',
      'tools/net10.0/any/CSharpLanguageServer.runtimeconfig.json', 'tools/net10.0/any/Microsoft.Build.Locator.dll',
      'tools/net10.0/any/Microsoft.CodeAnalysis.CSharp.dll', 'tools/net10.0/any/Microsoft.CodeAnalysis.Workspaces.MSBuild.dll',
      'tools/net10.0/any/BuildHost-netcore/Microsoft.CodeAnalysis.Workspaces.MSBuild.BuildHost.dll',
      'tools/net10.0/any/BuildHost-netcore/Microsoft.CodeAnalysis.Workspaces.MSBuild.BuildHost.runtimeconfig.json']
  } };
};

/** Exact CLI transport/version only. SDK/MSBuild project loading and source
 * answers require their own real consumer qualification and workspace trust. */
export const verifyManagedCsharpLs = async ({ root, command, descriptor, toolingRoot, env: baseEnv = process.env,
  resourceId, signal = null }, { probe = probeProvisioningCommand } = {}) => {
  const settlement = { resourceId, settled: true, pending: false };
  const observation = createManagedVerificationObservation();
  try {
    throwIfAborted(signal);
    if (!path.isAbsolute(root || '') || !path.isAbsolute(toolingRoot || '') || command !== path.join(root, CSHARP_LS_PACKAGE_ENTRY)
      || descriptor?.recipeId !== CSHARP_LS_MANAGED_RECIPE || descriptor.version !== CSHARP_LS_VERSION) throw new TypeError('Canonical pinned C# package required.');
    // bindProvisioningCommand has already prepended the exact verified SDK
    // directory. Recheck the same host bytes around this bounded real child.
    const host = findBinaryOnPath('dotnet', resolveEnvPath(baseEnv));
    if (!host) throw new Error('The verified .NET SDK host is unavailable for C# package verification.');
    const identity = identifyProvisioningExecutable(host, { signal });
    const env = resolveNoProvisionToolingEnvironment(baseEnv, { command: host, providerId: 'csharp-ls', toolingRoot, cwd: root });
    const result = await probe(host, [command, '--version'], { cwd: root, env, signal, timeoutMs: 4000, maxOutputBytes: 65536, stdio: 'pipe' });
    observation.remember(result); observation.check(); throwIfAborted(signal);
    const actual = identifyProvisioningExecutable(host, { signal });
    observation.check();
    if (actual.path !== identity.path || actual.sha256 !== identity.sha256 || actual.size !== identity.size) throw new Error('Selected .NET host changed during C# verification.');
    const success = observation.read(result, 'ok'), stdout = observation.read(result, 'stdout'), stderr = observation.read(result, 'stderr');
    observation.check(); throwIfAborted(signal);
    const ok = success === true && typeof stdout === 'string' && stdout.trim().startsWith(`csharp-ls, ${CSHARP_LS_VERSION} `)
      && typeof stderr === 'string' && !stderr.trim();
    return observation.finish({ ok, level: ok ? 'pinned-dotnet-assembly-and-cli-version' : 'dotnet-assembly-or-cli-version-rejected',
      identity: { family: 'csharp-ls', version: descriptor.version, host: identity }, consumerQualified: false, settlement });
  } catch (error) {
    observation.remember(error);
    throw observation.failure(error, observation.isSettled() ? { settlement } : {});
  }
};

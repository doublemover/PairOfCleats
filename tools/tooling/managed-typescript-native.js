import path from 'node:path';
import { TYPESCRIPT_NATIVE_VERSION, TYPESCRIPT_NATIVE_RECIPE } from '../../src/index/tooling/typescript-native-profile.js';
import { probeProvisioningCommand } from './provisioning-plan.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { throwIfAborted } from '../../src/shared/abort.js';

// Official immutable registry archives inspected, without executing them, on
// 2026-11-07. Both platform packages contain their native executable and complete
// standard library; neither has dependencies or package lifecycle scripts.
const WINDOWS = Object.freeze({
  x64: [9776626, 'd014371e40071e528b4a9d6a46f7f7494846a46b03ba107f8e0170ef982ecaa6f126a11a4b40b0fd514ef22da71e094953340246d30c47f20100a137113302e2'],
  arm64: [8900840, '1b2975572e8eb167ac2f39aaf843f415bedbe0d89de76df602f700d9215c758ade95da4db58145a1f3e39edeb6cbd850cbb553699a7ae480898ee01045a55c21']
});
export const resolveManagedTypeScriptNativeRecipe = ({ platform = process.platform, arch = process.arch } = {}) => {
  const selected = platform === 'win32' && WINDOWS[arch];
  if (!selected) return null;
  const [bytes, sha512] = selected, packageName = 'typescript-win32-' + arch;
  const storageEstimate = { complete: true, basis: 'bounded-archive-owner-v1',
    writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }] };
  return { storageEstimate, approvedOrigins: ['https://registry.npmjs.org'], managedDescriptor: {
    schemaVersion: 1, toolId: 'typescript-native', recipeId: TYPESCRIPT_NATIVE_RECIPE,
    version: TYPESCRIPT_NATIVE_VERSION, platform, arch,
    archive: { type: 'tar.gz', bytes, sha512,
      url: `https://registry.npmjs.org/@typescript/${packageName}/-/${packageName}-${TYPESCRIPT_NATIVE_VERSION}.tgz` },
    root: 'package', command: 'lib/tsc.exe', args: [], executables: ['lib/tsc.exe'],
    requiredFiles: ['lib/tsc.exe', 'lib/lib.d.ts', 'package.json', 'LICENSE', 'NOTICE.txt'], storageEstimate
  } };
};

/** Exact native package/CLI verification. LSP and source consumer qualification
 * remain separate; no npm, compiler build or programmatic API is invoked. */
export const verifyManagedTypeScriptNative = async ({ root, command, descriptor, toolingRoot, env: baseEnv = process.env, resourceId, signal = null },
  { probe = probeProvisioningCommand } = {}) => {
  const settlement = { resourceId, settled: true, pending: false };
  if (!path.isAbsolute(root || '') || !path.isAbsolute(toolingRoot || '') || command !== path.join(root, 'lib', 'tsc.exe')
    || descriptor?.toolId !== 'typescript-native' || descriptor.recipeId !== TYPESCRIPT_NATIVE_RECIPE
    || descriptor.version !== TYPESCRIPT_NATIVE_VERSION || !resolveManagedTypeScriptNativeRecipe(descriptor)) throw Object.assign(
    new TypeError('Canonical pinned native TypeScript generation required.'), { settlement });
  try {
    throwIfAborted(signal);
    const env = resolveNoProvisionToolingEnvironment(baseEnv, { command, providerId: 'typescript-native', toolingRoot, cwd: root });
    const result = await probe(command, ['--version'], { cwd: root, env, signal, timeoutMs: 4000, maxOutputBytes: 65536 });
    const observation = observeStorageResource(result, { phase: 'managed-typescript-native-verification' });
    observation.requireSettled(); throwIfAborted(signal);
    const success = observation.read('ok'), stdout = observation.read('stdout');
    observation.requireSettled(); throwIfAborted(signal);
    const ok = success === true && typeof stdout === 'string' && stdout.trim() === 'Version ' + TYPESCRIPT_NATIVE_VERSION;
    return { ok, level: ok ? 'pinned-native-typescript-cli-version' : 'native-typescript-cli-version-rejected',
      identity: { family: 'typescript-native', version: descriptor.version }, settlement };
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'managed-typescript-native-verification' }); observation.requireSettled();
    throw addStorageFailureContext(observation.primary, { settlement });
  }
};

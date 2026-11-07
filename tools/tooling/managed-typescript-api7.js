import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPinnedManagedTool, validatePinnedInstallDescriptor } from './managed-install.js';
import { probeProvisioningCommand } from './provisioning-plan.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { createManagedVerificationObservation } from './managed-verification-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { finiteViewFields } from '../../src/index/semantic/views/finite-input.js';

export const TYPESCRIPT_API7_VERSION = '7.1.0-beta';
export const TYPESCRIPT_API7_PROFILE = 'typescript-api7-request-snapshot-v1';
const SDK = Object.freeze({ bytes: 576463,
  sha512: '7235a3640243b26673b0d0b91b01cd956d183cceb98d96b9a11d0ac907185f72925487d3bed06afffbdec084b26ad2a4e0e2e2e60ad98c7848544f5f76bc3551' });
// Official registry metadata and tarball SHA512, reviewed 2026-11-07. The SDK
// vendors its JS dependencies; only this target's separately pinned native
// package is needed when the API is connected to our explicit process owner.
const NATIVE = Object.freeze({
  x64: [10283326, '50a707bdbc9b636b434ef156d9bd6fc2202f0e5211a28a3af6587c09759584e41e8dcbe9339f8881b8855bd108c11e568b95ffbfe05d37b81d59b8a006e277af'],
  arm64: [9385247, '9496e8ef520439f2fb6592199c0ad168e2ea8e7f4101fa12cf25109f46928df4a90d92f8aeed1a7d4b1d05fa3a3d01230fab2c7668b49ff47068f0035fa6ecbd']
});
const recipe = (role, platform, arch) => {
  const native = role === 'native', [bytes, sha512] = native ? NATIVE[arch] : [SDK.bytes, SDK.sha512];
  const packageName = `typescript-win32-${arch}`, component = `typescript-api7-${role}-${TYPESCRIPT_API7_VERSION}-${platform}-${arch}`;
  const storageEstimate = { complete: true, basis: 'bounded-archive-owner-v1', writes: [
    { destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + bytes + 32 * 1024 * 1024 }
  ] };
  return { storageEstimate, approvedOrigins: ['https://registry.npmjs.org'], managedDescriptor: {
    schemaVersion: 1, toolId: component, recipeId: `typescript-api7-${role}-official-archive-v1`, version: TYPESCRIPT_API7_VERSION,
    platform, arch, archive: { type: 'tar.gz', bytes, sha512,
      url: native ? `https://registry.npmjs.org/@typescript/${packageName}/-/${packageName}-${TYPESCRIPT_API7_VERSION}.tgz`
        : `https://registry.npmjs.org/typescript/-/typescript-${TYPESCRIPT_API7_VERSION}.tgz` },
    root: 'package', command: native ? 'lib/tsc.exe' : 'dist/api/async/api.js', args: [], executables: native ? ['lib/tsc.exe'] : [], storageEstimate,
    requiredFiles: native ? ['lib/tsc.exe', 'lib/lib.d.ts', 'package.json', 'LICENSE', 'NOTICE.txt']
      : ['dist/api/async/api.js', 'dist/api/async/client.js', 'dist/api/fs.js', 'dist/ast/index.js',
        'vendor/vscode-jsonrpc/lib/node/main.js', 'package.json', 'lib/version.cjs', 'LICENSE', 'NOTICE.txt']
  } };
};
/** Version/target-qualified component owners prevent a future SDK upgrade from
 * replacing the selected files of an earlier API/native pair. Neither package
 * changes npm dependencies, .bin links or the current compiler's command. */
export const resolveManagedTypeScriptApi7Recipes = ({ platform = process.platform, arch = process.arch } = {}) =>
  platform === 'win32' && Object.hasOwn(NATIVE, arch) ? { sdk: recipe('sdk', platform, arch), native: recipe('native', platform, arch) } : null;

const SDK_PROBE = `import { readFile } from 'node:fs/promises';
const [api, fs, metadata] = await Promise.all([import(process.argv[1]), import(process.argv[2]), readFile(process.argv[3], 'utf8')]);
const pkg = JSON.parse(metadata);
console.log(JSON.stringify({ name: pkg.name, version: pkg.version, api: typeof api.API, close: typeof api.API?.prototype.close, fileSystem: typeof fs.createFileSystem }));`;
const sdkProbeIdentity = output => {
  if (typeof output !== 'string') return false;
  let data; try { data = JSON.parse(output); } catch { return false; }
  return data && Object.keys(data).sort().join(',') === 'api,close,fileSystem,name,version'
    && data.name === 'typescript' && data.version === TYPESCRIPT_API7_VERSION
    && data.api === 'function' && data.close === 'function' && data.fileSystem === 'function';
};
const verifyComponent = async (role, { root, command, descriptor, toolingRoot, env: baseEnv = process.env, resourceId, signal = null },
  { probe = probeProvisioningCommand } = {}) => {
  const settlement = { resourceId, settled: true, pending: false };
  const observation = createManagedVerificationObservation(); let result = null;
  try {
    const expected = resolveManagedTypeScriptApi7Recipes()?.[role];
    if (!expected || !path.isAbsolute(root || '') || !path.isAbsolute(toolingRoot || '') || !descriptor) throw new TypeError('An approved TypeScript7.1 component is required.');
    // The installation owner adds exactly these derived fields to its frozen
    // declaration. Unknown declaration fields still fail the shared validator.
    const { descriptorId, approvedOrigins, ...declared } = descriptor; void approvedOrigins;
    const actual = validatePinnedInstallDescriptor(declared, expected), pinned = validatePinnedInstallDescriptor(expected.managedDescriptor, expected);
    if (actual.descriptorId !== pinned.descriptorId || descriptorId && descriptorId !== pinned.descriptorId
      || command !== path.join(root, expected.managedDescriptor.command)) throw new TypeError('The exact pinned TypeScript7.1 component is required.');
    signal?.throwIfAborted();
    const executable = role === 'sdk' ? process.execPath : command;
    const env = resolveNoProvisionToolingEnvironment(baseEnv, { command: executable, providerId: TYPESCRIPT_API7_PROFILE, toolingRoot, cwd: root });
    delete env.TS_API_TIMING_DIR;
    const args = role === 'sdk' ? ['--input-type=module', '-e', SDK_PROBE, pathToFileURL(command).href,
      pathToFileURL(path.join(root, 'dist', 'api', 'fs.js')).href, path.join(root, 'package.json')] : ['--version'];
    result = await probe(executable, args,
      { cwd: root, env, signal, timeoutMs: 4000, maxOutputBytes: 65536, stdio: 'pipe' });
    observation.remember(result); observation.check(); signal?.throwIfAborted();
    const success = observation.read(result, 'ok'), stdout = observation.read(result, 'stdout');
    observation.check(); signal?.throwIfAborted();
    const ok = success === true && (role === 'sdk' ? sdkProbeIdentity(stdout) : typeof stdout === 'string' && stdout.trim() === 'Version ' + TYPESCRIPT_API7_VERSION);
    return Object.defineProperties({ ok, level: ok ? `pinned-api7-${role}-activation` : `api7-${role}-activation-rejected`,
      identity: { family: TYPESCRIPT_API7_PROFILE, role, version: TYPESCRIPT_API7_VERSION, descriptorId: pinned.descriptorId },
      runtimeQualified: false, settlement }, { cacheOwnershipPending: { value: true },
      cacheOwnershipReleased: { value: observation.isSettled }, ...(!ok ? { cause: { value: result } } : {}) });
  } catch (error) {
    observation.remember(error);
    throw addStorageFailureContext(error, observation.isSettled() ? { settlement } : {}, result,
      { secondaryPresent: result !== null, ownerMessage: 'Pinned TypeScript7.1 component activation failed; original observations are retained.' });
  }
};
export const verifyManagedTypeScriptApi7Sdk = (input, dependencies) => verifyComponent('sdk', input, dependencies);
export const verifyManagedTypeScriptApi7Native = (input, dependencies) => verifyComponent('native', input, dependencies);

/** Explicit offline preparation only. Actual API operations/disposal still
 * require the separate runtime qualification owner; these are activation probes. */
export const prepareManagedTypeScriptApi7 = async input => {
  const { toolingRoot, signal = null } = finiteViewFields(input, ['toolingRoot'], ['signal'], message => new TypeError(message));
  if (!path.isAbsolute(toolingRoot || '') || signal !== null && !(signal instanceof AbortSignal)) throw new TypeError('Explicit tooling root and original abort signal required.');
  signal?.throwIfAborted();
  const recipes = resolveManagedTypeScriptApi7Recipes();
  if (!recipes) throw Object.assign(new Error('No approved TypeScript7.1 API component recipes for this platform/architecture.'), { code: 'ERR_TYPESCRIPT_API7_PLATFORM' });
  const sdk = await installPinnedManagedTool({ toolingRoot, descriptor: recipes.sdk.managedDescriptor,
    approvedOrigins: recipes.sdk.approvedOrigins, signal, verify: verifyManagedTypeScriptApi7Sdk });
  const native = await installPinnedManagedTool({ toolingRoot, descriptor: recipes.native.managedDescriptor,
    approvedOrigins: recipes.native.approvedOrigins, signal, verify: verifyManagedTypeScriptApi7Native });
  const component = result => Object.freeze({ root: result.root, command: result.command, descriptorId: result.descriptorId, installId: result.installId });
  return Object.freeze({ profile: TYPESCRIPT_API7_PROFILE, version: TYPESCRIPT_API7_VERSION, sdk: component(sdk), native: component(native),
    activation: 'exact-sdk-exports-and-native-cli-version', runtimeQualification: 'not-established' });
};

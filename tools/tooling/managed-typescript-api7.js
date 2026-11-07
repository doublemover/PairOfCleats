import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installPinnedManagedTool, validatePinnedInstallDescriptor } from './managed-install.js';
import { probeProvisioningCommand } from './provisioning-plan.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { createManagedVerificationObservation } from './managed-verification-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { finiteViewFields } from '../../src/index/semantic/views/finite-input.js';

import { TYPESCRIPT_API7_VERSION, TYPESCRIPT_API7_PROFILE, resolveManagedTypeScriptApi7Recipes } from '../../src/shared/typescript-api7-pins.js';

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

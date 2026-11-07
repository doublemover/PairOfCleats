import path from 'node:path';
import { PYRIGHT_MANAGED_VERSION, PYRIGHT_MANAGED_RECIPE } from '../../src/shared/managed-node-package.js';
import { probeProvisioningCommand } from './provisioning-plan.js';
import { resolveNoProvisionToolingEnvironment } from '../../src/shared/toolchain-env.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { throwIfAborted } from '../../src/shared/abort.js';

// Official registry and package manifest reviewed on 2026-11-07:
// https://registry.npmjs.org/pyright/1.1.414
// Required runtime dependencies: none. Optional fsevents ~2.3.3 supports darwin
// only (https://registry.npmjs.org/fsevents/2.3.3); this recipe is Windows-only.
// The archive bundles its JS dependencies and typeshed. Its build/clean/webpack
// development scripts are never invoked; no lifecycle install hook is present.
const ARCHIVE_BYTES = 4226827;
const SHA512 = '14f6596f9d637a90d7e1e3fb4c460378d16d984dd683092411c269bc7dff426512b23d04032dcb5eefb10784ff1560de8edb179427c5affadb5858f0bb0b97c3';
export const resolveManagedPyrightRecipe = ({ platform = process.platform, arch = process.arch } = {}) => {
  if (platform !== 'win32' || !['x64', 'arm64', 'ia32'].includes(arch)) return null;
  // Inclusive bounds are enforced by the existing archive owner, not inferred
  // from the 19,457,120-byte final package. No package manager/build runs here.
  const storageEstimate = { complete: true, basis: 'bounded-archive-owner-v1',
    writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 * 1024 + ARCHIVE_BYTES + 32 * 1024 * 1024 }] };
  return { storageEstimate, approvedOrigins: ['https://registry.npmjs.org'], managedDescriptor: {
    schemaVersion: 1, toolId: 'pyright', recipeId: PYRIGHT_MANAGED_RECIPE, version: PYRIGHT_MANAGED_VERSION, platform, arch,
    archive: { url: `https://registry.npmjs.org/pyright/-/pyright-${PYRIGHT_MANAGED_VERSION}.tgz`, type: 'tar.gz', bytes: ARCHIVE_BYTES, sha512: SHA512 },
    root: 'package', command: 'langserver.index.js', args: [], executables: [], storageEstimate,
    requiredFiles: ['langserver.index.js', 'index.js', 'package.json', 'LICENSE.txt', 'dist/pyright-langserver.js',
      'dist/pyright.js', 'dist/pyright-internal.js', 'dist/vendor.js', 'dist/typeshed-fallback/stdlib/builtins.pyi']
  } };
};

/** Version/entry verification only. Real LSP initialization and source-qualified
 * consumer facts remain separate acceptance, rather than a help-string claim. */
export const verifyManagedPyright = async ({ root, command, descriptor, toolingRoot, env: baseEnv = process.env, resourceId, signal = null }, { probe = probeProvisioningCommand } = {}) => {
  const settlement = { resourceId, settled: true, pending: false };
  if (!path.isAbsolute(root || '') || !path.isAbsolute(toolingRoot || '') || command !== path.join(root, 'langserver.index.js')
    || descriptor?.recipeId !== PYRIGHT_MANAGED_RECIPE || descriptor.version !== PYRIGHT_MANAGED_VERSION) throw Object.assign(new TypeError('Canonical pinned Pyright generation required.'), { settlement });
  try {
    throwIfAborted(signal);
    const env = resolveNoProvisionToolingEnvironment(baseEnv, { command: process.execPath, providerId: 'pyright', toolingRoot, cwd: root });
    const result = await probe(process.execPath, [path.join(root, 'index.js'), '--version'], { cwd: root, env, signal,
      timeoutMs: 4000, maxOutputBytes: 65536, stdio: 'pipe' });
    const observation = observeStorageResource(result, { phase: 'managed-pyright-verification' });
    observation.requireSettled(); throwIfAborted(signal);
    const success = observation.read('ok'), stdout = observation.read('stdout');
    observation.requireSettled(); throwIfAborted(signal);
    const ok = success === true && typeof stdout === 'string' && stdout.trim() === 'pyright ' + PYRIGHT_MANAGED_VERSION;
    return { ok, level: ok ? 'pinned-node-entry-and-cli-version' : 'node-entry-or-cli-version-rejected',
      identity: { family: 'pyright', version: descriptor.version, node: process.version }, settlement };
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'managed-pyright-verification' }); observation.requireSettled();
    throw addStorageFailureContext(observation.primary, { settlement });
  }
};

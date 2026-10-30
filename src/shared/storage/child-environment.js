import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoSymlinkPath } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { readStorageLocator } from './locator-read.js';
import { applyStorageLocatorSelections } from './selected-layout.js';
import { addStorageFailureContext } from './operation-error.js';

// The producer and persisted receipt readers share this vocabulary. Evidence
// remains protected even when its path happens to be run-owned scratch.
export const MANAGED_CHILD_STORAGE_RETENTION_TIERS = Object.freeze([
  'downloadable', 'derived', 'durable', 'temporary', 'evidence'
]);

export const MANAGED_CHILD_CACHE_FAMILIES = Object.freeze(Object.fromEntries(Object.entries({
  npm: [['npm_config_cache', 'npm-downloads', 'downloadable']],
  python: [['PIP_CACHE_DIR', 'pip-downloads', 'downloadable'], ['PYTHONPYCACHEPREFIX', 'python-bytecode', 'derived']],
  graphviz: [['XDG_CACHE_HOME', 'xdg-cache', 'derived']],
  fontconfig: [['XDG_CACHE_HOME', 'xdg-cache', 'derived']],
  go: [['GOPATH', 'go-path', 'downloadable'], ['GOMODCACHE', 'go-modules', 'downloadable'], ['GOCACHE', 'go-build', 'derived'], ['GOTMPDIR', 'go-work', 'temporary']],
  dotnet: [['DOTNET_CLI_HOME', 'dotnet-state', 'durable'], ['NUGET_PACKAGES', 'nuget-packages', 'downloadable'], ['NUGET_HTTP_CACHE_PATH', 'nuget-http', 'derived']],
  ruby: [['GEM_SPEC_CACHE', 'gem-specs', 'derived'], ['BUNDLE_USER_CACHE', 'bundle-user', 'downloadable']],
  composer: [['COMPOSER_CACHE_DIR', 'composer', 'downloadable']],
  gradle: [['GRADLE_USER_HOME', 'gradle-user', 'downloadable']],
  cargo: [['CARGO_HOME', 'cargo', 'downloadable']],
  rustup: [['RUSTUP_HOME', 'rustup', 'downloadable']],
  beam: [],
  native: []
}).map(([family, routes]) => [family, Object.freeze(routes.map(route => Object.freeze(route)))])));

const COMMAND_FAMILIES = Object.freeze({ npm: 'npm', npx: 'npm', go: 'go', dotnet: 'dotnet', gem: 'ruby',
  ruby: 'ruby', composer: 'composer', gradle: 'gradle', gradlew: 'gradle', cargo: 'cargo', rustup: 'rustup',
  elixir: 'beam', erl: 'beam', mix: 'beam', py: 'python', dot: 'graphviz', neato: 'graphviz', fdp: 'graphviz',
  sfdp: 'graphviz', circo: 'graphviz', twopi: 'graphviz', osage: 'graphviz', patchwork: 'graphviz',
  'fc-cache': 'fontconfig', 'fc-list': 'fontconfig', 'fc-match': 'fontconfig', 'fc-scan': 'fontconfig',
  'fc-query': 'fontconfig', 'fc-pattern': 'fontconfig', 'fc-validate': 'fontconfig' });

/** One registry for installers and operational children. Unknown launchers do
 * not acquire a guessed write contract just because their basename contains a
 * supported tool's name. Explicit recipe families remain authoritative.
 */
export const resolveManagedChildCacheFamily = ({ command = '', family = null } = {}) => {
  if (family !== null && typeof family !== 'string') throw new TypeError('A selected managed child cache family must be a string.');
  if (family) return ['pip', 'python3'].includes(family) ? 'python' : family === 'gem' ? 'ruby' : family;
  const name = path.basename(String(command || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
  if (/^(?:pythonw?|pip)(?:[23](?:\.[0-9]+)*)?$/u.test(name)) return 'python';
  return Object.hasOwn(COMMAND_FAMILIES, name) ? COMMAND_FAMILIES[name] : null;
};

const environmentKey = (env, key, platform) => {
  if (platform !== 'win32' && !key.startsWith('npm_config_')) return key;
  const aliases = Object.keys(env).filter(candidate => candidate.toLowerCase() === key.toLowerCase()).sort();
  const values = new Set(aliases.map(candidate => String(env[candidate] ?? '')));
  if (values.size > 1) throw new Error(`Managed child storage has conflicting environment aliases for ${key}; select one explicit value.`);
  const selected = aliases.includes(key) ? key : aliases[0] || key;
  // Node's Windows spawn environment admits only one case alias. Remove equal
  // duplicates in this child clone so the receipt names the value actually used.
  for (const alias of aliases) if (alias !== selected) delete env[alias];
  return selected;
};

/** Child-local environment only. Never changes HOME, global settings, model
 * cacheDir, project lockfiles, GEM_HOME/GEM_PATH, Go SDK selection or outputs.
 */
export const planManagedChildStorage = ({ baseEnv = process.env, layout, command = '', family = null,
  managed = false, toolId, toolIdentity, projectIdentity = null, runId = randomUUID(),
  preserveEnvironmentKeys = [], platformTemp = os.tmpdir(), cwd = process.cwd() } = {}) => {
  if (!layout?.descriptors || layout.platform !== process.platform) throw new TypeError('Managed child routing requires a native-platform storage layout.');
  const env = { ...baseEnv };
  const selectedFamily = resolveManagedChildCacheFamily({ command, family });
  if (!managed) return { schemaVersion: 1, managed: false, env, locations: [], ownedRoots: [],
    exceptions: [{ kind: 'global-or-user-executable', status: 'external-shared-read-only-inventory' }] };
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new TypeError('Managed child routing requires its absolute launch working directory.');
  const childCwd = path.resolve(cwd);
  const locator = readStorageLocator(layout.home.path);
  layout = applyStorageLocatorSelections(layout, locator);
  if (typeof toolId !== 'string' || !toolId || typeof toolIdentity !== 'string' || !toolIdentity
    || !/^[a-zA-Z0-9._-]{1,120}$/u.test(runId) || ['.', '..'].includes(runId)) throw new TypeError('Managed child routing requires exact tool/profile and run identities.');
  const identity = createHash('sha256').update(JSON.stringify({ toolId, toolIdentity,
    platform: process.platform, arch: process.arch, projectIdentity })).digest('hex');
  const cache = path.join(layout.descriptors.shared.path, 'managed-children', identity);
  const state = path.join(layout.descriptors.state.path, 'managed-children', identity);
  const assets = path.join(layout.descriptors.tooling.path, 'child-assets', identity);
  const scratch = path.join(layout.descriptors.tmp.path, 'managed-children', identity, runId);
  const locations = [];
  const exceptions = [];
  const preserve = new Set(preserveEnvironmentKeys.map(key => key.toLowerCase()));
  const setLocation = (key, defaultPath, retention, { temp = false, file = false } = {}) => {
    const actualKey = environmentKey(env, key, layout.platform);
    const inherited = String(env[actualKey] ?? '');
    // Relative environment locations are interpreted by the launched child.
    // Planning them against the parent cwd would record and reserve other bytes.
    if (layout.platform === 'win32' && /^[a-zA-Z]:[^\\/]/u.test(inherited)) {
      throw new Error('Managed child storage cannot qualify a drive-relative environment override; select an absolute path.');
    }
    const inheritedPath = inherited ? path.resolve(childCwd, inherited) : null;
    const platformDefault = temp && inheritedPath && (layout.platform === 'win32'
      ? inheritedPath.toLowerCase() === path.resolve(platformTemp).toLowerCase()
      : inheritedPath === path.resolve(platformTemp));
    const explicit = inherited && (preserve.has(key.toLowerCase()) || !platformDefault);
    const selected = explicit ? inheritedPath : defaultPath;
    const external = ![cache, state, assets, scratch].some(root => isPathWithinRoot(selected, root));
    if (!explicit) env[actualKey] = selected;
    locations.push({ environmentKey: actualKey, path: selected, retention, external,
      source: explicit ? 'inherited-or-explicit-environment' : 'managed-storage-profile',
      purpose: temp ? 'run-owned-scratch' : selectedFamily, file, cleanupAuthority: false });
    if (external) exceptions.push({ environmentKey: actualKey, path: selected, kind: 'deliberate-environment-override', status: 'external-shared-read-only-inventory' });
  };
  const registered = Object.hasOwn(MANAGED_CHILD_CACHE_FAMILIES, selectedFamily);
  for (const [key, child, retention] of registered ? MANAGED_CHILD_CACHE_FAMILIES[selectedFamily] : []) {
    const base = retention === 'temporary' ? scratch : retention === 'durable' ? state : retention === 'downloadable' ? assets : cache;
    setLocation(key, path.join(base, child), retention, { temp: retention === 'temporary' });
  }
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) setLocation(key, scratch, 'temporary', { temp: true });
  if (selectedFamily === 'beam') setLocation('ERL_CRASH_DUMP', path.join(scratch, 'erl_crash.dump'), 'evidence', { file: true });
  if (!registered) {
    exceptions.push({ kind: 'unregistered-tool-specific-secondary-writes', status: 'unsupported-owner-adapter-required' });
  }
  return { schemaVersion: 1, managed: true, toolId, toolIdentity, profileIdentity: identity,
    storageLocator: { home: layout.home.path, target: locator.target, sha256: locator.sha256 },
    projectIdentity, family: selectedFamily, runId, cwd: childCwd, env, locations,
    ownedRoots: [cache, state, assets, scratch], scratch,
    exceptions, coverage: 'declared-environment-only; observed-child-write-qualification-required' };
};

/** Explicit preparation belongs to an authorized install/runtime operation;
 * planning/explain/doctor must never call it. No cleanup occurs on failure.
 */
export const prepareManagedChildStorage = async (plan, { authorizedRoots = [] } = {}) => {
  if (!plan?.managed) return { prepared: false, locations: [], exceptions: plan?.exceptions || [] };
  if (!plan.storageLocator || !path.isAbsolute(plan.storageLocator.home || '')) throw new Error('Managed storage preparation requires an active locator snapshot; re-plan this child.');
  const current = readStorageLocator(plan.storageLocator.home);
  if (current.status === 'invalid' || current.target !== plan.storageLocator.target || current.sha256 !== plan.storageLocator.sha256) {
    throw new Error('Managed child category selection changed after planning; no declared directories were prepared.');
  }
  const owned = plan.locations.filter(location => !location.external);
  for (const location of owned) {
    const target = location.file ? path.dirname(location.path) : location.path;
    const approved = authorizedRoots.find(root => isPathWithinRoot(target, path.resolve(root)));
    if (!approved) throw new Error('Managed child write location is outside launch-authorized storage.');
    assertNoSymlinkPath(path.parse(approved).root, target, { allowMissing: true });
  }
  try {
    for (const location of owned) {
      const target = location.file ? path.dirname(location.path) : location.path;
      await fs.mkdir(target, { recursive: true });
      assertNoSymlinkPath(path.parse(target).root, target);
    }
    if (owned.some(location => isPathWithinRoot(location.path, plan.scratch))) {
      const receipt = path.join(plan.scratch, '.pairofcleats-child-owner.json');
      await atomicWriteJson(receipt, { schemaVersion: 1, application: 'pairofcleats', toolId: plan.toolId,
        profileIdentity: plan.profileIdentity, runId: plan.runId, pid: process.pid,
        startedAt: new Date().toISOString(), retention: 'temporary-and-crash-evidence', cleanupAuthority: false },
      { mkdir: false, createOnly: true });
    }
  } catch (error) {
    throw addStorageFailureContext(error, { recovery: { scratch: plan.scratch, preserved: true } });
  }
  return { prepared: true, profileIdentity: plan.profileIdentity, runId: plan.runId,
    locations: plan.locations, exceptions: plan.exceptions, source: 'declared-not-observed-writes' };
};

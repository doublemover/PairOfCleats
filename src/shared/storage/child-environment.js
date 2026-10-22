import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoSymlinkPath } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { atomicWriteJson } from '../io/atomic-write.js';

export const MANAGED_CHILD_CACHE_FAMILIES = Object.freeze({
  npm: [['npm_config_cache', 'npm-downloads', 'downloadable']],
  go: [['GOPATH', 'go-path', 'downloadable'], ['GOMODCACHE', 'go-modules', 'downloadable'], ['GOCACHE', 'go-build', 'derived']],
  dotnet: [['DOTNET_CLI_HOME', 'dotnet-state', 'durable'], ['NUGET_PACKAGES', 'nuget-packages', 'downloadable'], ['NUGET_HTTP_CACHE_PATH', 'nuget-http', 'derived']],
  ruby: [['GEM_SPEC_CACHE', 'gem-specs', 'derived'], ['BUNDLE_USER_CACHE', 'bundle-user', 'downloadable']],
  composer: [['COMPOSER_CACHE_DIR', 'composer', 'downloadable']],
  gradle: [['GRADLE_USER_HOME', 'gradle-user', 'downloadable']],
  cargo: [['CARGO_HOME', 'cargo', 'downloadable']],
  rustup: [['RUSTUP_HOME', 'rustup', 'downloadable']],
  beam: [],
  native: []
});

const familyForCommand = command => ({ npm: 'npm', npx: 'npm', go: 'go', dotnet: 'dotnet', gem: 'ruby',
  ruby: 'ruby', composer: 'composer', gradle: 'gradle', gradlew: 'gradle', cargo: 'cargo', rustup: 'rustup',
  elixir: 'beam', erl: 'beam', mix: 'beam' }[path.basename(String(command || '')).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '')] || null);
const environmentKey = (env, key, platform) => platform === 'win32' || key.startsWith('npm_config_')
  ? Object.keys(env).find(candidate => candidate.toLowerCase() === key.toLowerCase()) || key : key;

/** Child-local environment only. Never changes HOME, global settings, model
 * cacheDir, project lockfiles, GEM_HOME/GEM_PATH, Go SDK selection or outputs.
 */
export const planManagedChildStorage = ({ baseEnv = process.env, layout, command = '', family = null,
  managed = false, toolId, toolIdentity, projectIdentity = null, runId = randomUUID(),
  preserveEnvironmentKeys = [], platformTemp = os.tmpdir() } = {}) => {
  if (!layout?.descriptors || layout.platform !== process.platform) throw new TypeError('Managed child routing requires a native-platform storage layout.');
  const env = { ...baseEnv };
  const selectedFamily = family || familyForCommand(command);
  if (!managed) return { schemaVersion: 1, managed: false, env, locations: [], ownedRoots: [],
    exceptions: [{ kind: 'global-or-user-executable', status: 'external-shared-read-only-inventory' }] };
  if (typeof toolId !== 'string' || !toolId || typeof toolIdentity !== 'string' || !toolIdentity
    || !/^[a-zA-Z0-9._-]{1,120}$/u.test(runId)) throw new TypeError('Managed child routing requires exact tool/profile and run identities.');
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
    const inherited = String(env[actualKey] || '').trim();
    const platformDefault = temp && inherited && path.resolve(inherited) === path.resolve(platformTemp);
    const explicit = inherited && (preserve.has(key.toLowerCase()) || !platformDefault);
    const selected = explicit ? path.resolve(inherited) : defaultPath;
    const external = ![cache, state, assets, scratch].some(root => isPathWithinRoot(selected, root));
    if (!explicit) env[actualKey] = selected;
    locations.push({ environmentKey: actualKey, path: selected, retention, external,
      source: explicit ? 'inherited-or-explicit-environment' : 'managed-storage-profile',
      purpose: temp ? 'run-owned-scratch' : selectedFamily, file, cleanupAuthority: false });
    if (external) exceptions.push({ environmentKey: actualKey, path: selected, kind: 'deliberate-environment-override', status: 'external-shared-read-only-inventory' });
  };
  for (const [key, child, retention] of MANAGED_CHILD_CACHE_FAMILIES[selectedFamily] || []) {
    const base = retention === 'durable' ? state : retention === 'downloadable' ? assets : cache;
    setLocation(key, path.join(base, child), retention);
  }
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) setLocation(key, scratch, 'temporary', { temp: true });
  if (selectedFamily === 'beam') setLocation('ERL_CRASH_DUMP', path.join(scratch, 'erl_crash.dump'), 'evidence', { file: true });
  if (!selectedFamily || !Object.hasOwn(MANAGED_CHILD_CACHE_FAMILIES, selectedFamily)) {
    exceptions.push({ kind: 'unregistered-tool-specific-secondary-writes', status: 'unsupported-owner-adapter-required' });
  }
  return { schemaVersion: 1, managed: true, toolId, toolIdentity, profileIdentity: identity,
    projectIdentity, family: selectedFamily, runId, env, locations,
    ownedRoots: [cache, state, assets, scratch], scratch,
    exceptions, coverage: 'declared-environment-only; observed-child-write-qualification-required' };
};

/** Explicit preparation belongs to an authorized install/runtime operation;
 * planning/explain/doctor must never call it. No cleanup occurs on failure.
 */
export const prepareManagedChildStorage = async (plan, { authorizedRoots = [] } = {}) => {
  if (!plan?.managed) return { prepared: false, locations: [], exceptions: plan?.exceptions || [] };
  const owned = plan.locations.filter(location => !location.external);
  for (const location of owned) {
    const target = location.file ? path.dirname(location.path) : location.path;
    const approved = authorizedRoots.find(root => isPathWithinRoot(target, path.resolve(root)));
    if (!approved) throw new Error('Managed child write location is outside launch-authorized storage.');
    assertNoSymlinkPath(path.parse(approved).root, target, { allowMissing: true });
  }
  for (const location of owned) {
    const target = location.file ? path.dirname(location.path) : location.path;
    await fs.mkdir(target, { recursive: true });
    assertNoSymlinkPath(path.parse(target).root, target);
  }
  if (owned.some(location => isPathWithinRoot(location.path, plan.scratch))) {
    const receipt = path.join(plan.scratch, '.pairofcleats-child-owner.json');
    try {
      await atomicWriteJson(receipt, { schemaVersion: 1, application: 'pairofcleats', toolId: plan.toolId,
        profileIdentity: plan.profileIdentity, runId: plan.runId, pid: process.pid,
        startedAt: new Date().toISOString(), retention: 'temporary-and-crash-evidence', cleanupAuthority: false },
      { mkdir: false, createOnly: true });
    } catch (error) {
      error.recovery = { scratch: plan.scratch, preserved: true };
      throw error;
    }
  }
  return { prepared: true, profileIdentity: plan.profileIdentity, runId: plan.runId,
    locations: plan.locations, exceptions: plan.exceptions, source: 'declared-not-observed-writes' };
};

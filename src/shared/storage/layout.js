import os from 'node:os';
import path from 'node:path';

export const STORAGE_LAYOUT_VERSION = 2;
export const STORAGE_DESCRIPTOR_VERSION = 1;

// A location descriptor describes intent. It does not grant deletion authority.
export const STORAGE_CATEGORIES = Object.freeze({
  config: { child: 'config', retention: 'durable', purpose: 'Machine-local application configuration' },
  state: { child: 'state', retention: 'durable', purpose: 'Registries, history and workspace membership' },
  models: { child: 'assets/models', retention: 'downloadable', purpose: 'Immutable model/provider/version assets', env: 'PAIROFCLEATS_MODELS_DIR' },
  dictionaries: { child: 'assets/dictionaries', retention: 'downloadable', purpose: 'Dictionary packs', env: 'PAIROFCLEATS_DICT_DIR' },
  extensions: { child: 'assets/extensions', retention: 'downloadable', purpose: 'Platform-specific native extensions', env: 'PAIROFCLEATS_EXTENSIONS_DIR' },
  tooling: { child: 'assets/tooling', retention: 'downloadable', purpose: 'Managed tools and SDKs', env: 'PAIROFCLEATS_TOOLING_DIR' },
  cache: { child: 'cache', retention: 'mixed', purpose: 'Cache namespace; children retain independent lifecycle authority' },
  repos: { child: 'cache/repos', retention: 'mixed', purpose: 'Canonical repository identities, builds and legacy saved evidence' },
  shared: { child: 'cache/shared', retention: 'derived', purpose: 'Shared derived caches' },
  cas: { child: 'cache/cas', retention: 'referenced', purpose: 'Content-addressed objects with category-owner reachability' },
  logs: { child: 'logs', retention: 'evidence', purpose: 'Logs, traces and metrics' },
  reports: { child: 'reports', retention: 'evidence', purpose: 'Saved reports, triage and recordings' },
  tmp: { child: 'tmp', retention: 'temporary', purpose: 'Run-owned scratch; no parent-wide automatic deletion' },
  recovery: { child: 'recovery', retention: 'evidence', purpose: 'Interrupted publication, installation and migration recovery' }
});

const nonempty = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const invalid = message => Object.assign(new TypeError(message), { code: 'ERR_STORAGE_LAYOUT_INPUT' });
const within = (api, target, root) => {
  const relative = api.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
};

export const storagePathApi = platform => platform === 'win32' ? path.win32 : path.posix;

/** Pure resolution: no stat, mkdir, lease acquisition, config loading or cleanup. */
export const resolveStorageLayout = ({
  home = null, overrides = {}, env = process.env, machineConfig = null,
  machineConfigPath = null, cwd = process.cwd(), platform = process.platform,
  homedir = os.homedir()
} = {}) => {
  const api = storagePathApi(platform);
  const base = api.resolve(cwd);
  if (machineConfig && !nonempty(machineConfigPath)) {
    throw invalid('Machine storage configuration requires its explicit trusted source path.');
  }
  if (machineConfigPath && !api.isAbsolute(machineConfigPath)) {
    throw invalid('Machine storage configuration source must be absolute.');
  }
  for (const category of Object.keys(overrides)) {
    if (!Object.hasOwn(STORAGE_CATEGORIES, category)) throw invalid(`Unknown storage category: ${category}`);
  }
  const config = machineConfig || {};
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || (config.categories !== undefined && (!config.categories || typeof config.categories !== 'object' || Array.isArray(config.categories)))) {
    throw invalid('Machine storage configuration must be an object with category paths.');
  }
  for (const [category, value] of Object.entries(config.categories || {})) {
    if (!Object.hasOwn(STORAGE_CATEGORIES, category) || !nonempty(value)) throw invalid(`Invalid machine storage category: ${category}`);
  }
  const resolveInput = (value, source, relativeBase = base, extra = {}) => {
    const lexicalPath = nonempty(value);
    if (!lexicalPath) return null;
    return { lexicalPath, path: api.resolve(relativeBase, lexicalPath), source, relativeBase, ...extra };
  };
  const select = inputs => {
    const present = inputs.filter(Boolean);
    return { ...present[0], shadowed: present.slice(1) };
  };
  const platformHome = platform === 'win32' && nonempty(env.LOCALAPPDATA)
    ? api.join(env.LOCALAPPDATA, 'PairOfCleats')
    : nonempty(env.XDG_CACHE_HOME)
      ? api.join(env.XDG_CACHE_HOME, 'pairofcleats')
      : api.join(homedir, '.cache', 'pairofcleats');
  const chosenHome = select([
    resolveInput(home, 'launch.home'),
    resolveInput(env.PAIROFCLEATS_HOME, 'env.PAIROFCLEATS_HOME'),
    resolveInput(platformHome, 'platform-default')
  ]);
  const configBase = machineConfigPath ? api.dirname(machineConfigPath) : base;
  const diagnostics = [];
  const descriptors = {};
  for (const [category, definition] of Object.entries(STORAGE_CATEGORIES)) {
    const cacheAlias = category === 'cache' ? resolveInput(env.PAIROFCLEATS_CACHE_ROOT,
      'env.PAIROFCLEATS_CACHE_ROOT', base, { compatibilityAlias: true }) : null;
    if (cacheAlias && api.basename(cacheAlias.path).toLowerCase() !== 'cache') {
      cacheAlias.path = api.join(cacheAlias.path, 'cache');
    }
    const categoryEnv = definition.env ? resolveInput(env[definition.env], `env.${definition.env}`) : null;
    const configOverride = resolveInput(config.categories?.[category], `machine-config.categories.${category}`, configBase);
    // cache.root historically denotes the effective cache path, unlike CACHE_ROOT.
    const configAlias = category === 'cache'
      ? resolveInput(config.cache?.root, 'machine-config.cache.root', configBase, { compatibilityAlias: true })
      : null;
    let defaultPath = api.join(chosenHome.path, ...definition.child.split('/'));
    if (['repos', 'shared', 'cas'].includes(category)) defaultPath = api.join(descriptors.cache.path, category);
    const selected = select([
      resolveInput(overrides[category], `launch.${category}`), categoryEnv, cacheAlias,
      configOverride, configAlias, resolveInput(defaultPath, 'layout-default')
    ]);
    const external = !within(api, selected.path, chosenHome.path);
    const compatibility = selected.compatibilityAlias || selected.shadowed.some(entry => entry.compatibilityAlias);
    if (compatibility) diagnostics.push({ code: 'legacy-cache-only-alias', category,
      message: 'CACHE_ROOT/cache.root remains cache-only; it does not relocate application assets or saved evidence.' });
    if (external) diagnostics.push({ code: 'external-category', category, source: selected.source });
    if (selected.shadowed.some(entry => entry.path !== selected.path)) {
      diagnostics.push({ code: 'shadowed-storage-input', category, source: selected.source });
    }
    descriptors[category] = {
      descriptorVersion: STORAGE_DESCRIPTOR_VERSION, layoutVersion: STORAGE_LAYOUT_VERSION,
      category, ...selected, resolvedPath: selected.path, physicalPath: null,
      physicalStatus: 'uninspected', scope: ['repos'].includes(category) ? 'repository-container' : 'application',
      ownerIdentity: { application: 'pairofcleats', category, layoutVersion: STORAGE_LAYOUT_VERSION },
      purpose: definition.purpose, retention: definition.retention,
      rebuildability: definition.retention === 'derived' ? 'rebuildable'
        : definition.retention === 'downloadable' ? 'redownload-required' : 'category-owner-required',
      external, shared: ['models', 'dictionaries', 'extensions', 'tooling', 'shared', 'cas'].includes(category),
      supportedOperations: ['inspect', 'explain', 'configure-plan', 'migration-plan', 'cleanup-plan'],
      deletionAuthority: false
    };
  }
  return { schemaVersion: 1, layoutVersion: STORAGE_LAYOUT_VERSION, platform,
    home: { ...chosenHome, physicalPath: null, deletionAuthority: false },
    machineConfigPath, descriptors, diagnostics };
};

/** Preserve the established canonical repo ID supplied by repo-paths.js. */
export const resolveRepositoryStorage = (layout, repoId) => {
  if (typeof repoId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,90}$/u.test(repoId)) throw invalid('Invalid canonical repository storage identity.');
  const api = storagePathApi(layout.platform);
  const root = layout.descriptors.repos;
  return { ...root, category: 'repo', path: api.join(root.path, repoId),
    resolvedPath: api.join(root.path, repoId), scope: 'repository',
    ownerIdentity: { ...root.ownerIdentity, repository: repoId }, repoId };
};

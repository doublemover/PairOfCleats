import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { acquireRepoStorageSession } from '../../../shared/storage/repository-session.js';
import { acquireStorageSession, isStorageSessionReleaseFailure } from '../../../shared/storage/session.js';
import { resolveRepoCacheRootPath } from '../../../shared/repo-paths.js';
import { getApplicationHome, getCacheRoot, resolveCacheTempRoot } from '../../../shared/cache-roots.js';
import { isPathWithinRoot } from '../../../shared/file-paths.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { acquireConfiguredNativeStorageSession, resolveConfiguredNativeStorageSelection,
  configuredNativeStorageConfigurationKey } from '../../../shared/storage/configured-native-storage.js';

const operations = new AsyncLocalStorage();
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export const getSqliteStorageOperation = () => operations.getStore() || null;

/** Ordinary diagnostics can stay best effort; an original pending resource
 * cannot. Capture its observation before calling logging or restoration hooks.
 */
export const isSqliteDiagnosticSettled = (error, native) => {
  try { observeStorageResource(error, { phase: 'sqlite-native-diagnostic' }).requireSettled(); return true; }
  catch (pending) {
    native.retainFailure(pending); getSqliteStorageOperation()?.retainFailure(pending); return false;
  }
};

/** One SQLite operation owns source reads, writers, publication and teardown.
 * These are existing storage leases, never registration or deletion authority.
 * Native/child errors keep their original observers; only their actual owners
 * can settle them before explicit metadata-only reconciliation is permitted.
 */
export const withSqliteStorageOperation = async (context, targets, action) => {
  if (typeof action !== 'function') throw new TypeError('SQLite storage requires its operation callback.');
  const inherited = getSqliteStorageOperation();
  if (!context) {
    return inherited ? inherited.use(() => { inherited.admitTargets(targets); return action(inherited); }) : action(null);
  }
  if (typeof context.repoRoot !== 'string' || !path.isAbsolute(context.repoRoot)
    || !context.userConfig || typeof context.userConfig !== 'object' || Array.isArray(context.userConfig)
    || context.env !== undefined && (!context.env || typeof context.env !== 'object' || Array.isArray(context.env))) {
    throw new TypeError('SQLite storage requires its explicit repository, effective configuration and launch environment.');
  }
  const configured = context.userConfig.cache?.root || null;
  if (configured !== null && (typeof configured !== 'string' || !path.isAbsolute(configured))) {
    throw new TypeError('SQLite storage requires an absolute effective cache root.');
  }
  const env = { ...(context.env || process.env) };
  const repoRoot = context.repoRoot;
  const userConfig = context.userConfig;
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig, { getCacheRoot: () => getCacheRoot({ env }) });
  const home = getApplicationHome({ env });
  const configurationKey = configuredNativeStorageConfigurationKey('sqlite', userConfig);
  if (inherited?.matches(repoCacheRoot, home, configurationKey)) {
    return inherited.use(() => { inherited.admitTargets(targets); return action(inherited); });
  }
  const tmpRoot = resolveCacheTempRoot({ env });
  if (tmpRoot === path.parse(tmpRoot).root) throw new Error('A volume root is not SQLite temporary storage authority.');
  const admission = acquireRepoStorageSession(repoCacheRoot, { repoRoot, userConfig, env }, { scope: 'sqlite-build-operation' });
  const stateRoot = path.join(home, 'state'), coordinationRoot = path.join(stateRoot, 'storage-access');
  const sessions = [{ session: admission.session, released: false, category: true }], admitted = new Set();
  const configuredAdmissions = new Map();
  const configuredContext = { repoRoot, userConfig, env, nativeBackend: 'sqlite' };
  const failures = [], observations = new Map(), described = new WeakSet(), accepted = new Set();
  let settled = false, released = false, overflow = false, recovering = null, blocked = null, owner;
  const originalsSettled = () => !overflow && [...observations.values()].every(observation => observation.isSettled());
  const isSettled = () => {
    try { return settled && released && originalsSettled(); } catch { return false; }
  };
  const retain = error => {
    if (!described.has(error) && !failures.includes(error)) {
      if (failures.length >= 128) overflow = true;
      else {
        failures.push(error);
        if (!sessions.some(entry => isStorageSessionReleaseFailure(error, entry.session))) {
          observations.set(error, observeStorageResource(error, { phase: 'sqlite-storage-operation' }));
        }
      }
    }
    let result = addStorageFailureContext(failures.length ? failures[0] : error, { sqliteStorageOperation: owner,
      cacheOwnershipPending: true, cacheOwnershipReleased: isSettled }, null,
    { forceAggregate: true, nonEnumerable: ['sqliteStorageOperation'] });
    for (const secondary of failures.slice(1)) result = addStorageFailureContext(result, {}, secondary,
      { secondaryPresent: true, forceAggregate: true });
    described.add(result); return result;
  };
  const revalidate = () => {
    admission.revalidate();
    if (configuredNativeStorageConfigurationKey('sqlite', userConfig) !== configurationKey) {
      throw Object.assign(new Error('SQLite configured storage paths changed during the admitted operation.'), { code: 'ERR_INDEX_STORAGE_SELECTION' });
    }
    for (const configured of configuredAdmissions.values()) configured.revalidate();
    if (identity(resolveCacheTempRoot({ env })) !== identity(tmpRoot)) {
      throw new Error('SQLite temporary category changed during the admitted operation.');
    }
  };
  const release = () => {
    if (released) return true;
    if (!settled || overflow) throw new Error('SQLite operation is not settled; metadata cannot acknowledge resource closure.');
    for (const observation of observations.values()) observation.requireSettled();
    const errors = [];
    // Exact resource metadata settles before either enclosing category lease.
    // A leaf removal failure must not reopen whole-cache/category migration.
    const resources = sessions.filter(entry => !entry.category);
    const categories = sessions.filter(entry => entry.category).reverse();
    for (const entry of [...resources, ...categories]) {
      if (entry.released) continue;
      if (entry.category && errors.length) continue;
      try {
        if (entry.session.releaseAfterSettlement({ resourceId: entry.session.resourceId, settled: true, pending: false }) !== true) {
          throw new Error('Original SQLite storage lease release was unconfirmed.');
        }
        entry.released = true;
      } catch (error) { errors.push(error); }
    }
    if (errors.length) {
      for (const error of errors) retain(error);
      throw retain(errors[0]);
    }
    released = true; return true;
  };
  owner = Object.freeze({ kind: 'sqlite-build-operation', repoCacheRoot, tmpRoot, isSettled,
    matches: (repo, launchHome, selectionKey) => !settled && identity(repo) === identity(repoCacheRoot)
      && identity(launchHome) === identity(home) && selectionKey === configurationKey,
    retainFailure: retain,
    use(work) {
      if (settled || accepted.size >= 128 || typeof work !== 'function') throw new Error('SQLite accepted operation budget is unavailable.');
      const promise = Promise.resolve().then(work);
      accepted.add(promise); promise.catch(error => { retain(error); });
      return promise;
    },
    admitTargets(paths = []) {
      if (settled) throw new Error('SQLite operation no longer admits resource work.');
      if (blocked) throw blocked;
      try {
        if (!Array.isArray(paths) || paths.length > 64) throw new TypeError('SQLite resource admission requires bounded selected paths.');
        revalidate();
        const selected = new Map();
        const normalized = new Map();
        for (const target of paths) {
          if (target == null) continue;
          if (typeof target !== 'string' || !path.isAbsolute(target)) throw new TypeError('SQLite resource paths must be absolute.');
          const absolute = path.resolve(target), key = identity(absolute);
          normalized.set(key, absolute);
          if (isPathWithinRoot(absolute, repoCacheRoot) || isPathWithinRoot(absolute, tmpRoot) || configuredAdmissions.has(key)) continue;
          const external = resolveConfiguredNativeStorageSelection(absolute, configuredContext);
          if (!external) continue;
          if (configuredAdmissions.size === 4) throw new Error('SQLite configured namespace admission budget exceeded.');
          const configured = acquireConfiguredNativeStorageSession(absolute, configuredContext, { scope: 'sqlite-build-configured-namespace' });
          sessions.push({ session: configured.session, released: false });
          configuredAdmissions.set(key, configured);
        }
        const namespaces = [...configuredAdmissions.values()].map(entry => entry.selection.namespace);
        for (const [key, absolute] of normalized) {
          // Final configured target admission precedes its provider-owned
          // staging/sidecar family, regardless of order within this batch.
          // Unregistered external outputs retain their report-only protection.
          if (!isPathWithinRoot(absolute, repoCacheRoot) && !isPathWithinRoot(absolute, tmpRoot)
            && !namespaces.some(root => isPathWithinRoot(absolute, root))) continue;
          if (!admitted.has(key)) selected.set(key, absolute);
        }
        if (admitted.size + selected.size > 256) throw new Error('SQLite operation resource admission budget exceeded.');
        if (selected.size) {
          const session = acquireStorageSession({ roots: [...selected.values()],
            authorizedRoots: [repoCacheRoot, tmpRoot, stateRoot, ...namespaces], coordinationRoot, scope: 'sqlite-build-resource' });
          sessions.push({ session, released: false });
          for (const key of selected.keys()) admitted.add(key);
        }
        revalidate();
      } catch (error) { blocked = error; throw error; }
    },
    recoverStorageMetadata() {
      if (!recovering) recovering = Promise.resolve().then(() => {
        try { release(); return Object.freeze({ settled: true, pending: false }); }
        catch (error) { throw retain(error); }
      }).finally(() => { recovering = null; });
      return recovering;
    }
  });
  let value, primary, failed = false;
  try {
    sessions.push({ session: acquireStorageSession({ roots: [tmpRoot], authorizedRoots: [tmpRoot, stateRoot],
      coordinationRoot, scope: 'sqlite-build-temporary-category' }), released: false, category: true });
    owner.admitTargets(targets);
    value = await operations.run(owner, () => action(owner));
  } catch (error) { failed = true; primary = error; retain(error); }
  // An ignored accepted child cannot outlive its parent's namespace leases.
  let drained = 0;
  const childErrors = new Set();
  while (drained < accepted.size) {
    const batch = [...accepted].slice(drained); drained += batch.length;
    const results = await Promise.allSettled(batch);
    for (const result of results) if (result.status === 'rejected') childErrors.add(result.reason);
  }
  for (const error of childErrors) {
    if (!failed) { primary = error; failed = true; }
    else if (error !== primary) primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
  }
  settled = true;
  try { release(); }
  catch (cleanup) {
    const failure = retain(cleanup);
    throw failed ? addStorageFailureContext(primary, {}, failure, { secondaryPresent: true }) : failure;
  }
  if (failed) throw primary;
  return value;
};

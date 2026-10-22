import { prepareManagedChildStorage } from './child-environment.js';
import { runWithStorageSession } from './session.js';
import { isPathWithinRoot } from '../file-paths.js';

/** Installer/runtime adoption owns preparation through actual child settlement.
 * Cache TTL/GC cannot infer that a timed-out child's writes have stopped.
 */
export const runManagedChildWithStorage = async ({ plan, authorizedRoots, coordinationRoot }, execute, { settlement } = {}) => {
  if (typeof execute !== 'function' || typeof settlement !== 'function') throw new TypeError('Managed child execution needs its real execution and settlement owners.');
  if (!plan?.managed) return { value: await execute({ env: plan?.env, storage: { managed: false, external: true } }),
    resourceId: null, storage: { managed: false, external: true } };
  const roots = plan.ownedRoots.filter(root => plan.locations.some(location => !location.external && isPathWithinRoot(location.path, root)));
  if (!roots.length) return { value: await execute({ env: plan.env, storage: { managed: true, externalOverridesOnly: true } }),
    resourceId: null, storage: { managed: true, externalOverridesOnly: true } };
  let started = false;
  let storage;
  const result = await runWithStorageSession({ roots, coordinationRoot, authorizedRoots,
    scope: 'managed-child-storage', resourceId: `${plan.profileIdentity}:${plan.runId}` }, async session => {
    storage = await prepareManagedChildStorage(plan, { authorizedRoots });
    started = true;
    return execute({ env: plan.env, storage, session });
  }, { settlement: input => started ? settlement(input) : { resourceId: input.resourceId, settled: true, pending: false } });
  return { ...result, storage };
};

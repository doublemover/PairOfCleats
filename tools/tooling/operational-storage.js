import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../src/shared/storage/child-environment.js';
import { runManagedChildWithStorage } from '../../src/shared/storage/managed-child-session.js';
import { observeProvisioningResource } from './provisioning-failure.js';
import { retainManagedResourceFailure } from './managed-verification.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';

const FAMILIES = Object.freeze({ graphviz: 'graphviz', 'npm-sbom': 'npm', cargo: 'cargo', 'cargo-cyclonedx': 'cargo',
  ripgrep: 'native', scip: 'native', 'universal-ctags': 'native', 'gnu-global': 'native', 'git-lfs': 'native' });
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });

/** A cache route is prepared only under the canonical storage session. Its
 * lifetime is the actual child/stream owner, including failed close recovery.
 * This does not qualify unobserved vendor writes or acquire tool ownership.
 */
export const runOperationalChildWithStorage = async ({ id, toolingRoot, repoRoot, command, identity, env, cwd = repoRoot,
  registerRecovery = () => {} }, execute) => {
  const layout = resolveStorageLayout({ env, overrides: { tooling: toolingRoot }, cwd });
  const toolIdentity = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const plan = planManagedChildStorage({ baseEnv: env, layout, command, family: FAMILIES[id] || null, cwd,
    managed: true, toolId: id, toolIdentity, projectIdentity: path.resolve(repoRoot) });
  if (plan.exceptions.some(exception => exception.status === 'unsupported-owner-adapter-required')) {
    throw Object.assign(new Error(`Selected ${id} has no canonical secondary-write storage adapter.`), { code: 'ERR_OPERATIONAL_STORAGE_UNSUPPORTED' });
  }
  let started = false, completed = false, observation = null;
  try {
    const result = await runManagedChildWithStorage({ plan,
      authorizedRoots: Object.values(layout.descriptors).map(descriptor => descriptor.path),
      coordinationRoot: path.join(layout.descriptors.state.path, 'storage-access') }, async ({ env: routed, storage }) => {
      started = true;
      try {
        const current = identifyProvisioningExecutable(command);
        if (current.path !== identity.path || current.sha256 !== identity.sha256 || current.size !== identity.size) {
          throw Object.assign(new Error('Operational command bytes changed during storage preparation.'), { code: 'ERR_OPERATIONAL_TOOL_CHANGED' });
        }
        const value = await execute({ env: routed, storage, plan });
        observation = observeProvisioningResource(value, { phase: 'operational-storage-child' });
        completed = true; observation.requireSettled(); return value;
      } catch (value) {
        const error = asError(value);
        observation = observeProvisioningResource(error, { phase: 'operational-storage-child-failure' });
        completed = true; throw error;
      }
    }, { settlement: ({ resourceId }) => {
      let settled = completed;
      try { observation?.requireSettled(); } catch { settled = false; }
      return { resourceId, settled, pending: !settled };
    } });
    return result.value;
  } catch (value) {
    const primary = asError(value), session = Object.getOwnPropertyDescriptor(primary, 'storageSession')?.value;
    // Before execution, preparation's own pending descriptor/metadata owners
    // remain authoritative. Never infer their settlement from no child start.
    if (!session || !started) throw primary;
    let released = false;
    const settled = () => {
      if (!completed) return false;
      try { observation?.requireSettled(); return true; } catch { return false; }
    };
    const retain = cleanupError => retainManagedResourceFailure(primary, { field: 'operationalStorageSession',
      session: recovery, released: () => released && settled(), cleanupError });
    const recovery = Object.freeze({ resourceId: session.resourceId, scratch: plan.scratch,
      isReleased: () => released && settled(), releaseAfterClosure: () => {
        try {
          if (!settled()) throw new Error('Actual operational child/storage resource remains pending.');
          if (released) return true;
          if (session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) !== true) {
            throw new Error('Operational storage owner did not confirm exact release.');
          }
          released = true; return true;
        } catch (cleanupError) { throw retain(cleanupError); }
      } });
    registerRecovery(recovery);
    throw retain();
  }
};

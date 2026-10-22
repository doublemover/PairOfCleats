import { createHash } from 'node:crypto';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { explainStorageLayout, inspectStorageLayout, diagnoseStorageLayout } from '../../../src/shared/storage/operator.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

export const NATIVE_STORAGE_COMMANDS = new Set(['storage.list', 'storage.explain', 'storage.inspect',
  'storage.doctor', 'storage.cleanup-plan', 'storage.cleanup-apply']);
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Retain the canonical plan privately; serialized input never grants authority.
 * The canonical apply owner revalidates identities and obtains its exclusions.
 */
export const prepareTuiStorage = async ({ commandId, values, env, requireScope, scope, signal } = {}) => {
  if (!NATIVE_STORAGE_COMMANDS.has(commandId)) fail('ERR_TUI_STORAGE_COMMAND', 'Unsupported native storage action.');
  requireScope(scope.id);
  throwIfAborted(signal);
  const resolve = () => resolveStorageLayout({ env, cwd: scope.configRoot });
  const layout = resolve();
  const identity = digest({ home: layout.home, descriptors: layout.descriptors });
  const limits = { maxEntries: values['max-entries'] ?? 10000,
    maxDurationMs: values['max-duration-ms'] ?? 5000, signal };
  const cacheRoot = layout.descriptors.cache.path;
  const cleanup = ['storage.cleanup-plan', 'storage.cleanup-apply'].includes(commandId);
  const plan = cleanup ? await planCacheRootCleanup({ cacheRoot, authorityRoots: [cacheRoot], ...limits }) : null;
  throwIfAborted(signal);
  requireScope(scope.id);
  if (plan && Buffer.byteLength(JSON.stringify(plan)) > 512 * 1024) {
    fail('ERR_TUI_STORAGE_REVIEW_LIMIT', 'Narrow the inventory; the complete cleanup review exceeds its byte bound.');
  }
  const launchable = commandId !== 'storage.cleanup-apply' || plan.complete === true && plan.applyReady === true;
  const review = { commandId, layoutIdentity: identity, cacheRoot, layout: explainStorageLayout(layout),
    canonicalPlan: plan ? structuredClone(plan) : null,
    approvedPlanId: commandId === 'storage.cleanup-apply' ? plan.planId : null,
    operation: commandId === 'storage.cleanup-apply' ? 'Apply exactly this retained canonical plan once after Enter confirmation.'
      : 'Read-only storage observation or plan; no configuration or migration is applied.',
    scopeMeaning: 'Storage roots come from the current machine environment; they can be shared by other repositories.',
    leaseMeaning: 'Existing canonical exclusions remain authoritative, including this supervisor\'s reader lease. Protected apply is blocked or skipped; no lease is weakened.',
    launchable, errors: launchable ? [] : ['The canonical cleanup plan is incomplete or protected; review its blocked/lease/authority findings.'] };
  const execute = async ({ signal: runSignal }) => {
    throwIfAborted(runSignal);
    requireScope(scope.id);
    const current = resolve();
    if (digest({ home: current.home, descriptors: current.descriptors }) !== identity) {
      fail('ERR_TUI_STORAGE_STALE', 'Storage root authority changed after review. Preview again.');
    }
    let receipt;
    if (commandId === 'storage.cleanup-apply') {
      receipt = await applyStorageCleanupPlan(plan, { authorityRoots: [current.descriptors.cache.path],
        approvedPlanId: plan.planId, signal: runSignal });
    } else if (commandId === 'storage.cleanup-plan') receipt = plan;
    else if (commandId === 'storage.inspect') receipt = await inspectStorageLayout(current,
      { ...limits, exact: values.exact === true, signal: runSignal });
    else if (commandId === 'storage.doctor') receipt = await diagnoseStorageLayout(current, { ...limits, signal: runSignal });
    else receipt = explainStorageLayout(current);
    if (Buffer.byteLength(JSON.stringify(receipt)) > 768 * 1024) {
      fail('ERR_TUI_STORAGE_OUTPUT', 'Storage receipt exceeded the native byte bound; no complete receipt can be presented.');
    }
    return { exitCode: commandId === 'storage.cleanup-apply' && receipt.complete !== true ? 1 : 0,
      stdout: JSON.stringify(receipt), signal: null };
  };
  return { review, execute };
};

// Source UNVALIDATED. Recipe/location observation has no executable probe owner.
import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { locateToolExecutable, selectInstallPlan } from './utils.js';
import { createToolProvisioningPlan } from './provisioning-plan.js';
import { resolveDeclaredInstallAdmission } from './install-execution.js';

export const createToolInstallPreview = ({ tools, scope = 'cache', allowFallback = false, env = process.env,
  isAllowed = () => true } = {}, dependencies = {}) => {
  const entries = tools.map(tool => {
    const selection = (dependencies.select || selectInstallPlan)(tool, scope, allowFallback);
    const located = (dependencies.locate || locateToolExecutable)(tool);
    const provisioning = (dependencies.provisioning || createToolProvisioningPlan)({ tool, selection, env, isAllowed });
    const admission = selection.plan ? resolveDeclaredInstallAdmission(selection.plan) : null;
    const blockers = [];
    if (!selection.plan) blockers.push({ code: 'selected-recipe-unavailable', reason: tool.provisioningBlocker || selection.reason || null });
    if (selection.scope === 'cache' && admission?.state !== 'estimate-declared') blockers.push({ code: 'storage-estimate-unavailable' });
    for (const step of provisioning.steps) if (['missing', 'incompatible', 'blocked'].includes(step.state)) blockers.push({ code: 'prerequisite-missing', requirement: step.id, reason: step.reason,
      ...(step.blockedBy ? { blockedBy: step.blockedBy } : {}) });
    return { id: tool.id, scope: selection.scope, fallback: selection.fallback === true,
      location: { path: located.path, state: located.source === 'blocked' ? 'authority-blocked' : located.path ? 'located-not-probed' : 'not-found',
        managedInstallId: tool.managedInstallation?.installId || null, protocol: 'not-probed' },
      action: selection.plan ? { kind: selection.plan.managedDescriptor ? 'immutable-managed-archive' : 'canonical-recipe-child',
        command: selection.plan.cmd || null, args: selection.plan.args || [],
        descriptor: selection.plan.managedDescriptor || null, environment: { keys: Object.keys(selection.plan.env || {}).sort(), values: 'not-exposed' } } : null,
      provisioning, admission, blockers, state: blockers.length ? 'blocked-or-unqualified' : 'planned-not-probed' };
  });
  const body = sanitizeRuntimeReceipt({ schemaVersion: 1, kind: 'tool-install-preview', scope, allowFallback, entries,
    execution: 'none', verification: 'location-and-declared-recipe-only', writes: 'none',
    state: entries.some(entry => entry.blockers.length) ? 'blocked-or-unqualified' : 'planned-not-probed',
    limitations: ['Existing executable locations are not version/protocol/runtime readiness.', 'A preview is not install approval or a reusable arbitrary command plan.'] });
  return { ...body, planId: createHash('sha256').update(stableStringify(body)).digest('hex') };
};

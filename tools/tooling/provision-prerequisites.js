import { createHash } from 'node:crypto';
import semver from 'semver';
import { stableStringify } from '../../src/shared/stable-json.js';
import { DOTNET_RUNTIME_VERSION, DOTNET_SDK_VERSION, resolveManagedDotnetSdkRecipe, verifyManagedDotnetSdk } from './managed-dotnet-sdk.js';
import { installPinnedManagedTool } from './managed-install.js';
import { createToolProvisioningPlan, verifyToolProvisioningPlan } from './provisioning-plan.js';

/** Read-only supported prerequisite actions for this selected feature. An
 * explicit runtime root is a pin, including when unavailable/incompatible.
 * Other runtimes retain their precise existing blockers; no system fallback.
 */
export const planManagedPrerequisites = ({ provisioning, scope = 'cache', env = process.env,
  platform = process.platform, arch = process.arch } = {}) => {
  const required = provisioning.steps.filter(step => ['dotnet', 'dotnet-runtime'].includes(step.family) && step.state !== 'verified');
  const actions = [], blockers = [];
  if (required.length) {
    if (scope !== 'cache') blockers.push({ code: 'managed-prerequisite-scope-unavailable', requirements: required.map(step => step.id),
      nextAction: 'Select cache scope for the owned portable SDK; no user/system toolchain is installed implicitly.' });
    else if (String(env.DOTNET_ROOT || '').trim()) blockers.push({ code: 'explicit-dotnet-root-retained', requirements: required.map(step => step.id),
      nextAction: 'Repair the exact explicitly selected DOTNET_ROOT, or explicitly remove/change that pin before selecting another SDK.' });
    else if (required.some(step => step.selectedCommandRejected || step.explicitCommand || step.reason === 'selected-managed-prerequisite-unavailable')) {
      blockers.push({ code: 'selected-dotnet-authority-retained', requirements: required.map(step => step.id),
        nextAction: 'Repair the selected command trust, explicit command or managed generation before re-planning; no download replaces that authority.' });
    }
    else if (required.some(step => step.reason === 'unsupported_runtime_version' || step.reason === 'selected-runtime-root-mismatch')) {
      blockers.push({ code: 'selected-dotnet-version-retained', requirements: required.map(step => step.id),
        nextAction: 'The selected .NET host has an incompatible version/root. Deliberately select the pinned owned SDK with tooling install --tools dotnet-sdk --scope cache, or repair the current selection; no replacement was inferred.' });
    }
    else if (required.some(step => step.versionRange && (!semver.validRange(step.versionRange)
      || !semver.satisfies(step.family === 'dotnet' ? DOTNET_SDK_VERSION : DOTNET_RUNTIME_VERSION, step.versionRange))
      || (step.requiredComponents || []).some(component => step.family !== 'dotnet-runtime' || component !== 'Microsoft.NETCore.App'))) {
      blockers.push({ code: 'pinned-dotnet-requirements-unsupported', requirements: required.map(step => ({ id: step.id,
        versionRange: step.versionRange || null, requiredComponents: step.requiredComponents || [] })),
      nextAction: 'The pinned SDK 10.0.402/Core runtime 10.0.13 does not cover these exact version/component requirements; no incompatible download is attempted.' });
    }
    else {
      const recipe = resolveManagedDotnetSdkRecipe({ platform, arch });
      if (recipe) actions.push({ id: 'dotnet-sdk', requirements: required.map(step => step.id), scope: 'cache', ...recipe });
      else blockers.push({ code: 'portable-dotnet-target-unavailable', requirements: required.map(step => step.id),
        nextAction: 'This recipe supports native Windows x64/ia32/arm64 only; no other platform package manager, OS dependency or privilege action is substituted.' });
    }
  }
  const body = { schemaVersion: 1, kind: 'selected-managed-prerequisites', platform, arch, actions, blockers,
    state: blockers.length ? 'blocked' : actions.length ? 'ready-for-selected-install' : 'no-supported-action-required' };
  return { ...body, planId: createHash('sha256').update(stableStringify(body)).digest('hex') };
};

/** Explicit installer/lifecycle only. Re-plan against the now-selected exact
 * generation; a successful SDK extraction does not manufacture tool readiness.
 */
export const provisionManagedPrerequisites = async ({ tool, selection, provisioning, toolingRoot, env = process.env,
  signal = null, isAllowed = () => false, cwd = process.cwd(), onProgress = () => {} } = {}, dependencies = {}) => {
  signal?.throwIfAborted();
  const plan = planManagedPrerequisites({ provisioning, scope: selection.scope, env });
  const results = [];
  if (plan.state === 'blocked') return { plan, provisioning, results, ok: false };
  for (const action of plan.actions) {
    const result = await (dependencies.install || installPinnedManagedTool)({ toolingRoot, descriptor: action.managedDescriptor,
      approvedOrigins: action.approvedOrigins, env, signal, verify: verifyManagedDotnetSdk,
      onProgress: event => onProgress({ ...event, prerequisiteFor: tool.id }) });
    results.push({ id: action.id, ok: result.ok, state: result.state, reused: result.reused === true,
      installId: result.installId || result.receipt?.installId || null, descriptorId: result.descriptorId || result.receipt?.descriptorId || null });
    if (!result.ok) return { plan, provisioning, results, ok: false };
  }
  const updated = await verifyToolProvisioningPlan(createToolProvisioningPlan({ tool, selection, env, signal, isAllowed }),
    { env, signal, cwd, ...(dependencies.probe ? { probe: dependencies.probe } : {}) });
  return { plan, provisioning: updated, results, ok: updated.state === 'requirements-verified' };
};

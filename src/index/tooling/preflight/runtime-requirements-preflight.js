import {
  isProbeCommandDefinitelyMissing,
  resolveToolingCommandProfile
} from '../command-resolver.js';
import { resolveRustWorkspaceExecutionAuthority } from '../../../shared/workspace-execution-authority.js';

/**
 * Resolve runtime prerequisite checks as a preflight classification.
 *
 * Missing/inconclusive runtime probes produce degraded warnings. An explicit
 * workspace execution denial is different and must remain blocking.
 */
export const resolveRuntimeRequirementsPreflight = ({
  ctx,
  providerId,
  requirements
}) => {
  const executionAuthority = resolveRustWorkspaceExecutionAuthority({
    repoRoot: ctx?.repoRoot || process.cwd(), providerId
  });
  if (executionAuthority) return { ...executionAuthority, checks: [executionAuthority.check] };
  const runtimeRequirements = Array.isArray(requirements) ? requirements : [];
  if (!runtimeRequirements.length) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const checks = [];
  for (const requirement of runtimeRequirements) {
    const requirementId = String(requirement?.id || '').trim().toLowerCase();
    const requirementCmd = String(requirement?.cmd || '').trim();
    const requirementLabel = String(requirement?.label || requirementId || requirementCmd).trim();
    const requirementArgs = Array.isArray(requirement?.args)
      ? requirement.args.map((entry) => String(entry))
      : ['--version'];
    if (!requirementId || !requirementCmd) continue;
    const commandProfile = resolveToolingCommandProfile({
      providerId: `${providerId}-${requirementId}`,
      cmd: requirementCmd,
      args: requirementArgs,
      repoRoot: ctx?.repoRoot || process.cwd(),
      toolingConfig: ctx?.toolingConfig || {}
    });
    const probeOk = commandProfile?.probe?.ok === true;
    if (probeOk) continue;
    const definitelyMissing = isProbeCommandDefinitelyMissing(commandProfile?.probe);
    checks.push({
      name: `${providerId}_runtime_${requirementId}_${definitelyMissing ? 'missing' : 'probe_inconclusive'}`,
      status: 'warn',
      message: definitelyMissing
        ? `${requirementLabel} not available for ${providerId}; provider will run in degraded mode.`
        : `${requirementLabel} probe inconclusive for ${providerId}; provider may run in degraded mode.`
    });
  }
  if (!checks.length) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const firstMissing = checks.find((entry) => String(entry?.name || '').endsWith('_missing')) || null;
  return {
    state: 'degraded',
    reasonCode: firstMissing ? 'preflight_runtime_requirement_missing' : 'preflight_runtime_requirement_probe_inconclusive',
    message: firstMissing
      ? 'one or more runtime requirements are unavailable.'
      : 'one or more runtime requirement probes were inconclusive.',
    checks
  };
};

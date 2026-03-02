import {
  isProbeCommandDefinitelyMissing,
  resolveToolingCommandProfile
} from '../command-resolver.js';

export const resolveRuntimeProbeProfile = ({
  ctx,
  providerId,
  requirementId,
  cmd,
  args
}) => resolveToolingCommandProfile({
  providerId: `${String(providerId || 'tooling')}-${String(requirementId || 'runtime')}`,
  cmd: String(cmd || ''),
  args: Array.isArray(args) ? args.map((entry) => String(entry)) : [],
  repoRoot: String(ctx?.repoRoot || process.cwd()),
  toolingConfig: ctx?.toolingConfig || {}
});

export const runtimeProbeAttempt = (profile) => {
  const attempts = Array.isArray(profile?.probe?.attempted) ? profile.probe.attempted : [];
  if (!attempts.length) return null;
  return attempts[attempts.length - 1];
};

export const runtimeProbeText = (profile) => {
  const attempt = runtimeProbeAttempt(profile);
  if (!attempt) return '';
  return `${String(attempt?.stdout || '')}\n${String(attempt?.stderr || '')}`.trim();
};

export const runtimeProbeOk = (profile) => profile?.probe?.ok === true;

export const runtimeProbeMissing = (profile) => isProbeCommandDefinitelyMissing(profile?.probe);

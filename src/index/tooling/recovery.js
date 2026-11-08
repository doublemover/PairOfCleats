export const buildProviderRecovery = (provider, repoRoot) => {
  if (provider.status === 'ok' || !provider.enabled) return [];
  const checks = provider.checks || [];
  const actions = [];
  if (checks.some((check) => check.status !== 'ok' && /command|runtime/.test(check.name))) actions.push({
    code: 'provider-command',
    message: `Verify the executable and runtime configured for ${provider.id}; inspect installation options before changing the environment.`,
    argv: ['pairofcleats', 'tooling', 'install', '--help']
  });
  if (checks.some((check) => check.status !== 'ok' && /config|workspace|compile-commands/.test(check.name))) actions.push({
    code: 'provider-workspace',
    message: `Check ${provider.id} project markers and configuration at the selected repository root.`,
    argv: ['pairofcleats', 'tooling', 'detect', '--repo', repoRoot, '--json']
  });
  actions.push({ code: 'verify-recovery', message: 'Rerun diagnostics after correcting the reported cause.',
    argv: ['pairofcleats', 'tooling', 'doctor', '--repo', repoRoot, '--json'] });
  return actions;
};

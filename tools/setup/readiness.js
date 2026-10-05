const SATISFIED = new Set(['available-and-verified', 'installed-and-verified', 'not-applicable']);
const STATES = new Set([...SATISFIED, 'skipped', 'declined', 'manual-action-required',
  'missing', 'failed', 'unverified', 'planned']);

/** Readiness concerns the declared checks, never every possible capability. */
export const buildReadinessReceipt = ({ items = [], requiredIds = [], dryRun = false } = {}) => {
  const required = new Set(requiredIds);
  const seen = new Set();
  const rows = items.map((item) => {
    if (!item?.id || seen.has(item.id)) throw new Error('Readiness checks require unique nonempty IDs.');
    if (!STATES.has(item.state)) throw new Error(`Unknown readiness state: ${item.state}`);
    seen.add(item.id);
    return { ...item, required: item.required === true || required.has(item.id) };
  });
  for (const id of required) {
    if (!seen.has(id)) rows.push({ id, required: true, state: 'missing', reason: 'Required check was not performed.' });
  }
  const blockers = rows.filter((item) => item.required && !SATISFIED.has(item.state));
  const omissions = rows.filter((item) => !item.required && !SATISFIED.has(item.state) && item.state !== 'skipped');
  const state = dryRun ? 'planned' : blockers.length ? 'blocked' : omissions.length ? 'degraded' : 'ready';
  return {
    schemaVersion: 1, state, ready: state === 'ready', exitCode: state === 'blocked' ? 1 : 0,
    requiredIds: rows.filter((item) => item.required).map((item) => item.id),
    blockedIds: blockers.map((item) => item.id),
    omittedIds: omissions.map((item) => item.id),
    items: rows
  };
};

export const buildToolInstallReadiness = (results, { dryRun = false } = {}) => buildReadinessReceipt({
  dryRun,
  items: results.map((result) => ({
    id: result.id, required: true,
    state: result.status === 'already-installed' && result.probe?.ok === true
      ? 'available-and-verified'
      : result.status === 'installed' && result.probe?.ok === true
        ? 'installed-and-verified'
        : result.status === 'manual' ? 'manual-action-required'
          : result.status === 'missing-requirement' ? 'missing'
            : result.status === 'planned' ? 'planned'
              : ['failed', 'verification-failed'].includes(result.status) ? 'failed' : 'unverified',
    verificationLevel: result.probe?.ok === true ? 'executable-probe-and-layout' : null,
    path: result.path || null,
    reason: result.error || (result.requires ? `Missing installer prerequisite: ${result.requires}` : null)
  }))
});

const REQUIRED_SETUP_STEPS = new Set(['config', 'install', 'index', 'sqlite']);
export const buildSetupReadiness = ({ steps = {}, errors = [] }, { requiredIds = [] } = {}) => {
  const forced = new Set(requiredIds);
  const ids = new Set([...Object.keys(steps), ...errors.map((error) => error.step)]);
  return buildReadinessReceipt({ requiredIds, items: [...ids].map((id) => {
    const step = steps[id] || {};
    const failures = errors.filter((error) => error.step === id);
    const applicable = step.applicable !== false;
    const required = REQUIRED_SETUP_STEPS.has(id) && applicable && step.skipped !== true;
    let state;
    if (failures.length || step.ok === false) state = 'failed';
    else if (!applicable) state = forced.has(id) ? 'missing' : 'not-applicable';
    else if (step.skipped === true) state = 'skipped';
    else if (step.declined === true) state = 'declined';
    else if (step.readiness?.state === 'blocked') state = 'unverified';
    else if (step.ready === true || step.present === true || step.restored === true
      || (step.built === true && step.ok === true) || (id === 'config' && step.ok === true)) state = 'available-and-verified';
    else state = 'missing';
    return { id, required, state,
      verificationLevel: state === 'available-and-verified'
        ? step.verificationLevel || (id === 'tooling' ? 'executable-probe-and-layout' : id === 'config' ? 'schema-validation' : 'artifact-presence')
        : null,
      reason: failures.map((error) => error.message).filter(Boolean).join('; ') || step.reason || null,
      ...(step.readiness ? { details: step.readiness } : {})
    };
  }) });
};

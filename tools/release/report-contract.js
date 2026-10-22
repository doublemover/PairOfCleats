import { getReleaseCheckSurfaceSteps, loadShippedSurfaces } from './surfaces.js';

export const RELEASE_REPORT_ROLES = Object.freeze({
  prepare: { phases: ['changelog', 'contracts', 'toolchain'], surfaceIds: [],
    baseline: [{ id: 'changelog.entry', phase: 'changelog' }, { id: 'contracts.drift', phase: 'contracts' }, { id: 'toolchain.python', phase: 'toolchain' }] },
  runtime: { phases: ['boot', 'smoke'], surfaceIds: ['cli', 'api', 'mcp', 'indexer-service'] },
  nodeVerify: { phases: ['install'], surfaceIds: ['vscode', 'sublime'] },
  tuiVerify: { phases: ['install', 'boot'], surfaceIds: ['tui'] }
});

export const expectedReleaseChecks = (root, role) => {
  const contract = RELEASE_REPORT_ROLES[role];
  if (!contract) throw new Error(`Unknown release report role: ${role}`);
  return [...(contract.baseline || []), ...(contract.surfaceIds.length
    ? getReleaseCheckSurfaceSteps(root, contract) : [])];
};

/** Scope is supplied by the consuming gate, never inferred from self-declared
 * requiredChecks. Dry-run reports remain useful plans, never execution evidence. */
export const qualifyReleaseReport = (payload, { root, role, releaseVersion = null } = {}) => {
  const errors = [];
  if (payload?.executionMode !== 'executed' || payload?.dryRun === true) errors.push('release evidence must be executed, not simulated');
  if (releaseVersion && payload?.releaseVersion !== releaseVersion) errors.push(`releaseVersion must match ${releaseVersion}`);
  const rows = Array.isArray(payload?.checks) ? payload.checks : [];
  const byId = new Map();
  for (const row of rows) {
    if (byId.has(row?.id)) errors.push(`duplicate check id: ${row?.id}`);
    byId.set(row?.id, row);
    if ((row?.status === 'passed') !== (row?.exitCode === 0)) errors.push(`inconsistent status/exitCode: ${row?.id}`);
    if (row?.overridden === true) errors.push(`overridden check is not release evidence: ${row?.id}`);
  }
  const surfaces = new Map((payload?.shippedSurfaces || []).map(surface => [surface?.id, surface]));
  const registry = loadShippedSurfaces(root);
  for (const expected of expectedReleaseChecks(root, role)) {
    const actual = byId.get(expected.id);
    if (!actual || actual.phase !== expected.phase || actual.status !== 'passed' || actual.exitCode !== 0) errors.push(`missing passed ${role} check: ${expected.id}`);
    if (expected.surfaceId) {
      const declared = surfaces.get(expected.surfaceId);
      const canonical = registry.surfaces.find(surface => surface.id === expected.surfaceId);
      if (!declared || declared.versionSource !== canonical?.versionSource
        || !declared.releaseCheckStepIds?.includes(expected.id)) errors.push(`missing canonical surface evidence: ${expected.surfaceId}/${expected.id}`);
    }
  }
  return errors;
};

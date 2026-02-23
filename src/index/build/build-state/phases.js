export const markBuildPhaseState = async ({
  buildRoot,
  phase,
  status,
  detail = null,
  buildRootExists,
  loadBuildState,
  ensureStateVersions,
  queueStatePatch
} = {}) => {
  if (!buildRoot || !phase || !status) return null;
  if (typeof buildRootExists !== 'function') return null;
  if (!(await buildRootExists(buildRoot))) return null;
  if (typeof loadBuildState !== 'function' || typeof ensureStateVersions !== 'function') return null;
  if (typeof queueStatePatch !== 'function') return null;
  const now = new Date().toISOString();
  const loadedState = await loadBuildState(buildRoot);
  const current = ensureStateVersions(loadedState?.state || {}, buildRoot, loadedState?.loaded);
  const existing = current?.phases?.[phase] || {};
  const next = {
    ...existing,
    status,
    detail: detail || existing.detail || null,
    updatedAt: now
  };
  if (status === 'running' && !existing.startedAt) next.startedAt = now;
  if (status === 'done' || status === 'failed') next.finishedAt = now;
  const finishedAt = (status === 'done' || status === 'failed')
    && (phase === 'promote' || phase === 'watch')
    ? now
    : current?.finishedAt || null;
  const patch = {
    currentPhase: phase,
    phases: { [phase]: next },
    finishedAt
  };
  const events = [{
    at: now,
    type: 'phase',
    phase,
    status,
    detail: detail || null
  }];
  return queueStatePatch(buildRoot, patch, events);
};

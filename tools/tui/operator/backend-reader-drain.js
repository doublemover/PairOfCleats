const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** A rejected disposal retains the original session and its recovery methods.
 * Clear only the exact slot whose disposal actually confirmed settlement.
 */
export const disposeTuiSessionSlot = async ({ current, replace }) => {
  const selected = current();
  if (!selected) return;
  await selected.dispose();
  if (current() === selected) replace(null);
};

/** A drain receipt belongs to the exact active maintenance job and retained
 * lease. The launcher exclusion is an in-memory operation instance, never a
 * reusable protocol job ID. Every owner callback must finish actual teardown.
 */
export const drainTuiBackendReaders = async ({ jobs, jobId, launcherJob, leaseId,
  closeSearch, closeArtifactActions, resetArtifactRegistry } = {}) => {
  const maintenance = jobs.get(jobId);
  if (!maintenance || maintenance.finalized || maintenance.internal || typeof leaseId !== 'string' || !leaseId) {
    fail('ERR_TUI_BACKEND_JOB', 'Maintenance needs its exact active job and retained lease.');
  }
  const assertExclusiveSession = () => {
    if (jobs.get(jobId) !== maintenance || maintenance.finalized) {
      fail('ERR_TUI_BACKEND_JOB', 'Maintenance job is no longer active.');
    }
    const other = [...jobs.values()].some(job => (!job.finalized || job.settlement && job.settled !== true
      || job.cleanupPending?.() === true) && job !== maintenance
      && !(job === launcherJob && job.internal === true));
    if (other) fail('ERR_TUI_BACKEND_ACTIVE_JOBS', 'Stop or finish other supervised work before exclusive backend maintenance.');
  };
  assertExclusiveSession();
  await closeSearch();
  await closeArtifactActions();
  const registry = await resetArtifactRegistry();
  assertExclusiveSession();
  maintenance.artifactGeneration = registry.beginJob(jobId);
  return { drained: true, pending: false, leaseId };
};

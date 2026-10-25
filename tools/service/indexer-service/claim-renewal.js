import { performance } from 'node:perf_hooks';

const FENCE_ERRORS = new Set(['QUEUE_LEASE_MISMATCH', 'QUEUE_LEASE_VERSION_MISMATCH', 'QUEUE_INVALID_TRANSITION']);
const failure = (code, message) => Object.assign(new Error(message), { code });

/** The queue worker's existing per-claim renewal owner, including its independent
 * confirmed-authority deadline. Pending renewal I/O remains in jobLifecycle. */
export const startClaimRenewal = ({ job, ownerId, leasePolicy, jobLifecycle, claimControl,
  loadReplayState, touchHeartbeat, now = () => performance.now() }) => {
  const version = job.lease?.version;
  const initialExpiry = Date.parse(job.lease?.expiresAt || '');
  const leaseMs = Number.isFinite(leasePolicy?.leaseMs) && leasePolicy.leaseMs > 0
    ? leasePolicy.leaseMs : Math.max(1000, initialExpiry - Date.now());
  const safetyMarginMs = Math.min(250, Math.max(1, Math.floor(leaseMs * 0.05)));
  const renewalIntervalMs = Math.min(Math.max(1, Math.floor(leaseMs / 3)),
    Number.isFinite(leasePolicy?.renewIntervalMs) ? Math.max(250, Math.floor(leasePolicy.renewIntervalMs)) : 30000);
  let heartbeat = null, deadlineTimer = null, stopped = false;
  let confirmedExpiryMs = initialExpiry, deadlineAt = now() + initialExpiry - Date.now() - safetyMarginMs;
  let confirmedAt = now(), inFlightAt = null, failures = 0;
  let lastFailureLogAt = -Infinity;
  const cancelTimers = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    heartbeat = null; deadlineTimer = null;
  };
  const snapshot = () => ({
    ownerId, leaseVersion: version, executionId: job.observability?.correlation?.correlationId || null,
    lastConfirmedExpiry: Number.isFinite(confirmedExpiryMs) ? new Date(confirmedExpiryMs).toISOString() : null,
    timeSinceConfirmationMs: Math.max(0, now() - confirmedAt),
    renewalInFlightAgeMs: inFlightAt === null ? null : Math.max(0, now() - inFlightAt),
    safetyMarginMs, consecutiveFailures: failures, cancellationReason: claimControl.leaseLost?.code || null,
    cleanupPending: claimControl.cleanupSettled !== true
  });
  const lose = error => {
    if (claimControl.leaseLost) return false;
    claimControl.leaseLost = error;
    cancelTimers();
    if (!claimControl.abortController.signal.aborted) claimControl.abortController.abort(error);
    console.error(`[indexer] job ${job.id} lease authority lost: ${error.message}`, {
      event: 'queue-lease-authority-lost', jobId: job.id, ...snapshot()
    });
    return false;
  };
  const checkAuthority = () => {
    if (claimControl.leaseLost) return false;
    if (!Number.isFinite(deadlineAt) || now() >= deadlineAt || Date.now() >= confirmedExpiryMs - safetyMarginMs) {
      return lose(failure('QUEUE_LEASE_EXPIRED', `Job ${job.id} exceeded its last confirmed lease authority.`));
    }
    return true;
  };
  const armDeadline = () => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    deadlineTimer = null;
    if (stopped || !checkAuthority()) return;
    deadlineTimer = setTimeout(() => { deadlineTimer = null; if (checkAuthority()) armDeadline(); },
      Math.max(1, Math.ceil(deadlineAt - now())));
  };
  const confirm = observed => {
    if (stopped || claimControl.leaseLost || !checkAuthority()) return;
    if (observed === null || (observed?.status && observed.status !== 'running')) {
      throw failure('QUEUE_INVALID_TRANSITION', `Job ${job.id} no longer has a running queue claim.`);
    }
    if (observed?.lease?.owner && observed.lease.owner !== ownerId) {
      throw failure('QUEUE_LEASE_MISMATCH', `Job ${job.id} renewal belongs to another owner.`);
    }
    if (Number.isSafeInteger(observed?.lease?.version) && observed.lease.version !== version) {
      throw failure('QUEUE_LEASE_VERSION_MISMATCH', `Job ${job.id} renewal belongs to another claim version.`);
    }
    const expiresAt = Date.parse(observed?.lease?.expiresAt || '');
    if (observed?.id !== job.id || observed?.status !== 'running' || observed?.lease?.owner !== ownerId
      || observed?.lease?.version !== version || !Number.isFinite(expiresAt)) {
      throw failure('QUEUE_LEASE_UNCONFIRMED', `Job ${job.id} renewal did not return a persisted claim receipt.`);
    }
    // Anchor to the original monotonic deadline. A no-write heartbeat with the
    // same expiry, late I/O or wall-clock rollback cannot extend authority.
    deadlineAt += expiresAt - confirmedExpiryMs;
    confirmedExpiryMs = expiresAt;
    confirmedAt = now(); failures = 0;
    armDeadline();
  };
  claimControl.checkLeaseAuthority = checkAuthority;
  claimControl.leaseDiagnostics = snapshot;
  jobLifecycle.registerCleanup(() => { stopped = true; cancelTimers(); }, { label: 'indexer-service-claim-renewal-stop' });
  if (job.status !== 'running' || job.lease?.owner !== ownerId || !Number.isSafeInteger(version) || version < 1
    || !Number.isFinite(initialExpiry)) {
    lose(failure('QUEUE_LEASE_UNCONFIRMED', `Job ${job.id} claim has no confirmed persisted lease receipt.`));
    return;
  }
  if (!checkAuthority()) return;
  armDeadline();
  heartbeat = setInterval(() => {
    if (stopped || jobLifecycle.isClosed() || !checkAuthority() || inFlightAt !== null) return;
    inFlightAt = now();
    const renewal = (async () => {
      const replayState = await loadReplayState(job);
      if (stopped || !checkAuthority()) return;
      return touchHeartbeat({ ownerId, expectedLeaseVersion: version, leaseMs,
        renewIntervalMs: renewalIntervalMs, progressIntervalMs: leasePolicy?.progressIntervalMs ?? null,
        minIntervalMs: renewalIntervalMs, replayState,
        progress: { kind: 'renewal', note: `workload=${leasePolicy?.workloadClass || 'balanced'}` } });
    })().then(confirm).catch(error => {
      if (stopped || claimControl.leaseLost) return;
      failures++;
      if (FENCE_ERRORS.has(error?.code)) { lose(error); return; }
      const limit = Number.isFinite(leasePolicy?.maxConsecutiveRenewalFailures)
        ? Math.max(1, Math.floor(leasePolicy.maxConsecutiveRenewalFailures)) : 3;
      const at = now();
      if (failures <= limit || at - lastFailureLogAt >= Math.max(1000, renewalIntervalMs)) {
        lastFailureLogAt = at;
        console.error(`[indexer] job ${job.id} lease renewal failed: ${error?.message || error}`, {
          event: 'queue-lease-renewal-failed', jobId: job.id, ...snapshot()
        });
      }
    }).finally(() => { inFlightAt = null; });
    jobLifecycle.registerPromise(renewal, { label: 'indexer-service-job-heartbeat-renewal' });
  }, renewalIntervalMs);
};

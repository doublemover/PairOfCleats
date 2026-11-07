/** Positive simulated queue claims use the same persisted lease fields as the
 * real queue. Callers retain explicit control of negative renewal responses. */
export const createQueueClaimFixture = (job, claimOptions, { leaseMs = claimOptions.leaseMs || 300000 } = {}) => {
  const at = Date.now();
  return { ...job, status: 'running', lease: { ...job.lease,
    owner: claimOptions.ownerId, version: job.lease?.version || 1,
    acquiredAt: new Date(at).toISOString(), renewedAt: new Date(at).toISOString(),
    expiresAt: new Date(at + leaseMs).toISOString() } };
};

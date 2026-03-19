const LEASE_POLICY_BY_WORKLOAD = Object.freeze({
  balanced: Object.freeze({
    leaseMs: 5 * 60 * 1000,
    renewIntervalMs: 30 * 1000,
    progressIntervalMs: 30 * 1000
  }),
  bursty: Object.freeze({
    leaseMs: 10 * 60 * 1000,
    renewIntervalMs: 20 * 1000,
    progressIntervalMs: 15 * 1000
  }),
  slow: Object.freeze({
    leaseMs: 15 * 60 * 1000,
    renewIntervalMs: 60 * 1000,
    progressIntervalMs: 30 * 1000
  })
});

const normalizeQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw || 'index';
};

export const resolveLeaseWorkloadClass = ({ job = null, queueName = null } = {}) => {
  const normalizedQueue = normalizeQueueName(queueName);
  const stage = typeof job?.stage === 'string' ? job.stage.trim().toLowerCase() : '';
  if (
    normalizedQueue === 'embeddings'
    || normalizedQueue.startsWith('embeddings-')
    || job?.reason === 'embeddings'
    || stage === 'stage3'
  ) {
    return 'slow';
  }
  if (stage === 'stage2' || normalizedQueue.includes('stage2') || job?.mode === 'both') {
    return 'bursty';
  }
  return 'balanced';
};

export const resolveQueueLeasePolicy = ({
  job = null,
  queueName = null,
  overrides = null
} = {}) => {
  const normalizedQueue = normalizeQueueName(queueName);
  const stage = typeof job?.stage === 'string' ? job.stage.trim().toLowerCase() : '';
  const workloadClass = resolveLeaseWorkloadClass({ job, queueName: normalizedQueue });
  const base = LEASE_POLICY_BY_WORKLOAD[workloadClass] || LEASE_POLICY_BY_WORKLOAD.balanced;
  const overrideLeaseMs = Number(overrides?.leaseMs);
  const overrideRenewMs = Number(overrides?.renewIntervalMs);
  const overrideProgressMs = Number(overrides?.progressIntervalMs);
  const leaseMs = Number.isFinite(overrideLeaseMs) && overrideLeaseMs > 0
    ? Math.max(1000, Math.trunc(overrideLeaseMs))
    : base.leaseMs;
  const renewIntervalMs = Number.isFinite(overrideRenewMs) && overrideRenewMs > 0
    ? Math.max(250, Math.trunc(overrideRenewMs))
    : base.renewIntervalMs;
  const progressIntervalMs = Number.isFinite(overrideProgressMs) && overrideProgressMs > 0
    ? Math.max(250, Math.trunc(overrideProgressMs))
    : base.progressIntervalMs;
  return {
    queueName: normalizedQueue,
    stage: stage || null,
    workloadClass,
    leaseMs,
    renewIntervalMs: Math.min(renewIntervalMs, leaseMs),
    progressIntervalMs: Math.min(progressIntervalMs, leaseMs),
    maxRenewalGapMs: Math.max(leaseMs - renewIntervalMs, renewIntervalMs),
    maxConsecutiveRenewalFailures: 3
  };
};

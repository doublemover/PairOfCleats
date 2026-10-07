const DEFAULT_RETENTION_POLICY = Object.freeze({
  doneJobs: 50,
  failedJobs: 50,
  quarantinedJobs: 100,
  retriedQuarantinedJobs: 100,
  cleanupLogs: true,
  cleanupReports: true,
  rewriteJournal: true
});

const normalizeRetentionCount = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.trunc(parsed));
};

const normalizeBoolean = (value, fallback) => {
  if (value === true || value === false) return value;
  return fallback;
};

export const QUEUE_RETENTION_DEFAULTS = DEFAULT_RETENTION_POLICY;

export function resolveQueueRetentionPolicy({ queueName = null, queueConfig = {} } = {}) {
  const retention = queueConfig?.retention && typeof queueConfig.retention === 'object'
    ? queueConfig.retention
    : {};
  return {
    queueName: queueName || 'index',
    doneJobs: normalizeRetentionCount(retention.doneJobs, DEFAULT_RETENTION_POLICY.doneJobs),
    failedJobs: normalizeRetentionCount(retention.failedJobs, DEFAULT_RETENTION_POLICY.failedJobs),
    quarantinedJobs: normalizeRetentionCount(
      retention.quarantinedJobs,
      DEFAULT_RETENTION_POLICY.quarantinedJobs
    ),
    retriedQuarantinedJobs: normalizeRetentionCount(
      retention.retriedQuarantinedJobs,
      DEFAULT_RETENTION_POLICY.retriedQuarantinedJobs
    ),
    cleanupLogs: normalizeBoolean(retention.cleanupLogs, DEFAULT_RETENTION_POLICY.cleanupLogs),
    cleanupReports: normalizeBoolean(retention.cleanupReports, DEFAULT_RETENTION_POLICY.cleanupReports),
    rewriteJournal: normalizeBoolean(retention.rewriteJournal, DEFAULT_RETENTION_POLICY.rewriteJournal)
  };
}

const DEFAULT_INDEX_JOB_COST = 1;
const DEFAULT_EMBEDDING_JOB_COST = 4;

const toNonNegativeIntOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(0, Math.floor(parsed));
};

export function resolveQueueAdmissionPolicy({
  queueName = null,
  queueConfig = {},
  workerConfig = {}
} = {}) {
  const normalizedQueueName = typeof queueName === 'string' && queueName.trim()
    ? queueName.trim()
    : 'index';
  const isEmbeddings = normalizedQueueName === 'embeddings';
  const workerConcurrency = toNonNegativeIntOrNull(workerConfig?.concurrency) || 1;
  const maxQueued = toNonNegativeIntOrNull(queueConfig?.maxQueued);
  const maxRunning = toNonNegativeIntOrNull(queueConfig?.maxRunning) ?? workerConcurrency;
  const maxTotal = toNonNegativeIntOrNull(queueConfig?.maxTotal)
    ?? ((maxQueued ?? (isEmbeddings ? 10 : 20)) + maxRunning);
  const resourceBudgetUnits = toNonNegativeIntOrNull(queueConfig?.resourceBudgetUnits)
    ?? (maxRunning * (isEmbeddings ? 8 : 4));
  return {
    queueName: normalizedQueueName,
    queueClass: isEmbeddings ? 'embeddings' : 'index',
    maxQueued,
    maxRunning,
    maxTotal,
    resourceBudgetUnits
  };
}

export function resolveQueueJobCost(job = {}, queueName = null) {
  const normalizedQueueName = typeof queueName === 'string' && queueName.trim()
    ? queueName.trim()
    : (job?.queueName || 'index');
  if (normalizedQueueName === 'embeddings' || job?.reason === 'embeddings') {
    return DEFAULT_EMBEDDING_JOB_COST;
  }
  if (job?.stage === 'stage3') return 3;
  if (job?.stage === 'stage2') return 2;
  if (job?.mode === 'both') return 2;
  return DEFAULT_INDEX_JOB_COST;
}

export function evaluateQueueBackpressure({
  jobs = [],
  queueName = null,
  policy = resolveQueueAdmissionPolicy({ queueName })
} = {}) {
  const queued = jobs.filter((job) => job?.status === 'queued');
  const running = jobs.filter((job) => job?.status === 'running');
  const active = jobs.filter((job) => job?.status === 'queued' || job?.status === 'running');
  const resourceUnitsInUse = active.reduce((sum, job) => sum + resolveQueueJobCost(job, queueName), 0);
  const reasons = [];
  const runningSaturated = Number.isFinite(policy.maxRunning) && running.length >= policy.maxRunning;
  const queuedSaturated = Number.isFinite(policy.maxQueued) && queued.length >= policy.maxQueued;
  const totalSaturated = Number.isFinite(policy.maxTotal) && active.length >= policy.maxTotal;
  const resourceSaturated = Number.isFinite(policy.resourceBudgetUnits)
    && resourceUnitsInUse >= policy.resourceBudgetUnits;
  if (runningSaturated) reasons.push('max_running');
  if (queuedSaturated) reasons.push('max_queued');
  if (totalSaturated) reasons.push('max_total');
  if (resourceSaturated) reasons.push('resource_budget');
  const state = reasons.length === 0
    ? 'normal'
    : (queuedSaturated || totalSaturated || resourceSaturated ? 'saturated' : 'congested');
  return {
    state,
    reasons,
    queued: queued.length,
    running: running.length,
    totalActive: active.length,
    resourceUnitsInUse,
    thresholds: {
      maxQueued: policy.maxQueued,
      maxRunning: policy.maxRunning,
      maxTotal: policy.maxTotal,
      resourceBudgetUnits: policy.resourceBudgetUnits
    }
  };
}

export function resolveEnqueueBackpressure({
  jobs = [],
  job = {},
  queueName = null,
  policy = resolveQueueAdmissionPolicy({ queueName })
} = {}) {
  const current = evaluateQueueBackpressure({ jobs, queueName, policy });
  const projectedQueued = current.queued + 1;
  const projectedTotal = current.totalActive + 1;
  const projectedResourceUnits = current.resourceUnitsInUse + resolveQueueJobCost(job, queueName);
  if (Number.isFinite(policy.maxQueued) && projectedQueued > policy.maxQueued) {
    return {
      code: 'QUEUE_BACKPRESSURE_MAX_QUEUED',
      message: 'Queue queued limit reached.',
      state: 'saturated',
      reason: 'max_queued',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits
    };
  }
  if (Number.isFinite(policy.maxTotal) && projectedTotal > policy.maxTotal) {
    return {
      code: 'QUEUE_BACKPRESSURE_MAX_TOTAL',
      message: 'Queue active-work limit reached.',
      state: 'saturated',
      reason: 'max_total',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits
    };
  }
  if (Number.isFinite(policy.resourceBudgetUnits) && projectedResourceUnits > policy.resourceBudgetUnits) {
    return {
      code: 'QUEUE_BACKPRESSURE_RESOURCE_BUDGET',
      message: 'Queue resource budget reached.',
      state: 'saturated',
      reason: 'resource_budget',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits
    };
  }
  return null;
}

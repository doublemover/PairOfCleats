const DEFAULT_INDEX_JOB_COST = 1;
const DEFAULT_EMBEDDING_JOB_COST = 4;
const DEFAULT_INDEX_SLO = Object.freeze({
  maxQueueAgeMs: {
    degraded: 5 * 60 * 1000,
    overloaded: 15 * 60 * 1000
  },
  maxRunLatencyMs: {
    degraded: 20 * 60 * 1000,
    overloaded: 45 * 60 * 1000
  },
  maxRetryRate: {
    degraded: 0.15,
    overloaded: 0.35
  },
  maxSaturationRatio: {
    degraded: 0.75,
    overloaded: 1
  },
  deferDelayMs: {
    degraded: 2 * 60 * 1000,
    overloaded: 10 * 60 * 1000
  }
});
const DEFAULT_EMBEDDINGS_SLO = Object.freeze({
  maxQueueAgeMs: {
    degraded: 15 * 60 * 1000,
    overloaded: 45 * 60 * 1000
  },
  maxRunLatencyMs: {
    degraded: 45 * 60 * 1000,
    overloaded: 120 * 60 * 1000
  },
  maxRetryRate: {
    degraded: 0.1,
    overloaded: 0.25
  },
  maxSaturationRatio: {
    degraded: 0.7,
    overloaded: 0.95
  },
  deferDelayMs: {
    degraded: 5 * 60 * 1000,
    overloaded: 20 * 60 * 1000
  }
});

const toNonNegativeIntOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(0, Math.floor(parsed));
};

const toRatioOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(1, Math.max(0, parsed));
};

const resolveSloPair = (source = {}, defaults = {}) => ({
  degraded: toNonNegativeIntOrNull(source?.degraded) ?? defaults.degraded ?? null,
  overloaded: toNonNegativeIntOrNull(source?.overloaded) ?? defaults.overloaded ?? null
});

const resolveSloRatioPair = (source = {}, defaults = {}) => ({
  degraded: toRatioOrNull(source?.degraded) ?? defaults.degraded ?? null,
  overloaded: toRatioOrNull(source?.overloaded) ?? defaults.overloaded ?? null
});

const resolveJobTimestampAgeMs = (job, fieldNames, nowMs) => {
  for (const fieldName of fieldNames) {
    const raw = job?.[fieldName];
    const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    if (!Number.isNaN(parsed)) {
      return Math.max(0, nowMs - parsed);
    }
  }
  return 0;
};

const resolveLoadShedTier = (job = {}, queueName = null) => {
  const jobCost = resolveQueueJobCost(job, queueName);
  if (jobCost >= 3) return 'heavy';
  if (jobCost >= 2) return 'standard';
  return 'light';
};

const buildSloReason = (reason, severity, actual, threshold) => ({
  reason,
  severity,
  actual,
  threshold
});

export function resolveQueueAdmissionPolicy({
  queueName = null,
  queueConfig = {},
  workerConfig = {}
} = {}) {
  const normalizedQueueName = typeof queueName === 'string' && queueName.trim()
    ? queueName.trim()
    : 'index';
  const isEmbeddings = normalizedQueueName === 'embeddings' || normalizedQueueName.startsWith('embeddings-');
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

export function resolveQueueSloPolicy({
  queueName = null,
  queueConfig = {},
  workerConfig = {}
} = {}) {
  const admission = resolveQueueAdmissionPolicy({
    queueName,
    queueConfig,
    workerConfig
  });
  const defaults = admission.queueClass === 'embeddings'
    ? DEFAULT_EMBEDDINGS_SLO
    : DEFAULT_INDEX_SLO;
  const sloConfig = queueConfig?.slo && typeof queueConfig.slo === 'object'
    ? queueConfig.slo
    : {};
  return {
    queueName: admission.queueName,
    queueClass: admission.queueClass,
    maxQueueAgeMs: resolveSloPair(sloConfig.maxQueueAgeMs, defaults.maxQueueAgeMs),
    maxRunLatencyMs: resolveSloPair(sloConfig.maxRunLatencyMs, defaults.maxRunLatencyMs),
    maxRetryRate: resolveSloRatioPair(sloConfig.maxRetryRate, defaults.maxRetryRate),
    maxSaturationRatio: resolveSloRatioPair(sloConfig.maxSaturationRatio, defaults.maxSaturationRatio),
    deferDelayMs: resolveSloPair(sloConfig.deferDelayMs, defaults.deferDelayMs)
  };
}

export function resolveQueueJobCost(job = {}, queueName = null) {
  const normalizedQueueName = typeof queueName === 'string' && queueName.trim()
    ? queueName.trim()
    : (job?.queueName || 'index');
  if (
    normalizedQueueName === 'embeddings'
    || normalizedQueueName.startsWith('embeddings-')
    || job?.reason === 'embeddings'
  ) {
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
  policy = resolveQueueAdmissionPolicy({ queueName }),
  sloPolicy = resolveQueueSloPolicy({ queueName }),
  nowMs = Date.now()
} = {}) {
  const queued = jobs.filter((job) => job?.status === 'queued');
  const running = jobs.filter((job) => job?.status === 'running');
  const active = jobs.filter((job) => job?.status === 'queued' || job?.status === 'running');
  const resourceUnitsInUse = active.reduce((sum, job) => sum + resolveQueueJobCost(job, queueName), 0);
  const retriedActive = active.filter((job) => Number.isFinite(Number(job?.attempts)) && Number(job.attempts) > 0);
  const retryRate = active.length > 0
    ? Number((retriedActive.length / active.length).toFixed(4))
    : 0;
  const oldestQueuedAgeMs = queued.reduce(
    (max, job) => Math.max(max, resolveJobTimestampAgeMs(job, ['createdAt'], nowMs)),
    0
  );
  const oldestRunLatencyMs = running.reduce(
    (max, job) => Math.max(max, resolveJobTimestampAgeMs(job, ['startedAt', 'createdAt'], nowMs)),
    0
  );
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
  const saturationRatio = Math.max(
    Number.isFinite(policy.maxQueued) && policy.maxQueued > 0 ? queued.length / policy.maxQueued : 0,
    Number.isFinite(policy.maxRunning) && policy.maxRunning > 0 ? running.length / policy.maxRunning : 0,
    Number.isFinite(policy.maxTotal) && policy.maxTotal > 0 ? active.length / policy.maxTotal : 0,
    Number.isFinite(policy.resourceBudgetUnits) && policy.resourceBudgetUnits > 0
      ? resourceUnitsInUse / policy.resourceBudgetUnits
      : 0
  );
  const sloReasons = [];
  const pushSloReason = (reason, actual, thresholds = {}) => {
    if (thresholds.overloaded !== null && thresholds.overloaded !== undefined && actual >= thresholds.overloaded) {
      sloReasons.push(buildSloReason(reason, 'overloaded', actual, thresholds.overloaded));
      return;
    }
    if (thresholds.degraded !== null && thresholds.degraded !== undefined && actual >= thresholds.degraded) {
      sloReasons.push(buildSloReason(reason, 'degraded', actual, thresholds.degraded));
    }
  };
  pushSloReason('queue_age', oldestQueuedAgeMs, sloPolicy.maxQueueAgeMs);
  pushSloReason('run_latency', oldestRunLatencyMs, sloPolicy.maxRunLatencyMs);
  pushSloReason('retry_rate', retryRate, sloPolicy.maxRetryRate);
  pushSloReason('saturation', saturationRatio, sloPolicy.maxSaturationRatio);
  const sloState = sloReasons.some((entry) => entry.severity === 'overloaded')
    ? 'overloaded'
    : (sloReasons.length > 0 ? 'degraded' : 'healthy');
  const workerMode = sloState === 'healthy' ? 'normal' : 'priority-only';
  const enqueueMode = sloState === 'healthy'
    ? 'accept'
    : (sloState === 'degraded' ? 'defer-heavy' : 'shed-heavy');
  return {
    state,
    reasons,
    queued: queued.length,
    running: running.length,
    totalActive: active.length,
    resourceUnitsInUse,
    saturationRatio: Number(Number.isFinite(saturationRatio) ? saturationRatio.toFixed(4) : 0),
    retryRate,
    oldestQueuedAgeMs,
    oldestRunLatencyMs,
    slo: {
      state: sloState,
      reasons: sloReasons,
      actions: {
        enqueue: enqueueMode,
        workerMode
      },
      metrics: {
        oldestQueuedAgeMs,
        oldestRunLatencyMs,
        retryRate,
        saturationRatio: Number(Number.isFinite(saturationRatio) ? saturationRatio.toFixed(4) : 0)
      },
      thresholds: {
        maxQueueAgeMs: sloPolicy.maxQueueAgeMs,
        maxRunLatencyMs: sloPolicy.maxRunLatencyMs,
        maxRetryRate: sloPolicy.maxRetryRate,
        maxSaturationRatio: sloPolicy.maxSaturationRatio,
        deferDelayMs: sloPolicy.deferDelayMs
      }
    },
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
  policy = resolveQueueAdmissionPolicy({ queueName }),
  sloPolicy = resolveQueueSloPolicy({ queueName }),
  nowMs = Date.now()
} = {}) {
  const current = evaluateQueueBackpressure({ jobs, queueName, policy, sloPolicy, nowMs });
  const projectedQueued = current.queued + 1;
  const projectedTotal = current.totalActive + 1;
  const projectedResourceUnits = current.resourceUnitsInUse + resolveQueueJobCost(job, queueName);
  if (Number.isFinite(policy.maxQueued) && projectedQueued > policy.maxQueued) {
    return {
      action: 'reject',
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
      action: 'reject',
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
      action: 'reject',
      code: 'QUEUE_BACKPRESSURE_RESOURCE_BUDGET',
      message: 'Queue resource budget reached.',
      state: 'saturated',
      reason: 'resource_budget',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits
    };
  }
  const jobTier = resolveLoadShedTier(job, queueName);
  if (current.slo.state === 'overloaded' && jobTier === 'heavy') {
    return {
      action: 'reject',
      code: 'QUEUE_SLO_OVERLOADED',
      message: 'Queue overloaded; heavy work rejected to preserve service SLOs.',
      state: current.state === 'normal' ? 'congested' : current.state,
      reason: 'slo_overloaded_heavy',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits,
      jobTier
    };
  }
  if ((current.slo.state === 'degraded' && jobTier === 'heavy') || (current.slo.state === 'overloaded' && jobTier !== 'light')) {
    const delayMs = current.slo.state === 'overloaded'
      ? (sloPolicy.deferDelayMs.overloaded ?? sloPolicy.deferDelayMs.degraded ?? 0)
      : (sloPolicy.deferDelayMs.degraded ?? 0);
    const deferredUntil = delayMs > 0
      ? new Date(nowMs + delayMs).toISOString()
      : new Date(nowMs).toISOString();
    return {
      action: 'defer',
      code: null,
      message: current.slo.state === 'overloaded'
        ? 'Queue overloaded; non-priority work deferred behind recovery window.'
        : 'Queue degraded; heavy work deferred to preserve interactive throughput.',
      state: current.state,
      reason: current.slo.state === 'overloaded' ? 'slo_overloaded_defer' : 'slo_degraded_defer',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits,
      deferredUntil,
      delayMs,
      jobTier
    };
  }
  if (current.slo.state !== 'healthy') {
    return {
      action: 'accept',
      code: null,
      message: 'Queue accepting priority work in degraded mode.',
      state: current.state,
      reason: 'slo_priority_only',
      projectedQueued,
      projectedTotal,
      projectedResourceUnits,
      jobTier
    };
  }
  return null;
}

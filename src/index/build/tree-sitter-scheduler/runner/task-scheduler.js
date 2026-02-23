import os from 'node:os';

const DEFAULT_WARM_POOL_MIN_KEYS_FOR_SPLIT = 8;
const DEFAULT_SCHEDULER_TASK_TIMEOUT_MS = 120000;
const DEFAULT_SCHEDULER_TASK_TIMEOUT_BASE_MS = 30000;
const DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_WAVE_MS = 15000;
const DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_JOB_MS = 120;
const MIN_SCHEDULER_TASK_TIMEOUT_MS = 10000;
const MAX_SCHEDULER_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Resolve scheduler subprocess fanout bounded by grammar cardinality.
 *
 * @param {{schedulerConfig?:object,grammarCount:number}} input
 * @returns {number}
 */
export const resolveExecConcurrency = ({ schedulerConfig, grammarCount }) => {
  if (!Number.isFinite(grammarCount) || grammarCount <= 1) return 1;
  const configured = Number(
    schedulerConfig?.execConcurrency
      ?? schedulerConfig?.subprocessConcurrency
      ?? schedulerConfig?.concurrency
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(grammarCount, Math.floor(configured)));
  }
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : 4;
  const auto = Math.max(1, Math.min(8, Math.floor((available || 1) / 2)));
  return Math.max(1, Math.min(grammarCount, auto));
};

/**
 * Resolve deterministic execution order for scheduler tasks.
 *
 * `executionOrder` is the canonical scheduler plan contract. Missing or empty
 * execution order indicates stale/corrupt plan artifacts and must fail closed,
 * except for empty no-op plans that schedule no grammar work.
 *
 * @param {{executionOrder?:string[]}} [plan]
 * @returns {string[]}
 */
export const resolveExecutionOrder = (plan = {}) => {
  const executionOrder = Array.isArray(plan?.executionOrder) ? plan.executionOrder : [];
  if (executionOrder.length) {
    return executionOrder.slice();
  }
  const grammarKeys = Array.isArray(plan?.grammarKeys)
    ? plan.grammarKeys.filter((key) => typeof key === 'string' && key)
    : [];
  const plannedJobsRaw = Number(plan?.jobs);
  const hasPlannedJobs = Number.isFinite(plannedJobsRaw) ? plannedJobsRaw > 0 : false;
  if (!grammarKeys.length && !hasPlannedJobs) {
    return [];
  }
  throw new Error(
    '[tree-sitter:schedule] scheduler plan missing executionOrder; rebuild scheduler artifacts.'
  );
};

/**
 * Choose lane count for a base grammar warm pool.
 *
 * @param {{
 *  schedulerConfig?:object,
 *  baseGrammarKey:string,
 *  keyCount:number,
 *  execConcurrency:number
 * }} input
 * @returns {number}
 */
const resolveWarmPoolLaneCount = ({
  schedulerConfig,
  baseGrammarKey,
  keyCount,
  execConcurrency
}) => {
  if (!Number.isFinite(keyCount) || keyCount <= 1) return 1;
  const perGrammarRaw = Number(
    schedulerConfig?.warmPoolPerGrammar
      ?? schedulerConfig?.parserWarmPoolPerGrammar
      ?? schedulerConfig?.warmPools?.[baseGrammarKey]
  );
  if (Number.isFinite(perGrammarRaw) && perGrammarRaw > 0) {
    return Math.max(1, Math.min(keyCount, Math.floor(perGrammarRaw)));
  }
  const configuredMinKeysRaw = Number(
    schedulerConfig?.warmPoolMinKeysForSplit
      ?? schedulerConfig?.warmPoolSplitMinKeys
  );
  const minKeysForSplit = Number.isFinite(configuredMinKeysRaw) && configuredMinKeysRaw > 0
    ? Math.max(2, Math.floor(configuredMinKeysRaw))
    : DEFAULT_WARM_POOL_MIN_KEYS_FOR_SPLIT;
  if (keyCount < minKeysForSplit) return 1;
  const byConcurrency = Number.isFinite(execConcurrency) && execConcurrency > 0
    ? Math.max(1, Math.floor(execConcurrency / 2))
    : 1;
  let heuristic = 2;
  if (keyCount >= 64) {
    heuristic = 8;
  } else if (keyCount >= 32) {
    heuristic = 6;
  } else if (keyCount >= 16) {
    heuristic = 4;
  } else if (keyCount >= 8) {
    heuristic = 3;
  }
  return Math.max(1, Math.min(keyCount, byConcurrency, heuristic));
};

/**
 * Clamp scheduler task timeout to a safe operating band.
 *
 * @param {unknown} value
 * @param {unknown} [maxValue]
 * @returns {number}
 */
const clampSchedulerTaskTimeoutMs = (value, maxValue = MAX_SCHEDULER_TASK_TIMEOUT_MS) => {
  const parsed = Number(value);
  const resolvedMax = Number.isFinite(Number(maxValue)) && Number(maxValue) >= MIN_SCHEDULER_TASK_TIMEOUT_MS
    ? Math.floor(Number(maxValue))
    : MAX_SCHEDULER_TASK_TIMEOUT_MS;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(DEFAULT_SCHEDULER_TASK_TIMEOUT_MS, resolvedMax);
  }
  const normalized = Math.floor(parsed);
  return Math.max(MIN_SCHEDULER_TASK_TIMEOUT_MS, Math.min(resolvedMax, normalized));
};

/**
 * Resolve per-subprocess timeout using explicit override or workload heuristic.
 *
 * @param {{
 *  schedulerConfig?:object,
 *  task?:{grammarKeys?:string[]},
 *  groupByGrammarKey?:Map<string,object>
 * }} input
 * @returns {number}
 */
export const resolveSchedulerTaskTimeoutMs = ({
  schedulerConfig,
  task,
  groupByGrammarKey
}) => {
  const explicitTimeoutRaw = Number(
    schedulerConfig?.subprocessTimeoutMs
      ?? schedulerConfig?.taskTimeoutMs
  );
  const maxTimeoutRaw = Number(
    schedulerConfig?.subprocessTimeoutMaxMs
      ?? schedulerConfig?.taskTimeoutMaxMs
      ?? MAX_SCHEDULER_TASK_TIMEOUT_MS
  );
  if (Number.isFinite(explicitTimeoutRaw) && explicitTimeoutRaw > 0) {
    return clampSchedulerTaskTimeoutMs(explicitTimeoutRaw, maxTimeoutRaw);
  }

  const timeoutBaseMsRaw = Number(
    schedulerConfig?.subprocessTimeoutBaseMs
      ?? schedulerConfig?.taskTimeoutBaseMs
      ?? DEFAULT_SCHEDULER_TASK_TIMEOUT_BASE_MS
  );
  const timeoutPerWaveMsRaw = Number(
    schedulerConfig?.subprocessTimeoutPerWaveMs
      ?? schedulerConfig?.taskTimeoutPerWaveMs
      ?? DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_WAVE_MS
  );
  const timeoutPerJobMsRaw = Number(
    schedulerConfig?.subprocessTimeoutPerJobMs
      ?? schedulerConfig?.taskTimeoutPerJobMs
      ?? DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_JOB_MS
  );
  const timeoutBaseMs = Number.isFinite(timeoutBaseMsRaw) && timeoutBaseMsRaw > 0
    ? Math.floor(timeoutBaseMsRaw)
    : DEFAULT_SCHEDULER_TASK_TIMEOUT_BASE_MS;
  const timeoutPerWaveMs = Number.isFinite(timeoutPerWaveMsRaw) && timeoutPerWaveMsRaw >= 0
    ? Math.floor(timeoutPerWaveMsRaw)
    : DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_WAVE_MS;
  const timeoutPerJobMs = Number.isFinite(timeoutPerJobMsRaw) && timeoutPerJobMsRaw >= 0
    ? Math.floor(timeoutPerJobMsRaw)
    : DEFAULT_SCHEDULER_TASK_TIMEOUT_PER_JOB_MS;
  const resolveTaskGroupJobs = (grammarKey) => {
    if (!(groupByGrammarKey instanceof Map) || !grammarKey) return 0;
    const group = groupByGrammarKey.get(grammarKey);
    if (Array.isArray(group?.jobs)) return group.jobs.length;
    const jobs = Number(group?.jobs);
    if (!Number.isFinite(jobs) || jobs <= 0) return 0;
    return Math.floor(jobs);
  };
  const grammarKeysForTask = Array.isArray(task?.grammarKeys) ? task.grammarKeys : [];
  const waveCount = grammarKeysForTask.length;
  let jobCount = 0;
  for (const grammarKey of grammarKeysForTask) {
    jobCount += resolveTaskGroupJobs(grammarKey);
  }
  const computedTimeoutMs = timeoutBaseMs + (waveCount * timeoutPerWaveMs) + (jobCount * timeoutPerJobMs);
  return clampSchedulerTaskTimeoutMs(computedTimeoutMs, maxTimeoutRaw);
};

/**
 * Build per-grammar warm-pool tasks by partitioning ordered wave keys into a
 * small number of long-lived subprocess lanes.
 *
 * @param {object} input
 * @returns {Array<{taskId:string,baseGrammarKey:string,laneIndex:number,laneCount:number,grammarKeys:Array<string>,firstOrder:number}>}
 */
export const buildWarmPoolTasks = ({
  executionOrder,
  groupMetaByGrammarKey,
  schedulerConfig,
  execConcurrency
}) => {
  const byBaseGrammar = new Map();
  const order = Array.isArray(executionOrder) ? executionOrder : [];
  for (let i = 0; i < order.length; i += 1) {
    const grammarKey = order[i];
    if (typeof grammarKey !== 'string' || !grammarKey) continue;
    const groupMeta = groupMetaByGrammarKey?.[grammarKey] || {};
    const baseGrammarKey = typeof groupMeta?.baseGrammarKey === 'string' && groupMeta.baseGrammarKey
      ? groupMeta.baseGrammarKey
      : grammarKey;
    if (!byBaseGrammar.has(baseGrammarKey)) byBaseGrammar.set(baseGrammarKey, []);
    byBaseGrammar.get(baseGrammarKey).push({ grammarKey, orderIndex: i });
  }
  const tasks = [];
  for (const [baseGrammarKey, keyed] of byBaseGrammar.entries()) {
    const laneCount = resolveWarmPoolLaneCount({
      schedulerConfig,
      baseGrammarKey,
      keyCount: keyed.length,
      execConcurrency
    });
    const lanes = Array.from({ length: laneCount }, () => []);
    for (let i = 0; i < keyed.length; i += 1) {
      lanes[i % laneCount].push(keyed[i]);
    }
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex];
      if (!lane.length) continue;
      tasks.push({
        taskId: `${baseGrammarKey}#pool${laneIndex + 1}`,
        baseGrammarKey,
        laneIndex: laneIndex + 1,
        laneCount,
        grammarKeys: lane.map((entry) => entry.grammarKey),
        firstOrder: lane.reduce((min, entry) => Math.min(min, entry.orderIndex), Number.POSITIVE_INFINITY)
      });
    }
  }
  tasks.sort((a, b) => {
    if (a.firstOrder !== b.firstOrder) return a.firstOrder - b.firstOrder;
    return String(a.taskId).localeCompare(String(b.taskId));
  });
  return tasks;
};

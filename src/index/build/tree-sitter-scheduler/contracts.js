import { buildVfsVirtualPath } from '../../tooling/vfs.js';

export const TREE_SITTER_SCHEDULER_FAILURE_SNAPSHOT_SCHEMA_VERSION = '1.0.0';

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const toNonNegativeInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const failContract = (phase, message) => {
  const error = new Error(`[tree-sitter:schedule] ${phase}: ${message}`);
  error.code = 'ERR_TREE_SITTER_SCHEDULER_CONTRACT';
  error.stage = phase;
  return error;
};

export const assertTreeSitterScheduledJobContract = (job, { phase = 'scheduler-contract' } = {}) => {
  if (!job || typeof job !== 'object') {
    throw failContract(phase, 'scheduled job must be an object');
  }
  const grammarKey = typeof job.grammarKey === 'string' ? job.grammarKey.trim() : '';
  const containerPath = typeof job.containerPath === 'string' ? job.containerPath.trim() : '';
  const virtualPath = typeof job.virtualPath === 'string' ? job.virtualPath.trim() : '';
  const languageId = typeof job.languageId === 'string' ? job.languageId.trim() : '';
  const segment = job.segment && typeof job.segment === 'object' ? job.segment : null;
  const segmentUid = typeof segment?.segmentUid === 'string' ? segment.segmentUid.trim() : '';
  const segmentStart = toNonNegativeInteger(job.segmentStart ?? segment?.start);
  const segmentEnd = toNonNegativeInteger(job.segmentEnd ?? segment?.end);
  if (!grammarKey) throw failContract(phase, 'scheduled job missing grammarKey');
  if (!containerPath) throw failContract(phase, `scheduled job missing containerPath (${grammarKey})`);
  if (!virtualPath) throw failContract(phase, `scheduled job missing virtualPath (${grammarKey})`);
  if (!languageId) throw failContract(phase, `scheduled job missing languageId (${grammarKey})`);
  if (!segment) throw failContract(phase, `scheduled job missing segment payload (${containerPath})`);
  if (!segmentUid) throw failContract(phase, `scheduled job missing segmentUid (${containerPath})`);
  if (segmentStart == null || segmentEnd == null || segmentEnd < segmentStart) {
    throw failContract(phase, `scheduled job has invalid segment range (${containerPath})`);
  }
  const expectedVirtualPath = buildVfsVirtualPath({
    containerPath,
    segmentUid,
    effectiveExt: job.effectiveExt || segment.ext || job.containerExt || ''
  });
  if (expectedVirtualPath !== virtualPath) {
    throw failContract(
      phase,
      `scheduled job virtualPath mismatch (${containerPath}); expected ${expectedVirtualPath} got ${virtualPath}`
    );
  }
  return {
    grammarKey,
    containerPath,
    virtualPath,
    languageId,
    segmentUid,
    segmentStart,
    segmentEnd
  };
};

export const assertTreeSitterScheduledGroupsContract = (groups, { phase = 'scheduler-contract' } = {}) => {
  const entries = Array.isArray(groups) ? groups : [];
  const grammarKeys = new Set();
  for (const group of entries) {
    const grammarKey = typeof group?.grammarKey === 'string' ? group.grammarKey.trim() : '';
    if (!grammarKey) throw failContract(phase, 'scheduled group missing grammarKey');
    if (grammarKeys.has(grammarKey)) {
      throw failContract(phase, `scheduled group grammarKey duplicated (${grammarKey})`);
    }
    grammarKeys.add(grammarKey);
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    for (const job of jobs) {
      assertTreeSitterScheduledJobContract(job, { phase });
    }
  }
  return true;
};

export const assertTreeSitterSchedulerTaskContracts = (
  tasks,
  {
    executionOrder = [],
    groupByGrammarKey = new Map(),
    phase = 'scheduler-dispatch'
  } = {}
) => {
  const orderSet = new Set((Array.isArray(executionOrder) ? executionOrder : []).filter(Boolean));
  const seenTaskIds = new Set();
  const scheduledKeys = new Set();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const taskId = typeof task?.taskId === 'string' ? task.taskId.trim() : '';
    if (!taskId) throw failContract(phase, 'scheduler task missing taskId');
    if (seenTaskIds.has(taskId)) throw failContract(phase, `scheduler task duplicated (${taskId})`);
    seenTaskIds.add(taskId);
    const laneIndex = toPositiveInteger(task?.laneIndex);
    const laneCount = toPositiveInteger(task?.laneCount);
    if (laneIndex == null || laneCount == null || laneIndex > laneCount) {
      throw failContract(phase, `scheduler task has invalid lane assignment (${taskId})`);
    }
    const timeoutMs = toPositiveInteger(task?.timeoutMs);
    if (timeoutMs == null) throw failContract(phase, `scheduler task missing timeoutMs (${taskId})`);
    const grammarKeys = Array.isArray(task?.grammarKeys) ? task.grammarKeys : [];
    if (!grammarKeys.length) throw failContract(phase, `scheduler task missing grammar keys (${taskId})`);
    for (const grammarKey of grammarKeys) {
      if (!orderSet.has(grammarKey)) {
        throw failContract(phase, `scheduler task references grammarKey outside executionOrder (${grammarKey})`);
      }
      if (scheduledKeys.has(grammarKey)) {
        throw failContract(phase, `scheduler task duplicates grammarKey dispatch (${grammarKey})`);
      }
      scheduledKeys.add(grammarKey);
      if (groupByGrammarKey instanceof Map && !groupByGrammarKey.has(grammarKey)) {
        throw failContract(phase, `scheduler task references missing group (${grammarKey})`);
      }
    }
  }
  for (const grammarKey of orderSet) {
    if (!scheduledKeys.has(grammarKey)) {
      throw failContract(phase, `scheduler task planning omitted executionOrder key (${grammarKey})`);
    }
  }
  return true;
};

export const buildTreeSitterPlannerFailureSnapshot = ({
  plan,
  groups,
  tasks,
  failureSummary = null
} = {}) => {
  const entries = Array.isArray(groups) ? groups : [];
  const taskEntries = Array.isArray(tasks) ? tasks : [];
  const taskByGrammarKey = new Map();
  for (const task of taskEntries) {
    for (const grammarKey of Array.isArray(task?.grammarKeys) ? task.grammarKeys : []) {
      if (!grammarKey || taskByGrammarKey.has(grammarKey)) continue;
      taskByGrammarKey.set(grammarKey, {
        taskId: task.taskId || null,
        laneIndex: toPositiveInteger(task.laneIndex),
        laneCount: toPositiveInteger(task.laneCount),
        timeoutMs: toPositiveInteger(task.timeoutMs)
      });
    }
  }
  const jobs = [];
  for (const group of entries) {
    const groupMeta = {
      grammarKey: group?.grammarKey || null,
      baseGrammarKey: group?.baseGrammarKey || group?.grammarKey || null,
      bucketKey: group?.bucketKey || group?.grammarKey || null,
      wave: group?.wave || null,
      shard: group?.shard || null
    };
    const taskMeta = taskByGrammarKey.get(groupMeta.grammarKey) || {
      taskId: null,
      laneIndex: null,
      laneCount: null,
      timeoutMs: null
    };
    for (const job of Array.isArray(group?.jobs) ? group.jobs : []) {
      const identity = assertTreeSitterScheduledJobContract(job, { phase: 'planner-snapshot' });
      jobs.push({
        grammarKey: groupMeta.grammarKey,
        baseGrammarKey: groupMeta.baseGrammarKey,
        bucketKey: groupMeta.bucketKey,
        wave: groupMeta.wave,
        shard: groupMeta.shard,
        taskId: taskMeta.taskId,
        laneIndex: taskMeta.laneIndex,
        laneCount: taskMeta.laneCount,
        timeoutMs: taskMeta.timeoutMs,
        containerPath: identity.containerPath,
        virtualPath: identity.virtualPath,
        languageId: identity.languageId,
        segmentUid: identity.segmentUid,
        segmentStart: identity.segmentStart,
        segmentEnd: identity.segmentEnd,
        parseMode: typeof job?.parseMode === 'string' ? job.parseMode : null,
        estimatedParseCost: toPositiveInteger(job?.estimatedParseCost) || 1
      });
    }
  }
  jobs.sort((a, b) => (
    String(a.grammarKey || '').localeCompare(String(b.grammarKey || ''))
    || String(a.containerPath || '').localeCompare(String(b.containerPath || ''))
    || String(a.segmentUid || '').localeCompare(String(b.segmentUid || ''))
    || (a.segmentStart - b.segmentStart)
    || (a.segmentEnd - b.segmentEnd)
  ));
  return {
    schemaVersion: TREE_SITTER_SCHEDULER_FAILURE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: plan?.mode || null,
    jobs: Number(plan?.jobs) || jobs.length,
    executionOrder: Array.isArray(plan?.executionOrder) ? plan.executionOrder.slice() : [],
    requiredNativeLanguages: Array.isArray(plan?.requiredNativeLanguages)
      ? plan.requiredNativeLanguages.slice()
      : [],
    failureSummary: failureSummary && typeof failureSummary === 'object'
      ? {
        parserCrashSignatures: toNonNegativeInteger(failureSummary?.parserCrashSignatures) || 0,
        failedGrammarKeys: Array.isArray(failureSummary?.failedGrammarKeys)
          ? failureSummary.failedGrammarKeys.slice()
          : [],
        degradedVirtualPaths: Array.isArray(failureSummary?.degradedVirtualPaths)
          ? failureSummary.degradedVirtualPaths.slice()
          : [],
        failureClasses: failureSummary?.failureClasses && typeof failureSummary.failureClasses === 'object'
          ? { ...failureSummary.failureClasses }
          : {}
      }
      : null,
    tasks: taskEntries.map((task) => ({
      taskId: task.taskId || null,
      baseGrammarKey: task.baseGrammarKey || null,
      laneIndex: toPositiveInteger(task.laneIndex),
      laneCount: toPositiveInteger(task.laneCount),
      timeoutMs: toPositiveInteger(task.timeoutMs),
      grammarKeys: Array.isArray(task.grammarKeys) ? task.grammarKeys.slice() : []
    })),
    scheduledJobs: jobs
  };
};

import { createHash } from 'node:crypto';

const VERSION = 1;
const MAX_TASKS = 512;
const MAX_DECISIONS = 128;
const MAX_READY = 64;
const MAX_BYTES = 2 * 1024 * 1024;
const identity = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const positive = value => Number.isFinite(value) && value > 0 ? value : null;
export const schedulerReplayLimitIdentity = envelope => identity({
  tokens: Object.fromEntries(['cpu', 'io', 'mem'].map(kind => [kind, envelope.tokens[kind].total])),
  globalMaxBytes: envelope.globalMaxBytes,
  queues: envelope.queues.map(queue => ({ name: queue.name, surface: queue.surface, concurrency: queue.concurrency,
    configuredConcurrency: queue.configuredConcurrency, adapterConcurrency: queue.adapterConcurrency,
    maxPending: queue.maxPending, maxPendingBytes: queue.maxPendingBytes, maxInFlightBytes: queue.maxInFlightBytes,
    surfaceConcurrency: queue.surfaceConcurrency, priority: queue.priority, weight: queue.weight }))
});

/** Task IDs are local ordinals. Paths, callbacks and repository labels never
 * enter this bounded record. Predictions must exist before a task starts. */
export const projectSchedulerReplayTask = value => {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({ profileIdentity: label(value.profileIdentity), compatibilityIdentity: label(value.compatibilityIdentity),
    domain: label(value.domain), orderIndex: integer(value.orderIndex), dependencyState: value.dependencyState === 'ready' ? 'ready' : 'unknown',
    predictedDurationMs: positive(value.predictedDurationMs), predictedBytes: integer(value.predictedBytes),
    featureIdentity: label(value.featureIdentity), resourceIdentity: label(value.resourceIdentity) });
};

/** Uses exact recorded admission, never simulates resource releases, overlap,
 * throughput or outcomes that were not observed in the original execution. */
export const compareSchedulerDispatchReplay = trace => {
  const summary = { decisions: 0, evaluable: 0, divergence: 0, exclusions: {}, predictionSamples: 0,
    absolutePredictionErrorMs: 0, queueWaitMs: [], commitDelayMs: [], incompleteOutcomes: 0 };
  const reject = reason => { summary.exclusions[reason] = (summary.exclusions[reason] || 0) + 1; };
  const malformed = !trace || trace.version !== VERSION || !Array.isArray(trace.tasks) || trace.tasks.length > MAX_TASKS
    || !Array.isArray(trace.decisions) || trace.decisions.length > MAX_DECISIONS;
  if (malformed) {
    reject('invalid-trace'); return { version: VERSION, mode: 'non-mutating-dispatch-point-comparison', summary, decisions: [] };
  }
  const tasks = new Map(), invalidTasks = new Set();
  for (const task of trace.tasks) {
    if (!label(task?.id) || tasks.has(task.id) || integer(task.ordinal) == null) {
      reject('invalid-task-identity'); return { version: VERSION, summary, decisions: [] };
    }
    tasks.set(task.id, task);
    if (!Number.isFinite(task.enqueuedAt) || task.enqueuedAt < 0
      || (task.startedAt != null && (!Number.isFinite(task.startedAt) || task.startedAt < task.enqueuedAt))
      || (task.endedAt != null && (!Number.isFinite(task.endedAt) || task.endedAt < (task.startedAt ?? task.enqueuedAt)))
      || (task.committedAt != null && (!Number.isFinite(task.committedAt) || task.startedAt == null || task.committedAt < task.startedAt))) {
      invalidTasks.add(task.id);
    }
  }
  const decisions = [];
  for (const decision of trace?.decisions || []) {
    summary.decisions++;
    if (!decision || typeof decision !== 'object') { reject('invalid-decision-record'); continue; }
    const result = { id: decision.id, baselineTaskId: decision.baselineTaskId, proposedTaskId: null,
      eligibleTaskIds: decision.eligibleTaskIds || [], evaluable: false, reason: null, constraints: {}, observed: null };
    const exclude = reason => { result.reason = reason; reject(reason); decisions.push(result); };
    if (!decision.completeReadySet) { exclude(decision.incompleteReason || 'incomplete-ready-set'); continue; }
    if (!Array.isArray(decision.candidates) || decision.candidates.length > MAX_READY
      || new Set(decision.candidates.map(row => row?.taskId)).size !== decision.candidates.length
      || !Number.isFinite(decision.at) || !Number.isFinite(decision.starvationMs) || decision.starvationMs < 0) {
      exclude('invalid-decision-record'); continue;
    }
    const eligible = decision.candidates.filter(row => row.admissionReason == null);
    result.admissionReasons = Object.fromEntries(decision.candidates.map(row => [row.taskId, row.admissionReason]));
    result.predictions = Object.fromEntries(eligible.map(row => [row.taskId, tasks.get(row.taskId)?.prediction || null]));
    if (JSON.stringify(eligible.map(row => row.taskId)) !== JSON.stringify(decision.eligibleTaskIds)) {
      exclude('invalid-ready-identity'); continue;
    }
    if (!eligible.length || !eligible.some(row => row.taskId === decision.baselineTaskId)) { exclude('baseline-not-admissible'); continue; }
    if (!decision.compatibilityIdentity || !decision.resourceIdentity) { exclude('missing-context-identity'); continue; }
    try {
      if (identity(decision.envelope) !== decision.resourceIdentity
        || schedulerReplayLimitIdentity(decision.envelope) !== decision.limitIdentity) {
        exclude('invalid-resource-identity'); continue;
      }
    } catch { exclude('invalid-resource-identity'); continue; }
    let invalid = null;
    for (const row of eligible) {
      const task = tasks.get(row.taskId), meta = task?.prediction;
      if (invalidTasks.has(row.taskId) || !Number.isFinite(row.ageMs) || row.ageMs < 0
        || task?.enqueuedAt > decision.at || (task?.startedAt != null && task.startedAt < decision.at)) {
        invalid = 'malformed-task-order'; break;
      }
      if (!task || !meta || positive(meta.predictedDurationMs) == null || integer(meta.predictedBytes) == null
        || !label(meta.profileIdentity) || !label(meta.featureIdentity)) {
        invalid = 'missing-prediction'; break;
      }
      if (meta.compatibilityIdentity !== decision.compatibilityIdentity) { invalid = 'profile-mismatch'; break; }
      if (meta.resourceIdentity !== decision.limitIdentity) { invalid = 'resource-envelope-change'; break; }
      if (meta.dependencyState !== 'ready') { invalid = 'missing-dependency-evidence'; break; }
      const commit = decision.commit;
      if (!commit || meta.domain !== commit.domain || integer(meta.orderIndex) == null
        || integer(commit.nextIndex) == null || integer(commit.maxAhead) == null) { invalid = 'missing-commit-frontier'; break; }
      if (meta.orderIndex < commit.nextIndex || meta.orderIndex > commit.nextIndex + commit.maxAhead) {
        result.constraints[row.taskId] = 'contiguous-commit-window';
      }
    }
    if (invalid) { exclude(invalid); continue; }
    let candidates = eligible.filter(row => !result.constraints[row.taskId]);
    if (!candidates.some(row => row.taskId === decision.baselineTaskId)) { exclude('baseline-outside-commit-window'); continue; }
    const frontier = candidates.find(row => tasks.get(row.taskId).prediction.orderIndex === decision.commit.nextIndex);
    // Advancing the actual contiguous frontier has priority over shortening a
    // later task. If it is already running, no invented readiness is implied.
    if (frontier) {
      for (const row of candidates) if (row !== frontier) result.constraints[row.taskId] = 'contiguous-commit-frontier';
      candidates = [frontier];
    }
    const aged = candidates.filter(row => row.ageMs >= decision.starvationMs);
    let proposed;
    if (aged.length) {
      proposed = [...aged].sort((a, b) => b.ageMs - a.ageMs || tasks.get(a.taskId).ordinal - tasks.get(b.taskId).ordinal)[0];
      for (const row of candidates) if (row !== proposed) result.constraints[row.taskId] = 'age-starvation-guard';
    } else {
      proposed = [...candidates].sort((a, b) => tasks.get(a.taskId).prediction.predictedDurationMs
        - tasks.get(b.taskId).prediction.predictedDurationMs || tasks.get(a.taskId).ordinal - tasks.get(b.taskId).ordinal)[0];
    }
    result.evaluable = true; result.reason = aged.length ? 'age-starvation-guard' : frontier ? 'contiguous-commit-frontier' : 'shortest-predicted-duration';
    result.proposedTaskId = proposed.taskId;
    const baselineOutcome = tasks.get(decision.baselineTaskId), proposedOutcome = tasks.get(proposed.taskId);
    result.observed = { baseline: baselineOutcome?.outcome || 'incomplete', proposed: proposedOutcome?.outcome || 'incomplete',
      baselineDurationMs: baselineOutcome?.durationMs ?? null, proposedDurationMs: proposedOutcome?.durationMs ?? null };
    summary.evaluable++; if (result.proposedTaskId !== result.baselineTaskId) summary.divergence++;
    decisions.push(result);
  }
  for (const task of tasks.values()) {
    if (invalidTasks.has(task.id)) continue;
    if (task.outcome == null) { summary.incompleteOutcomes++; continue; }
    if (task.outcome !== 'completed' || !Number.isFinite(task.durationMs) || !task.prediction?.predictedDurationMs) continue;
    summary.predictionSamples++;
    summary.absolutePredictionErrorMs += Math.abs(task.durationMs - task.prediction.predictedDurationMs);
    summary.queueWaitMs.push(Math.max(0, task.startedAt - task.enqueuedAt));
    if (Number.isFinite(task.committedAt)) summary.commitDelayMs.push(Math.max(0, task.committedAt - task.endedAt));
  }
  const p95 = rows => rows.length ? [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * 0.95) - 1] : null;
  summary.queueWaitP95Ms = p95(summary.queueWaitMs);
  summary.commitDelayP95Ms = p95(summary.commitDelayMs);
  summary.meanAbsolutePredictionErrorMs = summary.predictionSamples ? summary.absolutePredictionErrorMs / summary.predictionSamples : null;
  return { version: VERSION, mode: 'non-mutating-dispatch-point-comparison', summary, decisions,
    assumptions: ['observed outcomes belong to baseline execution', 'no counterfactual overlap or throughput estimate',
      'missing admission/profile/dependency/frontier evidence excludes a decision'] };
};

/** Lives beside existing aggregate telemetry; disabled by default and bounded
 * by work, record count and conservative serialized bytes when opted in. */
export const createSchedulerDispatchReplay = ({ nowMs, startedAtMs, starvationMs }) => {
  let context = null, taskOrdinal = 0, decisionOrdinal = 0, usedBytes = 0, droppedTasks = 0, droppedDecisions = 0;
  const tasks = new Map(), decisions = [];
  const charge = value => {
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 256;
    if (usedBytes + bytes > MAX_BYTES) return false;
    usedBytes += bytes; return true;
  };
  const configure = options => {
    if (options?.enabled !== true) { context = null; return; }
    context = { compatibilityIdentity: label(options.compatibilityIdentity),
      getCommitState: typeof options.getCommitState === 'function' ? options.getCommitState : null };
  };
  const register = (entry, queueName, metadata) => {
    if (!context) return;
    const ordinal = ++taskOrdinal;
    const task = { id: `t${ordinal}`, ordinal, stage: label(queueName), enqueuedAt: Math.max(0, entry.enqueuedAt - startedAtMs),
      startedAt: null, endedAt: null, committedAt: null, outcome: null, durationMs: null,
      bytes: entry.tokens.bytes, resources: { ...entry.tokens }, prediction: null };
    try { task.prediction = projectSchedulerReplayTask(metadata); } catch {}
    if (tasks.size >= MAX_TASKS || !charge(task)) { droppedTasks++; return; }
    tasks.set(task.id, task); entry.replayTaskId = task.id;
  };
  const observeStart = entry => {
    const task = tasks.get(entry.replayTaskId);
    if (task) task.startedAt = Math.max(0, nowMs() - startedAtMs);
  };
  const observeEnd = (entry, outcome) => {
    const task = tasks.get(entry.replayTaskId);
    if (!task || task.endedAt != null) return;
    task.endedAt = Math.max(0, nowMs() - startedAtMs);
    task.outcome = outcome;
    task.durationMs = task.startedAt == null ? null : Math.max(0, task.endedAt - task.startedAt);
  };
  const observeCommit = ({ domain, orderIndex } = {}) => {
    for (const task of tasks.values()) {
      if (task.prediction?.domain === domain && task.prediction.orderIndex === orderIndex && task.startedAt != null && task.committedAt == null) {
        task.committedAt = Math.max(0, nowMs() - startedAtMs);
      }
    }
  };
  const capture = ({ queues, baseline, admissionReason, envelope }) => {
    if (!context) return;
    if (decisions.length >= MAX_DECISIONS || usedBytes >= MAX_BYTES) { droppedDecisions++; return; }
    const now = nowMs(), pendingCount = queues.reduce((total, queue) => total + queue.pending.length, 0);
    const decision = { id: ++decisionOrdinal, at: Math.max(0, now - startedAtMs), baselineTaskId: baseline?.replayTaskId || null,
      completeReadySet: pendingCount <= MAX_READY, incompleteReason: pendingCount > MAX_READY ? 'ready-set-limit' : null,
      pendingCount, candidates: [], eligibleTaskIds: [], starvationMs, compatibilityIdentity: context.compatibilityIdentity,
      resourceIdentity: null, limitIdentity: null, envelope: null, commit: null };
    if (decision.completeReadySet) {
      for (const queue of queues) for (const entry of queue.pending) {
        if (!entry.replayTaskId) { decision.completeReadySet = false; decision.incompleteReason = 'missing-task-record'; }
        const reason = admissionReason(queue, entry.tokens);
        decision.candidates.push({ taskId: entry.replayTaskId || null, stage: label(queue.name),
          ageMs: Math.max(0, now - entry.enqueuedAt), admissionReason: reason });
        if (reason == null) decision.eligibleTaskIds.push(entry.replayTaskId || null);
      }
      decision.envelope = envelope(); decision.resourceIdentity = identity(decision.envelope);
      decision.limitIdentity = schedulerReplayLimitIdentity(decision.envelope);
      try {
        const commit = context.getCommitState?.();
        if (label(commit?.domain) && integer(commit.nextIndex) != null && integer(commit.maxAhead) != null) {
          decision.commit = { domain: commit.domain, nextIndex: commit.nextIndex, maxAhead: commit.maxAhead };
        }
      } catch { decision.incompleteReason = 'commit-observer-failed'; decision.completeReadySet = false; }
    }
    if (!charge(decision)) { droppedDecisions++; return; }
    decisions.push(decision);
  };
  const snapshot = () => {
    const trace = { version: VERSION, enabled: Boolean(context), limits: { tasks: MAX_TASKS, decisions: MAX_DECISIONS,
      ready: MAX_READY, bytes: MAX_BYTES }, retainedBytes: usedBytes, droppedTasks, droppedDecisions,
    tasks: structuredClone([...tasks.values()]), decisions: structuredClone(decisions) };
    return { ...trace, comparison: compareSchedulerDispatchReplay(trace) };
  };
  return { configure, register, observeStart, observeEnd, observeCommit, capture, snapshot, enabled: () => Boolean(context) };
};

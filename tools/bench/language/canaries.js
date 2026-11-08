import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createCanaryAttemptOwner, retainCanaryAttemptOwner, getCanaryAttemptOwner, admitCanaryResult, resolveCanaryAttemptLimits } from './canary-attempt.js';
import { createCanaryRunnerPlan, createCanaryEnvironmentOwner } from './canary-environment.js';
import { classifyBenchTask } from './verdict.js';
import {
  createBenchDiagnosticClassifier
} from './logging.js';
import { sumDiagnosticCounts } from './diagnostics.js';

const DEFAULT_CANARY_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'bench-runtime-canaries');
const DEFAULT_LIVE_CANARY_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_BENCH_RUNTIME_CANARY_ROOT = DEFAULT_CANARY_ROOT;
export const BENCH_RUNTIME_CANARY_MANIFEST_SCHEMA_VERSION = 2;
export const BENCH_RUNTIME_LIVE_CANARY_RESULT_SCHEMA_VERSION = 1;
export const BENCH_RUNTIME_LIVE_CANARY_SUMMARY_SCHEMA_VERSION = 1;
export const BENCH_RUNTIME_BLOCKER_CONFIRMATION_SCHEMA_VERSION = 1;
export const BENCH_RUNTIME_BLOCKER_CLOSURE_EVIDENCE_SCHEMA_VERSION = 1;

export const BENCH_RUNTIME_LIVE_CANARY_STATUS = Object.freeze({
  BASELINE_CONFIRMED: 'baseline_confirmed',
  TARGET_ACHIEVED: 'target_achieved',
  REGRESSED: 'regressed',
  INCONCLUSIVE: 'inconclusive',
  RUNNER_FAILED: 'runner_failed',
  NOT_RUN: 'not_run'
});

const DIRECT_METRIC_KEYS = Object.freeze([
  'resultClass',
  'productionCleanStatus',
  'timeoutClasses',
  'countsByDiagnosticType',
  'countsByFailureClass',
  'crashCount',
  'taskCount'
]);

const DIRECT_COUNT_KEYS = Object.freeze({
  artifactStallCount: 'artifact_tail_stall',
  fallbackCount: 'fallback_used',
  providerBlockedCount: 'provider_preflight_blocked',
  providerDegradedCount: 'provider_degraded_mode_entered',
  providerTimeoutCount: 'provider_request_timeout',
  circuitBreakerCount: 'provider_circuit_breaker'
});

const resolveBenchTimeoutClasses = (tasks) => {
  const out = new Set();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const timeoutDecision = task?.timeoutDecision && typeof task.timeoutDecision === 'object'
      ? task.timeoutDecision
      : null;
    const candidates = [
      timeoutDecision?.timeoutClass,
      timeoutDecision?.candidateTimeoutClass,
      task?.taskStatus?.primaryFailureClass
    ];
    for (const candidate of candidates) {
      const text = String(candidate || '').trim();
      if (text) out.add(text);
    }
  }
  return Array.from(out).sort((left, right) => left.localeCompare(right));
};

const normalizeCountMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [String(key), Number(raw)])
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
};

const normalizeConstraintCountMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [String(key), Number(raw)])
      .filter(([, count]) => Number.isFinite(count) && count >= 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
};

const normalizeTextList = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
)).sort((left, right) => left.localeCompare(right));

const toNonEmptyLines = (content) => String(content || '')
  .split(/\r?\n/u)
  .map((line) => line.trimEnd())
  .filter((line) => line.trim());

const parseBenchmarkConfirmationLaneSpec = (value) => {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  const lanes = Array.from(new Set(
    ['small', 'medium', 'large']
      .filter((lane) => normalized.includes(lane))
  ));
  return {
    raw: text || null,
    lanes
  };
};

const buildCountHelpers = (metrics) => {
  const counts = normalizeCountMap(metrics?.countsByDiagnosticType);
  return {
    ...metrics,
    countsByDiagnosticType: counts,
    countsByFailureClass: normalizeCountMap(metrics?.countsByFailureClass),
    timeoutClasses: normalizeTextList(metrics?.timeoutClasses),
    crashCount: Number.isFinite(Number(metrics?.crashCount)) ? Number(metrics.crashCount) : 0,
    taskCount: Number.isFinite(Number(metrics?.taskCount)) ? Number(metrics.taskCount) : 0,
    artifactStallCount: Number(metrics?.artifactStallCount ?? counts.artifact_tail_stall ?? 0) || 0,
    fallbackCount: Number(metrics?.fallbackCount ?? counts.fallback_used ?? 0) || 0,
    providerBlockedCount: Number(metrics?.providerBlockedCount ?? counts.provider_preflight_blocked ?? 0) || 0,
    providerDegradedCount: Number(metrics?.providerDegradedCount ?? counts.provider_degraded_mode_entered ?? 0) || 0,
    providerTimeoutCount: Number(metrics?.providerTimeoutCount ?? counts.provider_request_timeout ?? 0) || 0,
    circuitBreakerCount: Number(metrics?.circuitBreakerCount ?? counts.provider_circuit_breaker ?? 0) || 0
  };
};

const extractBenchRuntimeTaskMetrics = (entry) => {
  const taskStatus = entry?.taskStatus || classifyBenchTask(entry);
  const countsByFailureClass = {};
  if (taskStatus?.primaryFailureClass) {
    countsByFailureClass[taskStatus.primaryFailureClass] = 1;
  }
  const timeoutClasses = [];
  if (taskStatus?.resultClass === 'timed_out' && taskStatus?.primaryFailureClass) {
    timeoutClasses.push(taskStatus.primaryFailureClass);
  }
  return buildCountHelpers({
    resultClass: String(taskStatus?.resultClass || '').trim() || null,
    productionCleanStatus: null,
    timeoutClasses,
    countsByDiagnosticType: normalizeCountMap(sumDiagnosticCounts(entry)),
    countsByFailureClass,
    crashCount: taskStatus?.resultClass === 'crashed' ? 1 : 0,
    taskCount: 1
  });
};

export const resolveBenchRuntimeCanaryRoot = (root = process.cwd()) => (
  path.join(root, 'tests', 'fixtures', 'bench-runtime-canaries')
);

export const loadBenchRuntimeCanaryManifest = async (root = process.cwd()) => {
  const canaryRoot = resolveBenchRuntimeCanaryRoot(root);
  const manifestPath = path.join(canaryRoot, 'manifest.json');
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  return {
    canaryRoot,
    manifestPath,
    manifest
  };
};

export const loadBenchRuntimeCanaryFixture = async (entry, root = process.cwd()) => {
  const canaryRoot = resolveBenchRuntimeCanaryRoot(root);
  const filePath = path.join(canaryRoot, String(entry?.file || ''));
  const content = await fsPromises.readFile(filePath, 'utf8');
  return {
    filePath,
    content
  };
};

export const replayBenchRuntimeCanary = async (entry, root = process.cwd()) => {
  const { filePath, content } = await loadBenchRuntimeCanaryFixture(entry, root);
  const lines = toNonEmptyLines(content);
  const classifier = createBenchDiagnosticClassifier();
  const signals = [];
  const eventTypes = new Set();
  const failureClasses = new Set();

  for (const line of lines) {
    if (entry?.kind === 'structured-stream') {
      const parsed = JSON.parse(line);
      const classified = classifier.classify({ event: parsed, source: 'stream' });
      for (const signal of classified) {
        signals.push(signal);
        if (signal?.eventType) eventTypes.add(signal.eventType);
        if (signal?.failureClass) failureClasses.add(signal.failureClass);
      }
      continue;
    }
    if (entry?.kind === 'log-fragment') {
      const classified = classifier.classify({ line, source: 'log' });
      for (const signal of classified) {
        signals.push(signal);
        if (signal?.eventType) eventTypes.add(signal.eventType);
        if (signal?.failureClass) failureClasses.add(signal.failureClass);
      }
    }
  }

  const requiredPatterns = Array.isArray(entry?.requiredPatterns) ? entry.requiredPatterns : [];
  const matchedPatterns = requiredPatterns.filter((pattern) => String(content).includes(String(pattern)));

  return {
    filePath,
    lineCount: lines.length,
    eventTypes: Array.from(eventTypes).sort((left, right) => left.localeCompare(right)),
    failureClasses: Array.from(failureClasses).sort((left, right) => left.localeCompare(right)),
    matchedPatterns,
    requiredPatterns,
    signals
  };
};

const validateLiveCanaryEnvironment = (environment) => {
  const failures = [];
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    failures.push('environment contract is required');
    return failures;
  }
  const requiredKeys = [
    'os',
    'toolchain',
    'providerAvailability',
    'cacheState',
    'configProfile'
  ];
  for (const key of requiredKeys) {
    if (!String(environment[key] || '').trim()) {
      failures.push(`environment.${key} is required`);
    }
  }
  return failures;
};

export const validateBenchRuntimeCanaryManifest = (manifest) => {
  const failures = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (Number(manifest.schemaVersion) !== BENCH_RUNTIME_CANARY_MANIFEST_SCHEMA_VERSION) {
    failures.push(`expected schemaVersion ${BENCH_RUNTIME_CANARY_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.entries)) {
    failures.push('entries array is required');
  }
  if (!Array.isArray(manifest.liveCanaries)) {
    failures.push('liveCanaries array is required');
  }
  for (const entry of Array.isArray(manifest.liveCanaries) ? manifest.liveCanaries : []) {
    const id = String(entry?.id || '').trim();
    if (!id) failures.push('live canary id is required');
    if (!String(entry?.repo || '').trim()) failures.push(`${id || '<unknown>'}: repo is required`);
    if (!String(entry?.profile || '').trim()) failures.push(`${id || '<unknown>'}: profile is required`);
    if (!String(entry?.canaryKind || '').trim()) failures.push(`${id || '<unknown>'}: canaryKind is required`);
    if (!String(entry?.currentFailureMode || '').trim()) {
      failures.push(`${id || '<unknown>'}: currentFailureMode is required`);
    }
    if (!String(entry?.expectedImprovedMode || '').trim()) {
      failures.push(`${id || '<unknown>'}: expectedImprovedMode is required`);
    }
    if (!String(entry?.benchmarkConfirmationLane || '').trim()) {
      failures.push(`${id || '<unknown>'}: benchmarkConfirmationLane is required`);
    }
    if (!entry?.proofOfSimilarity || typeof entry.proofOfSimilarity !== 'object' || Array.isArray(entry.proofOfSimilarity)) {
      failures.push(`${id || '<unknown>'}: proofOfSimilarity is required`);
    } else {
      if (!String(entry.proofOfSimilarity.referenceRun || '').trim()) {
        failures.push(`${id || '<unknown>'}: proofOfSimilarity.referenceRun is required`);
      }
      if (!String(entry.proofOfSimilarity.note || '').trim()) {
        failures.push(`${id || '<unknown>'}: proofOfSimilarity.note is required`);
      }
    }
    failures.push(...validateLiveCanaryEnvironment(entry?.environment).map((failure) => `${id || '<unknown>'}: ${failure}`));
    if (!entry?.runner || typeof entry.runner !== 'object' || Array.isArray(entry.runner)) {
      failures.push(`${id || '<unknown>'}: runner is required`);
    } else {
      if (!String(entry.runner.type || '').trim()) failures.push(`${id || '<unknown>'}: runner.type is required`);
      if (!String(entry.runner.script || '').trim()) failures.push(`${id || '<unknown>'}: runner.script is required`);
    }
    if (!entry?.currentContract || typeof entry.currentContract !== 'object' || Array.isArray(entry.currentContract)) {
      failures.push(`${id || '<unknown>'}: currentContract is required`);
    }
    if (!entry?.targetContract || typeof entry.targetContract !== 'object' || Array.isArray(entry.targetContract)) {
      failures.push(`${id || '<unknown>'}: targetContract is required`);
    }
  }
  return failures;
};

export const extractBenchRuntimeCanaryMetrics = (payload) => {
  const direct = payload?.canaryMetrics && typeof payload.canaryMetrics === 'object' && !Array.isArray(payload.canaryMetrics)
    ? payload.canaryMetrics
    : null;
  if (direct) {
    const metrics = {};
    for (const key of DIRECT_METRIC_KEYS) {
      if (direct[key] !== undefined) metrics[key] = direct[key];
    }
    for (const [field, diagnosticType] of Object.entries(DIRECT_COUNT_KEYS)) {
      if (direct[field] !== undefined) metrics[field] = direct[field];
      else if (direct.countsByDiagnosticType?.[diagnosticType] !== undefined) {
        metrics[field] = direct.countsByDiagnosticType[diagnosticType];
      }
    }
    return buildCountHelpers(metrics);
  }

  const run = payload?.run && typeof payload.run === 'object' ? payload.run : {};
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
  return buildCountHelpers({
    resultClass: String(run.aggregateResultClass || '').trim() || null,
    productionCleanStatus: String(run.productionClean?.status || '').trim() || null,
    timeoutClasses: resolveBenchTimeoutClasses(tasks),
    countsByDiagnosticType: normalizeCountMap(run.countsByDiagnosticType),
    countsByFailureClass: normalizeCountMap(run.countsByFailureClass),
    crashCount: Number(run.countsByResultClass?.crashed || 0),
    taskCount: tasks.length
  });
};

export const evaluateBenchRuntimeCanaryContract = (contract, metrics) => {
  const failures = [];
  const normalized = buildCountHelpers(metrics);
  const allowedResultClasses = normalizeTextList(contract?.allowedResultClasses);
  if (allowedResultClasses.length && !allowedResultClasses.includes(String(normalized.resultClass || '').trim())) {
    failures.push(`resultClass ${normalized.resultClass || 'unknown'} not in ${allowedResultClasses.join(', ')}`);
  }
  const requiredTimeoutClasses = normalizeTextList(contract?.requiredTimeoutClasses);
  for (const timeoutClass of requiredTimeoutClasses) {
    if (!normalized.timeoutClasses.includes(timeoutClass)) {
      failures.push(`missing timeoutClass ${timeoutClass}`);
    }
  }
  const requiredFailureClasses = normalizeTextList(contract?.requiredFailureClasses);
  const failureClasses = Object.keys(normalized.countsByFailureClass || {});
  for (const failureClass of requiredFailureClasses) {
    if (!failureClasses.includes(failureClass)) {
      failures.push(`missing failureClass ${failureClass}`);
    }
  }
  const minCounts = normalizeConstraintCountMap(contract?.minCountsByDiagnosticType);
  for (const [diagnosticType, minCount] of Object.entries(minCounts)) {
    const actual = Number(normalized.countsByDiagnosticType?.[diagnosticType] || 0);
    if (actual < minCount) {
      failures.push(`diagnostic ${diagnosticType} expected >= ${minCount}, got ${actual}`);
    }
  }
  const maxCounts = normalizeConstraintCountMap(contract?.maxCountsByDiagnosticType);
  for (const [diagnosticType, maxCount] of Object.entries(maxCounts)) {
    const actual = Number(normalized.countsByDiagnosticType?.[diagnosticType] || 0);
    if (actual > maxCount) {
      failures.push(`diagnostic ${diagnosticType} expected <= ${maxCount}, got ${actual}`);
    }
  }
  if (Number.isFinite(Number(contract?.minCrashCount)) && normalized.crashCount < Number(contract.minCrashCount)) {
    failures.push(`crashCount expected >= ${Number(contract.minCrashCount)}, got ${normalized.crashCount}`);
  }
  if (Number.isFinite(Number(contract?.maxCrashCount)) && normalized.crashCount > Number(contract.maxCrashCount)) {
    failures.push(`crashCount expected <= ${Number(contract.maxCrashCount)}, got ${normalized.crashCount}`);
  }
  const requiredProductionCleanStatus = String(contract?.productionCleanStatus || '').trim();
  if (requiredProductionCleanStatus && normalized.productionCleanStatus !== requiredProductionCleanStatus) {
    failures.push(
      `productionCleanStatus expected ${requiredProductionCleanStatus}, got ${normalized.productionCleanStatus || 'unknown'}`
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    metrics: normalized
  };
};

export const evaluateBenchRuntimeCanaryForbiddenRegressions = (rules, metrics) => {
  const normalized = buildCountHelpers(metrics);
  const failures = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const type = String(rule?.type || '').trim();
    if (!type) continue;
    if (type === 'resultClassDisallowed') {
      const values = normalizeTextList(rule?.values);
      if (values.includes(String(normalized.resultClass || '').trim())) {
        failures.push(`resultClass ${normalized.resultClass} is disallowed`);
      }
      continue;
    }
    if (type === 'timeoutClassDisallowed') {
      const values = normalizeTextList(rule?.values);
      const matched = values.filter((value) => normalized.timeoutClasses.includes(value));
      for (const value of matched) {
        failures.push(`timeoutClass ${value} is disallowed`);
      }
      continue;
    }
    if (type === 'diagnosticMax') {
      const diagnosticType = String(rule?.diagnosticType || '').trim();
      const max = Number(rule?.max);
      if (!diagnosticType || !Number.isFinite(max)) continue;
      const actual = Number(normalized.countsByDiagnosticType?.[diagnosticType] || 0);
      if (actual > max) {
        failures.push(`diagnostic ${diagnosticType} exceeded max ${max} (got ${actual})`);
      }
      continue;
    }
    if (type === 'crashCountMax') {
      const max = Number(rule?.max);
      if (Number.isFinite(max) && normalized.crashCount > max) {
        failures.push(`crashCount exceeded max ${max} (got ${normalized.crashCount})`);
      }
    }
  }
  return failures;
};

const substituteRunnerToken = (value, tokens) => String(value || '').replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key) => {
  const resolved = tokens[key];
  return resolved == null ? '' : String(resolved);
});

const resolveRunnerConfig = (entry, root, workDir, outJsonPath) => {
  const runner = entry?.runner && typeof entry.runner === 'object' ? entry.runner : {};
  const tokens = {
    root,
    canaryRoot: resolveBenchRuntimeCanaryRoot(root),
    workDir,
    outJson: outJsonPath
  };
  const cwd = path.resolve(root, substituteRunnerToken(runner.cwd || '.', tokens));
  const args = (Array.isArray(runner.args) ? runner.args : []).map((arg) => substituteRunnerToken(arg, tokens));
  const env = Object.fromEntries(
    Object.entries(runner.env && typeof runner.env === 'object' ? runner.env : {})
      .map(([key, value]) => [key, substituteRunnerToken(value, tokens)])
  );
  if (runner.type === 'bench-language') {
    return createCanaryRunnerPlan({
      cmd: process.execPath,
      args: [path.resolve(root, 'tools', 'bench', 'language-repos.js'), ...args],
      cwd,
      overrides: env, workDir, outJsonPath
    });
  }
  return createCanaryRunnerPlan({
    cmd: process.execPath,
    args: [path.resolve(root, substituteRunnerToken(runner.script || '', tokens)), ...args],
    cwd, overrides: env, workDir, outJsonPath
  });
};

const canaryIdentity = entry => ({
  schemaVersion: BENCH_RUNTIME_LIVE_CANARY_RESULT_SCHEMA_VERSION,
  id: String(entry?.id || '').trim() || null,
  issue: Number.isSafeInteger(entry?.issue) && entry.issue > 0 ? entry.issue : null,
  repo: String(entry?.repo || '').trim() || null,
  profile: String(entry?.profile || '').trim() || null,
  canaryKind: String(entry?.canaryKind || '').trim() || null,
  benchmarkConfirmationLane: String(entry?.benchmarkConfirmationLane || '').trim() || null,
  proofOfSimilarity: entry?.proofOfSimilarity || null
});
const errorField = (error, key) => {
  try { return Object.getOwnPropertyDescriptor(error, key)?.value; } catch { return undefined; }
};
const failedCanary = (entry, error, phase, fields = {}) => ({ ...canaryIdentity(entry),
  status: BENCH_RUNTIME_LIVE_CANARY_STATUS.RUNNER_FAILED, ok: false, closureReady: false,
  error: typeof errorField(error, 'message') === 'string' ? errorField(error, 'message').slice(0, 2048) : 'Canary attempt failed.',
  errorCode: typeof errorField(error, 'code') === 'string' ? errorField(error, 'code').slice(0, 128) : 'ERR_CANARY_ATTEMPT',
  errorPhase: phase, ...fields });

export const runBenchRuntimeLiveCanary = async (entry, root = process.cwd(), {
  probeRunner, subprocessRunner = spawnSubprocess, limits, signal
} = {}) => {
  let tempDir = null, owner = null, plan = null, environment = null, result = null;
  let row, originalFailure, failed = false, phase = 'prepare';
  const timeoutMs = Number.isFinite(Number(entry?.runner?.timeoutMs))
    ? Math.max(1, Math.floor(Number(entry.runner.timeoutMs))) : DEFAULT_LIVE_CANARY_TIMEOUT_MS;
  try {
    throwIfAborted(signal);
    const bounds = resolveCanaryAttemptLimits(limits);
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-bench-canary-'));
    owner = await createCanaryAttemptOwner(tempDir);
    const outJsonPath = path.join(tempDir, `${String(entry?.id || 'canary').replace(/[^a-z0-9_-]/gi, '_')}.json`);
    plan = resolveRunnerConfig(entry, root, tempDir, outJsonPath);
    phase = 'environment';
    environment = createCanaryEnvironmentOwner({ entry, plan, probeRunner })();
    throwIfAborted(signal);
    phase = 'execute';
    result = await subprocessRunner(plan.cmd, plan.args, { cwd: plan.cwd, env: plan.env, signal,
      timeoutMs, maxOutputBytes: bounds.captureBytes, captureStdout: true, captureStderr: true, outputMode: 'string' });
    // The shared runner rejects nonzero/signal/timeout by default. Retain that
    // contract even when a controlled internal adapter supplies an outcome.
    if (result?.exitCode !== 0 || result?.signal) throw Object.assign(new Error('Canary child did not exit successfully.'),
      { code: 'SUBPROCESS_FAILED', result });
    phase = 'result-admission';
    const admitted = await admitCanaryResult({ workDir: tempDir, outJsonPath, result, maxBytes: bounds.resultBytes, signal });
    phase = 'contract';
    const metrics = extractBenchRuntimeCanaryMetrics(admitted.payload);
    const current = evaluateBenchRuntimeCanaryContract(entry?.currentContract || {}, metrics);
    const target = evaluateBenchRuntimeCanaryContract(entry?.targetContract || {}, metrics);
    const regressionFailures = evaluateBenchRuntimeCanaryForbiddenRegressions(entry?.forbiddenRegressions || [], metrics);
    const status = regressionFailures.length ? BENCH_RUNTIME_LIVE_CANARY_STATUS.REGRESSED
      : target.ok ? BENCH_RUNTIME_LIVE_CANARY_STATUS.TARGET_ACHIEVED
        : current.ok ? BENCH_RUNTIME_LIVE_CANARY_STATUS.BASELINE_CONFIRMED : BENCH_RUNTIME_LIVE_CANARY_STATUS.INCONCLUSIVE;
    row = { ...canaryIdentity(entry), status, ok: current.ok && regressionFailures.length === 0,
      closureReady: target.ok && regressionFailures.length === 0 && environment.comparison.state === 'qualified'
        && subprocessRunner === spawnSubprocess,
      resultAdmission: admitted.receipt, metrics, current, target, regressionFailures };
  } catch (error) {
    failed = true; originalFailure = error;
    owner?.remember(error);
    result ||= errorField(error, 'result') || null;
    row = failedCanary(entry, error, phase, {
      interrupted: signal?.aborted === true || errorField(error, 'code') === 'ABORT_ERR',
      resultAdmission: { state: 'unavailable', phase }
    });
  }
  row.environment = environment;
  row.runner = plan ? { cmd: plan.cmd, args: plan.args, cwd: plan.cwd, timeoutMs,
    environmentScope: environment?.evidenceScope || null, overrideKeys: plan.overrideKeys,
    operationalPaths: plan.operationalPaths, exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    signal: result?.signal || null, evidenceScope: subprocessRunner === spawnSubprocess ? 'shared-subprocess' : 'injected-subprocess-contract' } : null;
  row.stdout = typeof result?.stdout === 'string' ? result.stdout : '';
  row.stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  row.outputCapture = result?.outputCapture || null;
  row.termination = result?.termination || null;
  row.attempt = owner ? await owner.finalize() : { state: tempDir ? 'retained' : 'not-created',
    workDir: tempDir, ownershipPending: Boolean(tempDir) };
  if (row.attempt.ownershipPending) {
    row.ok = false; row.closureReady = false;
    row.status = BENCH_RUNTIME_LIVE_CANARY_STATUS.RUNNER_FAILED;
    if (!failed) Object.assign(row, { error: 'Canary attempt cleanup did not confirm release.',
      errorCode: 'ERR_CANARY_CLEANUP_PENDING', errorPhase: 'cleanup' });
  }
  return retainCanaryAttemptOwner(row, owner, failed ? originalFailure : undefined);
};

/** Malformed individual results continue; cancellation or unresolved resource
 * ownership stops admission. Every selected entry still gets a terminal row. */
export const runBenchRuntimeCanaryLane = async (entries, root = process.cwd(), options = {}) => {
  const results = [];
  let stopReason = null;
  for (const entry of entries) {
    if (options.signal?.aborted) stopReason ||= 'cancelled';
    if (stopReason) {
      results.push({ ...canaryIdentity(entry), status: BENCH_RUNTIME_LIVE_CANARY_STATUS.NOT_RUN,
        ok: false, closureReady: false, notRunReason: stopReason });
      continue;
    }
    const result = await runBenchRuntimeLiveCanary(entry, root, options);
    results.push(result);
    if (result.interrupted) stopReason = 'cancelled';
    else if (result.attempt?.ownershipPending) stopReason = 'prior-attempt-ownership-pending';
  }
  return buildBenchRuntimeLiveCanarySummary(results, { requireTarget: options.requireTarget === true });
};

export const buildBenchRuntimeLiveCanarySummary = (results, { requireTarget = false } = {}) => {
  const rows = Array.isArray(results) ? results : [];
  const countsByStatus = Object.fromEntries(
    Object.values(BENCH_RUNTIME_LIVE_CANARY_STATUS)
      .map((status) => [status, rows.filter((entry) => entry?.status === status).length])
  );
  const blockedIssues = Array.from(new Set(
    rows
      .filter((entry) => (requireTarget ? !entry?.closureReady : !entry?.ok))
      .map((entry) => Number(entry?.issue))
      .filter(value => Number.isSafeInteger(value) && value > 0)
  )).sort((left, right) => left - right);
  const failedRows = rows.filter(entry => requireTarget ? !entry?.closureReady : !entry?.ok);
  const ok = rows.length > 0 && failedRows.length === 0;
  const environmentFingerprints = Array.from(new Set(
    rows
      .map((entry) => String(entry?.environment?.fingerprint || '').trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
  return {
    schemaVersion: BENCH_RUNTIME_LIVE_CANARY_SUMMARY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    requireTarget,
    ok,
    countsByStatus,
    coverage: { selected: rows.length,
      attempted: rows.filter(entry => entry?.status !== BENCH_RUNTIME_LIVE_CANARY_STATUS.NOT_RUN).length,
      notRun: rows.filter(entry => entry?.status === BENCH_RUNTIME_LIVE_CANARY_STATUS.NOT_RUN).length,
      interrupted: rows.filter(entry => entry?.interrupted === true).length,
      failed: failedRows.length,
      ownershipPending: rows.filter(entry => entry?.attempt?.ownershipPending === true).length,
      complete: rows.every(entry => entry?.status !== BENCH_RUNTIME_LIVE_CANARY_STATUS.NOT_RUN
        && entry?.interrupted !== true && entry?.attempt?.ownershipPending !== true) },
    blockedIssues,
    environmentFingerprints,
    canaries: rows.map((entry) => retainCanaryAttemptOwner({
      id: entry?.id || null,
      issue: entry?.issue || null,
      repo: entry?.repo || null,
      profile: entry?.profile || null,
      status: entry?.status || null,
      ok: entry?.ok === true,
      closureReady: entry?.closureReady === true,
      benchmarkConfirmationLane: entry?.benchmarkConfirmationLane || null,
      proofOfSimilarity: entry?.proofOfSimilarity || null,
      environment: entry?.environment || null,
      metrics: entry?.metrics || null,
      runner: entry?.runner || null,
      attempt: entry?.attempt || null,
      outputCapture: entry?.outputCapture || null,
      resultAdmission: entry?.resultAdmission || null,
      termination: entry?.termination || null,
      error: entry?.error || null, errorCode: entry?.errorCode || null, errorPhase: entry?.errorPhase || null,
      interrupted: entry?.interrupted === true, notRunReason: entry?.notRunReason || null,
      stdout: entry?.stdout || '', stderr: entry?.stderr || '',
      currentFailures: entry?.current?.failures || [],
      targetFailures: entry?.target?.failures || [],
      regressionFailures: Array.isArray(entry?.regressionFailures) ? entry.regressionFailures : []
    }, getCanaryAttemptOwner(entry)))
  };
};

export const buildBenchRuntimeBlockerConfirmationSummary = ({
  manifest,
  tasks,
  generatedAt = null,
  runAggregateResultClass = null,
  runEnvironmentFingerprint = null,
  runLabel = null
}) => {
  const liveCanaries = Array.isArray(manifest?.liveCanaries) ? manifest.liveCanaries : [];
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const canaries = [];
  for (const entry of liveCanaries) {
    const repo = String(entry?.repo || '').trim();
    if (!repo) continue;
    const task = taskRows.find((row) => String(row?.repo || '').trim() === repo);
    if (!task) continue;
    const metrics = extractBenchRuntimeTaskMetrics(task);
    const target = evaluateBenchRuntimeCanaryContract(entry?.targetContract || {}, metrics);
    const regressionFailures = evaluateBenchRuntimeCanaryForbiddenRegressions(entry?.forbiddenRegressions || [], metrics);
    const taskStatus = task?.taskStatus || classifyBenchTask(task);
    canaries.push({
      id: String(entry?.id || '').trim() || null,
      issue: Number.isFinite(Number(entry?.issue)) ? Number(entry.issue) : null,
      repo,
      benchmarkConfirmationLane: parseBenchmarkConfirmationLaneSpec(entry?.benchmarkConfirmationLane),
      runLabel: String(runLabel || '').trim() || null,
      runGeneratedAt: String(generatedAt || '').trim() || null,
      runAggregateResultClass: String(runAggregateResultClass || '').trim() || null,
      runEnvironmentFingerprint: String(runEnvironmentFingerprint || '').trim() || null,
      benchmarkConfirmed: target.ok && regressionFailures.length === 0,
      taskStatus: {
        resultClass: taskStatus?.resultClass || null,
        primaryFailureClass: taskStatus?.primaryFailureClass || null,
        degradationClasses: Array.isArray(taskStatus?.degradationClasses) ? taskStatus.degradationClasses : []
      },
      metrics,
      targetFailures: target.failures,
      regressionFailures
    });
  }
  return {
    schemaVersion: BENCH_RUNTIME_BLOCKER_CONFIRMATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runGeneratedAt: String(generatedAt || '').trim() || null,
    runLabel: String(runLabel || '').trim() || null,
    runAggregateResultClass: String(runAggregateResultClass || '').trim() || null,
    runEnvironmentFingerprint: String(runEnvironmentFingerprint || '').trim() || null,
    confirmationCount: canaries.length,
    confirmedIssues: canaries
      .filter((entry) => entry.benchmarkConfirmed)
      .map((entry) => entry.issue)
      .filter(Number.isFinite)
      .sort((left, right) => left - right),
    canaries
  };
};

export const buildBenchRuntimeBlockerClosureEvidence = ({
  liveSummary,
  benchmarkConfirmations
}) => {
  const canaryRows = Array.isArray(liveSummary?.canaries) ? liveSummary.canaries : [];
  const confirmationSummaries = Array.isArray(benchmarkConfirmations) ? benchmarkConfirmations : [];
  const blockers = canaryRows.map((entry) => {
    const confirmations = confirmationSummaries.flatMap((summary) => (
      Array.isArray(summary?.canaries)
        ? summary.canaries.filter((candidate) => candidate?.id === entry?.id)
        : []
    ));
    const benchmarkConfirmed = confirmations.some((candidate) => candidate?.benchmarkConfirmed === true);
    const closureReady = entry?.closureReady === true && benchmarkConfirmed;
    const closureFailures = [];
    if (entry?.closureReady !== true) {
      closureFailures.push('live canary target contract not yet satisfied');
    }
    if (!benchmarkConfirmed) {
      closureFailures.push('no benchmark confirmation report satisfied the target contract');
    }
    return {
      id: entry?.id || null,
      issue: entry?.issue || null,
      repo: entry?.repo || null,
      benchmarkConfirmationLane: entry?.benchmarkConfirmationLane || null,
      liveCanaryStatus: entry?.status || null,
      liveCanaryClosureReady: entry?.closureReady === true,
      benchmarkConfirmed,
      closureReady,
      environment: entry?.environment || null,
      currentFailures: Array.isArray(entry?.currentFailures) ? entry.currentFailures : [],
      targetFailures: Array.isArray(entry?.targetFailures) ? entry.targetFailures : [],
      regressionFailures: Array.isArray(entry?.regressionFailures) ? entry.regressionFailures : [],
      confirmations,
      closureFailures
    };
  });
  const blockedIssues = blockers
    .filter((entry) => entry?.closureReady !== true)
    .map((entry) => Number(entry?.issue))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    schemaVersion: BENCH_RUNTIME_BLOCKER_CLOSURE_EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    liveSummarySchemaVersion: Number(liveSummary?.schemaVersion) || null,
    benchmarkConfirmationSchemaVersions: confirmationSummaries
      .map((entry) => Number(entry?.schemaVersion))
      .filter(Number.isFinite),
    ok: blockers.length > 0 && blockedIssues.length === 0,
    blockedIssues,
    blockers
  };
};

export const formatBenchRuntimeLiveCanarySummaryMarkdown = (summary) => {
  const counts = summary?.countsByStatus && typeof summary.countsByStatus === 'object'
    ? summary.countsByStatus
    : {};
  const lines = [
    '# Bench Runtime Live Canary Summary',
    '',
    `- generated: ${String(summary?.generatedAt || '').trim() || 'unknown'}`,
    `- require target: ${summary?.requireTarget === true ? 'yes' : 'no'}`,
    `- ok: ${summary?.ok === true ? 'yes' : 'no'}`,
    `- selected/attempted/not run: ${summary?.coverage?.selected ?? 'unknown'}/${summary?.coverage?.attempted ?? 'unknown'}/${summary?.coverage?.notRun ?? 'unknown'}`,
    `- coverage complete: ${summary?.coverage?.complete === true ? 'yes' : 'no'}`,
    `- blocked issues: ${Array.isArray(summary?.blockedIssues) && summary.blockedIssues.length ? summary.blockedIssues.join(', ') : 'none'}`,
    `- environment fingerprints: ${Array.isArray(summary?.environmentFingerprints) && summary.environmentFingerprints.length ? summary.environmentFingerprints.join(', ') : 'none'}`,
    '',
    '## Status counts',
    ''
  ];
  for (const [status, count] of Object.entries(counts)) {
    lines.push(`- ${status}: ${count}`);
  }
  lines.push('', '## Canaries', '');
  for (const entry of Array.isArray(summary?.canaries) ? summary.canaries : []) {
    lines.push(`- ${entry.id}: ${entry.status} (issue #${entry.issue}, lane ${entry.benchmarkConfirmationLane || 'unknown'})`);
    if (entry.errorCode) lines.push(`  failure: ${entry.errorCode} (${entry.errorPhase || 'unknown'})`);
    if (entry.notRunReason) lines.push(`  not run: ${entry.notRunReason}`);
    if (entry.attempt?.ownershipPending) lines.push(`  retained work directory: ${entry.attempt.workDir}`);
    if (entry?.environment?.mismatches?.length) {
      lines.push(`  environment mismatches: ${entry.environment.mismatches.join('; ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

export const formatBenchRuntimeBlockerClosureEvidenceMarkdown = (summary) => {
  const lines = [
    '# Bench Runtime Blocker Closure Evidence',
    '',
    `- generated: ${String(summary?.generatedAt || '').trim() || 'unknown'}`,
    `- ok: ${summary?.ok === true ? 'yes' : 'no'}`,
    `- blocked issues: ${Array.isArray(summary?.blockedIssues) && summary.blockedIssues.length ? summary.blockedIssues.join(', ') : 'none'}`,
    '',
    '## Blockers',
    ''
  ];
  for (const entry of Array.isArray(summary?.blockers) ? summary.blockers : []) {
    lines.push(
      `- ${entry.id}: closure=${entry.closureReady === true ? 'ready' : 'blocked'} `
        + `(issue #${entry.issue}, benchmark=${entry.benchmarkConfirmed === true ? 'confirmed' : 'missing'})`
    );
    for (const failure of Array.isArray(entry?.closureFailures) ? entry.closureFailures : []) {
      lines.push(`  - ${failure}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

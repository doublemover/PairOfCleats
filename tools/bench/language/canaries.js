import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { resolveWindowsCmdInvocation } from '../../../src/shared/subprocess/windows-cmd.js';
import {
  buildBenchEnvironmentMetadata,
  createBenchDiagnosticClassifier
} from './logging.js';

const DEFAULT_CANARY_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'bench-runtime-canaries');
const DEFAULT_LIVE_CANARY_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_PROBE_TIMEOUT_MS = 1500;
const BENCH_RUNTIME_ENVIRONMENT_PROBES = Object.freeze([
  { id: 'node', command: process.execPath, args: ['--version'] },
  { id: 'git', command: 'git', args: ['--version'] },
  { id: 'npm', command: 'npm', args: ['--version'] },
  { id: 'cargo', command: 'cargo', args: ['--version'] },
  { id: 'rustc', command: 'rustc', args: ['--version'] },
  { id: 'go', command: 'go', args: ['version'] },
  { id: 'swift', command: 'swift', args: ['--version'] },
  { id: 'python', command: 'python', args: ['--version'] },
  { id: 'gopls', command: 'gopls', args: ['version'] },
  { id: 'sourcekit-lsp', command: 'sourcekit-lsp', args: ['--version'] },
  { id: 'rust-analyzer', command: 'rust-analyzer', args: ['--version'] }
]);

const environmentSnapshotCache = new Map();

export const DEFAULT_BENCH_RUNTIME_CANARY_ROOT = DEFAULT_CANARY_ROOT;
export const BENCH_RUNTIME_CANARY_MANIFEST_SCHEMA_VERSION = 2;
export const BENCH_RUNTIME_LIVE_CANARY_RESULT_SCHEMA_VERSION = 1;
export const BENCH_RUNTIME_LIVE_CANARY_SUMMARY_SCHEMA_VERSION = 1;

export const BENCH_RUNTIME_LIVE_CANARY_STATUS = Object.freeze({
  BASELINE_CONFIRMED: 'baseline_confirmed',
  TARGET_ACHIEVED: 'target_achieved',
  REGRESSED: 'regressed',
  INCONCLUSIVE: 'inconclusive',
  RUNNER_FAILED: 'runner_failed'
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

const inferExpectedPlatform = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text.includes('cross-platform')) return null;
  if (text.includes('windows')) return 'win32';
  if (text.includes('macos') || text.includes('darwin')) return 'darwin';
  if (text.includes('linux')) return 'linux';
  return null;
};

const collectExpectedProbeIds = (entry) => {
  const corpus = [
    entry?.environment?.toolchain,
    entry?.environment?.providerAvailability,
    entry?.repo,
    entry?.profile
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  const ids = new Set(['node', 'git', 'npm']);
  if (corpus.includes('rust')) {
    ids.add('cargo');
    ids.add('rustc');
    ids.add('rust-analyzer');
  }
  if (corpus.includes('go') || corpus.includes('gopls')) {
    ids.add('go');
    ids.add('gopls');
  }
  if (corpus.includes('swift') || corpus.includes('sourcekit')) {
    ids.add('swift');
    ids.add('sourcekit-lsp');
  }
  if (corpus.includes('python')) ids.add('python');
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
};

const runVersionProbe = ({ command, args }) => {
  try {
    const invocation = process.platform === 'win32'
      ? resolveWindowsCmdInvocation(command, args, process.env)
      : { command, args };
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: VERSION_PROBE_TIMEOUT_MS
    });
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    const version = stdout || stderr || null;
    return {
      available: result.status === 0,
      version,
      exitCode: Number.isFinite(Number(result.status)) ? Number(result.status) : null
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      exitCode: null,
      error: error?.message || String(error)
    };
  }
};

const buildBenchRuntimeEnvironmentSnapshot = (entry) => {
  const probeIds = collectExpectedProbeIds(entry);
  const probes = Object.fromEntries(
    BENCH_RUNTIME_ENVIRONMENT_PROBES
      .filter((probe) => probeIds.includes(probe.id))
      .map((probe) => [probe.id, runVersionProbe(probe)])
  );
  const metadata = buildBenchEnvironmentMetadata(process.env);
  const mismatches = [];
  const expectedPlatform = inferExpectedPlatform(entry?.environment?.os);
  if (expectedPlatform && metadata.platform !== expectedPlatform) {
    mismatches.push(`expected platform ${expectedPlatform}, got ${metadata.platform}`);
  }
  for (const probeId of probeIds) {
    const probe = probes[probeId];
    if (!probe) continue;
    if (!probe.available && probeId !== 'git' && probeId !== 'npm') {
      mismatches.push(`expected tool/provider ${probeId} to be available`);
    }
  }
  const fingerprint = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      metadata,
      probes
    }))
    .digest('hex');
  return {
    declaredContract: entry?.environment || null,
    actual: metadata,
    probes,
    expectedProbeIds: probeIds,
    mismatches,
    fingerprint: `sha1:${fingerprint}`
  };
};

const getBenchRuntimeEnvironmentSnapshot = (entry) => {
  const cacheKey = JSON.stringify({
    environment: entry?.environment || null,
    probeIds: collectExpectedProbeIds(entry)
  });
  if (!environmentSnapshotCache.has(cacheKey)) {
    environmentSnapshotCache.set(cacheKey, buildBenchRuntimeEnvironmentSnapshot(entry));
  }
  return environmentSnapshotCache.get(cacheKey);
};

const toNonEmptyLines = (content) => String(content || '')
  .split(/\r?\n/u)
  .map((line) => line.trimEnd())
  .filter((line) => line.trim());

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
    return {
      cmd: process.execPath,
      args: [path.resolve(root, 'tools', 'bench', 'language-repos.js'), ...args],
      cwd,
      env
    };
  }
  return {
    cmd: process.execPath,
    args: [path.resolve(root, substituteRunnerToken(runner.script || '', tokens)), ...args],
    cwd,
    env
  };
};

export const runBenchRuntimeLiveCanary = async (entry, root = process.cwd()) => {
  const environment = getBenchRuntimeEnvironmentSnapshot(entry);
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-bench-canary-'));
  const outJsonPath = path.join(tempDir, `${String(entry?.id || 'canary').replace(/[^a-z0-9_-]/gi, '_')}.json`);
  const { cmd, args, cwd, env } = resolveRunnerConfig(entry, root, tempDir, outJsonPath);
  const timeoutMs = Number.isFinite(Number(entry?.runner?.timeoutMs))
    ? Math.max(1, Math.floor(Number(entry.runner.timeoutMs)))
    : DEFAULT_LIVE_CANARY_TIMEOUT_MS;
  const stdoutChunks = [];
  const stderrChunks = [];

  let result;
  try {
    result = await spawnSubprocess(cmd, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      timeoutMs,
      onStdout: (chunk) => stdoutChunks.push(String(chunk || '')),
      onStderr: (chunk) => stderrChunks.push(String(chunk || ''))
    });
  } catch (error) {
    const stderr = stderrChunks.join('');
    const stdout = stdoutChunks.join('');
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return {
      id: String(entry?.id || '').trim() || null,
      issue: Number.isFinite(Number(entry?.issue)) ? Number(entry.issue) : null,
      status: BENCH_RUNTIME_LIVE_CANARY_STATUS.RUNNER_FAILED,
      ok: false,
      closureReady: false,
      runner: { cmd, args, cwd, timeoutMs },
      environment,
      stdout,
      stderr,
      error: error?.message || String(error)
    };
  }

  const stdout = stdoutChunks.join('');
  const stderr = stderrChunks.join('');
  let payload = null;
  if (fs.existsSync(outJsonPath)) {
    payload = JSON.parse(await fsPromises.readFile(outJsonPath, 'utf8'));
  } else {
    const trimmed = stdout.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      payload = JSON.parse(trimmed);
    }
  }
  const metrics = extractBenchRuntimeCanaryMetrics(payload || {});
  const current = evaluateBenchRuntimeCanaryContract(entry?.currentContract || {}, metrics);
  const target = evaluateBenchRuntimeCanaryContract(entry?.targetContract || {}, metrics);
  const regressionFailures = evaluateBenchRuntimeCanaryForbiddenRegressions(entry?.forbiddenRegressions || [], metrics);
  let status = BENCH_RUNTIME_LIVE_CANARY_STATUS.INCONCLUSIVE;
  if (regressionFailures.length) {
    status = BENCH_RUNTIME_LIVE_CANARY_STATUS.REGRESSED;
  } else if (target.ok) {
    status = BENCH_RUNTIME_LIVE_CANARY_STATUS.TARGET_ACHIEVED;
  } else if (current.ok) {
    status = BENCH_RUNTIME_LIVE_CANARY_STATUS.BASELINE_CONFIRMED;
  }

  await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  return {
    schemaVersion: BENCH_RUNTIME_LIVE_CANARY_RESULT_SCHEMA_VERSION,
    id: String(entry?.id || '').trim() || null,
    issue: Number.isFinite(Number(entry?.issue)) ? Number(entry.issue) : null,
    repo: String(entry?.repo || '').trim() || null,
    profile: String(entry?.profile || '').trim() || null,
    canaryKind: String(entry?.canaryKind || '').trim() || null,
    benchmarkConfirmationLane: String(entry?.benchmarkConfirmationLane || '').trim() || null,
    proofOfSimilarity: entry?.proofOfSimilarity || null,
    environment,
    runner: {
      cmd,
      args,
      cwd,
      timeoutMs,
      exitCode: Number(result?.exitCode),
      signal: result?.signal || null
    },
    status,
    ok: status !== BENCH_RUNTIME_LIVE_CANARY_STATUS.RUNNER_FAILED && current.ok,
    closureReady: target.ok && regressionFailures.length === 0,
    metrics,
    current,
    target,
    regressionFailures,
    stdout,
    stderr
  };
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
      .filter(Number.isFinite)
  )).sort((left, right) => left - right);
  const ok = rows.length > 0 && blockedIssues.length === 0;
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
    blockedIssues,
    environmentFingerprints,
    canaries: rows.map((entry) => ({
      id: entry?.id || null,
      issue: entry?.issue || null,
      repo: entry?.repo || null,
      profile: entry?.profile || null,
      status: entry?.status || null,
      closureReady: entry?.closureReady === true,
      benchmarkConfirmationLane: entry?.benchmarkConfirmationLane || null,
      proofOfSimilarity: entry?.proofOfSimilarity || null,
      environment: entry?.environment || null,
      metrics: entry?.metrics || null,
      currentFailures: entry?.current?.failures || [],
      targetFailures: entry?.target?.failures || [],
      regressionFailures: Array.isArray(entry?.regressionFailures) ? entry.regressionFailures : []
    }))
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
    if (entry?.environment?.mismatches?.length) {
      lines.push(`  environment mismatches: ${entry.environment.mismatches.join('; ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

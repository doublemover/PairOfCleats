import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { normalizePathForRepo } from '../../src/shared/path-normalize.js';

const DEFAULT_HISTORY_LIMIT = 12;
const SLOW_WARN_FRACTION = 0.5;
const SLOW_CRITICAL_FRACTION = 0.8;

const toRoundedMs = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(3));
};

const toOutcomeClass = (result) => {
  if (result?.status === 'redo') return 'redo';
  if (result?.timedOut) return 'timed_out';
  if (result?.status === 'passed') return 'passed';
  if (result?.status === 'skipped') return 'skipped';
  return 'failed';
};

const isFailureLike = (outcomeClass) => (
  outcomeClass === 'failed' || outcomeClass === 'timed_out' || outcomeClass === 'redo'
);

const deriveFamilyId = (result) => {
  const source = String(result?.relPath || result?.path || result?.id || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const segments = source.split('/').filter(Boolean);
  if (segments.length >= 2) return `${segments[0]}/${segments[1]}`;
  if (segments.length === 1) return segments[0].replace(/\.test\.js$/, '');
  return 'misc';
};

const buildEnvironmentFingerprint = ({ laneLabel, baseEnv = process.env } = {}) => {
  const suiteModeRaw = String(
    baseEnv?.PAIROFCLEATS_SUITE_MODE
    || process.env.PAIROFCLEATS_SUITE_MODE
    || ''
  ).trim();
  const suiteMode = suiteModeRaw || null;
  const ci = Boolean(baseEnv?.CI || baseEnv?.GITHUB_ACTIONS || process.env.CI || process.env.GITHUB_ACTIONS);
  const parts = [
    process.platform,
    process.arch,
    process.version,
    ci ? 'ci' : 'local',
    laneLabel || '',
    suiteMode || ''
  ].filter(Boolean);
  return {
    fingerprint: parts.join('|'),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    ci,
    suiteMode
  };
};

const compareByGeneratedAtDesc = (a, b) => {
  const timeA = Date.parse(a?.generatedAt || '') || 0;
  const timeB = Date.parse(b?.generatedAt || '') || 0;
  return timeB - timeA;
};

export const loadStabilityHistory = async ({ historyDir, historyLimit = DEFAULT_HISTORY_LIMIT }) => {
  const limit = Number.isFinite(Number(historyLimit))
    ? Math.max(1, Math.floor(Number(historyLimit)))
    : DEFAULT_HISTORY_LIMIT;
  if (!historyDir) {
    return {
      sourceDir: null,
      historyLimit: limit,
      artifacts: []
    };
  }
  let entries = [];
  try {
    entries = await fsPromises.readdir(historyDir, { withFileTypes: true });
  } catch {
    return {
      sourceDir: historyDir,
      historyLimit: limit,
      artifacts: []
    };
  }
  const artifacts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(historyDir, entry.name);
    try {
      const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed?.tests)) continue;
      artifacts.push(parsed);
    } catch {}
  }
  artifacts.sort(compareByGeneratedAtDesc);
  return {
    sourceDir: historyDir,
    historyLimit: limit,
    artifacts: artifacts.slice(0, limit)
  };
};

const classifyHistory = ({
  currentOutcomeClass,
  currentEnvironmentFingerprint,
  timeoutBudgetMs,
  currentDurationMs,
  historyRows
}) => {
  const outcomes = new Set(historyRows.map((row) => row.outcomeClass).filter(Boolean));
  outcomes.add(currentOutcomeClass);
  const envs = new Set(historyRows.map((row) => row.environmentFingerprint).filter(Boolean));
  if (currentEnvironmentFingerprint) envs.add(currentEnvironmentFingerprint);
  const envOutcomeMap = new Map();
  for (const row of historyRows) {
    if (!row.environmentFingerprint) continue;
    const set = envOutcomeMap.get(row.environmentFingerprint) || new Set();
    if (row.outcomeClass) set.add(row.outcomeClass);
    envOutcomeMap.set(row.environmentFingerprint, set);
  }
  if (currentEnvironmentFingerprint) {
    const set = envOutcomeMap.get(currentEnvironmentFingerprint) || new Set();
    set.add(currentOutcomeClass);
    envOutcomeMap.set(currentEnvironmentFingerprint, set);
  }
  const currentSlow = Number.isFinite(timeoutBudgetMs)
    && timeoutBudgetMs > 0
    && currentOutcomeClass === 'passed'
    && currentDurationMs >= timeoutBudgetMs * SLOW_WARN_FRACTION;
  const historicalDurations = historyRows
    .map((row) => Number(row.durationMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const maxHistoricalDurationMs = historicalDurations.length ? Math.max(...historicalDurations) : 0;
  const historicalSlow = Number.isFinite(timeoutBudgetMs)
    && timeoutBudgetMs > 0
    && maxHistoricalDurationMs >= timeoutBudgetMs * SLOW_WARN_FRACTION;
  const hasPass = outcomes.has('passed');
  const hasFailureLike = Array.from(outcomes).some(isFailureLike);

  let environmentSensitive = false;
  if (envOutcomeMap.size >= 2 && hasPass && hasFailureLike) {
    let sawPassOnly = false;
    let sawFailureLike = false;
    for (const outcomeSet of envOutcomeMap.values()) {
      const hasEnvPass = outcomeSet.has('passed');
      const hasEnvFailure = Array.from(outcomeSet).some(isFailureLike);
      if (hasEnvPass && !hasEnvFailure) sawPassOnly = true;
      if (hasEnvFailure) sawFailureLike = true;
    }
    environmentSensitive = sawPassOnly && sawFailureLike;
  }

  if (environmentSensitive) return 'environment-sensitive';
  if (hasPass && hasFailureLike) return 'flaky';
  if (currentSlow || historicalSlow) return 'slow';
  return 'stable';
};

export const buildStabilityArtifact = ({
  results,
  runId,
  root,
  laneLabel,
  retries = 0,
  history,
  timeoutResolver,
  baseEnv
}) => {
  const environment = buildEnvironmentFingerprint({ laneLabel, baseEnv });
  const historyArtifacts = Array.isArray(history?.artifacts) ? history.artifacts : [];
  const historyById = new Map();
  for (const artifact of historyArtifacts) {
    const previousTests = Array.isArray(artifact?.tests) ? artifact.tests : [];
    for (const row of previousTests) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id) continue;
      const list = historyById.get(id) || [];
      list.push({
        outcomeClass: String(row?.outcomeClass || '').trim(),
        durationMs: Number(row?.durationMs),
        environmentFingerprint: String(row?.environmentFingerprint || artifact?.environment?.fingerprint || '').trim()
      });
      historyById.set(id, list);
    }
  }

  const tests = results
    .slice()
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    .map((result) => {
      const timeoutBudgetMs = Number(timeoutResolver?.(result)) || 0;
      const outcomeClass = toOutcomeClass(result);
      const historyRows = historyById.get(result.id) || [];
      const stabilityClass = classifyHistory({
        currentOutcomeClass: outcomeClass,
        currentEnvironmentFingerprint: environment.fingerprint,
        timeoutBudgetMs,
        currentDurationMs: Number(result.durationMs) || 0,
        historyRows
      });
      const historyOutcomes = Array.from(new Set(
        historyRows.map((row) => row.outcomeClass).filter(Boolean)
      )).sort((a, b) => a.localeCompare(b));
      const historyEnvironments = Array.from(new Set(
        historyRows.map((row) => row.environmentFingerprint).filter(Boolean)
      )).sort((a, b) => a.localeCompare(b));
      return {
        id: result.id,
        path: normalizePathForRepo(result.relPath || '', root, { stripDot: true }) || '',
        lane: String(result.lane || ''),
        family: deriveFamilyId(result),
        status: String(result.status || ''),
        durationMs: toRoundedMs(result.durationMs),
        timeoutBudgetMs: toRoundedMs(timeoutBudgetMs),
        stabilityClass,
        outcomeClass,
        historyWindow: historyRows.length,
        historyOutcomes,
        historyEnvironments,
        environmentFingerprint: environment.fingerprint
      };
    });

  const familiesMap = new Map();
  for (const row of tests) {
    const family = familiesMap.get(row.family) || {
      id: row.family,
      tests: 0,
      unstable: 0,
      flaky: 0,
      slow: 0,
      environmentSensitive: 0,
      failed: 0,
      timedOut: 0,
      redo: 0,
      totalDurationMs: 0,
      maxDurationMs: 0
    };
    family.tests += 1;
    if (row.stabilityClass !== 'stable') family.unstable += 1;
    if (row.stabilityClass === 'flaky') family.flaky += 1;
    if (row.stabilityClass === 'slow') family.slow += 1;
    if (row.stabilityClass === 'environment-sensitive') family.environmentSensitive += 1;
    if (row.outcomeClass === 'failed') family.failed += 1;
    if (row.outcomeClass === 'timed_out') family.timedOut += 1;
    if (row.outcomeClass === 'redo') family.redo += 1;
    family.totalDurationMs += Number(row.durationMs) || 0;
    family.maxDurationMs = Math.max(family.maxDurationMs, Number(row.durationMs) || 0);
    familiesMap.set(row.family, family);
  }

  const families = Array.from(familiesMap.values())
    .map((entry) => ({
      id: entry.id,
      tests: entry.tests,
      unstable: entry.unstable,
      flaky: entry.flaky,
      slow: entry.slow,
      environmentSensitive: entry.environmentSensitive,
      failed: entry.failed,
      timedOut: entry.timedOut,
      redo: entry.redo,
      avgDurationMs: toRoundedMs(entry.tests ? entry.totalDurationMs / entry.tests : 0),
      maxDurationMs: toRoundedMs(entry.maxDurationMs)
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId,
    pathPolicy: 'repo-relative-posix',
    timeUnit: 'ms',
    lane: laneLabel,
    history: {
      sourceDir: history?.sourceDir || null,
      loadedArtifacts: historyArtifacts.length,
      historyLimit: Number.isFinite(Number(history?.historyLimit))
        ? Math.max(1, Math.floor(Number(history.historyLimit)))
        : DEFAULT_HISTORY_LIMIT
    },
    environment,
    policy: {
      retry: {
        runnerRetries: Math.max(0, Math.floor(Number(retries) || 0)),
        automaticRetryEnabled: Math.max(0, Math.floor(Number(retries) || 0)) > 0,
        note: 'Retries remain visible in the base test result and do not clear stability classifications.'
      },
      quarantine: {
        automaticQuarantine: false,
        note: 'This artifact reports instability; quarantine decisions remain manual until a suite family proves chronically unstable.'
      },
      escalation: {
        flaky: 'owner-review-and-repeat-run',
        slow: 'budget-review-shard-or-harness-reuse',
        environmentSensitive: 'fingerprint-review-and-environment-normalization'
      }
    },
    summary: {
      tests: tests.length,
      unstable: tests.filter((row) => row.stabilityClass !== 'stable').length,
      flaky: tests.filter((row) => row.stabilityClass === 'flaky').length,
      slow: tests.filter((row) => row.stabilityClass === 'slow').length,
      environmentSensitive: tests.filter((row) => row.stabilityClass === 'environment-sensitive').length,
      failed: tests.filter((row) => row.outcomeClass === 'failed').length,
      timedOut: tests.filter((row) => row.outcomeClass === 'timed_out').length,
      redo: tests.filter((row) => row.outcomeClass === 'redo').length
    },
    families,
    tests
  };
};

export const writeStabilityArtifact = async ({
  artifactPath,
  archiveDir,
  artifact
}) => {
  if (artifactPath) {
    await fsPromises.mkdir(path.dirname(artifactPath), { recursive: true });
    await fsPromises.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }
  if (archiveDir) {
    await fsPromises.mkdir(archiveDir, { recursive: true });
    const archivePath = path.join(
      archiveDir,
      `${artifact.generatedAt.replace(/[:.]/g, '-')}-${artifact.runId}.json`
    );
    await fsPromises.writeFile(archivePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }
};

export const stabilitySlowThresholdsForTests = Object.freeze({
  warnFraction: SLOW_WARN_FRACTION,
  criticalFraction: SLOW_CRITICAL_FRACTION,
  defaultHistoryLimit: DEFAULT_HISTORY_LIMIT
});

import fsPromises from 'node:fs/promises';

export const BENCH_VERDICT_SCHEMA_VERSION = 1;
export const BENCH_POLICY_SCHEMA_VERSION = 1;
export const BENCH_WAIVER_SCHEMA_VERSION = 1;
export const BENCH_POLICY_VERSION = 'bench-language-policy-v1';

const HARD_RESULT_CLASS_PRIORITY = Object.freeze([
  'crashed',
  'timed_out',
  'infra_failed',
  'repo_failed'
]);

const DEGRADATION_DIAGNOSTIC_TYPES = new Set([
  'fallback_used',
  'parser_crash',
  'artifact_tail_stall',
  'queue_delay_hotspot',
  'scm_timeout'
]);

const WINDOWS_CRASH_EXIT_CODES = new Set([
  3221225477, // 0xC0000005 access violation
  3221225786, // 0xC000013A ctrl+c / terminated
  3221226505 // 0xC0000409 stack buffer overrun / fast fail
]);

const toText = (value) => String(value == null ? '' : value).trim();

const toIsoStringOrNull = (value) => {
  const text = toText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
};

const countMapToObject = (map) => Object.fromEntries(
  Array.from((map instanceof Map ? map : new Map()).entries())
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
);

const incrementCount = (map, key, value = 1) => {
  if (!(map instanceof Map) || !key) return;
  map.set(key, (map.get(key) || 0) + value);
};

const sumDiagnosticCounts = (entry) => {
  const sources = [
    entry?.diagnostics?.process?.countsByType,
    entry?.diagnostics?.countsByType
  ];
  const out = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) continue;
      out[key] = (out[key] || 0) + count;
    }
  }
  return out;
};

const listDegradationClasses = (entry) => Object.entries(sumDiagnosticCounts(entry))
  .filter(([type, count]) => DEGRADATION_DIAGNOSTIC_TYPES.has(type) && Number(count) > 0)
  .map(([type]) => type)
  .sort((left, right) => left.localeCompare(right));

const listContributingClasses = (entry) => {
  const classes = new Set();
  const diagnosticCounts = sumDiagnosticCounts(entry);
  for (const [type, count] of Object.entries(diagnosticCounts)) {
    if (Number(count) > 0) classes.add(type);
  }
  if (entry?.diagnostics?.crashRetention?.bundlePath) classes.add('retained_crash_bundle');
  return Array.from(classes).sort((left, right) => left.localeCompare(right));
};

const isCrashExitCode = (value) => {
  const code = Number(value);
  if (!Number.isFinite(code)) return false;
  if (WINDOWS_CRASH_EXIT_CODES.has(code)) return true;
  if (code < 0) return true;
  return false;
};

const classifyFailure = (entry) => {
  const reason = toText(entry?.failureReason);
  const signal = toText(entry?.failureSignal || entry?.signal);
  const timeoutKind = toText(entry?.timeoutKind);
  const diagnostics = sumDiagnosticCounts(entry);
  if (timeoutKind === 'idle') {
    return {
      resultClass: 'timed_out',
      primaryFailureClass: 'idle_timeout'
    };
  }
  if (timeoutKind === 'hard') {
    return {
      resultClass: 'timed_out',
      primaryFailureClass: 'hard_timeout'
    };
  }
  if (signal) {
    return {
      resultClass: 'crashed',
      primaryFailureClass: 'process_signal'
    };
  }
  if (isCrashExitCode(entry?.failureCode)) {
    return {
      resultClass: 'crashed',
      primaryFailureClass: 'process_exit_crash'
    };
  }
  if (reason === 'disk-full') {
    return {
      resultClass: 'infra_failed',
      primaryFailureClass: 'disk_full'
    };
  }
  if (reason === 'clone') {
    return {
      resultClass: 'infra_failed',
      primaryFailureClass: 'clone_failed'
    };
  }
  if (reason === 'report') {
    return {
      resultClass: 'infra_failed',
      primaryFailureClass: 'report_parse_failed'
    };
  }
  if (reason === 'preflight') {
    return {
      resultClass: 'repo_failed',
      primaryFailureClass: 'preflight_failed'
    };
  }
  if (reason === 'bench') {
    if (Number(diagnostics.parser_crash || 0) > 0) {
      return {
        resultClass: 'crashed',
        primaryFailureClass: 'parser_crash'
      };
    }
    return {
      resultClass: 'repo_failed',
      primaryFailureClass: 'benchmark_failed'
    };
  }
  return {
    resultClass: 'repo_failed',
    primaryFailureClass: reason || 'unknown_failure'
  };
};

export const classifyBenchTask = (entry) => {
  const degradationClasses = listDegradationClasses(entry);
  if (entry?.skipped) {
    return {
      resultClass: 'skipped',
      primaryFailureClass: null,
      contributingClasses: [],
      degradationClasses: []
    };
  }
  if (entry?.failed) {
    const failure = classifyFailure(entry);
    return {
      ...failure,
      contributingClasses: listContributingClasses(entry),
      degradationClasses
    };
  }
  if (degradationClasses.length) {
    return {
      resultClass: 'passed_with_degradation',
      primaryFailureClass: null,
      contributingClasses: listContributingClasses(entry),
      degradationClasses
    };
  }
  return {
    resultClass: 'passed',
    primaryFailureClass: null,
    contributingClasses: [],
    degradationClasses: []
  };
};

const normalizeWaiver = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = toText(row.id);
  if (!id) return null;
  const allowedUntil = toIsoStringOrNull(row.allowedUntil);
  return {
    id,
    owner: toText(row.owner) || null,
    justification: toText(row.justification) || null,
    allowedUntil,
    resultClass: toText(row.resultClass) || null,
    failureClass: toText(row.failureClass) || null,
    diagnosticType: toText(row.diagnosticType) || null,
    repo: toText(row.repo) || null,
    language: toText(row.language) || null
  };
};

export const loadBenchPolicy = async ({ waiverFile = null } = {}) => {
  const policy = {
    schemaVersion: BENCH_POLICY_SCHEMA_VERSION,
    policyVersion: BENCH_POLICY_VERSION,
    waiverFile: waiverFile ? String(waiverFile) : null,
    waiverSchemaVersion: BENCH_WAIVER_SCHEMA_VERSION,
    waivers: [],
    loadErrors: []
  };
  if (!waiverFile) return policy;
  try {
    const raw = JSON.parse(await fsPromises.readFile(waiverFile, 'utf8'));
    const inputRows = Array.isArray(raw?.waivers) ? raw.waivers : [];
    policy.policyVersion = toText(raw?.policyVersion) || BENCH_POLICY_VERSION;
    for (const row of inputRows) {
      const normalized = normalizeWaiver(row);
      if (normalized) policy.waivers.push(normalized);
    }
    if (Number(raw?.schemaVersion) && Number(raw.schemaVersion) !== BENCH_WAIVER_SCHEMA_VERSION) {
      policy.loadErrors.push(`unexpected waiver schemaVersion ${raw.schemaVersion}`);
    }
  } catch (error) {
    policy.loadErrors.push(error?.message || String(error));
  }
  return policy;
};

const waiverMatchesIssue = (waiver, issue) => {
  if (!waiver || !issue) return false;
  if (waiver.resultClass && waiver.resultClass !== issue.resultClass) return false;
  if (waiver.failureClass && waiver.failureClass !== issue.failureClass) return false;
  if (waiver.diagnosticType && waiver.diagnosticType !== issue.diagnosticType) return false;
  if (waiver.repo && waiver.repo !== issue.repo) return false;
  if (waiver.language && waiver.language !== issue.language) return false;
  return true;
};

const buildTaskIssues = (entry) => {
  const task = entry?.taskStatus || classifyBenchTask(entry);
  const issues = [];
  if (task.resultClass === 'passed_with_degradation') {
    for (const diagnosticType of task.degradationClasses) {
      issues.push({
        repo: entry.repo,
        language: entry.language,
        tier: entry.tier,
        resultClass: task.resultClass,
        failureClass: null,
        diagnosticType
      });
    }
    return issues;
  }
  if (HARD_RESULT_CLASS_PRIORITY.includes(task.resultClass)) {
    issues.push({
      repo: entry.repo,
      language: entry.language,
      tier: entry.tier,
      resultClass: task.resultClass,
      failureClass: task.primaryFailureClass,
      diagnosticType: null
    });
  }
  return issues;
};

export const evaluateBenchVerdict = ({ tasks, policy }) => {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const resultClassCounts = new Map();
  const failureClassCounts = new Map();
  const diagnosticTypeCounts = new Map();
  const issues = [];
  const now = Date.now();
  const activeWaivers = [];
  const expiredWaivers = [];

  for (const waiver of Array.isArray(policy?.waivers) ? policy.waivers : []) {
    const allowedAt = waiver.allowedUntil ? Date.parse(waiver.allowedUntil) : NaN;
    if (Number.isFinite(allowedAt) && allowedAt < now) {
      expiredWaivers.push(waiver);
      continue;
    }
    activeWaivers.push(waiver);
  }

  const enrichedTasks = normalizedTasks.map((entry) => {
    const taskStatus = classifyBenchTask(entry);
    incrementCount(resultClassCounts, taskStatus.resultClass);
    if (taskStatus.primaryFailureClass) {
      incrementCount(failureClassCounts, taskStatus.primaryFailureClass);
    }
    for (const diagnosticType of taskStatus.degradationClasses) {
      incrementCount(diagnosticTypeCounts, diagnosticType);
    }
    const taskEntry = { ...entry, taskStatus };
    for (const issue of buildTaskIssues(taskEntry)) {
      const matchedWaivers = activeWaivers.filter((waiver) => waiverMatchesIssue(waiver, issue));
      const waived = matchedWaivers.length > 0;
      issues.push({
        ...issue,
        waived,
        waiverIds: matchedWaivers.map((waiver) => waiver.id).sort((left, right) => left.localeCompare(right))
      });
    }
    return taskEntry;
  });

  for (const loadError of Array.isArray(policy?.loadErrors) ? policy.loadErrors : []) {
    issues.push({
      repo: null,
      language: null,
      tier: null,
      resultClass: 'infra_failed',
      failureClass: 'waiver_policy_load_failed',
      diagnosticType: null,
      waived: false,
      waiverIds: [],
      message: loadError
    });
    incrementCount(resultClassCounts, 'infra_failed');
    incrementCount(failureClassCounts, 'waiver_policy_load_failed');
  }

  const unwaivedIssues = issues.filter((issue) => !issue.waived);
  const waivedIssues = issues.filter((issue) => issue.waived);
  const matchedWaiverIds = new Set(waivedIssues.flatMap((issue) => issue.waiverIds));
  const unmatchedActiveWaivers = activeWaivers
    .filter((waiver) => !matchedWaiverIds.has(waiver.id))
    .map((waiver) => waiver.id)
    .sort((left, right) => left.localeCompare(right));

  let aggregateResultClass = 'passed';
  for (const resultClass of HARD_RESULT_CLASS_PRIORITY) {
    if (unwaivedIssues.some((issue) => issue.resultClass === resultClass)) {
      aggregateResultClass = resultClass;
      break;
    }
  }
  if (aggregateResultClass === 'passed') {
    const hasAnyDegradation = issues.length > 0;
    if (hasAnyDegradation) aggregateResultClass = 'passed_with_degradation';
  }

  return {
    tasks: enrichedTasks,
    run: {
      schemaVersion: BENCH_VERDICT_SCHEMA_VERSION,
      aggregateResultClass,
      exitCode: aggregateResultClass === 'passed' || aggregateResultClass === 'passed_with_degradation' ? 0 : 1,
      repoCounts: {
        total: enrichedTasks.length,
        passed: resultClassCounts.get('passed') || 0,
        passedWithDegradation: resultClassCounts.get('passed_with_degradation') || 0,
        skipped: resultClassCounts.get('skipped') || 0,
        failed: (resultClassCounts.get('repo_failed') || 0)
          + (resultClassCounts.get('infra_failed') || 0)
          + (resultClassCounts.get('timed_out') || 0)
          + (resultClassCounts.get('crashed') || 0)
      },
      countsByResultClass: countMapToObject(resultClassCounts),
      countsByFailureClass: countMapToObject(failureClassCounts),
      countsByDiagnosticType: countMapToObject(diagnosticTypeCounts),
      issues: {
        total: issues.length,
        unwaivedCount: unwaivedIssues.length,
        waivedCount: waivedIssues.length,
        unwaived: unwaivedIssues,
        waived: waivedIssues
      },
      policy: {
        schemaVersion: BENCH_POLICY_SCHEMA_VERSION,
        policyVersion: policy?.policyVersion || BENCH_POLICY_VERSION,
        waiverFile: policy?.waiverFile || null,
        waiverSchemaVersion: BENCH_WAIVER_SCHEMA_VERSION,
        loadErrors: Array.isArray(policy?.loadErrors) ? policy.loadErrors.slice() : [],
        activeWaiverCount: activeWaivers.length,
        expiredWaiverIds: expiredWaivers.map((waiver) => waiver.id).sort((left, right) => left.localeCompare(right)),
        matchedWaiverIds: Array.from(matchedWaiverIds).sort((left, right) => left.localeCompare(right)),
        unmatchedActiveWaiverIds: unmatchedActiveWaivers
      }
    }
  };
};

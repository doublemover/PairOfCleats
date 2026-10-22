export const BENCH_VERDICT_SCHEMA_VERSION = 1;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const classes = ['passed', 'passed_with_degradation', 'skipped', 'repo_failed', 'infra_failed', 'timed_out', 'crashed'];

/** Validate the current benchmark report projection consumed by rollout
 * comparisons. Timings may be absent/null (failed or unavailable operations),
 * but required counts and diagnostics cannot be inferred from missing data.
 * @param {unknown} payload
 * @returns {{ok:boolean,errors:string[]}}
 */
export const validateBenchComparisonInput = payload => {
  const errors = [];
  const fail = message => { if (errors.length < 64) errors.push(message); };
  if (!record(payload)) return { ok: false, errors: ['report must be an object'] };
  if (typeof payload.generatedAt !== 'string' || !Number.isFinite(Date.parse(payload.generatedAt))) fail('generatedAt must be a valid timestamp');
  const run = payload.run;
  if (!record(run)) fail('run evidence is required');
  if (run?.schemaVersion !== BENCH_VERDICT_SCHEMA_VERSION) fail('run.schemaVersion must identify supported benchmark verdict version 1');
  if (!classes.includes(run?.aggregateResultClass) || run.aggregateResultClass === 'skipped') fail('run.aggregateResultClass is unsupported or missing');
  const repos = run?.repoCounts;
  if (!record(repos)) fail('run.repoCounts evidence is required');
  const repoKeys = ['total', 'failed', 'passed', 'passedWithDegradation', 'skipped'];
  for (const key of repoKeys) if (!count(repos?.[key])) fail(`run.repoCounts.${key} must be a nonnegative safe integer`);
  if (repoKeys.every(key => count(repos?.[key]))) {
    if (repos.total === 0 || repos.total === repos.skipped) fail('report must include at least one evaluated repository');
    if (repos.failed + repos.passed + repos.passedWithDegradation + repos.skipped !== repos.total) fail('run.repoCounts categories must sum to total');
  }
  const validateCounts = (value, label, allowed = null) => {
    if (!record(value)) { fail(`${label} evidence is required`); return; }
    for (const [key, amount] of Object.entries(value)) {
      if (!key || !count(amount) || allowed && !allowed.includes(key)) fail(`${label}.${key} is not a supported nonnegative count`);
      if (label === 'run.countsByDiagnosticType' && count(repos?.total) && amount > repos.total) fail(`${label}.${key} exceeds repository presence`);
    }
  };
  validateCounts(run?.countsByResultClass, 'run.countsByResultClass', classes);
  validateCounts(run?.countsByDiagnosticType, 'run.countsByDiagnosticType');
  if (record(run?.countsByResultClass) && record(repos)
    && Object.entries(run.countsByResultClass).every(([key, amount]) => classes.includes(key) && count(amount))) {
    const values = run.countsByResultClass;
    const amount = key => Object.hasOwn(values, key) ? values[key] : 0;
    const expected = { passed: amount('passed'), passedWithDegradation: amount('passed_with_degradation'),
      skipped: amount('skipped'),
      failed: ['repo_failed', 'infra_failed', 'timed_out', 'crashed'].reduce((sum, key) => sum + amount(key), 0) };
    for (const [key, amount] of Object.entries(expected)) if (amount !== repos[key]) fail(`run.countsByResultClass disagrees with repoCounts.${key}`);
  }
  const diagnostics = payload.diagnostics;
  if (!record(diagnostics)) fail('diagnostics evidence is required');
  if (!record(diagnostics?.crashRetention) || !count(diagnostics.crashRetention.retainedCount)) fail('diagnostics.crashRetention.retainedCount evidence is required');
  const parity = diagnostics?.parity;
  if (!record(parity) || !['ok', 'warn', 'error'].includes(parity.status)
    || !count(parity.mismatchCount) || !count(parity.materialMismatchCount)) {
    fail('diagnostics.parity requires explicit status and nonnegative mismatch counts');
  } else {
    if (parity.materialMismatchCount > parity.mismatchCount) fail('material parity mismatches cannot exceed all mismatches');
    const expected = parity.materialMismatchCount > 0 ? 'error' : parity.mismatchCount > 0 ? 'warn' : 'ok';
    if (parity.status !== expected) fail('diagnostics.parity status disagrees with mismatch evidence');
  }
  const summary = payload.overallSummary;
  if (summary !== null && summary !== undefined && !record(summary)) fail('overallSummary must be an object or unavailable');
  const build = record(summary) ? summary.buildMs : null;
  if (build !== null && build !== undefined && !record(build)) fail('overallSummary.buildMs must be an object or unavailable');
  for (const [label, value] of [['buildMs.index', build?.index], ['buildMs.sqlite', build?.sqlite],
    ['queryWallMsPerSearch', summary?.queryWallMsPerSearch]]) {
    if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(`overallSummary.${label} must be a finite nonnegative measurement or unavailable`);
  }
  return { ok: errors.length === 0, errors };
};

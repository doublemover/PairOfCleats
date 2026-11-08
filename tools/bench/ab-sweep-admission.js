import { BENCH_RUNNER_REPORT_VERSION } from './runner-contract.js';
import { BENCH_WORKLOAD_VERSION, BENCH_EXPERIMENT_VERSION, benchmarkFingerprint } from './runner-workload.js';
import { admitBenchmarkObservation } from './runner-observation.js';

export const AB_SWEEP_REPORT_VERSION = 2;
export const AB_SWEEP_POLICY_VERSION = 1;
export const AB_SWEEP_OBJECTIVE = Object.freeze({ version: AB_SWEEP_POLICY_VERSION, id: 'sum-observed-duration-ms',
  required: 'successful-comparable-workload-and-applied-settings',
  optionalPolicy: 'exclude-declared-optional-only-when-all-variants-skip-identically',
  utilization: 'diagnostic-only', missingMetrics: 'unavailable' });
const complete = capture => capture?.enabled === true && capture.truncated === false
  && capture.encodingLoss === false && capture.droppedBytes === 0;
const requestedKnobs = variant => Object.fromEntries(Object.entries(variant || {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));

/** Hard admission precedes optimization. A failed or smaller workload is never
 * turned into a finite score penalty, and missing observations never become 0. */
export const qualifySweepRuns = ({ runs, workload, sourceBefore, sourceAfter }) => {
  const sourceQualified = sourceBefore?.state === 'clean-revision' && sourceAfter?.state === 'clean-revision'
    && sourceBefore.revision === sourceAfter.revision;
  const entries = workload.entries;
  const exclusions = entries.flatMap((entry, ordinal) => {
    const rows = runs.map(run => run.report?.results?.[ordinal]);
    const reason = rows[0]?.skipReason;
    return !entry.required && rows.length && typeof reason === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(reason)
      && rows.every(row => row?.status === 'skipped' && row.skipped === true && row.skipReason === reason)
      ? [{ ordinal, id: entry.id, reason }] : [];
  });
  const excluded = new Set(exclusions.map(entry => entry.ordinal));
  const denominator = entries.filter((_, ordinal) => !excluded.has(ordinal));
  const qualified = runs.map(run => {
    const reasons = [], report = run.report, measurements = [], knobs = requestedKnobs(run.variant);
    const applied = {}, consumption = {};
    if (run.status !== 0 || run.signal || run.processFailure) reasons.push('child-process-failed');
    if (entries.some(entry => entry.source?.state !== 'observed')) reasons.push('entry-source-unqualified');
    if (!sourceQualified) reasons.push('source-revision-unqualified-or-changed');
    if (!report) reasons.push(run.reportError || 'missing-report');
    else {
      if (report.schemaVersion !== BENCH_RUNNER_REPORT_VERSION) reasons.push('runner-report-version');
      if (report.reportAdmission?.state !== 'complete') reasons.push('report-admission-incomplete');
      if (report.workload?.version !== BENCH_WORKLOAD_VERSION || report.workload.fingerprint !== workload.fingerprint) reasons.push('resolved-workload-mismatch');
      if (report.experiment?.version !== BENCH_EXPERIMENT_VERSION
        || benchmarkFingerprint(report.experiment || {}) !== benchmarkFingerprint(run.experiment || {})) reasons.push('invocation-receipt-mismatch');
      const { fingerprint, ...reportedWorkload } = report.workload || {};
      if (fingerprint !== benchmarkFingerprint(reportedWorkload)) reasons.push('workload-receipt-inconsistent');
      if (!Array.isArray(report.sourceValidation) || report.sourceValidation.length !== entries.length
        || report.sourceValidation.some((source, ordinal) => source?.ordinal !== ordinal || source.state !== 'unchanged'
          || source.sha256 !== entries[ordinal].source?.sha256 || source.bytes !== entries[ordinal].source?.bytes)) reasons.push('entry-source-changed');
      if (!report.runner || !['platform', 'arch', 'node', 'cpuModel', 'storagePath'].every(key => typeof report.runner[key] === 'string' && report.runner[key].length > 0)
        || !Number.isSafeInteger(report.runner.logicalCpuCount) || report.runner.logicalCpuCount < 1) reasons.push('host-observation-unqualified');
      if (!Array.isArray(report.results) || report.results.length !== entries.length) reasons.push('script-coverage-mismatch');
      if (!denominator.length) reasons.push('empty-comparable-workload');
      for (const [ordinal, entry] of entries.entries()) {
        const row = report.results?.[ordinal];
        if (!row || row.id !== entry.id || row.absScript !== entry.absScript
          || JSON.stringify(row.args) !== JSON.stringify(entry.args) || row.required !== entry.required) {
          reasons.push(`script-contract-mismatch:${entry.id}`); continue;
        }
        if (excluded.has(ordinal)) {
          if (row.processOk !== true || row.exitCode !== 0 || row.timedOut || row.signal || row.processFailure || !complete(row.outputCapture?.stdout)) reasons.push(`optional-skip-process-failed:${entry.id}`);
          continue;
        }
        if (row.status !== 'ok' || row.ok !== true || row.processOk !== true || row.parsedOk !== true
          || row.timedOut || row.signal || row.processFailure || row.skipped || row.exitCode !== 0) {
          reasons.push(`script-not-completed:${entry.id}`); continue;
        }
        if (!complete(row.outputCapture?.stdout)) { reasons.push(`measurement-capture-incomplete:${entry.id}`); continue; }
        const admitted = admitBenchmarkObservation(row.json?.benchmarkObservation);
        if (!admitted.ok) { reasons.push(`${row.observationAdmission || admitted.reason}:${entry.id}`); continue; }
        const observation = admitted.observation;
        measurements.push({ id: entry.id, scope: observation.scope, workload: observation.workload,
          durationMs: observation.metrics.durationMs, correctness: observation.correctness });
        for (const [key, requested] of Object.entries(knobs)) {
          const consumed = observation.knobs[key];
          consumption[key] ||= [];
          consumption[key].push({ script: entry.id, state: consumed?.state || 'unverified',
            ...(consumed?.state === 'applied' ? { value: consumed.value } : {}) });
          if (!consumed || consumed.state === 'unverified') reasons.push(`knob-unverified:${key}:${entry.id}`);
          else if (consumed.state === 'applied') {
            if (consumed.value !== requested) reasons.push(`knob-value-mismatch:${key}:${entry.id}`);
            else applied[key] = requested;
          }
        }
      }
      for (const key of Object.keys(knobs)) if (!Object.hasOwn(applied, key)) reasons.push(`knob-not-applied:${key}`);
    }
    const comparable = measurements.length === denominator.length && denominator.length > 0
      ? benchmarkFingerprint({ entries: measurements.map(({ id, scope, workload: measured }) => ({ id, scope, workload: measured })),
        host: report?.runner ? Object.fromEntries(['platform', 'arch', 'node', 'cpuModel', 'logicalCpuCount', 'storageTier', 'storagePath'].map(key => [key, report.runner[key] ?? null])) : null }) : null;
    const durationMs = measurements.length === denominator.length && measurements.length
      ? measurements.reduce((sum, entry) => sum + entry.durationMs, 0) : null;
    if (durationMs !== null && !Number.isFinite(durationMs)) reasons.push('aggregate-duration-invalid');
    return { ...run, eligibility: { eligible: reasons.length === 0, reasons: [...new Set(reasons)],
      comparableFingerprint: comparable, measurements, requestedKnobs: knobs, effectiveKnobs: applied, consumption },
    score: reasons.length === 0 ? durationMs : null };
  });
  const candidates = qualified.filter(run => run.eligibility.eligible);
  const mismatch = new Set(candidates.map(run => run.eligibility.comparableFingerprint)).size > 1;
  if (mismatch) for (const run of candidates) {
    run.eligibility.eligible = false; run.eligibility.reasons.push('observed-workload-or-host-mismatch'); run.score = null;
  }
  const incomplete = runs.some(run => run.notRunReason);
  const eligible = qualified.filter(run => run.eligibility.eligible).sort((left, right) => left.score - right.score || left.runId.localeCompare(right.runId));
  const best = incomplete ? null : eligible[0];
  return { runs: qualified, objective: AB_SWEEP_OBJECTIVE, exclusions,
    coverage: { requestedVariants: runs.length, eligibleVariants: eligible.length, excludedVariants: runs.length - eligible.length,
      declaredScripts: entries.length, measuredScriptsPerEligibleVariant: denominator.length },
    outcome: incomplete ? 'incomplete-experiment' : best ? 'qualified-observed-best' : 'insufficient-qualified-work',
    recommendation: best ? { bestRunId: best.runId, bestConfig: best.eligibility.effectiveKnobs, score: best.score,
      qualificationScope: best.eligibility.measurements.every(entry => entry.scope === 'fixture') ? 'fixture' : 'same-observed-host-and-workload',
      rationale: 'lowest observed duration among successful comparable variants with confirmed knob consumption' } : null };
};

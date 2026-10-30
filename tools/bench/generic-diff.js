import { stableStringify } from '../../src/shared/stable-json.js';
import { admitBenchmarkObservation } from './runner-observation.js';

const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const duration = entry => {
  // The arm is fixed for this comparison. Missing current is not baseline.
  const metrics = entry?.parsed?.current?.metrics;
  for (const key of ['duration', 'total', 'ms', 'totalMs']) if (measured(metrics?.[key])) return metrics[key];
  return null;
};
const index = report => {
  const counts = new Map(), rows = new Map();
  for (const entry of Array.isArray(report?.results) ? report.results : []) {
    const base = stableStringify([entry?.id, entry?.script]), occurrence = counts.get(base) || 0;
    counts.set(base, occurrence + 1);
    rows.set(base + ':' + occurrence, { entry, occurrence });
  }
  return rows;
};

/** Generic runner comparisons keep each declared case and reject unsupported
 * work before subtracting timings. Source revision is deliberately not a
 * controlled axis: measuring a code change is the ordinary use of this tool. */
export const compareGenericBenchmarkReports = (before, after) => {
  const left = index(before), right = index(after), diffs = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(key)?.entry, b = right.get(key)?.entry, reasons = [];
    if (!a || !b) reasons.push('case-missing');
    if (!a?.id || !b?.id || !a?.script || !b?.script) reasons.push('declared-case-identity-missing');
    for (const report of [before, after]) if (report?.results?.filter(row => row.id === (a?.id || b?.id)
      && row.script === (a?.script || b?.script)).length > 1) reasons.push('declared-case-identity-ambiguous');
    if (!Array.isArray(a?.args) || !Array.isArray(b?.args) || stableStringify(a.args) !== stableStringify(b.args)) reasons.push('arguments-differ-or-unknown');
    for (const [label, row, report] of [['before', a, before], ['after', b, after]]) {
      if (row?.ok !== true || row?.status !== 'ok' || row?.timedOut !== false || row?.skipped === true
        || row?.exitCode !== 0 || row?.signal || row?.processFailure) reasons.push(`${label}-measurement-failed-or-unqualified`);
      if (report?.reportAdmission?.state !== 'complete') reasons.push(`${label}-report-incomplete`);
      if (!report?.workload?.entries?.some(entry => entry.id === row?.id && entry.absScript === row?.absScript
        && stableStringify(entry.args) === stableStringify(row?.args))) reasons.push(`${label}-case-contract-unqualified`);
    }
    const observedA = admitBenchmarkObservation(a?.json?.benchmarkObservation), observedB = admitBenchmarkObservation(b?.json?.benchmarkObservation);
    if (!observedA.ok || !observedB.ok) reasons.push('completed-work-correctness-or-configuration-unqualified');
    else if (stableStringify(observedA.observation.workload) !== stableStringify(observedB.observation.workload)) reasons.push('measured-workload-differs');
    const beforeMs = duration(a), afterMs = duration(b);
    if (beforeMs === null || afterMs === null) reasons.push('current-arm-duration-unavailable');
    const comparable = reasons.length === 0;
    const deltaMs = comparable ? afterMs - beforeMs : null;
    diffs.push({ id: a?.id || b?.id || null, script: a?.script || b?.script || null, occurrence: left.get(key)?.occurrence ?? right.get(key)?.occurrence,
      arm: 'current', state: comparable ? 'comparable' : 'incomparable', reasons, beforeMs, afterMs,
      deltaMs, deltaPct: comparable && beforeMs > 0 ? deltaMs / beforeMs * 100 : null,
      pairedMeasurements: comparable ? 1 : 0, sourceAxis: 'code-revision-may-vary' });
  }
  return { schemaVersion: 2, kind: 'qualified-generic-benchmark-diff',
    state: diffs.length && diffs.every(row => row.state === 'comparable') ? 'comparable' : 'incomparable',
    requestedCases: diffs.length, comparableCases: diffs.filter(row => row.state === 'comparable').length, diffs };
};

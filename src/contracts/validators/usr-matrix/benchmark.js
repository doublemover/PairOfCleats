import { normalizeObservedResultMap } from './profile-helpers.js';
import {
  appendPrefixedRowDiagnostics,
  buildMatrixRegistryFailureResult,
  buildReportFindings,
  buildReportStatus,
  freezeRowDiagnostics,
  normalizeReportScope
} from './report-shaping.js';
import { validateUsrMatrixRegistry } from './registry.js';

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload,
  sloBudgetsPayload
} = {}) {
  const benchmarkPolicyValidation = validateUsrMatrixRegistry('usr-benchmark-policy', benchmarkPolicyPayload);
  if (!benchmarkPolicyValidation.ok) {
    return buildMatrixRegistryFailureResult(benchmarkPolicyValidation);
  }

  const sloBudgetValidation = validateUsrMatrixRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloBudgetValidation.ok) {
    return buildMatrixRegistryFailureResult(sloBudgetValidation);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];

  const idCounts = new Map();
  for (const row of benchmarkRows) {
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }

  const sloByLane = new Map();
  for (const row of sloRows) {
    if (sloByLane.has(row.laneId)) {
      warnings.push(`duplicate slo budget lane row; first row retained for laneId=${row.laneId}`);
      continue;
    }
    sloByLane.set(row.laneId, row);
  }

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((idCounts.get(row.id) || 0) > 1) {
      rowErrors.push('benchmark policy id must be unique');
    }

    if (row.warmupRuns < 1) {
      rowErrors.push('warmupRuns must be >= 1 for deterministic methodology');
    }

    if (row.measureRuns < 3) {
      rowErrors.push('measureRuns must be >= 3 for deterministic percentile confidence');
    }

    const p50 = row?.percentileTargets?.p50DurationMs;
    const p95 = row?.percentileTargets?.p95DurationMs;
    const p99 = row?.percentileTargets?.p99DurationMs;
    if (!(p50 <= p95 && p95 <= p99)) {
      rowErrors.push('percentileTargets must satisfy p50 <= p95 <= p99');
    }

    if (row.maxVariancePct <= 0 || row.maxVariancePct > 100) {
      rowErrors.push('maxVariancePct must be in (0, 100]');
    }

    const sloBudget = sloByLane.get(row.laneId);
    if (!sloBudget) {
      if (row.blocking) {
        rowErrors.push(`blocking benchmark row requires matching slo budget laneId=${row.laneId}`);
      } else {
        rowWarnings.push(`non-blocking benchmark row has no matching slo budget laneId=${row.laneId}`);
      }
    } else {
      if (row.maxPeakMemoryMb > sloBudget.maxMemoryMb) {
        rowErrors.push(`benchmark maxPeakMemoryMb exceeds slo maxMemoryMb for laneId=${row.laneId}`);
      }
      if (row.percentileTargets.p95DurationMs > sloBudget.maxDurationMs) {
        rowErrors.push(`benchmark p95DurationMs exceeds slo maxDurationMs for laneId=${row.laneId}`);
      }
    }

    appendPrefixedRowDiagnostics({
      errors,
      warnings,
      rowErrors,
      rowWarnings,
      messagePrefix: row.id
    });

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      ...freezeRowDiagnostics({ errors: rowErrors, warnings: rowWarnings })
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {}
} = {}) {
  const methodology = validateUsrBenchmarkMethodology({
    benchmarkPolicyPayload,
    sloBudgetsPayload
  });

  const errors = [...methodology.errors];
  const warnings = [...methodology.warnings];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const sloByLane = new Map(sloRows.map((row) => [row.laneId, row]));
  const observedById = normalizeObservedResultMap(observedResults);

  const rows = [];

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const observed = observedById.get(row.id);
    if (!observed) {
      if (row.blocking) {
        rowErrors.push('missing observed benchmark results for blocking row');
      } else {
        rowWarnings.push('missing observed benchmark results for non-blocking row');
      }
    }

    const p50Observed = toNumber(observed?.p50DurationMs);
    const p95Observed = toNumber(observed?.p95DurationMs);
    const p99Observed = toNumber(observed?.p99DurationMs);
    const varianceObserved = toNumber(observed?.variancePct);
    const peakMemoryObserved = toNumber(observed?.peakMemoryMb);

    const compare = ({ condition, message }) => {
      if (condition) {
        return;
      }
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    };

    if (observed) {
      compare({ condition: p50Observed != null, message: 'observed p50DurationMs must be numeric' });
      compare({ condition: p95Observed != null, message: 'observed p95DurationMs must be numeric' });
      compare({ condition: p99Observed != null, message: 'observed p99DurationMs must be numeric' });
      compare({ condition: varianceObserved != null, message: 'observed variancePct must be numeric' });
      compare({ condition: peakMemoryObserved != null, message: 'observed peakMemoryMb must be numeric' });

      if (p50Observed != null) {
        compare({ condition: p50Observed <= row.percentileTargets.p50DurationMs, message: `p50DurationMs regression: ${p50Observed} > ${row.percentileTargets.p50DurationMs}` });
      }
      if (p95Observed != null) {
        compare({ condition: p95Observed <= row.percentileTargets.p95DurationMs, message: `p95DurationMs regression: ${p95Observed} > ${row.percentileTargets.p95DurationMs}` });
      }
      if (p99Observed != null) {
        compare({ condition: p99Observed <= row.percentileTargets.p99DurationMs, message: `p99DurationMs regression: ${p99Observed} > ${row.percentileTargets.p99DurationMs}` });
      }
      if (varianceObserved != null) {
        compare({ condition: varianceObserved <= row.maxVariancePct, message: `variancePct regression: ${varianceObserved} > ${row.maxVariancePct}` });
      }
      if (peakMemoryObserved != null) {
        compare({ condition: peakMemoryObserved <= row.maxPeakMemoryMb, message: `peakMemoryMb regression: ${peakMemoryObserved} > ${row.maxPeakMemoryMb}` });
      }

      const sloBudget = sloByLane.get(row.laneId);
      if (sloBudget) {
        if (p95Observed != null) {
          compare({ condition: p95Observed <= sloBudget.maxDurationMs, message: `p95DurationMs exceeds slo maxDurationMs: ${p95Observed} > ${sloBudget.maxDurationMs}` });
        }
        if (peakMemoryObserved != null) {
          compare({ condition: peakMemoryObserved <= sloBudget.maxMemoryMb, message: `peakMemoryMb exceeds slo maxMemoryMb: ${peakMemoryObserved} > ${sloBudget.maxMemoryMb}` });
        }
      }
    }

    appendPrefixedRowDiagnostics({
      errors,
      warnings,
      rowErrors,
      rowWarnings,
      messagePrefix: row.id
    });

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0 && rowWarnings.length === 0,
      ...freezeRowDiagnostics({ errors: rowErrors, warnings: rowWarnings }),
      observed: observed || null
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-benchmark-regression-evaluator',
  producerVersion = null,
  runId = 'run-usr-benchmark-regression',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrBenchmarkRegression({
    benchmarkPolicyPayload,
    sloBudgetsPayload,
    observedResults
  });

  const rows = evaluation.rows.map((row) => ({
    id: row.id,
    laneId: row.laneId,
    blocking: row.blocking,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings,
    observed: row.observed
  }));

  const status = buildReportStatus(evaluation);
  const normalizedScope = normalizeReportScope(scope, 'global', 'global');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-benchmark-regression-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length
    },
    blockingFindings: buildReportFindings(evaluation.errors, 'benchmark-regression'),
    advisoryFindings: buildReportFindings(evaluation.warnings, 'benchmark-regression'),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}


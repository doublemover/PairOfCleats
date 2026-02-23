const normalizeBenchmarkObservedResults = (results) => {
  if (Array.isArray(results)) {
    return new Map(
      results
        .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
        .map((row) => [row.id, row])
    );
  }

  if (results && typeof results === 'object') {
    return new Map(Object.entries(results));
  }

  return new Map();
};

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeScopeWithFallback = (
  scope,
  fallbackScopeType = 'global',
  fallbackScopeId = 'global'
) => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

const resolveReportStatus = ({ errors = [], warnings = [] }) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

const emptyValidationResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

/**
 * Validate benchmark policy methodology against SLO budgets.
 *
 * @param {object} [input]
 * @param {object} [input.benchmarkPolicyPayload]
 * @param {object} [input.sloBudgetsPayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const benchmarkPolicyValidation = validateRegistry('usr-benchmark-policy', benchmarkPolicyPayload);
  if (!benchmarkPolicyValidation?.ok) {
    return emptyValidationResult(benchmarkPolicyValidation?.errors || ['invalid usr-benchmark-policy payload']);
  }

  const sloBudgetValidation = validateRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloBudgetValidation?.ok) {
    return emptyValidationResult(sloBudgetValidation?.errors || ['invalid usr-slo-budgets payload']);
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

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
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
  observedResults = {},
  validateRegistry
} = {}) {
  const methodology = validateUsrBenchmarkMethodology({
    benchmarkPolicyPayload,
    sloBudgetsPayload,
    validateRegistry
  });

  const errors = [...methodology.errors];
  const warnings = [...methodology.warnings];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const sloByLane = new Map(sloRows.map((row) => [row.laneId, row]));
  const observedById = normalizeBenchmarkObservedResults(observedResults);

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

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0 && rowWarnings.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings]),
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
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = evaluateUsrBenchmarkRegression({
    benchmarkPolicyPayload,
    sloBudgetsPayload,
    observedResults,
    validateRegistry
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

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-benchmark-regression-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus(evaluation),
    scope: normalizeScope(scope, 'global', 'global'),
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
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

const OBSERVABILITY_METRIC_SELECTORS = Object.freeze({
  capability_downgrade_rate: (metrics) => metrics.capabilityDowngradeRate,
  critical_diagnostic_count: (metrics) => metrics.criticalDiagnosticCount,
  lane_duration_ms: (metrics) => metrics.durationMs,
  lane_peak_memory_mb: (metrics) => metrics.peakMemoryMb,
  redaction_failure_count: (metrics) => metrics.redactionFailureCount,
  unknown_kind_rate: (metrics) => metrics.unknownKindRate,
  unresolved_reference_rate: (metrics) => metrics.unresolvedRate
});

const compareByOperator = ({ left, operator, right }) => {
  if (operator === '>') {
    return left > right;
  }
  if (operator === '>=') {
    return left >= right;
  }
  if (operator === '<') {
    return left < right;
  }
  if (operator === '<=') {
    return left <= right;
  }
  if (operator === '==') {
    return left === right;
  }
  return false;
};

const normalizeObservabilityLaneMetrics = (observedLaneMetrics) => {
  if (Array.isArray(observedLaneMetrics)) {
    return new Map(
      observedLaneMetrics
        .filter((row) => row && typeof row === 'object' && typeof row.laneId === 'string')
        .map((row) => [row.laneId, row])
    );
  }

  if (observedLaneMetrics && typeof observedLaneMetrics === 'object') {
    return new Map(
      Object.entries(observedLaneMetrics)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([laneId, value]) => [laneId, { laneId, ...value }])
    );
  }

  return new Map();
};

const validateObservedNumber = ({ value, field, rowErrors, rowWarnings, blocking }) => {
  if (Number.isFinite(value)) {
    return true;
  }
  const message = `observed metric missing or non-numeric: ${field}`;
  if (blocking) {
    rowErrors.push(message);
  } else {
    rowWarnings.push(message);
  }
  return false;
};

const emptyValidationResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

const resolveReportStatus = ({ errors = [], warnings = [] }) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

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

/**
 * Evaluate observed lane metrics against SLO and alert-policy matrices.
 *
 * @param {object} [input]
 * @param {object} [input.sloBudgetsPayload]
 * @param {object} [input.alertPoliciesPayload]
 * @param {object|Array<object>} [input.observedLaneMetrics]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function evaluateUsrObservabilityRollup({
  sloBudgetsPayload,
  alertPoliciesPayload,
  observedLaneMetrics = {},
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }
  const sloValidation = validateRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloValidation?.ok) {
    return emptyValidationResult(sloValidation?.errors || ['invalid usr-slo-budgets payload']);
  }

  const alertValidation = validateRegistry('usr-alert-policies', alertPoliciesPayload);
  if (!alertValidation?.ok) {
    return emptyValidationResult(alertValidation?.errors || ['invalid usr-alert-policies payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const alertRows = Array.isArray(alertPoliciesPayload?.rows) ? alertPoliciesPayload.rows : [];
  const metricsByLane = normalizeObservabilityLaneMetrics(observedLaneMetrics);

  for (const row of sloRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = metricsByLane.get(row.laneId) || null;

    if (!observed) {
      const message = `missing observed lane metrics for laneId=${row.laneId}`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else {
      const durationOk = validateObservedNumber({
        value: observed.durationMs,
        field: 'durationMs',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (durationOk && observed.durationMs > row.maxDurationMs) {
        const message = `durationMs exceeds slo maxDurationMs: ${observed.durationMs} > ${row.maxDurationMs}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const memoryOk = validateObservedNumber({
        value: observed.peakMemoryMb,
        field: 'peakMemoryMb',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (memoryOk && observed.peakMemoryMb > row.maxMemoryMb) {
        const message = `peakMemoryMb exceeds slo maxMemoryMb: ${observed.peakMemoryMb} > ${row.maxMemoryMb}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const parserOk = validateObservedNumber({
        value: observed.parserTimePerSegmentMs,
        field: 'parserTimePerSegmentMs',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (parserOk && observed.parserTimePerSegmentMs > row.maxParserTimePerSegmentMs) {
        const message = `parserTimePerSegmentMs exceeds slo maxParserTimePerSegmentMs: ${observed.parserTimePerSegmentMs} > ${row.maxParserTimePerSegmentMs}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const unknownKindOk = validateObservedNumber({
        value: observed.unknownKindRate,
        field: 'unknownKindRate',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (unknownKindOk && observed.unknownKindRate > row.maxUnknownKindRate) {
        const message = `unknownKindRate exceeds slo maxUnknownKindRate: ${observed.unknownKindRate} > ${row.maxUnknownKindRate}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const unresolvedOk = validateObservedNumber({
        value: observed.unresolvedRate,
        field: 'unresolvedRate',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (unresolvedOk && observed.unresolvedRate > row.maxUnresolvedRate) {
        const message = `unresolvedRate exceeds slo maxUnresolvedRate: ${observed.unresolvedRate} > ${row.maxUnresolvedRate}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.laneId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.laneId} ${message}`));
    }

    rows.push({
      rowType: 'slo-budget',
      laneId: row.laneId,
      scopeId: row.scopeId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const [laneId] of metricsByLane.entries()) {
    if (!sloRows.some((row) => row.laneId === laneId)) {
      warnings.push(`observed lane metrics without matching slo budget row: ${laneId}`);
    }
  }

  for (const alert of alertRows) {
    const metricSelector = OBSERVABILITY_METRIC_SELECTORS[alert.metric];
    if (!metricSelector) {
      const message = `unsupported alert metric mapping: ${alert.metric}`;
      if (alert.blocking) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
      continue;
    }

    for (const [laneId, observed] of metricsByLane.entries()) {
      const rowErrors = [];
      const rowWarnings = [];
      const observedValue = metricSelector(observed);
      const numeric = Number.isFinite(observedValue);
      let triggered = false;

      if (!numeric) {
        const message = `observed metric missing or non-numeric for alert ${alert.id}: ${alert.metric}`;
        if (alert.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      } else {
        triggered = compareByOperator({
          left: observedValue,
          operator: alert.comparator,
          right: alert.threshold
        });

        if (triggered) {
          const message = `alert triggered ${alert.metric} ${alert.comparator} ${alert.threshold} (observed=${observedValue})`;
          if (alert.blocking) {
            rowErrors.push(message);
          } else {
            rowWarnings.push(message);
          }
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors.map((message) => `${alert.id} ${laneId} ${message}`));
      }
      if (rowWarnings.length > 0) {
        warnings.push(...rowWarnings.map((message) => `${alert.id} ${laneId} ${message}`));
      }

      rows.push({
        rowType: 'alert-evaluation',
        id: `${alert.id}::${laneId}`,
        alertId: alert.id,
        laneId,
        metric: alert.metric,
        comparator: alert.comparator,
        threshold: alert.threshold,
        observedValue: numeric ? observedValue : null,
        severity: alert.severity,
        escalationPolicyId: alert.escalationPolicyId,
        blocking: Boolean(alert.blocking),
        triggered,
        pass: rowErrors.length === 0,
        errors: Object.freeze([...rowErrors]),
        warnings: Object.freeze([...rowWarnings])
      });
    }
  }

  const batchHotspotRows = sloRows
    .filter((row) => row.profileScope === 'batch')
    .map((row) => {
      const observed = metricsByLane.get(row.laneId) || {};
      const durationMs = Number.isFinite(observed.durationMs) ? observed.durationMs : null;
      const peakMemoryMb = Number.isFinite(observed.peakMemoryMb) ? observed.peakMemoryMb : null;
      const parserTimePerSegmentMs = Number.isFinite(observed.parserTimePerSegmentMs) ? observed.parserTimePerSegmentMs : null;
      return {
        rowType: 'batch-hotspot',
        id: `hotspot::${row.laneId}`,
        laneId: row.laneId,
        scopeId: row.scopeId,
        durationMs,
        peakMemoryMb,
        parserTimePerSegmentMs,
        durationRank: null,
        memoryRank: null,
        parserTimeRank: null,
        isDurationHotspot: false,
        isMemoryHotspot: false,
        isParserTimeHotspot: false,
        blocking: false,
        pass: true,
        errors: Object.freeze([]),
        warnings: Object.freeze([])
      };
    })
    .sort((a, b) => a.laneId.localeCompare(b.laneId));

  const assignRank = (key, rankKey, hotspotFlag) => {
    const ranked = [...batchHotspotRows]
      .filter((row) => Number.isFinite(row[key]))
      .sort((a, b) => {
        if (b[key] !== a[key]) return b[key] - a[key];
        return a.laneId.localeCompare(b.laneId);
      });

    ranked.forEach((row, index) => {
      row[rankKey] = index + 1;
      row[hotspotFlag] = index < 3;
    });
  };

  assignRank('durationMs', 'durationRank', 'isDurationHotspot');
  assignRank('peakMemoryMb', 'memoryRank', 'isMemoryHotspot');
  assignRank('parserTimePerSegmentMs', 'parserTimeRank', 'isParserTimeHotspot');

  rows.push(...batchHotspotRows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  })));

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrObservabilityRollupReport({
  sloBudgetsPayload,
  alertPoliciesPayload,
  observedLaneMetrics = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-observability-rollup-evaluator',
  producerVersion = null,
  runId = 'run-usr-observability-rollup',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' },
  validateRegistry,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  const evaluation = evaluateUsrObservabilityRollup({
    sloBudgetsPayload,
    alertPoliciesPayload,
    observedLaneMetrics,
    validateRegistry
  });

  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-observability-rollup',
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
      sloBudgetRowCount: rows.filter((row) => row.rowType === 'slo-budget').length,
      alertEvaluationRowCount: rows.filter((row) => row.rowType === 'alert-evaluation').length,
      batchHotspotRowCount: rows.filter((row) => row.rowType === 'batch-hotspot').length,
      durationHotspotCount: rows.filter((row) => row.rowType === 'batch-hotspot' && row.isDurationHotspot).length,
      memoryHotspotCount: rows.filter((row) => row.rowType === 'batch-hotspot' && row.isMemoryHotspot).length,
      parserTimeHotspotCount: rows.filter((row) => row.rowType === 'batch-hotspot' && row.isParserTimeHotspot).length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      alertTriggerCount: rows.filter((row) => row.rowType === 'alert-evaluation' && row.triggered).length,
      blockingAlertTriggerCount: rows.filter((row) => row.rowType === 'alert-evaluation' && row.blocking && row.triggered).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'observability',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'observability',
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

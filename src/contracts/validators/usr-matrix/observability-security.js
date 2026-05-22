import {
  OBSERVABILITY_METRIC_SELECTORS,
  buildBatchObservabilityHotspotRows,
  compareByOperator,
  normalizeObservabilityLaneMetrics,
  validateObservedNumber
} from './observability-helpers.js';
import {
  normalizeObservedResultMap,
  resolveObservedGatePass,
  resolveObservedRedactionResult
} from './profile-helpers.js';
import {
  appendPrefixedRowDiagnostics,
  buildMatrixRegistryFailureResult,
  buildReportFindings,
  buildReportPayload,
  buildReportStatus,
  cloneRowsWithDiagnostics,
  freezeRowDiagnostics,
  normalizeReportScope
} from './report-shaping.js';
import { validateUsrMatrixRegistry } from './registry.js';

export function evaluateUsrObservabilityRollup({
  sloBudgetsPayload,
  alertPoliciesPayload,
  observedLaneMetrics = {}
} = {}) {
  const sloValidation = validateUsrMatrixRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloValidation.ok) {
    return buildMatrixRegistryFailureResult(sloValidation);
  }

  const alertValidation = validateUsrMatrixRegistry('usr-alert-policies', alertPoliciesPayload);
  if (!alertValidation.ok) {
    return buildMatrixRegistryFailureResult(alertValidation);
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

    appendPrefixedRowDiagnostics({
      errors,
      warnings,
      rowErrors,
      rowWarnings,
      messagePrefix: row.laneId
    });

    rows.push({
      rowType: 'slo-budget',
      laneId: row.laneId,
      scopeId: row.scopeId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      ...freezeRowDiagnostics({ errors: rowErrors, warnings: rowWarnings })
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

      appendPrefixedRowDiagnostics({
        errors,
        warnings,
        rowErrors,
        rowWarnings,
        messagePrefix: `${alert.id} ${laneId}`
      });

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
        ...freezeRowDiagnostics({ errors: rowErrors, warnings: rowWarnings })
      });
    }
  }

  const batchHotspotRows = buildBatchObservabilityHotspotRows(sloRows, metricsByLane);

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
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrObservabilityRollup({
    sloBudgetsPayload,
    alertPoliciesPayload,
    observedLaneMetrics
  });

  const status = buildReportStatus(evaluation);

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
    status,
    scope: normalizeReportScope(scope, 'global', 'global'),
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
    blockingFindings: buildReportFindings(evaluation.errors, 'observability'),
    advisoryFindings: buildReportFindings(evaluation.warnings, 'observability'),
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

export function validateUsrSecurityGateControls({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {}
} = {}) {
  const securityValidation = validateUsrMatrixRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation.ok) {
    return buildMatrixRegistryFailureResult(securityValidation);
  }

  const redactionValidation = validateUsrMatrixRegistry('usr-redaction-rules', redactionRulesPayload);
  if (!redactionValidation.ok) {
    return buildMatrixRegistryFailureResult(redactionValidation);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const securityRows = Array.isArray(securityGatesPayload?.rows) ? securityGatesPayload.rows : [];
  const redactionRows = Array.isArray(redactionRulesPayload?.rows) ? redactionRulesPayload.rows : [];
  const gateResultMap = normalizeObservedResultMap(gateResults, 'id');
  const redactionResultMap = normalizeObservedResultMap(redactionResults, 'id');

  for (const row of securityRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = gateResultMap.get(row.id) ?? gateResultMap.get(row.check) ?? null;
    const observedPass = resolveObservedGatePass(observed);
    const treatAsBlocking = Boolean(row.blocking || row.enforcement === 'strict');

    if (observedPass === null) {
      const message = `missing security-gate result for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const message = `security-gate failed for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    appendPrefixedRowDiagnostics({
      errors,
      warnings,
      rowErrors,
      rowWarnings
    });

    rows.push({
      rowType: 'security-gate',
      id: row.id,
      check: row.check,
      scope: row.scope,
      enforcement: row.enforcement,
      blocking: treatAsBlocking,
      pass: rowErrors.length === 0,
      ...freezeRowDiagnostics({ errors: rowErrors, warnings: rowWarnings })
    });
  }

  for (const row of redactionRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = redactionResultMap.get(row.id) ?? redactionResultMap.get(row.class) ?? null;
    const { pass: observedPass, misses } = resolveObservedRedactionResult(observed);

    if (observedPass === null) {
      const message = `missing redaction result for ${row.id} (${row.class})`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const suffix = Number.isFinite(misses) ? ` misses=${misses}` : '';
      const message = `redaction rule failed for ${row.id} (${row.class})${suffix}`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    appendPrefixedRowDiagnostics({
      errors,
      warnings,
      rowErrors,
      rowWarnings
    });

    rows.push({
      rowType: 'redaction-rule',
      id: row.id,
      class: row.class,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      misses: Number.isFinite(misses) ? misses : null,
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

export function buildUsrSecurityGateValidationReport({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-security-gate-validator',
  producerVersion = null,
  runId = 'run-usr-security-gate-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  const evaluation = validateUsrSecurityGateControls({
    securityGatesPayload,
    redactionRulesPayload,
    gateResults,
    redactionResults
  });

  const status = buildReportStatus(evaluation);

  const rows = cloneRowsWithDiagnostics(evaluation.rows);

  const payload = buildReportPayload({
    artifactId: 'usr-validation-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      rowCount: rows.length,
      securityGateRowCount: rows.filter((row) => row.rowType === 'security-gate').length,
      redactionRuleRowCount: rows.filter((row) => row.rowType === 'redaction-rule').length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: buildReportFindings(evaluation.errors, 'security-gate'),
    advisoryFindings: buildReportFindings(evaluation.warnings, 'security-gate'),
    rows
  });

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}


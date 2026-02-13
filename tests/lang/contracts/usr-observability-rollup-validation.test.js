#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateUsrObservabilityRollup,
  buildUsrObservabilityRollupReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const sloBudgets = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-slo-budgets.json'), 'utf8'));
const alertPolicies = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-alert-policies.json'), 'utf8'));

const observedLaneMetrics = Object.fromEntries((sloBudgets.rows || []).map((row) => [
  row.laneId,
  {
    durationMs: Math.max(1, Math.min(row.maxDurationMs - 1, 1190000)),
    peakMemoryMb: Math.max(1, Math.min(row.maxMemoryMb - 1, 4000)),
    parserTimePerSegmentMs: Math.max(1, row.maxParserTimePerSegmentMs - 1),
    unknownKindRate: Math.max(0, Math.min(0.01, row.maxUnknownKindRate / 2)),
    unresolvedRate: Math.max(0, Math.min(0.01, row.maxUnresolvedRate / 2)),
    capabilityDowngradeRate: 0,
    criticalDiagnosticCount: 0,
    redactionFailureCount: 0
  }
]));

const evaluation = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: alertPolicies,
  observedLaneMetrics
});
assert.equal(evaluation.ok, true, `observability rollup evaluation should pass: ${evaluation.errors.join('; ')}`);
assert.equal(evaluation.rows.some((row) => row.rowType === 'slo-budget'), true, 'observability rollup should emit slo-budget rows');
assert.equal(evaluation.rows.some((row) => row.rowType === 'alert-evaluation'), true, 'observability rollup should emit alert-evaluation rows');
assert.equal(evaluation.rows.some((row) => row.rowType === 'batch-hotspot'), true, 'observability rollup should emit batch-hotspot rows');

const rollupReport = buildUsrObservabilityRollupReport({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: alertPolicies,
  observedLaneMetrics,
  runId: 'run-usr-observability-rollup-001',
  lane: reportLane,
  producerId: 'usr-observability-rollup-harness'
});
assert.equal(rollupReport.ok, true, `observability rollup report should pass: ${rollupReport.errors.join('; ')}`);
assert.equal(Number.isInteger(rollupReport.payload.summary.batchHotspotRowCount), true, 'observability rollup summary must include batchHotspotRowCount');
assert.equal(rollupReport.payload.summary.batchHotspotRowCount > 0, true, 'observability rollup summary must include batch hotspot rows');
assert.equal(Number.isInteger(rollupReport.payload.summary.durationHotspotCount), true, 'observability rollup summary must include durationHotspotCount');
assert.equal(Number.isInteger(rollupReport.payload.summary.memoryHotspotCount), true, 'observability rollup summary must include memoryHotspotCount');
assert.equal(Number.isInteger(rollupReport.payload.summary.parserTimeHotspotCount), true, 'observability rollup summary must include parserTimeHotspotCount');
const reportValidation = validateUsrReport('usr-observability-rollup', rollupReport.payload);
assert.equal(reportValidation.ok, true, `observability rollup report payload must validate: ${reportValidation.errors.join('; ')}`);

const advisorySloBudgets = {
  ...sloBudgets,
  rows: (sloBudgets.rows || []).map((row, index) => (index === 0 ? { ...row, blocking: false } : row))
};
const advisoryLaneId = advisorySloBudgets.rows[0]?.laneId;
const advisoryObservedMetrics = {
  ...observedLaneMetrics,
  [advisoryLaneId]: {
    ...observedLaneMetrics[advisoryLaneId],
    parserTimePerSegmentMs: advisorySloBudgets.rows[0].maxParserTimePerSegmentMs + 10
  }
};
const advisoryEvaluation = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: advisorySloBudgets,
  alertPoliciesPayload: alertPolicies,
  observedLaneMetrics: advisoryObservedMetrics
});
assert.equal(advisoryEvaluation.ok, true, 'non-blocking SLO threshold breaches should not fail observability rollup');
assert.equal(advisoryEvaluation.errors.length, 0, 'non-blocking SLO threshold breaches should not emit blocking errors');
assert.equal(advisoryEvaluation.warnings.some((message) => message.includes(advisoryLaneId)), true, 'non-blocking SLO threshold breaches should emit advisory warnings');

const thresholdBreachLaneId = (sloBudgets.rows || [])[0]?.laneId;
const failingObservedMetrics = {
  ...observedLaneMetrics,
  [thresholdBreachLaneId]: {
    ...observedLaneMetrics[thresholdBreachLaneId],
    unknownKindRate: (sloBudgets.rows || [])[0].maxUnknownKindRate + 0.01,
    redactionFailureCount: 1
  }
};

const failingEvaluation = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: alertPolicies,
  observedLaneMetrics: failingObservedMetrics
});
assert.equal(failingEvaluation.ok, false, 'observability rollup should fail when blocking SLO/alert thresholds are breached');
assert.equal(failingEvaluation.errors.some((message) => message.includes(thresholdBreachLaneId)), true, 'failing observability rollup errors should include the breached lane id');

console.log('usr observability rollup validation checks passed');

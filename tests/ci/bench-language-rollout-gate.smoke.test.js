#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonFile } from '../../src/shared/json-file.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { runNode } from '../helpers/run-node.js';
import { BENCH_VERDICT_SCHEMA_VERSION } from '../../src/contracts/bench-comparison-input.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'bench-language-rollout-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-bench-language-rollout-gate-'));
const jsonPath = path.join(tempRoot, 'rollout-gate.json');
const env = applyTestEnv({ syncProcess: false });

const writeReport = async (filePath, {
  aggregateResultClass,
  total = 10,
  failed,
  retained,
  resultClasses = {},
  diagnosticTypes = {},
  parityStatus = 'ok',
  materialParityMismatches = 0,
  buildIndexMs,
  buildSqliteMs,
  queryWallMsPerSearch
}) => {
  const passedWithDegradation = resultClasses.passed_with_degradation || 0;
  const passed = total - failed - passedWithDegradation;
  const hardClasses = ['infra_failed', 'timed_out', 'crashed'];
  const completeResultClasses = { ...resultClasses,
    repo_failed: resultClasses.repo_failed ?? failed - hardClasses.reduce((sum, key) => sum + (resultClasses[key] || 0), 0),
    passed, passed_with_degradation: passedWithDegradation };
  await writeJsonFile(filePath, {
    generatedAt: '2026-03-18T00:00:00.000Z',
    run: {
      schemaVersion: BENCH_VERDICT_SCHEMA_VERSION,
      aggregateResultClass,
      repoCounts: {
        total,
        failed,
        passed,
        passedWithDegradation,
        skipped: 0
      },
      countsByResultClass: completeResultClasses,
      countsByDiagnosticType: diagnosticTypes
    },
    diagnostics: {
      crashRetention: {
        retainedCount: retained
      },
      parity: {
        status: parityStatus,
        mismatchCount: materialParityMismatches,
        materialMismatchCount: materialParityMismatches
      }
    },
    overallSummary: {
      buildMs: {
        index: buildIndexMs,
        sqlite: buildSqliteMs
      },
      queryWallMsPerSearch
    }
  }, { finalNewline: false });
};

try {
  const controlBefore = path.join(tempRoot, 'control-before.json');
  const controlAfter = path.join(tempRoot, 'control-after.json');
  const corpusBefore = path.join(tempRoot, 'corpus-before.json');
  const corpusAfter = path.join(tempRoot, 'corpus-after.json');

  await writeReport(controlBefore, {
    aggregateResultClass: 'repo_failed',
    failed: 3,
    retained: 2,
    resultClasses: { repo_failed: 3 },
    diagnosticTypes: { parser_crash: 2, artifact_tail_stall: 4 },
    buildIndexMs: 200,
    buildSqliteMs: 320,
    queryWallMsPerSearch: 14
  });
  await writeReport(controlAfter, {
    aggregateResultClass: 'passed_with_degradation',
    failed: 1,
    retained: 1,
    resultClasses: { repo_failed: 1, passed_with_degradation: 1 },
    diagnosticTypes: { parser_crash: 1, artifact_tail_stall: 2 },
    buildIndexMs: 170,
    buildSqliteMs: 280,
    queryWallMsPerSearch: 11
  });
  await writeReport(corpusBefore, {
    total: 40,
    aggregateResultClass: 'repo_failed',
    failed: 11,
    retained: 11,
    resultClasses: { repo_failed: 9, timed_out: 1, crashed: 1 },
    diagnosticTypes: { parser_crash: 5, artifact_tail_stall: 30 },
    buildIndexMs: 278.2,
    buildSqliteMs: 0,
    queryWallMsPerSearch: 28
  });
  await writeReport(corpusAfter, {
    total: 40,
    aggregateResultClass: 'passed_with_degradation',
    failed: 4,
    retained: 3,
    resultClasses: { repo_failed: 3, timed_out: 1, passed_with_degradation: 2 },
    diagnosticTypes: { parser_crash: 1, artifact_tail_stall: 8 },
    buildIndexMs: 156.4,
    buildSqliteMs: 0,
    queryWallMsPerSearch: 19
  });

  const successPlanPath = path.join(tempRoot, 'success-plan.json');
  await fs.writeFile(successPlanPath, JSON.stringify({
    schemaVersion: 1,
    id: 'artifact-publication-hardening',
    title: 'Artifact publication hardening rollout',
    fixAreas: [
      {
        id: 'publication-correctness',
        title: 'Publication correctness',
        owner: 'bench-publication',
        reproduction: {
          id: 'artifact-retained-bundle-replay',
          kind: 'replay',
          command: 'node tests/perf/bench/language-waiver-exit.test.js'
        },
        contracts: [
          {
            id: 'bench-language-run-verdict',
            kind: 'test',
            test: 'tests/perf/bench/language-run-verdict.test.js'
          }
        ],
        controlSlice: {
          beforeReport: './control-before.json',
          afterReport: './control-after.json'
        },
        fullCorpus: {
          beforeReport: './corpus-before.json',
          afterReport: './corpus-after.json'
        },
        temporaryPolicySwitches: [
          {
            id: 'publish-debug-switch',
            validationOnly: true,
            removed: true
          }
        ],
        cutover: {
          hardCutover: true,
          compatibilityPathsRemoved: true,
          note: 'no dual publication path remains'
        }
      }
    ]
  }, null, 2), 'utf8');

  const runGate = (planPath, extraArgs = []) => runNode(
    [gatePath, '--plan', planPath, '--json', jsonPath, ...extraArgs],
    'bench language rollout gate',
    ROOT,
    env,
    { stdio: 'pipe', allowFailure: true }
  );

  const successResult = runGate(successPlanPath);
  if (successResult.status !== 0) {
    console.error(successResult.stderr || successResult.stdout || '');
  }
  assert.equal(successResult.status, 0, `expected rollout gate success exit code, received ${successResult.status}`);
  const successPayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(successPayload?.status, 'ok', `expected status=ok, received ${String(successPayload?.status)}`);
  assert.equal(successPayload?.areas?.[0]?.controlSlice?.delta?.failedRepoCount, -2, 'expected control slice failed repo delta');
  assert.equal(successPayload?.areas?.[0]?.fullCorpus?.delta?.retainedCrashBundleCount, -8, 'expected full corpus retained crash bundle delta');
  assert.equal(successPayload?.areas?.[0]?.fullCorpus?.delta?.countsByDiagnosticType?.artifact_tail_stall, -22, 'expected diagnostic delta');

  const failingPlanPath = path.join(tempRoot, 'failing-plan.json');
  await fs.writeFile(failingPlanPath, JSON.stringify({
    schemaVersion: 1,
    id: 'broken-rollout',
    fixAreas: [
      {
        id: 'timeout-policy',
        title: 'Timeout policy',
        owner: '',
        contracts: [],
        controlSlice: {
          beforeReport: './control-before.json',
          afterReport: './control-after.json'
        },
        fullCorpus: {
          beforeReport: './corpus-before.json',
          afterReport: './corpus-after.json'
        },
        temporaryPolicySwitches: [
          {
            id: 'timeout-shadow-mode',
            validationOnly: false,
            removed: false
          }
        ],
        cutover: {
          hardCutover: false,
          compatibilityPathsRemoved: false
        }
      }
    ]
  }, null, 2), 'utf8');

  const failingResult = runGate(failingPlanPath, ['--enforce']);
  assert.equal(failingResult.status, 3, `expected enforced rollout gate exit 3, received ${failingResult.status}`);
  const failingPayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(failingPayload?.status, 'error', `expected status=error, received ${String(failingPayload?.status)}`);
  assert.equal(Array.isArray(failingPayload?.failures) && failingPayload.failures.length >= 5, true, 'expected rollout gate failures');

  const parityAfter = path.join(tempRoot, 'parity-after.json');
  await writeReport(parityAfter, {
    aggregateResultClass: 'passed_with_degradation',
    failed: 1,
    retained: 0,
    parityStatus: 'error',
    materialParityMismatches: 2,
    resultClasses: { passed_with_degradation: 1 },
    diagnosticTypes: { fallback_used: 1 },
    buildIndexMs: 160,
    buildSqliteMs: 250,
    queryWallMsPerSearch: 10
  });
  const parityPlanPath = path.join(tempRoot, 'parity-plan.json');
  await fs.writeFile(parityPlanPath, JSON.stringify({
    schemaVersion: 1,
    id: 'parity-rollout',
    fixAreas: [
      {
        id: 'diagnostics-parity',
        title: 'Diagnostics parity',
        owner: 'bench-observability',
        reproduction: {
          id: 'diagnostics-parity-replay',
          kind: 'replay',
          test: 'tests/tooling/reports/bench-language-diagnostics-parity-report.test.js'
        },
        contracts: [
          {
            id: 'diagnostics-parity-report',
            kind: 'test',
            test: 'tests/tooling/reports/bench-language-diagnostics-parity-report.test.js'
          }
        ],
        controlSlice: {
          beforeReport: './control-before.json',
          afterReport: './parity-after.json'
        },
        fullCorpus: {
          beforeReport: './corpus-before.json',
          afterReport: './corpus-after.json'
        },
        temporaryPolicySwitches: [],
        cutover: {
          hardCutover: true,
          compatibilityPathsRemoved: true
        }
      }
    ]
  }, null, 2), 'utf8');

  const parityResult = runGate(parityPlanPath, ['--enforce']);
  assert.equal(parityResult.status, 3, `expected parity mismatch rollout gate exit 3, received ${parityResult.status}`);
  const parityPayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(
    parityPayload?.failures?.some((entry) => String(entry?.message || '').includes('material diagnostics parity mismatches')),
    true,
    'expected parity mismatch failure to be surfaced by rollout gate'
  );

  const successPlan = JSON.parse(await fs.readFile(successPlanPath, 'utf8'));
  const invalidPath = path.join(tempRoot, 'missing-evidence.json');
  const invalidPlanPath = path.join(tempRoot, 'invalid-evidence-plan.json');
  await fs.writeFile(invalidPath, '{}');
  const invalidPlan = structuredClone(successPlan);
  invalidPlan.fixAreas[0].controlSlice.beforeReport = './missing-evidence.json';
  await fs.writeFile(invalidPlanPath, JSON.stringify(invalidPlan));
  const rejectedEvidence = runGate(invalidPlanPath, ['--enforce']);
  assert.equal(rejectedEvidence.status, 3);
  const rejectedPayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(rejectedPayload.status, 'error');
  assert.ok(rejectedPayload.failures.some(failure => failure.message.includes('invalid benchmark comparison evidence')));
  const informational = runGate(invalidPlanPath);
  assert.equal(informational.status, 0);
  assert.equal(JSON.parse(await fs.readFile(jsonPath, 'utf8')).status, 'warn', 'nonblocking mode still reports missing evidence');

  const unavailable = JSON.parse(await fs.readFile(controlBefore, 'utf8'));
  unavailable.overallSummary.buildMs.index = null;
  unavailable.overallSummary.queryWallMsPerSearch = null;
  await fs.writeFile(controlBefore, JSON.stringify(unavailable));
  const unknownTiming = runGate(successPlanPath, ['--enforce']);
  assert.equal(unknownTiming.status, 0, 'valid count/diagnostic evidence may have unavailable individual timings');
  const unknownPayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(unknownPayload.areas[0].controlSlice.before.coreTiming.buildIndexMsAvg, null);
  assert.equal(unknownPayload.areas[0].controlSlice.delta.coreTiming.buildIndexMsAvg, null);
  assert.equal(unknownPayload.areas[0].controlSlice.delta.coreTiming.queryWallMsPerSearch, null);
  assert.equal(unknownPayload.areas[0].controlSlice.delta.coreTiming.buildSqliteMsAvg, -40);

  console.log('bench-language rollout gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

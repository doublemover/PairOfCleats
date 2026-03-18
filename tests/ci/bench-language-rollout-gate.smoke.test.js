#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'bench-language-rollout-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-bench-language-rollout-gate-'));
const jsonPath = path.join(tempRoot, 'rollout-gate.json');

const writeReport = async (filePath, {
  aggregateResultClass,
  failed,
  retained,
  resultClasses = {},
  diagnosticTypes = {},
  buildIndexMs,
  buildSqliteMs,
  queryWallMsPerSearch
}) => {
  await fs.writeFile(filePath, JSON.stringify({
    generatedAt: '2026-03-18T00:00:00.000Z',
    run: {
      aggregateResultClass,
      repoCounts: {
        total: 10,
        failed,
        passed: 10 - failed,
        passedWithDegradation: 0,
        skipped: 0
      },
      countsByResultClass: resultClasses,
      countsByDiagnosticType: diagnosticTypes
    },
    diagnostics: {
      crashRetention: {
        retainedCount: retained
      }
    },
    overallSummary: {
      buildMs: {
        index: buildIndexMs,
        sqlite: buildSqliteMs
      },
      queryWallMsPerSearch
    }
  }, null, 2), 'utf8');
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

  const runGate = (planPath, extraArgs = []) => spawnSync(
    process.execPath,
    [gatePath, '--plan', planPath, '--json', jsonPath, ...extraArgs],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
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

  console.log('bench-language rollout gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

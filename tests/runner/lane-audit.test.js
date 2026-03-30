#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildLaneAuditReport, formatLaneAuditReport } from './lane-audit.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pairofcleats-lane-audit-'));
const testsDir = path.join(tempRoot, 'tests');
const runnerDir = path.join(testsDir, 'runner');
const ciLiteDir = path.join(testsDir, 'ci-lite');
const ciDir = path.join(testsDir, 'ci');
const logDir = path.join(tempRoot, '.testLogs');
fs.mkdirSync(runnerDir, { recursive: true });
fs.mkdirSync(ciLiteDir, { recursive: true });
fs.mkdirSync(ciDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

fs.writeFileSync(
  path.join(runnerDir, 'lane-manifests.jsonc'),
  `${JSON.stringify({
    orderedLanes: {
      'ci-lite': {
        targetMaxDurationSeconds: 15,
        orderFile: 'tests/ci-lite/ci-lite.order.txt',
        manifestFile: 'tests/ci-lite/ci-lite.manifest.json',
        timingArtifactPaths: ['.testLogs/ci-lite-testRunTimes.txt']
      },
      ci: {
        targetMaxDurationSeconds: 60,
        orderFile: 'tests/ci/ci.order.txt',
        manifestFile: 'tests/ci/ci.manifest.json',
        timingArtifactPaths: ['.testLogs/ci-testRunTimes.txt']
      }
    }
  }, null, 2)}\n`,
  'utf8'
);

fs.writeFileSync(path.join(ciLiteDir, 'ci-lite.order.txt'), 'alpha\nmissing/test\n', 'utf8');
fs.writeFileSync(path.join(ciDir, 'ci.order.txt'), 'alpha\nbeta\n', 'utf8');

fs.writeFileSync(
  path.join(ciLiteDir, 'ci-lite.manifest.json'),
  `${JSON.stringify({
    lane: 'ci-lite',
    tests: [{ id: 'alpha', durationMs: 20000 }]
  }, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(ciDir, 'ci.manifest.json'),
  `${JSON.stringify({
    lane: 'ci',
    tests: [{ id: 'alpha', durationMs: 500 }]
  }, null, 2)}\n`,
  'utf8'
);

fs.writeFileSync(path.join(logDir, 'ci-lite-testRunTimes.txt'), '20000ms\talpha\n', 'utf8');
fs.writeFileSync(path.join(logDir, 'ci-testRunTimes.txt'), '500ms\talpha\n', 'utf8');

fs.writeFileSync(path.join(testsDir, 'alpha.test.js'), 'console.log("alpha");\n', 'utf8');
fs.writeFileSync(path.join(testsDir, 'beta.test.js'), 'console.log("beta");\n', 'utf8');

const report = await buildLaneAuditReport({ root: tempRoot });

assert.equal(report.summary.missingIds, 1);
assert.equal(report.summary.duplicateIds, 1);
assert.equal(report.summary.manifestMismatches, 2);
assert.equal(report.summary.timingOverruns, 1);
assert.match(formatLaneAuditReport(report), /missing ids/i);
assert.match(formatLaneAuditReport(report), /timing overruns/i);

console.log('lane audit test passed');

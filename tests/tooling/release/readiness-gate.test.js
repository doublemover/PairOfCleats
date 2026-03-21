#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'release', 'readiness-gate.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-readiness-gate');

const writeJson = (targetPath, payload) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
};

const prepareReportPath = path.join(fixtureDir, 'prepare', 'release_check_report.json');
const runtimeReportPath = path.join(fixtureDir, 'runtime', 'release_check_report.json');
const nodeVerifyReportPath = path.join(fixtureDir, 'node-verify', 'release_check_report.json');
const tuiVerifyRoot = path.join(fixtureDir, 'tui');
const trustRoot = path.join(fixtureDir, 'trust');
const ciStatusesPath = path.join(fixtureDir, 'ci-statuses.json');
const ciSummaryPath = path.join(fixtureDir, 'ci-quality', '.diagnostics', 'test-summary.json');
const coverageDir = path.join(fixtureDir, 'ci-quality', '.diagnostics', 'coverage');
const outJsonPath = path.join(fixtureDir, 'readiness', 'summary.json');
const outMdPath = path.join(fixtureDir, 'readiness', 'summary.md');

for (const filePath of [prepareReportPath, runtimeReportPath, nodeVerifyReportPath]) {
  writeJson(filePath, { ok: true, summary: { total: 1, passed: 1, failed: 0 } });
}
writeJson(path.join(tuiVerifyRoot, 'ubuntu', 'release_check_report.json'), { ok: true });
writeJson(path.join(tuiVerifyRoot, 'windows', 'release_check_report.json'), { ok: true });
writeJson(path.join(tuiVerifyRoot, 'macos', 'release_check_report.json'), { ok: true });
writeJson(path.join(trustRoot, 'trust-manifest.json'), { schemaVersion: 1 });
writeJson(path.join(trustRoot, 'provenance-summary.json'), { schemaVersion: 1 });
writeJson(path.join(trustRoot, 'release-checksum-bundle.json'), { schemaVersion: 1 });
writeJson(ciStatusesPath, {
  workflows: [
    { workflow: 'CI', conclusion: 'success', runId: 101 },
    { workflow: 'CI Long', conclusion: 'success', runId: 102 }
  ]
});
writeJson(ciSummaryPath, { totals: { passed: 10, failed: 0 } });
fs.mkdirSync(coverageDir, { recursive: true });
fs.writeFileSync(path.join(coverageDir, 'summary.json'), '{"coverage":true}\n');

const run = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--tui-verify-root',
    tuiVerifyRoot,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--out-json',
    outJsonPath,
    '--out-md',
    outMdPath
  ],
  'release readiness gate',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(run.status, 0, run.stderr || run.stdout || 'expected readiness gate to pass');
const payload = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));
assert.equal(payload.ok, true, 'expected readiness gate to report ok=true');
assert.deepEqual(payload.blockers, [], 'expected no blockers');
assert.equal(fs.existsSync(outMdPath), true, 'expected markdown readiness report');

console.log('release readiness gate test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { setupReadinessGateFixture } from './readiness-gate-fixture.js';

const {
  root,
  scriptPath,
  fixtureDir,
  releaseGitSha,
  baseArgs,
  prepareReportPath,
  malformedPrepareReportPath,
  minimalPrepareReportPath,
  invalidTimestampPrepareReportPath,
  invalidAllTimestampsPrepareReportPath,
  invalidMissingByPhasePrepareReportPath,
  runtimeReportPath,
  nodeVerifyReportPath,
  tuiVerifyRoot,
  invalidTimestampTuiVerifyRoot,
  mismatchedTuiVerifyRoot,
  minimalTuiVerifyRoot,
  malformedTuiVerifyRoot,
  trustRoot,
  missingSbomTrustRoot,
  malformedTrustRoot,
  malformedShapeTrustRoot,
  ciStatusesPath,
  malformedCiStatusesPath,
  invalidShapeCiStatusesPath,
  ciSummaryPath,
  malformedCiSummaryPath,
  invalidShapeCiSummaryPath,
  coverageDir
} = await setupReadinessGateFixture(
  'release-readiness-gate-report-shape',
  { scenarios: ['reportShape'] }
);

const malformedTuiJsonRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    malformedTuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'malformed-tui-json-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-tui-json-summary.md')
  ],
  'release readiness gate malformed tui json',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedTuiJsonRun.status, 0, 'expected malformed TUI JSON to fail readiness');
const malformedTuiJsonPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-tui-json-summary.json'), 'utf8')
);
assert.ok(
  malformedTuiJsonPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.invalid-json'),
  'expected readiness blockers to report malformed TUI JSON'
);
assert.equal(
  malformedTuiJsonPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.failed'),
  false,
  'malformed TUI JSON must not be duplicated as a generic TUI failure when all targets are present'
);
assert.deepEqual(
  malformedTuiJsonPayload.releaseChecks.tuiVerify.invalidReports,
  [
    path.relative(root, path.join(malformedTuiVerifyRoot, 'macos', 'release_check_report.json')).replace(/\\/g, '/')
  ],
  'expected readiness summary to expose malformed TUI report paths'
);

const malformedJsonRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    malformedPrepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'malformed-json-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-json-summary.md')
  ],
  'release readiness gate malformed input json',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedJsonRun.status, 0, 'expected malformed JSON input to fail readiness');
const malformedJsonPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-json-summary.json'), 'utf8')
);
assert.ok(
  malformedJsonPayload.blockers.some((blocker) => blocker.id === 'prepare.invalid-json'),
  'expected readiness blockers to report malformed prepare JSON'
);
assert.equal(
  malformedJsonPayload.blockers.some((blocker) => blocker.id === 'prepare.missing'),
  false,
  'malformed prepare JSON must not be misclassified as missing'
);

const minimalShapeRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    minimalPrepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'minimal-release-report-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'minimal-release-report-summary.md')
  ],
  'release readiness gate minimal spoofed release report',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(minimalShapeRun.status, 0, 'expected minimal ok=true release report to fail readiness');
const minimalShapePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'minimal-release-report-summary.json'), 'utf8')
);
assert.ok(
  minimalShapePayload.blockers.some((blocker) => blocker.id === 'prepare.invalid-shape'),
  'expected readiness blockers to reject spoofed ok=true release reports without release-check shape'
);
assert.equal(
  minimalShapePayload.blockers.some((blocker) => blocker.id === 'prepare.failed'),
  false,
  'invalid release report shape must not be misclassified as a failed release check'
);

const missingByPhaseRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    invalidMissingByPhasePrepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'missing-by-phase-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'missing-by-phase-summary.md')
  ],
  'release readiness gate missing byPhase release report',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(missingByPhaseRun.status, 0, 'expected release reports missing byPhase counts to fail readiness');
const missingByPhasePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'missing-by-phase-summary.json'), 'utf8')
);
assert.ok(
  missingByPhasePayload.blockers.some((blocker) => blocker.id === 'prepare.invalid-shape'
    && /summary\.byPhase\.changelog must be present and equal 1/.test(blocker.detail)),
  'expected readiness blockers to require byPhase coverage for every checked phase'
);
assert.equal(
  missingByPhasePayload.blockers.some((blocker) => blocker.id === 'prepare.failed'),
  false,
  'missing byPhase counts must not be misclassified as a failed release check'
);

const invalidTimestampRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    invalidTimestampPrepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-release-report-timestamp-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-release-report-timestamp-summary.md')
  ],
  'release readiness gate invalid release report timestamp',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidTimestampRun.status, 0, 'expected invalid release report timestamp to fail readiness');
const invalidTimestampPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-release-report-timestamp-summary.json'), 'utf8')
);
assert.ok(
  invalidTimestampPayload.blockers.some((blocker) => blocker.id === 'prepare.invalid-shape'
    && /generatedAt must be an ISO-8601 UTC timestamp/.test(blocker.detail)),
  'expected readiness blockers to reject non-ISO release report timestamps'
);

const invalidAllTimestampsRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    invalidAllTimestampsPrepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-release-report-all-timestamps-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-release-report-all-timestamps-summary.md')
  ],
  'release readiness gate invalid release report all timestamp fields',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidAllTimestampsRun.status, 0, 'expected invalid release report timestamps to fail readiness');
const invalidAllTimestampsPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-release-report-all-timestamps-summary.json'), 'utf8')
);
const invalidAllTimestampsDetail = invalidAllTimestampsPayload.blockers
  .find((blocker) => blocker.id === 'prepare.invalid-shape')
  ?.detail || '';
for (const expected of [
  'startedAt must be an ISO-8601 UTC timestamp',
  'finishedAt must be an ISO-8601 UTC timestamp',
  'checks[0].startedAt must be an ISO-8601 UTC timestamp',
  'checks[0].finishedAt must be an ISO-8601 UTC timestamp'
]) {
  assert.match(
    invalidAllTimestampsDetail,
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `expected readiness blocker detail to include ${expected}`
  );
}

const minimalTuiShapeRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    minimalTuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'minimal-tui-release-report-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'minimal-tui-release-report-summary.md')
  ],
  'release readiness gate minimal spoofed TUI release reports',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(minimalTuiShapeRun.status, 0, 'expected minimal ok=true TUI release reports to fail readiness');
const minimalTuiShapePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'minimal-tui-release-report-summary.json'), 'utf8')
);
assert.ok(
  minimalTuiShapePayload.blockers.some((blocker) => blocker.id === 'tuiVerify.invalid-shape'),
  'expected readiness blockers to reject spoofed TUI ok=true reports without release-check shape'
);
assert.equal(
  minimalTuiShapePayload.blockers.some((blocker) => (
    blocker.id === 'tuiVerify.failed'
      && /one or more required TUI verification reports/.test(blocker.detail)
  )),
  false,
  'invalid TUI release report shape must not be misclassified with the generic failed TUI blocker'
);
assert.deepEqual(
  minimalTuiShapePayload.releaseChecks.tuiVerify.invalidShapeReports.sort(),
  minimalTuiShapePayload.releaseChecks.tuiVerify.reports.map((entry) => entry.path).sort(),
  'expected every minimal TUI report to be recorded as invalid-shape'
);

const invalidTuiTimestampRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    invalidTimestampTuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-tui-timestamp-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-tui-timestamp-summary.md')
  ],
  'release readiness gate invalid TUI report timestamp',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidTuiTimestampRun.status, 0, 'expected invalid TUI timestamp to fail readiness');
const invalidTuiTimestampPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-tui-timestamp-summary.json'), 'utf8')
);
assert.ok(
  invalidTuiTimestampPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.invalid-shape'),
  'expected readiness blockers to reject TUI reports with invalid timestamp fields'
);
assert.deepEqual(
  invalidTuiTimestampPayload.releaseChecks.tuiVerify.invalidShapeReports,
  [
    path.relative(
      root,
      path.join(invalidTimestampTuiVerifyRoot, 'macos', 'release_check_report.json')
    ).replace(/\\/g, '/')
  ],
  'expected readiness summary to expose the TUI report with invalid timestamp fields'
);

const mismatchedTuiTargetRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    mismatchedTuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'mismatched-tui-target-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'mismatched-tui-target-summary.md')
  ],
  'release readiness gate mismatched TUI runtime target',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(mismatchedTuiTargetRun.status, 0, 'expected mismatched TUI runtime target to fail readiness');
const mismatchedTuiTargetPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'mismatched-tui-target-summary.json'), 'utf8')
);
assert.ok(
  mismatchedTuiTargetPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.target-mismatch'
    && /expected macos declared ubuntu/.test(blocker.detail)),
  'expected readiness blockers to reject copied or renamed TUI reports for a different runtime target'
);
assert.equal(
  mismatchedTuiTargetPayload.blockers.some((blocker) => (
    blocker.id === 'tuiVerify.failed'
      && /one or more required TUI verification reports/.test(blocker.detail)
  )),
  false,
  'mismatched TUI runtime target must not be misclassified with the generic failed TUI blocker'
);
assert.deepEqual(
  mismatchedTuiTargetPayload.releaseChecks.tuiVerify.targetMismatchReports,
  [{
    path: path.relative(
      root,
      path.join(mismatchedTuiVerifyRoot, 'macos', 'release_check_report.json')
    ).replace(/\\/g, '/'),
    expectedTarget: 'macos',
    declaredTarget: 'ubuntu'
  }],
  'expected readiness summary to expose TUI reports whose declared runtime target does not match their artifact path'
);

const malformedExpectedTuiTargetsRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    tuiVerifyRoot,
    '--tui-verify-targets',
    'ubuntu,,../macos,windows,ubuntu',
    '--out-json',
    path.join(fixtureDir, 'readiness', 'malformed-expected-tui-targets-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-expected-tui-targets-summary.md')
  ],
  'release readiness gate malformed expected TUI targets',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(
  malformedExpectedTuiTargetsRun.status,
  0,
  'expected malformed or duplicated expected TUI targets to fail readiness'
);
const malformedExpectedTuiTargetsPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-expected-tui-targets-summary.json'), 'utf8')
);
assert.ok(
  malformedExpectedTuiTargetsPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.targets'
    && /target entry 2 is empty/.test(blocker.detail)
    && /target \.\.\/macos is malformed/.test(blocker.detail)
    && /target ubuntu is duplicated/.test(blocker.detail)),
  'expected readiness blockers to reject blank, malformed, and duplicated expected TUI targets'
);
assert.deepEqual(
  malformedExpectedTuiTargetsPayload.releaseChecks.tuiVerify.targetErrors,
  ['target entry 2 is empty', 'target ../macos is malformed', 'target ubuntu is duplicated'],
  'expected readiness summary to expose blank, malformed, and duplicated expected TUI target inputs'
);
assert.equal(
  malformedExpectedTuiTargetsPayload.blockers.some((blocker) => (
    blocker.id === 'tuiVerify.failed'
      && /one or more required TUI verification reports/.test(blocker.detail)
  )),
  false,
  'malformed expected TUI target configuration must not be duplicated as the generic failed TUI blocker'
);

const duplicateTuiVerifyRoot = path.join(fixtureDir, 'tui-duplicate-artifacts');
for (const target of ['ubuntu', 'windows', 'macos']) {
  fs.mkdirSync(path.join(duplicateTuiVerifyRoot, target), { recursive: true });
  fs.copyFileSync(
    path.join(tuiVerifyRoot, target, 'release_check_report.json'),
    path.join(duplicateTuiVerifyRoot, target, 'release_check_report.json')
  );
}
fs.mkdirSync(path.join(duplicateTuiVerifyRoot, 'copy', 'verify-tui-ubuntu'), { recursive: true });
fs.copyFileSync(
  path.join(tuiVerifyRoot, 'ubuntu', 'release_check_report.json'),
  path.join(duplicateTuiVerifyRoot, 'copy', 'verify-tui-ubuntu', 'release_check_report.json')
);
const duplicateTuiReportsRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    duplicateTuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'duplicate-tui-reports-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'duplicate-tui-reports-summary.md')
  ],
  'release readiness gate duplicate TUI verification reports',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(duplicateTuiReportsRun.status, 0, 'expected duplicate TUI verification reports to fail readiness');
const duplicateTuiReportsPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'duplicate-tui-reports-summary.json'), 'utf8')
);
assert.ok(
  duplicateTuiReportsPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.duplicates'
    && /ubuntu/.test(blocker.detail)),
  'expected readiness blockers to reject duplicate TUI verification artifacts for a target'
);
assert.deepEqual(
  duplicateTuiReportsPayload.releaseChecks.tuiVerify.duplicateTargets.map((entry) => entry.target),
  ['ubuntu'],
  'expected readiness summary to identify the duplicated TUI target'
);
assert.deepEqual(
  [...duplicateTuiReportsPayload.releaseChecks.tuiVerify.duplicateTargets[0].paths].sort(),
  [
    path.relative(
      root,
      path.join(duplicateTuiVerifyRoot, 'copy', 'verify-tui-ubuntu', 'release_check_report.json')
    ).replace(/\\/g, '/'),
    path.relative(root, path.join(duplicateTuiVerifyRoot, 'ubuntu', 'release_check_report.json')).replace(/\\/g, '/')
  ].sort(),
  'expected readiness summary to expose both duplicate TUI verification artifact paths'
);
assert.equal(
  duplicateTuiReportsPayload.blockers.some((blocker) => (
    blocker.id === 'tuiVerify.failed'
      && /one or more required TUI verification reports/.test(blocker.detail)
  )),
  false,
  'duplicate TUI verification reports must not be duplicated as the generic failed TUI blocker'
);

const malformedSupplementalJsonRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    malformedTrustRoot,
    '--ci-statuses',
    malformedCiStatusesPath,
    '--ci-test-summary',
    malformedCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'malformed-supplemental-json-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-supplemental-json-summary.md')
  ],
  'release readiness gate malformed supplemental json',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedSupplementalJsonRun.status, 0, 'expected malformed supplemental JSON to fail readiness');
const malformedSupplementalJsonPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-supplemental-json-summary.json'), 'utf8')
);
const malformedSupplementalBlockerIds = new Set(
  malformedSupplementalJsonPayload.blockers.map((blocker) => blocker.id)
);
for (const id of ['trust.trustManifest.invalid-json', 'ci.statuses.invalid-json', 'ci.test-summary.invalid-json']) {
  assert.ok(malformedSupplementalBlockerIds.has(id), `expected readiness blockers to include ${id}`);
}
for (const id of ['trust.trustManifest', 'ci.ci', 'ci.ci-long', 'ci.test-summary']) {
  assert.equal(
    malformedSupplementalBlockerIds.has(id),
    false,
    `malformed JSON must not be misclassified with generic blocker ${id}`
  );
}
assert.equal(
  malformedSupplementalJsonPayload.trustChecks.trustManifest,
  'invalid-json',
  'expected JSON summary to classify malformed trust manifest as invalid-json'
);
assert.equal(
  malformedSupplementalJsonPayload.ci.testSummaryStatus,
  'invalid-json',
  'expected JSON summary to classify malformed CI test summary as invalid-json'
);
const malformedSupplementalMarkdown = fs.readFileSync(
  path.join(fixtureDir, 'readiness', 'malformed-supplemental-json-summary.md'),
  'utf8'
);
assert.match(
  malformedSupplementalMarkdown,
  /- trust manifest: invalid-json/,
  'expected markdown summary to classify malformed trust manifest as invalid-json'
);
assert.match(
  malformedSupplementalMarkdown,
  /- test summary: invalid-json/,
  'expected markdown summary to classify malformed CI test summary as invalid-json'
);

const invalidShapeSupplementalRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    malformedShapeTrustRoot,
    '--ci-statuses',
    invalidShapeCiStatusesPath,
    '--ci-test-summary',
    invalidShapeCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-shape-supplemental-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-shape-supplemental-summary.md')
  ],
  'release readiness gate invalid supplemental shapes',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidShapeSupplementalRun.status, 0, 'expected invalid supplemental shapes to fail readiness');
const invalidShapeSupplementalPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-shape-supplemental-summary.json'), 'utf8')
);
const invalidShapeSupplementalBlockerIds = new Set(
  invalidShapeSupplementalPayload.blockers.map((blocker) => blocker.id)
);
for (const id of [
  'trust.trustManifest.invalid-shape',
  'ci.statuses.invalid-shape',
  'ci.test-summary.invalid-shape'
]) {
  assert.ok(invalidShapeSupplementalBlockerIds.has(id), `expected readiness blockers to include ${id}`);
}
for (const id of ['trust.trustManifest', 'ci.ci', 'ci.ci-long', 'ci.test-summary']) {
  assert.equal(
    invalidShapeSupplementalBlockerIds.has(id),
    false,
    `invalid shape must not be misclassified with generic blocker ${id}`
  );
}
assert.equal(
  invalidShapeSupplementalPayload.trustChecks.trustManifest,
  'invalid-shape',
  'expected JSON summary to classify malformed trust shape as invalid-shape'
);
assert.equal(
  invalidShapeSupplementalPayload.ci.testSummaryStatus,
  'invalid-shape',
  'expected JSON summary to classify malformed CI test summary shape as invalid-shape'
);

const missingSbomRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    missingSbomTrustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'missing-trust-sboms-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'missing-trust-sboms-summary.md')
  ],
  'release readiness gate missing trust SBOM files',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(missingSbomRun.status, 0, 'expected missing trust SBOM files to fail readiness');
const missingSbomPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'missing-trust-sboms-summary.json'), 'utf8')
);
assert.ok(
  missingSbomPayload.blockers.some((blocker) => blocker.id === 'trust.sboms'
    && /node-root/.test(blocker.detail)
    && /tui/.test(blocker.detail)),
  'expected readiness blockers to require every SBOM listed by the trust manifest'
);
assert.equal(
  missingSbomPayload.trustChecks.sboms,
  'missing',
  'expected JSON summary to classify missing trust SBOM files'
);

console.log('release readiness gate report shape test passed');

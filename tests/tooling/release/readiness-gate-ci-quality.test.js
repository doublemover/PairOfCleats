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
  prepareReportPath,
  runtimeReportPath,
  nodeVerifyReportPath,
  tuiVerifyRoot,
  trustRoot,
  staleTrustRoot,
  ciStatusesPath,
  staleCiStatusesPath,
  malformedShapeCiStatusesPath,
  upperCaseCiStatusesPath,
  ciSummaryPath,
  failedCiSummaryPath,
  redoCiSummaryPath,
  fractionalCountCiSummaryPath,
  invalidRowCiSummaryPath,
  coverageDir,
  invalidShapeCoverageDir,
  semanticInvalidCoverageDir
} = await setupReadinessGateFixture(
  'release-readiness-gate-ci-quality',
  { scenarios: ['ciQuality'] }
);

const invalidCoverageRun = runNode(
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
    path.resolve(root, '..', 'outside-release-coverage'),
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-coverage-root-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-coverage-root-summary.md')
  ],
  'release readiness gate invalid coverage root',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidCoverageRun.status, 0, 'expected outside coverage root to fail readiness');
const invalidCoveragePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-coverage-root-summary.json'), 'utf8')
);
assert.ok(
  invalidCoveragePayload.blockers.some((blocker) => blocker.id === 'path.coverage-dir'),
  'expected readiness blockers to reject coverage roots outside the repo'
);

const invalidShapeCoverageRun = runNode(
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
    invalidShapeCoverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-shape-coverage-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-shape-coverage-summary.md')
  ],
  'release readiness gate invalid shape coverage artifacts',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidShapeCoverageRun.status, 0, 'expected non-coverage JSON file to fail coverage readiness');
const invalidShapeCoveragePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-shape-coverage-summary.json'), 'utf8')
);
assert.ok(
  invalidShapeCoveragePayload.blockers.some((blocker) => blocker.id === 'coverage.invalid-shape'),
  'expected readiness blockers to reject coverage directories without schema-shaped coverage artifacts'
);
assert.equal(
  invalidShapeCoveragePayload.blockers.some((blocker) => blocker.id === 'coverage.missing'),
  false,
  'invalid coverage shape must not be misclassified with the generic coverage-missing blocker'
);
assert.equal(
  invalidShapeCoveragePayload.ci.coverageStatus,
  'invalid-shape',
  'expected JSON summary to classify invalid coverage artifacts as invalid-shape'
);

const semanticInvalidCoverageRun = runNode(
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
    semanticInvalidCoverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'semantic-invalid-coverage-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'semantic-invalid-coverage-summary.md')
  ],
  'release readiness gate semantic invalid coverage artifacts',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(
  semanticInvalidCoverageRun.status,
  0,
  'expected schema-valid but semantically invalid coverage to fail readiness'
);
const semanticInvalidCoveragePayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'semantic-invalid-coverage-summary.json'), 'utf8')
);
assert.ok(
  semanticInvalidCoveragePayload.blockers.some((blocker) => blocker.id === 'coverage.invalid-shape'
    && /safe repo-relative POSIX path/.test(blocker.detail)),
  'expected readiness blockers to reject unsafe semantic coverage paths'
);
assert.equal(
  semanticInvalidCoveragePayload.ci.coverageStatus,
  'invalid-shape',
  'expected JSON summary to classify semantic coverage errors as invalid-shape'
);


const failedCiSummaryRun = runNode(
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
    failedCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'failed-ci-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'failed-ci-summary.md')
  ],
  'release readiness gate failed CI summary rows',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(failedCiSummaryRun.status, 0, 'expected valid CI summary with failed rows to block readiness');
const failedCiSummaryPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'failed-ci-summary.json'), 'utf8')
);
assert.ok(
  failedCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary.failed'),
  'expected readiness blockers to reject failed or redo rows in the CI test summary'
);
assert.equal(
  failedCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary.invalid-shape'),
  false,
  'valid but failing CI summary must not be misclassified as invalid shape'
);
assert.equal(
  failedCiSummaryPayload.ci.testSummaryStatus,
  'failed',
  'expected JSON summary to classify valid failing CI test summary rows'
);

const redoCiSummaryRun = runNode(
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
    redoCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'redo-ci-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'redo-ci-summary.md')
  ],
  'release readiness gate redo CI summary rows',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(redoCiSummaryRun.status, 0, 'expected valid CI summary with redo rows to block readiness');
const redoCiSummaryPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'redo-ci-summary.json'), 'utf8')
);
assert.ok(
  redoCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary.failed'
    && /failed or redo/.test(blocker.detail)),
  'expected readiness blockers to reject redo rows in the CI test summary'
);
assert.equal(
  redoCiSummaryPayload.ci.testSummaryStatus,
  'failed',
  'expected JSON summary to classify redo CI test summary rows as failed'
);

const fractionalCountCiSummaryRun = runNode(
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
    fractionalCountCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'fractional-ci-summary-counts.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'fractional-ci-summary-counts.md')
  ],
  'release readiness gate fractional CI summary counts',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(fractionalCountCiSummaryRun.status, 0, 'expected fractional CI summary counts to fail readiness');
const fractionalCountCiSummaryPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'fractional-ci-summary-counts.json'), 'utf8')
);
assert.ok(
  fractionalCountCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary.invalid-shape'),
  'expected readiness blockers to reject fractional CI summary counts'
);
assert.equal(
  fractionalCountCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary'),
  false,
  'fractional CI summary counts must not be misclassified with the generic CI test-summary blocker'
);
assert.equal(
  fractionalCountCiSummaryPayload.ci.testSummaryStatus,
  'invalid-shape',
  'expected JSON summary to classify fractional CI summary counts as invalid-shape'
);

const invalidRowCiSummaryRun = runNode(
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
    invalidRowCiSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-row-ci-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-row-ci-summary.md')
  ],
  'release readiness gate invalid CI summary test row',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidRowCiSummaryRun.status, 0, 'expected invalid CI summary test row to fail readiness');
const invalidRowCiSummaryPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-row-ci-summary.json'), 'utf8')
);
assert.ok(
  invalidRowCiSummaryPayload.blockers.some((blocker) => blocker.id === 'ci.test-summary.invalid-shape'),
  'expected readiness blockers to reject invalid CI summary test rows'
);
assert.equal(
  invalidRowCiSummaryPayload.ci.testSummaryStatus,
  'invalid-shape',
  'expected JSON summary to classify invalid CI summary rows as invalid-shape'
);

const staleTrustRun = runNode(
  [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    staleTrustRoot,
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
    path.join(fixtureDir, 'readiness', 'stale-trust-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'stale-trust-summary.md')
  ],
  'release readiness gate stale trust source commit',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(staleTrustRun.status, 0, 'expected stale trust source commit to fail readiness');
const staleTrustPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'stale-trust-summary.json'), 'utf8')
);
assert.ok(
  staleTrustPayload.blockers.some((blocker) => blocker.id === 'trust.source-commit'),
  'expected readiness blockers to reject trust source commits that do not match release SHA'
);

const staleCiStatusRun = runNode(
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
    staleCiStatusesPath,
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
    path.join(fixtureDir, 'readiness', 'stale-ci-status-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'stale-ci-status-summary.md')
  ],
  'release readiness gate stale ci status target sha',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(staleCiStatusRun.status, 0, 'expected stale CI status target SHA to fail readiness');
const staleCiStatusPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'stale-ci-status-summary.json'), 'utf8')
);
assert.ok(
  staleCiStatusPayload.blockers.some((blocker) => blocker.id === 'ci.target-sha'),
  'expected readiness blockers to reject CI statuses for a different target SHA'
);
assert.equal(
  staleCiStatusPayload.blockers.some((blocker) => blocker.id === 'ci.ci' || blocker.id === 'ci.ci-long'),
  false,
  'stale CI provenance must not be misclassified as a workflow conclusion failure'
);
assert.equal(staleCiStatusPayload.ci.releaseGitSha, releaseGitSha);
assert.equal(staleCiStatusPayload.ci.targetSha, 'fedcba9876543210fedcba9876543210fedcba98');

const upperCaseCiStatusRun = runNode(
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
    upperCaseCiStatusesPath,
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
    path.join(fixtureDir, 'readiness', 'uppercase-ci-status-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'uppercase-ci-status-summary.md')
  ],
  'release readiness gate uppercase ci status target sha',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(upperCaseCiStatusRun.status, 0, upperCaseCiStatusRun.stderr || upperCaseCiStatusRun.stdout);
const upperCaseCiStatusPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'uppercase-ci-status-summary.json'), 'utf8')
);
assert.equal(
  upperCaseCiStatusPayload.ci.targetSha,
  releaseGitSha,
  'expected readiness summary to normalize equivalent uppercase CI target SHA'
);

const malformedCiTargetShaRun = runNode(
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
    malformedShapeCiStatusesPath,
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
    path.join(fixtureDir, 'readiness', 'malformed-ci-target-sha-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-ci-target-sha-summary.md')
  ],
  'release readiness gate malformed ci target sha',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedCiTargetShaRun.status, 0, 'expected malformed CI target SHA to fail readiness');
const malformedCiTargetShaPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-ci-target-sha-summary.json'), 'utf8')
);
assert.ok(
  malformedCiTargetShaPayload.blockers.some((blocker) => blocker.id === 'ci.target-sha'),
  'expected readiness blockers to reject malformed CI target SHA values'
);
assert.match(
  malformedCiTargetShaPayload.blockers.find((blocker) => blocker.id === 'ci.target-sha')?.detail || '',
  /malformed/,
  'expected malformed CI target SHA blocker detail to explain the shape failure'
);

const malformedReleaseShaRun = runNode(
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
    'not-a-git-sha',
    '--coverage-dir',
    coverageDir,
    '--attested',
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'malformed-release-sha-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'malformed-release-sha-summary.md')
  ],
  'release readiness gate malformed release sha',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedReleaseShaRun.status, 0, 'expected malformed release SHA to fail readiness');
const malformedReleaseShaPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'malformed-release-sha-summary.json'), 'utf8')
);
assert.ok(
  malformedReleaseShaPayload.blockers.some((blocker) => blocker.id === 'ci.target-sha'),
  'expected readiness blockers to reject malformed release SHA values'
);
assert.match(
  malformedReleaseShaPayload.blockers.find((blocker) => blocker.id === 'ci.target-sha')?.detail || '',
  /malformed/,
  'expected malformed release SHA blocker detail to explain the shape failure'
);


console.log('release readiness gate CI quality test passed');

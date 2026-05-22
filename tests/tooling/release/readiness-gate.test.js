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
  ciStatusesPath,
  ciSummaryPath,
  coverageDir,
  outJsonPath,
  outMdPath,
  outsideOutJsonPath,
  outsideOutMdPath,
  baseArgs,
  writeJson,
  writeTuiReleaseReport,
  createTuiReleaseReport
} = await setupReadinessGateFixture('release-readiness-gate', { scenarios: [] });

const run = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    tuiVerifyRoot,
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
assert.equal(
  Object.hasOwn(payload, 'usrApproval'),
  false,
  'readiness payload must not expose non-technical USR approval state'
);
assert.equal(fs.existsSync(outMdPath), true, 'expected markdown readiness report');
assert.doesNotMatch(
  fs.readFileSync(outMdPath, 'utf8'),
  /USR approval|usrApproval|approval lock/i,
  'readiness markdown must not expose non-technical USR approval state'
);

const outsideOutJsonRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    outsideOutJsonPath,
    '--out-md',
    path.join(fixtureDir, 'readiness', 'outside-json-summary.md')
  ],
  'release readiness gate outside json output',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.notEqual(outsideOutJsonRun.status, 0, 'expected outside readiness JSON output to fail');
assert.match(
  outsideOutJsonRun.stderr,
  /out-json must stay within repo root/,
  'expected outside readiness JSON output failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideOutJsonPath), false, 'expected readiness gate not to create outside JSON output');

const outsideOutMdRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    tuiVerifyRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'outside-md-summary.json'),
    '--out-md',
    outsideOutMdPath
  ],
  'release readiness gate outside markdown output',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.notEqual(outsideOutMdRun.status, 0, 'expected outside readiness markdown output to fail');
assert.match(
  outsideOutMdRun.stderr,
  /out-md must stay within repo root/,
  'expected outside readiness markdown output failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideOutMdPath), false, 'expected readiness gate not to create outside markdown output');

const symlinkReadinessTarget = path.resolve(root, '..', `outside-release-readiness-symlink-${process.pid}`);
const symlinkReadinessDir = path.join(fixtureDir, 'readiness-symlink');
try {
  fs.mkdirSync(symlinkReadinessTarget, { recursive: true });
  fs.rmSync(symlinkReadinessDir, { recursive: true, force: true });
  fs.symlinkSync(symlinkReadinessTarget, symlinkReadinessDir, 'junction');
  const symlinkOutJsonRun = runNode(
    [
      ...baseArgs,
      '--tui-verify-root',
      tuiVerifyRoot,
      '--out-json',
      path.join(symlinkReadinessDir, 'readiness-summary.json'),
      '--out-md',
      path.join(fixtureDir, 'readiness', 'symlink-json-summary.md')
    ],
    'release readiness gate symlink json output',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(symlinkOutJsonRun.status, 0, 'expected symlinked readiness JSON output to fail');
  assert.match(
    symlinkOutJsonRun.stderr,
    /out-json must not use symlink path segment/,
    'expected readiness gate to reject symlink path segments before writing JSON output'
  );
  assert.equal(
    fs.existsSync(path.join(symlinkReadinessTarget, 'readiness-summary.json')),
    false,
    'expected readiness gate not to write through a symlinked output directory'
  );
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
    throw error;
  }
  console.warn(`readiness-gate symlink output assertion skipped: ${error.code}`);
} finally {
  fs.rmSync(symlinkReadinessDir, { recursive: true, force: true });
  fs.rmSync(symlinkReadinessTarget, { recursive: true, force: true });
}

const invalidTuiRootRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    path.resolve(root, '..', 'outside-release-tui'),
    '--out-json',
    path.join(fixtureDir, 'readiness', 'invalid-tui-root-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'invalid-tui-root-summary.md')
  ],
  'release readiness gate invalid tui root',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(invalidTuiRootRun.status, 0, 'expected outside TUI root to fail readiness');
const invalidTuiRootPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'invalid-tui-root-summary.json'), 'utf8')
);
assert.ok(
  invalidTuiRootPayload.blockers.some((blocker) => blocker.id === 'path.tui-verify-root'),
  'expected readiness blockers to reject TUI roots outside the repo'
);

const symlinkInputTarget = path.resolve(root, '..', `outside-release-readiness-input-${process.pid}`);
const symlinkTuiRoot = path.join(fixtureDir, 'tui-symlink-root');
const symlinkTrustRoot = path.join(fixtureDir, 'trust-symlink-root');
const symlinkCoverageRoot = path.join(fixtureDir, 'coverage-symlink-root');
try {
  fs.mkdirSync(symlinkInputTarget, { recursive: true });
  for (const symlinkRoot of [symlinkTuiRoot, symlinkTrustRoot, symlinkCoverageRoot]) {
    fs.rmSync(symlinkRoot, { recursive: true, force: true });
    fs.symlinkSync(symlinkInputTarget, symlinkRoot, 'junction');
  }

  const symlinkTuiRun = runNode(
    [
      ...baseArgs,
      '--tui-verify-root',
      symlinkTuiRoot,
      '--out-json',
      path.join(fixtureDir, 'readiness', 'symlink-tui-root-summary.json'),
      '--out-md',
      path.join(fixtureDir, 'readiness', 'symlink-tui-root-summary.md')
    ],
    'release readiness gate symlink TUI root',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );
  assert.notEqual(symlinkTuiRun.status, 0, 'expected symlinked TUI root to fail readiness');
  const symlinkTuiPayload = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'readiness', 'symlink-tui-root-summary.json'), 'utf8')
  );
  assert.ok(
    symlinkTuiPayload.blockers.some((blocker) => blocker.id === 'path.tui-verify-root'
      && /must not use symlink path segment/.test(blocker.detail)),
    'expected readiness blockers to reject symlinked TUI roots'
  );

  const symlinkTrustRun = runNode(
    [
      scriptPath,
      '--prepare-report',
      prepareReportPath,
      '--runtime-report',
      runtimeReportPath,
      '--node-verify-report',
      nodeVerifyReportPath,
      '--trust-root',
      symlinkTrustRoot,
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
      path.join(fixtureDir, 'readiness', 'symlink-trust-root-summary.json'),
      '--out-md',
      path.join(fixtureDir, 'readiness', 'symlink-trust-root-summary.md')
    ],
    'release readiness gate symlink trust root',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );
  assert.notEqual(symlinkTrustRun.status, 0, 'expected symlinked trust root to fail readiness');
  const symlinkTrustPayload = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'readiness', 'symlink-trust-root-summary.json'), 'utf8')
  );
  assert.ok(
    symlinkTrustPayload.blockers.some((blocker) => blocker.id === 'path.trust-root'
      && /must not use symlink path segment/.test(blocker.detail)),
    'expected readiness blockers to reject symlinked trust roots'
  );

  const symlinkCoverageRun = runNode(
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
      symlinkCoverageRoot,
      '--attested',
      '--tui-verify-root',
      tuiVerifyRoot,
      '--out-json',
      path.join(fixtureDir, 'readiness', 'symlink-coverage-root-summary.json'),
      '--out-md',
      path.join(fixtureDir, 'readiness', 'symlink-coverage-root-summary.md')
    ],
    'release readiness gate symlink coverage root',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );
  assert.notEqual(symlinkCoverageRun.status, 0, 'expected symlinked coverage root to fail readiness');
  const symlinkCoveragePayload = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'readiness', 'symlink-coverage-root-summary.json'), 'utf8')
  );
  assert.ok(
    symlinkCoveragePayload.blockers.some((blocker) => blocker.id === 'path.coverage-dir'
      && /must not use symlink path segment/.test(blocker.detail)),
    'expected readiness blockers to reject symlinked coverage roots'
  );
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
    throw error;
  }
  console.warn(`readiness-gate symlink input assertion skipped: ${error.code}`);
} finally {
  fs.rmSync(symlinkTuiRoot, { recursive: true, force: true });
  fs.rmSync(symlinkTrustRoot, { recursive: true, force: true });
  fs.rmSync(symlinkCoverageRoot, { recursive: true, force: true });
  fs.rmSync(symlinkInputTarget, { recursive: true, force: true });
}

const missingMacosRoot = path.join(fixtureDir, 'tui-missing-macos');
writeTuiReleaseReport(missingMacosRoot, 'ubuntu');
writeTuiReleaseReport(missingMacosRoot, 'windows');
const missingTargetRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    missingMacosRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'missing-target-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'missing-target-summary.md')
  ],
  'release readiness gate missing target',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(missingTargetRun.status, 0, 'expected readiness gate to fail when a TUI target report is missing');
const missingTargetPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'missing-target-summary.json'), 'utf8')
);
assert.equal(missingTargetPayload.ok, false, 'expected readiness gate to report ok=false when a TUI target is missing');
assert.equal(missingTargetPayload.releaseChecks.tuiVerify.ok, false, 'expected tui verification gate to fail');
assert.deepEqual(missingTargetPayload.releaseChecks.tuiVerify.missingTargets, ['macos']);

const duplicateTuiRoot = path.join(fixtureDir, 'tui-duplicate-target');
writeJson(
  path.join(duplicateTuiRoot, 'current', 'verify-tui-ubuntu', 'release_check_report.json'),
  createTuiReleaseReport('ubuntu')
);
writeJson(
  path.join(duplicateTuiRoot, 'current', 'verify-tui-windows', 'release_check_report.json'),
  createTuiReleaseReport('windows')
);
writeJson(
  path.join(duplicateTuiRoot, 'current', 'verify-tui-macos', 'release_check_report.json'),
  createTuiReleaseReport('macos')
);
writeJson(
  path.join(duplicateTuiRoot, 'stale', 'verify-tui-macos', 'release_check_report.json'),
  createTuiReleaseReport('macos', { status: 'failed' })
);
const duplicateTuiRun = runNode(
  [
    ...baseArgs,
    '--tui-verify-root',
    duplicateTuiRoot,
    '--out-json',
    path.join(fixtureDir, 'readiness', 'duplicate-tui-summary.json'),
    '--out-md',
    path.join(fixtureDir, 'readiness', 'duplicate-tui-summary.md')
  ],
  'release readiness gate duplicate tui target',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(duplicateTuiRun.status, 0, 'expected duplicate TUI target reports to fail readiness');
const duplicateTuiPayload = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'readiness', 'duplicate-tui-summary.json'), 'utf8')
);
assert.ok(
  duplicateTuiPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.duplicates'),
  'expected readiness blockers to report duplicate TUI target reports'
);
assert.ok(
  duplicateTuiPayload.blockers.some((blocker) => blocker.id === 'tuiVerify.failed'),
  'expected readiness blockers to report the failed duplicate TUI report path'
);
assert.deepEqual(
  duplicateTuiPayload.releaseChecks.tuiVerify.duplicateTargets.map((entry) => entry.target),
  ['macos'],
  'expected readiness summary to expose the duplicated TUI target'
);


console.log('release readiness gate test passed');

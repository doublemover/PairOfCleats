#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { setupReadinessGateFixture } from './readiness-gate-fixture.js';

// Portable duplicate/failure controls transferred from the authority wrapper.
const { root, fixtureDir, baseArgs, writeJson, createTuiReleaseReport } =
  await setupReadinessGateFixture('release-readiness-duplicate-tui', { scenarios: [] });

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
assert.deepEqual(duplicateTuiPayload.releaseChecks.tuiVerify.failedReports,
  [path.relative(root, path.join(duplicateTuiRoot, 'stale', 'verify-tui-macos', 'release_check_report.json')).replace(/\\/g, '/')],
  'retain the exact failed report path even when qualification also rejects it');


console.log('Readiness retains duplicate and failed TUI report paths independently of qualification');

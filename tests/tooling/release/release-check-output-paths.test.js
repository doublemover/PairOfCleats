#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'release', 'check.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-check-output-paths');
const outsideReportPath = path.resolve(root, '..', `outside-release-check-report-${process.pid}.json`);
const outsideManifestPath = path.resolve(root, '..', `outside-release-check-manifest-${process.pid}.json`);
const artifactPath = path.join(root, 'dist', 'vscode', 'pairofcleats.vsix');
const artifactBackupPath = path.join(fixtureDir, 'pairofcleats.vsix.backup');
const artifactExisted = fs.existsSync(artifactPath);

const outsideReportRun = runNode(
  [
    scriptPath,
    '--dry-run',
    '--report',
    outsideReportPath,
    '--manifest',
    path.join(fixtureDir, 'release-manifest.json')
  ],
  'release check outside report path',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideReportRun.status, 0, 'expected outside release-check report path to fail');
assert.match(
  outsideReportRun.stderr,
  /report path must stay within repo root/,
  'expected outside report failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideReportPath), false, 'expected release-check not to create outside report');

const outsideManifestRun = runNode(
  [
    scriptPath,
    '--dry-run',
    '--report',
    path.join(fixtureDir, 'release-check-report.json'),
    '--manifest',
    outsideManifestPath
  ],
  'release check outside manifest path',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideManifestRun.status, 0, 'expected outside release-check manifest path to fail');
assert.match(
  outsideManifestRun.stderr,
  /manifest path must stay within repo root/,
  'expected outside manifest failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideManifestPath), false, 'expected release-check not to create outside manifest');

const zeroScopeRun = runNode(
  [
    scriptPath,
    '--dry-run',
    '--surfaces',
    'tui',
    '--phases',
    'smoke',
    '--report',
    path.join(fixtureDir, 'zero-scope-report.json'),
    '--manifest',
    path.join(fixtureDir, 'zero-scope-manifest.json')
  ],
  'release check empty explicit surface phase scope',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(zeroScopeRun.status, 0, 'expected empty explicit surface/phase scope to fail');
assert.match(
  zeroScopeRun.stderr,
  /selected scope has no executable checks for phase\(s\): smoke/,
  'expected release-check to reject explicit scopes that select zero executable checks'
);

const runtimeTargetReportPath = path.join(fixtureDir, 'runtime-target-report.json');
const runtimeTargetRun = runNode(
  [
    scriptPath,
    '--dry-run',
    '--surfaces',
    'tui',
    '--phases',
    'install,boot',
    '--runtime-target',
    'macos',
    '--report',
    runtimeTargetReportPath,
    '--manifest',
    path.join(fixtureDir, 'runtime-target-manifest.json')
  ],
  'release check runtime target scope',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(runtimeTargetRun.status, 0, runtimeTargetRun.stderr || runtimeTargetRun.stdout);
assert.equal(
  JSON.parse(fs.readFileSync(runtimeTargetReportPath, 'utf8')).scope.runtimeTarget,
  'macos',
  'expected release-check reports to record matrix runtime target metadata'
);

const malformedRuntimeTargetRun = runNode(
  [
    scriptPath,
    '--dry-run',
    '--runtime-target',
    '../macos',
    '--report',
    path.join(fixtureDir, 'malformed-runtime-target-report.json'),
    '--manifest',
    path.join(fixtureDir, 'malformed-runtime-target-manifest.json')
  ],
  'release check malformed runtime target scope',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(malformedRuntimeTargetRun.status, 0, 'expected malformed runtime target metadata to fail');
assert.match(
  malformedRuntimeTargetRun.stderr,
  /runtime target is malformed/,
  'expected release-check to reject unsafe runtime target metadata'
);

const outsideSymlinkTarget = path.resolve(root, '..', `outside-release-check-output-dir-${process.pid}`);
const symlinkOutputDir = path.join(fixtureDir, 'symlink-output-dir');
try {
  fs.mkdirSync(outsideSymlinkTarget, { recursive: true });
  fs.rmSync(symlinkOutputDir, { recursive: true, force: true });
  fs.symlinkSync(outsideSymlinkTarget, symlinkOutputDir, 'junction');
  const symlinkOutputRun = runNode(
    [
      scriptPath,
      '--dry-run',
      '--phases',
      'changelog',
      '--report',
      path.join(symlinkOutputDir, 'release-check-report.json'),
      '--manifest',
      path.join(fixtureDir, 'symlink-output-manifest.json')
    ],
    'release check symlink output path',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(symlinkOutputRun.status, 0, 'expected symlinked release-check output path to fail');
  assert.match(
    symlinkOutputRun.stderr,
    /report path must not use symlink path segment/,
    'expected release-check to reject symlink path segments before writing outputs'
  );
  assert.equal(
    fs.existsSync(path.join(outsideSymlinkTarget, 'release-check-report.json')),
    false,
    'expected release-check not to write through a symlinked output directory'
  );
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
    throw error;
  }
  console.warn(`release-check symlink output assertion skipped: ${error.code}`);
} finally {
  fs.rmSync(symlinkOutputDir, { recursive: true, force: true });
  fs.rmSync(outsideSymlinkTarget, { recursive: true, force: true });
}

if (artifactExisted) {
  fs.mkdirSync(path.dirname(artifactBackupPath), { recursive: true });
  fs.copyFileSync(artifactPath, artifactBackupPath);
}
try {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.rmSync(artifactPath, { force: true });
  const outsideArtifactTarget = path.resolve(root, '..', `outside-release-check-artifact-${process.pid}.txt`);
  fs.writeFileSync(outsideArtifactTarget, 'outside artifact target\n');
  try {
    fs.symlinkSync(outsideArtifactTarget, artifactPath, 'file');
    const symlinkArtifactRun = runNode(
      [
        scriptPath,
        '--dry-run',
        '--surfaces',
        'vscode',
        '--phases',
        'install',
        '--report',
        path.join(fixtureDir, 'symlink-artifact-report.json'),
        '--manifest',
        path.join(fixtureDir, 'symlink-artifact-manifest.json')
      ],
      'release check symlink manifest artifact',
      root,
      process.env,
      { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
    );

    assert.notEqual(symlinkArtifactRun.status, 0, 'expected symlink release-check artifact to fail');
    assert.match(
      symlinkArtifactRun.stderr,
      /manifest artifact path must not be a symlink/,
      'expected release-check to reject symlink artifacts before hashing'
    );
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
      throw error;
    }
    console.warn(`release-check symlink artifact assertion skipped: ${error.code}`);
  } finally {
    fs.rmSync(outsideArtifactTarget, { force: true });
  }
} finally {
  fs.rmSync(artifactPath, { force: true });
  if (artifactExisted) {
    fs.copyFileSync(artifactBackupPath, artifactPath);
  }
}

console.log('release check output paths test passed');

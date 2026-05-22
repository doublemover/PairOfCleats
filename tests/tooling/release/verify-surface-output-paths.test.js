#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const verifyScript = path.join(root, 'tools', 'release', 'verify-surface.js');
const { dir: fixtureDir } = await prepareTestCacheDir('release-verify-output-paths');
const outsideOutPath = path.resolve(root, '..', `outside-release-verify-${process.pid}.json`);
const outsideInstallRoot = path.resolve(root, '..', `outside-release-tui-install-${process.pid}`);
const outsideCaptureDir = path.resolve(root, '..', `outside-release-tui-capture-${process.pid}`);

const outsideOutRun = runNode(
  [verifyScript, '--surface', 'api', '--stage', 'boot', '--out', outsideOutPath],
  'verify-surface outside output path',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideOutRun.status, 0, 'expected outside verify-surface output path to fail');
assert.match(
  outsideOutRun.stderr,
  /out path must stay within repo root/,
  'expected outside verify output failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideOutPath), false, 'expected verify-surface not to create outside output');

const outsideSymlinkTarget = path.resolve(root, '..', `outside-release-verify-symlink-${process.pid}`);
const symlinkOutDir = path.join(fixtureDir, 'symlink-out-dir');
try {
  fs.mkdirSync(outsideSymlinkTarget, { recursive: true });
  fs.rmSync(symlinkOutDir, { recursive: true, force: true });
  fs.symlinkSync(outsideSymlinkTarget, symlinkOutDir, 'junction');
  const symlinkOutRun = runNode(
    [
      verifyScript,
      '--surface',
      'api',
      '--stage',
      'boot',
      '--out',
      path.join(symlinkOutDir, 'verify-result.json')
    ],
    'verify-surface symlink output path',
    root,
    process.env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );

  assert.notEqual(symlinkOutRun.status, 0, 'expected symlinked verify-surface output path to fail');
  assert.match(
    symlinkOutRun.stderr,
    /out path must not use symlink path segment/,
    'expected verify-surface to reject symlink path segments before writing output'
  );
  assert.equal(
    fs.existsSync(path.join(outsideSymlinkTarget, 'verify-result.json')),
    false,
    'expected verify-surface not to write through a symlinked output directory'
  );
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
    throw error;
  }
  console.warn(`verify-surface symlink output assertion skipped: ${error.code}`);
} finally {
  fs.rmSync(symlinkOutDir, { recursive: true, force: true });
  fs.rmSync(outsideSymlinkTarget, { recursive: true, force: true });
}

const outsideInstallRun = runNode(
  [
    verifyScript,
    '--surface',
    'tui',
    '--stage',
    'boot',
    '--out',
    path.join(fixtureDir, 'outside-install-result.json'),
    '--install-root',
    outsideInstallRoot
  ],
  'verify-surface outside tui install root',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideInstallRun.status, 0, 'expected outside TUI install root to fail');
assert.match(
  JSON.parse(outsideInstallRun.stdout || '{}').error || '',
  /install-root must stay within repo root/,
  'expected outside TUI install root failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideInstallRoot), false, 'expected verify-surface not to create outside install root');

const outsideCaptureRun = runNode(
  [
    verifyScript,
    '--surface',
    'tui',
    '--stage',
    'boot',
    '--out',
    path.join(fixtureDir, 'outside-capture-result.json'),
    '--capture-out-dir',
    outsideCaptureDir
  ],
  'verify-surface outside tui capture directory',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(outsideCaptureRun.status, 0, 'expected outside TUI capture directory to fail');
assert.match(
  JSON.parse(outsideCaptureRun.stdout || '{}').error || '',
  /capture-out-dir must stay within repo root/,
  'expected outside TUI capture directory failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideCaptureDir), false, 'expected verify-surface not to create outside capture dir');

console.log('release verify-surface output paths test passed');

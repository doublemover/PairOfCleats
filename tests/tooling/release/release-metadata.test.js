#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'release', 'metadata.js');
const { dir: outDir } = await prepareTestCacheDir('release-metadata');
const outPath = path.join(outDir, 'metadata.json');
const notesPath = path.join(outDir, 'notes.md');
const outsideOutPath = path.resolve(root, '..', `outside-release-metadata-${process.pid}.json`);
const outsideNotesPath = path.resolve(root, '..', `outside-release-notes-${process.pid}.md`);
const releaseGitSha = '0123456789abcdef0123456789abcdef01234567';

const run = runNode(
  [scriptPath, '--tag', 'v0.3.0', '--git-sha', releaseGitSha, '--out', outPath, '--notes-out', notesPath],
  'release metadata',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(run.status, 0, run.stderr || run.stdout || 'expected release metadata command to succeed');
const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.equal(payload.releaseVersion, '0.3.0', 'expected root package release version');
assert.equal(payload.releaseTag, 'v0.3.0', 'expected validated release tag');
assert.equal(payload.gitSha, releaseGitSha, 'expected release metadata to use the checked-out release SHA');
assert.equal(Array.isArray(payload.shippedSurfaces), true, 'expected shipped surfaces version metadata');
assert.equal(fs.existsSync(notesPath), true, 'expected release notes output');
assert.match(fs.readFileSync(notesPath, 'utf8'), /^##\s+v?0\.3\.0/m, 'expected notes to contain current changelog section');

const outsideOutRun = runNode(
  [scriptPath, '--tag', 'v0.3.0', '--git-sha', releaseGitSha, '--out', outsideOutPath],
  'release metadata outside output path',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.notEqual(outsideOutRun.status, 0, 'expected outside metadata output to fail');
assert.match(
  outsideOutRun.stderr,
  /output path must stay within repo root/,
  'expected outside metadata output failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideOutPath), false, 'expected metadata command not to create outside output');

const outsideNotesRun = runNode(
  [scriptPath, '--tag', 'v0.3.0', '--git-sha', releaseGitSha, '--notes-out', outsideNotesPath],
  'release metadata outside notes output path',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.notEqual(outsideNotesRun.status, 0, 'expected outside notes output to fail');
assert.match(
  outsideNotesRun.stderr,
  /notes output path must stay within repo root/,
  'expected outside notes output failure to explain repo-root boundary'
);
assert.equal(fs.existsSync(outsideNotesPath), false, 'expected metadata command not to create outside notes');

console.log('release metadata test passed');

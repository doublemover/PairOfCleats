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

const run = runNode(
  [scriptPath, '--tag', 'v0.3.0', '--out', outPath, '--notes-out', notesPath],
  'release metadata',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(run.status, 0, run.stderr || run.stdout || 'expected release metadata command to succeed');
const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
assert.equal(payload.releaseVersion, '0.3.0', 'expected root package release version');
assert.equal(payload.releaseTag, 'v0.3.0', 'expected validated release tag');
assert.equal(Array.isArray(payload.shippedSurfaces), true, 'expected shipped surfaces version metadata');
assert.equal(fs.existsSync(notesPath), true, 'expected release notes output');
assert.match(fs.readFileSync(notesPath, 'utf8'), /^##\s+v?0\.3\.0/m, 'expected notes to contain current changelog section');

console.log('release metadata test passed');

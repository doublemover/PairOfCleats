#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'package-sublime-structure');

const run = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'package-sublime.js'), '--out-dir', outDir, '--smoke'],
  { cwd: root, encoding: 'utf8' }
);

if (run.status !== 0) {
  console.error('package-structure test failed: package-sublime command failed');
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(run.status ?? 1);
}

const archivePath = path.join(outDir, 'pairofcleats.sublime-package');
const manifestPath = `${archivePath}.manifest.json`;
if (!fs.existsSync(archivePath)) {
  console.error('package-structure test failed: archive missing');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('package-structure test failed: manifest missing');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const paths = Array.isArray(manifest.entries) ? manifest.entries.map((entry) => entry.path) : [];
if (!paths.length) {
  console.error('package-structure test failed: archive entries missing');
  process.exit(1);
}
if (!paths.every((entry) => entry.startsWith('PairOfCleats/'))) {
  console.error('package-structure test failed: entry prefix mismatch');
  process.exit(1);
}

console.log('sublime package structure test passed');

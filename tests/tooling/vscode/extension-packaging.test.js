#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'package-vscode-structure');

const run = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'package-vscode.js'), '--out-dir', outDir, '--smoke'],
  { cwd: root, encoding: 'utf8' }
);

if (run.status !== 0) {
  console.error('extension-packaging test failed: package-vscode command failed');
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(run.status ?? 1);
}

const archivePath = path.join(outDir, 'pairofcleats.vsix');
const manifestPath = `${archivePath}.manifest.json`;
if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
  console.error('extension-packaging test failed: archive outputs missing');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const paths = Array.isArray(manifest.entries) ? manifest.entries.map((entry) => entry.path) : [];
if (!paths.includes('extension/package.json') || !paths.includes('extension/extension.js')) {
  console.error('extension-packaging test failed: required extension entries missing');
  process.exit(1);
}

console.log('vscode extension packaging test passed');

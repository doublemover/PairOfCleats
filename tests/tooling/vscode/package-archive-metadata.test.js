#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'package-vscode-metadata');

const run = runNode(
  [path.join(root, 'tools', 'package-vscode.js'), '--out-dir', outDir],
  'package-vscode archive metadata',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
);
if (run.status !== 0) {
  console.error('package-archive-metadata test failed: package-vscode command failed');
  process.exit(run.status ?? 1);
}

const manifestPath = path.join(outDir, 'pairofcleats.vsix.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.fixedMtime !== '2000-01-01T00:00:00.000Z') {
  console.error('package-archive-metadata test failed: fixed mtime mismatch');
  process.exit(1);
}
for (const entry of manifest.entries || []) {
  if (entry.mtime !== '2000-01-01T00:00:00.000Z') {
    console.error('package-archive-metadata test failed: per-entry mtime mismatch');
    process.exit(1);
  }
}

console.log('vscode package archive metadata test passed');

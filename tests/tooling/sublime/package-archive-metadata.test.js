#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'package-sublime-metadata');

const run = runNode(
  [path.join(root, 'tools', 'package-sublime.js'), '--out-dir', outDir],
  'sublime package archive metadata',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
);
if (run.status !== 0) {
  console.error('package-archive-metadata test failed: package-sublime command failed');
  process.exit(run.status ?? 1);
}

const manifestPath = path.join(outDir, 'pairofcleats.sublime-package.manifest.json');
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
  if (entry.mode !== 420 && entry.mode !== 493) {
    console.error('package-archive-metadata test failed: unexpected mode bits');
    process.exit(1);
  }
}

console.log('sublime package archive metadata test passed');

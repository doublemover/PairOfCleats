#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const buildScript = path.join(root, 'tools', 'tui', 'build.js');
const manifestPath = path.join(root, 'dist', 'tui', 'tui-artifacts-manifest.json');
const checksumPath = `${manifestPath}.sha256`;

const result = spawnSync(process.execPath, [buildScript, '--smoke'], {
  cwd: root,
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('tui headless smoke test failed: build script exited non-zero');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) {
  console.error('tui headless smoke test failed: expected manifest outputs are missing');
  process.exit(1);
}

console.log('tui headless smoke test passed');

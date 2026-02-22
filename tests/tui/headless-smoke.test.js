#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const buildScript = path.join(root, 'tools', 'tui', 'build.js');
const testDistRel = path.join('.testLogs', 'tui', 'headless-smoke', 'dist');
const testDistDir = path.join(root, testDistRel);
const invokeCwd = path.join(root, '.testLogs', 'tui', 'headless-smoke', 'cwd', 'nested');
const manifestPath = path.join(testDistDir, 'tui-artifacts-manifest.json');
const checksumPath = `${manifestPath}.sha256`;
fs.rmSync(testDistDir, { recursive: true, force: true });
fs.mkdirSync(invokeCwd, { recursive: true });

const result = spawnSync(process.execPath, [buildScript, '--smoke'], {
  cwd: invokeCwd,
  encoding: 'utf8',
  env: {
    ...process.env,
    PAIROFCLEATS_TUI_DIST_DIR: testDistRel
  }
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

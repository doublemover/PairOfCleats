#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function resolvePatchPackageBin(cwd) {
  const binName = process.platform === 'win32' ? 'patch-package.cmd' : 'patch-package';
  return path.join(cwd, 'node_modules', '.bin', binName);
}

function run() {
  const cwd = process.cwd();
  const patchPackageBin = resolvePatchPackageBin(cwd);

  if (!fs.existsSync(patchPackageBin)) {
    console.log('[postinstall] patch-package not installed (likely --omit=dev); skipping patch step.');
    process.exit(0);
  }

  const result = spawnSync(patchPackageBin, ['--exclude', 'a^'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[postinstall] Failed to execute patch-package: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(Number.isInteger(result.status) ? result.status : 1);
}

run();

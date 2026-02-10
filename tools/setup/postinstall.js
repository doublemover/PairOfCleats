#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function hasPatchFiles(cwd) {
  const patchesDir = path.join(cwd, 'patches');
  if (!fs.existsSync(patchesDir)) return false;
  try {
    const entries = fs.readdirSync(patchesDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith('.patch'));
  } catch {
    return false;
  }
}

function resolvePatchPackageBin(cwd) {
  const binName = process.platform === 'win32' ? 'patch-package.cmd' : 'patch-package';
  return path.join(cwd, 'node_modules', '.bin', binName);
}

function run() {
  const cwd = process.cwd();
  const patchPackageBin = resolvePatchPackageBin(cwd);
  const patchFilesPresent = hasPatchFiles(cwd);

  if (!fs.existsSync(patchPackageBin)) {
    if (patchFilesPresent) {
      console.error('[postinstall] patch-package is required because patch files exist under patches/.');
      console.error('[postinstall] Install dev dependencies or run npm run patch before continuing.');
      process.exit(1);
    }
    console.log('[postinstall] patch-package not installed and no patch files found; skipping patch step.');
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

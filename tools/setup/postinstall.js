#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitLikeChildResult } from './postinstall-exit.js';

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

function resolveRebuildNativeScript(cwd) {
  return path.join(cwd, 'tools', 'setup', 'rebuild-native.js');
}

function getEnvValue(name) {
  const exact = process.env[name];
  if (exact != null) return exact;
  const lower = process.env[name.toLowerCase()];
  if (lower != null) return lower;
  return process.env[name.toUpperCase()];
}

function isDevDependenciesOmitted() {
  const omitRaw = String(getEnvValue('npm_config_omit') || '').trim();
  if (omitRaw) {
    const omitted = omitRaw.toLowerCase().split(/[,\s]+/).filter(Boolean);
    if (omitted.includes('dev')) return true;
  }
  const productionRaw = String(getEnvValue('npm_config_production') || '').trim().toLowerCase();
  if (productionRaw === 'true' || productionRaw === '1') return true;
  const nodeEnvRaw = String(getEnvValue('NODE_ENV') || '').trim().toLowerCase();
  return nodeEnvRaw === 'production';
}

function run() {
  const cwd = process.cwd();
  const patchPackageBin = resolvePatchPackageBin(cwd);
  const rebuildNativeScript = resolveRebuildNativeScript(cwd);
  const patchFilesPresent = hasPatchFiles(cwd);

  if (!fs.existsSync(patchPackageBin)) {
    if (patchFilesPresent) {
      if (isDevDependenciesOmitted()) {
        console.error('[postinstall] patch-package is unavailable in an omitted-dev install, but required patches exist.');
        console.error('[postinstall] Install with dev dependencies (or make patch-package available) so patches are applied.');
      } else {
        console.error('[postinstall] patch-package is required because patch files exist under patches/.');
        console.error('[postinstall] Install dev dependencies or run npm run patch before continuing.');
      }
      process.exit(1);
    }
    console.log('[postinstall] patch-package not installed and no patch files found; skipping patch step.');
    process.exit(0);
  }

  if (!patchFilesPresent) {
    console.log('[postinstall] no patch files found; skipping patch step.');
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

  if (result.status !== 0) {
    exitLikeChildResult(result);
  }

  if (!fs.existsSync(rebuildNativeScript)) {
    console.error(`[postinstall] rebuild script not found: ${rebuildNativeScript}`);
    process.exit(1);
  }

  const rebuildResult = spawnSync(process.execPath, [rebuildNativeScript], {
    stdio: 'inherit'
  });
  if (rebuildResult.error) {
    console.error(`[postinstall] Failed to execute rebuild:native: ${rebuildResult.error.message}`);
    process.exit(1);
  }
  exitLikeChildResult(rebuildResult);
}

run();

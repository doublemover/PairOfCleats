#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitLikeChildResult } from './postinstall-exit.js';
import { applyPatches, exitPatchFailure } from './apply-patches.js';

function run() {
  const cwd = process.cwd();
  const rebuildNativeScript = path.join(cwd, 'tools', 'setup', 'rebuild-native.js');
  let patchCount;
  try {
    patchCount = applyPatches(cwd);
  } catch (error) {
    exitPatchFailure(error);
    return;
  }
  if (!patchCount) {
    console.log('[postinstall] no patch files found; skipping patch step.');
    return;
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

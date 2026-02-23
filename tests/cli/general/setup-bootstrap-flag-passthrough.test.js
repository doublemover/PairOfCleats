#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI entrypoint: ${binPath}`);
  process.exit(1);
}

const setupHelp = spawnSync(process.execPath, [binPath, 'setup', '--help'], { encoding: 'utf8' });
if (setupHelp.status !== 0) {
  console.error('setup --help should pass through wrapper validation');
  process.exit(setupHelp.status ?? 1);
}
const setupOutput = getCombinedOutput(setupHelp);
if (/Unknown flag:\s+--help/.test(setupOutput)) {
  console.error('setup --help should not be rejected by wrapper-level flag validation');
  process.exit(1);
}

const bootstrapHelp = spawnSync(process.execPath, [binPath, 'bootstrap', '--help'], { encoding: 'utf8' });
if (bootstrapHelp.status !== 0) {
  console.error('bootstrap --help should pass through wrapper validation');
  process.exit(bootstrapHelp.status ?? 1);
}
const bootstrapOutput = getCombinedOutput(bootstrapHelp);
if (/Unknown flag:\s+--help/.test(bootstrapOutput)) {
  console.error('bootstrap --help should not be rejected by wrapper-level flag validation');
  process.exit(1);
}

console.log('setup/bootstrap flag passthrough test passed');

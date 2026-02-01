#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { skip } from '../../helpers/skip.js';
import { resolveSilentStdio } from '../../helpers/test-env.js';

const allowRun = process.env.PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET === '1'
  || process.env.PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET === 'true';
if (!allowRun) {
  skip('timeout target is helper-only');
}

const pidFile = process.env.PAIROFCLEATS_TEST_PID_FILE;
if (!pidFile) {
  console.error('Missing PAIROFCLEATS_TEST_PID_FILE');
  process.exit(1);
}

const spawnSleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
  stdio: resolveSilentStdio('ignore')
});

const child = spawnSleeper();
const grandchild = spawnSleeper();

fs.writeFileSync(pidFile, JSON.stringify({
  parent: process.pid,
  child: child.pid,
  grandchild: grandchild.pid
}));

setInterval(() => {}, 1000);

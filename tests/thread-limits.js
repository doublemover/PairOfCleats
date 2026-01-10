#!/usr/bin/env node
import { resolveThreadLimits } from '../src/shared/threads.js';

const argv = { threads: 4 };
const rawArgv = ['--threads', '4'];
const envConfig = {};
const limits = resolveThreadLimits({ argv, rawArgv, envConfig, configConcurrency: null, importConcurrencyConfig: null });

if (limits.fileConcurrency !== 4) {
  console.error(`thread limits test failed: fileConcurrency ${limits.fileConcurrency} !== 4`);
  process.exit(1);
}
if (limits.cpuConcurrency !== limits.fileConcurrency) {
  console.error('thread limits test failed: cpuConcurrency not equal fileConcurrency');
  process.exit(1);
}

console.log('thread limits test passed');

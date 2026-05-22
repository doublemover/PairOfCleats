#!/usr/bin/env node
import { runWalCheckpointScenario } from './update-contract-cases.js';

try {
  await runWalCheckpointScenario();
} catch (error) {
  console.error('sqlite incremental WAL checkpoint contract failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental WAL checkpoint contract passed');

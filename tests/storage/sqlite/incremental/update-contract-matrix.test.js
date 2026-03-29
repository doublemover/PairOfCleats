#!/usr/bin/env node
import {
  runSearchAfterUpdateScenario,
  runWalCheckpointScenario
} from './update-contract-cases.js';

const cases = [
  { name: 'search after update', run: runSearchAfterUpdateScenario },
  { name: 'wal checkpoint', run: runWalCheckpointScenario }
];

for (const testCase of cases) {
  try {
    await testCase.run();
  } catch (error) {
    console.error(`sqlite incremental update contract matrix failed: ${testCase.name}`);
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

console.log(`sqlite incremental update contract matrix passed (${cases.length} cases)`);

#!/usr/bin/env node
import { runSearchAfterUpdateScenario } from './update-contract-cases.js';

try {
  await runSearchAfterUpdateScenario();
} catch (error) {
  console.error('sqlite incremental search after update failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental search after update test passed');

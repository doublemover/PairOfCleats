#!/usr/bin/env node
import { runCompactScenario } from './helpers/maintenance-scenarios.js';

try {
  await runCompactScenario();
} catch (error) {
  console.error('sqlite maintenance contract matrix failed: sqlite compaction');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite maintenance contract matrix passed (1 case)');

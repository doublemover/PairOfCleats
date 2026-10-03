#!/usr/bin/env node
import { runDocIdReuseScenario } from './update-contract-cases.js';

try {
  await runDocIdReuseScenario();
} catch (error) {
  console.error('sqlite incremental doc-id reuse failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental doc-id reuse test passed');

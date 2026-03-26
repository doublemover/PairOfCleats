#!/usr/bin/env node
import { runManifestHashFillScenario } from './update-contract-cases.js';

try {
  await runManifestHashFillScenario();
} catch (error) {
  console.error('sqlite incremental manifest hash fill failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental manifest hash fill test passed');

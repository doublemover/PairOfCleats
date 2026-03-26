#!/usr/bin/env node
import { runManifestNormalizationScenario } from './update-contract-cases.js';

try {
  await runManifestNormalizationScenario();
} catch (error) {
  console.error('sqlite incremental manifest normalization failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental manifest normalization test passed');

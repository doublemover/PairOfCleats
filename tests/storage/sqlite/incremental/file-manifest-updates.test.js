#!/usr/bin/env node
import { runFileManifestScenario } from './update-contract-cases.js';

try {
  await runFileManifestScenario();
} catch (error) {
  console.error('sqlite incremental file-manifest updates failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite incremental file-manifest updates test passed');

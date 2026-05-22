#!/usr/bin/env node
import { runSidecarCleanupScenario } from './helpers/maintenance-scenarios.js';

try {
  await runSidecarCleanupScenario();
} catch (error) {
  console.error('sqlite maintenance sidecar cleanup failed');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
}

console.log('sqlite maintenance sidecar cleanup passed');

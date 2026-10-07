#!/usr/bin/env node
import path from 'node:path';

import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();

const run = runNode(
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'smoke', '--json'],
  'indexer service smoke',
  root,
  applyTestEnv({
    cacheRoot: resolveTestCachePath(root, 'service-mode-smoke'),
    syncProcess: false
  }),
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

if (run.status !== 0) {
  console.error('service-mode-smoke test failed: smoke command returned non-zero');
  if (run.stderr) console.error(run.stderr.trim());
  process.exit(run.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(run.stdout || '{}');
} catch {
  console.error('service-mode-smoke test failed: smoke output is not valid JSON');
  process.exit(1);
}

if (!payload?.ok || !payload.canonicalCommand || !payload.queueSummary) {
  console.error('service-mode-smoke test failed: expected canonical smoke payload fields');
  process.exit(1);
}

if (!Array.isArray(payload.requiredEnv) || !payload.requiredEnv.includes('PAIROFCLEATS_CACHE_ROOT')) {
  console.error('service-mode-smoke test failed: required env contract missing');
  process.exit(1);
}

console.log('service mode smoke test passed');

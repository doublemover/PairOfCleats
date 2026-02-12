#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const runnerPath = path.join(root, 'tools', 'build', 'embeddings', 'runner.js');
const source = await fs.readFile(runnerPath, 'utf8');

assert.match(
  source,
  /queueBackgroundSqliteMaintenance\s*=\s*\(\{\s*mode,\s*denseCount,\s*modeIndexRoot,\s*sqlitePathsForMode/m,
  'maintenance queue helper must accept modeIndexRoot + mode-scoped sqlite paths'
);
assert.match(
  source,
  /args\.push\('--index-root', modeIndexRoot\);/m,
  'background maintenance should pass mode-specific --index-root to compaction'
);
assert.match(
  source,
  /const modeTracker = ensureBuildStateTracker\(modeIndexRoot\);/m,
  'build-state tracking should follow mode-specific roots'
);
assert.match(
  source,
  /queueBackgroundSqliteMaintenance\(\{[\s\S]*modeIndexRoot[\s\S]*sqlitePathsForMode[\s\S]*\}\);/m,
  'maintenance queue call should carry mode-specific root + sqlite paths'
);

console.log('mode root divergence maintenance contract test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { getQueuePaths } from '../../../tools/service/queue.js';
import { getServiceShutdownPaths } from '../../../tools/service/shutdown-state.js';
import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  queueDir,
  configPath,
  runCliJson,
  seedStaleLocks,
  readAuditLines
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-unlock'
});

await seedStaleLocks();

const unlockDryRun = runCliJson('unlock', '--config', configPath, '--lock', 'all', '--dry-run', '--json');
assert.equal(unlockDryRun.ok, true);
assert.equal(unlockDryRun.results.every((entry) => entry.removed === false), true, 'expected dry-run unlock to avoid deleting lock files');

const unlockActual = runCliJson('unlock', '--config', configPath, '--lock', 'all', '--json');
assert.equal(unlockActual.ok, true);
assert.equal(unlockActual.results.filter((entry) => entry.removed).length >= 1, true, 'expected unlock to remove at least one stale lock file');
assert.equal(await fs.stat(getQueuePaths(queueDir, 'index').lockPath).then(() => true).catch(() => false), false, 'expected queue lock file to be absent after unlock');
assert.equal(await fs.stat(getServiceShutdownPaths(queueDir, 'index').lockPath).then(() => true).catch(() => false), false, 'expected shutdown lock file to be absent after unlock');

const auditLines = await readAuditLines();
assert.equal(auditLines.length >= 1, true, 'expected unlock repair mutation to append an audit entry');

console.log('indexer service repair cli unlock test passed');

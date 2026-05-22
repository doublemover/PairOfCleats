#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  configPath,
  runCliJson,
  seedStaleRunningJob,
  seedOrphanArtifacts,
  seedStaleLocks
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-inspect'
});

await seedStaleRunningJob();
const { orphanLogPath, orphanReportPath } = await seedOrphanArtifacts();
await seedStaleLocks();

const inspectPayload = runCliJson('inspect', '--config', configPath, '--json');
assert.equal(inspectPayload.ok, true);
assert.equal(inspectPayload.heartbeat?.stale >= 1, true, 'expected inspect to surface stale running jobs');
assert.equal(inspectPayload.orphans?.logs.includes(path.resolve(orphanLogPath)), true, 'expected inspect to report orphan logs');
assert.equal(inspectPayload.orphans?.reports.includes(path.resolve(orphanReportPath)), true, 'expected inspect to report orphan reports');
assert.equal(inspectPayload.locks.every((entry) => entry.safeToUnlock === true), true, 'expected inspect to classify stale locks as safe to unlock');

const heartbeatPayload = runCliJson('heartbeat-status', '--config', configPath, '--json');
assert.equal(heartbeatPayload.summary?.stale, 1, 'expected heartbeat status to classify stale running job');
assert.equal(heartbeatPayload.jobs?.[0]?.status, 'stale');

console.log('indexer service repair cli inspect test passed');

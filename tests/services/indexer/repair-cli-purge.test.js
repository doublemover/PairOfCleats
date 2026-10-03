#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  configPath,
  runCliJson,
  seedRetryJob,
  readAuditLines
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-purge'
});

await seedRetryJob();

const purgeDryRun = runCliJson('purge', '--config', configPath, '--job', 'job-repair-retry', '--dry-run', '--json');
assert.equal(purgeDryRun.ok, true);
assert.equal(purgeDryRun.dryRun, true);

const purgeActual = runCliJson('purge', '--config', configPath, '--job', 'job-repair-retry', '--json');
assert.equal(purgeActual.ok, true);
assert.equal(purgeActual.removed, 1);

const auditLines = await readAuditLines();
assert.equal(auditLines.length >= 1, true, 'expected purge mutation to append an audit entry');

console.log('indexer service repair cli purge test passed');

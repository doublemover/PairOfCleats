#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createRepairCliFixture } from './repair-cli-fixture.js';

const {
  configPath,
  runCliJson,
  seedOrphanArtifacts,
  readAuditLines
} = await createRepairCliFixture({
  cacheName: 'indexer-service-repair-cli-cleanup-orphans'
});

const { orphanLogPath, orphanReportPath } = await seedOrphanArtifacts();

const cleanupDryRun = runCliJson('cleanup-orphans', '--config', configPath, '--dry-run', '--json');
assert.equal(cleanupDryRun.ok, true);
assert.equal(cleanupDryRun.orphans?.logs.includes(path.resolve(orphanLogPath)), true, 'expected dry-run cleanup to preserve orphan reporting');

const cleanupActual = runCliJson('cleanup-orphans', '--config', configPath, '--json');
assert.equal(cleanupActual.ok, true);
assert.equal(cleanupActual.removed?.logs.includes(path.resolve(orphanLogPath)), true, 'expected cleanup to remove orphan log');
assert.equal(cleanupActual.removed?.reports.includes(path.resolve(orphanReportPath)), true, 'expected cleanup to remove orphan report');

const auditLines = await readAuditLines();
assert.equal(auditLines.length >= 1, true, 'expected orphan cleanup mutation to append an audit entry');

console.log('indexer service repair cli cleanup-orphans test passed');

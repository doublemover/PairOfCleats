#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { setRecordsIncrementalCapability } from '../../../src/storage/sqlite/build/index.js';
import {
  assertSeededDbUnchangedAfterZeroState,
  assertZeroStateSkipped,
  prepareZeroStateSqliteFixture,
  runZeroStateSqliteBuild
} from './helpers/zero-state-rebuild-fixture.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite empty records rebuild test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const fixture = await prepareZeroStateSqliteFixture({
  label: 'sqlite-skip-empty-records-rebuild',
  mode: 'records',
  indexDirName: 'index-records',
  dbName: 'index-records.db'
});

const modeArg = 'recordsDir';
const skipMessage = 'skipping records sqlite rebuild (artifacts empty; zero-state).';
const logs = await runZeroStateSqliteBuild({ fixture, modeArg });

await assertZeroStateSkipped({
  outputPath: fixture.outputPath,
  zeroStateManifestPath: fixture.zeroStateManifestPath,
  logs,
  message: skipMessage
});

await assertSeededDbUnchangedAfterZeroState({
  Database,
  outputPath: fixture.outputPath,
  runAgain: () => runZeroStateSqliteBuild({ fixture, modeArg }),
  message: skipMessage,
  unchangedMessage: 'expected empty records sqlite db to remain unchanged'
});

const userConfig = loadUserConfig(fixture.repoRoot);
const repoCacheRoot = getRepoCacheRoot(fixture.repoRoot, userConfig);
const recordsIncrementalDir = path.join(repoCacheRoot, 'incremental', 'records');
const seedUnsupportedDb = new Database(fixture.outputPath);
seedUnsupportedDb.exec('INSERT INTO chunks (id, mode) VALUES (1, \'records\');');
seedUnsupportedDb.close();
await fs.mkdir(path.join(recordsIncrementalDir, 'files'), { recursive: true });
const unsupportedManifest = {
  version: 5,
  mode: 'records',
  files: {}
};
setRecordsIncrementalCapability(unsupportedManifest, false);
await fs.writeFile(
  path.join(recordsIncrementalDir, 'manifest.json'),
  `${JSON.stringify(unsupportedManifest, null, 2)}\n`,
  'utf8'
);

const unsupportedLogs = [];
unsupportedLogs.push(...await runZeroStateSqliteBuild({ fixture, modeArg, incremental: true }));
const unsupportedOutput = unsupportedLogs.join('\n').toLowerCase();
assert.equal(
  unsupportedOutput.includes('records incremental bundles unsupported')
    || unsupportedOutput.includes('incremental bundles skipped for records'),
  true,
  'expected unsupported records incremental capability warning'
);
assert.equal(
  unsupportedOutput.includes('using artifacts'),
  true,
  'expected unsupported records incremental manifest to fall back to artifacts'
);

console.log('sqlite skip empty records rebuild test passed');

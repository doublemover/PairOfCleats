#!/usr/bin/env node
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  assertSeededDbUnchangedAfterZeroState,
  assertZeroStateSkipped,
  prepareZeroStateSqliteFixture,
  runZeroStateSqliteBuild
} from './helpers/zero-state-rebuild-fixture.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite empty code rebuild test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const fixture = await prepareZeroStateSqliteFixture({
  label: 'sqlite-skip-empty-code-rebuild',
  mode: 'code',
  indexDirName: 'index-code',
  dbName: 'index-code.db'
});

const modeArg = 'codeDir';
const skipMessage = 'skipping sqlite rebuild (artifacts empty; zero-state).';
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
  unchangedMessage: 'expected empty code sqlite db to remain unchanged'
});

console.log('sqlite skip empty code rebuild test passed');

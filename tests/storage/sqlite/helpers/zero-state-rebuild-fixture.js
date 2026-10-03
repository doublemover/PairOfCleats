import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildSqliteIndex } from '../../../../tools/build/sqlite/runner.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const prepareZeroStateSqliteFixture = async ({
  label,
  mode,
  indexDirName,
  dbName
}) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, label);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const buildRoot = path.join(tempRoot, 'build-root');
  const sourceIndexDir = path.join(buildRoot, indexDirName);
  const sqliteDir = path.join(buildRoot, 'index-sqlite');
  const outputPath = path.join(sqliteDir, dbName);
  const zeroStateManifestPath = path.join(sourceIndexDir, 'pieces', 'sqlite-zero-state.json');

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fs.mkdir(sourceIndexDir, { recursive: true });
  await fs.mkdir(sqliteDir, { recursive: true });
  await fs.writeFile(path.join(repoRoot, 'src', 'placeholder.js'), 'export const x = 1;\n', 'utf8');

  applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        embeddings: { enabled: false }
      }
    }
  });

  await fs.writeFile(path.join(sourceIndexDir, 'chunk_meta.json'), '[]\n', 'utf8');

  return {
    tempRoot,
    repoRoot,
    cacheRoot,
    buildRoot,
    sourceIndexDir,
    sqliteDir,
    outputPath,
    zeroStateManifestPath,
    mode
  };
};

export const runZeroStateSqliteBuild = async ({
  fixture,
  modeArg,
  incremental = false
}) => {
  const logs = [];
  await buildSqliteIndex({
    root: fixture.repoRoot,
    mode: fixture.mode,
    incremental,
    indexRoot: fixture.buildRoot,
    out: fixture.outputPath,
    [modeArg]: fixture.sourceIndexDir,
    emitOutput: true,
    logger: {
      log: (message) => logs.push(String(message || '')),
      warn: (message) => logs.push(String(message || '')),
      error: (message) => logs.push(String(message || ''))
    },
    exitOnError: false
  });
  return logs;
};

export const assertZeroStateSkipped = async ({
  outputPath,
  zeroStateManifestPath,
  logs,
  message
}) => {
  assert.equal(
    await fs.access(outputPath).then(() => true).catch(() => false),
    false,
    'expected first-run empty sqlite build to skip creating db'
  );
  assert.equal(
    await fs.access(zeroStateManifestPath).then(() => true).catch(() => false),
    true,
    'expected zero-state manifest for empty mode'
  );
  assert.equal(
    logs.some((line) => line.includes(message)),
    true,
    'expected zero-state skip log for empty rebuild'
  );
};

export const assertSeededDbUnchangedAfterZeroState = async ({
  Database,
  outputPath,
  runAgain,
  message,
  unchangedMessage
}) => {
  const seedDb = new Database(outputPath);
  seedDb.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, mode TEXT NOT NULL);');
  seedDb.close();

  const before = await fs.stat(outputPath);
  const logs = await runAgain();
  const after = await fs.stat(outputPath);

  assert.equal(after.mtimeMs, before.mtimeMs, unchangedMessage);
  assert.equal(
    logs.some((line) => line.includes(message)),
    true,
    'expected repeat zero-state skip log'
  );
};

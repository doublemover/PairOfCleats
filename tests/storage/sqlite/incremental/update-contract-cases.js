import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import {
  appendFixtureExport,
  createIncrementalScenario,
  runRepoSearchJson
} from '../helpers/incremental-scenarios.js';

export const runDocIdReuseScenario = async () => {
  const scenario = await createIncrementalScenario({ name: 'doc-id-reuse', mode: 'code' });
  scenario.runBuildIndex();
  await scenario.runBuildSqlite();

  const dbBefore = await scenario.openCodeDb();
  const deletedIds = dbBefore
    .prepare('SELECT id FROM chunks WHERE mode = ? AND file = ? ORDER BY id')
    .all('code', 'src/util.js')
    .map((row) => row.id);
  const beforeStats = dbBefore
    .prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?')
    .get('code');
  dbBefore.close();

  assert.ok(deletedIds.length > 0, 'expected at least one doc id for src/util.js');

  await fsPromises.rm(path.join(scenario.repoRoot, 'src', 'util.js'));
  await fsPromises.writeFile(
    path.join(scenario.repoRoot, 'src', 'new-file.js'),
    'export const meaning = 42;\n'
  );

  scenario.runBuildIndex({ incremental: true });
  await scenario.runBuildSqlite({ incremental: true });

  const dbAfter = await scenario.openCodeDb();
  const newIds = dbAfter
    .prepare('SELECT id FROM chunks WHERE mode = ? AND (file = ? OR file = ?) ORDER BY id')
    .all('code', 'src/new-file.js', 'src\\new-file.js')
    .map((row) => row.id);
  const removedRows = dbAfter
    .prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode = ? AND file = ?')
    .get('code', 'src/util.js');
  const afterStats = dbAfter
    .prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?')
    .get('code');
  dbAfter.close();

  assert.ok(newIds.length > 0, 'expected doc ids for src/new-file.js after incremental update');
  assert.equal(Number(removedRows?.count || 0), 0, 'expected src/util.js rows to be removed');
  assert.ok(Number.isFinite(Number(beforeStats?.maxId)), 'expected valid max doc id before update');
  assert.ok(Number.isFinite(Number(afterStats?.maxId)), 'expected valid max doc id after update');
  assert.ok(
    Number(afterStats.maxId) <= Number(beforeStats.maxId),
    `expected doc id reuse after incremental update; before=${beforeStats.maxId}, after=${afterStats.maxId}`
  );
};

export const runFileManifestScenario = async () => {
  const scenario = await createIncrementalScenario({
    name: 'file-manifest-updates',
    mode: 'code',
    scmProvider: 'none'
  });
  scenario.runBuildIndex();
  await scenario.runBuildSqlite();

  const dbBefore = await scenario.openCodeDb();
  const beforeRow = dbBefore
    .prepare('SELECT hash, chunk_count FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', 'src/index.js');
  dbBefore.close();

  assert.ok(beforeRow, 'missing file_manifest entry for src/index.js');

  await appendFixtureExport(scenario.repoRoot);

  scenario.runBuildIndex({ incremental: true });
  await scenario.runBuildSqlite({ incremental: true });

  const dbAfter = await scenario.openCodeDb();
  const afterRow = dbAfter
    .prepare('SELECT hash, chunk_count FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', 'src/index.js');
  dbAfter.close();

  assert.ok(afterRow, 'missing file_manifest entry after incremental update');
  assert.notEqual(beforeRow.hash, afterRow.hash, 'expected file_manifest hash to change after update');
  assert.ok(afterRow.chunk_count, 'expected file_manifest chunk_count after incremental update');
};

export const runManifestHashFillScenario = async () => {
  const scenario = await createIncrementalScenario({
    name: 'manifest-hash-fill',
    mode: 'code'
  });
  scenario.runBuildIndex();
  await scenario.runBuildSqlite();

  const db = await scenario.openCodeDb({ readonly: false });
  const targetFile = 'src/index.js';
  const before = db
    .prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', targetFile);
  assert.ok(before, 'missing file_manifest entry for src/index.js');
  db.prepare('UPDATE file_manifest SET hash = NULL WHERE mode = ? AND file = ?')
    .run('code', targetFile);
  db.close();

  scenario.runBuildIndex({ incremental: true });
  await scenario.runBuildSqlite({ incremental: true });

  const dbAfter = await scenario.openCodeDb();
  const after = dbAfter
    .prepare('SELECT hash FROM file_manifest WHERE mode = ? AND file = ?')
    .get('code', targetFile);
  dbAfter.close();

  assert.ok(after?.hash, 'expected file_manifest hash to be restored after incremental update');
};

export const runManifestNormalizationScenario = async () => {
  const scenario = await createIncrementalScenario({ name: 'manifest-normalization', mode: 'code' });
  scenario.runBuildIndex();
  await scenario.runBuildSqlite();

  const repoCacheRoot = getRepoCacheRoot(scenario.repoRoot, scenario.userConfig);
  const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  assert.ok(manifest?.files?.['src/index.js'], 'expected manifest entry for src/index.js');

  manifest.files['src\\index.js'] = manifest.files['src/index.js'];
  delete manifest.files['src/index.js'];
  await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const logs = [];
  await scenario.runBuildSqlite({
    incremental: true,
    logger: {
      log: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message)
    }
  });

  const output = logs.join('\n');
  assert.ok(
    output.includes('[sqlite] indexes updated.') || output.includes('[sqlite] index updated.'),
    'expected incremental sqlite update with normalized manifest'
  );
};

export const runSearchAfterUpdateScenario = async () => {
  const scenario = await createIncrementalScenario({ name: 'search-after-update', mode: 'code' });
  scenario.runBuildIndex();
  await scenario.runBuildSqlite();

  await appendFixtureExport(scenario.repoRoot);

  scenario.runBuildIndex({ incremental: true });
  await scenario.runBuildSqlite({ incremental: true });

  const searchResult = runRepoSearchJson({
    root: scenario.root,
    repoRoot: scenario.repoRoot,
    env: scenario.env,
    query: 'farewell',
    mode: 'code'
  });
  assert.equal(searchResult.status, 0, 'search should succeed after incremental update');
  assert.ok(
    searchResult.payload.code?.length || searchResult.payload.prose?.length,
    'expected sqlite search results after incremental update'
  );
};

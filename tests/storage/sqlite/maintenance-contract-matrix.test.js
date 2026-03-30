#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../../helpers/test-env.js';
import { loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const createFixture = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      }
    },
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });

  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'base.js'),
    'export function sqliteMaintenanceBase() { return "sqlite-maintenance-base"; }\n'
  );

  const run = (args, label) => {
    const result = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit'
    });
    if (result.status !== 0) {
      console.error(`Failed: ${label}`);
      process.exit(result.status ?? 1);
    }
  };

  return {
    repoRoot,
    run
  };
};

const runCompactScenario = async () => {
  const { repoRoot, run } = await createFixture('sqlite-maintenance-compact');
  const deletableFile = path.join(repoRoot, 'src', 'deletable.js');
  const renameFile = path.join(repoRoot, 'src', 'rename_me.js');
  await fsPromises.writeFile(deletableFile, 'export const xqzflorb = "xqzflorb";\n');
  await fsPromises.writeFile(renameFile, 'export function renameToken() { return "renametoken"; }\n');

  run(
    [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
    'build index'
  );
  await runSqliteBuild(repoRoot, { mode: 'code', env });

  const renamedFile = path.join(repoRoot, 'src', 'renamed.js');
  await fsPromises.rm(deletableFile, { force: true });
  await fsPromises.rename(renameFile, renamedFile);

  run(
    [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
    'build index (incremental)'
  );
  await runSqliteBuild(repoRoot, { mode: 'code', incremental: true, env });
  run(
    [path.join(root, 'tools', 'build', 'compact-sqlite-index.js'), '--repo', repoRoot],
    'compact sqlite index'
  );

  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    console.error('better-sqlite3 is required for sqlite maintenance contract matrix.');
    process.exit(1);
  }

  const sqlitePaths = resolveSqlitePaths(repoRoot, loadUserConfig(repoRoot));
  const db = new Database(sqlitePaths.codePath, { readonly: true });
  const stats = db.prepare('SELECT COUNT(*) AS total, MAX(id) AS maxId FROM chunks WHERE mode = ?').get('code') || {};
  const total = Number(stats.total) || 0;
  const maxId = Number(stats.maxId);
  if (total && maxId !== total - 1) {
    throw new Error(`Compaction failed: expected maxId=${total - 1} got ${maxId}`);
  }

  const oldFile = db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE mode = ? AND file = ?').get('code', 'src/rename_me.js');
  if (oldFile?.count) {
    throw new Error('Compaction failed: old file name still present.');
  }

  const manifestOld = db.prepare('SELECT COUNT(*) AS count FROM file_manifest WHERE mode = ? AND file = ?').get('code', 'src/rename_me.js');
  if (manifestOld?.count) {
    throw new Error('Compaction failed: old file name still in file_manifest.');
  }

  const manifestNew = db.prepare('SELECT COUNT(*) AS count FROM file_manifest WHERE mode = ? AND file = ?').get('code', 'src/renamed.js');
  if (!manifestNew?.count) {
    throw new Error('Compaction failed: renamed file missing from file_manifest.');
  }

  const vocabHit = db.prepare('SELECT COUNT(*) AS count FROM token_vocab WHERE mode = ? AND token = ?').get('code', 'xqzflorb');
  if (vocabHit?.count) {
    throw new Error('Compaction failed: deleted token still in vocab.');
  }

  db.close();
};

const runSidecarCleanupScenario = async () => {
  const { repoRoot, run } = await createFixture('sqlite-maintenance-sidecar-cleanup');
  run([path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'build index');
  await runSqliteBuild(repoRoot, { mode: 'code' });

  const userConfig = loadUserConfig(repoRoot);
  let sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
  let walPath = `${sqlitePaths.codePath}-wal`;
  let shmPath = `${sqlitePaths.codePath}-shm`;
  await fsPromises.writeFile(walPath, 'stale-wal');
  await fsPromises.writeFile(shmPath, 'stale-shm');

  await runSqliteBuild(repoRoot, { mode: 'code' });

  const staleWal = fs.existsSync(walPath) ? fs.readFileSync(walPath) : null;
  const staleShm = fs.existsSync(shmPath) ? fs.readFileSync(shmPath) : null;
  if (staleWal && staleWal.toString('utf8') === 'stale-wal') {
    throw new Error('Stale WAL sidecar was not cleaned up.');
  }
  if (staleShm && staleShm.toString('utf8') === 'stale-shm') {
    throw new Error('Stale SHM sidecar was not cleaned up.');
  }

  run(
    [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
    'build index (incremental)'
  );
  sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
  walPath = `${sqlitePaths.codePath}-wal`;
  shmPath = `${sqlitePaths.codePath}-shm`;
  await fsPromises.writeFile(walPath, 'stale-wal');
  await fsPromises.writeFile(shmPath, 'stale-shm');
  await runSqliteBuild(repoRoot, { mode: 'code', incremental: true });
  const incrementalWal = fs.existsSync(walPath) ? fs.readFileSync(walPath) : null;
  const incrementalShm = fs.existsSync(shmPath) ? fs.readFileSync(shmPath) : null;
  if (incrementalWal && incrementalWal.toString('utf8') === 'stale-wal') {
    throw new Error('Incremental WAL sidecar was not cleaned up.');
  }
  if (incrementalShm && incrementalShm.toString('utf8') === 'stale-shm') {
    throw new Error('Incremental SHM sidecar was not cleaned up.');
  }
};

const cases = [
  { name: 'sqlite compaction', run: runCompactScenario },
  { name: 'sqlite sidecar cleanup', run: runSidecarCleanupScenario }
];

for (const testCase of cases) {
  try {
    await testCase.run();
  } catch (error) {
    console.error(`sqlite maintenance contract matrix failed: ${testCase.name}`);
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

console.log(`sqlite maintenance contract matrix passed (${cases.length} cases)`);

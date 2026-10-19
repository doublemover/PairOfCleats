#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadUserConfig, resolveSqlitePaths } from '../../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { runNode } from '../../../helpers/run-node.js';
import { applyTestEnv, withTemporaryEnv } from '../../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../../helpers/temp.js';

const root = process.cwd();
const tempRoot = await makeTempDir('poc-summary-all-mode-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
try {
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}');
  await fsPromises.writeFile(path.join(repoRoot, 'src', 'index.js'),
    'export function answer() { return 42; }\n');
  await fsPromises.writeFile(path.join(repoRoot, 'README.md'),
    '# Summary report fixture\n\nThe answer is indexed.\n');
  const env = applyTestEnv({ cacheRoot, embeddings: 'stub', syncProcess: false,
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const localEnv = { ...env, PAIROFCLEATS_TRUSTED_CONFIG: undefined };
  runNode([path.join(root, 'build_index.js'), '--stage', '1', '--stub-embeddings',
    '--repo', repoRoot], 'summary all-mode index', repoRoot, env,
  { stdio: 'pipe', timeoutMs: 20000 });
  await runSqliteBuild(repoRoot, { env: localEnv, emitOutput: false });
  await withTemporaryEnv(localEnv, async () => {
    const paths = resolveSqlitePaths(repoRoot, loadUserConfig(repoRoot));
    for (const target of [paths.codePath, paths.prosePath]) {
      assert.equal(fs.existsSync(target), true, 'all-mode build must publish both SQLite indexes');
      const db = new Database(target, { readonly: true });
      try {
        assert.ok(db.prepare('SELECT COUNT(*) AS total FROM chunks').get().total > 0,
          'all-mode build must retain source chunks');
      } finally { db.close(); }
    }
  });
  console.log('summary report all-mode SQLite orchestration passed');
} finally {
  await rmDirRecursive(tempRoot);
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot, getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('stage4-mixed-mode-generations');
const repoRoot = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'code.js'), 'export function answer() { return 1; }\n');
await fs.writeFile(path.join(repoRoot, 'prose.md'), '# Generation prose\nOranges remain in the older prose generation.\n');
const env = applyTestEnv({ cacheRoot, embeddings: 'stub',
  testConfig: createFastIndexingTestConfig({ sqlite: { use: false } }) });
const build = options => buildIndex(repoRoot, { sqlite: false, 'stub-embeddings': true,
  'scm-provider': 'none', progress: 'off', ...options });
await build({ mode: 'all', stage: 'stage1' });
const config = loadUserConfig(repoRoot), cache = getRepoCacheRoot(repoRoot, config);
const pointer = path.join(cache, 'builds/current.json');
const first = JSON.parse(await fs.readFile(pointer, 'utf8'));
await fs.writeFile(path.join(repoRoot, 'code.js'), 'export function answer() { return 2; }\n');
await build({ mode: 'code', stage: 'stage1' });
const before = JSON.parse(await fs.readFile(pointer, 'utf8'));
assert.notEqual(before.buildRootsByMode.code, first.buildRootsByMode.code);
assert.equal(before.buildRootsByMode.prose, first.buildRootsByMode.prose);
await build({ mode: 'all', stage: 'stage4', sqlite: true });
const after = JSON.parse(await fs.readFile(pointer, 'utf8'));
assert.deepEqual(after.buildRootsByMode, before.buildRootsByMode, 'SQLite completion preserves every pinned mode generation');
assert.equal(after.buildId, before.buildId);
assert.equal(after.buildRoot, before.buildRoot);
for (const [mode, query, expected] of [['code', 'answer', 'code.js'], ['prose', 'oranges', 'prose.md']]) {
  const indexRoot = path.dirname(getIndexDir(repoRoot, mode, config));
  const sqlite = resolveSqlitePaths(repoRoot, config, { indexRoot });
  const db = new Database(mode === 'code' ? sqlite.codePath : sqlite.prosePath, { readonly: true, fileMustExist: true });
  try { assert.ok(db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count > 0); }
  finally { db.close(); }
  for (const cacheState of ['cold', 'warm']) {
    const result = runNode([path.join(root, 'search.js'), query, '--backend', 'sqlite', '--no-ann', '--json',
      '--mode', mode, '--repo', repoRoot], `pinned ${mode} SQLite query (${cacheState})`, root, env, { stdio: 'pipe' });
    assert.ok(JSON.parse(result.stdout)[mode].some(hit => hit.file === expected), `${mode} query retains its pinned source`);
  }
}
const current = await fs.readFile(pointer, 'utf8');
const outside = path.join(dir, 'outside-cache');
await fs.mkdir(outside);
for (const modeBuildRoots of [{ code: outside }, {}, { code: 42 }, { code: path.join(cache, after.buildRoot), prose: outside },
  { code: path.join(cache, before.buildRootsByMode.prose) }]) {
  await assert.rejects(promoteBuild({ repoRoot, userConfig: config, buildId: after.buildId,
    buildRoot: path.join(cache, after.buildRoot), stage: 'stage4', modes: ['code'], modeBuildRoots }),
  /mode.*root|escapes|promoted mode/i);
  assert.equal(await fs.readFile(pointer, 'utf8'), current, 'rejected mode authority cannot partially republish current.json');
}
console.log('Stage4 follows mixed mode roots, preserves generation authority, and rejects outside-root publication');

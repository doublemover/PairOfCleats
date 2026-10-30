#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getIndexDir, loadUserConfig, resolveSqlitePaths, toRealPathSync } from '../../../tools/shared/dict-utils.js';

import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const cases = ['artifacts', 'sqlite-stage4'];
assert.deepEqual(JSON.parse(await fsPromises.readFile(new URL('./all.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('cli/build-index/all/')[1];
assert.ok(cases.includes(selected), 'run one independently bounded all-mode build case');
const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-index-all', selected);
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRootRaw, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const repoRoot = toRealPathSync(repoRootRaw);

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.md'), '# Beta\n');
await fsPromises.mkdir(path.join(repoRoot, 'logs'), { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'logs', 'record-1.log'), '2024-01-01 00:00:00 log line\n');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    sqlite: { use: false },
    indexing: { scm: { provider: 'none' }, embeddings: { enabled: false } }
  }
});

// The artifact case retains default full all-mode orchestration. The separate
// stage4 case seeds its source through the real stage1 producer, then exercises
// the unchanged default-mode stage4 invocation inside its own deadline.
const buildArgs = [path.join(root, 'build_index.js'), '--mode', 'all', '--stub-embeddings', '--repo', repoRoot];
if (selected === 'sqlite-stage4') buildArgs.push('--stage', 'stage1');
runNode(
  buildArgs,
  'build_index --mode all',
  root,
  env
);

const userConfig = loadUserConfig(repoRoot);
const modes = ['code', 'prose', 'extracted-prose', 'records'];
const hasChunkMeta = (dir) => (
  fs.existsSync(path.join(dir, 'chunk_meta.json'))
  || fs.existsSync(path.join(dir, 'chunk_meta.jsonl'))
  || fs.existsSync(path.join(dir, 'chunk_meta.meta.json'))
  || fs.existsSync(path.join(dir, 'chunk_meta.parts'))
);

for (const mode of modes) {
  const dir = getIndexDir(repoRoot, mode, userConfig);
  if (!hasChunkMeta(dir)) {
    console.error(`Expected chunk metadata for ${mode} in ${dir}`);
    process.exit(1);
  }
}

console.log('build-index --mode all artifacts passed');

if (selected === 'sqlite-stage4') {

  runNode([path.join(root, 'build_index.js'), '--stage', '4', '--sqlite', '--stub-embeddings', '--repo', repoRoot],
    'default all-mode stage4', root, env);
  const sqlite = resolveSqlitePaths(repoRoot, userConfig);
  for (const [mode, filename] of Object.entries({ code: sqlite.codePath, prose: sqlite.prosePath,
    records: sqlite.recordsPath })) {
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count;
      assert.ok(count > 0,
        `stage4 must preserve the expected ${mode} source rows`);
      const rows = db.prepare('SELECT chunk_id, file, metaV2_json FROM chunks ORDER BY id').all();
      for (const row of rows) {
        const meta = JSON.parse(row.metaV2_json);
        assert.equal(meta.chunkId, row.chunk_id);
        assert.equal(meta.file, row.file);
        assert.ok(meta.chunkUid, 'every mode retains its canonical chunk identity');
      }
    } finally { db.close(); }
  }
  const emptyMode = JSON.parse(await fsPromises.readFile(path.join(
    getIndexDir(repoRoot, 'extracted-prose', userConfig), 'pieces', 'sqlite-zero-state.json'), 'utf8'));
  assert.equal(emptyMode.mode, 'extracted-prose');
  assert.equal(emptyMode.chunkCount, 0);
  assert.equal(emptyMode.denseCount, 0);
  assert.equal(path.relative(sqlite.extractedProsePath, emptyMode.outputPath), '');
  assert.equal(fs.existsSync(sqlite.extractedProsePath), false,
    'the empty mode retains its explicit zero-state contract instead of manufacturing a database');
  console.log('default all-mode stage4 builds concrete SQLite modes');
}

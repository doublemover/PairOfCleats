import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';

const base = process.env.PAIROFCLEATS_ARCHIVE_DISCOVERY_TEST_DIR
  || path.resolve('temp/tasks/archive-sqlite-readiness');
await fs.mkdir(base, { recursive: true });
const root = await fs.realpath(await fs.mkdtemp(path.join(base, 'production-no-model-')));
const source = path.join(root, 'artifacts-0001.json');
const bytes = Buffer.from(JSON.stringify([
  ...projectArtifact({ text: 'synthetic cobalt rocket', sourceSha256: 'a'.repeat(64), locator: 'rocket.txt' }),
  ...projectArtifact({ text: 'synthetic quartz garden', sourceSha256: 'b'.repeat(64), locator: 'garden.txt' })
]));
await fs.writeFile(source, bytes);
const options = {
  sources: [{ path: source, sha256: digest(bytes) }],
  indexPath: path.join(root, 'archive.sqlite'),
  embeddings: {
    modelsDir: path.join(root, 'absent-models'), dtype: 'fp32', dimensions: 768,
    batchSize: 8, lookahead: 32,
    sessionOptions: {
      intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
      extra: { 'session.intra_op.allow_spinning': '0', 'session.inter_op.allow_spinning': '0' }
    }
  }
};
const unopened = service => {
  const info = service.embeddingExecutionInfo();
  assert.equal(info.loaded, false);
  assert.equal(info.childPid, null);
  assert.equal(service.embeddingStatus().indexedUnits, 0);
  return info;
};
let firstHit;
const observations = [];
for (let pass = 0; pass < 2; pass++) {
  const service = await createLocalSourceHistoryService(options);
  try {
    assert.equal(service.embeddingStatus().totalUnits, 2);
    const result = await service.search({ query: 'cobalt', mode: 'lexical' });
    assert.equal(result.totalMatches, 1);
    const hit = result.hits[0];
    if (firstHit) {
      assert.equal(hit.sourceRef, firstHit.sourceRef);
      assert.equal(hit.snapshotRef, firstHit.snapshotRef);
    } else firstHit = hit;
    observations.push(unopened(service));
  } finally { await service.dispose(); }
  const db = new Database(options.indexPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM units').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM imports').get().n, 1);
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
    assert.equal(db.prepare('SELECT count(*) AS n FROM history_embedding_units_v2').get().n, 0);
  } finally { db.close(); }
}
assert.deepEqual(await fs.readFile(source), bytes);
await assert.rejects(fs.stat(options.embeddings.modelsDir), { code: 'ENOENT' });
const require = createRequire(import.meta.url);
const packagePath = require.resolve('better-sqlite3/package.json');
const sqlitePackage = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const bindingPath = path.join(path.dirname(packagePath), 'prebuilds', `${process.platform}-${process.arch}.node`);
const receipt = {
  state: 'passed', node: process.version, abi: process.versions.modules,
  sqlitePackage: sqlitePackage.version, packagePath, bindingPath,
  bindingSha256: digest(await fs.readFile(bindingPath)), root, indexPath: options.indexPath,
  checks: ['native production service open/import', 'lexical search', 'close/reopen persistence',
    'idempotent import', 'stable citations', 'SQLite integrity and foreign keys',
    'empty embedding schema', 'no worker or model load', 'source bytes unchanged'],
  observations
};
await fs.writeFile(path.join(root, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));

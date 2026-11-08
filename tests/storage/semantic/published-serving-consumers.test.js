import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { createSemanticFindRunner } from '../../../src/integrations/tooling/semantic-find.js';
import { createSemanticExplainRunner } from '../../../src/integrations/tooling/semantic-explain.js';
import { openSemanticQueryStore } from '../../../src/semantic/query-store.js';
import { ingestSemanticPartition } from '../../../src/storage/sqlite/semantic/ingest.js';
import { CREATE_SEMANTIC_TABLES_SQL } from '../../../src/storage/sqlite/semantic/schema.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';

// Native artifact/SQLite tooling consumer coverage. Run on the supported
// bootstrapped backend; this fixture never substitutes another SQLite engine.
const fixture = await createSemanticServingFixture();
const originalOpen = fs.open;
try {
  const { store, manifest } = await openPublishedSemanticStore({ indexDir: fixture.indexDir,
    repoRoot: fixture.root, generation: fixture.generation, requireQueryIndex: true });
  const dbRoot = path.join(path.dirname(fixture.indexDir), 'index-sqlite');
  await fs.mkdir(dbRoot);
  const db = new Database(path.join(dbRoot, 'index-code.db'));
  try {
    db.pragma('user_version = ' + SCHEMA_VERSION); db.exec(CREATE_SEMANTIC_TABLES_SQL); writeSqliteIndexFormat(db);
    db.exec('BEGIN'); await ingestSemanticPartition({ db, store, descriptor: fixture.partition }); db.exec('COMMIT');
    db.prepare('INSERT INTO index_format_meta(key,value) VALUES (?,?)').run('semanticGeneration', JSON.stringify(fixture.generation));
  } finally { db.close(); }
  const scope = { repoRoot: fixture.root, generation: fixture.generation };
  const requests = {
    detail: { ...scope, refs: [fixture.ref], include: ['operands', 'names', 'ownership'] },
    find: { ...scope, selector: { field: 'astKind', value: 'Identifier' }, limits: { records: 1 } },
    explain: { ...scope, seed: fixture.ref, direction: 'downstream', kinds: ['flowsTo'] }
  };
  const create = { detail: createSemanticDetailRunner, find: createSemanticFindRunner, explain: createSemanticExplainRunner };
  const results = {};
  for (const backend of ['artifact', 'sqlite']) for (const name of ['detail', 'find', 'explain']) {
    if (backend === 'sqlite' && name === 'detail') continue;
    const runner = create[name]();
    const request = { ...requests[name], ...(name === 'detail' ? {} : { backend }) };
    const result = await runner(request, { userConfig: {} });
    assert.deepEqual(result.generation, fixture.generation);
    assert.equal(result.records[0].id, 0);
    results[backend + ':' + name] = result;
    if (name === 'find') {
      assert.ok(result.cursor);
      const next = await runner({ ...request, cursor: result.cursor }, { userConfig: {} });
      assert.equal(next.records[0].id, 1); assert.equal(next.cursor, null);
    }
    for (const metadata of ['semantic_manifest', 'semantic_query_index', 'semantic_operation_index']) {
      const filename = path.join(fixture.indexDir, metadata + '.json');
      const original = fixture.originals.get(metadata), changed = Buffer.from(original); changed[0] = 32;
      await fs.writeFile(filename, changed);
      try { await assert.rejects(runner(request, { userConfig: {} }), { code: 'ERR_SEMANTIC_INTEGRITY' }); }
      finally { await fs.writeFile(filename, original); }
    }
    const controller = new AbortController(); let reads = 0, closes = 0;
    fs.open = async (filename, ...args) => {
      const handle = await originalOpen(filename, ...args), read = handle.read, close = handle.close;
      handle.read = async function (...readArgs) {
        reads++; const value = await read.call(handle, ...readArgs); controller.abort(); return value;
      };
      handle.close = async function () { closes++; return close.call(handle); };
      return handle;
    };
    try { await assert.rejects(runner(request, { userConfig: {}, signal: controller.signal }), { code: 'ABORT_ERR' }); }
    finally { fs.open = originalOpen; }
    assert.equal(reads, 1); assert.equal(closes, 1, 'all tooling consumers cancel inside the first metadata read');
  }
  assert.deepEqual(results['artifact:find'].records, results['sqlite:find'].records);
  assert.deepEqual(results['artifact:explain'].records, results['sqlite:explain'].records);
  // The SQLite opener takes the generation from its admitted family even when
  // a direct caller omits an explicit generation option.
  const inferred = await openSemanticQueryStore({ indexDir: fixture.indexDir, repoRoot: fixture.root, backend: 'sqlite' });
  try { assert.deepEqual(inferred.store.generation, fixture.generation); }
  finally { inferred.close(); }
  assert.deepEqual(manifest.generation, fixture.generation);
} finally { fs.open = originalOpen; await fixture.cleanup(); }
console.log('Direct detail and artifact/SQLite find/explain consume checksum-bound metadata and propagate cancellation.');

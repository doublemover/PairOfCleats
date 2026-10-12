#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSearchPipelineFixture } from '../helpers/search-pipeline-fixture.js';
import { createFilterEnumeration, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';

const db = new Database(':memory:');
try {
  // Deliberately no postings, FTS, minhash or vector tables: enumeration needs
  // indexed metadata only, and must use the same strict predicates as memory.
  db.exec('CREATE TABLE chunks (id INTEGER, mode TEXT, file TEXT, kind TEXT, docmeta TEXT, metaV2_json TEXT, codeRelations TEXT)');
  const insert = db.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let id = 0; id < 22; id += 1) {
    insert.run(id * 2, 'code', `src/${id}.ts`, 'FunctionDeclaration', '{}', JSON.stringify({
      schemaVersion: META_V2_SCHEMA_VERSION, types: { tooling: { returns: [{ type: id % 2 ? 'boolean' : 'Promise<boolean>', source: 'tooling' }] } }
    }), JSON.stringify({ calls: [['owner', 'target']] }));
  }
  const helpers = createSqliteHelpers({ getDb: () => db, postingsConfig: {}, maxCandidates: 1 });
  const idx = helpers.loadIndexFromSqlite('code', { includeDense: false, includeMinhash: false });
  const filters = { returnType: 'boolean', calls: 'target' };
  const ids = [];
  let cursor = null;
  do {
    const enumeration = createFilterEnumeration({ cursor, filters, modes: ['code'], generation: { buildId: 'sqlite-one' } });
    const pipeline = createSearchPipelineFixture({ useSqlite: true, query: '', queryTokens: [], filters, filtersActive: true,
      filterEnumeration: enumeration, topN: 3, sqliteHasTable: helpers.hasTable });
    const code = await pipeline(idx, 'code', null);
    ids.push(...code.map(hit => hit.id));
    assert.ok(code.every(hit => hit.filterEvidence.returnType.facts[0].source === 'tooling'));
    const page = buildFilterPagination(enumeration, { code });
    assert.equal(page.total, 11);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: 11 }, (_, i) => i * 4 + 2));
  console.log('real SQLite metadata filter enumeration test passed');
} finally {
  db.close();
}

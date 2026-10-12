import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createOptionalFtsTables, createFtsInserter, listOptionalFtsTables } from '../../../src/storage/sqlite/fts-variants.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { deleteDocIds } from '../../../src/storage/sqlite/build/delete.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput } from '../../../src/retrieval/query-parse.js';
import { createInMemorySearchPipeline } from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
const db = new Database(':memory:');
db.exec(CREATE_TABLES_BASE_SQL);
assert.deepEqual(listOptionalFtsTables(db), []);
createOptionalFtsTables(db, ['trigram', 'porter']);
const meta = [
  { id: 0, file: 'running.js', name: 'runningIdentifier', tokens: ['running','systems'], phraseTokens: ['running','systems'], docmeta: {doc:'running systems'}, metaV2:{schemaVersion:3}},
  { id: 1, file: 'a.txt', tokens: ['甲中文字乙'], phraseTokens: ['甲中文字乙'], docmeta: {doc:'甲中文字乙'}, metaV2:{schemaVersion:3}},
  { id: 2, file: 'runs.js', tokens: ['other'], phraseTokens: ['other'], docmeta: {doc:'other'}, metaV2:{schemaVersion:3}}
];
const inserts = createInsertStatements(db);
meta.forEach(c => { inserts.insertChunk.run(buildChunkRow(c,'prose',c.id)); inserts.insertFts.run(buildChunkRow(c,'prose',c.id)); });
const helpers = createSqliteHelpers({getDb:()=>db,sqliteFtsWeights:[0,1,1,1,1,1,1,1],postingsConfig:{}});
const ast = query => annotateQueryAst(parseQueryInput(query).ast,new Set(),{}, {enablePhraseNgrams:false});
for (const [query,variant,ids] of [['runs','porter',[0]],['中文字','trigram',[1]],['runs NOT systems','porter',[]],['"runs systems"','porter',[]]]) {
  let execution;
  const hits = helpers.rankSqliteFts({chunkMeta:meta},[], 'prose',1,false,null,{
    ftsVariant:variant, ftsMatch: query.startsWith('"') ? query : query.split(' NOT ')[0],
    queryAst:ast(query), onExecution:value=>{execution=value;}
  });
  assert.deepEqual(hits.map(h=>h.idx),ids,query);
  assert.equal(execution.table,'chunks_fts_'+variant);
}
assert.equal(db.prepare("SELECT count(*) AS n FROM chunks_fts_porter WHERE chunks_fts_porter MATCH 'runningIdentifier'").get().n,0,'Porter must not index identifier fields');
const pipeline = createInMemorySearchPipeline({
  query:'runs', queryTokens:['runs'], topN:1,
  overrides:{annEnabled:false,useSqlite:true,sqliteFtsRequested:true,sqliteHasFts:helpers.hasFtsTable,
    sqliteHasTable:helpers.hasTable,rankSqliteFts:helpers.rankSqliteFts,queryAst:ast('runs'),
    sqliteFtsVariantConfig:{stemming:true}}
});
const hit = (await pipeline({chunkMeta:meta,tokenIndex:{vocab:[],postings:[],docLengths:[2,1,1],avgDocLen:1,totalDocs:3}},'prose',null))[0];
assert.equal(hit?.idx ?? hit?.id,0);
deleteDocIds(db,'prose',[0]);
assert.equal(db.prepare("SELECT count(*) AS n FROM chunks_fts_porter WHERE chunks_fts_porter MATCH 'runs'").get().n,0);
createFtsInserter(db).run(buildChunkRow(meta[0],'prose',0));
assert.equal(db.prepare("SELECT count(*) AS n FROM chunks_fts_porter WHERE chunks_fts_porter MATCH 'runs'").get().n,1);
db.close();
console.log('Actual Porter/trigram tables, native eligibility, exact phrases, identifier isolation, insert and delete passed');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeSqliteShardFixtureArtifacts } from './helpers/build-fixture.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv({testing:'1'});
const parent = process.env.PAIROFCLEATS_FTS_TEST_DIR || path.resolve('temp/tasks/retrieval-fts-tables');
await fs.mkdir(parent,{recursive:true});
const folder = await fs.mkdtemp(path.join(parent,'build-'));
const indexDir=path.join(folder,'artifacts'),outPath=path.join(folder,'prose.db');
await fs.mkdir(indexDir);
const {pieceEntries}=await writeSqliteShardFixtureArtifacts({
  indexDir,chunkCount:3,mode:'prose',tokens:['running','systems'],
  decorateChunk:()=>({phraseTokens:['running','systems'],docmeta:{doc:'running systems 甲中文字乙',signature:'run()'},metaV2:{schemaVersion:3}})
});
await writePiecesManifest(indexDir,pieceEntries);
const pieces=await loadIndexPieces(indexDir,null);
await buildDatabaseFromArtifacts({Database,outPath,index:pieces,indexDir,mode:'prose',
  manifestFiles:null,emitOutput:false,validateMode:'off',vectorConfig:{enabled:false},
  modelConfig:{id:null},buildPragmas:false,optimize:false,ftsVariants:['porter','trigram']});
const verify=()=>{
  const db=new Database(outPath,{readonly:true});
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM chunks_fts_porter WHERE chunks_fts_porter MATCH 'runs'").get().n,3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM chunks_fts_trigram WHERE chunks_fts_trigram MATCH '中文字'").get().n,3);
    for(const row of db.prepare('SELECT phrase_tokens FROM chunks').all())assert.deepEqual(JSON.parse(row.phrase_tokens),['running','systems']);
  }finally{db.close();}
};
verify();
await compactDatabase({dbPath:outPath,mode:'prose',vectorExtension:{enabled:false},keepBackup:true,
  logger:{log(){},warn(){},error(message){throw Error(message);}}});
verify();
console.log('Optional FTS artifact build and compaction preserve tokenizer rows and literal phrase evidence');

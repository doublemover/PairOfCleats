import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {analyzeLiteralText} from '../../../src/shared/text-analyzer.js';
import {parseQueryInput,annotateQueryAst,tokenizePhrase} from '../../../src/retrieval/query-parse.js';
import {createQueryAstHelpers} from '../../../src/retrieval/pipeline/query-ast.js';
import {CREATE_TABLES_BASE_SQL} from '../../../src/storage/sqlite/schema.js';
import {createInsertStatements} from '../../../src/storage/sqlite/build/statements.js';
import {buildChunkRow} from '../../../src/storage/sqlite/build-helpers.js';
import {createSqliteHelpers} from '../../../src/retrieval/sqlite-helpers.js';
import {createInMemorySearchPipeline} from '../pipeline/helpers/in-memory-search-pipeline-fixture.js';
const ast=query=>annotateQueryAst(parseQueryInput(query).ast,new Set(),{}, {enablePhraseNgrams:false});
assert.deepEqual(tokenizePhrase('alpha beta alpha',new Set(),{stemming:true,tokenHook:()=>['extra']}),['alpha','beta','alpha']);
const bodies=['alpha alpha alpha alpha','alpha alpha alpha','alpha alpha','alpha beta','alpha beta gamma delta epsilon','alpha beta alpha','alpha beta gamma'];
const chunkMeta=bodies.map((text,id)=>({id,file:'src/'+id+'.js',ext:'.js',start:0,end:text.length,tokens:analyzeLiteralText(text),phraseTokens:analyzeLiteralText(text),metaV2:{schemaVersion:3},weight:id<3?100:1}));
const vocab=[...new Set(chunkMeta.flatMap(c=>c.tokens))].sort();
const postings=vocab.map(token=>chunkMeta.flatMap(c=>{const tf=c.tokens.filter(t=>t===token).length;return tf?[[c.id,tf]]:[];}));
const tokenIndex={vocab,postings,docLengths:chunkMeta.map(c=>c.tokens.length),avgDocLen:chunkMeta.reduce((n,c)=>n+c.tokens.length,0)/chunkMeta.length,totalDocs:chunkMeta.length};
const db=new Database(':memory:');db.exec(CREATE_TABLES_BASE_SQL);
const statements=createInsertStatements(db);
for(const c of chunkMeta){statements.insertChunk.run(buildChunkRow(c,'code',c.id));statements.insertDocLength.run('code',c.id,c.tokens.length);}
vocab.forEach((token,id)=>{statements.insertTokenVocab.run('code',id,token);for(const [doc,tf] of postings[id])statements.insertTokenPosting.run('code',id,doc,tf);});
statements.insertTokenStats.run('code',tokenIndex.avgDocLen,chunkMeta.length);
const helpers=createSqliteHelpers({getDb:()=>db,postingsConfig:{},sqliteFtsWeights:null});
const loaded=helpers.loadIndexFromSqlite('code',{includeDense:false,includeMinhash:false});
assert.deepEqual(loaded.chunkMeta[5].phraseTokens,['alpha','beta','alpha']);
for(const idx of [{chunkMeta,tokenIndex},loaded]){
  for(const [query,expected] of [['"alpha beta gamma delta epsilon"',[4]],['"alpha beta alpha"',[5]],['"alpha gamma"',[]],['alpha NOT "alpha beta"',[0,1,2]]]){
    const matcher=createQueryAstHelpers({queryAst:ast(query)}).matchesQueryAst;
    assert.deepEqual(idx.chunkMeta.flatMap((c,id)=>matcher(idx,id,c)?[id]:[]),expected,query);
  }
  const pipeline=createInMemorySearchPipeline({query:'alpha AND beta',queryTokens:['alpha','beta'],topN:1,
    overrides:{annEnabled:false,queryAst:ast('alpha AND beta'),...(idx===loaded?{useSqlite:true,sqliteHasTable:helpers.hasTable,getTokenIndexForQuery:helpers.getTokenIndexForQuery}:{})}});
  const hits=await pipeline(idx,'code',null);assert.equal(hits.length,1);
  assert.ok([3,4,5,6].includes(hits[0].idx??hits[0].id));
}
db.close();
console.log('Long/repeated literal phrases, negation and Boolean eligibility before top-N passed on memory and SQLite');

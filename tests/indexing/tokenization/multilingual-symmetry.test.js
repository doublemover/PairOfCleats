#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';
import { tokenizeQueryTerms, tokenizePhrase } from '../../../src/retrieval/query.js';
import { analyzeLiteralText } from '../../../src/shared/text-analyzer.js';
import { splitId, SCORING_ANALYZER_VERSION } from '../../../src/shared/tokenize-identifiers.js';
import { buildTokenizationKey } from '../../../src/index/build/indexer/signatures.js';
import { createInMemorySearchPipeline } from '../../retrieval/pipeline/helpers/in-memory-search-pipeline-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const dict=new Set(['cache','refresh']);
for(const [text,query] of [['café résumé','cafe\u0301'],['Привет мир','Привет'],['مرحبا بالعالم','مرحبا'],['中文缓存刷新','缓存'],['日本語の検索','検索'],['การค้นหาข้อมูล','ข้อมูล']]){
  const tokens=buildTokenSequence({text,mode:'prose',ext:'.md',dictWords:dict,dictConfig:{}}).tokens;
  const queryTokens=tokenizeQueryTerms(query,dict,{});
  assert.ok(queryTokens.length,'Unicode query must not become empty: '+query);
  assert.ok(queryTokens.some(token=>tokens.includes(token)),'query and index share Unicode scoring terms: '+query);
  const vocab=[...new Set(tokens)];
  const idx={chunkMeta:[{id:0,file:'note.md',tokens,weight:1}],tokenIndex:{vocab,postings:vocab.map(token=>[[0,tokens.filter(t=>t===token).length]]),docLengths:[tokens.length],totalDocs:1,avgDocLen:tokens.length}};
  const pipeline=createInMemorySearchPipeline({query,queryTokens,overrides:{annEnabled:false}});
  assert.equal((await pipeline(idx,'prose',null)).length,1,'actual sparse retrieval: '+query);
}
assert.ok(splitId('中文缓存').includes('中文缓存'),'complete Unicode identifier retained');
assert.deepEqual(splitId('getHTTPResponse_cache'),['get','h','t','t','p','response','cache'],'ASCII identifier contract retained');
assert.deepEqual(tokenizePhrase('cafe\u0301 résumé',dict,{}),analyzeLiteralText('café résumé'),'literal normalization is symmetric');
assert.match(SCORING_ANALYZER_VERSION,/icu-/);
assert.notEqual(buildTokenizationKey({},'code'),buildTokenizationKey({},'prose'));
console.log('symmetric multilingual scoring and literal normalization passed');

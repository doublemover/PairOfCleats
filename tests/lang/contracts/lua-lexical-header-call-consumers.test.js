import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { nativeDeclarationOptions } from '../../helpers/native-declaration-acceptance.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeIncrementalBundle,readCachedBundle } from '../../../src/index/build/incremental.js';
import { SEMANTIC_ANALYSIS_VERSIONS,semanticAnalysisPolicyIdentity } from '../../../src/index/semantic/analysis-versions.js';
import { sha1 } from '../../../src/shared/hash.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const text=['function idle(value) return value end','function recur(n) return recur(n-1)','end',
  'function ordinary(n) return work(n)','end','function subsequent(n)',' return work(n)','end',
  'local local_make = function(n) return work(n) end','M.make = function(n) return work(n) end',
  'function M:method(n) return target(n) end','function outer() local function inner() return leaf() end end',
  'function invoked() local function nested() return leaf() end nested() end',
  'function strings() local x="phantom()" -- commented()',' local y=[=[ long_fake() ]=]',' return x end',
  'function anonymous() consume(function() return private_call() end) end',''].join('\n');
const expected=['recur -> recur','ordinary -> work','subsequent -> work','local_make -> work','M.make -> work',
  'M.method -> target','inner -> leaf','nested -> leaf','invoked -> nested','anonymous -> consume'].toSorted();
const edges=fixture=>fixture.relations.calls.map(edge=>edge.join(' -> ')).toSorted();
let fallback;
for(const options of [nativeDeclarationOptions,{treeSitter:{enabled:false}},
  {treeSitter:{enabled:true,allowedLanguages:['python']}}]) {
  const fixture=await prepareRegisteredLanguage({text,ext:'.lua',options});
  assert.deepEqual(edges(fixture),expected);
  for(const [index,chunk] of fixture.chunks.entries()) {
    assert.ok(chunk.chunkUid); assert.equal(fixture.payloads[index].start,chunk.start);
    const expectedOwned=expected.filter(edge=>edge.startsWith(chunk.name+' -> ')).map(edge=>edge.split(' -> '));
    assert.deepEqual(fixture.projected[index].calls??[],expectedOwned,chunk.name+' exact optional-call projection');
    if(options===nativeDeclarationOptions) assert.ok(Array.isArray(chunk.meta.syntaxCalls),'native route cannot silently fall back');
    else {
      assert.equal(fixture.relations.callCoverage,'partial');
      assert.deepEqual(fixture.relations.callCoverageReasons,['lua-lexical-supported-declaration-roles']);
      assert.equal(chunk.meta.headerRangeSource,'lua-lexical-parameter-boundary');
      assert.equal(text[chunk.meta.bodyStart-1],')');
      assert.equal(chunk.meta.luaDeclarationCoverage.state,'partial');
      fallback=fixture;
    }
  }
}
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.callFlow,'53');
const policy={enrichment:{},storage:{},overrides:[]};
assert.notEqual(semanticAnalysisPolicyIdentity(policy),semanticAnalysisPolicyIdentity(policy,{...SEMANTIC_ANALYSIS_VERSIONS,callFlow:'52'}));
const {dir:root}=await prepareIsolatedTestCacheDir('lua-lexical-header-call-consumers');
const abs=path.join(root,'fixture.lua'); await fs.writeFile(abs,text); const stat=await fs.stat(abs);
const bundleDir=path.join(root,'bundles'); await fs.mkdir(bundleDir);
const manifest={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{}};
manifest.files['fixture.lua']=await writeIncrementalBundle({enabled:true,bundleDir,manifest,relKey:'fixture.lua',fileStat:stat,
  fileHash:sha1(text),fileChunks:fallback.payloads,fileRelations:fallback.relations,bundleFormat:'json'});
const {cachedBundle}=await readCachedBundle({enabled:true,repoRoot:root,absPath:abs,relKey:'fixture.lua',fileStat:stat,manifest,bundleDir,bundleFormat:'json'});
assert.deepEqual(cachedBundle.fileRelations.calls.map(edge=>edge.join(' -> ')).toSorted(),expected);
const warm=await prepareRegisteredLanguage({text,ext:'.lua',options:{treeSitter:{enabled:false}}});
assert.deepEqual(edges(warm),expected); assert.deepEqual(warm.payloads,fallback.payloads);
console.log('Lua actual native and explicit lexical routes retain header-line calls, nested owners and durable payload parity.');

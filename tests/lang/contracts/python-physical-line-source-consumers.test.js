import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';
import { buildLineIndex,offsetToLine } from '../../../src/shared/lines.js';
import { isCanonicalChunkUid } from '../../../src/shared/identity.js';
import { buildLineIndex as pythonLineIndex } from '../../../src/lang/python/normalize.js';
import { createPythonByteColumnResolver } from '../../../src/lang/python/byte-columns.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeIncrementalBundle,readCachedBundle } from '../../../src/index/build/incremental.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const lines=['x = "é😀中"','import alpha','@wrap("é😀")','def outer(value):','    def nested():','        return "中😀"',
  '    return nested()','unrelated = 2','from 包 import 模块 as 别名'];
const variants=[['\n'],['\r\n'],['\r'],['\r','\n','\r\n']];
const {dir:root}=await prepareIsolatedTestCacheDir('python-physical-line-source-consumers');
try{
  for(const [variant,endings]of variants.entries())for(const final of [false,true]){
    const source=lines.map((line,index)=>line+(index<lines.length-1||final?endings[index%endings.length]:'')).join('');
    const options={treeSitter:{enabled:false},pythonAst:{enabled:true,workerCount:1,maxWorkers:1,maxRetries:0,taskTimeoutMs:5000}};
    const input={text:source,ext:'.py',relPath:'fixture.py',mode:'code',options};
    const {context}=await buildLanguageContext(input);assert.ok(context.pythonAst,'actual CPython pool JSON route');
    const chunks=smartChunk({...input,context:{...context,treeSitter:options.treeSitter}});
    const outer=chunks.find(c=>c.name==='outer'),nested=chunks.find(c=>c.name==='outer.nested');assert.ok(outer&&nested);
    assert.equal(source.slice(outer.start,outer.end),source.slice(source.indexOf('@wrap'),source.indexOf('unrelated')).trimEnd());
    assert.equal(source.slice(nested.start,nested.end),'def nested():'+endings[4%endings.length]+'        return "中😀"');
    const fileHash=createHash('sha1').update(source).digest('hex'),fileSize=Buffer.byteLength(source);
    const ids=await prepareChunkIds({chunks,text:source,relKey:'fixture.py',containerExt:'.py',containerLanguageId:'python',
      lineIndex:buildLineIndex(source),fileHash,fileHashAlgo:'sha1',vfsManifestConcurrency:1,strict:true});
    const exact=pythonLineIndex(source);
    for(const [index,chunk]of chunks.entries())assert.deepEqual(ids.chunkLineRanges[index],{
      startLine:offsetToLine(exact,chunk.start),endLine:offsetToLine(exact,chunk.end-1)});
    assert.equal(ids.chunkLineRanges[chunks.indexOf(outer)].startLine,3);assert.equal(ids.chunkLineRanges[chunks.indexOf(outer)].endLine,7);
    assert.deepEqual(collectPythonImports(source).imports.toSorted(),['alpha','包']);
    const preparedUids=chunks.map(chunk=>chunk.chunkUid);
    assert.equal(new Set(preparedUids).size,chunks.length);
    const payloads=chunks.map((chunk,index)=>{
      assert.ok(isCanonicalChunkUid(chunk.chunkUid),'the original identity owner mints a canonical UID');
      const tokenized=buildTokenSequence({text:source.slice(chunk.start,chunk.end),mode:'code',ext:'.py',
        dictWords:new Set(),dictConfig:{},includeSeq:true});
      const payload=buildChunkPayload({chunk:{...chunk,...ids.chunkLineRanges[index]},
        rel:'fixture.py',relKey:'fixture.py',ext:'.py',effectiveExt:'.py',languageId:'python',containerLanguageId:'python',
        fileHash,fileHashAlgo:'sha1',fileSize,tokens:tokenized.tokens,tokenIds:[],seq:tokenized.seq,
        codeRelations:{},docmeta:{},stats:{},complexity:null,lint:null,minhashSig:[],commentFieldTokens:[],
        dictWords:new Set(),dictConfig:{},postingsConfig:{},emitFieldTokens:false,tokenMode:'code',
        toolInfo:{tool:'python-source-fixture',version:'1'},gitMeta:{}});
      assert.equal(payload.chunkUid,preparedUids[index]);assert.equal(payload.metaV2.chunkUid,preparedUids[index]);
      assert.equal(payload.fileHash,fileHash);assert.equal(payload.fileHashAlgo,'sha1');assert.equal(payload.fileSize,fileSize);
      assert.equal(payload.metaV2.fileHash,fileHash);assert.equal(payload.metaV2.fileHashAlgo,'sha1');
      assert.deepEqual([payload.start,payload.end,payload.startLine,payload.endLine],
        [chunk.start,chunk.end,ids.chunkLineRanges[index].startLine,ids.chunkLineRanges[index].endLine]);
      assert.equal(source.slice(payload.start,payload.end),source.slice(chunk.start,chunk.end));
      return payload;
    });
    const dir=path.join(root,`v${variant}-${final}`);await fs.mkdir(dir);const abs=path.join(dir,'fixture.py');await fs.writeFile(abs,source);
    const stat=await fs.stat(abs),bundleDir=path.join(dir,'bundles');await fs.mkdir(bundleDir);
    const manifest={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{}};
    manifest.files['fixture.py']=await writeIncrementalBundle({enabled:true,bundleDir,manifest,relKey:'fixture.py',fileStat:stat,
      fileHash,fileChunks:payloads,bundleFormat:'json',fileRelations:{imports:['alpha','包']}});
    assert.ok(manifest.files['fixture.py']?.bundleInventory?.length,'the original immutable publication must succeed');
    assert.equal(manifest.files['fixture.py'].hash,fileHash);assert.equal(manifest.files['fixture.py'].size,fileSize);
    const {cachedBundle}=await readCachedBundle({enabled:true,repoRoot:dir,absPath:abs,relKey:'fixture.py',fileStat:stat,manifest,bundleDir,bundleFormat:'json'});
    assert.ok(cachedBundle);assert.equal(cachedBundle.hash,fileHash);assert.equal(cachedBundle.size,fileSize);
    assert.deepEqual(cachedBundle.chunks,JSON.parse(JSON.stringify(payloads)),'all persisted source/identity fields survive actual bundle admission');
    assert.deepEqual(cachedBundle.chunks.map(chunk=>chunk.chunkUid),preparedUids);
    assert.deepEqual(cachedBundle.chunks.map(chunk=>chunk.metaV2.chunkUid),preparedUids);
    for(const name of ['outer','outer.nested']){
      const original=chunks.find(chunk=>chunk.name===name),restored=cachedBundle.chunks.find(chunk=>chunk.name===name);
      assert.ok(restored);assert.equal(restored.chunkUid,original.chunkUid);
      assert.equal(source.slice(restored.start,restored.end),source.slice(original.start,original.end));
    }
    assert.equal(await fs.readFile(abs,'utf8'),source,'original hashes/spans never reference a normalized copy');
    assert.equal(createHash('sha1').update(await fs.readFile(abs)).digest('hex'),fileHash);
  }
  const text='first\r é😀中\rnext',resolve=createPythonByteColumnResolver(text,pythonLineIndex(text));
  assert.equal(resolve(2,1),text.indexOf('é'));assert.equal(resolve(2,3),text.indexOf('😀'));assert.equal(resolve(2,7),text.indexOf('中'));
  for(const [line,column]of [[2,2],[2,4],[2,99],[0,0],[99,0]])assert.throws(()=>resolve(line,column),RangeError);
}finally{await shutdownPythonAstPool();}
console.log('Python universal physical lines preserve exact native source ranges, strict UTF8 columns, IDs and durable payload labels.');

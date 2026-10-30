import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex,offsetToLine } from '../../../src/shared/lines.js';
import { buildLineIndex as pythonLineIndex } from '../../../src/lang/python/normalize.js';
import { createPythonByteColumnResolver } from '../../../src/lang/python/byte-columns.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { collectPythonImports } from '../../../src/lang/python/imports.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeIncrementalBundle,readCachedBundle } from '../../../src/index/build/incremental.js';
import { assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { sha1 } from '../../../src/shared/hash.js';
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
    const ids=await prepareChunkIds({chunks,text:source,relKey:'fixture.py',containerExt:'.py',containerLanguageId:'python',
      lineIndex:buildLineIndex(source),fileHash:sha1(source),fileHashAlgo:'sha1',vfsManifestConcurrency:1,strict:true});
    const exact=pythonLineIndex(source);
    for(const [index,chunk]of chunks.entries())assert.deepEqual(ids.chunkLineRanges[index],{
      startLine:offsetToLine(exact,chunk.start),endLine:offsetToLine(exact,chunk.end-1)});
    assert.equal(ids.chunkLineRanges[chunks.indexOf(outer)].startLine,3);assert.equal(ids.chunkLineRanges[chunks.indexOf(outer)].endLine,7);
    assert.deepEqual(collectPythonImports(source).imports.toSorted(),['alpha','包']);
    const payloads=chunks.map((chunk,index)=>({...assembleFlowFixture({text:source,chunk,docmeta:{},lang:'python',ext:'.py'}),...ids.chunkLineRanges[index]}));
    const dir=path.join(root,`v${variant}-${final}`);await fs.mkdir(dir);const abs=path.join(dir,'fixture.py');await fs.writeFile(abs,source);
    const stat=await fs.stat(abs),bundleDir=path.join(dir,'bundles');await fs.mkdir(bundleDir);
    const manifest={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,bundleFormat:'json',files:{}};
    manifest.files['fixture.py']=await writeIncrementalBundle({enabled:true,bundleDir,manifest,relKey:'fixture.py',fileStat:stat,
      fileHash:sha1(source),fileChunks:payloads,bundleFormat:'json',fileRelations:{imports:['alpha','包']}});
    const {cachedBundle}=await readCachedBundle({enabled:true,repoRoot:dir,absPath:abs,relKey:'fixture.py',fileStat:stat,manifest,bundleDir,bundleFormat:'json'});
    assert.deepEqual(cachedBundle.chunks.map(c=>[c.start,c.end,c.startLine,c.endLine]),payloads.map(c=>[c.start,c.end,c.startLine,c.endLine]));
    assert.equal(await fs.readFile(abs,'utf8'),source,'original hashes/spans never reference a normalized copy');
  }
  const text='first\r é😀中\rnext',resolve=createPythonByteColumnResolver(text,pythonLineIndex(text));
  assert.equal(resolve(2,1),text.indexOf('é'));assert.equal(resolve(2,3),text.indexOf('😀'));assert.equal(resolve(2,7),text.indexOf('中'));
  for(const [line,column]of [[2,2],[2,4],[2,99],[0,0],[99,0]])assert.throws(()=>resolve(line,column),RangeError);
}finally{await shutdownPythonAstPool();}
console.log('Python universal physical lines preserve exact native source ranges, strict UTF8 columns, IDs and durable payload labels.');

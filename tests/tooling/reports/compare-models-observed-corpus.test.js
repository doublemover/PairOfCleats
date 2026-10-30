import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv,withTemporaryEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { getIndexDir,loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveCompareModelCacheRoot } from '../../../src/experimental/compare/config.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createComparisonCorpusRegistry } from '../../../tools/reports/compare-model-corpus.js';
const selected=process.env.PAIROFCLEATS_TEST_ID?.split('tooling/reports/compare-models-observed-corpus/')[1];
assert.ok(['promotion','between-queries','independent-modes','missing-generation','changed-generation','retired-generation','oversize-generation'].includes(selected));
const {dir}=await prepareIsolatedTestCacheDir('compare-models-observed-corpus-'+selected),repo=path.join(dir,'repo'),
  cacheRootBase=path.join(dir,'models','long-generation-root-'+'x'.repeat(64));
await fs.mkdir(path.join(repo,'src'),{recursive:true});initGitRepo(repo);await fs.writeFile(path.join(repo,'.pairofcleats.json'),'{"threads":1}\n');
const models=['observed-baseline','observed-candidate'],modes=selected==='independent-modes'?['code','prose']:['code'];
const env=applyTestEnv({cacheRoot:cacheRootBase,embeddings:'stub',extraEnv:{PAIROFCLEATS_TRUSTED_CONFIG:null}}),roots=new Map();
for(const model of models) {
  const modelCache=resolveCompareModelCacheRoot({modelId:model,cacheRootBase});
  await withTemporaryEnv({...env,PAIROFCLEATS_CACHE_ROOT:modelCache,PAIROFCLEATS_MODEL:model},async()=>{
    const cache=path.dirname(getIndexDir(repo,'code',loadUserConfig(repo)));roots.set(model,cache);
    for(const generation of ['A','B']) {
      const buildRoot=path.join(cache,'builds',generation);await fs.mkdir(buildRoot,{recursive:true});
      for(const mode of modes) {
        const file=mode==='code'?'src/file.js':'README.md',source=mode==='code'?`export function needle${generation}() {}\n`:`needle ${generation}\n`;
        await fs.writeFile(path.join(repo,file),source);
        const indexDir=await createCompatibilityIndex(buildRoot,{mode,compatibilityKey:'observed-corpus-fixture',profileId:'default',buildId:model+'-'+generation});
        const row={id:0,file,fileHash:createHash('sha1').update(source).digest('hex'),chunkUid:'stable-fixture-uid',name:'needle',
          kind:mode==='code'?'FunctionDeclaration':'Paragraph',start:0,end:source.length,startLine:1,endLine:1,tokens:['needle']};
        await fs.writeFile(path.join(indexDir,'chunk_meta.json'),JSON.stringify([row]));
        await fs.writeFile(path.join(indexDir,'token_postings.json'),JSON.stringify({vocab:['needle'],postings:[[[0,1]]],docLengths:[1],avgDocLen:1,totalDocs:1}));
      }
      // The actual --mode both search also opens extracted prose. Keep that
      // auxiliary cohort explicitly empty, with canonical publication metadata.
      if(modes.length===2) {
        const empty=await createCompatibilityIndex(buildRoot,{mode:'extracted-prose',compatibilityKey:'observed-corpus-fixture',profileId:'default',buildId:model+'-'+generation});
        await fs.writeFile(path.join(empty,'chunk_meta.json'),'[]');
        await fs.writeFile(path.join(empty,'token_postings.json'),JSON.stringify({vocab:[],postings:[],docLengths:[],avgDocLen:0,totalDocs:0}));
      }
      await fs.writeFile(path.join(buildRoot,'build_state.json'),JSON.stringify({artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,schemaVersion:1,
        signatureVersion:2,buildId:model+'-'+generation,configHash:'fixture',profile:{id:'default'},tool:{version:'1'},validation:{ok:true,issueCount:0,warningCount:0,issues:[]}}));
    }
    await fs.writeFile(path.join(cache,'builds/current.json'),JSON.stringify({artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,buildId:model+'-A',buildRoot:'builds/A',
      buildRoots:Object.fromEntries([...modes,...(modes.length===2?['extracted-prose']:[])].map(mode=>[mode,'builds/A']))}));
  });
}
const candidate=roots.get(models[1]),pointer={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,buildId:models[1]+'-B',buildRoot:'builds/B',
  buildRoots:Object.fromEntries([...modes,...(modes.length===2?['extracted-prose']:[])].map(mode=>[mode,mode==='code'?'builds/B':'builds/A']))};
const plan={rootDir:dir,model:models[1],query:selected==='between-queries'?2:1,witness:path.join(dir,'boundary.jsonl'),generationEvidence:path.join(dir,'actual-generations.jsonl')};
if(['promotion','between-queries','independent-modes'].includes(selected))Object.assign(plan,{pointer,pointerPath:path.join(candidate,'builds/current.json')});
if(selected==='missing-generation')plan.omitGeneration='code';
if(selected==='changed-generation')plan.changeGeneration='code';
if(selected==='oversize-generation')plan.oversizeGeneration='code';
if(selected==='retired-generation'){const target=path.join(candidate,'builds/A'),stat=await fs.lstat(target,{bigint:true});plan.retire={path:target,dev:stat.dev.toString(),ino:stat.ino.toString()};}
const planPath=path.join(dir,'plan.json');await fs.writeFile(planPath,JSON.stringify(plan));
const queryCount=selected==='between-queries'?2:1,queries=path.join(dir,'queries.txt'),out=path.join(dir,'report.json');
await fs.writeFile(queries,Array(queryCount).fill('needle').join('\n')+'\n');
const preload=pathToFileURL(path.resolve('tests/helpers/compare-model-publication-hook.js'));preload.searchParams.set('plan',planPath);
const result=await spawnSubprocess(process.execPath,['tools/reports/compare-models.js','--repo',repo,'--cache-root',cacheRootBase,'--models',models.join(','),
  '--baseline',models[0],'--mode',modes.length===2?'both':'code','--backend','memory','--no-ann','--stub-embeddings','--queries',queries,
  '--top','1','--limit',String(queryCount),'--out',out,'--json'],{env:{...env,NODE_OPTIONS:(env.NODE_OPTIONS?env.NODE_OPTIONS+' ':'')+'--import="'+preload.href+'"'},
  timeoutMs:30000,maxOutputBytes:1024*1024,captureStdout:true,captureStderr:true,rejectOnNonZeroExit:false});
await fs.writeFile(path.join(dir,'command-receipt.json'),JSON.stringify(result,null,2));assert.equal(result.exitCode,0,result.stderr);
const report=JSON.parse(await fs.readFile(out,'utf8')),events=(await fs.readFile(plan.witness,'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(events.length,1,'the actual child boundary must execute exactly once');assert.equal(report.schemaVersion,3);
const actualGenerations=(await fs.readFile(plan.generationEvidence,'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(actualGenerations.length,models.length*queryCount);
for(const evidence of Object.values(report.executionEvidence)) {
  assert.ok(evidence.retainedBytes>0&&evidence.retainedBytes<=512*1024);
  for(const row of evidence.receipts)assert.ok(Buffer.byteLength(JSON.stringify(row.receipt))<=8192,
    'long-key admission retains the original per-receipt byte cap');
}
for(const row of report.corpusEvidence[models[0]].rows) {
  const raw=actualGenerations.find(observation=>observation.model===models[0]).generations[row.mode];
  assert.ok(raw.generationKey.length>512&&raw.generationKey.length<=4096,'actual canonical long-root key discriminates former512 truncation');
  assert.equal(row.generation.generationKey,raw.generationKey,'retain the exact independently captured child identity');
}
for(const [index,row]of report.results.entries()) {
  const comparison=row.comparisons[models[1]].code,changed=selected!=='between-queries'||index===1;
  assert.equal(row.runs[models[0]].codeCount,1);assert.equal(row.runs[models[1]].codeCount,1);
  assert.equal(comparison.comparable,!changed);
  if(changed)for(const field of ['overlap','avgDelta','rankCorr','top1Same'])assert.equal(comparison[field],null);
  else assert.equal(comparison.overlap,1);
  if(['promotion','between-queries','independent-modes'].includes(selected)&&changed) {
    assert.equal(report.corpusEvidence[models[0]].rows[comparison.baseCorpus.ref].generation.buildId,models[0]+'-A');
    assert.equal(report.corpusEvidence[models[1]].rows[comparison.otherCorpus.ref].generation.buildId,models[1]+'-B');
    assert.notEqual(comparison.baseCorpus.digest,comparison.otherCorpus.digest);
  }
  if(!changed)assert.notEqual(report.corpusEvidence[models[0]].rows[comparison.baseCorpus.ref].generation.buildId,
    report.corpusEvidence[models[1]].rows[comparison.otherCorpus.ref].generation.buildId,
    'same source stays comparable across independently named model builds');
  if(selected==='independent-modes')assert.equal(row.comparisons[models[1]].prose.comparable,true,'independent unchanged prose root remains comparable');
  if(selected==='oversize-generation') {
    assert.equal(comparison.otherCorpus.ref,null);assert.equal(comparison.otherCorpus.reason,'actual-generation-unavailable');
    assert.equal(report.executionEvidence[models[1]].receipts[0].receipt.generations.code.generationKey,null,
      'oversized observed identity is declined instead of truncated or fabricated');
  }
}
const summary=report.summary.comparisons[models[1]].code;assert.equal(summary.requestedQueries,queryCount);
assert.equal(summary.comparableQueries,selected==='between-queries'?1:0);assert.equal(summary.unavailableQueries,1);
if(selected!=='between-queries')assert.equal(summary.overlapAvg,null);
assert.equal(report.corpusEvidence[models[0]].corpusReads,modes.length,'unchanged actual generations are read once across queries');
assert.equal(report.corpusEvidence[models[1]].corpusReads,['missing-generation','changed-generation','retired-generation','oversize-generation'].includes(selected)?0
  :selected==='between-queries'?2:modes.length,'source reads are per actual distinct admitted generation');
assert.ok(report.results.every(row=>row.runs[models[0]].corpus.code.ref===0));
if(selected==='between-queries') {
  const bounded=createComparisonCorpusRegistry({maxEntries:1}),observed=report.corpusEvidence[models[0]].rows[0];
  assert.equal((await bounded.observe({generation:observed.generation,mode:'code',repoCacheRoot:roots.get(models[0])})).comparable,true);
  const refused=await bounded.observe({generation:report.corpusEvidence[models[1]].rows[1].generation,mode:'code',repoCacheRoot:candidate});
  assert.equal(refused.comparable,false);assert.equal(refused.reason,'actual-corpus-retention-limit');assert.equal(bounded.snapshot().corpusReads,1);
}
console.log('Actual comparison '+selected+' binds source cohorts to each real child generation with explicit null denominators.');

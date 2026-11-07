import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const assert=(await import('node:assert/strict')).default;
const fs=await import('node:fs/promises');
const {performance}=await import('node:perf_hooks');
const {prepareIsolatedTestCacheDir}=await import('../../helpers/test-cache.js');
const {ensureTestingEnv}=await import('../../helpers/test-env.js');
const {seedFixtureHealthWork,healthDigest}=await import('../../helpers/fixture-health-work-fixture.js');
const {readFixtureHealthSnapshot}=await import('../../helpers/fixture-health-snapshot.js');
const {readUnfusedHealthReference}=await import('./unfused-reference.js');
const {observeValidationReads}=await import('../../helpers/validation-read-observation.js');
ensureTestingEnv(process.env);
const [scope,arm,trial]=process.argv.slice(2);
assert.ok(['small','code','three','warm'].includes(scope));assert.ok(['snapshot','reference'].includes(arm));assert.ok(['1','2','3'].includes(trial));
assert.equal(typeof global.gc,'function');
const {dir}=await prepareIsolatedTestCacheDir('fixture-health-work-'+scope+'-'+arm+'-'+trial);
const project=value=>({modes:value.modes,authorityByMode:value.authorityByMode,compatibility:value.compatibility});
let observation;
try{
  const fixture=await seedFixtureHealthWork(dir,{modes:scope==='three'?['code','prose','extracted-prose']:['code'],
    rows:scope==='small'?16:512,paddingBytes:scope==='small'?128:2048});
  let prior=null;
  if(scope==='warm'){
    prior=await readUnfusedHealthReference(fixture);
    assert.deepEqual(project(await readFixtureHealthSnapshot(fixture)),project(prior));
  }
  const invoke=()=>arm==='snapshot'?readFixtureHealthSnapshot(fixture):readUnfusedHealthReference({...fixture,prior});
  global.gc();global.gc();observation=observeValidationReads(dir);
  const memoryBefore=process.memoryUsage(),cpuBefore=process.cpuUsage(),started=performance.now();
  const repetitions=scope==='warm'?3:1;let result;
  for(let index=0;index<repetitions;index++)result=await invoke();
  const wallMs=performance.now()-started,cpuMicroseconds=process.cpuUsage(cpuBefore),memoryAfter=process.memoryUsage(),maxRssKiB=process.resourceUsage().maxRSS;
  observation.stop();
  const control=arm==='snapshot'?await readUnfusedHealthReference(fixture):await readFixtureHealthSnapshot(fixture);
  assert.equal(result.compatibility.compatible,true,JSON.stringify(result));assert.deepEqual(project(result),project(control));
  if(arm==='snapshot')for(const row of fixture.inventory){
    const work=observation.metrics.files[row.path];assert.equal(work.opens,repetitions,row.path);assert.equal(work.bytesRead,row.bytes*repetitions,row.path);
  }
  const decisions=Object.fromEntries(Object.entries(result.modes).map(([mode,value])=>{
    assert.equal(value.authority,result.authorityByMode[mode]);assert.match(value.authority,/^[a-f0-9]{64}$/);
    const {authority,...flags}=value;return [mode,flags];
  }));
  global.gc();
  console.log(JSON.stringify({measurement:'fixture-health-verified-snapshot-work',scope,arm,trial:Number(trial),
    node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch,
    inputDigest:fixture.inputDigest,decisionDigest:healthDigest(JSON.stringify({decisions,compatibility:result.compatibility})),
    completeSameRootAuthorityAndDecisionParity:true,authorityByMode:result.authorityByMode,decisions,
    inventory:fixture.inventory,repetitions,work:observation.metrics,wallMs,cpuMicroseconds,memoryBefore,memoryAfter,
    memoryAfterCollection:process.memoryUsage(),maxRssKiB,
    cacheState:'Fresh process and generated page-cache-warm bytes. Small/code/three measure the first evaluation; warm verifies current bytes on three evaluations after an independently verified warm stamp.',
    scopeLimit:'Current-contract unfused consumption control,not an old executable checkout. Full same-root authority matches; cross-process decision digest omits only authority digests that explicitly include the canonical root. Heap sampled; RSS includes preparation and any warmup. Fixture build time excluded.'}));
}finally{observation?.stop();await fs.rm(dir,{recursive:true,force:true});}

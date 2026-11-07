import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import { seedFixtureHealthWork } from '../../helpers/fixture-health-work-fixture.js';
import { readFixtureHealthSnapshot } from '../../helpers/fixture-health-snapshot.js';
import { readUnfusedHealthReference } from '../../fixtures/health/unfused-reference.js';
import { observeValidationReads } from '../../helpers/validation-read-observation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv(process.env);
const cases=JSON.parse(await fs.readFile(new URL('./health-snapshot-parity.test.js.cases.json',import.meta.url))).cases;
const selected=process.env.PAIROFCLEATS_TEST_ID?.split('indexing/fixtures/health-snapshot-parity/')[1];
assert.ok(cases.includes(selected));
const {dir}=await prepareIsolatedTestCacheDir('health-snapshot-parity-'+selected);
const originalLstat=sync.lstatSync;
let observer;
const project=value=>({modes:value.modes,authorityByMode:value.authorityByMode,compatibility:value.compatibility});
try {
  const layout=selected.split('-')[0], modes=selected.endsWith('-three')||selected==='mixed-compatibility'?['code','prose','extracted-prose']
    :selected==='json-records'?['records']:selected==='gzip-prose'?['prose']:['code'];
  const fixture=await seedFixtureHealthWork(dir,{modes,layout:['json','jsonl','sharded','gzip'].includes(layout)?layout:'json',empty:selected.startsWith('empty-')});
  const code=fixture.modeDirs.code;
  if(selected==='mixed-compatibility'){
    const file=path.join(fixture.modeDirs.prose,'pieces/manifest.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));
    manifest.compatibilityKey='different-generation-contract';await fs.writeFile(file,JSON.stringify(manifest));
  }
  if(['missing-dialect','missing-uid','missing-risk'].includes(selected)){
    const file=path.join(code,'chunk_meta.json'), rows=JSON.parse(await fs.readFile(file,'utf8'));
    if(selected==='missing-dialect')delete rows[0].docmeta.dialect;
    if(selected==='missing-uid')delete rows[0].chunkUid;
    if(selected==='missing-risk')for(const row of rows)delete row.docmeta.risk;
    await fs.writeFile(file,JSON.stringify(rows));
  }
  if(selected==='bad-watch'){
    const file=path.join(code,'risk_flows.json'),rows=JSON.parse(await fs.readFile(file,'utf8'));rows[0].path.watchByStep=[];await fs.writeFile(file,JSON.stringify(rows));
  }
  if(selected==='linked-piece')sync.lstatSync=function(file,...args){
    const stat=originalLstat.call(this,file,...args);
    return path.resolve(file)===path.join(code,'chunk_meta.json')?new Proxy(stat,{get(target,key){return key==='isSymbolicLink'?()=>true:Reflect.get(target,key);}}):stat;
  };
  observer=observeValidationReads(dir);
  const metrics={}, first=await readFixtureHealthSnapshot({...fixture,metrics});observer.stop();
  if(selected==='linked-piece'){
    assert.equal(first.compatibility.compatible,false);assert.equal(first.authorityByMode.code,null);
  } else {
    const reference=await readUnfusedHealthReference(fixture);assert.deepEqual(project(first),project(reference));
    assert.equal(first.compatibility.compatible,selected!=='mixed-compatibility',JSON.stringify(first));
    for(const row of fixture.inventory){const work=observer.metrics.files[row.path];assert.equal(work.opens,1,row.path);assert.equal(work.bytesRead,(await fs.stat(path.join(dir,row.path))).size,row.path);}
    assert.equal(metrics.chunkRows||0,fixture.rowsPerMode*modes.length,'one decoded traversal feeds all health projections');
    const warm=await readFixtureHealthSnapshot(fixture);assert.deepEqual(project(warm),project(first));assert.ok(warm.metrics.verifiedBytes>0);
    if(selected==='missing-dialect')assert.equal(first.modes.code.missingSqlDialects,true);
    if(selected==='missing-uid')assert.equal(first.modes.code.hasChunkUids,false);
    if(selected==='missing-risk')assert.equal(first.modes.code.hasRiskTags,false);
    if(selected==='bad-watch')assert.equal(first.modes.code.hasRiskWatchByStep,false);
    if(selected.startsWith('empty-'))assert.equal(first.modes.code.hasChunkUids,false);
    if(selected==='same-stat-replacement'){
      const file=path.join(code,'chunk_meta.json'),before=await fs.stat(file),text=await fs.readFile(file,'utf8');
      await fs.writeFile(file,text.replace('source.js','edited.js'));await fs.utimes(file,before.atime,before.mtime);
      assert.equal((await fs.stat(file)).size,before.size);
      const changed=await readFixtureHealthSnapshot(fixture),control=await readUnfusedHealthReference(fixture);
      assert.deepEqual(project(changed),project(control));assert.notEqual(changed.authorityByMode.code,first.authorityByMode.code);
    }
  }
  console.log(JSON.stringify({case:selected,health:first.compatibility.compatible,reads:observer.metrics,metrics}));
}finally{observer?.stop();sync.lstatSync=originalLstat;await fs.rm(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createFixtureHealthLifecycleObservation} from '../../helpers/fixture-health-lifecycle-observation.js';
import {resolveArtifactPresence} from '../../../src/shared/artifact-io.js';
import {getRepoCacheRoot} from '../../../src/shared/dict-utils.js';
import {applyTestEnv} from '../../helpers/test-env.js';
import {createFastIndexingTestConfig} from '../../helpers/fast-indexing-config.js';
applyTestEnv();
const probe=createFixtureHealthLifecycleObservation();
try{
  const {ensureFixtureIndex}=await probe.load();
  const options={fixtureName:'risk-interprocedural/js-simple',cacheName:'health-lock-isolation-'+process.pid,cacheScope:'isolated',
    requiredModes:['code'],requireRiskTags:true,envOverrides:{PAIROFCLEATS_TEST_CONFIG:JSON.stringify(createFastIndexingTestConfig())}};
  const initial=await ensureFixtureIndex(options),baseline=probe.state.snapshots.at(-1);
  assert.equal(baseline.compatibility.compatible,true);assert.equal(baseline.modes.code.hasRiskTags,true);assert.equal(baseline.modes.code.hasRiskWatchByStep,true);
  const stampPath=path.join(getRepoCacheRoot(initial.fixtureRoot,initial.userConfig),'.fixture-health.json');
  const stampBytes=await fs.readFile(stampPath),stamp=JSON.parse(stampBytes);
  assert.deepEqual(stamp.authorityByMode,baseline.authorityByMode);
  assert.equal(stamp.hasRiskTags,true);assert.equal(stamp.hasRiskWatchByStep,true);assert.equal(stamp.hasSqlDialectMetadata,true);
  const countBeforeWarm=probe.state.snapshots.length,warm=await ensureFixtureIndex(options);
  assert.equal(warm.codeDir,initial.codeDir);assert.equal(probe.state.snapshots.length,countBeforeWarm+1);
  assert.deepEqual(await fs.readFile(stampPath),stampBytes,'verified warm admission retains the exact valid stamp');
  const warmSnapshot=probe.state.snapshots.at(-1);assert.ok(warmSnapshot.metrics.verifiedBytes>0);
  const target=resolveArtifactPresence(initial.codeDir,'chunk_meta',{strict:true}).paths[0];
  const bytes=await fs.readFile(target),stat=await fs.stat(target);
  await fs.writeFile(target,Buffer.alloc(bytes.length,32));await fs.utimes(target,stat.atime,stat.mtime);
  const firstLocked=probe.state.locks,countBeforeRepair=probe.state.snapshots.length;
  probe.state.beforeLocked=async lockDir=>{
    assert.ok(lockDir.startsWith(path.join(initial.cacheRoot,'.fixture-locks')));
    assert.equal(probe.state.snapshots.at(-1).compatibility.compatible,false,'the outside-lock evaluation observes the damaged generation');
    // Model a different lock holder completing repair before this callback.
    // The actual original lock owner runs; only test-owned bytes are restored.
    await fs.writeFile(target,bytes);await fs.utimes(target,stat.atime,stat.mtime);
  };
  const repaired=await ensureFixtureIndex(options);
  assert.equal(probe.state.locks,firstLocked+1);assert.equal(probe.state.snapshots.length,countBeforeRepair+2);
  const [outside,inside]=probe.state.snapshots.slice(-2);
  assert.notEqual(outside,inside);assert.notEqual(outside.metrics,inside.metrics);
  assert.equal(outside.authorityByMode.code,null);assert.deepEqual(inside.authorityByMode,baseline.authorityByMode);
  assert.ok(inside.metrics.verifiedBytes>0);assert.ok(Object.values(inside.metrics.readsByPath).every(count=>count===1));
  assert.deepEqual(await fs.readFile(stampPath),stampBytes,'independent inside-lock verification admits the original exact content stamp');
  assert.equal(repaired.codeDir,initial.codeDir,'a fresh inside-lock evaluation sees the repair and avoids another build');
  console.log(JSON.stringify({independentOutsideInsideSnapshots:true,realCooperativeLock:true,reusedHealthyGeneration:true,
    outside:outside.compatibility,inside:inside.compatibility,insideMetrics:inside.metrics,warmMetrics:warmSnapshot.metrics}));
}finally{probe.close();}

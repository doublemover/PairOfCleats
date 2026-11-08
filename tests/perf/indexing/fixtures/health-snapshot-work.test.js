import assert from 'node:assert/strict';
import {runNode} from '../../../helpers/run-node.js';
const selected=process.env.PAIROFCLEATS_TEST_ID?.split('perf/indexing/fixtures/health-snapshot-work/')[1];
const [,scope,arm]=selected?.match(/^(small|code|three|warm)-(snapshot|reference)$/)||[];
assert.ok(scope&&arm);
for(const trial of [1,2,3]){
  const child=runNode(['--expose-gc','tests/fixtures/health/snapshot-work-child.js',scope,arm,String(trial)],
    'bounded fixture-health work',process.cwd(),process.env,{stdio:'pipe',allowFailure:true,timeoutMs:8000,maxOutputBytes:128*1024});
  console.log(child.stdout.trim());assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
  const sample=JSON.parse(child.stdout);assert.equal(sample.scope,scope);assert.equal(sample.arm,arm);assert.equal(sample.trial,trial);
  assert.match(sample.inputDigest,/^[a-f0-9]{64}$/);assert.match(sample.decisionDigest,/^[a-f0-9]{64}$/);
}

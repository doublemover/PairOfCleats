import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { makeTempDir } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';

const env = applyTestEnv(), root = await makeTempDir('scheduler-terminal-handoff-');
const schedulerUrl = new URL('../../../src/shared/concurrency/scheduler-core.js', import.meta.url).href;
const mutationUrl = new URL('../../../tools/setup/checkout-mutation.js', import.meta.url).href;
const lockPath = path.join(root, CHECKOUT_MUTATION_LOCK);
const source = `import assert from 'node:assert/strict';
import {createBuildScheduler} from ${JSON.stringify(schedulerUrl)};
import {withCheckoutMutation} from ${JSON.stringify(mutationUrl)};
let scheduler;
const original=Object.assign(new Error('fixture original resource remains unretired'),{
  cacheOwnershipPending:true,cacheOwnershipReleased:()=>false
});
const failure=await withCheckoutMutation(${JSON.stringify(root)},async()=>{
  scheduler=createBuildScheduler({cpuTokens:1,ioTokens:1,memoryTokens:1});
  scheduler.registerQueue('owner',{priority:1});
  const rejected=await scheduler.schedule('owner',{cpu:1},async()=>{throw original;}).catch(error=>error);
  assert.equal(rejected.cacheOwnershipReleased(),false);
  await scheduler.shutdown({awaitRunning:true,timeoutMs:5});
}).catch(error=>error);
assert.equal(failure.cacheOwnershipReleased(),false);
assert.equal(scheduler.stats().runningTasks,1);
console.log(JSON.stringify({terminal:'retained',running:1,originalRetired:false}));
// Natural process exit: no process.exit(), no native child and no resource is
// fabricated as retired. Only the terminal polling waiter must stop pinning it.
`;
try {
  const result = runNode(['--input-type=module', '--eval', source], 'scheduler terminal waiter handoff', process.cwd(), env,
    { stdio: 'pipe', timeoutMs: 3000, allowFailure: true });
  assert.equal(result.error, undefined, 'a terminal observer cannot keep an otherwise finished process alive');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { terminal: 'retained', running: 1, originalRetired: false });
  assert.equal((await fs.stat(lockPath)).isFile(), true, 'natural host exit leaves the unresolved original owner record intact');
  await assert.rejects(withCheckoutMutation(root, () => assert.fail('dead PID authorized successor work')),
    { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Terminal scheduler waiters stop pinning the host without releasing original resources or metadata');

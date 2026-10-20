import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';

ensureTestingEnv(process.env);
const session = createSupervisorSession();
let pid;
try {
  await session.waitForEvent(row => row.event === 'hello');
  session.send({ op: 'job:run', jobId: 'owned-active', command: process.execPath,
    args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 5000 });
  pid = (await session.waitForEvent(row => row.event === 'job:spawn' && row.jobId === 'owned-active')).pid;
  session.send({ op: 'job:run', jobId: 'owned-active', argv: ['search', '--help'] });
  await session.waitForEvent(row => row.event === 'log' && row.level === 'error'
    && String(row.message).includes('job already exists'));
  assert.equal(session.events.some(row => row.event === 'job:end' && row.jobId === 'owned-active'), false,
    'rejecting a duplicate must not falsely finalize the still-running original');
  assert.equal(isProcessAlive(pid), true);
  session.send({ op: 'job:cancel', jobId: 'owned-active' });
  const end = await session.waitForEvent(row => row.event === 'job:end' && row.jobId === 'owned-active');
  assert.equal(end.status, 'cancelled'); assert.equal(end.exitCode, 130);
  assert.equal(session.events.filter(row => row.event === 'job:start' && row.jobId === 'owned-active').length, 1);
  assert.equal(session.events.filter(row => row.event === 'job:end' && row.jobId === 'owned-active').length, 1);
  assert.equal(await session.shutdown(), 0);
  assert.equal(isProcessAlive(pid), false);
} finally {
  if (pid && isProcessAlive(pid)) await killProcessTree(pid);
  session.forceKill();
}
console.log('Duplicate admission preserves ownership and cancellation of the actual running job');

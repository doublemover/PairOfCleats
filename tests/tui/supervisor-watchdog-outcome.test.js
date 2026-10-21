import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';

ensureTestingEnv(process.env);
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
const jobId = 'watchdog-outcome';
try {
  await session.waitForEvent(event => event.event === 'hello');
  session.send({ op: 'job:run', jobId, command: process.execPath,
    args: ['-e', "process.stdout.write('{');setInterval(()=>{},1000);"],
    resultPolicy: { captureStdout: 'json', maxBytes: 128 },
    watchdog: { hardTimeoutMs: 1000, heartbeatMs: 0, softKickMs: 0 } });
  const child = await session.waitForEvent(event => event.event === 'job:spawn' && event.jobId === jobId);
  const end = await session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'cancelled', 'retain the watchdog owner\'s existing terminal status');
  assert.equal(end.error.code, 'watchdog_timeout');
  assert.equal(end.cancelReason, 'watchdog_timeout');
  assert.equal(end.resultState, 'incomplete');
  assert.equal(end.result, null);
  assert.ok(end.resultCapture.observedBytes > 0);
  assert.equal(end.attempts, 1); assert.equal(end.retries, 0);
  assert.equal(end.timedOut, true);
  assert.equal(end.terminationReason, 'timeout');
  assert.equal(isProcessAlive(child.pid), false, 'the actual idle child is reaped');
  const warnings = session.events.filter(event => event.event === 'log' && event.level === 'warn');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].watchdogPhase, 'hard-timeout');
  assert.match(warnings[0].message, /^watchdog timeout \(1000ms inactivity\)$/);
  assert.ok(session.events.some(event => event.event === 'job:watchdog' && event.phase === 'hard-timeout'));
  assert.equal(await session.shutdown(), 0);
} finally {
  if (session.child.exitCode === null) { session.forceKill(); await session.waitForExit(); }
}
console.log('Watchdog timeouts retain cancellation status, actual timeout cause, partial-capture state and reaping');

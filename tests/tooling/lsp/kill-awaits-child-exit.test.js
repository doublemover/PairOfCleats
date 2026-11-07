import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';

// Deliver real child exits explicitly: successful signal delivery must not stand
// in for the child handle's exit. A replacement cannot adopt unsettled resources;
// duplicate stale exit delivery must still leave a settled replacement intact.
const children = [];
const events = [];
const client = createLspClient({
  cmd: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  onLifecycleEvent: event => events.push(event),
  spawnProcess: ({ cmd, args, options }) => {
    const child = spawn(cmd, args, options);
    const facade = Object.assign(new EventEmitter(), {
      pid: child.pid, stdin: child.stdin, stdout: child.stdout, stderr: child.stderr,
      exitCode: null, signalCode: null, killed: false,
      unref: () => child.unref()
    });
    const exited = once(child, 'exit');
    const entry = { child, facade, exited, release: async () => {
      const [code, signal] = await exited;
      if (facade.exitCode !== null || facade.signalCode !== null) return;
      facade.exitCode = code;
      facade.signalCode = signal;
      facade.emit('exit', code, signal);
      facade.emit('close', code, signal);
    } };
    children.push(entry);
    return facade;
  }
});
const flush = () => new Promise(resolve => setImmediate(resolve));
let killing, concurrentKill, replacementKill;
const deadline = setTimeout(() => { throw new Error('Owned LSP exit controls did not finish within 10s'); }, 10000);
try {
  client.start();
  await once(children[0].child, 'spawn');
  let settled = false, concurrentSettled = false;
  killing = Promise.resolve(client.kill()).then(() => { settled = true; });
  concurrentKill = Promise.resolve(client.kill()).then(() => { concurrentSettled = true; });
  assert.throws(() => client.start(), { code: 'ERR_LSP_RESTART_STALE_PROCESS' });
  await children[0].exited;
  await flush();
  assert.equal(settled, false, 'kill must await the owned child exit notification');
  assert.equal(concurrentSettled, false, 'concurrent kill must join pending cleanup');
  assert.equal(getTrackedSubprocessCount(), 1, 'the exiting child must remain tracked');
  await children[0].release();
  await Promise.all([killing, concurrentKill]);
  assert.equal(getTrackedSubprocessCount(), 0, 'observed exit releases its original registration');
  assert.ok(events.some(event => event.kind === 'exit' && event.pid === children[0].child.pid));
  const replacement = client.start();
  await once(children[1].child, 'spawn');
  children[0].facade.emit('exit', children[0].facade.exitCode, children[0].facade.signalCode);
  children[0].facade.emit('close', children[0].facade.exitCode, children[0].facade.signalCode);
  assert.equal(client.start(), replacement, 'late exit must preserve the replacement generation');
  assert.equal(client.isTransportRunning(), true);
  replacementKill = client.kill();
  await children[1].release();
  await replacementKill;
  assert.equal(getTrackedSubprocessCount(), 0);

  client.start();
  const delayed = children[2];
  await once(delayed.child, 'spawn');
  const boundedKill = client.kill();
  await delayed.exited;
  const outcome = await boundedKill;
  assert.equal(outcome.exitObserved, false, 'a bounded wait cannot claim an unobserved exit');
  assert.equal(outcome.terminated, false);
  assert.equal(getTrackedSubprocessCount(), 1, 'unobserved cleanup must retain process ownership');
  assert.ok(events.some(event => event.kind === 'kill_diagnostics'
    && event.reason === 'explicit_kill' && event.pid === delayed.child.pid && event.terminated === false));
  await delayed.release();
  assert.equal(getTrackedSubprocessCount(), 0, 'a later observed exit must still release ownership');
} finally {
  for (const entry of children) {
    entry.child.ref();
    if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL');
    await entry.release();
  }
  await Promise.all([killing, concurrentKill, replacementKill, client.kill()]);
  clearTimeout(deadline);
}
console.log('LSP kill awaits observed exit without damaging a replacement generation');

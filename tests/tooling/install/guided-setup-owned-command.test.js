// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import { runSetupCommand } from '../../../tools/setup/owned-command.js';

const controller = new AbortController();
let finish;
let started = false;
const loading = runSetupCommand('fixture-child', ['fixture-argument'], { cwd: process.cwd(), signal: controller.signal,
  stdio: 'pipe', encoding: 'utf8' }, { spawn: async (_command, _args, options) => {
  started = true;
  assert.equal(options.signal, controller.signal);
  assert.equal(options.maxOutputBytes, 1024 * 1024);
  assert.equal(options.rejectOnNonZeroExit, false);
  return new Promise(resolve => { finish = resolve; });
} });
assert.equal(started, true);
let ticked = false;
await new Promise(resolve => setImmediate(() => { ticked = true; resolve(); }));
assert.equal(ticked, true, 'guided setup does not block its event loop while the existing child owner runs');
finish({ exitCode: 0, signal: null, stdout: 'fixture result', stderr: '' });
assert.deepEqual(await loading, { ok: true, status: 0, signal: null, stdout: 'fixture result', stderr: '' });
const pending = Object.assign(new Error('fixture actual child teardown remains pending'), { cacheOwnershipPending: true });
await assert.rejects(runSetupCommand('fixture-child', [], {}, { spawn: async () => { throw pending; } }), error => error === pending,
  'pending child ownership is never flattened to a failed step that allows another setup stage');
controller.abort(new Error('fixture already interrupted'));
let cancelledSpawns = 0;
await assert.rejects(runSetupCommand('fixture-child', [], { signal: controller.signal }, {
  spawn: async () => { cancelledSpawns++; }
}), /fixture already interrupted/);
assert.equal(cancelledSpawns, 0);
const streaming = [];
await runSetupCommand('fixture-child', [], { captureStdout: false, captureStderr: false,
  onStdout: chunk => streaming.push(chunk) }, { spawn: async (_command, _args, options) => {
  assert.equal(options.captureStdout, false, 'stream-only setup children do not retain unbounded output');
  assert.equal(options.captureStderr, false);
  options.onStdout('inert progress');
  return { exitCode: 0 };
} });
assert.deepEqual(streaming, ['inert progress']);
console.log('Guided setup uses responsive async child ownership and preserves pending cancellation errors.');

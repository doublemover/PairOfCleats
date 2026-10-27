import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { registerHooks } from 'node:module';

const tick = () => new Promise(resolve => setImmediate(resolve));
const state = { workers: [], kills: 0, probes: 0, registered: 0, kill: null, probe: null };
const key = Symbol.for('poc.test.python-retirement');
globalThis[key] = state;
const access = 'const state = globalThis[Symbol.for("poc.test.python-retirement")];';
state.spawn = () => {
  const proc = new EventEmitter();
  Object.assign(proc, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  proc.stdin.on('data', chunk => { proc.lastRequest = JSON.parse(String(chunk)); });
  state.workers.push(proc);
  return proc;
};
const close = proc => { proc.emit('close', 0, null); proc.stdin.destroy(); proc.stdout.destroy(); proc.stderr.destroy(); };
const answer = proc => proc.stdout.write(JSON.stringify({ id: proc.lastRequest.id, result: { defs: [{ name: 'fixture' }] } }) + '\n');
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/lang/python/pool.js')) {
      const names = { 'node:child_process': 'spawn', './executable.js': 'executable',
        '../../shared/kill-tree.js': 'kill', '../../shared/subprocess/tracking-register.js': 'tracking' };
      if (names[specifier]) return { url: 'python-retirement:' + names[specifier], shortCircuit: true };
    }
    if (context.parentURL?.endsWith('/lang/python/executable.js') && specifier.endsWith('/subprocess/runner.js')) {
      return { url: 'python-retirement:probe', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const modules = {
      'python-retirement:spawn': access + 'export const spawn = (...args) => state.spawn(...args);',
      'python-retirement:executable': 'export const findPythonExecutable = async () => "fixture-python";',
      'python-retirement:kill': access + 'export const killChildProcessTree = async child => { state.kills++; return state.kill(child); };',
      'python-retirement:tracking': access + 'export const registerChildProcessForCleanup = () => { state.registered++; return () => { state.registered--; }; };',
      'python-retirement:probe': access + 'export const spawnSubprocess = async () => { state.probes++; return state.probe(); };'
    };
    return modules[url] ? { format: 'module', source: modules[url], shortCircuit: true } : next(url, context);
  }
});
try {
  const { getPythonAstPool, shutdownPythonAstPool } = await import('../../../src/lang/python/pool.js');
  const pool = await getPythonAstPool(null, { workerCount: 1, maxWorkers: 1, maxRetries: 1, crashLoopMax: 0 });
  const args = { dataflow: false, controlFlow: false, path: null };
  const request = pool.request('def fixture(): pass', args);
  const original = state.workers[0];
  state.kill = async () => ({ terminated: true });
  original.emit('error', new Error('fixture transport failure'));
  await tick();
  assert.equal(state.workers.length, 1, 'a kill claim cannot admit a replacement before the original child closes');
  assert.equal(state.registered, 1, 'a detached worker remains registered while close is unobserved');
  close(original); await tick();
  assert.equal(state.workers.length, 2);
  assert.equal(state.kills, 1);
  answer(state.workers[1]); assert.equal((await request).defs[0].name, 'fixture');

  let settled = false;
  const failure = Object.assign(new Error('original tree cleanup still owns work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
  });
  state.kill = async () => { throw failure; };
  const secondRequest = pool.request('def fixture(): pass', args);
  const rejection = assert.rejects(secondRequest, error => error.cacheOwnershipPending === true);
  state.workers[1].emit('error', new Error('fixture transport failure with pending tree cleanup'));
  close(state.workers[1]); await rejection;
  failure.cacheOwnershipReleased = () => true; failure.cacheOwnershipPending = false;
  await assert.rejects(pool.request('def fixture(): pass', args));
  assert.equal(state.workers.length, 2, 'rewritten diagnostic fields cannot grant native retry authority');
  await assert.rejects(shutdownPythonAstPool());
  assert.equal(state.kills, 2, 'observing failed shutdown cannot repeat native termination');
  settled = true; await shutdownPythonAstPool();
  assert.equal(state.registered, 0);

  const { findPythonExecutable } = await import('../../../src/lang/python/executable.js');
  let probeSettled = false;
  const probeError = Object.assign(new Error('original probe child still owns work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => probeSettled
  });
  state.probe = async () => { throw probeError; };
  await assert.rejects(findPythonExecutable());
  probeError.cacheOwnershipReleased = () => true;
  await assert.rejects(findPythonExecutable());
  assert.equal(state.probes, 1, 'an unconfirmed probe cannot be downgraded to missing Python or retried');
  probeSettled = true;
  state.probe = async () => ({ exitCode: 0, stdout: 'ok' });
  assert.equal(await findPythonExecutable(), 'python');
  assert.equal(state.probes, 2, 'a later explicit lookup can retry only after original probe settlement');
} finally {
  hooks.deregister(); delete globalThis[key];
  for (const worker of state.workers) { worker.stdin.destroy(); worker.stdout.destroy(); worker.stderr.destroy(); }
}
console.log('Python replacement and fallback retain original child-close and tree-cleanup ownership.');

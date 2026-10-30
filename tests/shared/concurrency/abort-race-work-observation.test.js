import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { raceAbort } from '../../../src/shared/abort.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
if (!process.argv.includes('--child')) {
  const child = runNode([fileURLToPath(import.meta.url), '--child'], 'abort race original work observation',
    process.cwd(), process.env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /all supplied work rejections observed/);
} else {
  const unexpected = [];
  process.on('unhandledRejection', error => { unexpected.push(error); });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  for (const reason of [null, false, 0, '', Object.freeze(new Error('original cancellation'))]) {
    for (const outcome of ['already-rejected', 'delayed-rejection', 'delayed-fulfillment']) {
      const controller = new AbortController(); controller.abort(reason);
      const failure = Object.freeze(new Error(outcome)), work = deferred();
      if (outcome === 'already-rejected') work.reject(failure);
      await assert.rejects(raceAbort(controller.signal, work.promise), error => error.code === 'ABORT_ERR'
        && error.name === 'AbortError' && error.cause === reason);
      if (outcome === 'delayed-rejection') work.reject(failure);
      if (outcome === 'delayed-fulfillment') work.resolve('cannot win an aborted wait');
      await turn(); await turn();
      assert.deepEqual(unexpected, [], outcome);
    }
  }
  const controller = new AbortController(), signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal), listeners = new Set();
  signal.addEventListener = (type, handler, options) => { if (type === 'abort') listeners.add(handler); return add(type, handler, options); };
  signal.removeEventListener = (type, handler, options) => { if (type === 'abort') listeners.delete(handler); return remove(type, handler, options); };
  assert.equal(await raceAbort(signal, Promise.resolve('work wins')), 'work wins');
  assert.equal(listeners.size, 0);
  const original = Object.freeze(new Error('ordinary work rejection'));
  await assert.rejects(raceAbort(signal, Promise.reject(original)), error => error === original);
  assert.equal(listeners.size, 0);
  const active = deferred(), reason = new Error('cancel while work is live');
  const waiting = raceAbort(signal, active.promise); const rejected = assert.rejects(waiting, error => error.cause === reason);
  controller.abort(reason); await rejected;
  assert.equal(listeners.size, 0); active.reject(original); await turn(); await turn();
  assert.deepEqual(unexpected, []);
  const shared = Promise.resolve('shared work'); assert.equal(raceAbort(null, shared), shared);
  console.log('all supplied work rejections observed; cancellation remains prompt and listeners settle');
}

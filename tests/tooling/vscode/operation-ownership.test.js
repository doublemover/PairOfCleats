import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const order of ['old-first', 'new-first']) {
  const operations = createEditorOperations();
  const published = [];
  const api = operations.wrapVscode({ window: { showInformationMessage: (value) => published.push(value) } });
  const old = deferred(), recent = deferred();
  const first = operations.run('old-search', async () => {
    await old.promise;
    api.window.showInformationMessage('old');
  }, { key: 'search' });
  const second = operations.run('new-search', async () => {
    await recent.promise;
    api.window.showInformationMessage('new');
  }, { key: 'search' });
  if (order === 'old-first') { old.resolve(); await first; recent.resolve(); }
  else { recent.resolve(); await second; old.resolve(); }
  await Promise.all([first, second]);
  assert.deepEqual(published, ['new'], `${order}: response latency cannot acquire interaction authority`);
  assert.equal((await operations.dispose()).ok, true);
}

{
  const operations = createEditorOperations();
  let dispatches = 0;
  await operations.run('provider', () => { dispatches += 1; }, { token: { isCancellationRequested: true } });
  assert.equal(dispatches, 0, 'a cancelled provider cannot start work');
  let abortSignal;
  const started = deferred();
  const request = operations.run('http', () => operations.request((signal) => {
    abortSignal = signal;
    started.resolve();
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: true }), { once: true }));
  }));
  await started.promise;
  const result = await operations.dispose();
  assert.equal(abortSignal.aborted, true);
  assert.equal(result.ok, true, 'shutdown waits for actual HTTP settlement');
  assert.equal((await request).kind, 'cancelled', 'a late success cannot cross disposed authority');
}

{
  let helperCalls = 0;
  const operations = createEditorOperations({ platform: 'win32', spawn(command, args, options) {
    helperCalls += 1;
    assert.equal(command, 'taskkill.exe');
    assert.deepEqual(args, ['/PID', '12345', '/T', '/F']);
    assert.equal(options.windowsHide, true);
    const helper = new EventEmitter();
    queueMicrotask(() => helper.emit('error', new Error('controlled helper failure')));
    return helper;
  } });
  const child = new EventEmitter();
  child.pid = 12345;
  child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
  let terminalCallbacks = 0;
  await operations.run('operator', () => {
    operations.trackChild(child);
    child.once('close', () => { terminalCallbacks += 1; });
  });
  const result = await operations.dispose();
  assert.equal(helperCalls, 1);
  assert.equal(terminalCallbacks, 1, 'cancelled callbacks still settle their owner');
  assert.equal(result.children, 0);
  assert.equal(result.ok, false, 'direct-child fallback does not prove descendant reaping');
  assert.match(result.failures.join('\n'), /controlled helper failure/);
}

{
  const operations = createEditorOperations();
  const writes = [];
  const api = operations.wrapVscode({ window: { showErrorMessage: (value) => writes.push(value) } });
  const child = new EventEmitter();
  child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
  await operations.run('managed', () => {
    operations.trackChild(child);
    child.once('close', () => api.window.showErrorMessage('late managed error'));
  });
  assert.equal((await operations.dispose()).ok, true);
  assert.deepEqual(writes, [], 'persistent child callbacks retain the original revoked scope');
}

console.log('Editor interaction authority, HTTP settlement, provider preflight and teardown failure controls passed.');

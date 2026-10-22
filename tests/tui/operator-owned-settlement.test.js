import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { settleOwnedActions } from '../../tools/tui/operator/settle-owned.js';
import { createTuiMcpClients } from '../../tools/tui/operator/mcp-client.js';
import { createTuiSemanticPages } from '../../tools/tui/operator/semantic-pages.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
{
  const delayed = deferred(), calls = [];
  const original = Object.assign(new Error('first exact owner'), { code: 'ERR_FIRST' });
  let settled = false;
  const disposal = settleOwnedActions({ failed: () => { calls.push('failed'); throw original; },
    delayed: async () => { calls.push('delayed'); await delayed.promise; }, last: () => calls.push('last') });
  const rejected = assert.rejects(disposal, error => error === original).then(() => { settled = true; });
  await turn();
  assert.deepEqual(calls, ['failed', 'delayed', 'last']);
  assert.equal(settled, false, 'one rejection cannot release an unfinished sibling owner');
  delayed.resolve(); await rejected;
}
{
  const primary = Object.assign(new Error('private initialize failure'), { code: 'ERR_INITIALIZE' });
  const cleanup = Object.assign(new Error('private close failure'), { code: 'ERR_CLOSE' });
  let recover = false, finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const scope = { id: 'mcp-scope', configRoot: process.cwd() };
  const owner = createTuiMcpClients({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => ({
    completion, status: () => ({ connected: !recover }), request: async () => { throw primary; },
    dispose: async () => { if (!recover) throw cleanup; finish({ exitCode: 1 }); return { exitCode: 1 }; }
  }) });
  await assert.rejects(owner.run({ scope, jobId: 'mcp-owned' }, { signal: new AbortController().signal, env: {},
    onActivity: () => {} }), error => error.code === primary.code && error.cause === primary);
  assert.equal(owner.status(scope.id)[0].phase, 'closure-failed');
  assert.equal(owner.status(scope.id)[0].closeErrorCode, 'ERR_CLOSE');
  await assert.rejects(owner.dispose(), error => error === cleanup);
  assert.equal(owner.status(scope.id).length, 1, 'failed close retains exact process admission');
  recover = true; await owner.dispose();
  assert.deepEqual(owner.status(scope.id), [], 'only a successful retry on the same client releases ownership');
}
{
  const page = deferred(), closed = deferred();
  let started;
  const pageStarted = new Promise(resolve => { started = resolve; });
  const scope = { id: 'page-scope', configRoot: process.cwd() };
  const owner = createTuiSemanticPages({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => ({
    completion: new Promise(() => {}), status: () => ({ connected: true }),
    request: async () => { started(); return page.promise; }, dispose: () => closed.promise
  }) });
  const opening = owner.open({ scope, commandId: 'semantic.trace', request: { repoRoot: scope.configRoot },
    requestSha256: 'a'.repeat(64) }, {});
  const rejected = assert.rejects(opening, { code: 'ERR_TUI_SEMANTIC_EXPIRED' });
  await pageStarted;
  let disposed = false;
  const disposing = owner.dispose().then(() => { disposed = true; });
  await turn();
  page.resolve({ page: { rows: ['late page'] }, hasMore: true });
  await turn();
  assert.equal(owner.status(scope.id)[0].closurePending, true);
  assert.equal(disposed, false);
  closed.resolve(); await disposing; await rejected;
  assert.deepEqual(owner.status(scope.id), [], 'a page arriving during close cannot resurrect a continuation');
}
{
  const clients = [], scope = { id: 'bounded-scope', configRoot: process.cwd() };
  const owner = createTuiSemanticPages({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => {
    const close = deferred(); clients.push(close);
    return { completion: new Promise(() => {}), status: () => ({ connected: true }), dispose: () => close.promise,
      request: async () => ({ page: { rows: [] }, hasMore: true }) };
  } });
  const input = { scope, commandId: 'semantic.find', request: { repoRoot: scope.configRoot }, requestSha256: 'b'.repeat(64) };
  for (let index = 0; index < 4; index += 1) await owner.open(input, {});
  const closing = owner.dispose();
  await turn();
  assert.equal(owner.status(scope.id).filter(entry => entry.closurePending).length, 4);
  await assert.rejects(owner.open(input, {}), { code: 'ERR_TUI_SEMANTIC_ADMISSION' });
  assert.equal(clients.length, 4, 'removing public capabilities cannot evade the process bound during teardown');
  for (const close of clients) close.resolve();
  await closing;
  assert.deepEqual(owner.status(scope.id), []);
}
{
  let recovered = false;
  const error = Object.assign(new Error('exact semantic child did not close'), { code: 'ERR_CHILD_CLOSE' });
  const scope = { id: 'failed-close-scope', configRoot: process.cwd() };
  const owner = createTuiSemanticPages({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => ({
    completion: new Promise(() => {}), status: () => ({ connected: !recovered }),
    request: async () => ({ page: { rows: [] }, hasMore: true }),
    dispose: async () => { if (!recovered) throw error; }
  }) });
  const first = await owner.open({ scope, commandId: 'semantic.detail', request: { repoRoot: scope.configRoot },
    requestSha256: 'c'.repeat(64) }, {});
  const params = { scopeId: scope.id, continuationId: first.nativeContinuation.id };
  await assert.rejects(owner.discard(params), caught => caught === error);
  assert.equal(owner.status(scope.id)[0].closurePending, true);
  assert.equal(owner.status(scope.id)[0].closeErrorCode, error.code);
  await assert.rejects(owner.next(params, {}), { code: 'ERR_TUI_SEMANTIC_EXPIRED' });
  await assert.rejects(owner.dispose(), caught => caught === error);
  recovered = true; await owner.dispose();
  assert.deepEqual(owner.status(scope.id), []);
}
console.log('Native owner disposal retains admission, waits for siblings and preserves primary failures');

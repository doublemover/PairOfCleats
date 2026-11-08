import assert from 'node:assert/strict';
import { createTuiSemanticPages } from '../../tools/tui/operator/semantic-pages.js';

let scopeId = 'scope-a', clock = 0;
const children = [];
const createClient = () => {
  let finish, disposed = false, page = 0;
  const calls = [];
  const completion = new Promise(resolve => { finish = resolve; });
  const client = { calls, completion, status: () => ({ connected: !disposed }),
    request: async (method, params) => {
      calls.push({ method, params });
      page += 1;
      return { page: { generation: 'exact-generation', rows: [page], cursor: null }, hasMore: page < 3 };
    },
    dispose: async () => { disposed = true; finish({ exitCode: 0 }); return { closed: true, pending: false }; },
    get disposed() { return disposed; } };
  children.push(client); return client;
};
const owner = createTuiSemanticPages({ toolRoot: process.cwd(), createClient, now: () => clock,
  requireScope: id => { if (id !== scopeId) throw Object.assign(new Error('Scope changed.'), { code: 'ERR_TUI_SCOPE_CHANGED' }); } });
const input = { scope: { id: scopeId, configRoot: process.cwd() }, commandId: 'semantic.trace',
  request: { repoRoot: process.cwd(), generation: 'exact-generation' }, requestSha256: 'a'.repeat(64) };
const first = await owner.open(input, {});
const id = first.nativeContinuation.id;
assert.equal(children.length, 1);
assert.deepEqual(first.rows, [1]);
const second = await owner.next({ scopeId, continuationId: id });
assert.deepEqual(second.rows, [2]);
assert.deepEqual(children[0].calls[1], { method: 'page.next', params: {} }, 'continuation cannot replace query/generation/cursor');
const last = await owner.next({ scopeId, continuationId: id });
assert.deepEqual(last.rows, [3]);
assert.equal(last.nativeContinuation, null);
assert.equal(children[0].disposed, true);
await assert.rejects(owner.next({ scopeId, continuationId: id }), { code: 'ERR_TUI_SEMANTIC_EXPIRED' });
const expiring = await owner.open(input, {});
clock = 300001;
await assert.rejects(owner.next({ scopeId, continuationId: expiring.nativeContinuation.id }), { code: 'ERR_TUI_SEMANTIC_EXPIRED' });
assert.equal(children[1].disposed, true);
await assert.rejects(owner.open({ ...input, request: { ...input.request, cursor: 'external' } }, {}), { code: 'ERR_TUI_SEMANTIC_REQUEST' });
clock = 0;
const scoped = await owner.open(input, {});
scopeId = 'scope-b';
await assert.rejects(owner.next({ scopeId, continuationId: scoped.nativeContinuation.id }), { code: 'ERR_TUI_SEMANTIC_EXPIRED' });
await owner.dispose();
assert.equal(children[2].disposed, true);
console.log('Semantic continuations retain one owned process and exact query scope until expiry/disposal');

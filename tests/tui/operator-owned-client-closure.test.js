// Actual owners with injected bounded child observations; UNVALIDATED.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { createOwnedStdioClient } from '../../tools/tui/operator/stdio-client.js';
import { createTuiApiServices } from '../../tools/tui/operator/api-service.js';
import { createTuiMcpClients } from '../../tools/tui/operator/mcp-client.js';
import { createTuiSemanticPages } from '../../tools/tui/operator/semantic-pages.js';
import { ownedCleanupIsPending } from '../../tools/tui/operator/settle-owned.js';

const scope = { id: 'selected', configRoot: process.cwd() };
const delayedClose = () => {
  let closed = false;
  return { close: () => { closed = true; }, error: Object.assign(new Error('original child timeout'), {
    code: 'SUBPROCESS_TIMEOUT', cacheOwnershipPending: true, cacheOwnershipReleased: () => closed,
    result: { termination: { closeObserved: false, treeCleanupFailed: false } }
  }) };
};
{
  const delayed = delayedClose(), stdin = new PassThrough();
  let rejectChild;
  const client = createOwnedStdioClient({ command: 'inert-owned-client', args: [], spawn: async (_command, _args, options) => {
    const result = new Promise((_resolve, reject) => { rejectChild = reject; });
    options.onSpawn({ pid: 123, stdin });
    return result;
  } });
  try {
    await client.ready;
    const request = client.request('tools/list');
    const rejected = assert.rejects(request, error => error === delayed.error);
    await turn();
    rejectChild(delayed.error);
    await rejected;
    await assert.rejects(client.completion, error => error === delayed.error);
    assert.equal(client.status().closurePending, true);
    assert.equal(client.status().connected, false);
    await assert.rejects(client.dispose(), error => error === delayed.error);
    delayed.close();
    const receipt = await client.dispose();
    assert.equal(receipt.closed, true); assert.equal(receipt.pending, false);
    assert.equal(client.status().closurePending, false);
  } finally { delayed.close(); await client.dispose(); stdin.destroy(); }
}
for (const occupied of [false, true]) {
  const delayed = delayedClose();
  const owner = createTuiApiServices({ toolRoot: process.cwd(), requireScope: () => {},
    spawn: async (_command, _args, options) => {
      options.onSpawn({ pid: 456 });
      if (occupied) options.onStderr('EADDRINUSE');
      throw delayed.error;
    }, probe: async () => assert.fail('a failed child cannot authorize probing an endpoint') });
  try {
    const run = () => owner.run({ scope, jobId: 'owned-api', argv: [] }, {
      signal: new AbortController().signal, env: {}, onActivity: () => {} });
    await assert.rejects(run(), error => {
      assert.equal(ownedCleanupIsPending(error), true);
      if (occupied) assert.equal(error.cause.code, 'ERR_TUI_API_PORT_IN_USE');
      else assert.equal(error, delayed.error);
      return true;
    });
    assert.equal(owner.status(scope.id)[0].phase, 'closure-pending');
    await assert.rejects(run(), { code: 'ERR_TUI_API_ADMISSION' });
    await assert.rejects(owner.dispose(), error => error === delayed.error);
    assert.equal(owner.status(scope.id).length, 1, 'failed disposal cannot erase pending physical ownership');
    delayed.close();
    await owner.dispose();
    assert.deepEqual(owner.status(scope.id), []);
  } finally { delayed.close(); await owner.dispose(); }
}
{
  let receipt = null;
  const startup = Object.assign(new Error('original handshake failure'), { code: 'ERR_HANDSHAKE' });
  const owner = createTuiMcpClients({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => ({
    completion: Promise.resolve(), status: () => ({ connected: false }),
    request: async () => { throw startup; }, dispose: async () => receipt
  }) });
  await assert.rejects(owner.run({ scope, jobId: 'unknown-mcp' }, { signal: new AbortController().signal }),
    error => error.cause === startup && error.cacheOwnershipPending === true);
  assert.equal(owner.status(scope.id).length, 1);
  receipt = { closed: true };
  await assert.rejects(owner.dispose(), error => error.cacheOwnershipPending === true,
    'missing pending:false is not an exact positive closure receipt');
  receipt = { closed: true, pending: false };
  await owner.dispose();
  assert.deepEqual(owner.status(scope.id), []);
}
{
  let receipt = null;
  const owner = createTuiSemanticPages({ toolRoot: process.cwd(), requireScope: () => {}, createClient: () => ({
    completion: new Promise(() => {}), status: () => ({ connected: false }),
    request: async () => ({ page: { rows: [] }, hasMore: false }), dispose: async () => receipt
  }) });
  await assert.rejects(owner.open({ scope, commandId: 'semantic.detail', request: {}, requestSha256: 'a'.repeat(64) }, {}),
    error => error.cacheOwnershipPending === true);
  assert.equal(owner.status(scope.id)[0].closurePending, true);
  receipt = { closed: true, pending: false };
  await owner.dispose();
  assert.deepEqual(owner.status(scope.id), []);
}
console.log('API, MCP and semantic client maps retain unconfirmed closure and preserve primary failures.');

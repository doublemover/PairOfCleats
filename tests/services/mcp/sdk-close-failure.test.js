import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
const [clientTransport, transport] = InMemoryTransport.createLinkedPair();
let startedResolve, releaseResolve, reaped = false;
const started = new Promise(resolve => { startedResolve = resolve; });
const release = new Promise(resolve => { releaseResolve = resolve; });
const service = await startMcpSdkServer({ toolDefs: [], serverInfo: { name: 'close-failure', version: '1' },
  queueMax: 4, resolveToolTimeoutMs: () => 1000, transport,
  executeTool: async (_name, _input, { signal }) => {
    startedResolve();
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    await release; reaped = true; signal.throwIfAborted();
  } });
const client = new Client({ name: 'close-failure-client', version: '1' });
const callAbort = new AbortController();
const failure = new Error('Owned transport close failed');
try {
  await client.connect(clientTransport);
  const call = client.callTool({ name: 'fixture', arguments: {} }, undefined, { signal: callAbort.signal }).catch(() => {});
  await started;
  const close = transport.close.bind(transport);
  transport.close = async () => { await close(); throw failure; };
  let settled = false;
  const closing = service.close(); closing.catch(() => { settled = true; });
  assert.strictEqual(service.close(), closing);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false); assert.equal(service.queue.pending, 1);
  releaseResolve(); await assert.rejects(closing, error => error === failure);
  assert.equal(reaped, true); assert.equal(service.queue.pending, 0);
  // A deliberately failing linked transport can prevent the peer's onclose
  // callback. Reap the client request explicitly rather than await its 60s timer.
  callAbort.abort(); await call;
  console.log('SDK transport close failure still awaits owned tool teardown before releasing capacity.');
} finally { callAbort.abort(); releaseResolve(); await client.close(); await service.close().catch(() => {}); }

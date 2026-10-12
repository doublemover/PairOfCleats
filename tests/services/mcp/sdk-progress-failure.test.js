import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const send = serverTransport.send.bind(serverTransport);
let failures = 0;
serverTransport.send = async (message, options) => {
  if (message.method === 'notifications/progress') {
    failures += 1;
    await new Promise(resolve => setImmediate(resolve));
    throw new Error('Owned transport notification failure');
  }
  return send(message, options);
};
let lateProgress;
const service = await startMcpSdkServer({ toolDefs: [], serverInfo: { name: 'progress-failure', version: '1' },
  queueMax: 4, resolveToolTimeoutMs: () => 1000, transport: serverTransport,
  executeTool: async (_name, _args, context) => {
    context.progress({ message: 'working' });
    context.progress({ message: 'pending' });
    lateProgress = context.progress;
    return { ok: true };
  } });
const client = new Client({ name: 'progress-failure-client', version: '1' });
try {
  await client.connect(clientTransport);
  const result = await client.callTool({ name: 'fixture', arguments: {}, _meta: { progressToken: 0 } });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).ok, true);
  assert.equal(failures, 1, 'an asynchronous notification rejection disables the sender');
  lateProgress({ message: 'after completion' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failures, 1);
  await service.queue.onIdle();
  assert.equal(service.queue.pending, 0);
  console.log('Actual SDK asynchronous progress failure and terminal sender closure passed.');
} finally { await client.close(); await service.close(); }

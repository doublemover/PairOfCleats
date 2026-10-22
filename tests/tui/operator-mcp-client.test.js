import assert from 'node:assert/strict';
import { createTuiMcpClients } from '../../tools/tui/operator/mcp-client.js';
import { MCP_PROTOCOL_VERSION } from '../../src/integrations/mcp/protocol.js';

let healthy, finish;
const health = new Promise(resolve => { healthy = resolve; });
const completion = new Promise(resolve => { finish = resolve; });
const calls = [];
let closed = false;
const client = { completion, status: () => ({ connected: !closed, pending: 0 }),
  request: async (method, params) => {
    calls.push({ method, params });
    return method === 'initialize' ? { protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'canonical' } }
      : { tools: [{ name: 'index_status' }] };
  }, dispose: async () => { closed = true; finish({ exitCode: 0 }); return completion; } };
const owner = createTuiMcpClients({ toolRoot: process.cwd(), requireScope: () => {}, createClient: options => {
  assert.ok(options.args.includes('--mcp-mode=legacy'));
  assert.equal(options.args.some(value => value.includes('token')), false);
  return client;
} });
const scope = { id: 'selected', configRoot: process.cwd() }, controller = new AbortController();
const running = owner.run({ scope, jobId: 'owned-mcp' }, { signal: controller.signal, env: {},
  onSpawn: () => {}, onActivity: () => healthy() });
await health;
assert.equal(owner.status(scope.id)[0].initialized, true);
assert.equal(owner.status(scope.id)[0].healthChecks, 1);
assert.deepEqual(calls.map(call => call.method), ['initialize', 'tools/list']);
await assert.rejects(owner.run({ scope, jobId: 'duplicate' }, { signal: controller.signal }), { code: 'ERR_TUI_MCP_ADMISSION' });
controller.abort();
const result = await running;
assert.equal(result.exitCode, 130);
assert.equal(closed, true);
assert.deepEqual(owner.status(scope.id), []);
await owner.dispose();
console.log('MCP initialize/inventory health, per-scope ownership and cancellation disposal');

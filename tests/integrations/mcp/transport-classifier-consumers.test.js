import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setImmediate as immediate } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createMcpTransport } from '../../../tools/mcp/transport.js';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { normalizeMcpToolResponse } from '../../../src/integrations/mcp/result-envelope.js';
import { createMcpTestReader } from '../../helpers/mcp-reader.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('integrations/mcp/transport-classifier-consumers/')[1];
assert.ok(['legacy', 'sdk'].includes(mode));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const bounded = async operation => {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Actual MCP boundary did not settle within 5 seconds.')), 5000);
  })]); } finally { clearTimeout(timer); }
};
const input = new PassThrough(), output = new PassThrough(), reader = createMcpTestReader(output, { transport: mode });
const owners = new Map(), calls = [], outcomes = [], wireIds = [], heldResponses = new Map(), handlerResults = new Map();
const handlerDone = new Map(), originalSet = Server.prototype.setRequestHandler;
let service;
if (mode === 'sdk') Server.prototype.setRequestHandler = function (schema, handler) {
  return originalSet.call(this, schema, async (request, context) => {
    const value = await handler(request, context);
    if (request.method === 'tools/call') { handlerResults.set(context.requestId, value); handlerDone.get(context.requestId)?.resolve(value); }
    return value;
  });
};
const execute = async (name, args, context) => {
  if (name !== 'controlled_mutation') throw Object.assign(new Error('Missing or unknown fixture tool.'), { code: 'INVALID_REQUEST' });
  const id = context.toolCallId; calls.push({ id, action: args.action });
  if (args.action === 'failure') throw Object.freeze(Object.assign(new Error('Original ordinary tool failure.'), { code: 'INVALID_REQUEST' }));
  if (['hold', 'timeout', 'cancel'].includes(args.action)) {
    const owner = owners.get(id); owner.effects++; owner.entered.resolve();
    if (args.action !== 'hold') await new Promise(resolve => {
      const aborted = () => { owner.aborted.resolve(); resolve(); };
      if (context.signal.aborted) aborted(); else context.signal.addEventListener('abort', aborted, { once: true });
    });
    await owner.release.promise; owner.cleaned = true; owner.finished.resolve();
    if (context.signal.aborted) throw context.signal.reason || Object.assign(new Error('Request cancelled.'), { code: 'CANCELLED' });
  }
  return { completed: true, code: 'QUEUE_OVERLOADED', marker: args.marker || 'actual-success' };
};
const send = value => {
  const body = JSON.stringify(value);
  input.write(mode === 'legacy' ? 'Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body : body + '\n');
};
const read = async id => {
  if (heldResponses.has(id)) { const value = heldResponses.get(id); heldResponses.delete(id); return value; }
  for (;;) {
    const value = await bounded(reader.readMessage()); wireIds.push(value.id);
    if (value.id === id) return value; heldResponses.set(value.id, value);
  }
};
const call = (id, action) => send({ jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'controlled_mutation', arguments: { action } } });
const ownerFor = id => {
  const owner = { entered: deferred(), aborted: deferred(), release: deferred(), finished: deferred(), effects: 0, cleaned: false };
  owners.set(id, owner); handlerDone.set(id, deferred()); return owner;
};
const classify = (value, kind, code = null, retryable = false) => {
  const outcome = normalizeMcpToolResponse(value); outcomes.push({ id: value.id ?? null, ...outcome });
  assert.equal(outcome.kind, kind, JSON.stringify(value)); assert.equal(outcome.ok, kind === 'success');
  if (code) { assert.equal(outcome.code, code); assert.equal(outcome.retryable, retryable); }
  return outcome;
};
const idle = () => bounded((async () => {
  for (;;) {
    const active = mode === 'legacy' ? service.getState().activeTasks
      : Object.values(service.getQueueState().lanes).reduce((sum, lane) => sum + lane.active + lane.queued, 0);
    if (active === 0) return; await immediate();
  }
})());
try {
  const settings = { toolDefs: [{ name: 'controlled_mutation', inputSchema: { type: 'object' } }],
    schemaVersion: '1.0.0', toolVersion: '1.0.0', serverInfo: { name: 'actual-classifier-fixture', version: '1.0.0' },
    queueMax: 1, resolveToolTimeoutMs: (_name, args) => args.action === 'timeout' ? 25 : 1000, capabilities: {} };
  service = mode === 'legacy' ? createMcpTransport({ ...settings, handleToolCall: execute, input, outputStream: output,
    exit: code => assert.equal(code, 0) }) : await startMcpSdkServer({ ...settings, executeTool: execute, stdin: input, stdout: output });
  if (mode === 'legacy') service.start();
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'classifier-consumer', version: '1.0.0' } } });
  assert.ok((await read(1)).result); send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  call(2, 'success'); const success = classify(await read(2), 'success');
  assert.equal(JSON.parse(success.result.content[0].text).code, 'QUEUE_OVERLOADED', 'a successful payload mentioning overload is still success');
  await idle(); call(3, 'failure'); classify(await read(3), 'tool-error', 'INVALID_REQUEST'); await idle();
  send({ jsonrpc: '2.0', id: 4, method: 'fixture/unknown-method', params: {} });
  const unknown = classify(await read(4), 'protocol-error', mode === 'legacy' ? 'NOT_FOUND' : 'INTERNAL');
  assert.equal(unknown.protocolCode, -32601);
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} });
  const invalid = classify(await read(5), mode === 'legacy' ? 'tool-error' : 'protocol-error', mode === 'legacy' ? 'INVALID_REQUEST' : 'INTERNAL');
  // Locked SDK parses the request schema before its tools/call wrapper; that
  // ordinary schema exception reaches the public protocol InternalError owner.
  // Classify the actual wire code precisely, without inventing InvalidParams.
  if (mode === 'sdk') assert.equal(invalid.protocolCode, -32603);
  assert.equal(calls.some(call => call.id === 5), false, 'malformed params never dispatch mutating work'); await idle();
  const held = ownerFor(6); call(6, 'hold'); await bounded(held.entered.promise);
  const beforeOverload = calls.length; call(7, 'success');
  classify(await read(7), mode === 'legacy' ? 'protocol-error' : 'tool-error', 'QUEUE_OVERLOADED', true);
  assert.equal(calls.length, beforeOverload, 'actual admission rejection dispatches no mutating work');
  held.release.resolve(); classify(await read(6), 'success'); await idle();
  const timed = ownerFor(8); call(8, 'timeout'); await bounded(timed.entered.promise); await bounded(timed.aborted.promise);
  assert.equal(timed.cleaned, false); assert.equal(timed.effects, 1);
  call(9, 'success'); classify(await read(9), mode === 'legacy' ? 'protocol-error' : 'tool-error', 'QUEUE_OVERLOADED', true);
  timed.release.resolve(); classify(await read(8), 'tool-error', 'TOOL_TIMEOUT'); await bounded(timed.finished.promise); await idle();
  assert.equal(timed.effects, 1, 'timeout classification cannot infer no effects or automatically replay mutation');
  const cancelled = ownerFor(10); call(10, 'cancel'); await bounded(cancelled.entered.promise);
  send(mode === 'legacy' ? { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 10 } }
    : { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 10, reason: 'controlled caller cancellation' } });
  await bounded(cancelled.aborted.promise); call(11, 'success');
  classify(await read(11), mode === 'legacy' ? 'protocol-error' : 'tool-error', 'QUEUE_OVERLOADED', true);
  assert.equal(cancelled.cleaned, false); cancelled.release.resolve();
  if (mode === 'legacy') classify(await read(10), 'tool-error', 'CANCELLED');
  else {
    const originalHandlerResult = await bounded(handlerDone.get(10).promise);
    classify(originalHandlerResult, 'tool-error', 'CANCELLED');
    assert.equal(originalHandlerResult, handlerResults.get(10), 'classifier consumes the actual registered handler result');
  }
  await bounded(cancelled.finished.promise); await idle();
  call(12, 'success'); classify(await read(12), 'success'); await idle();
  if (mode === 'sdk') assert.equal(wireIds.includes(10), false, 'locked SDK suppresses the response to a cancelled request; do not invent a wire envelope');
  for (const id of [6, 8, 10]) assert.equal(calls.filter(call => call.id === id).length, 1);
  assert.equal(calls.some(call => [7, 9, 11].includes(call.id)), false);
  assert.equal(cancelled.effects, 1);
  console.log(JSON.stringify({ mode, outcomes, wireIds, calls, sdkCancellation: mode === 'sdk'
    ? 'actual registered handler CANCELLED; actual protocol suppresses wire response' : null }));
} finally {
  for (const owner of owners.values()) owner.release.resolve();
  await service?.close(); Server.prototype.setRequestHandler = originalSet;
  reader.cancelPending(new Error('controlled transport reader retired')); input.destroy(); output.destroy();
}

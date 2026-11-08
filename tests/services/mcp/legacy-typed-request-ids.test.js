import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { RequestIdSchema } from '@modelcontextprotocol/sdk/types.js';
import { createManualClock } from '../../helpers/manual-clock.js';

const messages = [];
globalThis.__typedMcpMessages = value => messages.push(JSON.parse(JSON.stringify(value)));
const protocolUrl = new URL('../../../src/integrations/mcp/protocol.js', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/mcp/transport.js') && specifier.endsWith('/mcp/protocol.js')) {
      return { url: 'typed-mcp:protocol', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== 'typed-mcp:protocol') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export { formatToolError, buildInitializeResult } from ${JSON.stringify(protocolUrl)};
      export const sendResult = (id,result) => globalThis.__typedMcpMessages({jsonrpc:'2.0',id,result});
      export const sendError = (id,code,message,output,data) => globalThis.__typedMcpMessages({jsonrpc:'2.0',id,error:{code,message,data}});
      export const sendNotification = (method,params) => globalThis.__typedMcpMessages({jsonrpc:'2.0',method,params});
      export const closeOutput = () => {};` };
  }
});
const { createMcpTransport } = await import('../../../tools/mcp/transport.js');
const sessions = [];
const start = () => {
  const clock = createManualClock(), offset = messages.length, started = [];
  const gates = new Map();
  const before = Object.fromEntries(['data', 'end', 'error'].map(event => [event, process.stdin.listeners(event)]));
  const transport = createMcpTransport({ toolDefs: [], serverInfo: { name: 'typed-identity-fixture', version: '1' }, queueMax: 2,
    resolveToolTimeoutMs: (_name, args) => args.timeout || 6000,
    handleToolCall: async (_name, args, options) => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const entry = { label: args.label, id: options.toolCallId, ...options, release };
      gates.set(args.label, entry); started.push(entry);
      options.progress({ message: args.label + ':first' });
      if (options.signal.aborted) release();
      await gate;
      return { label: args.label, id: options.toolCallId };
    } });
  const parser = transport.start();
  for (const event of Object.keys(before)) for (const listener of process.stdin.listeners(event)) {
    if (!before[event].includes(listener)) process.stdin.off(event, listener);
  }
  const send = message => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...message });
    parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`));
  };
  let closed = false;
  const session = { clock, started, gates, messages: () => messages.slice(offset),
    call: (id, label, name = 'index_status', extra = {}) => send({ id, method: 'tools/call', params: { name, arguments: { label, ...extra } } }),
    cancel: id => send({ method: '$/cancelRequest', params: { id } }),
    async close() {
      if (closed) return;
      closed = true;
      try {
        for (const gate of gates.values()) gate.release();
        await transport.close(); await clock.settle();
        assert.equal(clock.timers.size, 0, 'all progress/deadline ownership retires with the actual requests');
      } finally { clock.restore(); }
    } };
  sessions.push(session); return session;
};
const results = session => session.messages().filter(message => Object.hasOwn(message, 'result'));
try {
  {
    const session = start();
    try {
      session.call(1, 'number'); await session.clock.settle();
      session.cancel('1'); session.cancel(true); session.cancel({ value: 1 });
      await session.clock.settle();
      assert.equal(session.gates.get('number').signal.aborted, false, 'unknown string/invalid cancellation must not target numeric identity');
      session.call('1', 'string', 'fixture-slow'); await session.clock.settle();
      assert.deepEqual(session.started.map(entry => entry.id), [1, '1']);
      session.call(1, 'duplicate-number'); session.call('1', 'duplicate-string');
      await session.clock.settle();
      const duplicates = session.messages().filter(message => message.error?.data?.reason === 'duplicate-request-id');
      assert.deepEqual(duplicates.map(message => message.id), [1, '1']);
      assert.deepEqual(duplicates.map(message => message.error.data.requestId), [1, '1']);
      session.cancel(1);
      await session.clock.settle();
      assert.equal(session.gates.get('number').signal.aborted, true);
      assert.equal(session.gates.get('string').signal.aborted, false);
      session.call(2, 'overloaded');
      await session.clock.settle();
      assert.equal(session.messages().at(-1).error.data.code, 'QUEUE_OVERLOADED', 'cancellation retains started capacity until real settlement');
      session.call(1, 'still-duplicate');
      await session.clock.settle();
      assert.equal(session.messages().at(-1).error.data.reason, 'duplicate-request-id');
      session.gates.get('number').release(); await session.clock.settle();
      assert.equal(results(session).find(message => message.id === 1).result.isError, true);
      session.gates.get('string').progress({ message: 'string:second' });
      assert.equal(session.messages().some(message => message.params?.message === 'string:second'), false,
        'retiring numeric identity cannot delete string identity throttle state');
      await session.clock.advance(250);
      assert.equal(session.messages().find(message => message.params?.message === 'string:second').params.id, '1');
      session.call(1, 'number-reused'); await session.clock.settle();
      assert.equal(session.gates.has('number-reused'), true, 'settled exact identity can be reused while the peer remains active');
      assert.equal(session.gates.get('string').signal.aborted, false);
    } finally { await session.close(); }
  }
  {
    const session = start();
    try {
      session.call(0, 'zero'); session.call('0', 'queued-zero'); await session.clock.settle();
      assert.deepEqual(session.started.map(entry => entry.id), [0]);
      session.cancel('0'); await session.clock.settle();
      assert.equal(session.gates.get('zero').signal.aborted, false);
      assert.deepEqual(results(session).map(message => message.id), ['0']);
      assert.equal(session.gates.has('queued-zero'), false, 'only the exact typed queued task is removed');
      session.gates.get('zero').release(); await session.clock.settle();
      assert.deepEqual(results(session).map(message => message.id), ['0', 0]);
    } finally { await session.close(); }
  }
  {
    const session = start();
    try {
      session.call(0, 'timeout-zero', 'index_status', { timeout: 20 });
      session.call('0', 'healthy-zero', 'fixture-slow'); await session.clock.settle();
      await session.clock.advance(20);
      assert.equal(JSON.parse(results(session).find(message => message.id === 0).result.content[0].text).code, 'TOOL_TIMEOUT');
      assert.equal(session.gates.get('healthy-zero').signal.aborted, false);
      session.call(0, 'timeout-duplicate');
      await session.clock.settle();
      assert.equal(session.messages().at(-1).error.data.reason, 'duplicate-request-id');
      session.gates.get('timeout-zero').release(); await session.clock.settle();
      session.call(0, 'after-timeout'); await session.clock.settle();
      assert.equal(session.gates.has('after-timeout'), true);
    } finally { await session.close(); }
  }
  {
    const session = start();
    try {
      for (const id of ['', 'n:1', Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
        assert.equal(RequestIdSchema.safeParse(id).success, true);
        session.call(id, 'domain-' + String(id)); await session.clock.settle();
        session.gates.get('domain-' + String(id)).release(); await session.clock.settle();
        assert.equal(results(session).at(-1).id, id);
      }
      for (const id of [null, true, false, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(RequestIdSchema.safeParse(id).success, false);
        const count = session.started.length;
        session.call(id, 'invalid'); await session.clock.settle();
        assert.equal(session.started.length, count);
        assert.equal(session.messages().at(-1).id, null);
        assert.equal(session.messages().at(-1).error.data.reason, 'invalid-request-id');
      }
    } finally { await session.close(); }
  }
} finally {
  for (const session of sessions) await session.close();
  hook.deregister(); delete globalThis.__typedMcpMessages;
}
console.log('Legacy MCP admission, cancellation, progress and settlement preserve typed JSON-RPC request identity.');

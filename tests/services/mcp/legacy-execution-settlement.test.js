#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const messages = [];
globalThis.__legacySettlementMessages = messages;
const hook = registerHooks({
  load(url, context, next) {
    if (url.endsWith('/src/integrations/mcp/protocol.js')) return {
      format: 'module', shortCircuit: true, source: `
        export const sendResult = (id, result) => globalThis.__legacySettlementMessages.push({ id, result });
        export const sendError = (id, code, message) => globalThis.__legacySettlementMessages.push({ id, error: { code, message } });
        export const sendNotification = () => {};
        export const closeOutput = () => {};
        export const buildInitializeResult = value => value;
        export const formatToolError = error => ({ code: error.code, message: error.message });`
    };
    return next(url, context);
  }
});
const { createMcpTransport } = await import('../../../tools/mcp/transport.js');
const baselineListeners = Object.fromEntries(['data', 'end', 'error'].map(event => [event, process.stdin.listeners(event)]));
let release;
let teardown = new Promise(resolve => { release = resolve; });
let active = 0, peak = 0;
const events = [];
const children = [];
const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'bounded fixture event must arrive');
    await delay(5);
  }
};
try {
  const parser = createMcpTransport({ toolDefs: [], serverInfo: { name: 'fixture', version: '1' },
    queueMax: 2, resolveToolTimeoutMs: () => 20,
    handleToolCall: async (name, args, { signal }) => {
      active++; peak = Math.max(peak, active); events.push(`start:${args.order}`);
      try {
        if (args.order === 1) {
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
          children.push(child);
          const exited = new Promise((resolve, reject) => {
            child.once('close', resolve); child.once('error', reject);
          });
          await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
          events.push('abort:1');
          await teardown;
          child.kill();
          await exited;
        }
        return { ok: true };
      } finally { active--; events.push(`settle:${args.order}`); }
    }
  }).start();
  // Feed the real parser directly. Its production stdin-end handler exits the
  // process, so detach only this fixture's subscriptions before awaiting work.
  for (const event of Object.keys(baselineListeners)) {
    for (const listener of process.stdin.listeners(event)) {
      if (!baselineListeners[event].includes(listener)) process.stdin.off(event, listener);
    }
  }
  const send = value => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...value });
    parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`));
  };
  const call = (id, order) => send({ id, method: 'tools/call', params: { name: 'fixture', arguments: { order } } });
  call(1, 1); call(2, 2);
  await waitFor(() => messages.some(message => message.id === 1));
  assert.equal(JSON.parse(messages.find(message => message.id === 1).result.content[0].text).code, 'TOOL_TIMEOUT');
  assert.deepEqual(events, ['start:1', 'abort:1'], 'timeout response must not release capacity before teardown');
  call(1, 3);
  await waitFor(() => messages.at(-1)?.error?.code === -32600);
  assert.equal(messages.at(-1).error.code, -32600, 'timed-out request retains identity until settlement');
  call(3, 3);
  await waitFor(() => messages.at(-1)?.error?.code === -32001);
  assert.equal(messages.at(-1).error.code, -32001, 'settling work remains in admission occupancy');
  release();
  await waitFor(() => messages.some(message => message.id === 2));
  assert.deepEqual(events, ['start:1', 'abort:1', 'settle:1', 'start:2', 'settle:2']);
  assert.equal(peak, 1);
  assert.equal(active, 0);
  assert.equal(messages.filter(message => message.id === 1 && message.result).length, 1);
  teardown = new Promise(resolve => { release = resolve; });
  call(4, 1); call(5, 2);
  await waitFor(() => messages.some(message => message.id === 4));
  send({ id: 6, method: 'shutdown' });
  await delay(30);
  assert.equal(messages.some(message => message.id === 6), false, 'shutdown must await active teardown');
  assert.equal(JSON.parse(messages.find(message => message.id === 5).result.content[0].text).code, 'CANCELLED');
  call(7, 2);
  assert.equal(messages.some(message => message.id === 7), false, 'serialized admission retains late calls behind shutdown');
  release();
  await waitFor(() => messages.some(message => message.id === 6));
  await waitFor(() => messages.some(message => message.id === 7));
  assert.equal(JSON.parse(messages.find(message => message.id === 7).result.content[0].text).code, 'CANCELLED');
  assert.equal(active, 0);
  assert.equal(peak, 1);
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'shutdown drains actual owned children');
} finally {
  release();
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  await delay(30);
  for (const event of Object.keys(baselineListeners)) {
    for (const listener of process.stdin.listeners(event)) {
      if (!baselineListeners[event].includes(listener)) process.stdin.off(event, listener);
    }
  }
  hook.deregister(); delete globalThis.__legacySettlementMessages;
}
console.log('legacy MCP timeout response retains execution capacity, request identity and admission accounting until settlement');

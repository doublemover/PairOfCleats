#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-maintenance-cancel-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const originalRunner = new URL('../../../src/shared/subprocess/runner.js', import.meta.url).href;
const originalProtocol = new URL('../../../src/integrations/mcp/protocol.js', import.meta.url).href;
let settled = false, syncCalls = 0;
let settlementGate = null;
const calls = [], failures = [];
const messages = [];
globalThis.__maintenanceMessages = messages;
const fixtureArgs = ['-e', 'setTimeout(() => console.log(JSON.stringify({ok:true})), 500)'];
globalThis.__maintenanceCancellation = {
  async spawn(run, command, args, options) {
    const previous = calls.at(-1);
    assert.notEqual(previous?.settled, false, 'the execution lane retains capacity until its original child settles');
    const call = { args, signal: options.signal, settled: false };
    const gate = settlementGate;
    calls.push(call);
    try { return await run(command, fixtureArgs, options); }
    finally { if (gate) await gate; settled = true; call.settled = true; }
  },
  spawnSync(run, command, args, options) {
    syncCalls++;
    try { return run(command, fixtureArgs, options); }
    finally { settled = true; }
  }
};
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/mcp/runner.js') && specifier.endsWith('/subprocess/runner.js')) {
      return { url: 'maintenance:subprocess', shortCircuit: true };
    }
    if (context.parentURL?.endsWith('/tools/mcp/transport.js') && specifier.endsWith('/mcp/protocol.js')) {
      return { url: 'maintenance:protocol', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'maintenance:protocol') return { format: 'module', shortCircuit: true, source: `
      export { formatToolError, buildInitializeResult } from ${JSON.stringify(originalProtocol)};
      export const sendResult = (id, result) => globalThis.__maintenanceMessages.push({ id, result });
      export const sendError = (id, code, message) => globalThis.__maintenanceMessages.push({ id, error: { code, message } });
      export const sendNotification = () => {}; export const closeOutput = () => {};`
    };
    if (url === 'maintenance:subprocess') return { format: 'module', shortCircuit: true, source: `
      import { spawnSubprocess as run, spawnSubprocessSync as runSync } from ${JSON.stringify(originalRunner)};
      export const spawnSubprocess = (...args) => globalThis.__maintenanceCancellation.spawn(run, ...args);
      export const spawnSubprocessSync = (...args) => globalThis.__maintenanceCancellation.spawnSync(runSync, ...args);`
    };
    return next(url, context);
  }
});
try {
  const { cacheGc } = await import('../../../tools/mcp/tools/handlers/artifacts.js');
  const { verifyExtensions } = await import('../../../tools/mcp/tools/handlers/downloads.js');
  const { triageDecision } = await import('../../../tools/mcp/tools/handlers/triage.js');
  for (const [name, handler] of [['cache_gc', cacheGc], ['verify_extensions', verifyExtensions], ['triage_decision', triageDecision]]) {
    settled = false;
    const controller = new AbortController();
    let responsive = false;
    const control = setTimeout(() => { responsive = !settled; }, 10);
    const cancel = setTimeout(() => controller.abort(), 30);
    try {
      const work = Promise.resolve().then(() => handler({ repoPath: root, maxBytes: 1,
        finding: 'fixture-finding', status: 'accept' }, { signal: controller.signal }));
      await assert.rejects(work, error => ['ABORT_ERR', 'SUBPROCESS_ABORT'].includes(error.code));
      assert.equal(responsive, true, `${name} must leave the protocol event loop responsive while its child runs`);
      assert.equal(settled, true, `${name} cancellation awaits actual child settlement`);
      assert.equal(calls.at(-1).signal, controller.signal);
      assert.equal(syncCalls, 0);
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { clearTimeout(control); clearTimeout(cancel); }
  }
  assert.deepEqual(failures, []);
  const decision = await triageDecision({ repoPath: root, finding: 'fixture-finding', status: 'accept' });
  assert.deepEqual(decision, { ok: true }, 'successful decision JSON remains available after asynchronous completion');
  assert.ok(calls.at(-1).args.includes('--finding'));
  assert.ok(calls.at(-1).args.includes('fixture-finding'));
  assert.equal(syncCalls, 0);
  const { createMcpTransport } = await import('../../../tools/mcp/transport.js');
  const { handleToolCall } = await import('../../../tools/mcp/tools.js');
  const listeners = Object.fromEntries(['data', 'end', 'error'].map(event => [event, process.stdin.listeners(event)]));
  let toolTimeoutMs = 10000;
  const transport = createMcpTransport({ toolDefs: [], serverInfo: { name: 'maintenance', version: '1' }, queueMax: 3,
    resolveToolTimeoutMs: () => toolTimeoutMs,
    handleToolCall: (name, args, context) => name === 'index_status' ? { ok: true } : handleToolCall(name, args, context) });
  const parser = transport.start();
  for (const [event, previous] of Object.entries(listeners)) {
    for (const listener of process.stdin.listeners(event)) if (!previous.includes(listener)) process.stdin.off(event, listener);
  }
  const send = message => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...message });
    parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`));
  };
  const response = async id => {
    const deadline = Date.now() + 2000;
    while (!messages.some(message => message.id === id)) {
      assert.ok(Date.now() < deadline, 'protocol response must arrive within the bounded fixture');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return messages.find(message => message.id === id);
  };
  settled = false;
  try {
    send({ id: 1, method: 'tools/call', params: { name: 'cache_gc', arguments: { repoPath: root, maxBytes: 1 } } });
    send({ id: 2, method: 'tools/call', params: { name: 'index_status', arguments: {} } });
    assert.equal((await response(2)).result.isError, undefined);
    assert.equal(settled, false, 'fast-lane status responds while maintenance child work remains active');
    send({ method: '$/cancelRequest', params: { id: 1 } });
    assert.equal(JSON.parse((await response(1)).result.content[0].text).code, 'CANCELLED');
    assert.equal(settled, true);
    settled = false;
    send({ id: 3, method: 'tools/call', params: { name: 'triage_decision', arguments: {
      repoPath: root, finding: 'fixture-finding', status: 'accept'
    } } });
    send({ id: 4, method: 'tools/call', params: { name: 'index_status', arguments: {} } });
    assert.equal((await response(4)).result.isError, undefined);
    assert.equal(settled, false, 'live triage dispatch leaves the status lane responsive');
    send({ method: '$/cancelRequest', params: { id: 3 } });
    assert.equal(JSON.parse((await response(3)).result.content[0].text).code, 'CANCELLED');
    assert.equal(settled, true, 'triage cancellation observes child settlement');
    for (const [index, name] of ['cache_gc', 'verify_extensions', 'triage_decision'].entries()) {
      settled = false; toolTimeoutMs = 30;
      const timeoutId = 5 + index * 2, nextId = timeoutId + 1, before = calls.length;
      let release;
      settlementGate = new Promise(resolve => { release = resolve; });
      try {
        send({ id: timeoutId, method: 'tools/call', params: { name, arguments: {
          repoPath: root, finding: 'fixture-finding', status: 'accept', maxBytes: 1
        } } });
        assert.equal(JSON.parse((await response(timeoutId)).result.content[0].text).code, 'TOOL_TIMEOUT');
        // Legacy short-deadline requests share the fast lane. Queue a probe
        // under that same policy so independent lanes remain independent.
        send({ id: nextId, method: 'tools/call', params: { name: 'triage_decision', arguments: {
          repoPath: root, finding: 'fixture-finding', status: 'accept'
        } } });
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(calls.length, before + 1, `${name} deadline cannot release its lane early`);
        assert.equal(calls[before].settled, false);
      } finally { settlementGate = null; release(); }
      assert.equal(JSON.parse((await response(nextId)).result.content[0].text).code, 'TOOL_TIMEOUT');
      assert.equal(calls[before].settled, true);
    }
  } finally {
    await transport.close(); parser.dispose();
    assert.equal(settled, true, 'deadline shutdown joins the original triage child');
  }
} finally {
  hook.deregister(); delete globalThis.__maintenanceCancellation;
  delete globalThis.__maintenanceMessages;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('MCP maintenance handlers retain event-loop responsiveness and await owned-child cancellation');

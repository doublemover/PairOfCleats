import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-mcp-build-cancel-')));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const messages = [];
let state;
globalThis.__indexBuildCancellation = {
  messages,
  async build(_root, options) {
    state.calls.push(['build', options.abortSignal]);
    try {
      await spawnSubprocess(process.execPath, ['-e', 'console.log(process.pid);setTimeout(()=>{},200)'], {
        signal: options.abortSignal, onStdout: text => {
          state.pid = Number(text.trim());
          if (state.when === 'running') state.cancel();
        }
      });
      if (state.when === 'between') {
        state.cancel();
        if (options.abortSignal) await waitFor(() => options.abortSignal.aborted);
      }
      if (!options.abortSignal?.aborted) await fs.writeFile(path.join(root, 'published'), 'published');
      return { ok: true };
    } finally { state.settled = true; }
  },
  async sqlite(_root, options) {
    state.calls.push(['sqlite', options.abortSignal]);
    if (state.when === 'sqlite-running') {
      try {
        await spawnSubprocess(process.execPath, ['-e', 'console.log(process.pid);setTimeout(()=>{},200)'], {
          signal: options.abortSignal, onStdout: text => { state.pid = Number(text.trim()); state.cancel(); }
        });
      } finally { state.settled = true; }
    }
    return { ok: true };
  }
};
const protocol = new URL('../../../src/integrations/mcp/protocol.js', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/indexing.js') && specifier.endsWith('/core/build-index.js')) {
      return { url: 'index-cancellation:core', shortCircuit: true };
    }
    if (context.parentURL?.endsWith('/tools/mcp/transport.js') && specifier.endsWith('/mcp/protocol.js')) {
      return { url: 'index-cancellation:protocol', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'index-cancellation:core') return { format: 'module', shortCircuit: true, source: `
      export const buildIndex = (...args) => globalThis.__indexBuildCancellation.build(...args);
      export const buildSqliteIndex = (...args) => globalThis.__indexBuildCancellation.sqlite(...args);` };
    if (url === 'index-cancellation:protocol') return { format: 'module', shortCircuit: true, source: `
      export { formatToolError, buildInitializeResult } from ${JSON.stringify(protocol)};
      export const sendResult = (id, result) => globalThis.__indexBuildCancellation.messages.push({ id, result });
      export const sendError = (id, code, message) => globalThis.__indexBuildCancellation.messages.push({ id, error: { code, message } });
      export const sendNotification = () => {}; export const closeOutput = () => {};` };
    return next(url, context);
  }
});
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'owned cancellation must settle within the fixture bound');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const reset = async (when, cancel) => {
  await fs.rm(path.join(root, 'published'), { force: true });
  state = { when, cancel, calls: [], settled: false, pid: null };
};
const assertCancelled = async (label, expectedSignal = null) => {
  if (state.when === 'before') assert.deepEqual(state.calls, [], `${label}: already-aborted requests cannot start work`);
  else {
    await waitFor(() => state.settled);
    assert.equal(state.calls.length, 1, `${label}: cancellation must not start the follow-on SQLite stage`);
    assert.ok(state.calls[0][1]?.aborted, `${label}: the core build must receive its request signal`);
    if (expectedSignal) assert.equal(state.calls[0][1], expectedSignal);
    if (state.pid) assert.throws(() => process.kill(state.pid, 0), { code: 'ESRCH' }, `${label}: the owned build child must be reaped`);
  }
  await assert.rejects(fs.stat(path.join(root, 'published')), { code: 'ENOENT' });
};
try {
  const { handleToolCall } = await import('../../../tools/mcp/tools.js');
  for (const when of ['running', 'before', 'between']) {
    const controller = new AbortController();
    await reset(when, () => controller.abort());
    if (when === 'before') controller.abort();
    await assert.rejects(handleToolCall('build_index', { repoPath: root, mode: 'code', sqlite: true }, { signal: controller.signal }));
    await assertCancelled(`direct ${when}`, controller.signal);
  }
  for (const when of ['before', 'sqlite-running']) {
    const controller = new AbortController();
    await reset(when, () => controller.abort());
    if (when === 'before') controller.abort();
    await assert.rejects(handleToolCall('build_sqlite_index', { repoPath: root, mode: 'code' }, { signal: controller.signal }));
    await assertCancelled(`direct SQLite ${when}`, controller.signal);
  }
  const { createMcpTransport } = await import('../../../tools/mcp/transport.js');
  const baseline = Object.fromEntries(['data', 'end', 'error'].map(event => [event, process.stdin.listeners(event)]));
  const legacy = createMcpTransport({ toolDefs: [], serverInfo: { name: 'index-cancel', version: '1' },
    queueMax: 3, resolveToolTimeoutMs: () => 5000, handleToolCall });
  const parser = legacy.start();
  for (const [event, listeners] of Object.entries(baseline)) {
    for (const listener of process.stdin.listeners(event)) if (!listeners.includes(listener)) process.stdin.off(event, listener);
  }
  const send = message => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...message });
    parser.push(Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`));
  };
  try {
    for (const [offset, when] of ['running', 'between'].entries()) {
      const id = offset + 1;
      await reset(when, () => send({ method: '$/cancelRequest', params: { id } }));
      send({ id, method: 'tools/call', params: { name: 'build_index', arguments: { repoPath: root, sqlite: true } } });
      await waitFor(() => messages.some(message => message.id === id));
      assert.equal(JSON.parse(messages.find(message => message.id === id).result.content[0].text).code, 'CANCELLED');
      await assertCancelled(`legacy ${when}`);
    }
  } finally { await legacy.close(); parser.dispose(); }

  const { startMcpSdkServer } = await import('../../../tools/mcp/server-sdk.js');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const service = await startMcpSdkServer({ toolDefs: [], serverInfo: { name: 'index-cancel', version: '1' },
    queueMax: 3, resolveToolTimeoutMs: () => 5000, transport: serverTransport });
  const client = new Client({ name: 'index-cancel-client', version: '1' });
  try {
    await client.connect(clientTransport);
    for (const when of ['running', 'between']) {
      const controller = new AbortController();
      await reset(when, () => controller.abort());
      await assert.rejects(client.callTool({ name: 'build_index', arguments: { repoPath: root, sqlite: true } }, undefined,
        { signal: controller.signal }));
      await service.queue.onIdle();
      await assertCancelled(`SDK ${when}`);
    }
    await reset('success', () => assert.fail('successful work must not cancel'));
    const result = await client.callTool({ name: 'build_index', arguments: { repoPath: root, sqlite: true } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(state.calls.map(row => row[0]), ['build', 'sqlite']);
    assert.equal(state.calls[0][1], state.calls[1][1], 'both stages share the same request signal');
    assert.equal(await fs.readFile(path.join(root, 'published'), 'utf8'), 'published');
  } finally { await client.close(); await service.close(); }
} finally {
  hook.deregister(); delete globalThis.__indexBuildCancellation;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Actual build_index dispatch in legacy/SDK forwards cancellation, drains owned work, and suppresses later stages/publication.');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sdk-wire-'));
const filename = path.join(directory, 'events.jsonl');
const notifications = [], frames = [];
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.resolve('tests/fixtures/mcp/sdk-lifecycle-server.js'), directory], stderr: 'pipe' });
const client = new Client({ name: 'sdk-wire-test', version: '1' });
client.setNotificationHandler(ProgressNotificationSchema, async message => {
  ProgressNotificationSchema.parse(message); notifications.push(message.params);
});
const readEvents = async () => {
  try {
    return (await fs.readFile(filename, 'utf8')).split('\n').filter(Boolean).map(row => JSON.parse(row));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const events = await readEvents();
    if (predicate(events)) return events;
    if (Date.now() >= deadline) throw new Error('SDK lifecycle receipt deadline exceeded.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const call = (mode, options = {}, token) => client.callTool({ name: 'fixture', arguments: { mode },
  ...(token === undefined ? {} : { _meta: { progressToken: token } }) }, undefined, options);
const cancelled = promise => promise.then(value => ({ value }), error => ({ error }));
const assertDead = async pid => {
  const deadline = Date.now() + 1500;
  for (;;) {
    let alive = true;
    try {
      process.kill(pid, 0);
      if (process.platform === 'linux') {
        const stat = await fs.readFile('/proc/' + pid + '/stat', 'utf8');
        // A zombie has exited; it cannot keep indexing or own an open handle.
        if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) alive = false;
      }
    } catch (error) { if (['ESRCH', 'ENOENT'].includes(error.code)) alive = false; else throw error; }
    if (!alive) return;
    if (Date.now() >= deadline) throw new Error('Owned SDK child is still alive: ' + pid);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
try {
  await client.connect(transport);
  const receive = transport.onmessage;
  transport.onmessage = (message, extra) => { frames.push(message); receive(message, extra); };
  const running = new AbortController(), queued = new AbortController();
  const first = cancelled(call('hold', { signal: running.signal }, 0));
  await waitFor(events => events.some(row => row.mode === 'hold' && row.event === 'start'));
  const second = cancelled(call('never-start', { signal: queued.signal }, 'queued'));
  queued.abort(new Error('queued cancellation'));
  running.abort(new Error('running cancellation'));
  await waitFor(events => events.some(row => row.mode === 'hold' && row.event === 'teardown'));
  const next = call('next', {}, 'next');
  const before = await readEvents();
  assert.ok(!before.some(row => ['next', 'never-start'].includes(row.mode)), 'capacity must remain owned through cleanup');
  await fs.writeFile(path.join(directory, 'release'), 'release');
  assert.ok((await first).error); assert.ok((await second).error);
  assert.equal((await next).isError, undefined);
  assert.ok(!(await readEvents()).some(row => row.mode === 'never-start'), 'cancelled queued action must never start');
  assert.ok(notifications.some(row => row.progressToken === 0));
  assert.ok(notifications.some(row => row.progressToken === 'next'));
  for (const token of [0, 'next']) {
    const values = notifications.filter(row => row.progressToken === token).map(row => row.progress);
    assert.ok(values.every((value, index) => typeof value === 'number' && (index === 0 || value > values[index - 1])));
  }
  const timeout = await call('timeout');
  assert.equal(timeout.isError, true);
  assert.equal(JSON.parse(timeout.content[0].text).code, 'TOOL_TIMEOUT');
  const childCancel = new AbortController();
  const child = cancelled(call('child', { signal: childCancel.signal }, 'owned'));
  await waitFor(events => events.some(row => row.event === 'descendant'));
  childCancel.abort(new Error('owned child cancellation'));
  assert.ok((await child).error);
  await waitFor(events => events.some(row => row.mode === 'child' && row.event === 'settled'));
  const ownedPids = (await readEvents()).filter(row => ['pid', 'descendant'].includes(row.event)).map(row => row.pid);
  await Promise.all(ownedPids.map(assertDead));
  const lastProgress = notifications.length;
  await call('after-cancel');
  assert.ok(notifications.slice(lastProgress).every(row => row.progressToken !== 'owned'));
  assert.ok(frames.every(frame => !frame.result?.content?.some(content => {
    if (content.type !== 'text') return false;
    try { return ['hold', 'never-start', 'child'].includes(JSON.parse(content.text).mode); } catch { return false; }
  })), 'cancelled calls must not emit success');
  const disconnected = cancelled(call('child'));
  await waitFor(events => events.filter(row => row.event === 'descendant').length === 2);
  await client.close();
  assert.ok((await disconnected).error);
  await waitFor(events => events.filter(row => row.mode === 'child' && row.event === 'settled').length === 2);
  await Promise.all((await readEvents()).filter(row => ['pid', 'descendant'].includes(row.event)).map(row => assertDead(row.pid)));
  const wrapperTransport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve('bin/pairofcleats.js'), 'service', 'mcp', '--mcp-mode', 'sdk'], stderr: 'pipe' });
  const wrapperClient = new Client({ name: 'documented-wrapper', version: '1' });
  try {
    await wrapperClient.connect(wrapperTransport);
    assert.ok((await wrapperClient.listTools()).tools.some(tool => tool.name === 'search'));
  } finally { await wrapperClient.close(); }
  console.log('Real SDK stdio cancellation, timeout/disconnect, progress token zero and child/capacity cleanup passed.');
} finally {
  await fs.writeFile(path.join(directory, 'release'), 'release');
  await client.close();
  await fs.rm(directory, { recursive: true, force: true });
}

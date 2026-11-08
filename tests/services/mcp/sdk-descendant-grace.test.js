import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skip } from '../../helpers/skip.js';

applyTestEnv();
if (process.platform === 'win32') {
  skip('POSIX SIGTERM-resistant descendant fixture; Windows requires native qualification.');
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const graceMs = 300;
let readyResolve, descendantPid, termination, ownershipPending, cancelledAt = null;
const ready = new Promise(resolve => { readyResolve = resolve; });
const alive = async () => {
  if (!descendantPid) return false;
  try {
    process.kill(descendantPid, 0);
    if (process.platform === 'linux') {
      const stat = await fs.readFile('/proc/' + descendantPid + '/stat', 'utf8');
      // A zombie is exited, but is not a claim that its new parent has reaped it.
      if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) return false;
    }
    return true;
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
};
const descendant = 'process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},1000)';
const source = 'const {spawn}=require("node:child_process");'
  + 'const child=spawn(process.execPath,["-e",' + JSON.stringify(descendant)
  + '],{stdio:["ignore","ignore","ignore","ipc"]});'
  + 'child.once("message",()=>console.log(child.pid));setInterval(()=>{},1000)';
const service = await startMcpSdkServer({
  toolDefs: [], serverInfo: { name: 'descendant-grace', version: '1' },
  queueMax: 4, resolveToolTimeoutMs: () => 5000, transport: serverTransport,
  executeTool: async (name, _args, { signal }) => {
    if (name === 'next') return { elapsedMs: performance.now() - cancelledAt, termination, ownershipPending };
    try {
      await spawnSubprocess(process.execPath, ['-e', source], {
        signal, killGraceMs: graceMs, timeoutAbortReapWaitMs: 1000,
        onStdout: text => { descendantPid = Number(text.trim()); readyResolve(); }
      });
    } catch (error) {
      termination = error.result?.termination;
      ownershipPending = error.cacheOwnershipPending === true;
      throw error;
    }
  }
});
const client = new Client({ name: 'descendant-grace-client', version: '1' });
const controller = new AbortController();
try {
  await client.connect(clientTransport);
  const cancelled = client.callTool({ name: 'owned-child', arguments: {} }, undefined,
    { signal: controller.signal }).then(() => assert.fail('cancelled call must reject'), error => error);
  await ready;
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 1);
  cancelledAt = performance.now(); controller.abort();
  const response = await client.callTool({ name: 'next', arguments: {} });
  await cancelled;
  assert.equal(response.isError, undefined);
  const result = JSON.parse(response.content[0].text);
  assert.ok(result.elapsedMs >= graceMs - 20, 'next SDK tool must retain capacity through descendant escalation');
  assert.equal(result.termination.closeObserved, true);
  assert.equal(result.termination.treeCleanupSettled, true);
  assert.equal(result.termination.treeCleanupFailed, false);
  assert.equal(result.termination.treeCleanupForced, true, 'SIGTERM-resistant descendant requires escalation');
  assert.equal(result.termination.scope, 'spawned-child-close-only', 'escalation is not universal descendant-reap proof');
  assert.equal(result.ownershipPending, false);
  const deadline = Date.now() + 1000;
  while (await alive()) {
    assert.ok(Date.now() < deadline, 'owned descendant must exit after escalation');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  console.log('Actual SDK capacity remains owned through configured descendant grace and escalation.');
} finally {
  controller.abort();
  if (await alive()) {
    try { process.kill(descendantPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await client.close(); await service.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/graceful-exit-after-transport-close/')[1];
assert.ok(['natural-exit', 'stalled-exit', 'explicit-kill', 'transport-error'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`lsp-graceful-pipe-close-${selected}`);
const program = path.join(dir, 'server.mjs'), marker = path.join(dir, 'exit-notification');
const rpc = new URL('../../../src/shared/jsonrpc.js', import.meta.url).href;
await fs.writeFile(program, `import fs from 'node:fs';
import { createFramedJsonRpcParser } from ${JSON.stringify(rpc)};
const send = message => { const body = JSON.stringify(message); process.stdout.write('Content-Length: '+Buffer.byteLength(body)+'\\r\\n\\r\\n'+body); };
const parser = createFramedJsonRpcParser({ onMessage(message) {
  if(message.method==='initialize') send({jsonrpc:'2.0',id:message.id,result:{capabilities:{definitionProvider:true}}});
  else if(message.method==='shutdown') send({jsonrpc:'2.0',id:message.id,result:null});
  else if(message.method==='exit') {
    fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid));
    process.stdin.destroy(); process.stdout.end();
    ${selected === 'natural-exit' ? 'setTimeout(()=>process.exit(0), 200);' : 'setInterval(()=>{}, 1000);'}
  }
}, onError(error) { throw error; } });
process.stdin.on('data', chunk=>parser.push(chunk));
`);
const events = [];
let nativeChild;
const client = createLspClient({ cmd: process.execPath, args: [program], cwd: dir,
  spawnProcess: ({ cmd, args, options }) => { nativeChild = spawn(cmd, args, options); return nativeChild; },
  onLifecycleEvent: event => events.push(event) });
let shutdown;
try {
  await client.initialize({ rootUri: pathToFileURL(dir).href, timeoutMs: 1000 });
  const started = Date.now();
  shutdown = client.shutdownAndExit();
  const deadline = Date.now() + 1000;
  let pid;
  while (!pid) {
    try { pid = Number(await fs.readFile(marker, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < deadline, 'actual server must receive the exit notification');
    if (!pid) await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(Number.isInteger(pid) && pid > 0);
  if (selected !== 'natural-exit') {
    assert.throws(() => client.start(), { code: 'ERR_LSP_RESTART_STALE_PROCESS' },
      'late admission cannot replace the original child during graceful exit');
    await assert.rejects(client.request('test/late', null, { startIfNeeded: false }), { code: 'ERR_LSP_TRANSPORT_CLOSED' });
    assert.equal(client.notify('test/late', null, { startIfNeeded: false }), false);
    if (selected === 'explicit-kill') await client.kill();
    if (selected === 'transport-error') nativeChild.stdin.emit('error',
      Object.assign(new Error('Explicit transport failure during native exit'), { code: 'EPIPE' }));
  }
  await shutdown;
  const settlement = await client.waitForResourceSettlement();
  assert.equal(settlement.settled, true);
  assert.equal(isProcessAlive(pid), false);
  const exit = events.find(event => event.kind === 'exit');
  assert.ok(exit);
  assert.equal(events.filter(event => event.kind === 'start').length, 1);
  if (selected === 'natural-exit') {
    assert.equal(exit.code, 0, JSON.stringify(events));
    assert.equal(exit.signal, null);
    assert.equal(events.some(event => event.kind === 'reap' || event.kind === 'kill'), false,
      `normal transport close must not preempt the original natural exit: ${JSON.stringify(events)}`);
  } else {
    assert.ok(exit.code !== 0 || exit.signal);
    if (selected === 'transport-error') {
      assert.ok(events.some(event => event.kind === 'reap' && event.reason === 'writer_error'));
      assert.ok(Date.now() - started < 2000, 'a real stream error cannot borrow the graceful EOF wait');
    } else assert.ok(events.some(event => event.kind === 'kill'), 'stalled/cancelled exit retains forced cleanup');
  }
  assert.ok(Date.now() - started < 5000, 'the existing graceful/forced shutdown bound is unchanged');
} finally {
  await client.kill();
  await shutdown;
}
console.log(`Actual child ${selected} retains native exit, original resource settlement and bounded shutdown`);

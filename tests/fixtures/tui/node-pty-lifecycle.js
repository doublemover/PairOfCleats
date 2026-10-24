import assert from 'node:assert/strict';
import * as pty from 'node-pty';
const records = [];
for (let index = 0; index < 3; index++) {
  const cancel = index === 2;
  const source = cancel ? 'process.stdout.write("PTY_READY"); setTimeout(()=>process.exit(8),2500); setInterval(()=>{},1000);'
    : 'process.stdout.write("PTY_START"+"x".repeat(65536)+"PTY_END");';
  const terminal = pty.spawn(process.execPath, ['-e', source], { cwd: process.cwd(), env: process.env, cols: 80, rows: 24, useConpty: true });
  const record = { index, pid: terminal.pid, cancel, cancelled: false }; records.push(record);
  let output = '';
  const timer = setTimeout(() => terminal.kill(), 3000);
  terminal.onData(data => {
    output = (output + data).slice(-256 * 1024);
    if (cancel && output.includes('PTY_READY') && !record.cancelled) { record.cancelled = true; terminal.kill(); }
  });
  const event = await new Promise(resolve => terminal.onExit(resolve)); clearTimeout(timer);
  Object.assign(record, { exitCode: event.exitCode, signal: event.signal, bytes: Buffer.byteLength(output) });
  if (cancel) { assert.equal(record.cancelled, true); assert.notEqual(event.exitCode, 8, 'the fallback fuse cannot count as successful cancellation'); }
  else { assert.equal(event.exitCode, 0); assert.ok(output.includes('PTY_START')); assert.ok(output.includes('PTY_END')); }
}
// No forced exit: the parent also requires natural process completion, including
// every ConPTY connection worker and native owner after these real operations.
console.log(JSON.stringify({ caseId: process.argv[2], records }));

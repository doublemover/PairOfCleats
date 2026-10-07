#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { runLineStreamingCommand } from '../../../tools/ingest/shared-runner.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = async (operation) => {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Command lifecycle lost its terminal event')), 5000);
    })]);
  } finally { clearTimeout(timer); }
};

await assert.rejects(bounded(runLineStreamingCommand({
  command: path.join(os.tmpdir(), `poc-missing-command-${process.pid}`)
})), error => error?.code === 'ENOENT', 'missing dependencies must reject with the original spawn error');

const lines = [];
const success = await bounded(runLineStreamingCommand({ command: process.execPath,
  args: ['-e', 'console.log("one"); process.exit(0);'],
  onStdoutLine: async line => { await sleep(100); lines.push(line); }
}));
assert.equal(success.exitCode, 0);
assert.deepEqual(lines, ['one'], 'slow consumers must still observe an already-exited child');

await assert.rejects(bounded(runLineStreamingCommand({ command: process.execPath,
  args: ['-e', 'process.exit(7);']
})), error => error?.code === 'ERR_INGEST_COMMAND_EXIT' && error.exitCode === 7);

let childPid;
const callbackFailure = new Error('consumer fixture failure');
await assert.rejects(bounded(runLineStreamingCommand({ command: process.execPath,
  args: ['-e', 'console.log(process.pid); setInterval(() => {}, 1000);'],
  onStdoutLine: line => { childPid = Number(line); throw callbackFailure; }
})), error => error === callbackFailure);
assert.ok(childPid > 0);
assert.throws(() => process.kill(childPid, 0), 'callback failure must terminate and reap the owned child');

await assert.rejects(bounded(runLineStreamingCommand({ command: process.execPath,
  args: ['-e', 'console.error("ready"); setInterval(() => {}, 1000);'],
  onStderrChunk: () => { throw callbackFailure; }
})), error => error === callbackFailure);

if (process.platform !== 'win32') {
  await assert.rejects(bounded(runLineStreamingCommand({ command: process.execPath,
    args: ['-e', 'process.kill(process.pid, "SIGTERM");']
  })), error => error?.code === 'ERR_INGEST_COMMAND_SIGNAL' && error.signal === 'SIGTERM',
  'a signalled child must not be reported as exit-code-zero success');
}
console.log('Ingest subprocesses retain early terminal events and clean up failed consumers.');

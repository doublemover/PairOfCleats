import fs from 'node:fs/promises';
import path from 'node:path';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createAbortError } from '../../../src/shared/abort.js';

const directory = process.argv[2];
if (!directory) throw new Error('SDK fixture requires an owned receipt directory.');
await fs.mkdir(directory, { recursive: true });
let writes = Promise.resolve();
const record = row => {
  writes = writes.then(() => fs.appendFile(path.join(directory, 'events.jsonl'), JSON.stringify(row) + '\n'));
  return writes;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const executeTool = async (_name, args, context) => {
  const mode = args.mode;
  await record({ event: 'start', mode });
  context.progress?.({ message: mode + ' started' });
  if (mode === 'hold' || mode === 'timeout') {
    if (!context.signal.aborted) await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }));
    await record({ event: 'teardown', mode, code: context.signal.reason?.code || null });
    if (mode === 'hold') {
      for (;;) {
        try { await fs.access(path.join(directory, 'release')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await pause(10);
      }
    }
    await record({ event: 'settled', mode });
    throw createAbortError();
  }
  if (mode === 'child') {
    let carry = '';
    const source = 'const {spawn}=require("node:child_process");'
      + 'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});'
      + 'console.log(JSON.stringify({descendant:child.pid}));setInterval(()=>{},1000);';
    try {
      await spawnSubprocess(process.execPath, ['-e', source], {
        signal: context.signal, killGraceMs: 20, timeoutAbortReapWaitMs: 1000,
        onSpawn: child => { void record({ event: 'pid', mode, pid: child.pid }); },
        onStdout: chunk => {
          carry += chunk.toString();
          const newline = carry.indexOf('\n');
          if (newline >= 0) {
            const value = JSON.parse(carry.slice(0, newline)); carry = carry.slice(newline + 1);
            void record({ event: 'descendant', mode, pid: value.descendant });
            context.progress?.({ message: 'owned descendant started' });
          }
        }
      });
    } finally { await record({ event: 'settled', mode }); }
  }
  context.progress?.({ message: mode + ' finished' });
  await record({ event: 'settled', mode });
  return { ok: true, mode };
};
await startMcpSdkServer({
  toolDefs: [{ name: 'fixture', description: 'Owned tiny SDK lifecycle fixture',
    inputSchema: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] } }],
  schemaVersion: 'fixture', toolVersion: 'fixture', serverInfo: { name: 'fixture', version: '1' },
  queueMax: 16, resolveToolTimeoutMs: (_name, args) => args.mode === 'timeout' ? 40 : 5000,
  executeTool
});

// Test transport instrumentation forwards the real supervisor protocol and replaces
// only the interactive demo command with an owned long-running descendant family.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';

const root = process.cwd();
const fixtureRoot = getTuiEnvConfig().eventLogDir;
const receipt = path.join(fixtureRoot, 'pids.jsonl');
const mode = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'fixture-mode.json'), 'utf8'));
const record = value => fs.appendFileSync(receipt, JSON.stringify(value) + '\n');
const supervisor = spawn(process.execPath, [path.join(root, 'tools/tui/supervisor.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] });
record({ proxy: process.pid, supervisor: supervisor.pid });
let failed = false;
let outputClosed = false;
let helloForwarded = false, creditsObserved = 0, nativeReady = false;
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  if (!outputClosed) process.stdout.write(line + '\n');
  const event = JSON.parse(line);
  if (event.event === 'hello') helloForwarded = true;
  if (event.event === 'job:spawn') record({ job: event.pid, jobId: event.jobId });
  if (event.event === 'job:spawn' && mode === 'supervisor-error' && !failed) {
    failed = true;
    setTimeout(() => { supervisor.kill('SIGKILL'); process.exit(19); }, 300);
  }
  if (event.event === 'job:spawn' && mode === 'event-transport-error' && !failed) {
    failed = true;
    setTimeout(() => {
      record({ transport: 'event-eof-while-supervisor-alive' });
      outputClosed = true;
      process.stdout.end(() => {
        if (!(process.stdout instanceof Socket)) throw new Error('Event EOF fixture requires the actual supervisor pipe.');
        // Node replaces stdio _destroy with a no-op. Retire the original pipe
        // through its real Socket owner while the supervisor stays alive.
        process.stdout._destroy = Socket.prototype._destroy;
        process.stdout.destroy();
        if (process.platform === 'win32') createRequire(import.meta.url)(
          path.join(fixtureRoot, 'stdout-close/build/Release/stdout_close.node')).closeOriginalStdout();
        else fs.closeSync(1);
        record({ transport: 'original-event-pipe-destroyed' });
      });
    }, 300);
  }
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  // The first credit is the native startup grant. A later credit acknowledges
  // actual consumed protocol frames, including the ordered hello handshake.
  if (request.op === 'flow:credit') {
    creditsObserved++;
    if (helloForwarded && creditsObserved > 1 && !nativeReady) {
      nativeReady = true; record({ nativeReady: true });
    }
  }
  if (mode === 'interrupt' || mode === 'event-transport-error') record({ request: request.op });
  if (request.op === 'job:run') {
    delete request.argv;
    request.command = process.execPath;
    request.args = ['-e', `const fs=require('node:fs');const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify({descendant:child.pid})+'\\n');
      child.unref();setInterval(()=>process.stdout.write('owned job alive\\n'),50);`];
  }
  supervisor.stdin.write(JSON.stringify(request) + '\n');
}).on('close', () => {
  if (mode === 'interrupt' || mode === 'event-transport-error') record({ request: 'eof' });
  if (mode !== 'shutdown-timeout') supervisor.stdin.end();
});
supervisor.on('close', code => {
  if (mode === 'shutdown-partial-frame') process.stdout.write('{"event":', () => process.exit(code ?? 1));
  else process.exit(mode === 'shutdown-error' ? 19 : code ?? 1);
});

// Test transport instrumentation forwards the real supervisor protocol and replaces
// only the interactive demo command with an owned long-running descendant family.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
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
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  process.stdout.write(line + '\n');
  const event = JSON.parse(line);
  if (event.event === 'job:spawn') record({ job: event.pid, jobId: event.jobId });
  if (event.event === 'job:spawn' && mode === 'supervisor-error' && !failed) {
    failed = true;
    setTimeout(() => { supervisor.kill('SIGKILL'); process.exit(19); }, 300);
  }
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.op === 'job:run') {
    delete request.argv;
    request.command = process.execPath;
    request.args = ['-e', `const fs=require('node:fs');const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify({descendant:child.pid})+'\\n');
      child.unref();setInterval(()=>process.stdout.write('owned job alive\\n'),50);`];
  }
  supervisor.stdin.write(JSON.stringify(request) + '\n');
}).on('close', () => supervisor.stdin.end());
supervisor.on('close', code => process.exit(code ?? 1));

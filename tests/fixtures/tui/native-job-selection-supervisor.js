// Test transport instrumentation: real supervisor events are forwarded unchanged.
// Only the native help request is replaced with explicitly selected workers.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';

const root = process.cwd(), dir = getTuiEnvConfig().eventLogDir;
const record = row => fs.appendFileSync(path.join(dir, 'pids.jsonl'), JSON.stringify(row) + '\n');
const supervisor = spawn(process.execPath, [path.join(root, 'tools/tui/supervisor.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] });
record({ proxy: process.pid, supervisor: supervisor.pid });
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  process.stdout.write(line + '\n');
  const event = JSON.parse(line);
  if (event.event === 'job:spawn') record({ job: event.pid, jobId: event.jobId });
});
let runs = 0;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  record({ request: request.op, jobId: request.jobId });
  if (request.op === 'job:run') {
    runs++;
    const label = runs === 1 ? 'ALPHA' : runs === 2 ? 'BETA' : 'GAMMA';
    if (runs === 3) request.jobId = 'job-1'; // real controller's supported completed-ID reuse
    delete request.argv;
    request.title = `${label} owned worker`;
    request.command = process.execPath;
    request.args = [path.join(root, 'tests/fixtures/tui/job-selection-worker.js'), label];
  }
  supervisor.stdin.write(JSON.stringify(request) + '\n');
}).on('close', () => supervisor.stdin.end());
supervisor.on('close', code => process.exit(code ?? 1));

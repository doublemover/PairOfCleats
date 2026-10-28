// Transparent recording proxy: every request reaches the real supervisor unchanged.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';
const root = process.cwd(), dir = getTuiEnvConfig().eventLogDir;
const record = row => fs.appendFileSync(path.join(dir, 'pids.jsonl'), JSON.stringify(row) + '\n');
const supervisor = spawn(process.execPath, [path.join(root, 'tools/tui/supervisor.js')],
  { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
record({ proxy: process.pid, supervisor: supervisor.pid });
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  process.stdout.write(line + '\n');
  const event = JSON.parse(line);
  if (event.event === 'job:spawn') record({ job: event.pid, jobId: event.jobId });
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  record({ request: JSON.parse(line) }); supervisor.stdin.write(line + '\n');
}).on('close', () => supervisor.stdin.end());
supervisor.on('close', code => process.exit(code ?? 1));

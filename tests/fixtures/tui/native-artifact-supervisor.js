// Explicit fixture command substitution; the production supervisor owns all
// inventories, identity checks, side effects, cancellation and terminal events.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';

const root = process.cwd(), dir = getTuiEnvConfig().eventLogDir;
const { repo } = JSON.parse(fs.readFileSync(path.join(dir, 'artifact-mode.json'), 'utf8'));
const record = row => fs.appendFileSync(path.join(dir, 'pids.jsonl'), JSON.stringify(row) + '\n');
const supervisor = spawn(process.execPath, [path.join(root, 'tools/tui/supervisor.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] });
record({ proxy: process.pid, supervisor: supervisor.pid });
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  process.stdout.write(line + '\n');
  const event = JSON.parse(line);
  if (event.event === 'job:spawn') record({ job: event.pid, jobId: event.jobId });
});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  record({ request });
  if (request.op === 'job:run') {
    request.cwd = repo;
    request.argv = ['setup', '--help'];
    request.resultPolicy = { captureStdout: 'text', maxBytes: 65536 };
  }
  supervisor.stdin.write(JSON.stringify(request) + '\n');
}).on('close', () => supervisor.stdin.end());
supervisor.on('close', code => process.exit(code ?? 1));

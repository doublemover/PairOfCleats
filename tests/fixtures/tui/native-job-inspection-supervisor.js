// The real supervisor owns execution, capture, artifacts and terminal events.
// Only the explicitly selected fixture job command/policy is substituted.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';

const root = process.cwd(), dir = getTuiEnvConfig().eventLogDir;
const { mode, repo } = JSON.parse(fs.readFileSync(path.join(dir, 'inspection-mode.json'), 'utf8'));
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
  record({ request: request.op, jobId: request.jobId });
  if (request.op === 'job:run') {
    request.cwd = repo;
    if (mode === 'json') {
      request.argv = ['config', 'validate', '--repo', repo, '--json'];
      request.resultPolicy = { captureStdout: 'json', maxBytes: 65536 };
    } else if (mode === 'disabled') request.resultPolicy = { captureStdout: 'none' };
    else if (mode !== 'text') {
      delete request.argv;
      request.command = process.execPath;
      request.args = [path.join(root, 'tests/fixtures/tui/job-inspection-worker.js'), mode];
      request.resultPolicy = { captureStdout: 'json',
        maxBytes: mode === 'oversized' ? 512 * 1024 : mode === 'incomplete' ? 1024 : 128 };
    }
  }
  supervisor.stdin.write(JSON.stringify(request) + '\n');
}).on('close', () => supervisor.stdin.end());
supervisor.on('close', code => process.exit(code ?? 1));

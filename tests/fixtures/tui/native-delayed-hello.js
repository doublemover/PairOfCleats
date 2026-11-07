// Deliberately gate delivery of the actual supervisor handshake, never its contents.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTuiEnvConfig } from '../../../src/shared/env/tui.js';

const dir = getTuiEnvConfig().eventLogDir;
const supervisor = spawn(process.execPath,
  [fileURLToPath(new URL('../../../tools/tui/supervisor.js', import.meta.url))],
  { stdio: ['pipe', 'pipe', 'inherit'] });
let held = [], ready = false;
const forward = line => process.stdout.write(line + '\n');
const gate = setInterval(() => {
  if (!fs.existsSync(path.join(dir, 'release-hello'))) return;
  ready = true; clearInterval(gate);
  for (const line of held) forward(line);
  held = [];
}, 10);
readline.createInterface({ input: supervisor.stdout }).on('line', line => {
  if (ready) forward(line); else held.push(line);
});
readline.createInterface({ input: process.stdin }).on('line', line => supervisor.stdin.write(line + '\n'))
  .on('close', () => supervisor.stdin.end());
supervisor.on('close', code => { clearInterval(gate); process.exit(code ?? 1); });

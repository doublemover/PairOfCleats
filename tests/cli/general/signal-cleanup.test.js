#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skip } from '../../helpers/skip.js';

if (process.platform === 'win32') skip('POSIX parent-signal cleanup; Windows TerminateProcess requires native acceptance.');
const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-signal-cleanup-'));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'off' });
await fs.writeFile(path.join(temp, '.pairofcleats.json'), '{}');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'pairofcleats.js'),
      'service', 'api', '--repo', temp, '--host', '127.0.0.1', '--port', '0',
      '--allow-unauthenticated', '--json'], { cwd: temp, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    let exited = null;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', (code, observedSignal) => { exited = { code, signal: observedSignal }; });
    try {
      let ready;
      const deadline = Date.now() + 8000;
      while (!ready && Date.now() < deadline) {
        for (const line of output.split('\n')) {
          try { const row = JSON.parse(line); if (row.baseUrl) ready = row; } catch {}
        }
        if (!ready) await wait(20);
      }
      assert.ok(ready, stderr);
      assert.equal((await fetch(`${ready.baseUrl}/health`)).status, 200);
      child.kill(signal);
      const exitDeadline = Date.now() + 5000;
      while (!exited && Date.now() < exitDeadline) await wait(20);
      assert.ok(exited, 'CLI must terminate after its child cleanup');
      assert.ok(exited.signal === signal || exited.code === (signal === 'SIGINT' ? 130 : 143),
        `original cancellation signal must survive: ${JSON.stringify(exited)}`);
      let serving = true;
      const stopDeadline = Date.now() + 1000;
      while (serving && Date.now() < stopDeadline) {
        try { await fetch(`${ready.baseUrl}/health`, { signal: AbortSignal.timeout(250) }); }
        catch { serving = false; }
        if (serving) await wait(25);
      }
      assert.equal(serving, false, `${signal}: API child must not outlive the launched CLI`);
    } finally {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }
  console.log('CLI parent-only SIGINT/SIGTERM preserve cancellation and terminate their API child.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

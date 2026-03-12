#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';

if (process.platform !== 'win32') {
  console.log('LSP Windows wrapper argv forwarding test skipped on non-Windows.');
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-win-wrapper-'));
const wrapperPath = path.join(tempRoot, 'stub-lsp.cmd');
const scriptPath = path.join(tempRoot, 'stub-lsp.js');
await fs.writeFile(wrapperPath, '@echo off\r\nnode "%~dp0\\stub-lsp.js" --mode wrapper %*\r\n', 'utf8');
await fs.writeFile(scriptPath, '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');

const spawned = [];
const makeChild = () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const handlers = new Map();
  return {
    pid: 1234,
    exitCode: null,
    killed: false,
    stdin,
    stdout,
    stderr,
    on(event, handler) {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
      return this;
    },
    once(event, handler) {
      const wrapped = (...args) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    },
    off(event, handler) {
      const list = handlers.get(event) || [];
      handlers.set(event, list.filter((entry) => entry !== handler));
      return this;
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) || []) handler(...args);
    },
    kill() {
      this.killed = true;
      this.exitCode = 0;
      this.emit('exit', 0, null);
      this.emit('close', 0, null);
      return true;
    }
  };
};

const client = createLspClient({
  cmd: wrapperPath,
  args: ['--stdio'],
  cwd: tempRoot,
  log: () => {},
  spawnProcess({ cmd, args, options }) {
    spawned.push({ cmd, args, options });
    return makeChild();
  }
});

try {
  client.start();
  assert.equal(spawned.length, 1, 'expected one wrapper-backed child spawn');
  assert.ok(Array.isArray(spawned[0].args), 'expected resolved argv to be forwarded to spawn');
  assert.equal(spawned[0].args.includes('--mode'), true, 'expected fixed wrapper args to be forwarded');
  assert.equal(spawned[0].args.includes('--stdio'), true, 'expected caller args to be forwarded for %* wrappers');
} finally {
  await Promise.resolve(client.kill());
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('LSP Windows wrapper argv forwarding test passed');

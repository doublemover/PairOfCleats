#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';

const createEventEmitterLike = () => ({
  on() {},
  once() {},
  off() {}
});

{
  const badChild = {
    ...createEventEmitterLike(),
    exitCode: null,
    killed: false
  };
  const client = createLspClient({
    cmd: process.execPath,
    args: [],
    log: () => {},
    spawnProcess: () => badChild
  });
  assert.throws(
    () => client.start(),
    /stdin\/stdout stream objects/i,
    'expected spawn override validation to reject missing stdin/stdout streams'
  );
}

{
  const badChild = {
    ...createEventEmitterLike(),
    exitCode: null,
    killed: false,
    stdin: {
      write() {},
      end() {},
      on() {},
      once() {},
      off() {}
    },
    stdout: {
      on() {},
      once() {},
      off() {},
      destroy() {}
    },
    stderr: {}
  };
  const client = createLspClient({
    cmd: process.execPath,
    args: [],
    log: () => {},
    spawnProcess: () => badChild
  });
  assert.throws(
    () => client.start(),
    /stderr stream/i,
    'expected spawn override validation to reject invalid stderr stream object'
  );
}

{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-cmd-options-'));
  try {
    const cmd = path.join(tempRoot, 'conditional.cmd');
    await fs.writeFile(cmd, '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\server.js" %*\r\n');
    let observed = null;
    const client = createLspClient({
      cmd,
      args: ['%TEMP%&literal!bang^caret'],
      shell: true,
      log: () => {},
      spawnProcess: (input) => {
        observed = input;
        throw new Error('stop after observing spawn options');
      }
    });
    assert.throws(() => client.start(), /stop after observing spawn options/u);
    assert.equal(path.basename(observed.cmd).toLowerCase(), 'cmd.exe');
    assert.equal(observed.options.shell, false);
    assert.equal(observed.options.windowsVerbatimArguments, true, 'LSP launch must retain pre-escaped cmd argv transport');
    assert.deepEqual(observed.rawArgs, ['%TEMP%&literal!bang^caret']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

console.log('lsp spawn-process override contract test passed');

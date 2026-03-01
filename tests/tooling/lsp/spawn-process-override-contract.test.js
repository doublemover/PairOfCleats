#!/usr/bin/env node
import assert from 'node:assert/strict';
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

console.log('lsp spawn-process override contract test passed');

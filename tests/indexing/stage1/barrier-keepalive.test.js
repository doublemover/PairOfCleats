#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { waitForChildExit } from '../../helpers/process-lifecycle.js';

ensureTestingEnv(process.env);

const keepaliveScript = [
  "import { awaitStage1Barrier } from './src/index/build/indexer/steps/process-files.js';",
  'await awaitStage1Barrier(new Promise(() => {}));'
].join('\n');

const keepaliveChild = spawn(
  process.execPath,
  ['--input-type=module', '-e', keepaliveScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let keepaliveStderr = '';
keepaliveChild.stderr.on('data', (chunk) => {
  keepaliveStderr += String(chunk);
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  keepaliveChild.exitCode,
  null,
  `expected stage1 barrier child to remain alive while promise is pending; stderr=${keepaliveStderr || '<empty>'}`
);
keepaliveChild.kill();
const keepaliveExitCode = await waitForChildExit(keepaliveChild, {
  timeoutMs: 5000,
  forceSignal: 'SIGKILL'
});
assert.notEqual(
  keepaliveExitCode,
  13,
  `expected stage1 barrier keepalive to avoid unsettled top-level await exit 13; stderr=${keepaliveStderr || '<empty>'}`
);

const allSettledScript = [
  "import { awaitStage1Barrier } from './src/index/build/indexer/steps/process-files.js';",
  'await awaitStage1Barrier(Promise.allSettled([new Promise(() => {})]));'
].join('\n');

const allSettledChild = spawn(
  process.execPath,
  ['--input-type=module', '-e', allSettledScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let allSettledStderr = '';
allSettledChild.stderr.on('data', (chunk) => {
  allSettledStderr += String(chunk);
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  allSettledChild.exitCode,
  null,
  `expected Promise.allSettled stage1 barrier child to remain alive while promise is pending; stderr=${allSettledStderr || '<empty>'}`
);
allSettledChild.kill();
const allSettledExitCode = await waitForChildExit(allSettledChild, {
  timeoutMs: 5000,
  forceSignal: 'SIGKILL'
});
assert.notEqual(
  allSettledExitCode,
  13,
  `expected stage1 barrier Promise.allSettled keepalive to avoid unsettled top-level await exit 13; stderr=${allSettledStderr || '<empty>'}`
);

console.log('stage1 barrier keepalive test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runLineStreamingCommand } from '../../../tools/ingest/shared-runner.js';

ensureTestingEnv(process.env);

const longRunningArgs = [
  '-e',
  [
    'let ticks = 0;',
    'const timer = setInterval(() => {',
    '  ticks += 1;',
    '  console.log(`tick-${ticks}`);',
    '  if (ticks >= 3) {',
    '    clearInterval(timer);',
    '    process.exit(0);',
    '  }',
    '}, 450);'
  ].join('\n')
];

const observedLines = [];
const startedAt = Date.now();
await runLineStreamingCommand({
  command: process.execPath,
  args: longRunningArgs,
  timeoutMs: null,
  onStdoutLine: async (line) => {
    observedLines.push(String(line || ''));
  }
});
const elapsedMs = Date.now() - startedAt;
assert.equal(observedLines.length, 3, 'expected full stdout stream from long-running command');
assert.equal(elapsedMs >= 1200, true, `expected no-timeout run to complete naturally (elapsed=${elapsedMs}ms)`);

await assert.rejects(
  () => runLineStreamingCommand({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);'],
    timeoutMs: 100
  }),
  (error) => error?.code === 'ERR_INGEST_COMMAND_TIMEOUT' && Number(error?.timeoutMs) === 1000,
  'expected explicit timeout to terminate command via ERR_INGEST_COMMAND_TIMEOUT'
);

console.log('ingest shared-runner timeout opt-in test passed');

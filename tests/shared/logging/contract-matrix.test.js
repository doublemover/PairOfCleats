#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { createWarnOnce, normalizeWarnOnceKey } from '../../../src/shared/logging/warn-once.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

{
  const messages = [];
  const warnOnce = createWarnOnce({ logger: (message) => messages.push(message) });
  assert.equal(warnOnce('dedupe-key', 'first warning'), true);
  assert.equal(warnOnce('dedupe-key', 'second warning'), false);
  assert.deepEqual(messages, ['first warning']);
  warnOnce.reset();
  messages.length = 0;
  assert.equal(warnOnce('message-only warning'), true);
  assert.equal(warnOnce('message-only warning'), false);
  assert.deepEqual(messages, ['message-only warning']);
  warnOnce.reset();
  messages.length = 0;
  const keyA = { b: 2, a: 1 };
  const keyB = { a: 1, b: 2 };
  assert.equal(normalizeWarnOnceKey(keyA), normalizeWarnOnceKey(keyB));
  assert.equal(warnOnce(keyA, 'stable-key warning'), true);
  assert.equal(warnOnce(keyB, 'duplicate stable-key warning'), false);
  assert.deepEqual(messages, ['stable-key warning']);
}

{
  const root = process.cwd();
  const binPath = path.join(root, 'bin', 'pairofcleats.js');
  const result = spawnSubprocessSync(process.execPath, [binPath, 'version'], {
    env: applyTestEnv({ syncProcess: false }),
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false
  });
  assert.equal(result.exitCode, 0);
  assert.equal((result.stdout || '').trim(), '');
  assert.ok((result.stderr || '').trim().length > 0);
}

console.log('shared logging contract matrix test passed');

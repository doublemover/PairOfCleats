#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { waitForChildExit } from './process-lifecycle.js';

const createFakeChild = () => {
  const emitter = new EventEmitter();
  emitter.exitCode = null;
  emitter.killed = false;
  emitter.kill = () => {
    emitter.killed = true;
    return true;
  };
  return emitter;
};

{
  const child = createFakeChild();
  const startedAt = Date.now();
  const code = await waitForChildExit(child, {
    timeoutMs: 100,
    forceWaitMs: 120
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(code, null, 'expected bounded post-force wait to resolve without exit event');
  assert.equal(elapsedMs >= 200, true, `expected timeout + force wait window, got ${elapsedMs}ms`);
}

{
  const child = createFakeChild();
  child.kill = () => {
    child.killed = true;
    setTimeout(() => {
      child.exitCode = 9;
      child.emit('exit', 9);
    }, 40);
    return true;
  };
  const code = await waitForChildExit(child, {
    timeoutMs: 100,
    forceWaitMs: 500
  });
  assert.equal(code, 9, 'expected real exit code when child exits after force signal');
}

console.log('process lifecycle force-timeout test passed');

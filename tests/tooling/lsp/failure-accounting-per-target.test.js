#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createToolingGuard } from '../../../src/integrations/tooling/providers/shared.js';

const guard = createToolingGuard({
  name: 'lsp-guard-test',
  retries: 1,
  breakerThreshold: 1,
  timeoutMs: 100,
  log: () => {}
});

let attempt = 0;
await guard.run(() => {
  attempt += 1;
  if (attempt === 1) throw new Error('first failure');
  return 'ok';
});

assert.equal(guard.isOpen(), false, 'expected retries within a target not to trip breaker');

let threw = false;
try {
  await guard.run(() => {
    throw new Error('target failure');
  });
} catch {
  threw = true;
}

assert.ok(threw, 'expected failing target to throw');
assert.equal(guard.isOpen(), true, 'expected breaker to trip after target failure');

console.log('LSP failure accounting test passed');

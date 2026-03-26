#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { buildRiskDeltaPayload } from '../../src/context-pack/risk-delta.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-invalid-seed-'));

let contextPackError = null;
try {
  await buildCompositeContextPackPayload({
    repoRoot,
    seed: 'foo',
    hops: 0
  });
} catch (err) {
  contextPackError = err;
}

assert.ok(contextPackError, 'expected malformed context-pack seed to fail');
assert.equal(contextPackError.code, 'ERR_CONTEXT_PACK_INVALID_REQUEST');
assert.match(String(contextPackError.message || ''), /invalid .*seed/i);

let riskDeltaError = null;
try {
  await buildRiskDeltaPayload({
    repoRoot,
    from: 'build:a',
    to: 'build:b',
    seed: 'foo'
  });
} catch (err) {
  riskDeltaError = err;
}

assert.ok(riskDeltaError, 'expected malformed risk-delta seed to fail');
assert.equal(riskDeltaError.code, ERROR_CODES.INVALID_REQUEST);
assert.equal(riskDeltaError.reason, 'invalid_seed');
assert.match(String(riskDeltaError.message || ''), /invalid .*seed/i);

await fs.rm(repoRoot, { recursive: true, force: true });

console.log('context-pack invalid seed classification test passed');

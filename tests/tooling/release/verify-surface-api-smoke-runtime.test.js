#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runVerifySurface } from '../../helpers/release-verify-surface.js';

const apiSmoke = await runVerifySurface('api', 'smoke');
assert.equal(apiSmoke.checks?.status, true, 'expected api smoke to verify /status');
assert.equal(apiSmoke.checks?.capabilities, true, 'expected api smoke to verify /capabilities');
assert.equal(apiSmoke.checks?.search, true, 'expected api smoke to verify /search');

console.log('release verify-surface api smoke runtime test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runVerifySurface } from '../../helpers/release-verify-surface.js';

const apiBoot = await runVerifySurface('api', 'boot');
assert.equal(apiBoot.checks?.health, true, 'expected api boot to verify /health');

console.log('release verify-surface api boot runtime test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runVerifySurface } from '../../helpers/release-verify-surface.js';

const mcpBoot = await runVerifySurface('mcp', 'boot');
assert.equal(mcpBoot.checks?.initialize, true, 'expected mcp boot to verify initialize');

console.log('release verify-surface mcp boot runtime test passed');

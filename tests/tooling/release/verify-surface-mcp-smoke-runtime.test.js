#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runVerifySurface } from '../../helpers/release-verify-surface.js';

const mcpSmoke = await runVerifySurface('mcp', 'smoke');
assert.equal(mcpSmoke.checks?.toolsList, true, 'expected mcp smoke to verify tools/list');
assert.equal(mcpSmoke.checks?.indexStatus, true, 'expected mcp smoke to verify index_status');
assert.equal(mcpSmoke.checks?.search, true, 'expected mcp smoke to verify search');

console.log('release verify-surface mcp smoke runtime test passed');

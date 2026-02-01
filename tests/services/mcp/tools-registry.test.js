#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { TOOL_HANDLERS } from '../../../tools/mcp/tools.js';

const defs = getToolDefs('test-model');
const defNames = new Set(defs.map((entry) => entry.name));
const handlerNames = new Set(TOOL_HANDLERS.keys());

const missing = Array.from(defNames).filter((name) => !handlerNames.has(name));
const extra = Array.from(handlerNames).filter((name) => !defNames.has(name));

assert.deepEqual(missing, [], `missing tool handlers: ${missing.join(', ')}`);
assert.deepEqual(extra, [], `extra tool handlers: ${extra.join(', ')}`);

console.log('mcp tools registry test passed');

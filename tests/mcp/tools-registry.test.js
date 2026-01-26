#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getToolDefs } from '../../src/integrations/mcp/defs.js';

const root = process.cwd();
const source = await fs.readFile(path.join(root, 'tools', 'mcp', 'tools.js'), 'utf8');
const caseMatches = Array.from(source.matchAll(/case\s+'([^']+)'/g)).map((match) => match[1]);
const caseSet = new Set(caseMatches);

const defs = getToolDefs('test-model');
const missing = defs.map((entry) => entry.name).filter((name) => !caseSet.has(name));

assert.deepEqual(missing, [], `missing tool handlers: ${missing.join(', ')}`);

console.log('mcp tools registry test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFormat } from '../../../src/integrations/tooling/cli-helpers.js';

assert.equal(resolveFormat({}), 'md', 'expected markdown default when no flags are provided');
assert.equal(resolveFormat({ json: true }), 'json', 'expected --json to force json format');
assert.equal(resolveFormat({ format: 'md' }), 'md', 'expected explicit md format');
assert.equal(resolveFormat({ format: 'markdown' }), 'md', 'expected markdown alias to resolve to md');
assert.equal(resolveFormat({ format: 'json' }), 'json', 'expected explicit json format');
assert.equal(resolveFormat({ format: 'unexpected' }), 'json', 'expected unknown format to normalize to json');

console.log('cli-helpers resolveFormat test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { describeDispatchCommand } from '../../src/shared/dispatch/manifest.js';

const byId = describeDispatchCommand('search');
assert(byId, 'expected search command in dispatch manifest');
assert.equal(byId.script, 'search.js');
assert.ok(Array.isArray(byId.metadata.backendEnum), 'expected backend enum metadata for search');
assert(byId.metadata.backendEnum.includes('tantivy'), 'search backend metadata should include tantivy');
assert(byId.metadata.backendEnum.includes('memory'), 'search backend metadata should include memory');

const byPath = describeDispatchCommand('search');
assert.deepEqual(byPath, byId, 'path/id resolution should return the same manifest entry for search');

console.log('dispatch manifest describe search test passed');

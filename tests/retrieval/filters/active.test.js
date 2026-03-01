#!/usr/bin/env node
import assert from 'node:assert/strict';
import { hasActiveFilters } from '../../../src/retrieval/filters.js';

assert.equal(hasActiveFilters(null), false);
assert.equal(hasActiveFilters(undefined), false);
assert.equal(hasActiveFilters({}), false);
assert.equal(hasActiveFilters({ filePrefilter: { enabled: true } }), false);
assert.equal(hasActiveFilters({ caseFile: true, caseTokens: true }), false);
assert.equal(hasActiveFilters({ excludeTokens: ['alpha'], excludePhrases: ['beta'] }), false);

assert.equal(hasActiveFilters({ ext: ['.js'] }), true);
assert.equal(hasActiveFilters({ type: 'function' }), true);
assert.equal(hasActiveFilters({ meta: [{ key: 'owner', value: 'me' }] }), true);
assert.equal(hasActiveFilters({ churnMin: 0 }), true);

console.log('hasActiveFilters guard tests passed.');

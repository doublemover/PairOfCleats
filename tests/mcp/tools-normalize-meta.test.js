#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeMetaFilters } from '../../tools/mcp/tools.js';

const objectOut = normalizeMetaFilters({ team: 'alpha', env: 'prod' });
assert.deepEqual(
  [...objectOut].sort(),
  ['env=prod', 'team=alpha'].sort()
);

const arrayOut = normalizeMetaFilters([{ owner: 'me' }, 'tag', { blank: '' }]);
assert.deepEqual(
  [...arrayOut].sort(),
  ['owner=me', 'tag', 'blank'].sort()
);

const scalarOut = normalizeMetaFilters('solo');
assert.deepEqual(scalarOut, ['solo']);

console.log('mcp normalize meta filters test passed');

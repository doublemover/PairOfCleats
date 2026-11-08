#!/usr/bin/env node
import assert from 'node:assert/strict';
import { recordsLogicalContentHash } from '../../../src/integrations/triage/index-records.js';
const input = { text: 'same markdown', recordMeta: { source: 'triage' }, policy: { promoteFields: ['source', 'cve'] } };
const first = recordsLogicalContentHash({ ...input, record: { source: 'a', cve: 'old' } });
assert.equal(first, recordsLogicalContentHash({ ...input, record: { cve: 'old', source: 'a' } }));
assert.notEqual(first, recordsLogicalContentHash({ ...input, record: { source: 'b', cve: 'new' } }));
assert.notEqual(first, recordsLogicalContentHash({ ...input, record: null }));
assert.notEqual(first, recordsLogicalContentHash({ ...input, text: 'new text', record: { source: 'a', cve: 'old' } }));

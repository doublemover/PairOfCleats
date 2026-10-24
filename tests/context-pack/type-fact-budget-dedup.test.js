import assert from 'node:assert/strict';
import { normalizeTypeFacts } from '../../src/context-pack/excerpt-cache.js';
const fact = { type: 'number', source: 'compiler', confidence: 1 };
const warnings = [];
const facts = normalizeTypeFacts({ type: 'chunk', chunkUid: 'a' }, {
  docmeta: { inferredTypes: { params: { value: [fact, fact] }, returns: [fact] } }
}, 2, warnings);
assert.equal(facts.length, 2);
assert.ok(facts.some((entry) => entry.role === 'return'), 'duplicate parameter facts cannot crowd return evidence out of the budget');
assert.equal(warnings.length, 0);
const disagreement = normalizeTypeFacts(null, { docmeta: { inferredTypes: { returns: [fact, { ...fact, source: 'heuristic' }] } } }, 2, []);
assert.equal(disagreement.length, 2, 'independent evidence must remain distinguishable');
console.log('context type budget admits unique evidence and preserves provenance');

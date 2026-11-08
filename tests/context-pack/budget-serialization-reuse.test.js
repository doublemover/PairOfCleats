import assert from 'node:assert/strict';
import { enforceContextPackResponseBudget, CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../../src/context-pack/response-budget.js';
const payload = { primary: { excerpt: '保留' }, graph: { nodes: Array.from({ length: 2000 }, (_, id) => ({ id, text: 'x'.repeat(150) })) } };
const stringify = JSON.stringify;
let calls = 0;
try {
  JSON.stringify = (...args) => { calls++; return stringify(...args); };
  enforceContextPackResponseBudget(payload);
} finally { JSON.stringify = stringify; }
assert.equal(calls, 3, 'absent sections and the unchanged terminal check do not encode the payload again');
assert.equal(payload.graph, null);
assert.deepEqual(payload.warnings[0].omitted, ['graph']);
assert.ok(Buffer.byteLength(stringify(payload, null, 2)) <= CONTEXT_PACK_RESPONSE_MAX_BYTES);
assert.throws(() => enforceContextPackResponseBudget({ primary: { excerpt: '😀'.repeat(50000) } }),
  { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
assert.throws(() => enforceContextPackResponseBudget({ primary: {}, risk: { data: 'x'.repeat(200000) } }, { strictRisk: true }),
  { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
console.log('Exact context budgeting reuses byte counts only while the request payload is unchanged.');

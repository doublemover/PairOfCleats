import assert from 'node:assert/strict';
import { enforceContextPackResponseBudget, CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../../src/context-pack/response-budget.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';

const payload = { primary: { excerpt: 'export function sum(a, b) { return a + b; }' },
  graph: { nodes: [{ id: 'sum' }] }, risk: { detail: 'x'.repeat(CONTEXT_PACK_RESPONSE_MAX_BYTES) } };
const result = enforceContextPackResponseBudget(payload);
assert.ok(Buffer.byteLength(JSON.stringify(result)) <= CONTEXT_PACK_RESPONSE_MAX_BYTES);
assert.equal(result.primary.excerpt, 'export function sum(a, b) { return a + b; }');
assert.equal(result.graph.nodes[0].id, 'sum');
assert.equal(result.risk, null);
assert.deepEqual(result.warnings[0].omitted, ['risk']);
assert.throws(() => enforceContextPackResponseBudget({ primary: { excerpt: 'x'.repeat(CONTEXT_PACK_RESPONSE_MAX_BYTES) } }), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
assert.throws(() => enforceContextPackResponseBudget({ primary: {}, risk: { detail: 'x'.repeat(CONTEXT_PACK_RESPONSE_MAX_BYTES) } }, { strictRisk: true }), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
const assembled = assembleCompositeContextPack({ seed: { type: 'file', path: 'tests/fixtures/context-pack/sample.js' },
  chunkMeta: [{ chunkUid: 'sample', file: 'tests/fixtures/context-pack/sample.js', start: 0, end: 20 }],
  repoRoot: process.cwd(), indexSignature: 'test', includeGraph: false });
assembled.semantic = { oversized: 'x'.repeat(CONTEXT_PACK_RESPONSE_MAX_BYTES) };
const bounded = enforceContextPackResponseBudget(assembled);
assert.ok(!Object.hasOwn(bounded, 'semantic'));
const validation = validateCompositeContextPack(bounded);
assert.ok(validation.ok, JSON.stringify(validation.errors));
console.log('Whole context response budget preserves primary and graph evidence, with explicit omissions.');

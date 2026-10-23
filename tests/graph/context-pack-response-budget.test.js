import assert from 'node:assert/strict';
import { enforceContextPackResponseBudget, CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../../src/context-pack/response-budget.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { attachSemanticContextSection } from '../../src/context-pack/assemble/finalize.js';
import { renderCompositeContextPackJson } from '../../src/retrieval/output/composite-context-pack.js';
import { emitCliOutput } from '../../src/integrations/tooling/cli-helpers.js';
import { COMPOSITE_CONTEXT_PACK_SCHEMA } from '../../src/contracts/schemas/analysis.js';
import { compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';

const directSchema = compileSchema(createAjv({ allErrors: true, strict: true, allowUnionTypes: true }), COMPOSITE_CONTEXT_PACK_SCHEMA);

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

const primaryOnly = structuredClone(assembled);
primaryOnly.primary.excerpt = '界😀"\\\n'.repeat(10000);
const beforeRender = JSON.stringify(primaryOnly);
assert.throws(() => renderCompositeContextPackJson(primaryOnly), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' },
  'mandatory primary plus derived public companions must fit, even when risk is absent');
assert.equal(JSON.stringify(primaryOnly), beforeRender, 'render budgeting must not mutate the native caller payload');
let output = '';
const originalLog = console.log;
try {
  console.log = text => { output += text + '\n'; };
  emitCliOutput({ format: 'json', payload: assembled, renderJson: renderCompositeContextPackJson });
} finally { console.log = originalLog; }
assert.ok(Buffer.byteLength(output) <= CONTEXT_PACK_RESPONSE_MAX_BYTES, 'assert actual final stdout including pretty JSON/newline');
assert.equal(validateCompositeContextPack(JSON.parse(output)).ok, true);

const semantic = status => ({ schemaVersion: 1, repoRoot: process.cwd(), generation: null, status,
  selector: null, discovery: null, detail: null, trace: null, excerpts: [], followUps: [], warnings: [] });
const base = assembleCompositeContextPack({ seed: { type: 'file', path: 'tests/fixtures/context-pack/sample.js' },
  chunkMeta: [{ chunkUid: 'sample', file: 'tests/fixtures/context-pack/sample.js', start: 0, end: 20 }],
  repoRoot: process.cwd(), indexSignature: 'semantic-budget', includeGraph: false });
for (const status of ['partial', 'unavailable']) {
  const retained = attachSemanticContextSection(structuredClone(base), semantic(status));
  assert.equal(validateCompositeContextPack(retained).ok, true);
  assert.equal(directSchema(retained), true, 'standalone schema accepts normally attached semantic evidence');
  const withinBudget = enforceContextPackResponseBudget(retained);
  assert.equal(withinBudget.semantic.status, status);
  assert.deepEqual(withinBudget.evidence.semantic, { included: true, state: status });

  const oversized = attachSemanticContextSection(structuredClone(base), {
    ...semantic(status), warnings: ['x'.repeat(CONTEXT_PACK_RESPONSE_MAX_BYTES)]
  });
  assert.equal(validateCompositeContextPack(oversized).ok, true, 'normal attachment must validate before budgeting');
  const originalPrimary = structuredClone(oversized.primary);
  const omitted = enforceContextPackResponseBudget(oversized);
  assert.ok(!Object.hasOwn(omitted, 'semantic'));
  assert.equal(omitted.evidence.semantic.included, false, 'omitted semantic evidence cannot claim inclusion');
  assert.equal(omitted.evidence.semantic.state, 'omitted');
  assert.equal(omitted.evidence.semantic.truncated, true);
  assert.deepEqual(omitted.evidence.semantic.warningCodes, ['CONTEXT_PACK_RESPONSE_BUDGET']);
  assert.equal(omitted.evidence.complete, false);
  assert.deepEqual(omitted.primary, originalPrimary);
  assert.ok(omitted.warnings.some(warning => warning.code === 'CONTEXT_PACK_RESPONSE_BUDGET' && warning.omitted.includes('semantic')));
  assert.equal(validateCompositeContextPack(omitted).ok, true);
  assert.equal(directSchema(omitted), true, 'standalone schema accepts the actual omitted response');
  assert.ok(Buffer.byteLength(JSON.stringify(omitted, null, 2)) <= CONTEXT_PACK_RESPONSE_MAX_BYTES);
  const once = structuredClone(omitted);
  assert.deepEqual(enforceContextPackResponseBudget(omitted), once, 'rebudgeting cannot duplicate omission warnings');

  const staleInclusion = structuredClone(withinBudget);
  delete staleInclusion.semantic;
  assert.equal(validateCompositeContextPack(staleInclusion).ok, false, 'absent semantic cannot retain included=true');
  assert.equal(directSchema(staleInclusion), false, 'standalone schemas reject absent included evidence');
  const contradictory = structuredClone(withinBudget);
  contradictory.evidence.semantic = { included: false, state: 'omitted' };
  assert.equal(validateCompositeContextPack(contradictory).ok, false, 'present semantic must have matching included metadata');
  assert.equal(directSchema(contradictory), false);
  const wrongState = structuredClone(withinBudget);
  wrongState.evidence.semantic.state = status === 'partial' ? 'unavailable' : 'partial';
  assert.equal(validateCompositeContextPack(wrongState).ok, false, 'semantic state must describe the attached section');
  assert.equal(directSchema(wrongState), false);
  const missingMetadata = structuredClone(withinBudget);
  delete missingMetadata.evidence.semantic;
  assert.equal(validateCompositeContextPack(missingMetadata).ok, false, 'present semantic requires its evidence metadata');
  assert.equal(directSchema(missingMetadata), false);
  const falseComplete = structuredClone(withinBudget);
  falseComplete.evidence.complete = true;
  assert.equal(validateCompositeContextPack(falseComplete).ok, false, 'partial semantic evidence cannot claim complete context');
  assert.equal(directSchema(falseComplete), false);
}
console.log('Whole context response budget preserves primary and graph evidence, with explicit omissions.');

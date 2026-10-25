import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { buildRetrievalMetadata } from '../../../src/retrieval/output/retrieval-metadata.js';
import { createRetrievalExecutionOutcome } from '../../../src/retrieval/pipeline/execution-outcome.js';
import { createRetrievalEvidenceRegistry, captureRetrievalExecutionEvidence, assertQualifiedEvaluationComparison } from '../../../tools/shared/retrieval-execution-evidence.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const hit = { file: 'fixture.ts', name: 'greeting', kind: 'FunctionDeclaration', chunkUid: 'fixture:1' };
const response = ({ selected = 'memory', buildId = 'build-a', policy = 'a', fallback = false, cacheHit = false, ann = false } = {}) => ({
  code: [hit], retrieval: buildRetrievalMetadata({ backendLabel: selected, effectivePlanIdentity: 'eqp1-' + (policy.length === 64 ? policy : policy.repeat(64)),
    backendPolicyInfo: { requested: 'auto', reason: fallback ? 'sqlite unavailable; memory fallback' : 'selected-by-policy' },
    cacheInfo: { hit: cacheHit, strategy: 'disk-first', memoryHotPath: false },
    idxCode: { state: { buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, profile: { id: 'fixture-default' } } },
    indexSignaturePayload: { modes: { code: 'fixture-signature' }, generationByMode: { code: {
      buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generationKey: buildId, activeBuildRoot: `fixture/${buildId}` } } },
    executionOutcomes: { code: createRetrievalExecutionOutcome({ mode: 'code', requestedSparse: 'js-bm25',
      effectiveSparse: 'bm25', annRequested: ann, annMetrics: ann ? { providerAvailable: true, source: 'dense' } : null }) }
  })
});

const registry = createRetrievalEvidenceRegistry();
const original = response();
registry.observe(original, ['code']);
original.retrieval.freshness.byMode.code.buildId = 'mutated-after-observation';
for (let i = 0; i < 20; i++) registry.observe(response({ cacheHit: i % 2 === 0 }), ['code']);
const stable = registry.snapshot();
assert.equal(stable.status, 'qualified');
assert.equal(stable.consistency, 'stable');
assert.equal(stable.receipts.length, 2, 'cache facts remain captured without changing system consistency');
assert.equal(stable.observations, 21);
assert.ok(stable.receipts.every(row => row.receipt.generations.code.buildId === 'build-a'));
registry.observe(response({ buildId: 'build-b' }), ['code']);
assert.equal(registry.snapshot().consistency, 'mixed');
assert.equal(stable.observations, 21, 'earlier snapshots cannot change with the registry');
const unavailable = captureRetrievalExecutionEvidence({ code: [] }, ['code']);
assert.equal(unavailable.qualification.state, 'unqualified');
assert.ok(unavailable.qualification.reasons.includes('observed-backend-missing'));
let getterCalls = 0;
assert.throws(() => captureRetrievalExecutionEvidence({ retrieval: Object.defineProperty({}, 'backend', {
  get() { getterCalls++; return {}; }
}) }, ['code']), { code: 'ERR_RETRIEVAL_EVIDENCE' });
assert.equal(getterCalls, 0);
const bounded = createRetrievalEvidenceRegistry();
for (let i = 0; i < 257; i++) bounded.observe(response({ buildId: `build-${i}` }), ['code']);
const boundedSnapshot = bounded.snapshot();
assert.ok(boundedSnapshot.receipts.length <= 256);
assert.ok(boundedSnapshot.retainedBytes <= 512 * 1024);
assert.ok(boundedSnapshot.omittedReceipts > 0);
assert.equal(boundedSnapshot.status, 'unqualified');

const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
const stubs = {
  '../shared/operator-cli-options.js': 'export const EVAL_OPTIONS = {};',
  'node:fs': 'export default {readFileSync(){return JSON.stringify(globalThis.evalIdentityFixture.dataset);}};',
  '../../src/shared/cli.js': 'export const createCli = () => ({parse:()=>({dataset:"same-path.json",top:5,backend:"auto",ann:true,"match-mode":globalThis.evalIdentityFixture.matchMode})});',
  '../shared/cli-display.js': 'export const createToolDisplay=()=>({task(){return {set(){}};},close(){globalThis.evalIdentityFixture.closed++;},error(message){throw new Error(message);}});',
  '../../src/integrations/core/index.js': 'export const search=async()=>globalThis.evalIdentityFixture.payloads.shift();',
  '../../src/retrieval/sqlite-cache.js': 'export const createSqliteDbCache=()=>({retainFailure(){},pendingOwners(){return [];},dispose(){globalThis.evalIdentityFixture.cacheClosed++;}});'
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.split('?')[0] === runner && Object.hasOwn(stubs, specifier)) return {
    url: 'eval-observed-identity:' + encodeURIComponent(specifier), shortCircuit: true
  };
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith('eval-observed-identity:')) return { format: 'module', source: stubs[decodeURIComponent(url.slice('eval-observed-identity:'.length))], shortCircuit: true };
  return next(url, context);
} });
const log = console.log;
let run = 0;
try {
  const execute = async (payloads, { matchMode = 'exact', label = 'greeting', queries = ['first', 'second'] } = {}) => {
    const fixture = { payloads, matchMode, closed: 0, cacheClosed: 0, lines: [],
      dataset: queries.map(query => ({ query, mode: 'code', relevant: [{ file: hit.file, name: label }] })) };
    globalThis.evalIdentityFixture = fixture; console.log = line => fixture.lines.push(line);
    await import(`${runner}?observed-execution=${run++}`);
    assert.equal(fixture.closed, 1); assert.equal(fixture.cacheClosed, 1);
    return JSON.parse(fixture.lines[0]);
  };
  const memory = await execute([response(), response({ cacheHit: true })]);
  const sqlite = await execute([response({ selected: 'sqlite' }), response({ selected: 'sqlite' })]);
  assert.equal(memory.summary.mrr, sqlite.summary.mrr);
  assertQualifiedEvaluationComparison(memory, sqlite);
  assert.notEqual(memory.executionEvidence.key, sqlite.executionEvidence.key, 'identical scores cannot erase observed backend identity');
  assert.equal(memory.executionEvidence.receipts[0].receipt.backend.selected, 'memory');
  assert.equal(sqlite.executionEvidence.receipts[0].receipt.backend.selected, 'sqlite');
  assert.equal(memory.executionEvidence.receipts[0].receipt.execution.code.requested.ann, false);
  assert.equal(memory.executionEvidence.receipts[0].receipt.execution.code.effective.ann, null,
    'requested CLI ANN is not proof of actual ANN execution');
  const dense = await execute([response({ ann: true }), response({ ann: true })]);
  assert.equal(dense.executionEvidence.receipts[0].receipt.execution.code.effective.ann, 'dense');
  for (const payloads of [[response(), response({ buildId: 'build-b' })], [response(), response({ policy: 'b' })]]) {
    const mixed = await execute(payloads);
    assert.equal(mixed.executionEvidence.consistency, 'mixed');
    assert.equal(mixed.results.length, 2);
    assert.equal(mixed.executionEvidence.receipts.length, 2);
    assert.throws(() => assertQualifiedEvaluationComparison(mixed), { code: 'ERR_RETRIEVAL_EVIDENCE' });
  }
  const fallback = await execute([response({ fallback: true }), response({ fallback: true })]);
  assert.equal(fallback.executionEvidence.status, 'unqualified');
  assert.equal(fallback.executionEvidence.receipts[0].receipt.fallbackDerived, true);
  assert.throws(() => assertQualifiedEvaluationComparison(fallback), { code: 'ERR_RETRIEVAL_EVIDENCE' });
  const unknown = await execute([{ code: [hit] }, { code: [hit] }]);
  assert.equal(unknown.summary.mrr, memory.summary.mrr, 'unknown provenance preserves descriptive numerical observations');
  assert.equal(unknown.executionEvidence.status, 'unqualified');
  assert.throws(() => assertQualifiedEvaluationComparison(unknown), { code: 'ERR_RETRIEVAL_EVIDENCE' });
  const changed = await execute([response(), response()], { label: 'greet' });
  assert.notEqual(changed.evaluationInput.key, memory.evaluationInput.key);
  const substring = await execute([response(), response()], { label: 'greet', matchMode: 'substring' });
  assert.notEqual(substring.evaluationInput.key, changed.evaluationInput.key);
  assert.equal(changed.matchMode, 'exact'); assert.equal(substring.matchMode, 'substring');
  assert.throws(() => assertQualifiedEvaluationComparison(memory, substring), { code: 'ERR_RETRIEVAL_EVIDENCE' });
  const changedQuery = await execute([response(), response()], { queries: ['changed', 'second'] });
  assert.notEqual(changedQuery.evaluationInput.key, memory.evaluationInput.key);
  const tampered = structuredClone(memory);
  tampered.executionEvidence.receipts[0].receipt.backend.selected = 'substituted';
  assert.throws(() => assertQualifiedEvaluationComparison(tampered), { code: 'ERR_RETRIEVAL_EVIDENCE' });
} finally { hooks.deregister(); console.log = log; delete globalThis.evalIdentityFixture; }
console.log('actual live evaluation retains observed backend/generation, input and matching-policy identity');

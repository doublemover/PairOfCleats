import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createCompilerSummarySourceIdentities } from '../../../src/index/semantic/compiler-summary-source-identity.js';
import { admitCompilerSummaryManifest, readPersistedCompilerSummaryManifest } from '../../../src/index/semantic/compiler-summary-admission.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';

// UNVALIDATED: named/body identities and the actual retained compiler consumer.
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceIdentities = text => {
  const sourceFile = ts.createSourceFile('identity.ts', text, ts.ScriptTarget.Latest, true);
  const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'summary-identity-fixture', path: 'identity.ts', language: 'typescript' }).manifest;
  const summaries = sourceFile.statements.filter(ts.isFunctionDeclaration).map((owner, localId) => ({ owner,
    declaration: { partitionId: 'sy1:' + 'a'.repeat(64), localId } }));
  const identities = createCompilerSummarySourceIdentities({ ts, sourceFile, source, summaries });
  return summaries.map(summary => identities.get(summary.owner));
};
const before = sourceIdentities('function stable(value: number) { return value; }')[0];
const edit = sourceIdentities('// shift\nfunction stable(value: number) { return value + 1; }')[0];
assert.equal(before.status, 'qualified-for-comparison'); assert.equal(edit.locatorHash, before.locatorHash);
assert.notEqual(edit.bodyHash, before.bodyHash); assert.notEqual(edit.sourceUnitId, before.sourceUnitId);
assert.notDeepEqual(edit.span, before.span, 'offsets are generation-qualified rather than stable declaration keys');
assert.equal(sourceIdentities('function renamed(value: number) { return value; }')[0].locatorHash === before.locatorHash, false);
const duplicates = sourceIdentities('function same(x: number) { return x; } function same(x: number) { return x + 1; }');
assert.ok(duplicates.every(value => value.status === 'ambiguous'));
const astralBody = 'function astral() { return "' + '𝒜'.repeat(4096) + '"; }';
const scalar = sourceIdentities(astralBody)[0];
assert.equal(scalar.bodyHash, hash(astralBody.slice(...scalar.bodySpan)), 'streamed identity never splits UTF8 surrogate encoding');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-admission-'));
const originalOpen = fs.open, disposal = new Map();
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'summary.ts': 'export {}; function leaf(value: number) { return value; } function forward(value: number) { return leaf(value); } class Box { #value = 0; store(value: number) { this.#value = value; return this.#value; } } function mutate(object: Record<string, number>, key: string, value: number) { object[key] = value; return object[key]; } const result = forward(101);' }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const declarationRef = node => {
    const anchor = node?.name || node;
    return anchor ? doc.item.declarations.get(anchor.getStart(doc.sourceFile) + ':' + anchor.end)
      || (doc.ts.isFunctionLike(node) ? doc.expressionFor(node) : null) : null;
  };
  flow.calls = doc.nodes.filter(doc.ts.isCallExpression).map(node => ({ occurrence: doc.expressionFor(node), result: doc.expressionFor(node),
    span: [node.getStart(doc.sourceFile), node.end], targets: [doc.checker.getResolvedSignature(node)?.declaration].map(declarationRef).filter(Boolean),
    invocationKind: 'call', incompleteTargets: false, arguments: node.arguments.map(doc.expressionFor), receiver: null, hasSpread: false }));
  await collectCompilerCrossFileFlow(fixture);
  const descriptor = fixture.state.semanticEvidenceArtifacts[0], filename = path.join(fixture.stagingRoot, descriptor.path);
  const manifest = JSON.parse(await fs.readFile(filename, 'utf8')), expectedIdentity = manifest.identity;
  const read = overrides => readPersistedCompilerSummaryManifest({ root: fixture.stagingRoot, descriptor,
    registeredInventory: fixture.state.semanticEvidenceArtifacts, expectedIdentity, ...overrides });
  const admitted = await read();
  assert.equal(admitted.admission.status, 'shadow-compatible'); assert.equal(admitted.admission.qualifiesReuse, false);
  assert.ok(Object.isFrozen(admitted.manifest)); assert.ok(Object.isFrozen(admitted.manifest.summaries[0].payload));
  const mutable = structuredClone({ descriptor, registeredInventory: fixture.state.semanticEvidenceArtifacts, expectedIdentity });
  const captured = read(mutable);
  mutable.descriptor.path = '../wrong.json'; mutable.registeredInventory.length = 0; mutable.expectedIdentity.compilerContext.contextKey = 'changed';
  assert.equal((await captured).admission.status, 'shadow-compatible', 'admission captures the original request before its first I/O wait');
  assert.equal(fixture.state.semanticCompilerSummaryAdmissions.get(descriptor.path).status, 'shadow-compatible');
  assert.ok(manifest.summaries.every(summary => summary.locator.sourceIdentity?.status === 'qualified-for-comparison'));
  assert.ok(manifest.summaries.some(summary => summary.supports.some(support => support.channel === 'return')));
  assert.ok(manifest.summaries.some(summary => summary.contributions.some(row => row.callee !== null)));
  const paths = manifest.summaries.flatMap(summary => summary.payload.effects.map(effect => effect.path));
  assert.ok(paths.some(path => path.includes(null)), 'canonical widened field key remains null');
  assert.ok(paths.some(path => path.some(part => part && typeof part === 'object' && part.private === '#value')),
    'canonical private brand retains its source/owner identity');
  assert.ok(manifest.summaries.every(summary => /^[a-f0-9]{64}$/u.test(summary.supportHash) && /^[a-f0-9]{64}$/u.test(summary.identityHash)));
  for (const mutate of [value => { value.schemaVersion--; }, value => { value.qualifiesReuse = true; },
    value => { value.summaries[0].payload.dependencies.push(999); }, value => { value.summaries[0].supports.push(null); },
    value => { value.summaries[0].locator.sourceIdentity.bodyHash = '0'.repeat(64); },
    value => { value.summaries[0].localInputs.dependencyIdentityHash = '0'.repeat(64); },
    value => { value.summaries.push(value.summaries[0]); }, value => { value.extra = true; }]) {
    const candidate = structuredClone(manifest); mutate(candidate);
    assert.equal(admitCompilerSummaryManifest({ manifest: candidate, expectedIdentity }).status, 'rebuild-required');
  }
  assert.equal((await read({ expectedIdentity: { ...expectedIdentity, config: 'changed' } })).admission.reason, 'summary_manifest_broad_identity_changed');
  const wrongLimits = structuredClone(manifest); wrongLimits.limits.maxBytes = 1024;
  assert.equal(admitCompilerSummaryManifest({ manifest: wrongLimits, expectedIdentity }).reason,
    'summary_manifest_recorded_limits_or_convergence_mismatch');
  assert.equal((await read({ registeredInventory: [] })).admission.reason, 'summary_manifest_not_registered');
  assert.equal((await read({ descriptor: { ...descriptor, path: '../' + descriptor.path } })).admission.reason, 'summary_manifest_not_registered');
  const missing = { path: 'semantic-evidence/' + '0'.repeat(64) + '.json', hash: '0'.repeat(64), bytes: descriptor.bytes };
  assert.equal((await read({ descriptor: missing, registeredInventory: [missing] })).admission.status, 'rebuild-required');

  let deny = true, closeCalls = 0;
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (path.resolve(String(file)) !== path.resolve(filename)) return handle;
    const close = handle.close; disposal.set(handle, () => close.call(handle));
    handle.close = function () {
      assert.strictEqual(this, handle); closeCalls++;
      if (deny) throw Object.freeze(new Error('summary admission close failed'));
      return close.call(handle).then(value => { disposal.delete(handle); return value; });
    };
    return handle;
  };
  let failure;
  try { await read(); assert.fail('pending descriptor must propagate'); } catch (error) { failure = error; }
  assert.equal(failure.cacheOwnershipReleased(), false);
  const pending = [failure], seen = new Set(); let session;
  while (pending.length) {
    const value = pending.pop(); session ||= getContainedFileSession(value);
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) pending.push(value.cause); if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  assert.ok(session); assert.equal(closeCalls, 1); deny = false;
  assert.equal((await session.releaseAfterClose()).settled, true); assert.equal(closeCalls, 2);
  fs.open = originalOpen;
  assert.equal(canonicalSemanticJson((await read()).manifest), canonicalSemanticJson(manifest));
  console.log('Persisted summary admission retains exact broad/body/support identities and never grants reuse.');
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) await dispose();
  await fs.rm(root, { recursive: true, force: true });
}

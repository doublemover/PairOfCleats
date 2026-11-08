import assert from 'node:assert/strict';
import { createRepositoryAnswerInput, answerQuotation } from '../../helpers/repository-answer-input.js';
import { compileAdmittedQueryAnswer, inspectAnswerRevision, queryAnswerReceipt } from '../../../src/context-pack/answers/render.js';
import { reconcileAnswerRevisions, applyAnswerPatch } from '../../../src/context-pack/answers/reconcile.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/answer-revisions/')[1];
assert.ok(['facts-and-source-maps', 'qualified-counts', 'retraction-and-patches', 'integrity-and-cycles', 'bounds-and-identity'].includes(mode));
if (mode === 'facts-and-source-maps') {
  const input = createRepositoryAnswerInput(); input.quotations.push(answerQuotation());
  const answer = compileAdmittedQueryAnswer(input);
  assert.match(answer.text, /Recorded candidate \(modeled\)/);
  assert.match(answer.text, /"parseRequest"/);
  assert.deepEqual(JSON.parse(answer.text.match(/with parser scalar (\{[^}]+\}) at/u)[1]), { type: 'number', representation: '0' });
  const reordered = createRepositoryAnswerInput(); reordered.quotations.push(answerQuotation());
  for (const row of reordered.queryReceipt.rows) {
    const literal = row.bindings.find(binding => binding.sort === 'Literal');
    literal.scalar = Object.fromEntries(Object.entries(literal.scalar).reverse());
  }
  assert.deepEqual(compileAdmittedQueryAnswer(reordered), answer, 'JSON object key order cannot change visible scalar text, spans or revision identity');
  assert.throws(() => inspectAnswerRevision({ ...answer, rendererVersion: 1 }), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  assert.match(answer.text, /not its proven runtime callee/);
  assert.equal(answer.cost.claimsBuilt, 4); assert.equal(answer.claims.length, 4);
  assert.equal(answer.cost.serializedBytes, Buffer.byteLength(JSON.stringify(answer)) + 1);
  assert.equal(answer.qualification.programSemantics, 'not-established');
  const quote = answer.fragments.find(fragment => fragment.quoteSpan);
  assert.equal(answer.text.slice(...quote.quoteSpan), 'A😀B'); assert.deepEqual(quote.sourceRefs[0].span, [10, 14]);
  let end = 0;
  for (const fragment of answer.fragments) {
    assert.equal(fragment.span[0], end); assert.ok(fragment.span[1] > fragment.span[0]); end = fragment.span[1];
    for (const id of fragment.claimIds) assert.ok(answer.claims.some(claim => claim.id === id));
  }
  assert.equal(end, answer.text.length, 'every visible span is a checked template, qualification or explicit open requirement');
  assert.deepEqual(inspectAnswerRevision(answer), answer);
  assert.equal(answer.claims.find(claim => claim.predicateId === 'sourceContains').sourceValidity, 'verified-retained-snapshot');
} else if (mode === 'qualified-counts') {
  for (const input of [createRepositoryAnswerInput({ partial: true }), createRepositoryAnswerInput({ count: 0, partial: true }),
    createRepositoryAnswerInput({ count: 0, unresolved: 1 })]) {
    input.openRequirements.push({ id: 'all-paths', text: 'All shutdown paths release the resource.' });
    const answer = compileAdmittedQueryAnswer(input);
    assert.match(answer.text, /Exact relation total is unknown/);
    assert.match(answer.text, /do not establish program-wide absence/);
    assert.match(answer.text, /Open requirement "all-paths": All shutdown paths release the resource/);
    assert.equal(answer.unresolvedRequirements[0].state, 'open');
    assert.equal(answer.qualification.questionCoverage, 'retained-question-partial');
    assert.equal(answer.claims.find(claim => claim.predicateId === 'retainedQueryCount').quantifierScope, 'returned-page-tuples');
  }
  const empty = compileAdmittedQueryAnswer(createRepositoryAnswerInput({ count: 0 }));
  assert.match(empty.text, /named retained relation contains 0/); assert.match(empty.text, /not a count of program executions/);
  const unknown = createRepositoryAnswerInput(); unknown.queryReceipt.rows[0].bindings[2].scalar = null;
  const answer = compileAdmittedQueryAnswer(unknown); assert.match(answer.text, /unavailable parser scalar metadata/);
  assert.doesNotMatch(answer.text, /parser scalar null/);
} else if (mode === 'retraction-and-patches') {
  const old = compileAdmittedQueryAnswer(createRepositoryAnswerInput()), next = compileAdmittedQueryAnswer(createRepositoryAnswerInput({ count: 1, revision: 'build-2' }));
  const patch = reconcileAnswerRevisions(old, next);
  assert.equal(patch.strategy, 'full-deterministic-recomputation'); assert.equal(patch.sourceWorldChanged, true);
  assert.deepEqual(patch.retainedClaimIds, [], 'old-world facts and dependent counts cannot survive by matching their names or text');
  assert.equal(patch.removedClaimIds.length, old.claims.length); assert.equal(patch.addedClaimIds.length, next.claims.length);
  assert.deepEqual(applyAnswerPatch(old, patch), next);
  assert.match(next.text, /named retained relation contains 1/); assert.doesNotMatch(next.text, /named retained relation contains 2/);
  assert.match(old.text, /named retained relation contains 2/, 'the prior immutable historical answer remains inspectable');
  assert.throws(() => applyAnswerPatch(next, patch), { code: 'ERR_ANSWER_BASE_MISMATCH' });
  const forged = structuredClone(patch); forged.removedClaimIds = [];
  assert.throws(() => applyAnswerPatch(old, forged), { code: 'ERR_ANSWER_BASE_MISMATCH' });
  const foreign = createRepositoryAnswerInput(); foreign.queryReceipt.world.repositoryNamespace = 'another-repository';
  assert.throws(() => reconcileAnswerRevisions(old, compileAdmittedQueryAnswer(foreign)), { code: 'ERR_ANSWER_BASE_MISMATCH' });
} else if (mode === 'integrity-and-cycles') {
  const answer = compileAdmittedQueryAnswer(createRepositoryAnswerInput());
  for (const corrupt of [value => { value.text += 'All paths are safe.'; }, value => { value.claims[0].support[0].dependencyClaimIds = [value.claims[0].id]; },
    value => { value.fragments[1].span[1]--; }, value => { value.claims[0].assertionKind = 'checkedDomainFact'; }, value => { value.cost.serializedBytes = 1; }]) {
    const changed = structuredClone(answer); corrupt(changed);
    assert.throws(() => inspectAnswerRevision(changed), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  }
  const wrong = createRepositoryAnswerInput(); wrong.queryReceipt.rows[0].rowId = '0'.repeat(64);
  assert.throws(() => compileAdmittedQueryAnswer(wrong), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  const split = createRepositoryAnswerInput(); split.quotations.push(answerQuotation('\ude00'));
  assert.throws(() => compileAdmittedQueryAnswer(split), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  const mismatch = createRepositoryAnswerInput(); mismatch.quotations.push({ ...answerQuotation(), contentHash: '0'.repeat(64) });
  assert.throws(() => compileAdmittedQueryAnswer(mismatch), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
} else {
  const input = createRepositoryAnswerInput({ partial: true });
  const page = { ...input.queryReceipt, cursor: 'original-opaque-cursor', work: { steps: 1, elapsedMs: 12.5, retainedStateBytes: 65536 } };
  const first = queryAnswerReceipt(page), second = queryAnswerReceipt({ ...page, cursor: 'different-delivery-cursor', work: { ...page.work, elapsedMs: 20 } });
  assert.deepEqual(first, second, 'only owner-proven random delivery identity and invocation timing leave the semantic receipt');
  assert.equal(compileAdmittedQueryAnswer({ ...input, queryReceipt: first }).digest, compileAdmittedQueryAnswer({ ...input, queryReceipt: second }).digest);
  const duplicate = createRepositoryAnswerInput(); duplicate.quotations = [answerQuotation(), answerQuotation()];
  assert.equal(compileAdmittedQueryAnswer(duplicate).claims.filter(claim => claim.predicateId === 'sourceContains').length, 1, 'duplicate physical citation is not independent corroboration');
  assert.throws(() => compileAdmittedQueryAnswer(input, { maxBytes: 1024 }));
  const overflow = createRepositoryAnswerInput(); overflow.openRequirements = Array.from({ length: 64 }, (_, index) => ({ id: 'role-' + index, text: 'x'.repeat(2048) }));
  assert.throws(() => compileAdmittedQueryAnswer(overflow), 'mandatory question roles cannot be dropped to fit');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => compileAdmittedQueryAnswer(input, { signal: controller.signal }), { name: 'AbortError' });
  let reads = 0;
  const accessor = { ...input, get queryReceipt() { reads++; return input.queryReceipt; } };
  assert.throws(() => compileAdmittedQueryAnswer(accessor)); assert.equal(reads, 0);
}
console.log('Deterministic answer revisions preserve qualified facts, source maps and exact-base retractions.');

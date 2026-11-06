import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { ANSWER_INPUT_SCHEMA, ANSWER_EVIDENCE_VERSION, ANSWER_REVISION_SCHEMA } from '../../contracts/schemas/answer-evidence.js';
import { assertAnswerEvidence } from '../../contracts/validators/answer-evidence.js';
import { assertRepositoryQuery } from '../../contracts/validators/repository-question-live.js';
import { REPOSITORY_QUERY_RECEIPT_SCHEMA } from '../../contracts/schemas/repository-question-live.js';
import { CURRENT_READER_QUESTION_PROFILE, repositoryQuestionRowId } from '../../semantic/questions/current-reader-profile.js';
import { captureSourcePath } from '../../semantic/source-order.js';
import { evaluateSupportJoin } from '../task-evidence/support-join.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from '../response-budget.js';

export const ANSWER_MAX_BYTES = CONTEXT_PACK_RESPONSE_MAX_BYTES;
const hash = (domain, value) => semanticHash(domain, value, { maxBytes: ANSWER_MAX_BYTES });
const refKey = ref => ref.partitionId + ':' + ref.localId;
const fail = message => Object.assign(new Error(message), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
const overflow = () => Object.assign(new Error('Required answer facts, source quotes and qualifications exceed the response allowance. Reduce the query page or requested quotations.'), { code: 'ERR_ANSWER_RESPONSE_BUDGET' });
const validUnicode = text => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
export const queryAnswerReceipt = page => {
  assertRepositoryQuery('page', page);
  const { cursor: _cursor, work: _work, ...receipt } = page;
  return captureSemanticRequest(receipt, REPOSITORY_QUERY_RECEIPT_SCHEMA);
};

/** Compile only already-admitted provider outputs. Public integrations execute
 * the real query/source readers; raw transport JSON is never a checked receipt.
 * This module does not read sources or create a second authoritative fact store.
 */
export const compileAdmittedQueryAnswer = (input, { maxBytes = ANSWER_MAX_BYTES, signal = null } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > ANSWER_MAX_BYTES) throw new TypeError('Invalid answer byte allowance.');
  throwIfAborted(signal);
  input = captureSemanticRequest(input, ANSWER_INPUT_SCHEMA); assertAnswerEvidence('input', input);
  const receipt = assertRepositoryQuery('receipt', input.queryReceipt);
  if (receipt.profile !== CURRENT_READER_QUESTION_PROFILE || !/^[a-f0-9]{64}$/.test(receipt.world.sourceSnapshotId)) throw fail('Current indexed query producer and inventory are required.');
  canonicalSemanticJson(input, { maxBytes });
  const ids = new Set();
  for (const requirement of input.openRequirements) {
    if (ids.has(requirement.id)) throw fail('Duplicate original requirement identity.'); ids.add(requirement.id);
  }
  const worldId = hash('answer.world.v1', receipt.world), receiptId = hash('answer.query-receipt.v1', receipt);
  const report = { schemaVersion: ANSWER_EVIDENCE_VERSION, kind: 'repository-answer-revision', rendererVersion: 1,
    questionRef: input.questionRef, world: receipt.world, worldId, inputs: input, claims: [], text: '', fragments: [],
    unresolvedRequirements: input.openRequirements.map(requirement => ({ ...requirement, state: 'open', reason: 'caller-requirement-has-no-admitted-checker' })),
    dependencyFootprint: { inventoryId: receipt.world.sourceSnapshotId, queryDigest: receipt.requestDigest, domainId: receipt.world.domainId,
      policy: 'invalidate-the-whole-answer-on-any-input-world-change', negativeAndDomainDependencies: 'covered-conservatively-by-the-full-inventory' },
    qualification: { interpretation: 'retained-query-facts-and-exact-source-quotations', programSemantics: 'not-established',
      questionCoverage: receipt.status === 'complete-in-retained-input' && !input.openRequirements.length ? 'retained-question-answered' : 'retained-question-partial', narrative: 'none' },
    cost: { serializedBytes: 0, quotedSourceBytes: 0, claimsBuilt: 0 }, digest: '0'.repeat(64) };
  let estimatedBytes = Buffer.byteLength(JSON.stringify(report)) + 1;
  const claimIds = new Set();
  const ensureSize = () => { if (estimatedBytes > maxBytes) throw overflow(); };
  ensureSize();
  const append = (kind, text, fragmentClaimIds = [], sourceRefs = [], quote = null) => {
    const start = report.text.length, line = text + '\n';
    const fragment = { kind, span: [start, start + line.length], claimIds: fragmentClaimIds, sourceRefs,
      ...(quote ? { quoteSpan: [start + quote.offset, start + quote.offset + quote.length] } : {}) };
    estimatedBytes += Buffer.byteLength(JSON.stringify(line)) - 2 + Buffer.byteLength(JSON.stringify(fragment)) + (report.fragments.length ? 1 : 0);
    ensureSize();
    report.text += line; report.fragments.push(fragment);
  };
  const claim = ({ predicateId, args, assertionKind, quantifierScope, rule, inputs, dependencies = [], verifiedSource = false }) => {
    throwIfAborted(signal);
    const argumentsDigest = hash('answer.claim-arguments.v1', args);
    const id = hash('answer.claim.v1', { predicateId, predicateVersion: 1, worldId, argumentsDigest });
    if (claimIds.has(id)) throw fail('Duplicate deterministic claim identity.');
    for (const dependency of dependencies) if (!claimIds.has(dependency)) throw fail('Claim dependency is absent or cyclic.');
    const requirement = { id, predicateId, predicateVersion: 1, arguments: { argumentsDigest }, quantifierScope: { kind: quantifierScope, domainId: receipt.world.domainId },
      branchId: input.questionRef.id + '@' + input.questionRef.revision, assumptionSetId: receipt.world.domainId, worldRef: receipt.world,
      permittedKinds: [assertionKind], alternatives: [['provider-receipt']] };
    const joined = evaluateSupportJoin({ requirement, observations: [{ ...requirement, id: inputs[0], role: 'provider-receipt',
      kind: assertionKind, polarity: 'supports', admission: 'checked', checkerReceiptId: inputs[0], validity: 'current', foundation: true, dependencies: [] }] });
    if (joined.status !== 'supported') throw fail('Admitted deterministic support failed exact-world compatibility.');
    const value = { id, predicateId, predicateVersion: 1, worldId, argumentsDigest, assertionKind, polarity: 'positive', quantifierScope,
      sourceValidity: verifiedSource ? 'verified-retained-snapshot' : 'retained-source-headers', supportState: 'supported', supportSelection: 'selected-provider-receipt',
      alternativesComplete: false, counterSupportState: 'not-assessed', support: [{ rule, inputIds: inputs, dependencyClaimIds: dependencies, compatibilityRule: joined.compatibilityRule }] };
    estimatedBytes += Buffer.byteLength(JSON.stringify(value)) + (report.claims.length ? 1 : 0); ensureSize();
    report.claims.push(value); claimIds.add(id);
    return id;
  };
  append('qualification', 'This report describes retained query facts and explicitly verified source quotations in UTF-16 coordinates. Program semantics, runtime callees and program-wide totals are not established.');
  const rowClaims = [], rows = new Set();
  for (const row of receipt.rows) {
    if (rows.has(row.rowId)) throw fail('Duplicate provider row identity.'); rows.add(row.rowId);
    if (row.rowId !== repositoryQuestionRowId(receipt.logicalPlanId, row.bindings.map(binding => binding.ref))) throw fail('Query row identity differs from its exact logical plan and binding tuple.');
    const invocation = row.bindings.find(binding => binding.sort === 'Invocation'), declaration = row.bindings.find(binding => binding.sort === 'Declaration'),
      literal = row.bindings.find(binding => binding.sort === 'Literal');
    if (row.bindings.length !== 3 || !invocation || !declaration || !literal || new Set(row.bindings.map(binding => refKey(binding.ref))).size !== 3) throw fail('The admitted query tuple requires three distinct, typed bindings.');
    for (const binding of row.bindings) {
      captureSourcePath(binding.source.path);
      if (binding.source.span[1] < binding.source.span[0]) throw fail('Retained binding source coordinates are reversed.');
    }
    const target = row.witnesses.find(witness => witness.meaning === 'recorded-target-candidate');
    if (!target || !row.witnesses.some(witness => witness.meaning === 'syntactic-zero-based-argument')) throw fail('Tuple lacks its qualified target/argument witnesses.');
    const id = claim({ predicateId: 'retainedQueryTuple', args: { logicalPlanId: receipt.logicalPlanId, rowId: row.rowId, bindings: row.bindings },
      assertionKind: 'structuralFact', quantifierScope: 'returned-page-tuples', rule: 'retained-query-row-v1', inputs: [receiptId, row.rowId] });
    rowClaims.push(id);
    append('claim', 'Recorded candidate (' + target.certainty + '): Invocation (' + invocation.invocationKind + ') at ' + JSON.stringify(invocation.source.path) + ':' + invocation.source.span.join('-')
      + ' has declaration candidate ' + JSON.stringify(declaration.name) + ' at ' + JSON.stringify(declaration.source.path) + ':' + declaration.source.span.join('-')
      + ' and a retained literal operand ' + (literal.scalar === null ? 'with unavailable parser scalar metadata' : 'with parser scalar ' + JSON.stringify(literal.scalar))
      + ' at ' + JSON.stringify(literal.source.path) + ':' + literal.source.span.join('-')
      + '. These are correlated retained facts about this Invocation, not its proven runtime callee or argument value.', [id], [invocation.source, declaration.source, literal.source]);
  }
  const exact = receipt.status === 'complete-in-retained-input';
  const countId = claim({ predicateId: 'retainedQueryCount', args: { logicalPlanId: receipt.logicalPlanId, rowIds: receipt.rows.map(row => row.rowId),
    counts: receipt.counts, completion: receipt.completion }, assertionKind: 'checkedDomainFact', quantifierScope: exact ? 'named-retained-relation' : 'returned-page-tuples',
  rule: 'retained-query-count-v1', inputs: [receiptId], dependencies: rowClaims });
  append('claim', exact
    ? 'The named retained relation contains ' + receipt.counts.totalInRetainedRelation + ' matching tuples across the completed enumeration; this page returns ' + receipt.rows.length + '. This is not a count of program executions.'
    : 'This page returns ' + receipt.rows.length + ' retained matching tuples. Exact relation total is unknown: enumeration is ' + receipt.completion.enumeration
      + ' and ' + receipt.counts.unresolvedThroughCursor + ' unresolved qualifications have been observed. Empty or partial results do not establish program-wide absence.', [countId]);
  const quoteIds = new Set();
  for (const quote of input.quotations) {
    throwIfAborted(signal);
    captureSourcePath(quote.source.path);
    if (quote.source.span[1] < quote.source.span[0] || quote.text.length !== quote.source.span[1] - quote.source.span[0] || !validUnicode(quote.text)
      || createHash('sha256').update(quote.text, 'utf8').digest('hex') !== quote.contentHash) throw fail('Quotation content, UTF-16 boundaries or digest disagree.');
    const quoteId = hash('answer.source-quotation-input.v1', quote);
    if (quoteIds.has(quoteId)) continue; quoteIds.add(quoteId);
    const id = claim({ predicateId: 'sourceContains', args: { source: quote.source, contentHash: quote.contentHash }, assertionKind: 'sourceText',
      quantifierScope: 'exact-source-interval', rule: 'verified-source-quotation-v1', inputs: [quoteId], verifiedSource: true });
    const prefix = 'Source contains this exact UTF-16 interval at ' + JSON.stringify(quote.source.path) + ':' + quote.source.span.join('-') + ':\n';
    append('claim', prefix + quote.text, [id], [quote.source], { offset: prefix.length, length: quote.text.length });
    report.cost.quotedSourceBytes += Buffer.byteLength(quote.text);
  }
  for (const requirement of report.unresolvedRequirements) append('open-requirement', 'Open requirement ' + JSON.stringify(requirement.id) + ': ' + requirement.text + ' (no admitted checker result).');
  append('qualification', 'Analysis coverage: ' + receipt.completion.analysis + '. Counter-support and alternative derivations were not exhaustively assessed. Source headers identify retained coordinates; quotations alone verify their exact retained bytes.');
  report.cost.claimsBuilt = report.claims.length;
  for (let iteration = 0; iteration < 8; iteration++) {
    const bytes = Buffer.byteLength(JSON.stringify(report)) + 1;
    if (report.cost.serializedBytes === bytes) break;
    report.cost.serializedBytes = bytes;
  }
  if (report.cost.serializedBytes > maxBytes) throw overflow();
  const { digest: _digest, ...unsigned } = report;
  report.digest = hash('answer.revision.v1', unsigned);
  if (report.cost.serializedBytes !== Buffer.byteLength(JSON.stringify(report)) + 1) throw fail('Answer byte accounting did not reach a fixed point.');
  throwIfAborted(signal); return assertAnswerEvidence('revision', report);
};

/** Validates historical content/renderer integrity only. A saved report grants
 * no current source authority and cannot replace fresh provider admission. */
export const inspectAnswerRevision = (input, options = {}) => {
  const report = captureSemanticRequest(input, ANSWER_REVISION_SCHEMA); assertAnswerEvidence('revision', report);
  canonicalSemanticJson(report, { maxBytes: ANSWER_MAX_BYTES });
  const rebuilt = compileAdmittedQueryAnswer(report.inputs, options);
  if (canonicalSemanticJson(rebuilt, { maxBytes: ANSWER_MAX_BYTES }) !== canonicalSemanticJson(report, { maxBytes: ANSWER_MAX_BYTES })) throw fail('Answer text, claims, source maps, costs or digest differ from deterministic recomputation.');
  return rebuilt;
};

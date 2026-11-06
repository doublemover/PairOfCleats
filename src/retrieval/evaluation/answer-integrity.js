import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { ANSWER_INTEGRITY_EVALUATION_SCHEMA } from '../../contracts/schemas/answer-integrity-evaluation.js';
import { assertAnswerIntegrityEvaluation } from '../../contracts/validators/answer-integrity-evaluation.js';
import { inspectAnswerRevision, compileAdmittedQueryAnswer, ANSWER_MAX_BYTES } from '../../context-pack/answers/render.js';

const key = value => canonicalSemanticJson(value, { maxBytes: 2 * ANSWER_MAX_BYTES });
const digest = value => semanticHash('answer-integrity.v1', value, { maxBytes: 2 * ANSWER_MAX_BYTES });
const textHash = value => createHash('sha256').update(value).digest('hex');
const replaceText = (candidate, start, end, text) => {
  const delta = text.length - (end - start);
  candidate.text = candidate.text.slice(0, start) + text + candidate.text.slice(end);
  for (const fragment of candidate.fragments) {
    if (fragment.span[0] >= end) fragment.span = fragment.span.map(value => value + delta);
    else if (fragment.span[0] <= start && fragment.span[1] >= end) fragment.span[1] += delta;
    if (!fragment.quoteSpan) continue;
    if (fragment.quoteSpan[0] >= end) fragment.quoteSpan = fragment.quoteSpan.map(value => value + delta);
    else if (fragment.quoteSpan[0] <= start && fragment.quoteSpan[1] >= end) fragment.quoteSpan[1] += delta;
  }
};
// Attackers can recompute public hashes and byte counters. Re-sealing keeps the
// negative cases from passing merely because an old envelope digest survived.
const seal = candidate => {
  for (let iteration = 0; iteration < 8; iteration++) {
    const bytes = Buffer.byteLength(JSON.stringify(candidate)) + 1;
    if (candidate.cost.serializedBytes === bytes) break; candidate.cost.serializedBytes = bytes;
  }
  const { digest: _old, ...unsigned } = candidate;
  candidate.digest = semanticHash('answer.revision.v1', unsigned, { maxBytes: ANSWER_MAX_BYTES }); return candidate;
};
const mutations = {
  'identity-control': revision => ({ candidate: structuredClone(revision), expected: 'accepted', meaning: 'identical-serialized-content' }),
  'moved-citation': revision => {
    const candidate = structuredClone(revision), fragments = candidate.fragments.filter(fragment => fragment.kind === 'claim' && fragment.sourceRefs.length);
    if (!fragments.length) return null;
    const original = fragments[0].sourceRefs[0];
    fragments[0].sourceRefs[0] = { ...original, span: [original.span[0] + 1, original.span[1] + 1] };
    return { candidate, expected: 'rejected', meaning: 'source-reference-moved-without-changing-the-supported-claim' };
  },
  'negated-predicate': revision => {
    const candidate = structuredClone(revision), marker = ' has declaration candidate ';
    if (!candidate.text.includes(marker)) return null;
    const start = candidate.text.indexOf(marker); replaceText(candidate, start, start + marker.length, ' does not have declaration candidate ');
    return { candidate, expected: 'rejected', meaning: 'predicate-polarity-changed-with-original-support' };
  },
  'changed-numeric-value': revision => {
    const candidate = structuredClone(revision), match = /contains ([0-9]+) matching tuples|page returns ([0-9]+) retained matching tuples/.exec(candidate.text);
    if (!match) return null;
    const numeric = match[1] ?? match[2], replacement = String(Number(numeric) + 1);
    const start = candidate.text.indexOf(numeric, match.index); replaceText(candidate, start, start + numeric.length, replacement);
    return { candidate, expected: 'rejected', meaning: 'named-count-changed-with-original-enumeration-support' };
  },
  'removed-qualification': revision => {
    const candidate = structuredClone(revision), qualification = candidate.fragments.find(fragment => fragment.kind === 'qualification');
    if (!qualification) return null;
    candidate.fragments = candidate.fragments.filter(fragment => fragment !== qualification);
    replaceText(candidate, qualification.span[0], qualification.span[1], '');
    return { candidate, expected: 'rejected', meaning: 'required-qualification-removed-from-original-report' };
  },
  'wrong-world': revision => {
    const candidate = structuredClone(revision);
    candidate.world = { ...candidate.world, sourceSnapshotId: candidate.world.sourceSnapshotId === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) };
    return { candidate, expected: 'rejected', meaning: 'answer-world-changed-with-original-input-and-support' };
  },
  'changed-quotation': revision => {
    const candidate = structuredClone(revision), fragment = candidate.fragments.find(fragment => fragment.quoteSpan && fragment.quoteSpan[1] > fragment.quoteSpan[0]);
    if (!fragment) return null;
    const [start, end] = fragment.quoteSpan, quote = candidate.text.slice(start, end);
    replaceText(candidate, start, end, quote === 'x' ? 'y' : 'x');
    return { candidate, expected: 'rejected', meaning: 'quoted-bytes-changed-with-original-input-digest' };
  },
  'replacement-input-control': revision => {
    const inputs = structuredClone(revision.inputs), quote = inputs.quotations.find(quote => quote.text.length > 0);
    if (!quote) return null;
    // Recompiling different self-consistent supplied inputs can pass historical
    // integrity. This control must never be credited as current source admission.
    quote.text = quote.text === 'x' ? 'y' : 'x'; quote.source.span[1] = quote.source.span[0] + quote.text.length; quote.contentHash = textHash(quote.text);
    return { candidate: compileAdmittedQueryAnswer(inputs), expected: 'accepted', meaning: 'different-self-consistent-input-is-historical-only' };
  }
};

/** Fixed deterministic attack matrix. This is renderer/claim-map integrity,
 * with caller-supplied historical inputs; it is not an NLI judge or a source
 * authority adapter. An accepted mutation is reported, never hidden by retry.
 */
export const evaluateAnswerIntegrityAttacks = (input, { signal = null, maxMs = 250, maxOutputBytes = 65536 } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 250 || !Number.isSafeInteger(maxOutputBytes)
    || maxOutputBytes < 1024 || maxOutputBytes > 131072) throw new TypeError('Invalid answer attack work/output allowance.');
  input = captureSemanticRequest(input, ANSWER_INTEGRITY_EVALUATION_SCHEMA); assertAnswerIntegrityEvaluation(input); key(input);
  const original = inspectAnswerRevision(input.revision, { signal }), results = [];
  let next = 0;
  for (const id of input.cases) {
    throwIfAborted(signal); if (performance.now() - began >= maxMs) break;
    const mutation = mutations[id](original); next++;
    if (!mutation) { results.push({ id, status: 'unsupported-fixture', expected: null, actual: null, satisfied: false }); continue; }
    seal(mutation.candidate);
    const candidateId = digest(mutation.candidate), checkBegan = performance.now();
    let actual = 'accepted', errorCode = null, rejectionClass = null;
    try { inspectAnswerRevision(mutation.candidate, { signal }); }
    catch (error) {
      throwIfAborted(signal); actual = 'rejected'; errorCode = typeof error?.code === 'string' ? error.code : null;
      rejectionClass = errorCode === 'ERR_ANSWER_RESPONSE_BUDGET' ? 'output-budget' : errorCode === 'ERR_ANSWER_EVIDENCE_CONTRACT' ? 'integrity-contract' : 'unexpected-verifier-error';
    }
    const satisfied = actual === mutation.expected && (actual === 'accepted' || rejectionClass === 'integrity-contract');
    results.push({ id, status: 'checked', meaning: mutation.meaning, expected: mutation.expected, actual, satisfied,
      candidateId, errorCode, rejectionClass, verifier: 'original-deterministic-renderer-recomputation',
      envelope: 'public-digest-and-byte-counters-recomputed', currentSourceAuthority: false, verificationMs: performance.now() - checkBegan });
  }
  const complete = next === input.cases.length;
  const result = { schemaVersion: 1, kind: 'retained-answer-integrity-evaluation', inputId: digest(input), baseDigest: original.digest,
    complete, reason: complete ? null : 'deadline', results, remainingCases: input.cases.slice(next),
    allExpectedResultsObserved: complete ? results.every(row => row.satisfied) : null,
    checkedInputAuthority: 'supplied-historical-report-integrity-only', currentSourceAuthority: false,
    freeTextEntailment: 'not-assessed', sourceSupportTruth: 'requires-independent-current-source-admission',
    taskOutcome: 'not-assessed', executorReliance: 'not-measured', causalStatus: 'not-assessed',
    work: { elapsedMs: performance.now() - began, inspectedCases: results.filter(row => row.status === 'checked').length } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxOutputBytes) throw Object.assign(new Error('Answer attack report exceeds the admitted output allowance.'), { code: 'ERR_ANSWER_INTEGRITY_OUTPUT_LIMIT' });
  throwIfAborted(signal); return result;
};

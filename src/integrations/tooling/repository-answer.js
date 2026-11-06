import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { REPOSITORY_ANSWER_REQUEST_SCHEMA } from '../../contracts/schemas/repository-answer.js';
import { ANSWER_EVIDENCE_VERSION } from '../../contracts/schemas/answer-evidence.js';
import { assertRepositoryAnswer } from '../../contracts/validators/repository-answer.js';
import { compileAdmittedQueryAnswer, inspectAnswerRevision, queryAnswerReceipt, ANSWER_MAX_BYTES } from '../../context-pack/answers/render.js';
import { reconcileAnswerRevisions } from '../../context-pack/answers/reconcile.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { withSemanticReaderCleanup, semanticReadDeadlineFailure } from '../../semantic/reader-lifetime.js';
import { publishSemanticPage, stageSemanticPagePublication } from '../../semantic/page-publication.js';
import { runRepositoryQuery, captureRepositoryQueryRequest } from './repository-query.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);
const publication = (queryPage, signal) => () => { throwIfAborted(signal); publishSemanticPage(queryPage); };
const preparedRequests = new WeakSet();
export const captureRepositoryAnswerRequest = input => {
  if (preparedRequests.has(input)) return input;
  const request = captureSemanticRequest(input, REPOSITORY_ANSWER_REQUEST_SCHEMA);
  if (preparedRequests.has(request)) return request;
  assertRepositoryAnswer('request', request); canonicalSemanticJson(request, { maxBytes: 512 * 1024 });
  const prepared = ['inspect', 'retained'].includes(request.mode) ? request
    : Object.freeze({ ...request, query: captureRepositoryQueryRequest(request.query) });
  if (prepared.mode === 'deliver' && (!same(prepared.delivery.contextRef.worldRef, prepared.query.question.world)
    || !same(prepared.delivery.contextRef.taskRef, prepared.questionRef)
    || prepared.quoteRoles && prepared.quoteRoles.length !== (prepared.quoteRefs?.length || 0))) {
    throw fail('ERR_SEMANTIC_QUERY_CONTRACT', 'Delivery context must match the original answer question/world, and quote-role mappings must match requested refs.');
  }
  preparedRequests.add(prepared); return prepared;
};
const finalize = result => {
  for (let index = 0; index < 8; index++) {
    const bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
    if (result.serializedBytes === bytes) break;
    result.serializedBytes = bytes;
  }
  if (result.serializedBytes > ANSWER_MAX_BYTES) throw fail('ERR_ANSWER_RESPONSE_BUDGET', 'Required answer/comparison exceeds the complete response budget. Reduce the query page or requested quotations.');
  if (result.serializedBytes !== Buffer.byteLength(JSON.stringify(result)) + 1) throw fail('ERR_ANSWER_EVIDENCE_CONTRACT', 'Answer envelope byte accounting is inconsistent.');
  return assertRepositoryAnswer('result', result);
};

/** Public input contains requests, never raw checked claims/receipts. The real
 * query and retained-source readers establish admission before compilation.
 * Each source phase has a separate bounded interval; total elapsed is reported.
 */
export const createRepositoryAnswerRunner = ({ queryRunner = runRepositoryQuery, openStore = openSemanticQueryStore,
  resolveIndexDir = resolveSemanticGenerationIndexDir, maxSourceWorkMs = 250, createRetentionStore = null } = {}) => {
  if (!Number.isSafeInteger(maxSourceWorkMs) || maxSourceWorkMs < 1 || maxSourceWorkMs > 250) throw new TypeError('Invalid answer source-work allowance.');
  return async (input, { signal = null, userConfig = null, deferPublication = false } = {}) => {
    const began = performance.now(); throwIfAborted(signal);
    let request = captureRepositoryAnswerRequest(input);
    if (request.mode === 'inspect') {
      const report = inspectAnswerRevision(request.revision, { signal });
      return finalize({ schemaVersion: ANSWER_EVIDENCE_VERSION, kind: 'repository-answer-inspection', inspectedDigest: report.digest,
        questionRef: report.questionRef, worldId: report.worldId, claims: report.claims.length, fragments: report.fragments.length,
        contentIntegrity: 'verified-by-deterministic-recomputation', currentSourceAdmission: 'not-established-by-content-inspection', serializedBytes: 0 });
    }
    // Optional storage remains lazy: ordinary ephemeral answers do not import
    // the retention graph or acquire a retention lease/create its namespace.
    const retentionStore = async (root, config) => createRetentionStore ? createRetentionStore({ repoRoot: root, userConfig: config })
      : (await import('../../context-pack/answers/retention.js')).createRetainedAnswerStore({ repoRoot: root, userConfig: config });
    if (request.mode === 'retained') {
      const root = getRepoRoot(request.repoRoot), config = userConfig || loadUserConfig(root);
      if (request.revisionReceipt && !same(request.questionRef, request.revisionReceipt.questionRef)) {
        throw fail('ERR_ANSWER_RETENTION_CONFLICT', 'Retained answer receipt differs from the requested question revision.');
      }
      const store = await retentionStore(root, config);
      const historical = request.revisionReceipt ? await store.readRevision(request.revisionReceipt, { signal }) : await store.read(request.questionRef, { signal });
      return finalize({ schemaVersion: ANSWER_EVIDENCE_VERSION, kind: 'repository-answer-retained', ...historical, serializedBytes: 0 });
    }
    const repoRoot = getRepoRoot(request.query.repoRoot);
    if (repoRoot !== request.query.repoRoot) request = captureRepositoryAnswerRequest({ ...request, query: { ...request.query, repoRoot } });
    if (request.mode === 'compare') {
      const previous = inspectAnswerRevision(request.previous, { signal });
      if (previous.questionRef.id !== request.questionRef.id || previous.world.repositoryNamespace !== repoRoot) {
        throw fail('ERR_ANSWER_BASE_MISMATCH', 'Answer comparison requires the original question identity and authorized repository namespace.');
      }
    }
    const config = userConfig || loadUserConfig(repoRoot);
    let retained = null, intent = null, retentionElapsedMs = 0;
    if (request.retention) {
      const retentionBegan = performance.now();
      const world = request.query.question.world;
      if (world.repositoryNamespace !== repoRoot || !same(world.generation, request.query.generation)) {
        throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Answer retention requires the exact requested repository and generation world.');
      }
      const worldId = semanticHash('answer.world.v1', world, { maxBytes: ANSWER_MAX_BYTES });
      const desired = { questionRef: request.questionRef, worldId, expectedBaseDigest: request.retention.expectedBaseDigest };
      if (request.retention.resumeIntent && (!same(request.retention.resumeIntent.questionRef, desired.questionRef)
        || request.retention.resumeIntent.worldId !== desired.worldId || request.retention.resumeIntent.expectedBaseDigest !== desired.expectedBaseDigest)) {
        throw fail('ERR_ANSWER_RETENTION_CONFLICT', 'Resumed answer intent differs from the requested question, world or base.');
      }
      retained = await retentionStore(repoRoot, config);
      intent = request.retention.resumeIntent ? await retained.resume(request.retention.resumeIntent, { signal }) : await retained.begin(desired, { signal });
      retentionElapsedMs = performance.now() - retentionBegan;
    }
    const queryPage = await queryRunner(request.query, { signal, userConfig: config, deferPublication: true });
    throwIfAborted(signal);
    const queryReceipt = queryAnswerReceipt(queryPage), sourceBegan = performance.now();
    let quotations = [];
    if (request.quoteRefs?.length) {
      const deadline = AbortSignal.timeout(maxSourceWorkMs), sourceSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const sourceDeadlineAt = performance.now() + maxSourceWorkMs;
      const checkSource = () => {
        throwIfAborted(sourceSignal);
        if (performance.now() >= sourceDeadlineAt) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Answer source admission exceeded its bounded interval. Request fewer/smaller source quotations.');
      };
      try {
        const indexDir = await resolveIndexDir({ repoRoot, generation: request.query.generation, userConfig: config, signal: sourceSignal });
        // Canonical retained bytes live in the artifact source owner for every
        // query backend. This never substitutes the query's selected backend.
        const opened = await openStore({ indexDir, repoRoot, generation: request.query.generation, backend: 'artifact', signal: sourceSignal });
        const close = opened.close?.bind(opened);
        quotations = await withSemanticReaderCleanup(async () => {
          checkSource();
          const store = opened.store;
          if (store.repoRoot !== repoRoot || !same(store.generation, request.query.generation)
            || store.cursorScope !== queryReceipt.world.sourceSnapshotId) throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Answer source inventory changed after query admission.');
          const read = async () => {
            for (const ref of request.quoteRefs) if (!store.getPartitionSourceUnitId?.(ref.partitionId)) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Quotation record is outside the admitted source inventory.');
            const records = await store.getRecords(request.quoteRefs, ['span'], { signal: sourceSignal });
            checkSource();
            const excerpts = await store.getSourceSpans(request.quoteRefs, { signal: sourceSignal, maxBytes: 32768 });
            checkSource();
            const result = [];
            for (const [index, ref] of request.quoteRefs.entries()) {
              checkSource();
              const record = records[index], excerpt = excerpts[index];
              if (!record || !same(record.ref, ref)) throw fail('ERR_SEMANTIC_QUERY_CONTRACT', 'Requested quotation record is absent.');
              const header = await store.getSourceReference(record, { signal: sourceSignal });
              checkSource();
              if (!header || !excerpt || header.coordinateUnit !== 'utf16') throw fail('ERR_SEMANTIC_UNAVAILABLE', 'Requested quotation requires an unavailable retained source-coordinate adapter.');
              if (!same(excerpt.ref, ref) || excerpt.sourceUnitId !== header.sourceUnitId || excerpt.sourceHash !== header.sourceHash
                || excerpt.coordinateUnit !== 'utf16' || !same(excerpt.span, record.span)) throw fail('ERR_SEMANTIC_INTEGRITY', 'Quotation bytes and source header refer to different retained inputs.');
              result.push({ source: { sourceUnitId: header.sourceUnitId, sourceHash: header.sourceHash, path: header.path,
                span: [...record.span], coordinateUnit: 'utf16' }, text: excerpt.text,
              contentHash: createHash('sha256').update(excerpt.text, 'utf8').digest('hex') });
            }
            return result;
          };
          const value = await (typeof store.withReadScope === 'function' ? store.withReadScope(read) : read());
          checkSource(); return value;
        }, () => close?.());
        checkSource();
      } catch (caught) {
        throw semanticReadDeadlineFailure(caught, { signal, deadline,
          createLimitError: () => fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Answer source admission exceeded its bounded interval. Request fewer/smaller source quotations.') });
      }
    }
    throwIfAborted(signal);
    const sourceElapsedMs = performance.now() - sourceBegan, renderBegan = performance.now();
    const answer = compileAdmittedQueryAnswer({ schemaVersion: ANSWER_EVIDENCE_VERSION, questionRef: request.questionRef,
      queryReceipt, quotations, openRequirements: request.openRequirements || [] }, { maxBytes: ANSWER_MAX_BYTES - (retained ? 8192 : 1024), signal });
    const preparedRetention = retained?.prepare(intent, answer, { signal });
    let body;
    if (request.mode === 'deliver') {
      const [{ planEvidenceDelivery }, { projectAnswerDeliveryEvidence, answerDeliveryContinuation }] = await Promise.all([
        import('../../context-pack/delivery/plan.js'), import('../../context-pack/delivery/answer-projection.js')
      ]);
      // Ordinary transports have no authenticated exact-window witness. Always
      // send every selected body, regardless of client-reported base/visibility.
      const deliveryRequest = { ...request.delivery, continuation: answerDeliveryContinuation(answer, queryPage.cursor),
        limits: { ...request.delivery.limits, packetBytes: Math.min(request.delivery.limits.packetBytes, ANSWER_MAX_BYTES - 2048) } };
      body = { kind: 'repository-answer-delivery', plan: planEvidenceDelivery(deliveryRequest, projectAnswerDeliveryEvidence(answer, request.quoteRoles), null, { signal }),
        availability: 'self-contained-full-pack', contextAuthority: 'client-reported-no-visibility-attestation' };
    } else body = request.mode === 'compare' ? { kind: 'repository-answer-comparison', patch: reconcileAnswerRevisions(request.previous, answer, { signal }) }
      : { kind: 'repository-answer-page', answer };
    const result = finalize({ schemaVersion: ANSWER_EVIDENCE_VERSION, ...body, continuation: queryPage.cursor, serializedBytes: 0,
      ...(preparedRetention ? { retained: preparedRetention.receipt } : {}),
      work: { queryServiceElapsedMs: queryPage.work.elapsedMs, sourceElapsedMs,
        renderElapsedMs: performance.now() - renderBegan, retentionElapsedMs, totalElapsedMs: performance.now() - began } });
    throwIfAborted(signal);
    // Final report, storage receipt and response bytes are admitted before the
    // first immutable object is written. A failed commit installs no cursor.
    if (preparedRetention) {
      const commitBegan = performance.now();
      await preparedRetention.commit();
      result.work.retentionElapsedMs += performance.now() - commitBegan;
      result.work.totalElapsedMs = performance.now() - began;
      // The retained answer reserves 8 KiB for this small closed envelope;
      // timing is delivery metadata and never changes the answer identity.
      finalize(result);
    }
    throwIfAborted(signal);
    return stageSemanticPagePublication(result, publication(queryPage, signal), deferPublication);
  };
};
export const runRepositoryAnswer = createRepositoryAnswerRunner();

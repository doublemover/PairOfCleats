import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { REPOSITORY_ANSWER_REQUEST_SCHEMA } from '../../contracts/schemas/repository-answer.js';
import { ANSWER_EVIDENCE_VERSION } from '../../contracts/schemas/answer-evidence.js';
import { assertRepositoryAnswer } from '../../contracts/validators/repository-answer.js';
import { compileAdmittedQueryAnswer, inspectAnswerRevision, queryAnswerReceipt, ANSWER_MAX_BYTES } from '../../context-pack/answers/render.js';
import { reconcileAnswerRevisions } from '../../context-pack/answers/reconcile.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { withSemanticReaderCleanup } from '../../semantic/reader-lifetime.js';
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
  const prepared = request.mode === 'inspect' ? request
    : Object.freeze({ ...request, query: captureRepositoryQueryRequest(request.query) });
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
  resolveIndexDir = resolveSemanticGenerationIndexDir, maxSourceWorkMs = 250 } = {}) => {
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
    const repoRoot = getRepoRoot(request.query.repoRoot);
    if (repoRoot !== request.query.repoRoot) request = captureRepositoryAnswerRequest({ ...request, query: { ...request.query, repoRoot } });
    if (request.mode === 'compare') {
      const previous = inspectAnswerRevision(request.previous, { signal });
      if (previous.questionRef.id !== request.questionRef.id || previous.world.repositoryNamespace !== repoRoot) {
        throw fail('ERR_ANSWER_BASE_MISMATCH', 'Answer comparison requires the original question identity and authorized repository namespace.');
      }
    }
    const config = userConfig || loadUserConfig(repoRoot);
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
        const observation = observeStorageResource(caught, { phase: 'answer-source-admission' }); observation.requireSettled();
        let name;
        try { name = caught?.name; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
        observation.requireSettled();
        if (!signal?.aborted && deadline.aborted && (caught === deadline.reason || ['AbortError', 'TimeoutError'].includes(name))) {
          throw observation.wrap(fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Answer source admission exceeded its bounded interval. Request fewer/smaller source quotations.'));
        }
        throw caught;
      }
    }
    throwIfAborted(signal);
    const sourceElapsedMs = performance.now() - sourceBegan, renderBegan = performance.now();
    const answer = compileAdmittedQueryAnswer({ schemaVersion: ANSWER_EVIDENCE_VERSION, questionRef: request.questionRef,
      queryReceipt, quotations, openRequirements: request.openRequirements || [] }, { maxBytes: ANSWER_MAX_BYTES - 1024, signal });
    const body = request.mode === 'compare' ? { kind: 'repository-answer-comparison', patch: reconcileAnswerRevisions(request.previous, answer, { signal }) }
      : { kind: 'repository-answer-page', answer };
    const result = finalize({ schemaVersion: ANSWER_EVIDENCE_VERSION, ...body, continuation: queryPage.cursor, serializedBytes: 0,
      work: { queryServiceElapsedMs: queryPage.work.elapsedMs, sourceElapsedMs,
        renderElapsedMs: performance.now() - renderBegan, totalElapsedMs: performance.now() - began } });
    throwIfAborted(signal);
    return stageSemanticPagePublication(result, publication(queryPage, signal), deferPublication);
  };
};
export const runRepositoryAnswer = createRepositoryAnswerRunner();

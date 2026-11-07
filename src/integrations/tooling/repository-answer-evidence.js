import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { throwIfAborted } from '../../shared/abort.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { withSemanticReaderCleanup, semanticReadDeadlineFailure } from '../../semantic/reader-lifetime.js';
import { createCurrentQuestionFacts } from '../../semantic/questions/current-reader-facts.js';
import { compileRepositoryQuestion } from '../../semantic/questions/compile.js';
import { admitCurrentReaderQuestion } from '../../semantic/questions/current-reader-profile.js';
import { inspectAnswerRevision } from '../../context-pack/answers/render.js';

const equal = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });

/** Revalidate the exact delivered tuple/witness projection, not a fresh query
 * page whose work-boundary/cursor may legitimately differ. Full inventory/domain
 * identity conservatively binds count and negative dependencies. Quotations
 * separately reopen the actual retained-byte owner. No new cursor is produced.
 */
export const createRepositoryAnswerEvidenceVerifier = ({ openStore = openSemanticQueryStore,
  resolveIndexDir = resolveSemanticGenerationIndexDir } = {}) => async (request, input, { signal = null, userConfig = null } = {}) => {
  const answer = inspectAnswerRevision(input, { signal }), repoRoot = getRepoRoot(request.query.repoRoot);
  if (!equal(request.query.question.world, answer.world) || !equal(request.questionRef, answer.questionRef)
    || repoRoot !== answer.world.repositoryNamespace) throw fail('Delivered answer differs from its requested question/world/repository.');
  const plan = compileRepositoryQuestion(request.query.question), receipt = answer.inputs.queryReceipt;
  if (plan.status !== 'compiled' || plan.logicalPlanId !== receipt.logicalPlanId || plan.physicalPlanId !== receipt.physicalPlanId
    || plan.requestDigest !== receipt.requestDigest) throw fail('Delivered answer belongs to a different original question compilation.');
  const config = userConfig || loadUserConfig(repoRoot), deadline = AbortSignal.timeout(250), began = performance.now();
  const readSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const check = () => {
    throwIfAborted(signal);
    if (performance.now() - began >= 250) throw Object.assign(new Error('Exact answer evidence revalidation exceeded its bounded interval. Select a smaller query/quotation page.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
    throwIfAborted(readSignal);
  };
  let indexDir;
  const withStore = async (backend, run) => {
    check();
    const opened = await openStore({ indexDir, repoRoot, generation: request.query.generation, backend, requireQueryIndex: true, signal: readSignal });
    const close = opened.close?.bind(opened);
    await withSemanticReaderCleanup(async () => {
      check();
      const store = opened.store;
      const profile = admitCurrentReaderQuestion(plan, store);
      if (!equal(profile.world, answer.world)) throw fail('Delivered answer inventory/domain changed before reuse.');
      const read = async () => { await run(store, profile); check(); };
      await (typeof store.withReadScope === 'function' ? store.withReadScope(read) : read()); check();
    }, () => close?.());
    check();
  };
  try {
    indexDir = await resolveIndexDir({ repoRoot, generation: request.query.generation, userConfig: config, signal: readSignal });
    await withStore(request.query.backend || 'artifact', async (store, profile) => {
      const state = { seed: null };
      const facts = createCurrentQuestionFacts({ store, profile, state, signal: readSignal, maxStateBytes: 8 * 1024 * 1024,
        diagnose: () => { throw fail('Delivered binding is no longer qualified by the retained reader.'); } });
      for (const row of answer.inputs.queryReceipt.rows) {
        state.seed = { ref: row.bindings.find(binding => binding.sort === 'Invocation').ref };
        for (const expected of row.bindings) {
          check();
          const actual = await facts.readEntity(expected.ref, expected.sort, null), { variable: _variable, ...binding } = expected;
          if (!actual || !equal(actual, binding)) throw fail('Delivered binding source, name, invocation or typed scalar differs.');
        }
        for (const witness of row.witnesses) if (witness.fact) { check(); await facts.verifyFact(witness); }
      }
    });
    if (answer.inputs.quotations.length) await withStore('artifact', async store => {
      if (answer.inputs.quotations.length !== (request.quoteRefs?.length || 0)) throw fail('Delivered quotation selection differs.');
      const records = await store.getRecords(request.quoteRefs, ['span'], { signal: readSignal }); check();
      const excerpts = await store.getSourceSpans(request.quoteRefs, { signal: readSignal, maxBytes: 32768 }); check();
      for (const [index, quote] of answer.inputs.quotations.entries()) {
        const record = records[index], excerpt = excerpts[index];
        if (!record || !equal(record.ref, request.quoteRefs[index])) throw fail('Delivered quotation record is missing.');
        const header = await store.getSourceReference(record, { signal: readSignal }); check();
        if (!header || !excerpt || !equal(excerpt.ref, record.ref) || header.sourceUnitId !== quote.source.sourceUnitId
        || header.sourceHash !== quote.source.sourceHash || header.path !== quote.source.path || header.coordinateUnit !== 'utf16'
        || !equal(record.span, quote.source.span) || !equal(excerpt.span, quote.source.span) || excerpt.sourceHash !== quote.source.sourceHash
        || excerpt.sourceUnitId !== quote.source.sourceUnitId || excerpt.coordinateUnit !== 'utf16' || excerpt.text !== quote.text) throw fail('Delivered quotation differs from its freshly verified retained source.');
      }
    });
    check();
  } catch (error) {
    throw semanticReadDeadlineFailure(error, { signal, deadline,
      createLimitError: () => Object.assign(new Error('Exact answer evidence revalidation exceeded its bounded interval. Select a smaller query/quotation page.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' }) });
  }
};
export const verifyRepositoryAnswerEvidence = createRepositoryAnswerEvidenceVerifier();

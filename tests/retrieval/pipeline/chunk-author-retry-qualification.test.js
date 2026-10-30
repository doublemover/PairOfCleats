import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getScmProvider } from '../../../src/index/scm/registry.js';
import { assertScmProvider } from '../../../src/index/scm/provider.js';
import { hydrateChunkAuthorsForIndex, __testScmChunkAuthorHydration } from '../../../src/retrieval/cli/chunk-authors.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunkIds } from '../../../src/retrieval/output/filters.js';
import { createRetrievalExecutionOutcome } from '../../../src/retrieval/pipeline/execution-outcome.js';
import { isReusableRetrievalExecution } from '../../../src/contracts/retrieval-execution.js';
import { buildSearchDiagnostics } from '../../../src/retrieval/output/search-diagnostics.js';
import { isAbortError } from '../../../src/shared/abort.js';
import { resolveChunkAuthorCacheEvidence, acquireChunkAuthorCache, cacheChunkAuthorFile,
  retireChunkAuthorCache } from '../../../src/retrieval/cli/chunk-author-cache.js';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from '../cache/query-cache-fixture.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('chunk-author-retry-qualification');
await fs.mkdir(path.join(root, '.git'));
const indexDir = path.join(root, 'index-prose'); await fs.mkdir(indexDir);
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ mode: 'prose', buildId: 'one-stable-generation' }));
const provider = getScmProvider('git'), originalAnnotate = provider.annotate, originalProvenance = provider.getRepoProvenance;
let revision = 'a'.repeat(40), behavior, calls = [];
const rows = (files = ['a.txt']) => files.map((file, id) => ({ id, file, startLine: 1, endLine: 1, last_author: 'Alice' }));
const make = files => {
  const chunkMeta = rows(files);
  return { indexDir, state: { buildId: 'one-stable-generation' }, chunkMeta,
    filterIndex: buildFilterIndex(chunkMeta, { fileChargramN: 3 }) };
};
const run = (idx, config = {}, signal = null) => hydrateChunkAuthorsForIndex({ idx, mode: 'prose', rootDir: root,
  userConfig: { indexing: { scm: { provider: 'git', ...config } } }, fileChargramN: 3,
  filtersActive: true, chunkAuthorFilterActive: true, emitOutput: false, signal });
const match = idx => [...filterChunkIds(idx.chunkMeta, { chunkAuthor: 'Bob' }, idx.filterIndex, null, { preferBitmap: false })];
const success = { lines: [{ line: 1, author: 'Bob' }] };
const reset = () => { __testScmChunkAuthorHydration.reset(); calls = []; };
const pendingIn = error => {
  const queue = [error], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (value.cacheOwnershipPending === true) return true;
    queue.push(value.cause, ...(value.errors || []));
  }
  return false;
};
try {
  provider.getRepoProvenance = async () => ({ head: { commitId: revision } });
  provider.annotate = async input => { calls.push(input); assert.equal(input.commitId, revision); return behavior(input); };
  reset(); let unavailable = true;
  behavior = () => unavailable ? { ok: false, reason: 'unavailable' } : success;
  const failed = make(), first = await run(failed);
  assert.equal(first.coverage.state, 'unavailable'); assert.equal(first.coverage.unresolved, 1);
  assert.deepEqual(first.coverage.fileFailures, [{ reason: 'unavailable', files: 1 }]);
  assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0);
  assert.deepEqual(match(failed), [], 'file-level Alice cannot prove line-level Bob');
  const execution = createRetrievalExecutionOutcome({ mode: 'prose', chunkAuthorCoverage: first.coverage, eligibleEmpty: true });
  assert.equal(isReusableRetrievalExecution(execution, 'prose'), false);
  assert.deepEqual(execution.reasons, ['chunk-author-unavailable']);
  const diagnostic = buildSearchDiagnostics({ fidelity: { byMode: { prose: execution } } });
  assert.match(diagnostic.reasons[0].message, /line-author evidence/);
  unavailable = false;
  const recovered = make(), second = await run(recovered);
  assert.equal(second.coverage.state, 'complete'); assert.equal(second.coverage.qualified, 1);
  assert.deepEqual(match(recovered), [0]); assert.equal(calls.length, 2);
  const warm = make(); assert.equal((await run(warm)).cacheHit, true);
  assert.deepEqual(match(warm), [0]); assert.equal(calls.length, 2, 'same successful policy/revision reuses evidence');
  const admittedEvidence = resolveChunkAuthorCacheEvidence([['prose', recovered]]);
  assert.equal(admittedEvidence.qualified, true); assert.ok(admittedEvidence.evidence.prose);
  assert.deepEqual(resolveChunkAuthorCacheEvidence([['prose', failed]]).qualified, false);
  assert.equal(resolveChunkAuthorCacheEvidence([['prose', { chunkAuthorCoverage: structuredClone(second.coverage) }]]).qualified,
    false, 'copied public coverage cannot grant query-cache authority');
  const cacheInput = createQueryCacheLookupInput(path.join(root, 'query-cache'), {
    searchMode: 'prose', runCode: false, runProse: true, chunkAuthorEvidence: admittedEvidence.evidence,
    indexSignaturePayload: { backend: 'memory', modes: { prose: 'admitted-index' } }
  });
  const miss = await resolveQueryCacheLookup(cacheInput);
  await persistSearchSession(createQueryCachePersistInput(miss, { codeHits: [], proseHits: [{ id: 0, file: 'a.txt' }] }));
  assert.equal((await resolveQueryCacheLookup(cacheInput)).cacheHit, true);
  revision = 'd'.repeat(40); const changedRevision = make(); await run(changedRevision);
  const changedEvidence = resolveChunkAuthorCacheEvidence([['prose', changedRevision]]);
  const revised = await resolveQueryCacheLookup({ ...cacheInput, chunkAuthorEvidence: changedEvidence.evidence });
  assert.equal(revised.cacheHit, false, 'final query-result cache requalifies dynamic author evidence');
  assert.notEqual(revised.cacheSignature, miss.cacheSignature);

  reset(); let bAvailable = false;
  behavior = input => input.filePosix === 'b.txt' && !bAvailable ? { ok: false, reason: 'timeout' } : success;
  const partial = make(['a.txt', 'b.txt']), partialResult = await run(partial);
  assert.equal(partialResult.coverage.state, 'partial'); assert.equal(partialResult.coverage.qualified, 1);
  assert.equal(partialResult.coverage.unresolved, 1); assert.deepEqual(match(partial), [0]);
  bAvailable = true;
  const complete = make(['a.txt', 'b.txt']); assert.equal((await run(complete)).coverage.state, 'complete');
  assert.deepEqual(match(complete), [0, 1]);
  assert.equal(calls.filter(input => input.filePosix === 'a.txt').length, 1);
  assert.equal(calls.filter(input => input.filePosix === 'b.txt').length, 2);

  reset(); behavior = () => ({ lines: [{ line: 1, author: 'Bob' }, { line: 2, author: 'Carol' }] });
  await run(make());
  const twoRanges = () => {
    const idx = make(); idx.chunkMeta.push({ ...idx.chunkMeta[0], id: 1, startLine: 2, endLine: 2 });
    idx.filterIndex = buildFilterIndex(idx.chunkMeta); return idx;
  };
  const wider = twoRanges(); assert.equal((await run(wider)).coverage.qualified, 2);
  assert.deepEqual(wider.chunkMeta[1].chunk_authors, ['Carol']); assert.equal(calls.length, 2);
  await run(twoRanges()); assert.equal(calls.length, 2, 'subset evidence cannot certify unseen chunks in the same file');

  reset(); behavior = () => success;
  const disabled = make(); assert.equal((await run(disabled, { provider: 'none' })).coverage.state, 'unavailable');
  assert.equal(calls.length, 0); assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0);
  assert.equal((await run(make())).coverage.state, 'complete'); assert.equal(calls.length, 1);
  assert.equal((await run(make(), { annotate: { enabled: false } })).coverage.state, 'unavailable');
  assert.equal(calls.length, 1);
  revision = 'b'.repeat(40); await run(make()); assert.equal(calls.length, 2, 'same artifacts with changed SCM revision cannot hit');
  await run(make(), { annotate: { timeoutMs: 2000 } }); assert.equal(calls.length, 3, 'effective provider policy participates in reuse');
  const reusedWrapper = make(); await run(reusedWrapper);
  assert.deepEqual(match(reusedWrapper), [0]);
  const noProvider = await run(reusedWrapper, { provider: 'none' });
  assert.equal(noProvider.coverage.state, 'unavailable'); assert.deepEqual(match(reusedWrapper), [], 'a reused request wrapper requalifies its overlay against current policy');

  reset();
  for (const [result, reason] of [[{ ok: false, reason: 'unsupported' }, 'unsupported'], [{ lines: [] }, 'no-author-lines']]) {
    behavior = () => result;
    const missing = await run(make()); assert.equal(missing.coverage.state, 'unavailable');
    assert.deepEqual(missing.coverage.fileFailures, [{ reason, files: 1 }]);
    assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0);
  }
  behavior = () => success; assert.equal((await run(make())).coverage.state, 'complete');

  reset();
  let release, entered;
  const admitted = new Promise(resolve => { entered = resolve; });
  behavior = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const controller = new AbortController(), canceled = make(), originalRows = canceled.chunkMeta, originalFilter = canceled.filterIndex;
  const hydration = run(canceled, {}, controller.signal);
  const observed = hydration.then(() => null, error => error);
  await admitted; controller.abort(); release(success);
  const cancellation = await observed;
  assert.ok(isAbortError(cancellation) || cancellation?.errors?.some(isAbortError));
  assert.strictEqual(canceled.chunkMeta, originalRows); assert.strictEqual(canceled.filterIndex, originalFilter);
  assert.equal(canceled.chunkMeta[0].chunk_authors, undefined);
  assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0);

  reset(); let closed = false;
  const original = Object.freeze(Object.assign(new Error('unconfirmed annotation resource'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => closed
  }));
  behavior = () => { throw original; };
  await assert.rejects(run(make()), pendingIn);
  const wrapped = assertScmProvider({ ...provider, annotate() { throw original; } });
  await assert.rejects(wrapped.annotate({ repoRoot: root, filePosix: 'a.txt' }), pendingIn);
  closed = true;
  assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0);
  assert.ok(__testScmChunkAuthorHydration.getStats().cacheBytes <= 16 * 1024 * 1024);
  reset();
  for (let index = 0; index < 17; index++) {
    const key = `bounded:${index}`, { entry } = acquireChunkAuthorCache(key);
    cacheChunkAuthorFile(key, entry, 'a.txt', new Map([['id:0', Object.freeze(['Bob'])]]));
    assert.ok(__testScmChunkAuthorHydration.getStats().cacheEntries <= 16);
  }
  const oldest = acquireChunkAuthorCache('bounded:0'); assert.equal(oldest.hit, false);
  retireChunkAuthorCache('bounded:0', oldest.entry);
  reset();
  const large = acquireChunkAuthorCache('large');
  cacheChunkAuthorFile('large', large.entry, 'a.txt', new Map([['id:0', ['x'.repeat(9 * 1024 * 1024)]]]));
  retireChunkAuthorCache('large', large.entry);
  assert.equal(__testScmChunkAuthorHydration.getStats().cacheEntries, 0, 'oversized positive evidence is served without global retention');
} finally {
  provider.annotate = originalAnnotate; provider.getRepoProvenance = originalProvenance;
  __testScmChunkAuthorHydration.reset();
}
console.log('SCM author cache retains only qualified successes, retries missing files and exposes incomplete filtering');

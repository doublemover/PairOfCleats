import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveQueryCacheLookup } from '../../../src/retrieval/cli/run-search-session/cache-policy.js';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { createRetrievalExecutionOutcome } from '../../../src/retrieval/pipeline/execution-outcome.js';
import { createQueryCacheLookupInput, createQueryCachePersistInput } from './query-cache-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { RETRIEVAL_EXECUTION_VERSION } from '../../../src/contracts/retrieval-execution.js';

const { dir } = await prepareIsolatedTestCacheDir('query-execution-admission');
try {
  const input = createQueryCacheLookupInput(dir, { cacheMemoryFreshMs: 0 });
  const miss = await resolveQueryCacheLookup(input);
  await persistSearchSession(createQueryCachePersistInput(miss));
  const canonicalHit = await resolveQueryCacheLookup(input);
  assert.equal(canonicalHit.cacheHit, true);
  assert.equal(canonicalHit.cacheHotPathHit, false, 'zero freshness validates the canonical disk entry on each lookup');
  const original = JSON.parse(await fs.readFile(miss.queryCachePath, 'utf8'));
  assert.equal(original.entries[0].meta.executionOutcomes.code.schemaVersion, RETRIEVAL_EXECUTION_VERSION);
  const touchPath = `${miss.queryCachePath}.touches.json`;
  const touchBytes = await fs.readFile(touchPath, 'utf8');
  for (const change of [
    // Exact old persisted v1 proof could certify a swallowed LanceDB failure.
    entry => { entry.meta.executionOutcomes.code.schemaVersion = 1; },
    // v2 could replace a healthy empty FTS execution with a different backend.
    entry => { entry.meta.executionOutcomes.code.schemaVersion = 2; },
    entry => { delete entry.meta.executionOutcomes; },
    entry => { entry.meta.executionOutcomes = {}; },
    entry => { entry.meta.executionOutcomes.code = createRetrievalExecutionOutcome({ mode: 'code', annRequested: true }); },
    entry => { entry.meta.executionOutcomes.code = createRetrievalExecutionOutcome({ mode: 'code', sparseBudget: true }); },
    entry => { entry.meta.executionOutcomes.code.mode = 'prose'; },
    entry => { entry.meta.executionOutcomes.code.reasons = ['unqualified-provider-reason']; },
    entry => { entry.meta.executionOutcomes.code.extraUnqualified = true; }
  ]) {
    const altered = structuredClone(original); change(altered.entries[0]);
    const body = JSON.stringify(altered); await fs.writeFile(miss.queryCachePath, body);
    assert.equal((await resolveQueryCacheLookup(input)).cacheHit, false);
    assert.equal(await fs.readFile(miss.queryCachePath, 'utf8'), body, 'rejected proof is not rewritten as healthy');
    assert.equal(await fs.readFile(touchPath, 'utf8'), touchBytes, 'invalid/degraded/legacy metadata cannot refresh a sliding timestamp');
  }
  const partial = { code: createRetrievalExecutionOutcome({ mode: 'code', sparseFailed: true }) };
  await persistSearchSession(createQueryCachePersistInput(miss, { cacheKey: 'partial-result',
    cacheData: { version: 1, entries: [] }, executionOutcomes: partial, queryCachePath: path.join(dir, 'partial.json') }));
  await assert.rejects(fs.stat(path.join(dir, 'partial.json')), { code: 'ENOENT' });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Cache outcome admission rejects incomplete, missing, malformed and wrong-mode proof before touch/publication.');

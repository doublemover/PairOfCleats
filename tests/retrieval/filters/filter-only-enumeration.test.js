#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFilterEnumeration, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';
import { createSearchPipelineFixture, createAlphaSearchIndex } from '../helpers/search-pipeline-fixture.js';
import { createSearchOutputHitState, renderSearchOutputForTest } from '../helpers/search-output-fixture.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { hasSearchFilterArgs, parseSearchArgs } from '../../../src/retrieval/cli-args.js';

const chunks = Array.from({ length: 31 }, (_, id) => ({ id, file: `src/${id}.ts`, chunkUid: `uid:${id}`,
  kind: id % 3 ? 'FunctionDeclaration' : 'ClassDeclaration', tokens: ['never-queried'],
  docmeta: { returns: id % 2 ? 'boolean' : 'Promise<boolean>', extends: ['Base'] },
  codeRelations: { calls: [['caller', 'callee']] } }));
const idx = createAlphaSearchIndex({ chunks, tokenIndex: null });
idx.filterIndex = buildFilterIndex(chunks);
const generation = { buildId: 'generation-one' };
const collect = async (filters, useSqlite) => {
  let cursor = null;
  const ids = [];
  do {
    const enumeration = createFilterEnumeration({ cursor, filters, generation, modes: ['code'] });
    const fail = () => { throw new Error('No sparse, ANN, or model work may run for filter enumeration'); };
    const pipeline = createSearchPipelineFixture({ query: '', queryTokens: [], filters, filtersActive: true,
      filterEnumeration: enumeration, topN: 2, maxCandidates: 1, annEnabled: true,
      useSqlite, sqliteHasTable: fail, getTokenIndexForQuery: fail, rankSqliteFts: fail, createAnnProviders: fail });
    const hits = await pipeline(idx, 'code', fail);
    ids.push(...hits.map((hit) => hit.id));
    const page = buildFilterPagination(enumeration, { code: hits });
    assert.equal(page.total, 15);
    cursor = page.nextCursor;
    if (cursor) {
      assert.throws(() => createFilterEnumeration({ cursor, filters: { returnType: 'number' }, generation, modes: ['code'] }), /filters or modes/);
      assert.throws(() => createFilterEnumeration({ cursor, filters, generation: { buildId: 'two' }, modes: ['code'] }), /generation changed/);
    }
  } while (cursor);
  assert.deepEqual(ids, chunks.filter((c) => c.id % 2).map((c) => c.id));
};
await collect({ returnType: 'boolean' }, false);
await collect({ returnType: 'boolean' }, true);
for (const filters of [{ type: 'ClassDeclaration' }, { extends: 'Base' }, { calls: 'callee' }]) {
  const enumeration = createFilterEnumeration({ filters, generation, modes: ['code'] });
  const pipeline = createSearchPipelineFixture({ query: '', queryTokens: [], filters, filtersActive: true, filterEnumeration: enumeration, topN: 100 });
  const hits = await pipeline(idx, 'code', null);
  assert.equal(hits.length, filters.type ? 11 : 31);
}
const caller = createSearchPipelineFixture({ filters: { calls: 'caller' }, filtersActive: true });
assert.deepEqual(await caller(idx, 'code', null), [], 'calls filters the callee, not the owning function name');
const empty = createFilterEnumeration({ filters: { returnType: 'void' }, generation, modes: ['code'] });
const emptyPipeline = createSearchPipelineFixture({ query: '', queryTokens: [], filters: { returnType: 'void' }, filtersActive: true, filterEnumeration: empty });
assert.deepEqual(await emptyPipeline(idx, 'code', null), []);
assert.equal(buildFilterPagination(empty, { code: [] }).total, 0);
const budgeted = createFilterEnumeration({ filters: { returnType: 'boolean' }, generation, modes: ['code'] });
budgeted.byMode.code = { offset: 0, total: 15 };
const reducedPage = buildFilterPagination(budgeted, { code: [{ id: 1 }] });
assert.equal(createFilterEnumeration({ cursor: reducedPage.nextCursor, filters: { returnType: 'boolean' }, generation, modes: ['code'] }).offsets.code, 1);
assert.throws(() => buildFilterPagination(budgeted, { code: [] }), /output budget/);
assert.equal(hasSearchFilterArgs(parseSearchArgs(['--return-type', 'boolean'])), true);
assert.equal(hasSearchFilterArgs(parseSearchArgs(['--json', '--mode', 'code'])), false);
assert.throws(() => createFilterEnumeration({ cursor: 'broken', filters: {}, generation, modes: ['code'] }), /Invalid/);
const filters = { type: 'FunctionDeclaration' };
let multiCursor = null;
const multiIds = { code: [], prose: [] };
do {
  const enumeration = createFilterEnumeration({ cursor: multiCursor, filters, generation, modes: ['code', 'prose', 'records'] });
  const pipeline = createSearchPipelineFixture({ query: '', queryTokens: [], filters, filtersActive: true, filterEnumeration: enumeration, topN: 3 });
  const code = await pipeline(idx, 'code', null);
  const prose = await pipeline(createAlphaSearchIndex({ chunks: chunks.slice(0, 2), tokenIndex: null }), 'prose', null);
  const records = await pipeline(createAlphaSearchIndex({ chunks: [], tokenIndex: null }), 'records', null);
  assert.deepEqual(records, []);
  multiIds.code.push(...code.map(hit => hit.id));
  multiIds.prose.push(...prose.map(hit => hit.id));
  const page = buildFilterPagination(enumeration, { code, prose, records });
  assert.equal(page.total, 21);
  assert.deepEqual(page.byMode.records, { offset: 0, total: 0, returned: 0, hasMore: false });
  multiCursor = page.nextCursor;
} while (multiCursor);
assert.deepEqual(multiIds.code, chunks.filter(chunk => chunk.id % 3).map(chunk => chunk.id));
assert.deepEqual(multiIds.prose, [1], 'exhausted modes do not restart or steal another mode offset');
const timeFilters = { modifiedSinceDays: 7, modifiedAfter: 100 };
const timed = createFilterEnumeration({ filters: timeFilters, generation, modes: ['code'] });
timed.byMode.code = { offset: 0, total: 2 };
const timeCursor = buildFilterPagination(timed, { code: [{ id: 1 }] }).nextCursor;
const continued = createFilterEnumeration({ cursor: timeCursor, filters: { ...timeFilters, modifiedAfter: 150 }, generation, modes: ['code'] });
assert.equal(continued.modifiedAfter, 100, 'relative modification cutoff is pinned to the first page');
// Exercise the real renderer's byte-budget path. Every returned mode must be a
// prefix of its page so cursor offsets can advance by the actual emitted count.
let budgetCursor = null;
const budgetIds = { code: [], prose: [] };
let budgetTruncated = false;
do {
  const enumeration = createFilterEnumeration({ cursor: budgetCursor, filters, generation, modes: ['code', 'prose'] });
  const pipeline = createSearchPipelineFixture({ query: '', queryTokens: [], filters, filtersActive: true,
    filterEnumeration: enumeration, topN: 20 });
  const code = await pipeline(idx, 'code', null);
  const prose = await pipeline(idx, 'prose', null);
  const page = renderSearchOutputForTest({
    ...createSearchOutputHitState({ codeHits: code, proseHits: prose }),
    topN: 20, runProse: true, queryTokens: [], filterEnumeration: enumeration,
    outputBudget: { totalMaxBytes: 12000 }
  });
  for (const [mode, offered] of Object.entries({ code, prose })) {
    assert.deepEqual(page[mode].map(hit => hit.id), offered.slice(0, page[mode].length).map(hit => hit.id));
    budgetIds[mode].push(...page[mode].map(hit => hit.id));
  }
  budgetTruncated ||= page.outputBudget?.truncated === true;
  budgetCursor = page.pagination.nextCursor;
} while (budgetCursor);
assert.equal(budgetTruncated, true, 'fixture must exercise actual output trimming');
for (const mode of ['code', 'prose']) assert.deepEqual(budgetIds[mode], multiIds.code);
console.log('complete filter-only enumeration test passed');

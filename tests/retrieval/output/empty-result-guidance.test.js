import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { createSearchOutputOptions, createSearchOutputHitState } from '../helpers/search-output-fixture.js';

const render = (options = {}) => renderSearchOutput(createSearchOutputOptions(options));
const plain = render();
assert.equal(plain.retrieval.emptyResults[0].code, 'no-query-match');
const filtered = render({ filtersActive: true });
assert.equal(filtered.retrieval.emptyResults[0].code, 'query-with-filters');
assert.ok(filtered.retrieval.emptyResults.some((entry) => entry.code === 'coverage-check'));
const fallback = render({ backendPolicyInfo: { reason: 'sqlite unavailable; memory fallback' } });
assert.ok(fallback.retrieval.emptyResults.some((entry) => entry.code === 'backend-fallback'));
const nonempty = render(createSearchOutputHitState({ codeHits: [{ file: 'a.js', name: 'a', score: 1 }] }));
assert.equal(nonempty.retrieval.emptyResults, undefined);
console.log('empty results carry observed constraints and actionable recovery');

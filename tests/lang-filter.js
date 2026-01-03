import assert from 'node:assert/strict';
import { mergeExtFilters, normalizeLangFilter } from '../src/search/filters.js';

const js = normalizeLangFilter('js');
assert.ok(js && js.includes('.js'), 'expected js to include .js');
assert.ok(js && js.includes('.jsx'), 'expected js to include .jsx');

const mixed = normalizeLangFilter('ts,python');
assert.ok(mixed && mixed.includes('.ts'), 'expected mixed to include .ts');
assert.ok(mixed && mixed.includes('.py'), 'expected mixed to include .py');

const extFilter = ['.ts', '.tsx'];
const langFilter = normalizeLangFilter('typescript');
const merged = mergeExtFilters(extFilter, langFilter);
assert.ok(merged, 'expected merged to be non-null');
assert.deepEqual(new Set(merged), new Set(extFilter));

const mergedEmpty = mergeExtFilters(['.ts'], normalizeLangFilter('python'));
assert.equal(mergedEmpty, null);

const unknown = normalizeLangFilter('unknown');
assert.equal(unknown, null);

console.log('lang filter test passed');

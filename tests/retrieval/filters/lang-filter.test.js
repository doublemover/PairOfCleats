import assert from 'node:assert/strict';
import { mergeExtFilters, mergeLangFilters, normalizeLangFilter } from '../../../src/retrieval/filters.js';

const js = normalizeLangFilter('js');
assert.ok(js && js.includes('javascript'), 'expected js to include javascript');

const mixed = normalizeLangFilter('ts,python');
assert.ok(mixed && mixed.includes('typescript'), 'expected mixed to include typescript');
assert.ok(mixed && mixed.includes('python'), 'expected mixed to include python');

const extFilterInfo = mergeExtFilters(['.ts'], ['.tsx']);
assert.equal(extFilterInfo.impossible, true, 'expected ext filter intersection to be impossible');
assert.equal(extFilterInfo.values, null, 'expected ext filter values to be null on conflict');

const langFilterInfo = mergeLangFilters(normalizeLangFilter('typescript'), normalizeLangFilter('ts'));
assert.equal(langFilterInfo.impossible, false, 'expected lang filter to be possible');
assert.ok(langFilterInfo.values && langFilterInfo.values.length === 1 && langFilterInfo.values[0] === 'typescript', 'expected lang filter to dedupe');

const unknown = normalizeLangFilter('unknown');
assert.ok(unknown && unknown.includes('unknown'), 'expected unknown to pass through');

console.log('lang filter test passed');

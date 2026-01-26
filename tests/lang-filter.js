import assert from 'node:assert/strict';
import { mergeExtFilters, mergeLangFilters, normalizeLangFilter } from '../src/retrieval/filters.js';

const js = normalizeLangFilter('js');
assert.ok(js && js.includes('javascript'), 'expected js to include javascript');

const mixed = normalizeLangFilter('ts,python');
assert.ok(mixed && mixed.includes('typescript'), 'expected mixed to include typescript');
assert.ok(mixed && mixed.includes('python'), 'expected mixed to include python');

const extFilter = mergeExtFilters(['.ts'], ['.tsx']);
assert.ok(extFilter && extFilter.includes('.ts') && extFilter.includes('.tsx'), 'expected ext filter union');

const langFilter = mergeLangFilters(normalizeLangFilter('typescript'), normalizeLangFilter('ts'));
assert.ok(langFilter && langFilter.length === 1 && langFilter[0] === 'typescript', 'expected lang filter to dedupe');

const unknown = normalizeLangFilter('unknown');
assert.ok(unknown && unknown.includes('unknown'), 'expected unknown to pass through');

console.log('lang filter test passed');

import assert from 'node:assert/strict';
import { collectJsonImports, createStrictJsonImportCollector } from '../../../src/index/language-registry/import-collectors/json.js';
import { createJsonConfigAdapter } from '../../../src/index/language-registry/adapters/config-files.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/imports/json-collector-admission/')[1];
const cases = ['json-budget', 'jsonc-budget', 'resolved-budget', 'anonymous-budget', 'match-budget', 'namespace-budget',
  'zero-caps', 'source-admission', 'line-admission', 'strict-syntax', 'duplicate-depth', 'wide', 'nested-keys',
  'frontier', 'time-before', 'time-after', 'cancelled', 'registry-handoff', 'invalid-reference', 'deep-jsonc-only'];
assert.ok(cases.includes(mode), `Unknown case ${mode}`);
const source = '{"includes":["first","second"]}';
const unlimited = { collectorScanBudget: { maxMs: 0, maxTokens: 0, maxMatches: 0 } };
const receipt = result => { const value = getImportExtraction(result); assert.ok(value); assert.equal(value.counts.retained, result.length); return value; };
if (['json-budget', 'jsonc-budget', 'resolved-budget', 'anonymous-budget', 'match-budget', 'namespace-budget'].includes(mode)) {
  const ext = { 'json-budget': '.json', 'jsonc-budget': '.jsonc', 'resolved-budget': '.resolved' }[mode];
  const options = { ext, collectorScanBudget: { maxTokens: 1, maxMs: 0 } };
  if (mode === 'match-budget') options.collectorScanBudget = { maxMatches: 1, maxMs: 0 };
  if (mode === 'namespace-budget') {
    options.collectorScanBudget = { maxTokens: 10, maxMs: 0 };
    options.collectorScanBudgets = { imports: { maxTokens: 2 }, 'imports:json': { maxTokens: 1 } };
  }
  const result = collectJsonImports(source, options);
  assert.deepEqual(result, ['first']);
  const extraction = receipt(result);
  assert.equal(extraction.state, 'partial'); assert.equal(extraction.reusePolicy, 'refresh-required');
  assert.ok(extraction.reasonCounts[mode === 'match-budget' ? 'scan_matches' : 'scan_tokens']);
  assert.match(extraction.scope, /json-reference-policy-v2/);
} else if (mode === 'zero-caps') {
  const result = collectJsonImports(source, unlimited);
  assert.deepEqual(result, ['first', 'second']); assert.equal(receipt(result).state, 'complete');
} else if (['source-admission', 'line-admission', 'time-before', 'time-after', 'cancelled'].includes(mode)) {
  let calls = 0, work, clock = 0;
  const collector = createStrictJsonImportCollector({ parseValue: text => {
    calls++; if (mode === 'time-after') clock = 25; return JSON.parse(text);
  }, onWork: value => { work = value; } });
  const options = { collectorNow: () => mode === 'time-before' ? (clock += 20) : clock,
    collectorScanBudget: { maxMs: mode.startsWith('time-') ? 10 : 0 } };
  let input = source;
  if (mode === 'source-admission') { input = '{} trailing-invalid-source'; options.collectorScanBudget.maxChars = 2; }
  if (mode === 'line-admission') { input = '{\n"include":"first"\n}'; options.collectorScanBudget.maxLines = 1; }
  if (mode === 'cancelled') { const controller = new AbortController(); controller.abort(); options.signal = controller.signal; }
  const result = collector(input, options), extraction = receipt(result);
  assert.deepEqual(result, []); assert.equal(calls, mode === 'time-after' ? 1 : 0);
  assert.equal(work.parserCalls, calls); assert.equal(work.parseInterruptible, false);
  assert.equal(extraction.recognition, 'unknown');
  if (mode === 'cancelled') assert.equal(extraction.state, 'cancelled');
  else assert.equal(extraction.state, 'partial');
  if (mode.startsWith('time-')) assert.ok(extraction.reasonCounts.scan_time);
  if (mode === 'time-after') assert.equal(work.parseElapsedMs, 25, 'completed synchronous parse cost is accounting, not interruption');
  if (mode === 'source-admission') { assert.equal(extraction.source.admittedLength, 2); assert.ok(extraction.reasonCounts.source_bytes); }
  if (mode === 'line-admission') assert.ok(extraction.reasonCounts.scan_lines);
} else if (mode === 'strict-syntax') {
  for (const invalid of ['{/* comment */"include":"first"}', '{"include":"first",}']) {
    for (const ext of [undefined, '.json', '.resolved']) {
      const result = collectJsonImports(invalid, { ...unlimited, ext });
      assert.deepEqual(result, []); assert.equal(receipt(result).state, 'invalid');
    }
    assert.deepEqual(collectJsonImports(invalid, { ...unlimited, ext: '.jsonc' }), ['first']);
  }
} else if (mode === 'duplicate-depth') {
  const duplicate = '{"include":"old","include":"new","nested":{"$ref":"old2","$ref":"new2"}}';
  assert.deepEqual(collectJsonImports(duplicate, unlimited), ['new', 'new2']);
  const input = '{"include":{"direct":"first","level":{"child":{"leaf":"at-three","deep":{"value":"over-depth"}}}},"nested":{"$ref":"restart"},"__proto__":{"include":"own"},"constructor":{"include":"ctor"}}';
  const result = collectJsonImports(input, unlimited);
  assert.deepEqual(result, ['first', 'at-three', 'restart', 'own', 'ctor']);
  assert.deepEqual(collectJsonImports(input, { ...unlimited, ext: '.jsonc' }), result);
  const deep = '{"value":'.repeat(80) + '{"include":"deep.json"}' + '}'.repeat(80);
  assert.deepEqual(collectJsonImports(deep, unlimited), ['deep.json']);
  assert.deepEqual(collectJsonImports(deep, { ...unlimited, ext: '.jsonc' }), ['deep.json']);
} else if (mode === 'deep-jsonc-only') {
  const input = '{"value":'.repeat(80) + '{/* valid JSONC */"include":"deep.json"}' + '}'.repeat(80);
  const result = collectJsonImports(input, { ...unlimited, ext: '.jsonc' }), extraction = receipt(result);
  assert.deepEqual(result, []); assert.equal(extraction.state, 'partial');
  assert.equal(extraction.reasonCounts['depth-limit'], 1);
  assert.equal(extraction.reasonCounts['strict-depth-compat-unavailable'], 1);
  assert.equal(extraction.reasonCounts['parse-failed'], undefined, 'a failed strict compatibility attempt cannot diagnose JSONC syntax');
  assert.equal(extraction.recognition, 'unknown');
} else if (mode === 'wide') {
  for (const value of [Array.from({ length: 40 }, (_, index) => `file-${index}`),
    Object.fromEntries(Array.from({ length: 40 }, (_, index) => [String(index), `file-${index}`]))]) {
    let work;
    const collector = createStrictJsonImportCollector({ traversalLimits: { nodes: 8, frames: 4 }, onWork: value => { work = value; } });
    const result = collector(JSON.stringify({ includes: value }), unlimited);
    assert.deepEqual(result, Array.from({ length: 6 }, (_, index) => `file-${index}`));
    assert.equal(work.visitedNodes, 8); assert.ok(work.peakFrames <= 4); assert.equal(work.observedReferences, 6);
    assert.equal(receipt(result).counts.observed, 6); assert.equal(receipt(result).reasonCounts['node-limit'], 1);
  }
} else if (mode === 'nested-keys') {
  let work;
  const collector = createStrictJsonImportCollector({ traversalLimits: { nodes: 7, frames: 4 }, onWork: value => { work = value; } });
  const result = collector('{"include":{"source":{"include":["first","second"]},"other":"third"}}', unlimited);
  assert.deepEqual(result, ['first', 'second', 'third']);
  assert.equal(work.visitedNodes, 7); assert.equal(work.peakFrames, 4); assert.equal(work.complete, true);
  assert.equal(work.observedReferences, 3); assert.equal(receipt(result).state, 'complete');
} else if (mode === 'frontier') {
  let work;
  const collector = createStrictJsonImportCollector({ traversalLimits: { nodes: 20, frames: 2 }, onWork: value => { work = value; } });
  const result = collector('{"a":{"b":{"c":{"include":"deep"}}}}', unlimited);
  assert.deepEqual(result, []); assert.equal(work.peakFrames, 2); assert.equal(work.visitedNodes, 2);
  assert.equal(receipt(result).reasonCounts['depth-limit'], 1); assert.equal(receipt(result).recognition, 'unknown');
} else if (mode === 'registry-handoff') {
  const adapter = createJsonConfigAdapter(), options = { collectorScanBudget: { maxTokens: 1, maxMs: 0 } };
  const result = adapter.buildRelations({ text: source, ext: '.json', options });
  assert.deepEqual(result.imports, ['first']); assert.equal(result.importExtraction.state, 'partial');
  assert.equal(result.importExtraction.reasonCounts.scan_tokens, 1);
  assert.equal(result.importExtraction.steps.at(-1).owner, 'simple-relations');
  assert.equal(result.importExtraction.counts.retained, 1);
} else {
  const result = collectJsonImports('{"include":"\\u0000"}', unlimited);
  assert.deepEqual(result, []); assert.equal(receipt(result).state, 'partial');
  assert.ok(receipt(result).reasonCounts.reference_value_invalid); assert.equal(receipt(result).recognition, 'unknown');
}
console.log(`JSON collector admission: ${mode}`);

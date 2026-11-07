#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectCssImportEntries, prepareCssSource } from '../../src/lang/css/source.js';
import { collectCssImports } from '../../src/lang/css.js';
import { canReuseImportExtraction, getImportExtraction } from '../../src/shared/import-extraction.js';

const cases = [
  ['/* @import "./ghost.css"; */', []],
  ['.notice::before { content: "@import url(./fake.css)"; }', []],
  ['@import "./real.css";', ['./real.css']],
  ['@import url( "./real.css" );', ['./real.css']],
  ['@import "./theme wide.css";', ['./theme wide.css']],
  ['@import/**/"./real.css";', ['./real.css']],
  ['@IMPORT URL(./real.css);', ['./real.css']],
  [String.raw`@im\70 ort u\72l(./re\61l.css);`, ['./real.css']],
  [String.raw`@import "./quote\".css";`, ['./quote".css']],
  [String.raw`@import "./slash\\.css";`, ['./slash\\.css']],
  [String.raw`@import url(./wide\ name.css);`, ['./wide name.css']],
  ['@import "thing,"; @import "thing"; @import "thing;"; @import "thing)";', ['thing,', 'thing', 'thing;', 'thing)']],
  ['@import "  thing  ";', ['  thing  ']],
  ['@import url(./theme;v=1.css);', ['./theme;v=1.css']],
  ['/*🧪*/\r\n@import "./real.css" layer(theme) supports(display: grid) screen and (min-width: 1px);', ['./real.css']],
  ['@layer reset, theme; @import "./real.css" layer;', ['./real.css']],
  ['@media screen { @import "./nested.css"; }', []],
  ['a[data-note="@import fake"] { --x: url("@import fake"); }', []],
  ['@import "./real.css"; /* @import "./ghost.css"; */ .n { content: "@import fake"; }', ['./real.css']],
  ['@import "./real.css"; @import "./real.css";', ['./real.css', './real.css']]
];
for (const [source, expected] of cases) {
  const facts = prepareCssSource(source);
  assert.deepEqual(facts.imports.map(value => value.specifier), expected, source);
  assert.equal(facts.coverage.state, 'complete', source);
  const entries = collectCssImportEntries(source, { cssSourceFacts: facts });
  assert.equal(canReuseImportExtraction(getImportExtraction(entries), entries), true, 'only owned complete token facts qualify');
  const imports = collectCssImports(source, { cssSourceFacts: facts });
  assert.equal(canReuseImportExtraction(getImportExtraction(imports), imports), true, 'the string projection retains qualification');
  for (const value of facts.imports) {
    assert.equal(source.slice(value.literalStart, value.literalEnd), value.raw);
    assert.ok(source.slice(value.start, value.end).toLowerCase().startsWith('@im'), source);
    assert.equal(value.coordinateSystem, 'utf16');
    assert.equal(value.provenance, 'parsed-literal');
  }
}
const source = '/*🧪*/\r\n@import url( "./real.css" ) layer(theme) supports(display: grid) screen and (min-width: 1px);';
const facts = prepareCssSource(source), value = facts.imports[0];
assert.equal(value.start, source.indexOf('@'));
assert.equal(value.literalStart, source.indexOf('url('));
assert.equal(value.valueStart, source.indexOf('./real.css'));
assert.equal(source.slice(value.valueStart, value.valueEnd), './real.css');
assert.equal(value.qualifiers.layer.raw, 'layer(theme)');
assert.equal(value.qualifiers.supports.raw, 'supports(display: grid)');
assert.equal(value.qualifiers.media.raw, 'screen and (min-width: 1px)');
assert.equal(value.qualifiers.interpretation, 'source-only');
const duplicate = collectCssImportEntries('@import "thing,"; @import "thing"; @import "thing,";');
assert.deepEqual(duplicate.map(entry => entry.specifier), ['thing,', 'thing']);
assert.equal(duplicate.coverage.occurrences, 3, 'deduplication cannot erase source occurrence evidence');
assert.equal(getImportExtraction(duplicate).steps[0].duplicates, 1);
assert.equal(getImportExtraction(duplicate).counts.observed, 3);

for (const source of ['@import url();', '@import "";', '@import "unterminated', '@import url(./wide name.css);',
  '@import url("./bad.css" extra);', '@import "./one.css" @import "./two.css";',
  '@import\\\n"./bad.css";', '@import { @import "./ghost.css"; }',
  '.n {} @import "./late.css";', '/* unterminated @import "./ghost.css";']) {
  const diagnostics = [];
  const malformed = prepareCssSource(source, { collectorDiagnostics: diagnostics });
  assert.deepEqual(malformed.imports, [], source);
  assert.equal(malformed.coverage.state, 'partial', source);
  const entries = collectCssImportEntries(source, { cssSourceFacts: malformed });
  assert.equal(canReuseImportExtraction(getImportExtraction(entries), entries), false, 'malformed syntax cannot qualify empty imports');
  assert.ok(diagnostics.some(entry => entry.type === 'css-source-coverage'), source);
}
const bounded = prepareCssSource('@import "./good.css"; @import "./cut.css";', { collectorScanBudget: { maxChars: 36 } });
assert.deepEqual(bounded.imports.map(entry => entry.specifier), ['./good.css']);
assert.ok(bounded.coverage.reasons.includes('source_bytes'));
const tokens = prepareCssSource('@import "./one.css"; @import "./two.css";', { collectorScanBudget: { maxTokens: 4 } });
assert.equal(tokens.coverage.state, 'partial');
assert.ok(tokens.coverage.tokens <= 4);
const capped = prepareCssSource('@import "./one.css"; @import "./two.css";', { collectorScanBudget: { maxMatches: 1 } });
assert.deepEqual(capped.imports.map(entry => entry.specifier), ['./one.css']);
assert.ok(capped.coverage.reasons.includes('scan_matches'));
const abort = new AbortController(); abort.abort();
assert.equal(prepareCssSource('@import "./real.css";', { abortSignal: abort.signal }).coverage.state, 'cancelled');
let observations = 0;
const cancelled = prepareCssSource('/*' + 'a'.repeat(4096) + '*/ @import "./late.css";',
  { abortSignal: { get aborted() { return ++observations >= 3; } } });
assert.equal(cancelled.coverage.state, 'cancelled');
assert.ok(cancelled.coverage.scannedLength < 4096, 'long tokens check cancellation within bounded work');
let now = 0;
const timed = prepareCssSource('@import "./late.css";', { collectorScanBudget: { maxMs: 2 }, collectorNow: () => now++ });
assert.equal(timed.coverage.state, 'partial');
assert.ok(timed.coverage.reasons.includes('scan_time'));
assert.equal(prepareCssSource('@import "./real.css";', { ext: '.scss' }).coverage.state, 'unsupported');
assert.equal(prepareCssSource(source, { cssSourceFacts: facts }), facts, 'same source and policy reuse owned facts');
assert.notEqual(prepareCssSource(source + '\n', { cssSourceFacts: facts }), facts);
assert.notEqual(prepareCssSource(source, { cssSourceFacts: { ...facts } }), facts, 'a copied shape is not an owned preparation');
assert.notEqual(prepareCssSource(source, { cssSourceFacts: facts, collectorScanBudget: { maxTokens: 1 } }), facts);
assert.equal(prepareCssSource(source, { cssSourceFacts: facts, ext: '.less' }).coverage.state, 'unsupported');
for (const options of [{ collectorScanBudget: { maxChars: 8 } }, { collectorScanBudget: { maxTokens: 1 } },
  { collectorScanBudget: { maxMatches: 1 } }, { signal: abort.signal }, { ext: '.scss' }]) {
  const entries = collectCssImportEntries('@import "./one.css"; @import "./two.css";', { cssSourceFacts: facts, ...options });
  assert.equal(canReuseImportExtraction(getImportExtraction(entries), entries), false, 'changed policy, cancellation and unsupported dialect cannot borrow complete evidence');
}
const braceSource = '.n { content: "}"; /* } */ color: red; }\r\n.other { color: blue; }';
assert.deepEqual(prepareCssSource(braceSource).blocks.map(block => braceSource.slice(block.start, block.end)),
  ['.n { content: "}"; /* } */ color: red; }', '.other { color: blue; }']);
console.log('CSS source token imports test passed');

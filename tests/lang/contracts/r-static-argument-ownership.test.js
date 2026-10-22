import assert from 'node:assert/strict';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { collectRImports } from '../../../src/index/language-registry/import-collectors/r.js';

const cases = [
  ['source(file="R/helpers.R", local=TRUE)', ['R/helpers.R']],
  ['source(local=TRUE, file="R/helpers.R")', ['R/helpers.R']],
  ['source(local=TRUE, "R/helpers.R")', ['R/helpers.R']],
  ['library(quietly=TRUE, dplyr)', ['dplyr']],
  ['require(quietly=TRUE, package="tidyr")', ['tidyr']],
  ['requireNamespace(quietly=TRUE, package="jsonlite")', ['jsonlite']],
  ['library(`dplyr`, character.only=FALSE)', ['dplyr']],
  ['library(`dplyr`, character.only=TRUE)', []],
  ['library(dplyr, character.only=`FALSE`)', []],
  ['requireNamespace(`dynamic`)', []],
  ['source(`dynamic`)', []],
  ['source(file=dynamic)', []],
  ['source(file="one.R", file="two.R")', []],
  ['library(package="one", package="two")', []],
  ['library(dynamic,character.only=FALSE,character.only=TRUE)', []],
  ['library("outer", quietly=source(file="nested.R"))', ['outer', 'nested.R']],
  ['require(source("nested.R"),character.only=TRUE)', ['nested.R']],
  ['print("source(file=\\"phantom.R\\")")\n# source("comment.R")\nsource(file="actual.R")', ['actual.R']],
  [String.raw`source("R/\x68elpers.R")`, ['R/helpers.R']],
  [String.raw`source('R/\u0061.R')`, ['R/a.R']],
  [String.raw`source("R/\141.R")`, ['R/a.R']],
  [String.raw`source("R/\U0001f600.R")`, ['R/😀.R']],
  [String.raw`source("R/\U{1f600}.R")`, ['R/😀.R']],
  [String.raw`source("R/\q.R")`, []],
  [String.raw`source("R/\xff.R")`, []],
  [String.raw`source("R/\uD800.R")`, []],
  [String.raw`source("R/\U00110000.R")`, []],
  [String.raw`source("R/\x00.R")`, []],
  [String.raw`source("R/quote\"name.R")`, ['R/quote"name.R']],
  ['source(" schema files/base.R ")', [' schema files/base.R ']],
  ['source("schema/part;)")', ['schema/part;)']],
  ['source("schema files/base.R")\nrequire("dplyr", quietly=TRUE)', ['schema files/base.R', 'dplyr']]
];
const adapter = getLanguageForFile('.r', 'input.r');
assert.equal(adapter.id, 'r');
const options = { collectorNow: () => 0 };
for (const [source, expected] of cases) {
  assert.deepEqual(collectRImports(source, options), expected, source);
  assert.deepEqual(adapter.collectImports(source, options), expected, `registered collection: ${source}`);
  const relations = adapter.buildRelations({ text: source, options, context: {} });
  assert.deepEqual(relations.imports, expected.toSorted(), `registered relation projection: ${source}`);
}
const diagnostics = [];
assert.deepEqual(collectRImports('library("one")\nlibrary("two")', { ...options,
  collectorDiagnostics: diagnostics, collectorScanBudget: { maxMatches: 1 } }), ['one']);
assert.ok(diagnostics.some(value => value.collectorId === 'imports:r' && value.reasons.includes('scan_matches')));
let clock = 0;
const timed = [];
assert.deepEqual(collectRImports('library("one")\nlibrary("two")', { collectorNow: () => ++clock,
  collectorDiagnostics: timed, collectorScanBudget: { maxMs: 3 } }), []);
assert.ok(timed.some(value => value.reasons.includes('scan_time')), 'lexical work participates in the existing time allowance');
console.log('R static argument ownership through registered dependency consumers test passed');

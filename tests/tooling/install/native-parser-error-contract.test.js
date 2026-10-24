import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { probeNativeParserWorkerLifecycle } from '../../../src/shared/native-package-probe.js';

const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const parser = new Parser(); parser.setLanguage(require('tree-sitter-javascript'));
const sentinel = new Error('owned input callback failed');
assert.throws(() => parser.parse(() => { throw sentinel; }), error => error === sentinel,
  'ordinary input callback errors retain object identity');
parser.reset();
assert.throws(() => parser.setLanguage({}), /Invalid language/);
parser.setLanguage(require('tree-sitter-javascript'));
assert.throws(() => parser.parse('let x = 1;', null, { includedRanges: [
  { startIndex: 0, endIndex: 5, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 5 } },
  { startIndex: 2, endIndex: 8, startPosition: { row: 0, column: 2 }, endPosition: { row: 0, column: 8 } }
] }), /Overlapping ranges/);
parser.reset();
assert.equal(parser.parse('function recovered(){ return 1; }').rootNode.hasError, false);
// Each probe owns a fresh Node process and both natural and interrupted workers.
// These are ten independent lifecycle cases; failures are never retried.
for (let caseIndex = 1; caseIndex <= 10; caseIndex += 1) {
  const result = probeNativeParserWorkerLifecycle(process.cwd());
  assert.equal(result.ok, true, `fresh lifecycle ${caseIndex}: ${result.message}`);
  console.log(`native parser fresh lifecycle ${caseIndex}/10 passed`);
}
console.log('Native parser shutdown succeeds and ordinary callback, language and range errors remain strict.');

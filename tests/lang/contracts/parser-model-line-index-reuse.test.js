import assert from 'node:assert/strict';
import { createGraphqlStructureParser } from '../../../src/shared/graphql-ast.js';
import { createHandlebarsStructureParser } from '../../../src/shared/handlebars-ast.js';

const observeLinePushes = (parse, source) => {
  const push = Array.prototype.push;
  let startsAdded = 0;
  Array.prototype.push = function(...values) {
    if (this[0] === 0 && values.length === 1 && Number.isInteger(values[0])) startsAdded += 1;
    return push.apply(this, values);
  };
  try { return { result: parse(source), startsAdded }; }
  finally { Array.prototype.push = push; }
};

const cases = [
  {
    name: 'GraphQL', create: createGraphqlStructureParser, source: '# comment\n'.repeat(64) + 'scalar X',
    parser: { parse: () => ({ kind: 'Document', definitions: [] }) },
    huge: 'x'.repeat(786433), tooManyLines: '\n'.repeat(5001), coverage: 'syntax-only'
  },
  {
    name: 'Handlebars', create: createHandlebarsStructureParser, source: 'a\r\nb\rc\n'.repeat(32),
    parser: { parseWithoutProcessing: () => ({ type: 'Program', body: [] }) },
    huge: 'x'.repeat(524289), tooManyLines: '\r'.repeat(3001), coverage: 'syntax-only'
  }
];

for (const entry of cases) {
  let loads = 0;
  let setupTicks = 0;
  const parse = entry.create({
    loadParser: () => { loads += 1; return entry.parser; },
    initializationNow: () => { setupTicks += 1; return setupTicks * 5; }
  });
  const cold = observeLinePushes(parse, entry.source);
  const warm = observeLinePushes(parse, entry.source);
  console.log(`${entry.name}: cold line-start additions${cold.startsAdded}, warm${warm.startsAdded}`);
  assert.equal(cold.result.coverage, entry.coverage);
  assert.ok(cold.startsAdded > 0);
  assert.equal(warm.result, cold.result, 'reuse the same immutable model');
  assert.equal(warm.startsAdded, 0, 'successful identical source must not rebuild its line index');
  assert.equal(loads, 1);
  assert.equal(setupTicks, 2);
  assert.equal(parse.initialize().elapsedMs, 5);
  assert.equal(setupTicks, 2, 'the original one-time setup receipt remains stable');
  assert.equal(parse(entry.huge).reason, 'source-limit');
  assert.equal(parse(entry.tooManyLines).reason, 'line-limit');
  assert.equal(parse(entry.source), cold.result, 'rejected input does not replace the prior valid model');
  assert.ok(Object.isFrozen(cold.result));

  const replacement = parse(entry.source + ' ');
  assert.notEqual(replacement, cold.result);
  assert.notEqual(parse(entry.source), cold.result, 'cache still holds only one successful text/model');
  let failedLoads = 0;
  const missing = entry.create({ loadParser: () => { failedLoads += 1; throw new Error('Controlled unavailable component'); } });
  assert.equal(missing(entry.source).reason, 'parser-unavailable');
  assert.equal(missing(entry.source).reason, 'parser-unavailable');
  assert.equal(failedLoads, 1);
  assert.equal(missing(entry.tooManyLines).reason, 'line-limit', 'existing rejection precedence is preserved');
}
console.log('parser model line-index reuse passed; source/line limits, one-time setup and bounded model replacement preserved');

import assert from 'node:assert/strict';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
const count = 2000;
const nodes = Array.from({ length: count }, (_, id) => ({ id: `node-${id}.js`,
  out: id ? [`node-${id - 1}.js`] : [], in: id + 1 < count ? [`node-${id + 1}.js`] : [] }));
const tests = nodes.slice(1).map(node => node.id);
const input = { graphRelations: { importGraph: { nodes } }, changed: [nodes[0].id], tests,
  indexCompatKey: 'predecessor-fixture', caps: { maxDepth: count, maxNodes: count,
    maxEdges: count * 2, maxWorkUnits: count * 2, maxSuggestions: 1 } };
const concat = Array.prototype.concat;
let copiedTrailSlots = 0;
let report;
try {
  Array.prototype.concat = function (...args) {
    if (this.length && typeof this[0] === 'string' && this[0].startsWith('node-')
      && args.some(arg => Array.isArray(arg) && String(arg[0]).startsWith('node-'))) copiedTrailSlots += this.length;
    return concat.apply(this, args);
  };
  report = buildSuggestTestsReport(input);
} finally { Array.prototype.concat = concat; }
assert.equal(copiedTrailSlots, 0, 'BFS retains predecessor links rather than copied trails');
assert.equal(report.suggestions.length, 1);
assert.equal(report.suggestions[0].testPath, 'node-1.js');
assert.equal(report.suggestions[0].witnessPath.nodes.length, 2);
assert.equal(report.fidelity.graph.visitedNodes, count);
assert.ok(report.truncation.some(row => row.cap === 'maxSuggestions' && row.observed === count - 1));
assert.equal(buildSuggestTestsReport({ ...input, caps: { ...input.caps, maxSuggestions: 0 } }).suggestions.length, 0);
const end = buildSuggestTestsReport({ ...input, tests: [nodes[count - 1].id] });
assert.equal(end.suggestions[0].witnessPath.nodes.length, count);
console.log('Suggest-tests retains linear predecessor state and materializes only selected witnesses.');

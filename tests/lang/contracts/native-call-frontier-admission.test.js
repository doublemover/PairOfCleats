import assert from 'node:assert/strict';
import { getTreeSitterParser, buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { attachSyntaxCallFacts } from '../../../src/lang/tree-sitter/call-facts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const shapes = {
  wide: 'def owner(): Int = {\n' + Array.from({ length: 1200 }, (_, index) => `target${index}()`).join('\n') + '\n1\n}',
  declarations: Array.from({ length: 160 }, (_, index) => `def owner${index}(): Int = target${index}()`).join('\n'),
  deep: 'def owner(): Int = {\n' + 'if (ready) {\n'.repeat(80) + 'target()\n' + '}\n'.repeat(80) + '1\n}'
};
const parser = getTreeSitterParser('scala', { treeSitter: { enabled: true } });
assert.ok(parser, 'actual prepared Scala native parser is required');
const samples = [];
for (const [shape, text] of Object.entries(shapes)) {
  const tree = parser.parse(text);
  try {
    assert.equal(tree.rootNode.hasError, false, `${shape}: independently valid native syntax`);
    for (const useQueries of [true, false]) {
      const options = { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false,
        useQueries, maxAstNodes: 100000, maxAstStack: 100000, maxChunkNodes: 1000 } };
      const complete = buildTreeSitterChunks({ text, languageId: 'scala', ext: '.scala', options });
      assert.ok(complete?.length, shape);
      const expected = complete.flatMap(chunk => chunk.meta.syntaxCalls || []);
      assert.equal(expected.length, shape === 'wide' ? 1200 : shape === 'declarations' ? 160 : 1);
      for (const budget of [{ maxNodes: 1, maxStack: 1 }, { maxNodes: 64, maxStack: 8 }, { maxNodes: 100000, maxStack: 4 }]) {
        const chunks = complete.map(chunk => ({ ...chunk, meta: { ...chunk.meta } }));
        const metrics = attachSyntaxCallFacts(tree.rootNode, text, chunks, { ...budget, languageId: 'scala' });
        assert.equal(metrics.truncated, shape !== 'deep' || budget.maxNodes < 100000,
          'depth alone does not require a broad frontier; the known admitted shape determines completeness');
        assert.ok(metrics.maxFrontier <= budget.maxStack);
        assert.ok(metrics.frontierChildAccesses <= budget.maxNodes);
        assert.ok(chunks.filter(chunk => chunk.meta.syntaxCalls).every(chunk => Object.isFrozen(chunk.meta.syntaxCalls)
          && (!metrics.truncated || chunk.meta.syntaxCallCoverage.includes('traversal-budget'))));
        if (!metrics.truncated) assert.deepEqual(chunks.flatMap(chunk => chunk.meta.syntaxCalls || []), expected);
        samples.push({ shape, useQueries, budget, ...metrics, retained: chunks.reduce((sum, chunk) => sum + (chunk.meta.syntaxCalls?.length || 0), 0) });
      }
      const repeated = complete.map(chunk => ({ ...chunk, meta: { ...chunk.meta } }));
      const metrics = attachSyntaxCallFacts(tree.rootNode, text, repeated, { maxNodes: 100000, maxStack: 100000, languageId: 'scala' });
      assert.equal(metrics.truncated, false);
      assert.deepEqual(repeated.flatMap(chunk => chunk.meta.syntaxCalls || []), expected,
        'complete equivalent owner/role/range occurrence evidence is invariant under admitted traversal');
      const bounded = buildTreeSitterChunks({ text, languageId: 'scala', ext: '.scala',
        options: { treeSitter: { ...options.treeSitter, maxAstNodes: 64, maxAstStack: 8 } } });
      assert.ok(bounded === null || bounded.every(chunk => !chunk.meta.syntaxCalls || chunk.meta.syntaxCallCoverage.includes('partial')),
        'actual query/walk consumers propagate their resolved small budget');
    }
  } finally { tree.delete?.(); parser.reset?.(); }
}
console.log(JSON.stringify({ kind: 'native-frontier-correctness-counts', samples }));

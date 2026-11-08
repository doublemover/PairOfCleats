import assert from 'node:assert/strict';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { nativeDeclarationOptions } from '../../helpers/native-declaration-acceptance.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const cases = [
  { name: 'no-call', text: 'def first(): Int = 1\ndef second(): Int = 2\n', calls: [] },
  { name: 'independent', text: 'def first(): Int = alpha()\ndef second(): Int = beta()\n',
    calls: [['first', 'alpha', 'alpha()'], ['second', 'beta', 'beta()']] },
  { name: 'recursive', text: 'def recur(n: Int): Int = if (n == 0) 0 else recur(n - 1)\n',
    calls: [['recur', 'recur', 'recur(n - 1)']] },
  { name: 'qualified', text: 'object Box { def caller(): Int = helper(); def helper(): Int = 1 }\n',
    calls: [['Box.caller', 'helper', 'helper()']] },
  { name: 'comment-and-string', text: '// def ghost() = invented()\ndef real(): String = "ghost() invented()"\n', calls: [] },
  { name: 'nullary', text: 'def first: Int = alpha()\ndef second: Int = 2\n', calls: [['first', 'alpha', 'alpha()']] },
  { name: 'starvation', text: [...'abcdefghijkl'].map(name => `def ${name}(): Int = 1`).join('\n')
      + '\ndef zzz(): Int = target()\n', calls: [['zzz', 'target', 'target()']] },
  { name: 'positive', text: 'def real(): Int = helper()\n', calls: [['real', 'helper', 'helper()']] }
];
const expectedOwners = {
  'no-call': ['first', 'second'], independent: ['first', 'second'], recursive: ['recur'],
  qualified: ['Box.caller', 'Box.helper'], 'comment-and-string': ['real'], nullary: ['first', 'second'],
  starvation: [...'abcdefghijkl', 'zzz'], positive: ['real']
};
const parser = getNativeTreeSitterParser('scala'); assert.ok(parser);
const ordered = rows => rows.map(row => JSON.stringify(row)).toSorted();
for (const spec of cases) {
  const tree = parser.parse(spec.text);
  try { assert.equal(tree.rootNode.hasError, false, spec.name + ': authored native syntax'); }
  finally { tree.delete?.(); parser.reset?.(); }
  let previous = null;
  for (const useQueries of [false, true]) {
    const options = { ...nativeDeclarationOptions, treeSitter: { ...nativeDeclarationOptions.treeSitter, useQueries } };
    const before = treeSitterState.metrics.queryExecutions || 0;
    const fixture = await prepareRegisteredLanguage({ text: spec.text, ext: '.scala', relPath: spec.name + '.scala', options });
    if (useQueries) assert.ok((treeSitterState.metrics.queryExecutions || 0) > before, 'actual native Query must execute');
    const expected = spec.calls.map(([owner, callee]) => [owner, callee]);
    for (const relations of [fixture.raw, fixture.relations]) assert.deepEqual(ordered(relations.calls), ordered(expected), spec.name);
    const projected = fixture.projected.flatMap((row, index) => (row.callDetails || []).map(detail => {
      assert.equal(detail.callerStart, fixture.chunks[index].start);
      assert.equal(detail.callerEnd, fixture.chunks[index].end);
      return [fixture.chunks[index].name, detail.callee, detail.start, detail.end];
    }));
    const occurrences = spec.calls.map(([owner, callee, literal]) => {
      const start = spec.text.indexOf(literal); assert.ok(start >= 0);
      return [owner, callee, start, start + literal.length];
    });
    assert.deepEqual(ordered(projected), ordered(occurrences), spec.name + ': exact owner and complete invocation ranges');
    assert.deepEqual(ordered(fixture.projected.flatMap(row => row.calls || [])), ordered(expected));
    const callable = chunk => /Function|Method/u.test(chunk.kind);
    assert.deepEqual(fixture.chunks.filter(callable).map(chunk => chunk.name).toSorted(),
      expectedOwners[spec.name].toSorted(), spec.name + ': every independently expected callable must remain available');
    for (const [index, chunk] of fixture.chunks.entries()) {
      assert.ok(chunk.chunkUid, spec.name + ': canonical identity');
      if (callable(chunk)) {
        assert.ok(Array.isArray(chunk.meta.syntaxCalls) && Object.isFrozen(chunk.meta.syntaxCalls), spec.name + ': callable occurrence snapshot');
        assert.equal(chunk.meta.syntaxCallCoverage, 'complete-supported-call-roles', spec.name + ': known empty is complete callable evidence');
        assert.equal(fixture.projected[index].callCoverage, 'complete-supported-call-roles');
      } else {
        assert.equal(spec.name, 'qualified'); assert.equal(chunk.name, 'Box'); assert.equal(chunk.kind, 'ObjectDeclaration');
        assert.equal(chunk.meta.syntaxCalls, undefined, 'a container is not a callable with an empty native snapshot');
        assert.equal(fixture.projected[index].callDetails, undefined);
        assert.deepEqual(fixture.projected[index].calls || [], [], 'container projection cannot inherit its methods\' invocations');
      }
    }
    assert.ok(!fixture.chunks.some(chunk => ['ghost', 'invented'].includes(chunk.name)));
    const sites = createCallSites({ chunks: fixture.chunks.map((chunk, index) => ({ ...chunk,
      file: spec.name + '.scala', lang: 'scala', codeRelations: fixture.projected[index] })) });
    assert.equal(validateArtifact('call_sites', sites).ok, true); assert.equal(sites.length, occurrences.length);
    for (const [owner, callee, start, end] of occurrences) {
      const chunk = fixture.chunks.find(row => row.name === owner); assert.ok(chunk);
      assert.ok(sites.some(site => site.callerChunkUid === chunk.chunkUid && site.calleeRaw === callee && site.start === start && site.end === end));
    }
    const observed = { uids: fixture.chunks.map(chunk => [chunk.name, chunk.chunkUid]), projected, sites };
    if (previous) assert.deepEqual(observed, previous, spec.name + ': query/walk identity and evidence parity');
    previous = observed;
  }
}
console.log('Scala original attribution controls preserve exact registered/default-filter/call-index/chunk evidence.');

import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { attachSyntaxCallFacts } from '../../../src/lang/tree-sitter/call-facts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const project = async (id, ext, text) => {
  const input = { text, ext, relPath: 'scopes' + ext, mode: 'code', options: {
    treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false },
    astDataflowEnabled: false, controlFlowEnabled: false
  } };
  const { lang, context } = await buildLanguageContext(input);
  const chunks = context[id + 'Chunks'];
  assert.ok(chunks?.some(chunk => /Function|Method/.test(chunk.kind)), 'native declaration owner must be available');
  const raw = lang.buildRelations({ ...input, context });
  const relations = filterRawRelationsWithLexicon(raw, { languageId: id, relKey: input.relPath });
  const selected = chunks.map((chunk, index) => ({ ...chunk, id: index,
    file: input.relPath, lang: id, chunkUid: `${id}:owner:${chunk.name}:${chunk.start}` }));
  const index = buildCallIndex(relations); attachCallDetailsByChunkIndex(index, selected);
  for (const [chunkIndex, chunk] of selected.entries()) {
    chunk.codeRelations = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex: index, chunkIndex });
  }
  const sites = createCallSites({ chunks: selected });
  assert.equal(validateArtifact('call_sites', sites).ok, true);
  return { chunks: selected, relations, sites };
};

const julia = await project('julia', '.jl', `function empty()
  1
end
function outer(value)
  helper(value)
  callback = x -> nested(x)
  map(value) do x
    nestedDo(x)
  end
  helper(value)
end
function recur(n)
  n == 0 ? 0 : recur(n - 1)
end
`);
const outer = julia.chunks.find(chunk => chunk.name === 'outer');
const empty = julia.chunks.find(chunk => chunk.name === 'empty');
const recur = julia.chunks.find(chunk => chunk.name === 'recur');
assert.deepEqual(outer.codeRelations.callDetails.map(detail => detail.callee), ['helper', 'map', 'helper']);
assert.deepEqual(empty.codeRelations.calls || [], [], 'a declaration signature is not recursive invocation');
assert.deepEqual(recur.codeRelations.calls, [['recur', 'recur']], 'genuine recursion remains');
assert.equal(recur.codeRelations.callDetails.length, 1, 'the signature does not create another recursive occurrence');
assert.equal(outer.codeRelations.callOmissions.anonymousScopeCalls, 2);
assert.ok(outer.codeRelations.callOmissions.declarationHeaderCalls >= 1);
assert.ok(outer.codeRelations.callCoverage.includes('unowned-callable-scope'));
assert.ok(julia.relations.callCoverageReasons.some(reason => reason.includes('declaration-header-call-roles')));
assert.equal(julia.sites.filter(site => site.calleeRaw === 'helper').length, 2,
  'repeated source occurrences survive adjacency dedup and canonical output');
assert.ok(!julia.sites.some(site => ['nested', 'nestedDo', 'empty', 'outer'].includes(site.calleeRaw)));
assert.ok(Object.isFrozen(outer.meta.syntaxCallOmissions));

const groovy = await project('groovy', '.groovy', `class Box {
  def outer() {
    before();
    def callback = { nested(); };
    after();
  }
  def greet() { println 'ready'; }
}
`);
const groovyOuter = groovy.chunks.find(chunk => chunk.name === 'Box.outer');
assert.ok(groovyOuter, 'native qualified caller names survive relation projection');
assert.deepEqual(groovyOuter.codeRelations.callDetails.map(detail => detail.callee), ['before', 'after']);
assert.equal(groovyOuter.codeRelations.callOmissions.anonymousScopeCalls, 1);
assert.ok(!groovy.sites.some(site => site.calleeRaw === 'nested'));
assert.ok(groovy.sites.some(site => site.calleeRaw === 'println'), 'parenthesis-free grammar invocation remains addressable');

// Grammar-role control also exercises interrupted traversal finalization without
// invoking native parsers or depending on a wall-clock cutoff.
const text = 'owner() nested()';
const id = { type: 'identifier', startIndex: 8, endIndex: 14, namedChildren: [] };
const call = { type: 'call_expression', startIndex: 8, endIndex: 16,
  childForFieldName: name => name === 'function' ? id : null, namedChildren: [id] };
for (const type of ['closure_expression', 'lambda_literal', 'anonymous_function', 'arrow_function_expression', 'do_clause']) {
  const scope = { type, startIndex: 8, endIndex: 16, namedChildren: [call] };
  const root = { type: 'function_definition', startIndex: 0, endIndex: 16, namedChildren: [scope] };
  const owner = { name: 'owner', kind: 'FunctionDeclaration', start: 0, end: 16, meta: {} };
  attachSyntaxCallFacts(root, text, [owner]);
  assert.deepEqual(owner.meta.syntaxCalls, []);
  assert.equal(owner.meta.syntaxCallOmissions.anonymousScopeCalls, 1);
  assert.ok(owner.meta.syntaxCallCoverage.startsWith('partial-'));
}
const root = { type: 'function_definition', startIndex: 0, endIndex: 16, namedChildren: [call] };
const limited = { name: 'owner', kind: 'FunctionDeclaration', start: 0, end: 16, meta: {} };
attachSyntaxCallFacts(root, text, [limited], { maxNodes: 1 });
assert.ok(Object.isFrozen(limited.meta.syntaxCalls));
assert.ok(Object.isFrozen(limited.meta.syntaxCallOmissions));
assert.equal(limited.meta.syntaxCallCoverage, 'partial-traversal-budget');
console.log('Native call roles preserve lexical ownership, omission reasons and canonical occurrence identity');

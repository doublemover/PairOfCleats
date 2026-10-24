import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { applyRelationInferenceBudget, buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { applyChunkingLimits } from '../../../src/index/chunking/limits.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { buildKotlinRelations } from '../../../src/lang/kotlin.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const options = { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false },
  astDataflowEnabled: false, controlFlowEnabled: false };
const prepare = async (text, ext, key) => {
  const input = { text, ext, relPath: `native-occurrences${ext}`, mode: 'code', options };
  const { lang, context } = await buildLanguageContext(input);
  const chunks = context[key];
  assert.ok(chunks?.length, `${ext}: real registered native chunks are required`);
  const raw = lang.buildRelations({ ...input, context });
  const relations = filterRawRelationsWithLexicon(raw, { languageId: lang.id, relKey: input.relPath });
  const index = buildCallIndex(relations);
  attachCallDetailsByChunkIndex(index, chunks);
  return { ...input, lang, chunks, relations, index };
};
const callees = relations => (relations.calls || []).map(([, callee]) => callee).sort();
const project = (fixture, chunk, index = fixture.index, relations = fixture.relations) => buildChunkRelations({
  lang: fixture.lang, chunk, fileRelations: relations, callIndex: index, chunkIndex: fixture.chunks.indexOf(chunk)
});
const assertOwner = (fixture, chunk, expected) => {
  assert.ok(chunk);
  assert.ok(Array.isArray(chunk.meta.syntaxCalls), 'ownership comes from the parser snapshot');
  for (const index of [null, fixture.index]) {
    const selected = project(fixture, chunk, index);
    assert.deepEqual(callees(selected), [...expected].sort());
    assert.deepEqual((selected.callDetails || []).map(detail => detail.callee).sort(), [...expected].sort());
    assert.ok((selected.callDetails || []).every(detail => detail.callerStart === chunk.start && detail.callerEnd === chunk.end));
  }
};
const canonicalRows = (fixture, chunks = fixture.chunks) => {
  const rows = createCallSites({ chunks: chunks.map((chunk, id) => ({ ...chunk, id, file: fixture.relPath,
    lang: fixture.lang.id, chunkUid: `native-owner-${id}`, codeRelations: project(fixture, chunk) })) });
  assert.equal(validateArtifact('call_sites', rows).ok, true);
  assert.equal(new Set(rows.map(row => row.callSiteId)).size, rows.length, 'each native occurrence reaches one owner');
  return rows;
};

const cpp = await prepare([
  '// Non-BMP prefix 😀',
  'int work(int value);',
  'int work(int value) { auto deferred = [] { lambda_only(); }; return first(value); }',
  'int work(double value) { return second(value); }',
  'int configured(int value = header_default());',
  'int guarded() noexcept(noexcept(probe())) { return body(); }',
  'struct Holder { int value; Holder() : value(seed()) {} };',
  'int partitioned() {',
  '  before();',
  '  across(',
  '    argument()',
  '  );',
  '  after();',
  '}',
  ''
].join('\r\n'), '.cpp', 'clikeChunks');
const overloads = cpp.chunks.filter(chunk => chunk.name === 'work');
assert.equal(overloads.length, 3, 'a prototype and two overload definitions retain distinct owners');
assertOwner(cpp, overloads[0], []);
assertOwner(cpp, overloads[1], ['first']);
assertOwner(cpp, overloads[2], ['second']);
assert.ok(overloads[1].meta.syntaxCallOmissions.anonymousScopeCalls > 0);
const configured = cpp.chunks.find(chunk => chunk.name === 'configured');
assertOwner(cpp, configured, []);
assert.ok(configured.meta.syntaxCallOmissions.declarationHeaderCalls > 0, 'call-site defaults need a separate execution owner');
assert.match(project(cpp, configured).callCoverage, /partial.*declaration-header-call-roles/u);
const guarded = cpp.chunks.find(chunk => chunk.name === 'guarded');
assertOwner(cpp, guarded, ['body']);
assert.ok(guarded.meta.syntaxCallOmissions.declarationHeaderCalls > 0, 'unevaluated noexcept calls are not body calls');
const constructor = cpp.chunks.find(chunk => chunk.meta?.syntaxCalls?.some(detail => detail.callee === 'seed'));
assertOwner(cpp, constructor, ['seed']);
const cppRows = canonicalRows(cpp);
assert.equal(cppRows.filter(row => row.calleeRaw === 'first').length, 1);
assert.equal(cppRows.filter(row => row.calleeRaw === 'second').length, 1);
for (const absent of ['work', 'header_default', 'probe', 'lambda_only']) {
  assert.equal(cppRows.some(row => row.calleeRaw === absent), false, `${absent}: no header or deferred-scope invention`);
}
const original = overloads[1].meta.syntaxCalls[0];
assert.ok(Object.isFrozen(original));
const derived = project(cpp, overloads[1]).callDetails[0];
assert.ok(!Object.isFrozen(derived), 'inference annotates a derived view');
derived.targetChunkUid = 'later-resolved-target';
assert.equal(original.targetChunkUid, undefined);

for (const budget of [{ maxCalls: 0 }, { maxCallDetails: 0 }]) {
  const limited = { ...cpp.relations, calls: [...cpp.relations.calls], callDetails: [...cpp.relations.callDetails] };
  applyRelationInferenceBudget({ relations: limited, ...budget });
  const selected = project(cpp, overloads[1], buildCallIndex(limited), limited);
  assert.deepEqual(selected.calls, [], 'native metadata cannot restore either dropped inference channel');
  if (budget.maxCallDetails === 0) {
    assert.equal(selected.callDetails, undefined);
    assert.match(selected.callCoverage, /unavailable-call-occurrence-details/u);
  }
}
const partitioned = cpp.chunks.find(chunk => chunk.name === 'partitioned');
const windows = applyChunkingLimits([partitioned], cpp.text, {
  chunking: { maxLines: 2, useLanguageRoleDefaults: false }, relPath: cpp.relPath, ext: cpp.ext, mode: 'code'
});
assert.ok(windows.length > 1);
const windowIndex = buildCallIndex(cpp.relations);
attachCallDetailsByChunkIndex(windowIndex, windows);
const projected = windows.map((chunk, chunkIndex) => buildChunkRelations({ lang: cpp.lang, chunk,
  fileRelations: cpp.relations, callIndex: windowIndex, chunkIndex }));
assert.deepEqual(projected.flatMap(row => (row.callDetails || []).map(detail => detail.callee)).sort(), ['after', 'argument', 'before']);
assert.ok(projected.filter(row => /split-call-occurrence/u.test(row.callCoverage || '')).length >= 2);
for (let index = 0; index < windows.length; index++) {
  assert.ok((projected[index].callDetails || []).every(detail => detail.start >= windows[index].start && detail.end <= windows[index].end));
}
const windowRows = createCallSites({ chunks: windows.map((chunk, id) => ({ ...chunk, id, file: cpp.relPath,
  lang: cpp.lang.id, chunkUid: `split-owner-${id}`, codeRelations: projected[id] })) });
assert.equal(windowRows.length, 3);
assert.equal(new Set(windowRows.map(row => row.callSiteId)).size, 3);
assert.equal(validateArtifact('call_sites', windowRows).ok, true);

const ruby = await prepare([
  'def same(value = default_call())',
  '  first()',
  'end',
  'def same(value)',
  '  second()',
  'end',
  ''
].join('\n'), '.rb', 'rubyChunks');
const redefinitions = ruby.chunks.filter(chunk => chunk.name === 'same');
assert.equal(redefinitions.length, 2);
assertOwner(ruby, redefinitions[0], ['default_call', 'first']);
assertOwner(ruby, redefinitions[1], ['second']);
assert.equal(canonicalRows(ruby).length, 3);

const php = await prepare('<?php\ninterface Service { public function run(): int; }\nfunction other() { alpha(); }\n', '.php', 'phpChunks');
assertOwner(php, php.chunks.find(chunk => chunk.name === 'Service.run'), []);
assertOwner(php, php.chunks.find(chunk => chunk.name === 'other'), ['alpha']);
assert.equal(canonicalRows(php).length, 1);

// The shared detail handoff must obey an existing per-language admission gate.
// Reuse actual native immutable facts here; no second parser is needed.
const denied = buildKotlinRelations(cpp.text, [overloads[1]], {
  kotlin: { relationsMaxBytes: 1, relationsMaxLines: 1 }
});
assert.deepEqual(denied.calls, []);
assert.equal(denied.callDetails, undefined);

// Native chunks also serve independent relation producers. Their metadata is
// not authority to reinterpret a Babel observation as a tree-sitter occurrence.
const javascript = await prepare('function keep() { return actual(); }\n', '.js', 'jsChunks');
assert.notEqual(javascript.relations.callOwnership, 'native-syntax-occurrences-v1');
const keep = javascript.chunks.find(chunk => chunk.name === 'keep');
assert.ok(Array.isArray(keep.meta.syntaxCalls));
assert.deepEqual(callees(project(javascript, keep)), ['actual']);
console.log('Native occurrence ownership survives overloads, redefinitions, budgeted projection and split windows.');

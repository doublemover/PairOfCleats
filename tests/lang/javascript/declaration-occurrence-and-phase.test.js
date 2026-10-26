import assert from 'node:assert/strict';
import { getLanguageForFile, buildChunkRelations } from '../../../src/index/language-registry.js';
import { retainModuleCallChunks } from '../../../src/index/build/file-processor/cpu/chunking.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { preparedJavaScriptRelations } from '../../../src/lang/javascript/prepared-relations.js';
import { buildCallIndex, buildFileRelations } from '../../../src/index/build/file-processor/relations.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { resolveJavaScriptDeclaration } from '../../../src/lang/javascript/callable-occurrences.js';
import { serializeCachedRow } from '../../../src/index/build/artifacts/writers/chunk-meta/shared.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const lang = getLanguageForFile('.js', 'fixture.js');
const prepare = async (text, parser) => {
  const options = { javascript: { parser }, treeSitter: { enabled: false }, astDataflowEnabled: true, controlFlowEnabled: true };
  const context = await lang.prepare({ text, ext: '.js', relPath: 'fixture.js', mode: 'code', options });
  assert.equal(getJavaScriptSyntaxIdentity(context.jsAst).family, parser, 'fallback is not qualification of the requested parser');
  const relations = lang.buildRelations({ text, ext: '.js', relPath: 'fixture.js', context, options });
  assert.equal(preparedJavaScriptRelations(text, 'fixture.js', context, options), relations, 'one prepared relation traversal is shared');
  const declarations = buildJsChunks(text, { ...options, ast: context.jsAst });
  const index = buildCallIndex(relations);
  const chunks = retainModuleCallChunks({ chunks: declarations, callIndex: index, jsDeclarations: relations.jsDeclarations, languageId: 'javascript', textLength: text.length });
  const values = chunks.map(chunk => {
    const docmeta = enrichFlowFixture({ text, chunk, lang, context, options, fileRelations: relations, callIndex: index, relationsEnabled: true });
    const projected = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex: index });
    const payload = assembleFlowFixture({ text, chunk, docmeta, lang: 'javascript', ext: '.js', codeRelations: projected });
    assert.deepEqual(validateMetadataV2Semantics(payload.metaV2), []);
    assert.deepEqual(JSON.parse(serializeCachedRow(payload)).metaV2.javascriptDeclaration, docmeta.javascriptDeclaration);
    return { chunk, docmeta, projected, payload };
  });
  const file = buildFileRelations(relations, 'fixture.js');
  const validation = validateArtifact('file_relations', [{ file: 'fixture.js', relations: file }]);
  assert.equal(validation.ok, true, validation.errors.join('; '));
  return { text, options, context, relations, chunks, index, values, file };
};

const collisions = `class Box {
  same(value = 1) { instanceOnly(value); return value; }
  static same(other, extra = 2) { staticOnly(other); throw new Error(); }
  get item() { return readGet(); }
  set item(value) { writeSet(value); }
  #hidden(secret) { privateOnly(secret); }
  [key()](dynamic) { dynamicOnly(dynamic); }
}
function same(value) { outerOnly(value); return value; }
function host() { function same(other) { innerOnly(other); throw new Error(); } }
const exposed = function internal(value = 2) { return value; };
const unnamed = function(value = 2) { return value; };
consume(() => callbackOne(), () => callbackTwo());
const left = { same(x) { leftOnly(x); } };
const right = { same(y, z) { rightOnly(y, z); } };
const Expression = class Named { work(input) { expressionOnly(input); } };`;
const phases = `function outer(value = seed(), {x = deep()} = fallback()) {
  class Child extends baseFactory() {
    [key()](arg = methodSeed()) { bodyOnly(arg); }
    field = instanceInit();
    static field = staticInit();
    static { staticBlock(); }
  }
  return { [objectKey()](arg = objectSeed()) { objectBody(arg); } };
}`;
const returnShapes = `function* empty() {}
function* bareGenerator() { return; }
function* valueGenerator() { return 1; }
function* yielding() { yield 1; }
async function* asyncItems() { yield 1; }
function stop() { return; }
async function asyncStop() { return; }
function explicitUndefined() { return undefined; }
const literal = () => 42;
const invoked = () => compute();
const object = () => ({});
const block = () => { 42; };
function host() { function* nested() { yield 1; } return; }`;

for (const parser of ['babel', 'acorn']) {
  const collision = await prepare(collisions, parser);
  const same = collision.values.filter(value => value.chunk.name === 'Box.same');
  assert.equal(same.length, 2);
  const instance = same.find(value => !value.docmeta.modifiers.static), statik = same.find(value => value.docmeta.modifiers.static);
  assert.deepEqual(instance.docmeta.params, ['value']); assert.deepEqual(statik.docmeta.params, ['other', 'extra']);
  assert.equal(instance.docmeta.returnsValue, true); assert.equal(statik.docmeta.returnsValue, false);
  assert.deepEqual(instance.docmeta.throws, []); assert.deepEqual(statik.docmeta.throws, ['Error']);
  assert.deepEqual(instance.projected.calls.map(([, callee]) => callee), ['instanceOnly']);
  assert.deepEqual(statik.projected.calls.map(([, callee]) => callee), ['staticOnly']);
  assert.notEqual(instance.docmeta.javascriptDeclaration.occurrenceId, statik.docmeta.javascriptDeclaration.occurrenceId);
  assert.equal(collision.relations.functionMeta['Box.same'], undefined, 'ambiguous aliases cannot merge declaration facts');
  const getter = collision.values.find(value => value.docmeta.methodKind === 'get'), setter = collision.values.find(value => value.docmeta.methodKind === 'set');
  assert.deepEqual(getter.docmeta.params, []); assert.deepEqual(setter.docmeta.params, ['value']);
  assert.deepEqual(getter.projected.calls.map(([, callee]) => callee), ['readGet']);
  assert.deepEqual(setter.projected.calls.map(([, callee]) => callee), ['writeSet']);
  const outer = collision.values.find(value => value.chunk.name === 'same' && value.projected.callDetails?.some(detail => detail.callee === 'outerOnly'));
  assert.deepEqual(outer.docmeta.throws, []); assert.equal(outer.docmeta.returnsValue, true);
  assert.deepEqual(outer.projected.calls.map(([, callee]) => callee), ['outerOnly']);
  const named = collision.values.find(value => value.chunk.name === 'exposed'), unnamed = collision.values.find(value => value.chunk.name === 'unnamed');
  assert.deepEqual(named.docmeta.params, unnamed.docmeta.params);
  assert.deepEqual(named.docmeta.paramDefaults, unnamed.docmeta.paramDefaults);
  assert.equal(named.docmeta.javascriptDeclaration.internalName, 'internal');
  assert.equal(unnamed.docmeta.javascriptDeclaration.internalName, null);
  const byCall = callee => collision.relations.jsDeclarations.records[collision.relations.callDetails.find(detail => detail.callee === callee).callerOccurrenceId];
  assert.notEqual(byCall('callbackOne').id, byCall('callbackTwo').id);
  assert.notEqual(byCall('leftOnly').id, byCall('rightOnly').id);
  assert.deepEqual(byCall('leftOnly').metadata.params, ['x']); assert.deepEqual(byCall('rightOnly').metadata.params, ['y', 'z']);
  assert.equal(byCall('privateOnly').metadata.modifiers.visibility, 'private');
  assert.equal(byCall('dynamicOnly').metadata.memberBinding.computed, true);
  assert.equal(collision.relations.jsDeclarations.records[byCall('expressionOnly').parentId].kind, 'class');
  const projectedOccurrences = collision.values.flatMap(value => value.projected.callDetails || []);
  assert.deepEqual(projectedOccurrences.map(value => [value.callerOccurrenceId, value.start, value.end]).sort(),
    collision.relations.callDetails.map(value => [value.callerOccurrenceId, value.start, value.end]).sort(), 'every original call survives under exactly one source owner');
  assert.equal(retainModuleCallChunks({ chunks: collision.chunks, callIndex: collision.index, jsDeclarations: collision.relations.jsDeclarations, languageId: 'javascript', textLength: collisions.length }), collision.chunks);
  const rows = createCallSites({ chunks: same.map(value => value.payload) });
  const rowCheck = validateArtifact('call_sites', rows); assert.equal(rowCheck.ok, true, rowCheck.errors.join('; '));
  assert.ok(rows.every(row => row.extensions.javascriptEvaluation.occurrenceId === (row.calleeNormalized === 'instanceOnly'
    ? instance.docmeta.javascriptDeclaration.occurrenceId : statik.docmeta.javascriptDeclaration.occurrenceId)));
  const capped = { ...collision.relations, calls: [] };
  assert.deepEqual(buildChunkRelations({ lang, chunk: instance.chunk, fileRelations: capped, callIndex: collision.index }).calls, [],
    'a stale pre-cap index cannot reconstruct discarded pair evidence');
  const changed = collisions.replace('innerOnly(other)', 'renamedInner(other)');
  const independent = await prepare(changed, parser);
  assert.deepEqual(independent.values.find(value => value.chunk.start === outer.chunk.start && value.chunk.end === outer.chunk.end).docmeta.dataflow, outer.docmeta.dataflow);
  assert.throws(() => resolveJavaScriptDeclaration(changed, instance.chunk, collision.relations.jsDeclarations), { code: 'ERR_JS_DECLARATION_OCCURRENCE' });

  const phase = await prepare(phases, parser), details = phase.relations.callDetails;
  const outerId = phase.values.find(value => value.chunk.name === 'outer').docmeta.javascriptDeclaration.occurrenceId;
  for (const callee of ['seed', 'deep', 'fallback']) {
    const detail = details.find(value => value.callee === callee);
    assert.equal(detail.callerOccurrenceId, outerId); assert.equal(detail.evaluationPhase, 'parameter-initialization'); assert.equal(detail.conditional, true);
  }
  for (const callee of ['baseFactory', 'key', 'objectKey']) {
    const detail = details.find(value => value.callee === callee);
    assert.equal(detail.callerOccurrenceId, outerId); assert.equal(detail.evaluationPhase, 'definition-evaluation');
  }
  const methodBody = details.find(value => value.callee === 'bodyOnly'), methodSeed = details.find(value => value.callee === 'methodSeed');
  assert.notEqual(methodBody.callerOccurrenceId, outerId); assert.equal(methodSeed.callerOccurrenceId, methodBody.callerOccurrenceId);
  assert.equal(methodSeed.evaluationPhase, 'parameter-initialization'); assert.equal(methodBody.evaluationPhase, 'invocation-body');
  for (const [callee, expected] of [['instanceInit', 'class-instance-initialization'], ['staticInit', 'class-static-initialization'], ['staticBlock', 'class-static-initialization']]) {
    const detail = details.find(value => value.callee === callee);
    assert.notEqual(detail.callerOccurrenceId, outerId); assert.equal(detail.evaluationPhase, expected);
  }
  for (const detail of details) assert.ok(phases.slice(detail.start, detail.end).startsWith(detail.callee), 'exact source call occurrence survives phase projection');

  const returns = await prepare(returnShapes, parser), docs = Object.fromEntries(returns.values.map(value => [value.chunk.name, value.docmeta]));
  for (const name of ['empty', 'bareGenerator', 'valueGenerator', 'yielding', 'asyncItems']) assert.equal(docs[name].modifiers.generator, true);
  assert.equal(docs.bareGenerator.returnsValue, false); assert.equal(docs.bareGenerator.controlFlow.returns, 1);
  for (const name of ['stop', 'asyncStop', 'block', 'host']) assert.equal(docs[name].returnsValue, false);
  for (const name of ['valueGenerator', 'explicitUndefined', 'literal', 'invoked', 'object']) assert.equal(docs[name].returnsValue, true);
  for (const name of ['literal', 'invoked', 'object']) { assert.equal(docs[name].controlFlow.returns, 0); assert.equal(docs[name].controlFlow.implicitReturns, 1); }
  assert.equal(docs.host.yields, false); assert.equal(docs.host.modifiers.generator, false);
  const disabledOptions = { ...returns.options, astDataflowEnabled: false, controlFlowEnabled: false };
  const disabled = lang.buildRelations({ text: returnShapes, relPath: 'fixture.js', context: returns.context, options: disabledOptions });
  const generator = returns.chunks.find(chunk => chunk.name === 'bareGenerator');
  const disabledDoc = lang.extractDocMeta({ text: returnShapes, chunk: generator, fileRelations: disabled, context: returns.context });
  assert.equal(disabledDoc.modifiers.generator, true); assert.equal(disabledDoc.returnsValue, undefined);
  assert.equal(disabledDoc.flowEvidence.fields.returnsValue.state, 'disabled');
}
const esprima = await prepare('class Box { same(x) { one(x); } static same(y, z) { two(y); } }\nconst exposed = function internal(value) { return value; };', 'esprima');
assert.equal(esprima.values.filter(value => value.chunk.name === 'Box.same').length, 2);
assert.equal(esprima.values.find(value => value.chunk.name === 'exposed').docmeta.returnsValue, true);
assert.equal(esprima.relations.functionMeta['Box.same'], undefined);
console.log('JavaScript declaration occurrences, evaluation phases and return shapes remain source-qualified through production projections.');

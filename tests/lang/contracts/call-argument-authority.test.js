import assert from 'node:assert/strict';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';
import { buildTypeScriptChunksFromBabel } from '../../../src/lang/typescript/chunks-babel.js';
import { createTypeScriptSyntaxContext } from '../../../src/lang/typescript/syntax-context.js';
import { callArgumentView, callArgumentProjectionErrors } from '../../../src/contracts/call-arguments.js';
import { runtimeParameterSlots, runtimeParameterFor } from '../../../src/contracts/callable-parameters.js';

const counts = [0, 5, 6, 16, 17, 300];
const source = counts.map(count => `function f${count}(${Array.from({ length: count }, (_, i) => `p${i}`).join(',')}) { target${count}(${Array.from({ length: count }, (_, i) => String(i)).join(',')}); }`).join('\n')
  + `\nfunction spread(items, secret) { prefix(1, ...items, secret); empty(...[], secret); one(...[1], secret); two(...[1,2], secret); holes(...[,], secret); tail(secret); }`
  + '\nfunction pattern({first}, later, ...rest) {}'
  + `\nfunction long() { wide("${'x'.repeat(120)}", 7); }`;
for (const parser of ['acorn', 'babel', 'typescript']) {
  let relations, formals;
  if (parser === 'typescript') {
    const context = createTypeScriptSyntaxContext();
    const options = { ext: '.ts', typeScriptSyntaxContext: context };
    const chunks = buildTypeScriptChunksFromBabel(source, options);
    relations = buildTypeScriptRelations(source, chunks, options);
    assert.equal(context.babelParses, 1);
    formals = Object.fromEntries(chunks.map(chunk => [chunk.name, chunk.meta.callableParameters]));
  } else {
    const ast = parseJavaScriptAst(source, { parser });
    assert.equal(getJavaScriptSyntaxIdentity(ast)?.family, parser);
    relations = buildCodeRelations(source, 'slots.js', { ast });
    formals = Object.fromEntries(Object.entries(relations.functionMeta).map(([name, meta]) => [name, meta.callableParameters]));
  }
  for (const count of counts) {
    const detail = relations.callDetails.find(detail => detail.callee === `target${count}`), view = callArgumentView(detail);
    assert.equal(detail.args.length, Math.min(count, 5), 'display size remains bounded');
    assert.equal(view.syntacticArgumentCount, count);
    assert.deepEqual(view.arity, { state: 'exact', min: count, max: count });
    assert.equal(view.slots.length, Math.min(count, 32));
    assert.equal(view.omittedSlots, Math.max(0, count - 32));
    assert.deepEqual(callArgumentProjectionErrors(view), []);
    assert.equal(formals[`f${count}`].formalSlotCount, count);
    assert.equal(formals[`f${count}`].omittedSlots, Math.max(0, count - 256));
    if (count === 17) assert.equal(runtimeParameterFor(runtimeParameterSlots({ callableParameters: formals.f17 }), 16).name, 'p16');
  }
  const named = name => callArgumentView(relations.callDetails.find(detail => detail.callee === name));
  assert.deepEqual(named('prefix').slots.map(slot => slot.runtimeOrdinal), [0, null, null]);
  assert.equal(named('prefix').arity.min, 2); assert.equal(named('prefix').arity.max, null);
  for (const [name, ordinal] of [['empty', 0], ['one', 1], ['two', 2], ['holes', 1]]) {
    assert.equal(named(name).slots.at(-1).runtimeOrdinal, ordinal);
    assert.equal(named(name).slots.at(-1).preview, 'secret');
    assert.equal(named(name).arity.min, ordinal + 1);
  }
  assert.equal(named('holes').slots[0].literalType, 'undefined');
  assert.equal(named('wide').slots[0].previewTruncated, true);
  assert.equal(named('wide').slots[1].runtimeOrdinal, 1);
  assert.equal(named('wide').slotCoverage, 'partial');
  const parameters = runtimeParameterSlots({ callableParameters: formals.pattern });
  assert.equal(runtimeParameterFor(parameters, 0).binding, 'object-pattern');
  assert.equal(runtimeParameterFor(parameters, 1).name, 'later');
  assert.equal(runtimeParameterFor(parameters, 8).name, 'rest');
  assert.equal(callArgumentView({ args: [] }).arity.state, 'unavailable');
}
console.log('actual JS/TS argument counts, bounded slots, spread frontiers and formal roles remain independent of previews');

import assert from 'node:assert/strict';
import { buildTypeScriptChunksFromAst } from '../../../src/lang/typescript/chunks-ast.js';
import { buildTypeScriptChunksFromBabel } from '../../../src/lang/typescript/chunks-babel.js';
import { extractTypeScriptDocMeta } from '../../../src/lang/typescript/doc.js';
import { createTypeScriptSyntaxContext } from '../../../src/lang/typescript/syntax-context.js';
import { CALLABLE_PARAMETERS_SCHEMA, CALLABLE_PARAMETERS_VERSION } from '../../../src/contracts/callable-parameters.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';

const validate = compileSchema(createAjv({ strict: true, allowUnionTypes: true }), CALLABLE_PARAMETERS_SCHEMA);
const source = `
declare function parse(
  value: string
): string;
declare function first(value: number): { ok: boolean }; declare function second(): () => string;
declare function overload(value: number): number;
declare function overload(value: string): string;
function apply(callback: () => string) {}
function optional(callback?: () => void) {}
function defaulted(callback: () => void = () => {}) {}
function receiver(this: void, value: number) {}
function patterns({ value }: { value: string }, [first]: [number]) {}
function safe(__proto__: string) {}
function factory(): () => { ok: boolean } { return () => ({ ok: true }); }
class Example {
  constructor(public value: number) {}
  @tag(extra)
  method(value: number): string { return String(value); }
  @tag(extra)
  empty() {}
}
interface Spec { method(value: number): { ok: boolean }; empty(): void; }
`;
for (const [parser, build] of [['typescript-compiler', buildTypeScriptChunksFromAst], ['typescript-babel', buildTypeScriptChunksFromBabel]]) {
  const typeScriptSyntaxContext = createTypeScriptSyntaxContext();
  const options = { ext: '.ts', typeScriptSyntaxContext };
  const chunks = build(source, options);
  assert.ok(chunks?.length, parser);
  const callable = chunks.filter(chunk => chunk.meta.callableParameters);
  assert.ok(callable.length >= 14, `${parser}: actual callable declarations`);
  for (const chunk of callable) {
    const contract = chunk.meta.callableParameters;
    assert.equal(contract.schemaVersion, CALLABLE_PARAMETERS_VERSION);
    assert.equal(contract.parser, parser);
    assert.equal(validate(contract), true, JSON.stringify(validate.errors));
    assert.equal(contract.state, 'complete', chunk.name);
    assert.deepEqual(contract.declarationRange, { start: chunk.start, end: chunk.end });
    for (const slot of contract.slots) if (slot.type.presence === 'present') {
      assert.equal(source.slice(slot.type.range.start, slot.type.range.end), slot.type.text);
    }
  }
  const byName = name => chunks.find(chunk => chunk.name === name);
  assert.deepEqual(byName('apply').meta.params, ['callback']);
  assert.equal(byName('apply').meta.paramTypes.callback, '() => string');
  assert.deepEqual(byName('apply').meta.callableParameters.arity, { state: 'complete', min: 1, max: 1, variadic: false });
  assert.equal(byName('optional').meta.callableParameters.arity.min, 0);
  assert.equal(byName('defaulted').meta.callableParameters.slots[0].defaulted, true);
  assert.equal(byName('receiver').meta.callableParameters.formalSlotCount, 2);
  assert.equal(byName('receiver').meta.callableParameters.runtimeSlotCount, 1);
  assert.equal(byName('receiver').meta.callableParameters.slots[0].role, 'receiver');
  assert.deepEqual(byName('receiver').meta.params, ['value']);
  assert.deepEqual(byName('patterns').meta.callableParameters.slots.map(slot => slot.binding), ['object-pattern', 'array-pattern']);
  assert.deepEqual(byName('patterns').meta.params, [], 'patterns are slots, not invented flattened identifiers');
  assert.equal(Object.getOwnPropertyDescriptor(byName('safe').meta.paramTypes, '__proto__').value, 'string');
  assert.equal(byName('factory').meta.returns, '() => { ok: boolean }');
  assert.equal(byName('parse').meta.signature, 'declare function parse( value: string ): string;');
  assert.ok(!byName('first').meta.signature.includes('second'));
  assert.equal(byName('first').meta.returns, '{ ok: boolean }');
  assert.equal(byName('second').meta.returns, '() => string');
  assert.deepEqual(byName('Example.method').meta.params, ['value']);
  assert.deepEqual(byName('Example.empty').meta.params, []);
  assert.equal(byName('Example.constructor').meta.callableParameters.role, 'constructor');
  assert.equal(byName('Spec.method').meta.returns, '{ ok: boolean }');
  const empty = extractTypeScriptDocMeta(byName('Example.empty'));
  assert.deepEqual(empty.params, []); assert.deepEqual(Object.keys(empty.paramTypes), []); assert.equal(empty.returns, null);
  assert.equal(empty.callableParameters.returnAnnotation.presence, 'absent');
  const before = { ...typeScriptSyntaxContext };
  for (const chunk of callable) extractTypeScriptDocMeta(chunk);
  assert.deepEqual(typeScriptSyntaxContext, before, 'doc extraction cannot reparse known-empty or absent annotation facts');
  const renamed = build(source.replaceAll('tag(extra)', 'tag(otherFactoryArgument)').replace('function second', 'function renamedNeighbor'), { ext: '.ts' });
  assert.deepEqual(renamed.find(chunk => chunk.name === 'Example.method').meta.params, ['value']);
  assert.equal(renamed.find(chunk => chunk.name === 'first').meta.signature, byName('first').meta.signature);
  const overloads = chunks.filter(chunk => chunk.name === 'overload');
  assert.equal(overloads.length, 2); assert.notEqual(overloads[0].start, overloads[1].start);
  const manySource = `function many(${Array.from({ length: 300 }, (_, index) => `p${index}: number`).join(',')}) {}`;
  const many = build(manySource, { ext: '.ts' })[0].meta.callableParameters;
  assert.equal(many.formalSlotCount, 300); assert.equal(many.runtimeSlotCount, 300);
  assert.equal(many.retainedSlots, 256); assert.equal(many.omittedSlots, 44);
  assert.equal(many.slotCoverage, 'partial'); assert.equal(many.arity.max, 300);
}
const recovered = buildTypeScriptChunksFromAst('function broken(value: { incomplete', { ext: '.ts' });
assert.equal(recovered.find(chunk => chunk.name === 'broken').meta.callableParameters.state, 'partial');
assert.equal(recovered.find(chunk => chunk.name === 'broken').meta.callableParameters.arity.state, 'unavailable');
const recoveredBabel = buildTypeScriptChunksFromBabel('"use strict"; function broken(value: number, value: number) {}', { ext: '.ts' });
assert.equal(recoveredBabel.find(chunk => chunk.name === 'broken').meta.callableParameters.state, 'partial');
assert.equal(recoveredBabel.find(chunk => chunk.name === 'broken').meta.callableParameters.arity.state, 'unavailable');
console.log('TypeScript compiler/Babel callable node authority test passed');

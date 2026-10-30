import assert from 'node:assert/strict';
import { createCompilerTransferProjection } from '../../../src/index/semantic/compiler-transfer-options.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';

for (const [argument, state, reason] of [
  ['[first]', 'supported'], ['{transfer:[first]}', 'supported'], ['{}', 'absent', 'transfer_absent'],
  ['{other:1}', 'absent', 'transfer_absent'],
  ['{transfer:[first],...{transfer:[second]}}', 'unresolved', 'options_spread'],
  ['{transfer:[first],transfer:[second]}', 'unresolved', 'duplicate_property'],
  ['{transfer:[first],...unknown}', 'unresolved', 'options_spread'],
  ['{["transfer"]:[first]}', 'unresolved', 'computed_key'],
  ['{get transfer(){throw new Error("never execute")}}', 'unresolved', 'accessor_or_method'],
  ['{transfer:unknown}', 'unresolved', 'transfer_not_literal_array'],
  ['{transfer:true}', 'unresolved', 'transfer_not_literal_array'],
  ['{transfer:[...unknown]}', 'unresolved', 'list_spread_or_hole'],
  ['{transfer:[first,,second]}', 'unresolved', 'list_spread_or_hole'],
  ['{__proto__:{transfer:[first]}}', 'unresolved', 'prototype_property'],
  [`[${Array(33).fill('first').join(',')}]`, 'unresolved', 'list_budget']
]) {
  const doc = prepareTypeScriptSyntax(`send(0,${argument});`, { ext: '.ts' }), node = doc.sourceFile.statements[0].expression.arguments[1];
  const projection = createCompilerTransferProjection(), result = projection.transfer(doc, node);
  assert.equal(result.state, state, argument); if (reason) assert.equal(result.reason, reason);
  assert.equal(projection.transfer(doc, node), result, 'one immutable source collection shares the exact projection');
  assert.equal(projection.getMetrics().transferArguments, 1);
  if (state === 'supported') {
    assert.equal(result.list.elements[0].getText(doc.sourceFile), 'first');
    assert.ok(result.witnesses.includes(result.list)); assert.equal(Object.isFrozen(result.witnesses), true);
  }
}
const doc = prepareTypeScriptSyntax('send(0,{transfer:[first]});', { ext: '.ts' });
const options = doc.sourceFile.statements[0].expression.arguments[1];
let visits = 0;
const projection = createCompilerTransferProjection({ budget: () => { visits++; return true; } });
projection.transfer(doc, options); projection.transfer(doc, options); projection.properties(doc, options);
assert.equal(visits, 2, 'the options property and list element each receive one admission, without repeated scans');
assert.deepEqual(projection.getMetrics(), { propertyObjects: 1, properties: 1, transferArguments: 1, transferElements: 1, cacheHits: 2 });
assert.equal(projection.transfer(doc, undefined).state, 'absent');
assert.equal(createCompilerTransferProjection({ budget: () => false }).transfer(doc, options).reason, 'work_budget');
console.log('Transfer projection distinguishes exact list/absence/unresolved shapes and shares bounded source-owned scans.');

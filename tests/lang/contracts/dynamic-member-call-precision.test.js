import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';

// Mirrors tasks[message.name](...) in the real indexing process dispatcher.
const source = 'export function dispatch(tasks, message) { tasks[message.name](message.payload); tasks[message.name].run(); tasks["known"](); tasks?.known?.(); }';
for (const relations of [buildCodeRelations(source, 'dispatch.js'), buildTypeScriptRelations(source, 'dispatch.ts', { typescript: { parser: 'babel' } })]) {
  const calls = relations.calls.map((entry) => entry[1]);
  assert.ok(calls.includes('tasks.known'), JSON.stringify(relations.calls));
  assert.ok(!calls.includes('tasks'), 'dynamic dispatch cannot fabricate a call to the task table');
  assert.ok(!calls.includes('run'), 'unknown receiver cannot fabricate a global run call');
}
console.log('JS/TS dynamic member dispatch retains known calls without invented targets');
assert.doesNotThrow(() => buildCodeRelations('const duplicate = 1; const duplicate = 2; duplicate();', 'broken.js'));

const constantSource = `
function target() {}
const alias = target;
const second = alias;
const key = 'kn' + 'own';
const keyAlias = key;
function dispatch(tasks, dynamic) {
  tasks[keyAlias]();
  tasks?.[key]?.();
  second();
  { const key = dynamic; tasks[key](); }
  let mutable = 'unsafe'; mutable = dynamic; tasks[mutable]();
  tasks[later](); const later = 'late';
  const propertyAlias = tasks.unknown; propertyAlias();
}
function shadowed(target) { second(); }
`;
for (const relations of [buildCodeRelations(constantSource, 'constants.js'), buildTypeScriptRelations(constantSource, null, { typescript: { parser: 'babel' } })]) {
  const calls = relations.calls.map((entry) => entry[1]);
  assert.equal(calls.filter((name) => name === 'tasks.known').length, 2);
  assert.ok(calls.includes('target'), 'immutable function aliases resolve to their declaration');
  assert.equal(calls.filter((name) => name === 'second').length, 1, 'shadowed target names retain the alias instead of inventing a binding');
  assert.ok(!calls.includes('tasks.unsafe'));
  assert.ok(!calls.includes('tasks.late'), 'references before initialization stay unknown');
  assert.ok(!calls.includes('tasks.unknown'), 'property reads are not immutable function bindings');
}

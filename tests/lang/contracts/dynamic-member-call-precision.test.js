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

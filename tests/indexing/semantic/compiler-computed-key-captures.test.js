import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Inspect actual retained value/capture edges; source functions,
// computed expressions, class definitions and methods are never executed.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-computed-key-captures-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'captures.ts': `export {};
    const topKey = 'top'; const arrowKey = 'arrow';
    function factory() {
      const localKey = 'local', defaultValue = 1, bodyValue = 2, nestedValue = 3;
      const object = {
        [localKey](arg = defaultValue) { return bodyValue; },
        get [localKey + 'Getter']() { return bodyValue; },
        set [localKey + 'Setter'](value: number) { void bodyValue; },
        [topKey]() { return 0; },
        [(() => arrowKey)()]() { return 0; }
      };
      class Local { [localKey + 'Class'](arg = defaultValue) { return bodyValue; } }
      function nested() { return nestedValue; }
      return { object, Local, nested };
    }
  ` });
  const doc = fixture.documents[0], { ts, nodes, sourceFile, expressionFor } = doc;
  const slice = await collectCompilerValueSlice({ ...doc, source: doc.item.source, root: fixture.stagingRoot,
    context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary, diskAccount: fixture.state.semanticDiskAccount });
  const partitions = [...fixture.syntaxPartitions, slice.partition], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const values = [], edges = [], key = ref => ref.partitionId + ':' + ref.localId;
  for await (const row of store.iterateRows(slice.partition.partitionId, 'semantic_records')) values.push(row);
  for await (const row of store.iterateRows(slice.partition.partitionId, 'semantic_edges')) edges.push(row);
  const valueFor = name => {
    const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === name);
    assert.ok(declaration);
    const value = values.find(row => row.kind === 'value' && row.data.origin === 'definition'
      && row.span?.[0] === declaration.name.getStart(sourceFile) && row.span?.[1] === declaration.name.end);
    assert.ok(value, name + ' uses the actual retained immutable definition');
    return { partitionId: slice.partition.partitionId, localId: value.id };
  };
  const captures = name => edges.filter(edge => edge.kind === 'captures' && key(edge.from) === key(valueFor(name)))
    .map(edge => key(edge.to)).sort();
  const callable = name => nodes.find(node => ts.isFunctionLike(node) && node.name?.getText(sourceFile) === name);
  const factory = sourceFile.statements.find(node => node.name?.text === 'factory');
  const objectMethod = callable('[localKey]'), getter = callable("[localKey + 'Getter']"),
    setter = callable("[localKey + 'Setter']"), classMethod = callable("[localKey + 'Class']");
  for (const owner of [objectMethod, getter, setter, classMethod]) assert.ok(owner);
  assert.deepEqual(captures('localKey'), [], 'creation-time names do not capture their surrounding local into methods');
  assert.ok(edges.some(edge => edge.kind === 'reads' && key(edge.from) === key(valueFor('localKey'))),
    'correcting capture ownership preserves actual computed-name reads');
  assert.deepEqual(captures('topKey'), [key(expressionFor(factory))],
    'an external constant read during key evaluation belongs to the surrounding function');
  assert.deepEqual(captures('defaultValue'), [objectMethod, classMethod].map(expressionFor).map(key).sort(),
    'parameter default reads still belong to their invoked method');
  assert.deepEqual(captures('bodyValue'), [objectMethod, getter, setter, classMethod].map(expressionFor).map(key).sort(),
    'memoized computed-name ownership cannot replace body ownership');
  const arrow = nodes.find(ts.isArrowFunction);
  assert.deepEqual(captures('arrowKey'), [key(expressionFor(arrow))],
    'a function nested inside a computed expression remains a distinct closure');
  assert.deepEqual(captures('nestedValue'), [key(expressionFor(callable('nested')))],
    'ordinary nested function capture is unchanged');
  console.log('computed member keys retain creation-time ownership without erasing invoked method captures');
} finally { await fs.rm(root, { recursive: true, force: true }); }

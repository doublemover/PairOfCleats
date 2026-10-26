import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';

const mergeUrl = new URL('../../../src/index/semantic/merge-provider.js', import.meta.url).href;
const storeUrl = new URL('../../../src/semantic/artifact-store.js', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === mergeUrl + '?batch-work' && specifier === '../../semantic/artifact-store.js') return { url: 'semantic-provider:observed-store', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'semantic-provider:observed-store') return { format: 'module', shortCircuit: true, source: `
      import {createArtifactSemanticStore as create} from ${JSON.stringify(storeUrl)};
      export const createArtifactSemanticStore=options=>{
        const store=create(options),probe=globalThis.providerMergeProbe;probe.stores++;probe.referenceDescriptors+=options.partitions.length;
        return {...store,iterateRows:async function*(...args){probe.memberTraversals++;probe.active++;
          try{for await(const row of store.iterateRows(...args)){probe.decoded++;if(probe.once){const callback=probe.once;probe.once=null;await callback();}yield row;}}
          finally{probe.active--;}}};};` };
    return next(url, context);
  }
});
const fixture = await createRecoveryFixture('const value = 1;');
try {
  const { mergeSemanticProviderOutput } = await import(mergeUrl + '?batch-work');
  const runtime = { root: fixture.root, buildRoot: fixture.root }, contextKey = 'c'.repeat(64);
  const build = async groupCount => {
    const entries = [];
    for (let index = 0; index < 8; index++) {
      const file = `source-${groupCount}-${index}.js`, root = path.join(fixture.stagingRoot, `g${groupCount}-${index % groupCount}`);
      await fs.writeFile(path.join(fixture.root, file), fixture.bytes);
      const source = createSemanticSourceSnapshot({ bytes: fixture.bytes, repositoryNamespace: fixture.root, path: file, language: 'javascript' }).manifest;
      const syntaxId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId, parser: { family: 'fixture', version: '1', options: {} },
        extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
      const syntax = await fixture.write([semanticNode(0, source.textLength)], { stagingRoot: root, source, partitionId: syntaxId });
      const id = 'sa1:' + (groupCount * 100 + index).toString(16).padStart(64, '0');
      const evidence = { family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
        data: { method: 'fixture/binding', producerId: 'fixture', producerVersion: '1', evidenceKind: 'source-bound',
          sourceRef: source.sourceUnitId, artifactRef: null } } };
      const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'bindings', state: 'partial',
        reason: `source-${index}`, observedCount: 1, completedCount: 1, frontierRef: null };
      const partition = await fixture.write([evidence, { family: 'coverage', row: coverage }], {
        stagingRoot: root, source, partitionId: id, contextHash: contextKey });
      const current = createSemanticFactsRef({ source, syntaxPartitionId: syntaxId, partitions: [syntax],
        storage: { relativePath: path.relative(fixture.root, root).replaceAll('\\', '/'), generation: fixture.generation }, coverage: [] });
      entries.push({ file, root, source, syntax, partition, current, coverage, evidence });
    }
    return entries;
  };
  const prepare = entries => {
    const state = { semanticFactsByFile: new Map(entries.map(entry => [entry.file, structuredClone(entry.current)])), semanticCompilerContexts: [] };
    const context = { contextKey, sourceUnits: entries.map(entry => ({ sourceUnitId: entry.source.sourceUnitId, byteHash: entry.source.byteHash })),
      providerId: 'fixture', providerVersion: '1', compilerVersion: null, configHash: 'd'.repeat(64), moduleResolutionHash: 'e'.repeat(64), vfsMappingHash: 'f'.repeat(64) };
    return { state, output: { schemaVersion: 1, contexts: [context], partitions: entries.map(entry => structuredClone(entry.partition)), coverageRef: null, diagnosticsRef: null } };
  };
  const observe = once => globalThis.providerMergeProbe = { stores: 0, referenceDescriptors: 0, memberTraversals: 0, decoded: 0, active: 0, once };
  const unchanged = (state, before, contexts) => {
    assert.deepEqual([...state.semanticFactsByFile.keys()], [...before.keys()]);
    for (const [file, original] of before) assert.equal(state.semanticFactsByFile.get(file), original);
    assert.equal(state.semanticCompilerContexts, contexts);
  };
  const shared = await build(1), separate = await build(2);
  for (const entries of [shared.slice(0, 2), shared.slice(0, 4), shared, separate]) {
    const { state, output } = prepare(entries), probe = observe();
    const result = await mergeSemanticProviderOutput({ output, state, runtime });
    const groups = new Set(entries.map(entry => entry.root)).size;
    assert.deepEqual(result, { accepted: entries.length, persisted: entries.length, unchanged: 0 });
    assert.equal(result.work.rootDerivations, entries.length); assert.equal(result.work.generationKeys, entries.length);
    assert.equal(result.work.groupPreparations, groups); assert.equal(result.work.inventoryPreparations, groups);
    assert.equal(result.work.contextSourceVisits, entries.length); assert.ok(result.work.descriptorVisits <= entries.length * 5 + groups + 2);
    assert.equal(probe.stores, groups); assert.equal(probe.referenceDescriptors, entries.length * 2);
    assert.equal(probe.decoded, entries.length * 3, 'source, evidence and coverage rows decode once, without the old second traversal');
    assert.equal(result.work.memberRowsValidated, probe.decoded); assert.equal(probe.active, 0);
    for (const entry of entries) assert.deepEqual(state.semanticFactsByFile.get(entry.file), createSemanticFactsRef({ source: entry.source,
      syntaxPartitionId: entry.syntax.partitionId, storage: entry.current.storage, partitions: [entry.syntax, entry.partition], coverage: [entry.coverage] }));
    observe(); const again = await mergeSemanticProviderOutput({ output, state, runtime });
    assert.deepEqual(again, { accepted: entries.length, persisted: 0, unchanged: entries.length });
    assert.equal(again.work.groupPreparations, 0); assert.equal(globalThis.providerMergeProbe.decoded, 0);
  }
  for (const failure of ['last-hash', 'changed-selection', 'abort', 'context-conflict']) {
    const { state, output } = prepare(separate), before = new Map(state.semanticFactsByFile), contexts = state.semanticCompilerContexts;
    const controller = new AbortController();
    if (failure === 'last-hash') output.partitions.at(-1).canonicalHash = '0'.repeat(64);
    if (failure === 'context-conflict') output.contexts.push({ ...output.contexts[0], providerVersion: 'other' });
    const probe = observe(failure === 'changed-selection' ? () => { before.values().next().value.sourceHash = '0'.repeat(64); }
      : failure === 'abort' ? () => controller.abort() : null);
    await assert.rejects(mergeSemanticProviderOutput({ output, state, runtime, signal: controller.signal }));
    unchanged(state, before, contexts); assert.equal(probe.active, 0);
  }
  const captured = prepare(shared), originalLast = structuredClone(captured.output.partitions.at(-1));
  observe(() => { captured.output.partitions.at(-1).canonicalHash = '0'.repeat(64); });
  await mergeSemanticProviderOutput({ ...captured, runtime });
  assert.equal(captured.state.semanticFactsByFile.get(shared.at(-1).file).partitions.at(-1).canonicalHash, originalLast.canonicalHash,
    'caller output mutation after capture cannot redefine the admitted immutable batch');

  for (const kind of ['forbidden-syntax', 'cross-group-reference', 'namespace']) {
    const { state, output } = prepare(separate), before = new Map(state.semanticFactsByFile), contexts = state.semanticCompilerContexts;
    const last = separate.at(-1), id = 'sa1:' + ({ 'forbidden-syntax': '4', 'cross-group-reference': '5', namespace: '6' })[kind].repeat(64);
    const rows = kind === 'forbidden-syntax' ? [semanticNode(0, last.source.textLength)] : [last.evidence];
    if (kind === 'cross-group-reference') rows.push({ family: 'edge', row: { id: 0, kind: 'resolvesTo',
      from: { partitionId: id, localId: 0 }, to: { partitionId: separate[0].syntax.partitionId, localId: 0 },
      callSite: null, operandOrdinal: null, contextKey, condition: null, evidence: { partitionId: id, localId: 0 }, certainty: 'exact-static' } });
    // Namespace inconsistency is rejected either by persisted source validation
    // or the provider observer; neither can select an earlier successful group.
    if (kind === 'namespace') { state.semanticFactsByFile.get(last.file).repositoryNamespace = 'foreign'; }
    const partition = await fixture.write(rows, { source: last.source, partitionId: id, stagingRoot: last.root, contextHash: contextKey });
    output.partitions[output.partitions.length - 1] = partition; observe();
    await assert.rejects(mergeSemanticProviderOutput({ output, state, runtime }));
    unchanged(state, before, contexts); assert.equal(globalThis.providerMergeProbe.active, 0);
  }
} finally { delete globalThis.providerMergeProbe; hooks.deregister(); await fixture.cleanup(); }
console.log('Provider batches prepare each root/generation/namespace inventory once and validate rows once before all-or-nothing selection.');

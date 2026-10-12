import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { writeBindingFixtureFamily } from '../../helpers/semantic-binding-work.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { runNativeSemanticProviders } from '../../../src/index/semantic/native-provider-pass.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { buildSemanticContextSection } from '../../../src/context-pack/semantic.js';

const programs = [
  ['python', 'py', 'def helper(x):\n    return x\n', 'def run(x):\n    return helper(x)\n'],
  ['c', 'c', 'int helper(int x) { return x; }', 'int run(int x) { return helper(x); }'],
  ['swift', 'swift', 'func helper(_ x: Int) -> Int { return x }', 'func run(_ x: Int) -> Int { return helper(x) }'],
  ['rust', 'rs', 'fn helper(x: i32) -> i32 { return x; }', 'fn run(x: i32) -> i32 { return helper(x); }']
];
for (const [language, ext, library, main] of programs) {
  const fixture = await createRecoveryFixture();
  try {
    const policy = normalizeSemanticConfig({ enabled: true, languages: [language], enrichment: { bindings: 'eager', localFlow: 'eager' } });
    const state = { chunks: [], semanticFactsByFile: new Map(), semanticDiskAccount: fixture.account };
    let scheduled = 0;
    const runtime = { root: fixture.root, buildRoot: fixture.root, semanticPolicy: policy,
      scheduler: { schedule: async (lane, resources, fn) => { assert.equal(lane, 'relations'); assert.ok(resources.bytes > 0); scheduled++; return fn(); } } };
    for (const [file, text] of [['library.' + ext, library], ['main.' + ext, main]]) {
      const bytes = Buffer.from(text), stagingRoot = path.join(fixture.root, 'index-code', 'semantic');
      await fs.writeFile(path.join(fixture.root, file), bytes);
      const facts = await collectFileSemanticFacts({ bytes, text, language, relPath: file, repositoryNamespace: fixture.root,
        stagingRoot, diskAccount: fixture.account, policy });
      const chunks = [{ chunkUid: file, file, start: 0, end: text.length }];
      const descriptor = await collectSemanticOwnership({ facts, chunks, bytes, repositoryNamespace: fixture.root, stagingRoot,
        storage: { generation: fixture.generation, relativePath: 'index-code/semantic' }, diskAccount: fixture.account, policy });
      state.semanticFactsByFile.set(file, descriptor); state.chunks.push(...chunks);
    }
    let requests = 0;
    const runPass = async ({ semanticLspSession: session, toolingDocuments, semanticSession, applyTypes }) => {
      assert.equal(semanticSession, undefined, 'native bindings have no TypeScript Program'); assert.equal(applyTypes, false);
      assert.equal(toolingDocuments.targets.length, 0, 'native semantic admission does not enable legacy type targets');
      for (const doc of toolingDocuments.documents) {
        assert.equal(doc.languageId, language);
        const uri = pathToFileURL(path.join(fixture.root, doc.virtualPath)).href;
        const targets = await session.targetsForDocument(doc);
        await session.collectDocument({ doc, uri, targets, providerId: 'native-location-fixture', providerVersion: '1',
          requestDefinition: async ({ name }) => {
            requests++;
            if (name !== 'helper') return { attempted: true, payload: null };
            const start = library.indexOf('helper');
            const location = { uri: pathToFileURL(path.join(fixture.root, 'library.' + ext)).href,
              range: { start: { line: 0, character: start }, end: { line: 0, character: start + 6 } } };
            return { attempted: true, payload: [location, location] };
          } });
      }
    };
    assert.equal((await runNativeSemanticProviders({ state, runtime, toolingConfig: {}, log: () => {}, runPass })).ran, true);
    assert.equal(scheduled, 1); assert.ok(requests > 0);
    const { outDir } = await writeBindingFixtureFamily({ state, runtime, buildId: fixture.generation.baseBuildId });
    const { store } = await openPublishedSemanticStore({ indexDir: outDir, repoRoot: fixture.root, requireQueryIndex: true });
    const scope = { repoRoot: fixture.root, generation: fixture.generation };
    const find = createSemanticFindService(), detail = createSemanticDetailService(), trace = createSemanticTraceService();
    const calls = await find({ store, request: { ...scope, selector: { field: 'invocationKind', value: 'call' } } });
    assert.equal(calls.records.length, 1, language + ' persisted call discovery');
    const hydrated = await detail({ store, request: { ...scope, refs: [calls.records[0].ref], include: ['operands', 'names', 'ownership'] } });
    assert.ok(hydrated.operands.some(row => row.slot === 'argument')); assert.ok(hydrated.ownership.length);
    const bindings = [], edges = [];
    for (const facts of state.semanticFactsByFile.values()) for (const part of facts.partitions) {
      for await (const row of store.iterateRows(part.partitionId, 'semantic_records')) if (row.kind === 'binding') bindings.push(row);
      for await (const row of store.iterateRows(part.partitionId, 'semantic_edges')) if (row.kind === 'callTarget') edges.push(row);
    }
    assert.equal(edges.length, 1); assert.equal(edges[0].certainty, 'exact-static');
    assert.equal(bindings.filter(row => row.data.status === 'resolved').length, 1, 'duplicate exact locations remain resolved');
    const target = await find({ store, request: { ...scope, selector: { target: edges[0].to } } });
    assert.equal(target.records.length, 1); assert.deepEqual(target.records[0].ref, edges[0].from);
    const witness = await trace({ store, request: { ...scope, seed: edges[0].from, direction: 'downstream', kinds: ['callTarget'] } });
    assert.ok(witness.edges.some(row => row.kind === 'callTarget'));
    await fs.writeFile(path.join(fixture.root, 'main.' + ext), 'changed live source');
    const context = await buildSemanticContextSection({ repoRoot: fixture.root, indexDir: outDir, primary: { file: 'main.' + ext },
      find: request => find({ store, request }), detail: request => detail({ store, request }), trace: request => trace({ store, request }) });
    assert.equal(context.status, 'partial'); assert.ok(context.discovery.records.length); assert.ok(context.excerpts.length);
    assert.ok(!JSON.stringify(context.excerpts).includes('changed live source'));
    runtime.semanticPolicy = normalizeSemanticConfig({ enabled: true, languages: [language], enrichment: { bindings: 'deferred' }, execution: { deferredDrain: 'after-index' } });
    assert.equal((await runNativeSemanticProviders({ state, runtime, toolingConfig: {}, log: () => {}, runPass: () => assert.fail('native deferred work must not borrow TypeScript admission') })).ran, false);
    assert.equal(scheduled, 1);
  } finally { await fixture.cleanup(); }
}
console.log('Native source-pinned provider bindings survive publication, queries, trace and retained context');

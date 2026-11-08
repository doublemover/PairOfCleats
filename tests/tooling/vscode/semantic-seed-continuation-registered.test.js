import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

const generation = { baseBuildId: 'registered-semantic-bounds', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 1 };
const original = { generation, status: 'partial', records: [{ ref, kind: 'operation', span: [0, 6] }],
  edges: [], frontier: [{ reason: 'analysis_incomplete' }] };
const choose = value => items => items.find(item => item === value || item.value === value || item.action === value);
const record = items => items.find(item => item.record);
for (const scenario of ['seed-snapshot', 'current-source-snapshot', 'record-bound', 'edge-bound',
  'ambiguous-source', 'repeated-cursor', 'cursor-cycle', 'canonical-plan', 'head-after-seed', 'head-during-response']) {
  const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-registered-semantic-bounds-' });
  let mapping;
  const responses = [], requests = [];
  const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
    globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
    fetchImpl: async (url, options) => {
      if (url.includes('/capabilities')) return new Response(JSON.stringify({ ok: true, capabilities: {
        'semantic-find': true, 'semantic-detail': true, 'semantic-trace': true, 'semantic-enrichment': true } }));
      if (url.includes('/status')) return new Response(JSON.stringify(mapping.status));
      requests.push(JSON.parse(options.body));
      if (scenario === 'head-during-response') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
      return new Response(JSON.stringify({ ok: true, result: responses.shift() }));
    } });
  mapping = prepareServiceMappingFixture(harness, { repoRoot: root, serviceRoot: '/srv/semantic repo' });
  const node = { resultSet: { repoRoot: root, repoUri: harness.fakeVscode.Uri.file(root).toString() },
    hit: { chunkUid: 'original-hit', file: 'src/app.ts' } };
  const data = structuredClone(original);
  try {
    harness.activate(); harness.inputQueue.push(generation.baseBuildId);
    harness.quickPickQueue.push(items => {
      node.hit.chunkUid = 'mutated-hit'; node.resultSet.repoRoot = path.join(root, 'foreign');
      harness.setActiveFile(path.join(root, 'src', 'another.ts'));
      if (scenario === 'head-after-seed') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
      return choose('manual')(items);
    }, choose(scenario === 'current-source-snapshot' ? 'Current source file' : 'Selected chunk ownership'));
    if (scenario === 'record-bound') data.records = Array.from({ length: 129 }, (_, localId) => ({ ...original.records[0], ref: { ...ref, localId } }));
    if (scenario === 'edge-bound') data.edges = Array.from({ length: 513 }, () => ({}));
    if (scenario === 'ambiguous-source') {
      data.sourceRefs = [0, 1].map(index => ({ ref, sourceHash: 'a'.repeat(64), coordinateUnit: 'utf16', path: `src/${index}.ts` }));
      harness.quickPickQueue.push(record, choose('open'), choose('back'));
    } else if (scenario === 'repeated-cursor' || scenario === 'cursor-cycle') {
      data.cursor = 'cursor-a';
      if (scenario === 'repeated-cursor') {
        responses.push(data, structuredClone(data));
        harness.quickPickQueue.push(choose('more'), choose('copy'), choose('back'));
      } else {
        const second = { ...structuredClone(data), cursor: 'cursor-b', frontier: [{ reason: 'depth_budget' }] };
        responses.push(data, second, structuredClone(data));
        harness.quickPickQueue.push(choose('more'), choose('more'), choose('copy'), choose('back'), choose('copy'), choose('back'));
      }
    } else if (scenario === 'canonical-plan') {
      data.enrichment = { suggestions: [{ taskId: 'st1:' + 'b'.repeat(64) }] };
      responses.push(data, { generation, action: 'plan', status: 'planned', tasks: [], diagnostics: [], executionAuthorized: false });
      harness.quickPickQueue.push(choose('plan'), choose('copy'), choose('back'), choose('back'));
    } else harness.quickPickQueue.push(choose('back'));
    if (!responses.length) responses.push(data);
    await harness.registeredCommands.get('pairofcleats.semanticEvidence')(scenario === 'current-source-snapshot' ? null : node);
    if (scenario === 'head-after-seed' || scenario === 'head-during-response') {
      assert.equal(requests.length, scenario === 'head-after-seed' ? 0 : 1);
      assert(harness.errorMessages.some(message => /identity changed/.test(message)));
      assert.equal(harness.openedDocuments.length, 0, 'source replacement cannot publish semantic evidence for the old mapped revision');
      continue;
    }
    assert.equal(requests[0].repoRoot, '/srv/semantic repo');
    assert.deepEqual(requests[0].generation, generation);
    assert.equal(requests[0].selector.value, scenario === 'current-source-snapshot' ? 'src/app.ts' : 'original-hit', scenario);
    if (scenario === 'record-bound' || scenario === 'edge-bound') {
      assert(harness.errorMessages.some(message => /128-record\/512-edge/.test(message)));
      assert.equal(harness.openedDocuments.length, 0, 'oversized typed evidence cannot publish a native view');
    } else if (scenario === 'ambiguous-source') {
      assert(harness.errorMessages.some(message => /one unambiguous captured source mapping/.test(message)));
      assert.equal(harness.openedDocuments.some(document => document.uri?.scheme === 'file'), false);
    } else if (scenario === 'repeated-cursor' || scenario === 'cursor-cycle') {
      assert(harness.errorMessages.some(message => /repeated an earlier cursor/.test(message)));
      assert.equal(JSON.parse(harness.clipboardWrites.at(-1)).cursor, 'cursor-a', 'failed More retains the prior seed evidence');
      assert.equal(requests.at(-1).cursor, scenario === 'cursor-cycle' ? 'cursor-b' : 'cursor-a');
      if (scenario === 'cursor-cycle') assert.equal(JSON.parse(harness.clipboardWrites[0]).cursor, 'cursor-b');
    } else if (scenario === 'canonical-plan') {
      assert.equal(JSON.parse(harness.clipboardWrites[0]).action, 'plan');
      assert.equal(requests[1].action, 'plan');
      assert.equal(harness.errorMessages.length, 0, 'canonical plan responses do not require detail-only records');
    } else assert.equal(harness.errorMessages.length, 0, scenario);
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log('Registered semantic seed snapshots, typed bounds, source ambiguity and bounded More recovery authored; host acceptance separate.');

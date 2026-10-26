import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { enqueueGraphRelationsArtifacts } from '../../src/index/build/artifacts/graph-relations.js';
import { writePiecesManifest } from '../../src/index/build/artifacts/checksums.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildImpactAnalysis } from '../../src/graph/impact.js';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { prepareGraphInputs, prepareGraphIndex } from '../../src/integrations/tooling/graph-helpers.js';
import { runGraphContextCli } from '../../src/integrations/tooling/graph-context.js';
import { runImpactCli } from '../../src/integrations/tooling/impact.js';
import { validateGraphImpact } from '../../src/contracts/validators/analysis.js';
import { renderGraphImpact } from '../../src/retrieval/output/graph-impact.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';

const root = resolveTestCachePath(process.cwd(), `impact-direction-${randomUUID()}`);
const repo = path.join(root, 'repo');
const names = ['consumer', 'api', 'helper', 'isolated'];
const fileOf = name => name === 'consumer' ? 'tests/consumer.test.js' : `src/${name}.js`;
const chunk = chunkUid => ({ type: 'chunk', chunkUid });
const file = name => ({ type: 'file', path: fileOf(name) });
const link = chunkUid => ({ to: { status: 'resolved', resolved: { chunkUid } } });
const expected = rows => rows.map(([name, distance]) => [name, distance]).sort();
const observe = payload => payload.impacted.map(row => [row.ref.chunkUid || row.ref.path, row.distance]).sort();
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
try {
  await fs.mkdir(repo, { recursive: true });
  const indexDir = await createCompatibilityIndex(repo, { published: true, compatibilityKey: 'impact-production-v1' });
  const chunks = names.map((name, id) => ({ id, chunkUid: name, file: fileOf(name), name,
    kind: 'FunctionDeclaration', codeRelations: { callLinks: id < 2 ? [link(names[id + 1])] : [],
      usageLinks: id < 2 ? [link(names[id + 1])] : [], callDetails: [] } }));
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(chunks.map(row => ({ ...row, start: 0, end: 1 }))));
  const fileRelations = new Map(names.map((name, id) => [fileOf(name), { importLinks: id < 2 ? [fileOf(names[id + 1])] : [] }]));
  const original = JSON.parse(await fs.readFile(path.join(indexDir, 'pieces/manifest.json'), 'utf8'));
  const pieces = original.pieces;
  await enqueueGraphRelationsArtifacts({ chunks, fileRelations, outDir: indexDir, maxJsonBytes: 16384,
    enqueueWrite: (_label, job) => job(),
    addPieceFile: (entry, absolute) => pieces.push({ ...entry, path: path.relative(indexDir, absolute).replaceAll('\\', '/') }),
    formatArtifactLabel: value => value, removeArtifact: async () => {}, log: () => {} });
  const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
  await writePiecesManifest({ pieceEntries: pieces, outDir: indexDir, mode: 'code', indexState: state });
  const inputs = await prepareGraphInputs({ repoRoot: repo, indexDir });
  const cold = await prepareGraphIndex({ repoRoot: repo, indexDir, graphInputs: inputs, includeGraphRelations: true });
  const warm = await prepareGraphIndex({ repoRoot: repo, indexDir, graphInputs: inputs });
  assert.equal(warm.graphIndex, cold.graphIndex, 'normal prepared cache reuses the selected generation');
  const relations = cold.graphRelations;
  for (const family of ['callGraph', 'usageGraph']) {
    assert.deepEqual(relations[family].nodes.find(row => row.id === 'consumer').out, ['api']);
    assert.deepEqual(relations[family].nodes.find(row => row.id === 'helper').in, ['api']);
  }
  assert.deepEqual(relations.importGraph.nodes.find(row => row.id === fileOf('consumer')).out, [fileOf('api')]);
  const legacy = buildGraphIndex({ graphRelations: relations, indexSignature: inputs.indexSignature });
  const indexes = [cold.graphIndex, warm.graphIndex, legacy];
  for (const graphIndex of indexes) for (const family of ['callGraph', 'usageGraph', 'importGraph']) {
    const imports = family === 'importGraph', ref = imports ? file : chunk;
    const identify = name => imports ? fileOf(name) : name;
    const run = options => buildImpactAnalysis({ graphIndex, seed: ref('api'), direction: 'downstream', depth: 2,
      indexSignature: inputs.indexSignature, pathSemantics: 'graph-witness', edgeFilters: { graphs: [family] }, ...options });
    for (const [direction, seed, depth, hits] of [
      ['downstream', 'helper', 1, [['api', 1]]], ['downstream', 'helper', 2, [['api', 1], ['consumer', 2]]],
      ['upstream', 'consumer', 1, [['api', 1]]], ['upstream', 'consumer', 2, [['api', 1], ['helper', 2]]],
      ['both', 'api', 1, [['consumer', 1], ['helper', 1]]], ['downstream', 'consumer', 2, []],
      ['downstream', 'isolated', 2, []]
    ]) {
      const result = run({ direction, seed: ref(seed), depth });
      assert.deepEqual(observe(result), expected(hits.map(([name, distance]) => [identify(name), distance])));
      assert.equal(validateGraphImpact(result).ok, true);
      const traversal = direction === 'downstream' ? 'in' : direction === 'upstream' ? 'out' : 'both';
      assert.equal(result.pathCapability.selection.direction, traversal);
      assert.equal(result.stats.directionPolicy.traversal, traversal);
      assert.match(renderGraphImpact(result), new RegExp(`Direction: ${direction}\\nRecorded traversal: ${traversal}`));
      for (const hit of result.impacted) {
        assert.equal(hit.witnessPath.edges.length, hit.distance);
        const edge = hit.witnessPath.edges[0];
        const from = edge.from.chunkUid || edge.from.path, to = edge.to.chunkUid || edge.to.path;
        assert.ok([['consumer', 'api'], ['api', 'helper']].some(([a, b]) => from === identify(a) && to === identify(b)),
          'witnesses keep canonical dependency edge orientation even when traversed in reverse');
      }
    }
    const multi = run({ seed: [ref('helper'), ref('api')] });
    assert.deepEqual(observe(multi), [[identify('consumer'), 1]]);
    const noPaths = run({ seed: ref('helper'), caps: { maxPaths: 0 } });
    assert.equal(noPaths.impacted.length, 2);
    assert.ok(noPaths.impacted.every(hit => hit.partial && hit.witnessPath === null));
    assert.ok(noPaths.truncation.some(row => row.cap === 'maxPaths'));
    assert.equal(validateGraphImpact(noPaths).ok, true);
    const capped = run({ seed: ref('helper'), caps: { maxNodes: 2 } });
    assert.deepEqual(observe(capped), [[identify('api'), 1]]);
    assert.ok(capped.truncation.some(row => row.cap === 'maxNodes'));
    if (imports) {
      const changed = run({ seed: null, changed: new Set([fileOf('helper')]) });
      assert.deepEqual(observe(changed), observe(run({ seed: file('helper') })));
      const suggested = buildSuggestTestsReport({ changed: [fileOf('helper')], graphIndex, graphRelations: relations,
        tests: [fileOf('consumer')], repoRoot: repo, indexSignature: inputs.indexSignature, caps: { maxDepth: 2 } });
      assert.equal(suggested.suggestions[0].testPath, fileOf('consumer'));
      assert.equal(suggested.suggestions[0].fidelity.graphDistance, 2, 'suggest-tests retains its incoming dependency walk');
    }
  }
  const output = [], previousLog = console.log;
  console.log = value => output.push(value);
  try {
    const result = await runImpactCli(['--repo', repo, '--seed', 'chunk:helper', '--direction', 'downstream',
      '--depth', '2', '--graphs', 'callGraph', '--pathSemantics', 'graph-witness', '--json']);
    assert.equal(result.direction, 'downstream');
    const json = JSON.parse(output.at(-1));
    assert.deepEqual(observe(json), expected([['api', 1], ['consumer', 2]]));
    assert.equal(json.direction, 'downstream'); assert.equal(json.stats.directionPolicy.traversal, 'in');
    const context = await runGraphContextCli(['--repo', repo, '--seed', 'chunk:helper', '--direction', 'in',
      '--depth', '2', '--graphs', 'importGraph', '--includePaths', '--pathSemantics', 'graph-witness', '--json']);
    assert.equal(context.pathCapability.selection.direction, 'in');
    assert.equal(context.edges[0].importProjection.chunkUid, 'helper');
    assert.equal(context.edges[0].importProjection.containingFile, fileOf('helper'));
    const importImpact = await runImpactCli(['--repo', repo, '--seed', 'chunk:helper', '--direction', 'downstream',
      '--depth', '2', '--graphs', 'importGraph', '--pathSemantics', 'graph-witness', '--json']);
    assert.deepEqual(observe(importImpact), expected([[fileOf('api'), 1], [fileOf('consumer'), 2]]));

  } finally { console.log = previousLog; }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Production graph orientation, prepared CSR/legacy, cache, impact and CLI contracts passed.');

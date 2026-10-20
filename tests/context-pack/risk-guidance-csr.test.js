import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGraphIndex, createGraphStore } from '../../src/graph/store.js';
import { buildRiskGuidance } from '../../src/context-pack/assemble/guidance.js';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { prepareGraphInputs, prepareGraphIndex } from '../../src/integrations/tooling/graph-helpers.js';
import { buildRiskFlow, buildRiskCallSite, buildRiskStatsFields, buildRiskSummary, buildRiskPiecesManifestFields,
  createRiskRepoIndexFixture, writeJsonl } from '../helpers/risk-pack-eval.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createAnalysisSurfaceHarness } from '../helpers/analysis-surface-parity.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';

const { dir } = await prepareIsolatedTestCacheDir('risk-guidance-csr');
const repoPath = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(path.join(repoPath, 'tests'), { recursive: true });
applyTestEnv({ cacheRoot, embeddings: 'off' });
const tests = Array.from({ length: 4 }, (_, index) => `tests/receipt-${index}.test.js`);
try {
  const fileRelPath = 'src/risk.js', sourceText = 'export function target(input) { return query(input); }\n';
  const generatedAt = '2026-10-20T00:00:00.000Z', compatibilityKey = 'guidance-csr-v1', alias = 'csr';
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath, cacheRoot, fileRelPath,
    sourceText, generatedAt, compatibilityKey, alias });
  for (const file of tests) await fs.writeFile(path.join(repoPath, file), 'export const verification = true;\n');
  const callers = Array.from({ length: 4 }, (_, index) => `caller-${index}`);
  const graphRelations = { version: 2, generatedAt,
    callGraph: { nodeCount: 5, edgeCount: 4, nodes: [
      { id: 'chunk-risk', file: fileRelPath, name: 'target', out: [], in: callers },
      ...callers.map(id => ({ id, file: `src/${id}.js`, name: id, out: ['chunk-risk'], in: [] }))
    ] }, usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 5, edgeCount: 4, nodes: [
      { id: fileRelPath, file: fileRelPath, out: [], in: tests },
      ...tests.map(file => ({ id: file, file, out: [fileRelPath], in: [] }))
    ] } };
  const derived = buildGraphIndex({ graphRelations, repoRoot: repoPath, includeCsr: true }).graphRelationsCsr;
  const csr = { version: 2, generatedAt, graphs: Object.fromEntries(['callGraph', 'usageGraph', 'importGraph'].map(name => {
    const graph = derived[name];
    return [name, { nodeCount: graph.ids.length, edgeCount: graph.edges.length, nodes: graph.ids,
      offsets: Array.from(graph.offsets), edges: Array.from(graph.edges) }];
  })) };
  const flow = buildRiskFlow({ alias, flowId: `sha1:${'1'.repeat(40)}` });
  await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'),
    buildRiskStatsFields({ generatedAt, flowsEmitted: 1, uniqueCallSitesReferenced: 1, maxCallSitesPerEdge: 1 }));
  await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [buildRiskSummary({ fileRelPath,
    languageId: 'javascript', symbolName: 'target', symbolKind: 'FunctionDeclaration', signature: 'target(input)' })]);
  await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), [flow]);
  await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), [buildRiskCallSite({ callSiteId: `cs-${alias}`,
    fileRelPath, languageId: 'javascript', queryOffset: sourceText.indexOf('query(input)'), queryExcerpt: 'query(input)' })]);
  await fs.writeFile(path.join(finalIndexDir, 'graph_relations.json'), JSON.stringify(graphRelations));
  await fs.writeFile(path.join(finalIndexDir, 'graph_relations.csr.json'), JSON.stringify(csr));
  const manifest = buildRiskPiecesManifestFields({ compatibilityKey, generatedAt, stage: 'guidance-csr' });
  manifest.fields.pieces.push({ name: 'graph_relations', path: 'graph_relations.json', format: 'json' },
    { name: 'graph_relations_csr', path: 'graph_relations.csr.json', format: 'json' });
  await writeJsonObjectFile(path.join(finalIndexDir, 'pieces/manifest.json'), manifest);
  const inputs = await prepareGraphInputs({ repoRoot: repoPath, indexDir: finalIndexDir, includeChunkMeta: true });
  const prepared = await prepareGraphIndex({ repoRoot: repoPath, indexDir: finalIndexDir, graphInputs: inputs,
    selection: ['callGraph', 'importGraph'] });
  assert.equal(prepared.includeCsr, true);
  assert.equal(prepared.graphStore.stats().lastBuild.csrSource, 'artifact', 'normal preparation must consume persisted CSR');
  assert.ok(prepared.graphIndex.callGraphIndex.get('chunk-risk').in === undefined, 'do not restore a duplicate adjacency in metadata');
  const store = createGraphStore({ indexDir: finalIndexDir, strict: true });
  const legacy = await store.loadGraphIndex({ repoRoot: repoPath, includeCsr: false, graphs: ['callGraph', 'importGraph'] });
  const guide = graphIndex => buildRiskGuidance({ flows: [flow], graphIndex, repoRoot: repoPath,
    indexCompatKey: compatibilityKey, indexSignature: 'guidance-parity' });
  const expected = guide(legacy);
  assert.equal(expected.callers.length, 3);
  assert.equal(expected.tests.length, 3);
  assert.deepEqual(expected.caps.hits, ['maxCallers', 'maxTests']);
  assert.ok(expected.tests.every(row => row.witnessPath?.distance === 1 && row.reason === 'graph distance 1'));
  assert.deepEqual(guide(prepared.graphIndex), expected, 'CSR must preserve the actual caller/test guidance and bounded caps');
  const partial = { graphRelations, callGraphIndex: legacy.callGraphIndex, symbolIndex: legacy.symbolIndex };
  assert.deepEqual(guide(partial), expected, 'supported partial indexes retain their raw-graph fallback');
  for (const graphIndex of [legacy, prepared.graphIndex, partial]) {
    const report = buildSuggestTestsReport({ graphIndex, graphRelations: graphIndex.graphRelations,
      changed: [fileRelPath], tests, repoRoot: repoPath, indexCompatKey: compatibilityKey, caps: { maxNodes: 5 } });
    assert.equal(report.fidelity.source, 'graph');
    assert.equal(report.fidelity.state, 'complete');
    assert.equal(report.suggestions.length, 4);
    assert.ok(report.suggestions.every(row => row.fidelity.matchKind === 'graph-distance' && row.witnessPath.distance === 1));
    for (const maxNodes of [0, 1]) {
      const capped = buildSuggestTestsReport({ graphIndex, graphRelations: graphIndex.graphRelations,
        changed: [fileRelPath], tests, repoRoot: repoPath, indexCompatKey: compatibilityKey, caps: { maxNodes } });
      assert.equal(capped.fidelity.graph.visitedNodes, maxNodes);
      assert.equal(capped.suggestions.length, 0);
      assert.ok(capped.fidelity.reasonCodes.includes('traversal_capped'));
    }
  }
  const empty = buildSuggestTestsReport({ graphIndex: { ...legacy, importGraphIndex: new Map(), importGraphAdjacency: new Map() },
    graphRelations, changed: [fileRelPath], tests, repoRoot: repoPath, indexCompatKey: compatibilityKey });
  assert.equal(empty.suggestions.length, 0, 'an explicitly empty prepared map cannot widen into raw-graph fallback');
  const harness = await createAnalysisSurfaceHarness({ fixtureRoot: repoPath, env: process.env });
  try {
    const args = { repoPath, seed: 'chunk:chunk-risk', hops: 0, includeRisk: true };
    const cli = harness.runCli(['context-pack', '--repo', repoPath, '--seed', args.seed, '--hops', '0', '--includeRisk', '--json']);
    const api = await harness.runApi('/analysis/context-pack', args);
    const mcp = await harness.runMcp('context_pack', args);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(api.status, 200, JSON.stringify(api.parsed));
    assert.equal(mcp.ok, true, mcp.error?.message);
    for (const pack of [cli.parsed, api.parsed.result, mcp.result]) {
      const validation = validateCompositeContextPack(pack);
      assert.equal(validation.ok, true, validation.errors.join('; '));
      assert.deepEqual(pack.risk.guidance, expected);
    }
  } finally { await harness.close(); }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Persisted CSR preserves real caller guidance and graph-only test witnesses across all context surfaces.');

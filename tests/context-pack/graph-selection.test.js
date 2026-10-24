import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndexCacheKey } from '../../src/graph/store.js';
import { prepareGraphIndex, prepareGraphInputs } from '../../src/integrations/tooling/graph-helpers.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { createRiskRepoIndexFixture } from '../helpers/risk-pack-eval.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { createAnalysisSurfaceHarness } from '../helpers/analysis-surface-parity.js';

const cases = ['none', 'calls', 'usages', 'imports', 'calls-usages', 'calls-imports', 'usages-imports', 'all', 'unspecified'];
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('context-pack/graph-selection/')[1];
assert.ok(cases.includes(selected), 'run one independently bounded graph-selection case');
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./graph-selection.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const calls = selected === 'all' || selected === 'unspecified' || selected.split('-').includes('calls');
const usages = selected === 'all' || selected === 'unspecified' || selected.split('-').includes('usages');
const imports = selected === 'all' || selected === 'unspecified' || selected.split('-').includes('imports');
const flags = selected === 'unspecified' ? {} : { includeCallersCallees: calls, includeUsages: usages, includeImports: imports };
const expected = [calls && 'callGraph', usages && 'usageGraph', imports && 'importGraph'].filter(Boolean).sort();
const graph = (target, file) => ({ nodeCount: 2, edgeCount: 1, nodes: [
  { id: 'chunk-risk', file: 'src/risk.js', out: [target], in: [] },
  { id: target, file, out: [], in: ['chunk-risk'] }
] });
const graphRelations = { version: 1, callGraph: graph('chunk-call', 'src/call.js'), usageGraph: graph('chunk-usage', 'src/usage.js'),
  importGraph: { nodeCount: 2, edgeCount: 1, nodes: [
    { id: 'src/risk.js', file: 'src/risk.js', out: ['src/import.js'], in: [] },
    { id: 'src/import.js', file: 'src/import.js', out: [], in: ['src/risk.js'] }
  ] } };
const symbolEdges = [{ from: { chunkUid: 'chunk-risk' },
  to: { v: 1, status: 'resolved', resolved: { symbolId: 'symbol-target' }, candidates: [] }, type: 'symbol', confidence: 0.5 }];
const { dir } = await prepareIsolatedTestCacheDir(`context-graph-selection-${selected}`);
const repoPath = path.join(dir, 'repo'), cacheRoot = path.join(dir, 'cache');
await fs.mkdir(repoPath, { recursive: true });
applyTestEnv({ cacheRoot, embeddings: 'off' });
try {
  const sourceText = 'export function primary() { return true; }\n';
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath, cacheRoot, fileRelPath: 'src/risk.js',
    sourceText, alias: `selection-${selected}`, generatedAt: '2026-10-20T00:00:00.000Z', compatibilityKey: 'selection-v1' });
  const manifestPath = path.join(finalIndexDir, 'pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const [name, value] of Object.entries({ graph_relations: graphRelations, symbol_edges: symbolEdges, call_sites: [] })) {
    await fs.writeFile(path.join(finalIndexDir, `${name}.json`), JSON.stringify(value));
    manifest.pieces.push({ name, path: `${name}.json`, format: 'json' });
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const chunkMeta = [{ chunkUid: 'chunk-risk', file: 'src/risk.js', start: 0, end: sourceText.length }];
  const assertFamilies = pack => {
    const validation = validateCompositeContextPack(pack);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    assert.deepEqual([...new Set(pack.graph.edges.map(edge => edge.graph))].sort(), expected);
    assert.equal(pack.graph.edges.length, expected.length, 'every included family has a real positive edge');
    assert.ok(!(pack.warnings || []).some(warning => warning.code === 'GRAPH_EXCLUDED_BY_FILTERS'),
      'an intentional empty selection is valid, without a filter-rejection warning');
    assert.ok(pack.primary.excerpt.includes('primary'));
  };
  assertFamilies(assembleCompositeContextPack({ repoRoot: repoPath, seed: { type: 'chunk', chunkUid: 'chunk-risk' },
    chunkMeta, graphRelations, symbolEdges, indexSignature: 'selection-direct', depth: 1, ...flags }));
  if (selected === 'none') {
    const invalid = buildGraphNeighborhood({ seed: { type: 'chunk', chunkUid: 'chunk-risk' }, graphRelations,
      edgeFilters: { graphs: ['unknown'] }, depth: 1 });
    assert.equal(invalid.edges.length, 0);
    for (const code of ['UNKNOWN_GRAPH_FILTER', 'GRAPH_EXCLUDED_BY_FILTERS']) assert.ok(invalid.warnings.some(warning => warning.code === code));
  }

  const inputs = await prepareGraphInputs({ repoRoot: repoPath, indexDir: finalIndexDir, includeChunkMeta: true });
  const prepared = await prepareGraphIndex({ repoRoot: repoPath, indexDir: finalIndexDir, selection: expected,
    graphInputs: { ...inputs, indexSignature: `${inputs.indexSignature}:selection-proof` } });
  assert.deepEqual(prepared.graphSelection.sort(), expected);
  assert.deepEqual(prepared.graphStore.getArtifactsUsed().sort(),
    [expected.length && 'graph_relations', calls && 'call_sites'].filter(Boolean).sort());
  assert.notEqual(buildGraphIndexCacheKey({ indexSignature: 'selection', graphs: [] }),
    buildGraphIndexCacheKey({ indexSignature: 'selection', graphs: null }), 'empty selection cannot reuse all-family authority');
  if (selected === 'unspecified') {
    const defaults = await prepareGraphIndex({ repoRoot: repoPath, indexDir: finalIndexDir,
      graphInputs: { ...inputs, indexSignature: `${inputs.indexSignature}:default-proof` } });
    assert.equal(defaults.graphSelection, null);
    const full = buildGraphNeighborhood({ graphIndex: defaults.graphIndex, seed: { type: 'chunk', chunkUid: 'chunk-risk' }, depth: 1 });
    assert.deepEqual([...new Set(full.edges.map(edge => edge.graph))].sort(), ['callGraph', 'importGraph', 'symbolEdges', 'usageGraph']);
  }
  // Excluded inputs remain declared but unreadable as JSON. Real cold CLI/API
  // execution must succeed without accidentally loading those artifact bytes.
  for (const name of ['symbol_edges', ...(!calls ? ['call_sites'] : []), ...(!expected.length ? ['graph_relations'] : [])]) {
    await fs.writeFile(path.join(finalIndexDir, `${name}.json`), '{invalid excluded artifact');
  }
  const args = { repoPath, seed: 'chunk:chunk-risk', hops: 1, ...flags };
  const cli = ['context-pack', '--repo', repoPath, '--seed', args.seed, '--hops', '1', '--json'];
  for (const [key, value] of Object.entries(flags)) cli.push(`--${key}=${value}`);
  const harness = await createAnalysisSurfaceHarness({ fixtureRoot: repoPath, env: process.env });
  try {
    const cliResult = harness.runCli(cli);
    assert.equal(cliResult.status, 0, `${cliResult.stdout}\n${cliResult.stderr}`);
    const api = await harness.runApi('/analysis/context-pack', args);
    const mcp = await harness.runMcp('context_pack', args);
    assert.equal(api.status, 200, JSON.stringify(api.parsed));
    assert.equal(mcp.ok, true, mcp.error?.message);
    for (const pack of [cliResult.parsed, api.parsed.result, mcp.result]) assertFamilies(pack);
  } finally { await harness.close(); }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Context graph selection ${selected} preserves selected positives and excludes unwanted artifact reads.`);

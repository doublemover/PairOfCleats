import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildIndex } from '../../src/integrations/core/build-index.js';
import { getIndexDir } from '../../src/shared/repo-paths.js';
import { prepareGraphIndex } from '../../src/integrations/tooling/graph-helpers.js';
import { runGraphContextCli } from '../../src/integrations/tooling/graph-context.js';
import { validateGraphContextPack } from '../../src/contracts/validators/analysis.js';
import { buildImpactAnalysis } from '../../src/graph/impact.js';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { buildCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-real-change-'));
const repo = path.join(root, 'repo');
const changed = 'src/graph/ordering.js';
const relevantTest = 'tests/graph/contracts/graph-artifact-ordering-contract.test.js';
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false }
} });
try {
  for (const file of [changed, relevantTest, 'tests/graph/suggest-tests-name-boundaries.test.js']) {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.copyFile(path.resolve(file), path.join(repo, file));
  }
  await buildIndex(repo, { mode: 'code', stage: 'stage2', threads: 1, log: () => {} });
  const { graphIndex, graphRelations, indexSignature } = await prepareGraphIndex({ repoRoot: repo,
    indexDir: getIndexDir(repo, 'code'), includeGraphRelations: true });
  const impact = buildImpactAnalysis({ graphIndex, indexSignature, changed: [changed], direction: 'downstream', depth: 2 });
  assert.match(JSON.stringify(impact.impacted), /tests\/graph\/contracts\/graph-artifact-ordering-contract.test.js/);
  const selectedChunk = [...graphIndex.chunkInfo].find(([, info]) => info.file === changed)?.[0];
  assert.ok(selectedChunk, 'actual indexed source supplies its retained chunk/file fact');
  const output = [], originalLog = console.log;
  console.log = value => output.push(value);
  try {
    const cli = await runGraphContextCli(['--repo', repo, '--seed', `chunk:${selectedChunk}`, '--direction', 'in',
      '--depth', '1', '--graphs', 'importGraph', '--includePaths', '--pathSemantics', 'graph-witness', '--json']);
    assert.equal(validateGraphContextPack(cli).ok, true);
    assert.ok(cli.edges.some(edge => edge.from.path === relevantTest && edge.to.chunkUid === selectedChunk
      && edge.importProjection.containingFile === changed), 'real source importer projects through its exact indexed containing file');
    assert.deepEqual(JSON.parse(output.at(-1)), cli);
  } finally { console.log = originalLog; }
  const report = buildSuggestTestsReport({ changed: [changed], graphRelations, indexSignature, repoRoot: repo,
    tests: [relevantTest, 'tests/graph/suggest-tests-name-boundaries.test.js'] });
  assert.equal(report.suggestions[0].testPath, relevantTest);
  assert.equal(report.fidelity.source, 'graph');
  const context = await buildCompositeContextPackPayload({ repoRoot: repo, seed: `file:${changed}`, hops: 2,
    includeGraph: true, includeRisk: false, includeSemantic: false, maxBytes: 512, maxNodes: 8, maxEdges: 16 });
  assert.equal(context.primary.file, changed);
  assert.ok(context.primary.excerpt.length > 0);
  assert.ok((await fs.readFile(path.join(repo, changed), 'utf8')).includes(context.primary.excerpt),
    'a file seed supplies actual selected source content, independent of which declaration ranks first');
  assert.match(JSON.stringify(context), /tests\/graph\/contracts\/graph-artifact-ordering-contract.test.js/);
  console.log(JSON.stringify({ changed, suggestions: report.suggestions, impact: impact.impacted }));
} finally { await fs.rm(root, { recursive: true, force: true }); }

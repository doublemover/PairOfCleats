import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createContextTokenizerProfile } from '../helpers/context-tokenizer-profile.js';
import { createRiskRepoIndexFixture } from '../helpers/risk-pack-eval.js';
import { createAnalysisSurfaceHarness, runCliJson } from '../helpers/analysis-surface-parity.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { buildCompositeContextPackPayload, buildFederatedCompositeContextPackPayload } from '../../src/integrations/tooling/context-pack.js';
import { evaluateRiskPackDataset } from '../../tools/eval/risk-pack.js';

// UNVALIDATED: actual commands/surfaces and independently retained indexed
// source identities. Invalid input must keep canonical rejection contracts.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['cli', 'http', 'mcp', 'invalid-policy', 'preconditions', 'federation', 'evaluation'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'evidence-surface-'));
const repo = path.join(root, 'repo'), cacheRoot = path.join(root, 'cache'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot, embeddings: 'off' });
let harness;
try {
  const sourceText = 'export function seed() { return "mandatory"; }', optional = 'export function optional() { return "complement 界😀"; }';
  const { finalIndexDir } = await createRiskRepoIndexFixture({ repoPath: repo, cacheRoot, fileRelPath: 'seed.js', sourceText,
    alias: `evidence-${selected}`, generatedAt: '2026-10-28T00:00:00.000Z', compatibilityKey: 'evidence-surface-v1' });
  const metadataPath = path.join(finalIndexDir, 'chunk_meta.json'), manifestPath = path.join(finalIndexDir, 'pieces/manifest.json');
  const hash = text => createHash('sha256').update(text).digest('hex');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  Object.assign(metadata[0], { fileHash: hash(sourceText), fileHashAlgo: 'sha256', start: 0, end: sourceText.length, kind: 'FunctionDeclaration' });
  metadata.push({ chunkUid: 'optional', file: 'optional.js', start: 0, end: optional.length, kind: 'FunctionDeclaration', fileHash: hash(optional), fileHashAlgo: 'sha256' });
  await fs.writeFile(path.join(repo, 'optional.js'), optional); await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const graphRelations = { version: 1, callGraph: { nodeCount: 2, edgeCount: 1, nodes: [
    { id: 'chunk-risk', file: 'seed.js', out: ['optional'], in: [] },
    { id: 'optional', file: 'optional.js', out: [], in: ['chunk-risk'] }
  ] } };
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  await fs.writeFile(path.join(finalIndexDir, 'graph_relations.json'), JSON.stringify(graphRelations));
  manifest.pieces.push({ name: 'graph_relations', path: 'graph_relations.json', format: 'json' });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const profile = await createContextTokenizerProfile(repo);
  const evidenceSelection = { schemaVersion: 1, algorithm: 'top-k', maxSelected: 1 };
  const args = { repoPath: repo, seed: 'chunk:chunk-risk', hops: 1, includeGraph: true, strictEvidence: true,
    taskPolicy: { schemaVersion: 1, task: 'edit-safe', granularity: 'function', wholeFileFallback: false },
    renderedTokenBudget: profile.input, evidenceSelection };
  let pack;
  if (selected === 'cli') {
    const result = runCliJson(['context-pack', '--repo', repo, '--seed', args.seed, '--hops', '1', '--strictEvidence',
      '--task', 'edit-safe', '--granularity', 'function', '--renderedTokenBudget', JSON.stringify(profile.input),
      '--evidenceSelection', JSON.stringify(evidenceSelection), '--json']);
    assert.equal(result.status, 0, result.stderr); pack = result.parsed;
  } else if (selected === 'http' || selected === 'mcp' || selected === 'invalid-policy') {
    harness = await createAnalysisSurfaceHarness({ fixtureRoot: repo, env: process.env });
    if (selected === 'http') {
      const response = await harness.runApi('/analysis/context-pack', args);
      assert.equal(response.status, 200, JSON.stringify(response.parsed)); pack = response.parsed.result;
    } else if (selected === 'mcp') {
      const response = await harness.runMcp('context_pack', args);
      assert.equal(response.ok, true, JSON.stringify(response.error)); pack = response.result;
    } else {
      const bad = { ...args, evidenceSelection: { ...evidenceSelection, algorithm: 'invented' } };
      assert.equal((await harness.runApi('/analysis/context-pack', bad)).status, 400);
      const response = await harness.runMcp('context_pack', bad);
      assert.equal(response.ok, false); assert.equal(response.error?.code, 'INVALID_REQUEST');
    }
  } else if (selected === 'preconditions') {
    for (const changes of [{ taskPolicy: undefined }, { renderedTokenBudget: undefined }, { includeGraph: false },
      { taskPolicy: { schemaVersion: 1, task: 'exploration', granularity: 'excerpt' } }]) {
      await assert.rejects(buildCompositeContextPackPayload({ ...args, repoRoot: repo, ...changes }),
        error => error.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST' && error.status === 400);
    }
  } else if (selected === 'evaluation') {
    const datasetPath = path.join(root, 'dataset.json');
    await fs.writeFile(datasetPath, JSON.stringify([{ id: 'bounded-source', repoPath: repo, seed: args.seed, hops: 1,
      evidenceControls: true, request: { ...args, repoRoot: repo, evidenceSelection: { ...evidenceSelection, maxMeasurements: 16 } },
      expected: { evidence: { goldChunkUids: ['chunk-risk', 'optional'] } } }]));
    const report = await evaluateRiskPackDataset({ datasetPath });
    assert.equal(report.results[0].evidenceControls.controls.length, 4);
    assert.equal(report.results[0].evidenceControls.samePoolIdentity, true);
    assert.equal(report.results[0].evidenceControls.controls[0].goldEvidenceRecall, 1);
    assert.equal(report.results[0].evidenceControls.taskOutcomes.status, 'not-measured');
  } else if (selected === 'federation') {
    await assert.rejects(buildFederatedCompositeContextPackPayload({ ...args, repoRoot: repo }),
      error => error.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST');
    await assert.rejects(buildCompositeContextPackPayload({ ...args, repoRoot: repo, workspacePath: root }),
      error => error.code === 'ERR_CONTEXT_PACK_INVALID_REQUEST');
  }
  if (pack) {
    const checked = validateCompositeContextPack(pack); assert.equal(checked.ok, true, checked.errors.join('; '));
    assert.equal(pack.primary.excerpt, sourceText); assert.equal(pack.evidenceSelection.selected.length, 1);
    assert.equal(pack.evidenceSelection.selected[0].excerpt, optional);
    assert.deepEqual(pack.evidenceSelection.selected[0].roles, ['call']);
    assert.ok(pack.renderedContext.includes(optional)); assert.equal(pack.tokenAccounting.status, 'exact');
  }
} finally { if (harness) await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
console.log(`Evidence selection surface: ${selected}`);

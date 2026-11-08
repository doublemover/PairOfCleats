import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRiskSourceConsumerCase } from '../../../helpers/risk-source-consumer.js';
import { writeIncrementalBundle, readCachedBundle } from '../../../../src/index/build/incremental.js';
import { assembleIndexPieces } from '../../../../src/index/build/piece-assembly.js';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../src/index/risk-interprocedural/engine.js';
import { loadChunkMeta, loadJsonObjectArtifact, loadJsonArrayArtifact } from '../../../../src/shared/artifact-io.js';
import { assembleCompositeContextPack } from '../../../../src/context-pack/assemble.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { sha1 } from '../../../../src/shared/hash.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
const { dir } = await prepareIsolatedTestCacheDir('risk-upstream-replay-piece-consumer');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const userConfig = { indexing: { scm: { provider: 'none' }, typeInference: false, typeInferenceCrossFile: false,
  riskAnalysis: false, riskAnalysisCrossFile: false, embeddings: { enabled: false, mode: 'off' } }, sqlite: { use: false } };
try {
  for (const [name, caps, expectedFlows] of [['positive', {}, 1], ['capped', { maxBytes: 10 }, 0]]) {
    const actual = await createRiskSourceConsumerCase({ caps }), root = path.join(dir, name);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    const texts = [actual.sourceText, actual.sinkText];
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {}, dependencySignatures: {
      parse: 'risk-source-parse', lexical: 'risk-source-lexical', enrichment: 'risk-source-' + name } };
    const bundleDir = path.join(root, 'bundles'), replayed = [];
    for (const [index, chunk] of actual.chunks.entries()) {
      const absPath = path.join(root, chunk.file), bytes = Buffer.from(texts[index]); await fs.writeFile(absPath, bytes);
      const stat = await fs.stat(absPath);
      manifest.files[chunk.file] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: chunk.file,
        fileStat: stat, fileHash: sha1(bytes), fileChunks: [chunk], fileRelations: chunk.codeRelations || {},
        dependencySignatures: manifest.dependencySignatures, vfsManifestRows: [] });
      const { cachedBundle } = await readCachedBundle({ repoRoot: root, enabled: true, absPath, relKey: chunk.file,
        fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
      assert.deepEqual(cachedBundle.chunks[0].docmeta.risk, chunk.docmeta.risk);
      replayed.push(...cachedBundle.chunks);
    }
    const summaries = buildRiskSummaries({ chunks: replayed, runtime: actual.runtime, mode: 'code' });
    const replay = computeInterproceduralRisk({ chunks: replayed, runtime: actual.runtime, summaries: summaries.rows, summaryStats: summaries.stats });
    assert.deepEqual(replay.flowRows, actual.result.flowRows);
    assert.deepEqual(replay.stats.inputCoverage, actual.result.stats.inputCoverage);
    const input = path.join(root, 'input'), output = path.join(root, 'assembled'); await fs.mkdir(input); await fs.mkdir(output);
    const artifacts = { chunk_meta: replayed, file_meta: replayed.map((chunk, id) => ({ id, file: chunk.file, ext: '.js' })),
      index_state: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: name, mode: 'code', stage: 'stage2' },
      token_postings: { totalDocs: 2, avgDocLen: 1, vocab: ['risk'], postings: [[[0, 1], [1, 1]]], docLengths: [1, 1] },
      risk_summaries: replay.summaryRows, risk_flows: replay.flowRows, risk_partial_flows: replay.partialFlowRows,
      risk_interprocedural_stats: replay.stats, call_sites: actual.callSites };
    const pieces = [];
    for (const [key, value] of Object.entries(artifacts)) {
      await fs.writeFile(path.join(input, key + '.json'), JSON.stringify(value)); pieces.push({ name: key, path: key + '.json', format: 'json' });
    }
    await writePiecesManifest(input, pieces);
    await assembleIndexPieces({ inputs: [input], outDir: output, root, mode: 'code', userConfig, log() {} });
    const chunks = await loadChunkMeta(output, { strict: true });
    const persistedStats = await loadJsonObjectArtifact(output, 'risk_interprocedural_stats', { strict: true });
    const persistedSummaries = await loadJsonArrayArtifact(output, 'risk_summaries', { strict: true });
    const persistedFlows = await loadJsonArrayArtifact(output, 'risk_flows', { strict: true });
    assert.deepEqual(persistedStats.inputCoverage, actual.result.stats.inputCoverage);
    assert.deepEqual(persistedSummaries.map(row => row.inputCoverage), actual.result.summaryRows.map(row => row.inputCoverage));
    assert.equal(persistedFlows.length, expectedFlows);
    const request = { seed: { type: 'chunk', chunkUid: actual.chunks[0].chunkUid }, chunkMeta: chunks, repoRoot: root, indexDir: output,
      includeGraph: false, includeTypes: false, includeImports: false, includeUsages: false, includeCallersCallees: false,
      includeRisk: true, indexCompatKey: 'actual-risk-piece' };
    const pack = assembleCompositeContextPack(request);
    assert.equal(pack.risk.analysisStatus.strictFailure, true);
    assert.equal(pack.risk.caps.hits.includes('upstream:maxBytes'), expectedFlows === 0);
    assert.throws(() => assembleCompositeContextPack({ ...request, riskStrict: true }), { code: 'ERR_CONTEXT_PACK_RISK_STRICT' });
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual local coverage and surviving flow evidence persist through bundle replay, piece artifacts and strict context-pack consumers.');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveCompareModelCacheRoot } from '../../../src/experimental/compare/config.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonLines = async filename => (await fs.readFile(filename, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);

/** One actual CLI lifetime; its registries survive all six queries. */
export const runScenario = async ({ destination, shape }) => {
  assert(path.isAbsolute(destination));
  assert(['one-generation', 'many-generations'].includes(shape), 'Select one complete registry lifetime per manual capsule.');
  const root = path.join(destination, 'comparison-input'); await fs.mkdir(root);
  const observations = [], models = ['cost-baseline', 'cost-candidate'], queryCount = 6;
  {
    const dir = path.join(root, shape), repo = path.join(dir, 'repo'), cacheRootBase = path.join(dir, 'models');
    await fs.mkdir(path.join(repo, 'src'), { recursive: true }); initGitRepo(repo);
    await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1}\n');
    const env = applyTestEnv({ cacheRoot: cacheRootBase, embeddings: 'stub', syncProcess: false,
      extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_THREADS: '1' } });
    const roots = new Map(), input = [];
    for (const model of models) {
      const modelCache = resolveCompareModelCacheRoot({ modelId: model, cacheRootBase });
      await withTemporaryEnv({ ...env, PAIROFCLEATS_CACHE_ROOT: modelCache, PAIROFCLEATS_MODEL: model }, async () => {
        const cache = path.dirname(getIndexDir(repo, 'code', loadUserConfig(repo))); roots.set(model, cache);
        for (let index = 0; index < (shape === 'many-generations' && model === models[1] ? queryCount : 1); index++) {
          const generation = `g${index}`, buildId = `${model}-${generation}`, buildRoot = path.join(cache, 'builds', generation);
          const source = `export function needle() { return ${index}; }\n`, file = 'src/needle.js';
          const sourceFile = path.join(dir, 'sources', model, generation + '.js');
          await fs.mkdir(path.dirname(sourceFile), { recursive: true }); await fs.writeFile(sourceFile, source, { flag: 'wx' });
          await fs.writeFile(path.join(repo, file), source);
          const indexDir = await createCompatibilityIndex(buildRoot, { mode: 'code', compatibilityKey: 'comparison-cost-fixture', profileId: 'default', buildId });
          const rows = [{ id: 0, file, fileHash: createHash('sha1').update(source).digest('hex'), chunkUid: 'stable-needle',
            name: 'needle', kind: 'FunctionDeclaration', start: 0, end: source.length, startLine: 1, endLine: 1, tokens: ['needle'] }];
          // Local IDs remain a valid dense lookup namespace; distinct build IDs
          // and source hashes discriminate generations, independently of hits.
          const chunkBytes = Buffer.from(JSON.stringify(rows)); await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), chunkBytes);
          await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({ vocab: ['needle'], postings: [[[0, 1]]], docLengths: [1], avgDocLen: 1, totalDocs: 1 }));
          await fs.writeFile(path.join(buildRoot, 'build_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
            schemaVersion: 1, signatureVersion: 2, buildId, configHash: 'fixture', profile: { id: 'default' }, tool: { version: '1' },
            validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] } }));
          const statePath = path.join(indexDir, 'index_state.json'), stateBytes = await fs.readFile(statePath);
          input.push({ model, generation, buildId, root: buildRoot, sourceFile, chunkPath: path.join(indexDir, 'chunk_meta.json'),
            chunkBytes: chunkBytes.length, chunkSha256: sha256(chunkBytes), sourceSha256: sha256(source),
            statePath, stateBytes: stateBytes.length, stateSha256: sha256(stateBytes) });
        }
        await fs.writeFile(path.join(cache, 'builds/current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
          buildId: `${model}-g0`, buildRoot: 'builds/g0', buildRoots: { code: 'builds/g0' } }));
      });
    }
    const plan = { rootDir: dir, witness: path.join(dir, 'publication.jsonl'), generationEvidence: path.join(dir, 'search-generations.jsonl'),
      corpusReadEvidence: path.join(dir, 'corpus-original-reads.jsonl'), pointerByQuery: [] };
    if (shape === 'many-generations') for (let index = 1; index < queryCount; index++) plan.pointerByQuery.push({
      model: models[1], number: index + 1, pointerPath: path.join(roots.get(models[1]), 'builds/current.json'),
      pointer: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: `${models[1]}-g${index}`,
        buildRoot: `builds/g${index}`, buildRoots: { code: `builds/g${index}` } }
    });
    const planPath = path.join(dir, 'plan.json'), queryFile = path.join(dir, 'queries.txt'), reportPath = path.join(dir, 'report.json');
    await fs.writeFile(planPath, JSON.stringify(plan)); await fs.writeFile(queryFile, 'needle\n'.repeat(queryCount));
    const preload = pathToFileURL(path.resolve('tests/helpers/compare-model-publication-hook.js')); preload.searchParams.set('plan', planPath);
    const began = performance.now();
    const result = await spawnSubprocess(process.execPath, ['tools/reports/compare-models.js', '--repo', repo, '--cache-root', cacheRootBase,
      '--models', models.join(','), '--baseline', models[0], '--mode', 'code', '--backend', 'memory', '--no-ann', '--stub-embeddings',
      '--queries', queryFile, '--top', '1', '--limit', String(queryCount), '--out', reportPath, '--json'], {
      env: { ...env, NODE_OPTIONS: (env.NODE_OPTIONS ? env.NODE_OPTIONS + ' ' : '') + '--import="' + preload.href + '"' },
      timeoutMs: 30000, maxOutputBytes: 4 * 1024 * 1024, captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true });
    const wallMs = performance.now() - began;
    await fs.writeFile(path.join(dir, 'process.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')), reads = await jsonLines(plan.corpusReadEvidence), generations = await jsonLines(plan.generationEvidence);
    assert.equal(report.results.length, queryCount); assert.equal(generations.length, queryCount * models.length);
    const perModel = [];
    for (const model of models) {
      const expectedCount = shape === 'many-generations' && model === models[1] ? queryCount : 1;
      const registry = report.corpusEvidence[model], execution = report.executionEvidence[model], physical = reads.filter(row => row.model === model);
      assert.equal(registry.corpusReads, expectedCount); assert.equal(registry.retainedEntries, expectedCount);
      assert.equal(registry.metadataBytesScope, 'verified-index-state-bytes;chunk-table-bytes-unobserved');
      assert.equal(registry.metadataBytes, input.filter(row => row.model === model).reduce((sum, row) => sum + row.stateBytes, 0));
      assert.equal(physical.length, expectedCount, 'one original chunk-table descriptor read per distinct admitted generation');
      for (const read of physical) {
        const authored = input.find(row => path.resolve(row.chunkPath) === read.path); assert(authored);
        assert.equal(read.bytes, authored.chunkBytes); assert.equal(read.sha256, authored.chunkSha256); assert.equal(read.originalCloseConfirmed, true);
        const source = await fs.readFile(authored.sourceFile), chunkBytes = await fs.readFile(authored.chunkPath), chunks = JSON.parse(chunkBytes);
        assert.equal(sha256(source), authored.sourceSha256); assert.equal(sha256(chunkBytes), read.sha256);
        assert.equal(chunks[0].fileHash, createHash('sha1').update(source).digest('hex'));
        const actual = generations.find(row => row.model === model && row.number === read.number).generations.code;
        assert.equal(actual.buildId, authored.buildId); assert.equal(actual.activeBuildRoot, authored.root);
        const retained = registry.rows.find(row => row.generation.buildId === actual.buildId); assert(retained);
        assert.equal(retained.generation.generationKey, actual.generationKey);
        const canonical = chunks.map(row => ['code', row.file, row.fileHash, row.start, row.end, row.kind || null, row.name || null]);
        assert.equal(retained.digest, sha256(JSON.stringify(canonical)));
      }
      assert.equal(execution.observations, queryCount); assert.equal(execution.omittedReceipts, 0);
      // Corpus admission interns immutable generations. Execution admission
      // also preserves observed cache policy/state, so a cold miss and later
      // disk-cache hits legitimately retain different execution receipts.
      const executionClasses = new Map(), seenGenerations = new Set();
      for (const observation of generations.filter(row => row.model === model)) {
        const generation = observation.generations.code, { hit, strategy, memoryHotPath } = observation.cache;
        const cache = { hit, strategy, memoryHotPath };
        assert.equal(hit, seenGenerations.has(generation.generationKey), 'fresh owner has one cold query per actual generation');
        assert.equal(strategy, 'disk-first'); assert.equal(memoryHotPath, false);
        seenGenerations.add(generation.generationKey);
        const ref = report.results[observation.number - 1].runs[model].admission.execution;
        assert(Number.isSafeInteger(ref) && ref >= 0);
        const retained = execution.receipts[ref]; assert(retained);
        assert.deepEqual(retained.receipt.cache, cache);
        for (const field of ['buildId', 'generationKey', 'activeBuildRoot']) assert.equal(retained.receipt.generations.code[field], generation[field]);
        const key = JSON.stringify([generation.generationKey, hit, strategy, memoryHotPath]);
        if (!executionClasses.has(key)) executionClasses.set(key, { generation, cache, ref, queryNumbers: [] });
        const group = executionClasses.get(key); assert.equal(group.ref, ref); group.queryNumbers.push(observation.number);
      }
      assert.equal(seenGenerations.size, expectedCount);
      assert.equal(execution.receipts.length, executionClasses.size, 'exactly the independently observed generation/cache classes are interned');
      for (const group of executionClasses.values()) assert.equal(execution.receipts[group.ref].observations, group.queryNumbers.length);
      perModel.push({ model, distinctGenerations: expectedCount, registry, execution, executionClasses: [...executionClasses.values()], originalChunkDescriptors: physical,
        originalChunkReadBytes: physical.reduce((sum, row) => sum + row.bytes, 0),
        queryWallMs: report.results.map(row => row.runs[model].wallMs) });
    }
    const summary = report.summary.comparisons[models[1]].code;
    assert.equal(summary.requestedQueries, queryCount); assert.equal(summary.comparableQueries, shape === 'one-generation' ? queryCount : 1);
    assert.equal(summary.unavailableQueries, shape === 'one-generation' ? 0 : queryCount - 1);
    for (const [index, row] of report.results.entries()) {
      for (const model of models) assert.equal(row.runs[model].codeCount, 1, 'every measured real query returns the authored chunk');
      const comparison = row.comparisons[models[1]].code;
      assert.equal(comparison.comparable, shape === 'one-generation' || index === 0);
      if (!comparison.comparable) for (const key of ['overlap', 'avgDelta', 'rankCorr', 'top1Same']) assert.equal(comparison[key], null);
    }
    observations.push({ shape, queryCount, models, wallMs, input, perModel, summary,
      logicalPeakRetainedCorpusReceipts: perModel.reduce((sum, row) => sum + row.registry.retainedEntries, 0),
      logicalPeakRetainedCorpusBytes: perModel.reduce((sum, row) => sum + row.registry.retainedBytes, 0),
      logicalPeakRetainedExecutionReceipts: perModel.reduce((sum, row) => sum + row.execution.receipts.length, 0),
      logicalPeakRetainedExecutionBytes: perModel.reduce((sum, row) => sum + row.execution.retainedBytes, 0),
      retentionScope: 'sum of terminal append-only registries in one CLI lifetime; corpus row JSON bytes and canonical execution receipt bytes exclude map/object overhead; logical peak, not sampled JS/native peak heap' });
  }
  return { issues: [713], observations, scope: 'actual existing-cache CLI children; six queries per registry lifetime; query walls separate from corpus IO; no model inference or speedup claim' };
};

#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { resolveDevelopmentArtifactPath } = await import('../../shared/dev-artifacts.js');
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const { writeJsonLinesSharded } = await import('../../../src/shared/json-stream/jsonl-sharded.js');
const { writeJsonObjectFile } = await import('../../../src/shared/json-stream/json-writers.js');
const { readJsonFile, readJsonLinesArray } = await import('../../../src/shared/artifact-io/json.js');
const {
  buildDatabaseFromArtifacts,
  loadIndexPieces
} = await import('../../../src/storage/sqlite/build/from-artifacts.js');
const { loadIndex } = await import('../../../src/storage/sqlite/utils.js');
const { publishSqliteBenchmarkArtifacts, validateSqliteArtifactBenchmark, createSqliteArtifactWorkOwner } = await import('./artifact-fixture.js');
const { atomicWriteJson } = await import('../../../src/shared/io/atomic-write.js');
const { addStorageFailureContext } = await import('../../../src/shared/storage/operation-error.js');
const { captureSweepSource } = await import('../ab-sweep-source.js');
const { parseSimpleBenchArgs } = await import('../shared.js');
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

export const runSqliteArtifactBenchmark = async (args, { trialOffset = 0 } = {}) => {
  const profile = args.profile === undefined ? 'lexical' : String(args.profile);
  if (!['lexical', 'wide'].includes(profile)) throw new TypeError('Artifact benchmark profile must be lexical or wide.');
  const chunkCount = args.chunks === undefined ? 100000 : Number(args.chunks);
  const trials = args.trials === undefined ? 1 : Number(args.trials);
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 262144
  || !Number.isSafeInteger(trials) || trials < 1 || trials > 12) throw new TypeError('Artifact benchmark chunks1..262144 and trials1..12 must be integral.');
  if (!Number.isSafeInteger(trialOffset) || trialOffset < 0 || trialOffset + trials > 12) {
    throw new RangeError('Private artifact trial offset must retain the bounded12-trial sequence.');
  }
  const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
    ? String(args.mode).toLowerCase()
    : 'compare';
  const parentRoot = resolveDevelopmentArtifactPath(process.cwd(), 'bench-cache', 'sqlite-build-from-artifacts');
  await fs.mkdir(parentRoot, { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(parentRoot, 'run-'));
  const workOwner = await createSqliteArtifactWorkOwner({ parentRoot, runRoot: tempRoot });
  const generatedIndexDir = path.join(workOwner.workRoot, 'index-code');
  const indexDir = typeof args['index-dir'] === 'string' && args['index-dir'].trim()
    ? path.resolve(args['index-dir'].trim())
    : generatedIndexDir;
  const statementStrategy = typeof args['statement-strategy'] === 'string' && args['statement-strategy'].trim()
    ? args['statement-strategy'].trim()
    : null;

  const sumFileTreeBytes = async (dir) => {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        }
      }
    }
    return total;
  };

  let shardResult = null;
  let postingsPart = null;
  let tokens = ['alpha', 'beta'];
  if (indexDir === generatedIndexDir) {
    await fs.mkdir(indexDir, { recursive: true });

    const chunkIterator = function* chunkIterator() {
      for (let i = 0; i < chunkCount; i += 1) {
        yield {
          id: i,
          file: `src/file-${i % 10}.js`,
          start: 0,
          end: 10,
          startLine: 1,
          endLine: 1,
          kind: 'code',
          name: `fn${i}`,
          ...(profile === 'wide' ? { docmeta: { summary: `document-${i}:` + 'documented behavior; '.repeat(220) } } : {}),
          tokens
        };
      }
    };

    shardResult = await writeJsonLinesSharded({
      dir: indexDir,
      partsDirName: 'chunk_meta.parts',
      partPrefix: 'chunk_meta.part-',
      items: chunkIterator(),
      maxBytes: profile === 'wide' ? 1024 * 1024 : 8192,
      atomic: true
    });
    await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
      fields: {
        schemaVersion: '0.0.1',
        artifact: 'chunk_meta',
        format: 'jsonl-sharded',
        generatedAt: new Date().toISOString(),
        compression: 'none',
        totalRecords: shardResult.total,
        totalBytes: shardResult.totalBytes,
        maxPartRecords: shardResult.maxPartRecords,
        maxPartBytes: shardResult.maxPartBytes,
        targetMaxBytes: shardResult.targetMaxBytes,
        parts: shardResult.parts.map((part, index) => ({
          path: part,
          records: shardResult.counts[index] || 0,
          bytes: shardResult.bytes[index] || 0
        }))
      },
      atomic: true
    });

    const postingsDir = path.join(indexDir, 'token_postings.shards');
    await fs.mkdir(postingsDir, { recursive: true });
    postingsPart = path.join(postingsDir, 'token_postings.part-00000.json');
    const postingsEntries = Array.from({ length: chunkCount }, (_, i) => [i, 1]);
    await writeJsonObjectFile(postingsPart, {
      arrays: {
        vocab: tokens,
        postings: tokens.map(() => postingsEntries)
      },
      atomic: true
    });
    const docLengths = Array.from({ length: chunkCount }, () => tokens.length);
    await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
      fields: {
        avgDocLen: tokens.length,
        totalDocs: chunkCount,
        format: 'sharded',
        shardSize: tokens.length,
        vocabCount: tokens.length,
        parts: ['token_postings.shards/token_postings.part-00000.json']
      },
      arrays: { docLengths },
      atomic: true
    });
    await publishSqliteBenchmarkArtifacts({ indexDir, chunkParts: shardResult.parts, repoRoot: process.cwd() });
  } else if (!fsSync.existsSync(indexDir)) {
    console.error(`Missing index dir: ${indexDir}`);
    process.exit(1);
  }

  const buildBaselineIndex = async () => {
    if (indexDir !== generatedIndexDir) {
      const loaded = await loadIndex(indexDir, null);
      if (!loaded) {
        console.error(`Failed to load index artifacts from ${indexDir}`);
        process.exit(1);
      }
      return loaded;
    }

    const chunkMeta = [];
    for (const part of shardResult.parts) {
      const partPath = path.join(indexDir, part);
      const rows = await readJsonLinesArray(partPath);
      if (rows.length) chunkMeta.push(...rows);
    }
    const tokenMeta = readJsonFile(path.join(indexDir, 'token_postings.meta.json'));
    const tokenPart = readJsonFile(postingsPart);
    const docLengths = tokenMeta?.arrays?.docLengths || tokenMeta?.docLengths || [];
    const avgDocLen = Number.isFinite(tokenMeta?.fields?.avgDocLen)
      ? tokenMeta.fields.avgDocLen
      : (Number.isFinite(tokenMeta?.avgDocLen) ? tokenMeta.avgDocLen : null);
    const totalDocs = Number.isFinite(tokenMeta?.fields?.totalDocs)
      ? tokenMeta.fields.totalDocs
      : (Number.isFinite(tokenMeta?.totalDocs) ? tokenMeta.totalDocs : docLengths.length);
    return {
      chunkMeta,
      tokenPostings: {
        vocab: tokenPart?.arrays?.vocab || tokenPart?.vocab || [],
        postings: tokenPart?.arrays?.postings || tokenPart?.postings || [],
        docLengths,
        avgDocLen,
        totalDocs
      },
      fileMeta: []
    };
  };

  const inputBytes = await sumFileTreeBytes(indexDir);

  const runBuild = async ({
    label,
    outPath: targetPath,
    index,
    indexLoader = null,
    indexDir: targetIndexDir,
    buildPragmas,
    optimize
  }) => {
    const start = performance.now();
    const loadStart = performance.now();
    const resolvedIndex = typeof indexLoader === 'function' ? await indexLoader() : index;
    const loadMs = performance.now() - loadStart;
    const stats = {};
    const buildOptions = {
      Database,
      outPath: targetPath,
      index: resolvedIndex,
      indexDir: targetIndexDir,
      mode: 'code',
      manifestFiles: null,
      emitOutput: false,
      validateMode: 'off',
      vectorConfig: { enabled: false },
      modelConfig: { id: null },
      inputBytes,
      stats,
      statementStrategy
    };
    if (typeof buildPragmas === 'boolean') buildOptions.buildPragmas = buildPragmas;
    if (typeof optimize === 'boolean') buildOptions.optimize = optimize;
    const count = await buildDatabaseFromArtifacts(buildOptions);
    const durationMs = performance.now() - start;
    if (!fsSync.existsSync(targetPath)) {
      console.error('Expected sqlite DB to be created.');
      process.exit(1);
    }
    console.log(`[bench] build-from-artifacts ${label} chunks=${count} ms=${durationMs.toFixed(1)}`);
    console.log(
      `[bench] ${label} statementStrategy=${stats.statementStrategy} batchSize=${stats.batchSize} prepares=${stats?.prepare?.total ?? 0}`
    );
    console.log(
      `[bench] ${label} loadMs=${loadMs.toFixed(1)} buildMs=${(durationMs - loadMs).toFixed(1)}`
    );
    console.log(
      `[bench] ${label} inputBytes=${inputBytes} buildPragmas=${Boolean(stats.pragmas)} optimize=${Boolean(stats.optimize || stats.ftsOptimize)}`
    );
    if (stats.transaction) {
      console.log(`[bench] ${label} transaction`, stats.transaction);
    }
    if (stats.multiRow) {
      console.log(`[bench] ${label} multiRow`, stats.multiRow);
    }
    if (stats.ftsOptimize) {
      console.log(`[bench] ${label} ftsOptimize`, stats.ftsOptimize);
    }
    if (stats.optimize) {
      console.log(`[bench] ${label} optimize`, stats.optimize);
    }
    if (stats.pragmas) {
      console.log(`[bench] ${label} pragmas`, stats.pragmas);
    }
    if (stats.tables) {
      console.log(`[bench] ${label} tables`, stats.tables);
    }
    return { count, durationMs, loadMs, buildMs: durationMs - loadMs, stats };
  };

  const sourceRows = await buildBaselineIndex();
  const report = { schemaVersion: 2, kind: 'sqlite-artifact-build', status: 'running', source: captureSweepSource(process.cwd()),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    scope: 'synthetic-lexical-artifact-ingest;no-dense-or-semantic-speed-claim', inputBytes,
    workload: { chunks: sourceRows.chunkMeta.length, requestedChunks: chunkCount, trials, trialOffset, generated: indexDir === generatedIndexDir,
      profile: indexDir === generatedIndexDir ? profile : 'caller-artifacts', retainedWideMetadata: profile === 'wide' && indexDir === generatedIndexDir },
    threshold: { minimumInputBytes: 128 * 1024 * 1024, observedInputBytes: inputBytes, defaultOptimizationEligible: inputBytes >= 128 * 1024 * 1024 },
    cachePolicy: 'fresh-database-per-arm-trial;shared-process-and-OS-cache-uncontrolled', samples: [], paired: [] };
  let primary;
  try {
    for (let trial = 0; trial < trials; trial++) {
      const sampleTrial = trialOffset + trial;
      const order = mode === 'compare' ? sampleTrial % 2 ? ['current', 'baseline'] : ['baseline', 'current'] : [mode];
      for (const label of order) {
        const outPath = path.join(workOwner.workRoot, `trial-${sampleTrial + 1}-${label}.db`);
        const value = await runBuild({ label, outPath, indexDir,
          indexLoader: label === 'baseline' ? buildBaselineIndex : () => loadIndexPieces(indexDir, null),
          ...(label === 'baseline' ? { buildPragmas: false, optimize: false } : {}) });
        const validationStart = performance.now();
        const observation = validateSqliteArtifactBenchmark({ Database, dbPath: outPath, source: sourceRows });
        if (value.count !== sourceRows.chunkMeta.length) throw new Error('Artifact build did not perform the requested work.');
        report.samples.push({ trial: sampleTrial + 1, order, label, outPath, ...value, observation, validationMs: performance.now() - validationStart });
        await atomicWriteJson(path.join(tempRoot, 'checkpoint.json'), report);
      }
      if (mode === 'compare') {
        const baseline = report.samples.find(row => row.trial === sampleTrial + 1 && row.label === 'baseline');
        const current = report.samples.find(row => row.trial === sampleTrial + 1 && row.label === 'current');
        if (JSON.stringify(baseline.observation) !== JSON.stringify(current.observation)) throw new Error('Artifact build arm contents differ.');
        report.paired.push({ trial: sampleTrial + 1, deltaMs: current.durationMs - baseline.durationMs,
          deltaPct: baseline.durationMs > 0 ? (current.durationMs / baseline.durationMs - 1) * 100 : null });
      }
    }
    report.status = 'completed';
  } catch (error) { primary = error; report.status = 'failed'; report.failure = { code: error.code || null, message: error.message }; }
  report.generatedWork = { state: primary ? 'retained-after-failure' : 'awaiting-reclamation', runIdentity: workOwner.runIdentity, workRoot: workOwner.workRoot };
  if (!primary) {
    try {
    // Preserve all compact raw observations before reclaiming closed generated
    // input and database files. A failed/pending operation never reaches reclaim.
      await atomicWriteJson(path.join(tempRoot, 'checkpoint.json'), report);
      report.generatedWork = await workOwner.reclaim();
    } catch (error) {
      primary = error; report.status = 'failed'; report.failure = { code: error.code || null, message: error.message };
      report.generatedWork = { ...report.generatedWork, state: 'retained-after-reclamation-failure' };
    }
  }
  report.receiptPath = path.join(tempRoot, 'final.json');
  try { await atomicWriteJson(report.receiptPath, report, { createOnly: true }); }
  catch (publication) {
    if (primary) throw addStorageFailureContext(primary, { phase: 'artifact-benchmark-final-receipt' }, publication, { secondaryPresent: true });
    throw publication;
  }
  console.log(`[bench] artifact-build receipt ${report.receiptPath}; descriptive paired timings; sustained performance unqualified`);
  if (primary) throw primary;
  return report;
};

if (isDirectExecution(import.meta.url)) await runSqliteArtifactBenchmark(parseSimpleBenchArgs());

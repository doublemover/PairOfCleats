import fs from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir } from '../../../tools/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../triage/index-records.js';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { runWithQueue } from '../../shared/concurrency.js';
import { createCacheReporter } from '../../shared/cache.js';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { toPosix } from '../../shared/files.js';
import { writeIndexArtifacts } from './artifacts.js';
import { estimateContextWindow } from './context-window.js';
import { discoverFiles } from './discover.js';
import { createFileProcessor } from './file-processor.js';
import { scanImports } from './imports.js';
import { loadIncrementalState, pruneIncrementalManifest, updateBundlesWithChunks } from './incremental.js';
import { buildPostings } from './postings.js';
import { createIndexState, appendChunk } from './state.js';
import { configureGitMetaCache } from '../git.js';

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose'|'records',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
 */
export async function buildIndexForMode({ mode, runtime, discovery = null }) {
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime });
    return;
  }
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig);
  await fs.mkdir(outDir, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };

  const state = createIndexState();
  if (discovery && Array.isArray(discovery.skippedFiles)) {
    state.skippedFiles.push(...discovery.skippedFiles);
  }
  const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
  const seenFiles = new Set();
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled
  });
  configureGitMetaCache(runtime.cacheConfig?.gitMeta, cacheReporter);

  log('Discovering files...');
  const discoverStart = Date.now();
  let allEntries = null;
  if (discovery && Array.isArray(discovery.entries)) {
    allEntries = discovery.entries.slice();
    log('→ Reusing shared discovery results.');
  } else {
    allEntries = await runtime.queues.io.add(() => discoverFiles({
      root: runtime.root,
      mode,
      ignoreMatcher: runtime.ignoreMatcher,
      skippedFiles: state.skippedFiles,
      maxFileBytes: runtime.maxFileBytes
    }));
  }
  allEntries.sort((a, b) => a.rel.localeCompare(b.rel));
  log(`→ Found ${allEntries.length} files.`);
  timing.discoverMs = Date.now() - discoverStart;

  let importResult = { allImports: {}, durationMs: 0 };
  if (mode === 'code') {
    log('Scanning for imports...');
    importResult = await scanImports({
      files: allEntries.map((entry) => entry.abs),
      root: runtime.root,
      mode,
      languageOptions: runtime.languageOptions,
      importConcurrency: runtime.importConcurrency,
      queue: runtime.queues.io
    });
    timing.importsMs = importResult.durationMs;
  }

  const contextWin = await estimateContextWindow({
    files: allEntries.map((entry) => entry.abs),
    root: runtime.root,
    mode,
    languageOptions: runtime.languageOptions
  });
  log(`Auto-selected context window: ${contextWin} lines`);

  log('Processing and indexing files...');
  const processStart = Date.now();
  log(`Indexing concurrency: files=${runtime.fileConcurrency}, imports=${runtime.importConcurrency}, io=${runtime.ioConcurrency}, cpu=${runtime.cpuConcurrency}`);
  const showFileProgress = process.env.PAIROFCLEATS_PROGRESS_FILES === '1';

  const { processFile } = createFileProcessor({
    root: runtime.root,
    mode,
    dictConfig: runtime.dictConfig,
    dictWords: runtime.dictWords,
    languageOptions: runtime.languageOptions,
    postingsConfig: runtime.postingsConfig,
    allImports: importResult.allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding: runtime.getChunkEmbedding,
    getChunkEmbeddings: runtime.getChunkEmbeddings,
    embeddingBatchSize: runtime.embeddingBatchSize,
    typeInferenceEnabled: runtime.typeInferenceEnabled,
    riskAnalysisEnabled: runtime.riskAnalysisEnabled,
    seenFiles,
    gitBlameEnabled: runtime.gitBlameEnabled,
    lintEnabled: runtime.lintEnabled,
    complexityEnabled: runtime.complexityEnabled,
    cacheConfig: runtime.cacheConfig,
    cacheReporter,
    queues: runtime.queues,
    useCpuQueue: false,
    workerPool: runtime.workerPool
  });

  let processedFiles = 0;
  const handleFileResult = (result) => {
    if (!result) return;
    for (const chunk of result.chunks) {
      appendChunk(state, { ...chunk }, runtime.postingsConfig);
    }
    state.scannedFilesTimes.push({ file: result.abs, duration_ms: result.durationMs, cached: result.cached });
    state.scannedFiles.push(result.abs);
    if (result.manifestEntry) {
      incrementalState.manifest.files[result.relKey] = result.manifestEntry;
    }
    if (result.fileRelations) {
      state.fileRelations.set(result.relKey, result.fileRelations);
    }
  };
  await runWithQueue(
    runtime.queues.cpu,
    allEntries,
    async (entry, fileIndex) => {
      if (showFileProgress) {
        const rel = entry.rel || toPosix(path.relative(runtime.root, entry.abs));
        logLine(`File ${fileIndex + 1}/${allEntries.length} ${rel}`);
      }
      const result = await processFile(entry, fileIndex);
      processedFiles += 1;
      showProgress('Files', processedFiles, allEntries.length);
      return result;
    },
    { collectResults: false, onResult: handleFileResult }
  );
  showProgress('Files', allEntries.length, allEntries.length);

  timing.processMs = Date.now() - processStart;

  await pruneIncrementalManifest({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log,
    workerPool: runtime.workerPool
  });

  const crossFileEnabled = runtime.typeInferenceCrossFileEnabled || runtime.riskAnalysisCrossFileEnabled;
  if (mode === 'code' && crossFileEnabled) {
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling: runtime.typeInferenceEnabled && runtime.typeInferenceCrossFileEnabled && runtime.toolingEnabled,
      enableTypeInference: runtime.typeInferenceEnabled,
      enableRiskCorrelation: runtime.riskAnalysisEnabled && runtime.riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
    if (crossFileStats) {
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      log(`Cross-file inference: callLinks=${crossFileStats.linkedCalls}, usageLinks=${crossFileStats.linkedUsages}, returns=${crossFileStats.inferredReturns}, riskFlows=${riskFlows}`);
    }
    await updateBundlesWithChunks({
      enabled: runtime.incrementalEnabled,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir,
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      log
    });
  }

  await writeIndexArtifacts({
    outDir,
    mode,
    state,
    postings,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    dictSummary: runtime.dictSummary,
    timing,
    root: runtime.root,
    userConfig: runtime.userConfig,
    incrementalEnabled: runtime.incrementalEnabled,
    fileCounts: { candidates: allEntries.length }
  });
  cacheReporter.report();
}

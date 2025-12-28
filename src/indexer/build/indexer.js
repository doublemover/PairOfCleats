import fs from 'node:fs/promises';
import { getIndexDir } from '../../../tools/dict-utils.js';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { log, showProgress } from '../../shared/progress.js';
import { writeIndexArtifacts } from './artifacts.js';
import { estimateContextWindow } from './context-window.js';
import { discoverFiles } from './discover.js';
import { createFileProcessor } from './file-processor.js';
import { scanImports } from './imports.js';
import { loadIncrementalState, pruneIncrementalManifest, updateBundlesWithChunks } from './incremental.js';
import { buildPostings } from './postings.js';
import { createIndexState, appendChunk } from './state.js';

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose',runtime:object}} input
 */
export async function buildIndexForMode({ mode, runtime }) {
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig);
  await fs.mkdir(outDir, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };

  const state = createIndexState();
  const seenFiles = new Set();
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled
  });

  log('Discovering files...');
  const discoverStart = Date.now();
  const allFiles = await discoverFiles({
    root: runtime.root,
    mode,
    ignoreMatcher: runtime.ignoreMatcher,
    skippedFiles: state.skippedFiles
  });
  allFiles.sort();
  log(`→ Found ${allFiles.length} files.`);
  timing.discoverMs = Date.now() - discoverStart;

  log('Scanning for imports...');
  const importResult = await scanImports({
    files: allFiles,
    root: runtime.root,
    mode,
    languageOptions: runtime.languageOptions,
    importConcurrency: runtime.importConcurrency
  });
  timing.importsMs = importResult.durationMs;

  const contextWin = await estimateContextWindow({
    files: allFiles,
    root: runtime.root,
    mode,
    languageOptions: runtime.languageOptions
  });
  log(`Auto-selected context window: ${contextWin} lines`);

  log('Processing and indexing files...');
  const processStart = Date.now();
  log(`Indexing concurrency: files=${runtime.fileConcurrency}, imports=${runtime.importConcurrency}`);

  const { processFile } = createFileProcessor({
    root: runtime.root,
    mode,
    dictWords: runtime.dictWords,
    languageOptions: runtime.languageOptions,
    allImports: importResult.allImports,
    contextWin,
    incrementalState,
    getChunkEmbedding: runtime.getChunkEmbedding,
    typeInferenceEnabled: runtime.typeInferenceEnabled,
    seenFiles
  });

  let processedFiles = 0;
  const fileResults = await runWithConcurrency(allFiles, runtime.fileConcurrency, async (abs, fileIndex) => {
    const result = await processFile(abs, fileIndex);
    processedFiles += 1;
    showProgress('Files', processedFiles, allFiles.length);
    return result;
  });
  showProgress('Files', allFiles.length, allFiles.length);

  for (const result of fileResults) {
    if (!result) continue;
    for (const chunk of result.chunks) {
      appendChunk(state, { ...chunk });
    }
    state.scannedFilesTimes.push({ file: result.abs, duration_ms: result.durationMs, cached: result.cached });
    state.scannedFiles.push(result.abs);
    if (result.manifestEntry) {
      incrementalState.manifest.files[result.relKey] = result.manifestEntry;
    }
  }

  timing.processMs = Date.now() - processStart;

  await pruneIncrementalManifest({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  const postings = buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    modelId: runtime.modelId,
    log
  });

  if (mode === 'code' && runtime.typeInferenceEnabled && runtime.typeInferenceCrossFileEnabled) {
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling: true
    });
    if (crossFileStats) {
      log(`Cross-file inference: callLinks=${crossFileStats.linkedCalls}, usageLinks=${crossFileStats.linkedUsages}, returns=${crossFileStats.inferredReturns}`);
    }
    await updateBundlesWithChunks({
      enabled: runtime.incrementalEnabled,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir,
      chunks: state.chunks,
      log
    });
  }

  await writeIndexArtifacts({
    outDir,
    mode,
    state,
    postings,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    dictSummary: runtime.dictSummary,
    timing,
    root: runtime.root,
    userConfig: runtime.userConfig,
    incrementalEnabled: runtime.incrementalEnabled,
    fileCounts: { candidates: allFiles.length }
  });
}

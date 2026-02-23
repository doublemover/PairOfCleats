import { configureLogger } from '../../../shared/progress.js';

export const configureRuntimeLogger = ({
  envConfig,
  loggingConfig,
  buildId,
  configHash,
  stage,
  root,
  logDestination,
  logFormatOverride
}) => {
  const logFormatRaw = logFormatOverride || envConfig.logFormat || loggingConfig.format || 'text';
  const logFormat = ['text', 'json', 'pretty'].includes(logFormatRaw)
    ? logFormatRaw
    : 'text';
  const destination = logDestination || loggingConfig.destination || loggingConfig.dest || null;
  const effectiveFormat = destination && logFormat === 'text' ? 'json' : logFormat;
  const logLevelRaw = envConfig.logLevel || loggingConfig.level || 'info';
  const logLevel = typeof logLevelRaw === 'string' && logLevelRaw.trim()
    ? logLevelRaw.trim().toLowerCase()
    : 'info';
  const ringMax = Number.isFinite(Number(loggingConfig.ringMax))
    ? Math.max(1, Math.floor(Number(loggingConfig.ringMax)))
    : 200;
  const ringMaxBytes = Number.isFinite(Number(loggingConfig.ringMaxBytes))
    ? Math.max(1024, Math.floor(Number(loggingConfig.ringMaxBytes)))
    : 2 * 1024 * 1024;
  configureLogger({
    enabled: effectiveFormat !== 'text',
    pretty: effectiveFormat === 'pretty',
    level: logLevel,
    ringMax,
    ringMaxBytes,
    redact: loggingConfig.redact,
    destination,
    context: {
      runId: buildId,
      buildId,
      stage: stage || null,
      configHash: configHash || null,
      repoRoot: root
    }
  });
  return { logFormat: effectiveFormat, logLevel, ringMax, ringMaxBytes };
};

/**
 * Emit runtime feature/status summary lines after config resolution.
 *
 * @param {object} input
 * @param {(line:string)=>void} input.log
 * @param {string} input.stage
 * @param {string} input.profileId
 * @param {boolean} input.hugeRepoProfileEnabled
 * @param {string} [input.autoPolicyProfileId]
 * @param {boolean} input.embeddingEnabled
 * @param {boolean} input.embeddingService
 * @param {boolean} input.baseEmbeddingsPlanned
 * @param {boolean} input.useStubEmbeddings
 * @param {string|null} input.modelId
 * @param {string|null} input.embeddingProvider
 * @param {number} input.embeddingBatchSize
 * @param {number} input.embeddingConcurrency
 * @param {boolean} input.incrementalEnabled
 * @param {string} input.repoCacheRoot
 * @param {number} input.ioConcurrency
 * @param {number} input.cpuConcurrency
 * @param {object} input.runtimeMemoryPolicy
 * @param {boolean} input.astDataflowEnabled
 * @param {boolean} input.controlFlowEnabled
 * @param {boolean} input.pythonAstEnabled
 */
export const logRuntimeFeatureStatus = ({
  log,
  stage,
  profileId,
  hugeRepoProfileEnabled,
  autoPolicyProfileId,
  embeddingEnabled,
  embeddingService,
  baseEmbeddingsPlanned,
  useStubEmbeddings,
  modelId,
  embeddingProvider,
  embeddingBatchSize,
  embeddingConcurrency,
  incrementalEnabled,
  repoCacheRoot,
  ioConcurrency,
  cpuConcurrency,
  runtimeMemoryPolicy,
  astDataflowEnabled,
  controlFlowEnabled,
  pythonAstEnabled
}) => {
  if (stage === 'stage1') {
    log('Two-stage indexing: stage1 (sparse) overrides enabled.');
  } else if (stage === 'stage2') {
    log('Two-stage indexing: stage2 (enrichment) running.');
  } else if (stage === 'stage3') {
    log('Indexing stage3 (embeddings pass) running.');
  } else if (stage === 'stage4') {
    log('Indexing stage4 (sqlite/ann pass) running.');
  }
  log(`Index profile: ${profileId}.`);
  if (hugeRepoProfileEnabled) {
    log(
      `Huge-repo profile enabled (${autoPolicyProfileId || 'huge-repo'}): ` +
      'cross-file enrichment and expensive relation passes are reduced by default.'
    );
  }
  if (!embeddingEnabled) {
    const label = embeddingService ? 'service queue' : 'disabled';
    const deferred = baseEmbeddingsPlanned && (stage === 'stage1' || stage === 'stage2');
    if (deferred) {
      const stageLabel = stage === 'stage1' ? 'stage1' : 'stage2';
      log(`Embeddings: deferred to stage3 (${stageLabel}).`);
    } else {
      log(`Embeddings: ${label}.`);
    }
  } else if (useStubEmbeddings) {
    log('Embeddings: stub mode enabled (no model downloads).');
  } else {
    const providerLabel = embeddingProvider === 'onnx' ? 'onnxruntime' : 'xenova';
    log(`Embeddings: model ${modelId} (${providerLabel}).`);
  }
  if (embeddingEnabled) {
    log(`Embedding batch size: ${embeddingBatchSize}`);
    log(`Embedding concurrency: ${embeddingConcurrency}`);
  }
  if (incrementalEnabled) {
    log(`Incremental cache enabled (root: ${repoCacheRoot}).`);
  }
  log(`Queue concurrency: io=${ioConcurrency}, cpu=${cpuConcurrency}.`);
  log(
    `Memory policy: workerHeap=${runtimeMemoryPolicy.workerHeapPolicy.targetPerWorkerMb}MB ` +
    `(effective=${runtimeMemoryPolicy.effectiveWorkerHeapMb}MB, ` +
    `min=${runtimeMemoryPolicy.workerHeapPolicy.minPerWorkerMb}MB, ` +
    `max=${runtimeMemoryPolicy.workerHeapPolicy.maxPerWorkerMb}MB), ` +
    `workerCache=${runtimeMemoryPolicy.perWorkerCacheMb}MB, ` +
    `writeBuffer=${runtimeMemoryPolicy.perWorkerWriteBufferMb}MB.`
  );
  if (runtimeMemoryPolicy?.highMemoryProfile?.enabled) {
    const mode = runtimeMemoryPolicy.highMemoryProfile.applied ? 'applied' : 'eligible';
    log(
      `High-memory profile (${mode}): threshold=${runtimeMemoryPolicy.highMemoryProfile.thresholdMb}MB, ` +
      `cacheScale=${runtimeMemoryPolicy.highMemoryProfile.cacheScale}x, ` +
      `writeScale=${runtimeMemoryPolicy.highMemoryProfile.writeBufferScale}x, ` +
      `postingsScale=${runtimeMemoryPolicy.highMemoryProfile.postingsScale}x.`
    );
  }
  if (!astDataflowEnabled) {
    log('AST dataflow metadata disabled via indexing.astDataflow.');
  }
  if (!controlFlowEnabled) {
    log('Control-flow metadata disabled via indexing.controlFlow.');
  }
  if (!pythonAstEnabled) {
    log('Python AST metadata disabled via indexing.pythonAst.enabled.');
  }
};

/**
 * Emit feature toggles that are logged after tree-sitter initialization.
 *
 * @param {object} input
 * @param {(line:string)=>void} input.log
 * @param {boolean} input.typeInferenceEnabled
 * @param {boolean} input.typeInferenceCrossFileEnabled
 * @param {boolean} input.gitBlameEnabled
 * @param {boolean} input.lintEnabled
 * @param {boolean} input.complexityEnabled
 * @param {boolean} input.riskAnalysisEnabled
 * @param {boolean} input.riskAnalysisCrossFileEnabled
 * @param {object} input.postingsConfig
 * @param {object} input.lexiconConfig
 */
export const logRuntimePostTreeSitterFeatureStatus = ({
  log,
  typeInferenceEnabled,
  typeInferenceCrossFileEnabled,
  gitBlameEnabled,
  lintEnabled,
  complexityEnabled,
  riskAnalysisEnabled,
  riskAnalysisCrossFileEnabled,
  postingsConfig,
  lexiconConfig
}) => {
  if (typeInferenceEnabled) {
    log('Type inference metadata enabled via indexing.typeInference.');
  }
  if (typeInferenceCrossFileEnabled && !typeInferenceEnabled) {
    log('Cross-file type inference requested but indexing.typeInference is disabled.');
  }
  if (!gitBlameEnabled) {
    log('SCM annotate metadata disabled via indexing.scm.annotate.enabled.');
  }
  if (!lintEnabled) {
    log('Lint metadata disabled via indexing.lint.');
  }
  if (!complexityEnabled) {
    log('Complexity metadata disabled via indexing.complexity.');
  }
  if (!riskAnalysisEnabled) {
    log('Risk analysis disabled via indexing.riskAnalysis.');
  }
  if (!riskAnalysisCrossFileEnabled && riskAnalysisEnabled) {
    log('Cross-file risk correlation disabled via indexing.riskAnalysisCrossFile.');
  }
  if (postingsConfig.enablePhraseNgrams === false) {
    log('Phrase n-gram postings disabled via indexing.postings.enablePhraseNgrams.');
  }
  if (postingsConfig.enableChargrams === false) {
    log('Chargram postings disabled via indexing.postings.enableChargrams.');
  }
  if (lexiconConfig.enabled === false) {
    log('Lexicon features disabled via indexing.lexicon.enabled.');
  }
};

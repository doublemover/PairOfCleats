#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveToolRoot } from '../shared/dict-utils.js';
import { toPosix } from '../../src/shared/files.js';
import * as sharedCliOptions from '../../src/shared/cli-options.js';
import { collectSchemaEntries, getLeafEntries, mergeEntry } from './inventory/schema.js';
import { listSourceFiles, scanSourceFiles } from './inventory/scan.js';
import { buildInventoryReportMarkdown } from './inventory/report.js';

const defaultRoot = resolveToolRoot();
const defaultSchemaPath = path.join(defaultRoot, 'docs', 'config', 'schema.json');
const defaultOutputJsonPath = path.join(defaultRoot, 'docs', 'config', 'inventory.json');
const defaultOutputMdPath = path.join(defaultRoot, 'docs', 'config', 'inventory.md');

const PUBLIC_CONFIG_KEYS = new Set(['cache.root', 'quality']);
const PUBLIC_ENV_VARS = new Set(['PAIROFCLEATS_API_TOKEN']);
const PUBLIC_CLI_FLAGS = new Set([
  'all',
  'repo',
  'mode',
  'quality',
  'watch',
  'top',
  'json',
  'explain',
  'filter',
  'backend',
  'allow-unauthenticated',
  'allowed-repo-roots',
  'auth-token',
  'command',
  'concurrency',
  'config',
  'cors-allow-any',
  'cors-allowed-origins',
  'dry-run',
  'host',
  'interval',
  'job',
  'lock',
  'max-body-bytes',
  'output',
  'port',
  'queue',
  'quiet',
  'reason',
  'shutdown-mode',
  'stage',
  'timeout-ms'
]);
const KNOWN_CONFIG_KEYS = new Set([
  'cache.root',
  'indexing.artifacts.chunkMetaFormat',
  'indexing.artifacts.chunkMetaJsonlThreshold',
  'indexing.artifacts.chunkMetaShardSize',
  'indexing.artifacts.mode',
  'indexing.artifacts.symbolArtifactsFormat',
  'indexing.artifacts.tokenPostingsFormat',
  'indexing.artifacts.tokenPostingsShardSize',
  'indexing.artifacts.tokenPostingsShardThreshold',
  'indexing.artifacts.writeConcurrency',
  'indexing.concurrency',
  'indexing.diffs.compute.detectRenames',
  'indexing.diffs.compute.includeRelations',
  'indexing.diffs.compute.maxBytes',
  'indexing.diffs.compute.maxChangedFiles',
  'indexing.diffs.compute.maxChunksPerFile',
  'indexing.diffs.compute.maxEvents',
  'indexing.diffs.compute.modes',
  'indexing.diffs.compute.persist',
  'indexing.diffs.compute.persistEvents',
  'indexing.diffs.keep',
  'indexing.diffs.maxAgeDays',
  'indexing.diffs.maxBytes',
  'indexing.diffs.maxDiffs',
  'indexing.diffs.maxEvents',
  'indexing.diffs.retainDays',
  'indexing.embeddings.cache.dir',
  'indexing.embeddings.cache.maxAgeDays',
  'indexing.embeddings.cache.maxGb',
  'indexing.embeddings.cache.scope',
  'indexing.embeddings.concurrency',
  'indexing.embeddings.onnx.interOpNumThreads',
  'indexing.embeddings.onnx.intraOpNumThreads',
  'indexing.embeddings.provider',
  'indexing.fileCaps.byExt.*.maxBytes',
  'indexing.fileCaps.byExt.*.maxLines',
  'indexing.fileCaps.byLanguage.*.maxBytes',
  'indexing.fileCaps.byLanguage.*.maxLines',
  'indexing.fileCaps.byMode.code.maxBytes',
  'indexing.fileCaps.byMode.code.maxLines',
  'indexing.fileCaps.byMode.extracted-prose.maxBytes',
  'indexing.fileCaps.byMode.extracted-prose.maxLines',
  'indexing.fileCaps.byMode.prose.maxBytes',
  'indexing.fileCaps.byMode.prose.maxLines',
  'indexing.fileCaps.byMode.records.maxBytes',
  'indexing.fileCaps.byMode.records.maxLines',
  'indexing.fileCaps.default.maxBytes',
  'indexing.fileCaps.default.maxLines',
  'indexing.graph.caps.maxEdges',
  'indexing.graph.caps.maxNodes',
  'indexing.importConcurrency',
  'indexing.ioConcurrencyCap',
  'indexing.lexicon.enabled',
  'indexing.lexicon.languageOverrides.*.relations.drop.builtins',
  'indexing.lexicon.languageOverrides.*.relations.drop.keywords',
  'indexing.lexicon.languageOverrides.*.relations.drop.literals',
  'indexing.lexicon.languageOverrides.*.relations.drop.types',
  'indexing.lexicon.languageOverrides.*.relations.enabled',
  'indexing.lexicon.languageOverrides.*.relations.stableDedupe',
  'indexing.lexicon.relations.drop.builtins',
  'indexing.lexicon.relations.drop.keywords',
  'indexing.lexicon.relations.drop.literals',
  'indexing.lexicon.relations.drop.types',
  'indexing.lexicon.relations.enabled',
  'indexing.lexicon.relations.stableDedupe',
  'indexing.maxFileBytes',
  'indexing.maxFileLines',
  'indexing.postings.chargramFields',
  'indexing.postings.chargramMaxDf',
  'indexing.postings.chargramMaxN',
  'indexing.postings.chargramMaxTokenLength',
  'indexing.postings.chargramMinN',
  'indexing.postings.chargramSource',
  'indexing.postings.chargramSpillMaxUnique',
  'indexing.postings.chargramStopwords',
  'indexing.postings.enableChargrams',
  'indexing.postings.enablePhraseNgrams',
  'indexing.postings.fielded',
  'indexing.postings.phraseMaxN',
  'indexing.postings.phraseMinN',
  'indexing.postings.phraseSource',
  'indexing.postings.tokenClassification',
  'indexing.profile',
  'indexing.riskInterprocedural.caps.maxBlockedExpansionsPerPartial',
  'indexing.riskInterprocedural.caps.maxCallSitesPerEdge',
  'indexing.riskInterprocedural.caps.maxDepth',
  'indexing.riskInterprocedural.caps.maxEdgeExpansions',
  'indexing.riskInterprocedural.caps.maxMs',
  'indexing.riskInterprocedural.caps.maxPartialFlows',
  'indexing.riskInterprocedural.caps.maxPathsPerPair',
  'indexing.riskInterprocedural.caps.maxTotalFlows',
  'indexing.riskInterprocedural.emitArtifacts',
  'indexing.riskInterprocedural.enabled',
  'indexing.riskInterprocedural.sanitizerPolicy',
  'indexing.riskInterprocedural.semantics',
  'indexing.riskInterprocedural.semantics[].frameworks',
  'indexing.riskInterprocedural.semantics[].fromArgs',
  'indexing.riskInterprocedural.semantics[].id',
  'indexing.riskInterprocedural.semantics[].kind',
  'indexing.riskInterprocedural.semantics[].languages',
  'indexing.riskInterprocedural.semantics[].name',
  'indexing.riskInterprocedural.semantics[].patterns',
  'indexing.riskInterprocedural.semantics[].taintHints',
  'indexing.riskInterprocedural.semantics[].toParams',
  'indexing.riskInterprocedural.strictness',
  'indexing.riskInterprocedural.summaryOnly',
  'indexing.scheduler.cpuTokens',
  'indexing.scheduler.enabled',
  'indexing.scheduler.ioTokens',
  'indexing.scheduler.lowResourceMode',
  'indexing.scheduler.memoryTokens',
  'indexing.scheduler.queues.*.maxPending',
  'indexing.scheduler.queues.*.priority',
  'indexing.scheduler.starvationMs',
  'indexing.scm.annotate.enabled',
  'indexing.scm.annotate.maxFileSizeBytes',
  'indexing.scm.annotate.timeoutMs',
  'indexing.scm.churnWindowCommits',
  'indexing.scm.jj.snapshotWorkingCopy',
  'indexing.scm.maxConcurrentProcesses',
  'indexing.scm.provider',
  'indexing.scm.timeoutMs',
  'indexing.snapshots.keepFrozen',
  'indexing.snapshots.keepPointer',
  'indexing.snapshots.keepTags',
  'indexing.snapshots.maxAgeDays',
  'indexing.snapshots.maxFrozenSnapshots',
  'indexing.snapshots.maxPointerSnapshots',
  'indexing.snapshots.protectedTagGlobs',
  'indexing.snapshots.retainDays',
  'indexing.snapshots.stagingMaxAgeHours',
  'mcp.maxBufferBytes',
  'mcp.mode',
  'mcp.queueMax',
  'mcp.toolTimeoutMs',
  'mcp.toolTimeouts',
  'quality',
  'retrieval.annCandidateCap',
  'retrieval.annCandidateMaxDocCount',
  'retrieval.annCandidateMinDocCount',
  'retrieval.contextExpansion.enabled',
  'retrieval.contextExpansion.includeCalls',
  'retrieval.contextExpansion.includeExports',
  'retrieval.contextExpansion.includeImports',
  'retrieval.contextExpansion.includeUsages',
  'retrieval.contextExpansion.maxCallEdges',
  'retrieval.contextExpansion.maxExportEdges',
  'retrieval.contextExpansion.maxImportEdges',
  'retrieval.contextExpansion.maxNameCandidates',
  'retrieval.contextExpansion.maxPerHit',
  'retrieval.contextExpansion.maxReasons',
  'retrieval.contextExpansion.maxTotal',
  'retrieval.contextExpansion.maxUsageEdges',
  'retrieval.contextExpansion.maxWallClockMs',
  'retrieval.contextExpansion.maxWorkUnits',
  'retrieval.contextExpansion.respectFilters',
  'retrieval.graph.caps.maxCandidates',
  'retrieval.graph.caps.maxDepth',
  'retrieval.graph.caps.maxEdges',
  'retrieval.graph.caps.maxFanoutPerNode',
  'retrieval.graph.caps.maxNodes',
  'retrieval.graph.caps.maxPaths',
  'retrieval.graph.caps.maxWallClockMs',
  'retrieval.graph.caps.maxWorkUnits',
  'retrieval.graphRanking.enabled',
  'retrieval.graphRanking.maxGraphWorkUnits',
  'retrieval.graphRanking.maxWallClockMs',
  'retrieval.graphRanking.seedK',
  'retrieval.graphRanking.seedSelection',
  'retrieval.graphRanking.weights',
  'retrieval.relationBoost.enabled',
  'retrieval.relationBoost.maxBoost',
  'retrieval.relationBoost.perCall',
  'retrieval.relationBoost.perUse',
  'runtime.ioOversubscribe',
  'runtime.maxOldSpaceMb',
  'runtime.nodeOptions',
  'runtime.uvThreadpoolSize',
  'search.annDefault',
  'search.denseVectorMode',
  'search.fieldWeights',
  'search.maxCandidates',
  'search.rrf.enabled',
  'search.rrf.k',
  'search.scoreBlend.annWeight',
  'search.scoreBlend.enabled',
  'search.scoreBlend.sparseWeight',
  'search.sqliteAutoArtifactBytes',
  'search.sqliteAutoChunkThreshold',
  'search.sqliteFtsWeights',
  'threads',
  'tooling.allowGlobalFallback',
  'tooling.autoEnableOnDetect',
  'tooling.autoInstallOnDetect',
  'tooling.cache.dir',
  'tooling.cache.enabled',
  'tooling.cache.maxBytes',
  'tooling.cache.maxEntries',
  'tooling.circuitBreakerThreshold',
  'tooling.clangd.compileCommandsDir',
  'tooling.clangd.requireCompilationDatabase',
  'tooling.csharp',
  'tooling.dart',
  'tooling.dir',
  'tooling.disabledTools',
  'tooling.elixir',
  'tooling.enabledTools',
  'tooling.gopls',
  'tooling.haskell',
  'tooling.installScope',
  'tooling.jdtls',
  'tooling.lifecycle',
  'tooling.logDir',
  'tooling.lsp.circuitBreakerThreshold',
  'tooling.lsp.enabled',
  'tooling.lsp.lifecycle',
  'tooling.lsp.maxRetries',
  'tooling.lsp.servers',
  'tooling.lsp.servers[].args',
  'tooling.lsp.servers[].cmd',
  'tooling.lsp.servers[].id',
  'tooling.lsp.servers[].label',
  'tooling.lsp.servers[].languages',
  'tooling.lsp.servers[].priority',
  'tooling.lsp.servers[].retries',
  'tooling.lsp.servers[].timeoutMs',
  'tooling.lsp.servers[].uriScheme',
  'tooling.lsp.servers[].version',
  'tooling.lsp.timeoutMs',
  'tooling.maxRetries',
  'tooling.phpactor',
  'tooling.providerOrder',
  'tooling.pyright',
  'tooling.solargraph',
  'tooling.sourcekit',
  'tooling.strict',
  'tooling.timeoutMs',
  'tooling.typescript.allowJs',
  'tooling.typescript.checkJs',
  'tooling.typescript.enabled',
  'tooling.typescript.includeJsx',
  'tooling.typescript.maxFileBytes',
  'tooling.typescript.maxFiles',
  'tooling.typescript.maxProgramFiles',
  'tooling.typescript.resolveOrder',
  'tooling.typescript.tsconfigPath',
  'tooling.typescript.useTsconfig',
  'tooling.vfs.coalesceSegments',
  'tooling.vfs.coldStartCache.cacheRoot',
  'tooling.vfs.coldStartCache.enabled',
  'tooling.vfs.coldStartCache.maxAgeDays',
  'tooling.vfs.coldStartCache.maxBytes',
  'tooling.vfs.hashRouting',
  'tooling.vfs.ioBatching.enabled',
  'tooling.vfs.ioBatching.flushIntervalMs',
  'tooling.vfs.ioBatching.maxBatchBytes',
  'tooling.vfs.ioBatching.maxInflight',
  'tooling.vfs.ioBatching.maxQueueEntries',
  'tooling.vfs.ioBatching.writeMode',
  'tooling.vfs.maxVirtualFileBytes',
  'tooling.vfs.strict',
  'tooling.vfs.tokenMode'
]);
const KNOWN_ENV_VARS = new Set([
  'PAIROFCLEATS_ANN_BACKEND',
  'PAIROFCLEATS_API_TOKEN',
  'PAIROFCLEATS_BENCH_ANTIVIRUS_STATE',
  'PAIROFCLEATS_BENCH_CPU_GOVERNOR',
  'PAIROFCLEATS_BENCH_MIRROR_REFRESH_MS',
  'PAIROFCLEATS_BENCH_RUN',
  'PAIROFCLEATS_BUILD_INDEX_LOCK_POLL_MS',
  'PAIROFCLEATS_BUILD_INDEX_LOCK_WAIT_MS',
  'PAIROFCLEATS_BUNDLE_THREADS',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_CACHE_NAMESPACE',
  'PAIROFCLEATS_CACHE_REBUILD',
  'PAIROFCLEATS_CACHE_METRICS_SAMPLE_RATE',
  'PAIROFCLEATS_CI_USE_LSP_FIXTURES',
  'PAIROFCLEATS_COMPRESSION',
  'PAIROFCLEATS_CRASH_LOG_ANNOUNCE',
  'PAIROFCLEATS_CRASH_RETENTION_FULL_TRACE',
  'PAIROFCLEATS_CRASH_RETENTION_PROFILE',
  'PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL',
  'PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL_MIN_BUNDLE',
  'PAIROFCLEATS_DEBUG_ORDERED',
  'PAIROFCLEATS_DEBUG_CRASH',
  'PAIROFCLEATS_DEBUG_HANG_PROBES',
  'PAIROFCLEATS_DEBUG_HANG_PROBE_HEARTBEAT_MS',
  'PAIROFCLEATS_DEBUG_HANG_PROBE_WARN_MS',
  'PAIROFCLEATS_DEBUG_PERF_EVENTS',
  'PAIROFCLEATS_DENSE_BINARY_MAX_INLINE_MB',
  'PAIROFCLEATS_DICT_DIR',
  'PAIROFCLEATS_DISCOVERY_STAT_CONCURRENCY',
  'PAIROFCLEATS_DOC_EXTRACT',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES',
  'PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED',
  'PAIROFCLEATS_ENV_ALLOWLIST',
  'PAIROFCLEATS_EXTENSIONS_DIR',
  'PAIROFCLEATS_FILE_CACHE_MAX',
  'PAIROFCLEATS_FORCE_CHUNK_AUTHOR_HYDRATION',
  'PAIROFCLEATS_HOME',
  'PAIROFCLEATS_IMPORT_GRAPH',
  'PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY',
  'PAIROFCLEATS_INDEX_DAEMON',
  'PAIROFCLEATS_INDEX_DAEMON_SESSION',
  'PAIROFCLEATS_INDEXER_SERVICE_EXECUTION',
  'PAIROFCLEATS_IO_OVERSUBSCRIBE',
  'PAIROFCLEATS_JSON_STREAM_WAIT_TIMEOUT_MS',
  'PAIROFCLEATS_LANCEDB_CHILD',
  'PAIROFCLEATS_LANCEDB_ISOLATE',
  'PAIROFCLEATS_LANCEDB_PAYLOAD',
  'PAIROFCLEATS_LOG_FORMAT',
  'PAIROFCLEATS_LOG_LEVEL',
  'PAIROFCLEATS_MAX_OLD_SPACE_MB',
  'PAIROFCLEATS_MCP_MAX_BUFFER_BYTES',
  'PAIROFCLEATS_MCP_MODE',
  'PAIROFCLEATS_MCP_QUEUE_MAX',
  'PAIROFCLEATS_MCP_TRANSPORT',
  'PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS',
  'PAIROFCLEATS_MODEL',
  'PAIROFCLEATS_MODELS_DIR',
  'PAIROFCLEATS_NODE_OPTIONS',
  'PAIROFCLEATS_ONNX_CPU_EP_TUNING',
  'PAIROFCLEATS_ONNX_PREWARM_MODEL',
  'PAIROFCLEATS_ONNX_PREWARM_TEXTS',
  'PAIROFCLEATS_ONNX_PREWARM_TOKENIZER',
  'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE',
  'PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX',
  'PAIROFCLEATS_OBSERVABILITY_CONTEXT',
  'PAIROFCLEATS_PREFER_MEMORY_BACKEND_ON_CACHE_HIT',
  'PAIROFCLEATS_PROFILE',
  'PAIROFCLEATS_PROGRESS_CONTEXT',
  'PAIROFCLEATS_QUERY_CACHE_MEMORY_FRESH_MS',
  'PAIROFCLEATS_QUERY_CACHE_PREWARM',
  'PAIROFCLEATS_QUERY_CACHE_PREWARM_MAX_ENTRIES',
  'PAIROFCLEATS_QUERY_CACHE_STRATEGY',
  'PAIROFCLEATS_REGEX_ENGINE',
  'PAIROFCLEATS_SUPPRESS_LEGACY_ENTRYPOINT_WARNING',
  'PAIROFCLEATS_SKIP_BENCH',
  'PAIROFCLEATS_SKIP_SCRIPT_COVERAGE',
  'PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL',
  'PAIROFCLEATS_SCHEDULER',
  'PAIROFCLEATS_SCHEDULER_ADAPTIVE',
  'PAIROFCLEATS_SCHEDULER_ADAPTIVE_STEP',
  'PAIROFCLEATS_SCHEDULER_CPU',
  'PAIROFCLEATS_SCHEDULER_IO',
  'PAIROFCLEATS_SCHEDULER_MAX_CPU',
  'PAIROFCLEATS_SCHEDULER_MAX_IO',
  'PAIROFCLEATS_SCHEDULER_MAX_MEM',
  'PAIROFCLEATS_SCHEDULER_MEM',
  'PAIROFCLEATS_SCHEDULER_MEMORY_PER_TOKEN_MB',
  'PAIROFCLEATS_SCHEDULER_MEMORY_RESERVE_MB',
  'PAIROFCLEATS_SCHEDULER_LOW_RESOURCE',
  'PAIROFCLEATS_SCHEDULER_STARVATION_MS',
  'PAIROFCLEATS_SCHEDULER_TARGET_UTILIZATION',
  'PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_TARGET',
  'PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_WINDOW_MS',
  'PAIROFCLEATS_SCRIPT_COVERAGE_CACHE_ROOT',
  'PAIROFCLEATS_SCRIPT_COVERAGE_GROUPS',
  'PAIROFCLEATS_SCRIPT_COVERAGE_SHARD_COUNT',
  'PAIROFCLEATS_SCRIPT_COVERAGE_SHARD_INDEX',
  'PAIROFCLEATS_SERVICE_SUBPROCESS_MAX_OUTPUT_BYTES',
  'PAIROFCLEATS_SERVICE_SUBPROCESS_TIMEOUT_MS',
  'PAIROFCLEATS_SQLITE_FTS_OVERFETCH_CHUNK_SIZE',
  'PAIROFCLEATS_SQLITE_FTS_OVERFETCH_ROW_CAP',
  'PAIROFCLEATS_SQLITE_FTS_OVERFETCH_TIME_BUDGET_MS',
  'PAIROFCLEATS_SQLITE_DENSE_CHILD',
  'PAIROFCLEATS_SQLITE_DENSE_PAYLOAD',
  'PAIROFCLEATS_SQLITE_TAIL_LATENCY_TUNING',
  'PAIROFCLEATS_STAGE',
  'PAIROFCLEATS_STORAGE_TIER',
  'PAIROFCLEATS_SUITE_MODE',
  'PAIROFCLEATS_SUMMARY_CACHE_MAX',
  'PAIROFCLEATS_TRACE_ARTIFACT_IO',
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_TEST_ALLOW_TIMEOUT_TARGET',
  'PAIROFCLEATS_TEST_ALLOW_TIMEOUT_PASS_SIGNAL_TARGET',
  'PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS',
  'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
  'PAIROFCLEATS_TEST_CACHE_SUFFIX',
  'PAIROFCLEATS_TEST_CODE_MAP_BUDGET_MS',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_TEST_EMBEDDING_MIN_THROUGHPUT',
  'PAIROFCLEATS_TEST_FORCE_DOCX_MISSING',
  'PAIROFCLEATS_TEST_FORCE_PDF_MISSING',
  'PAIROFCLEATS_TEST_LOG_DIR',
  'PAIROFCLEATS_TEST_LOG_SILENT',
  'PAIROFCLEATS_TEST_ID',
  'PAIROFCLEATS_TEST_LANE',
  'PAIROFCLEATS_TEST_BENCH_REPO_DELAY_MS',
  'PAIROFCLEATS_TEST_BENCH_SELF_INTERRUPT_AFTER_MS',
  'PAIROFCLEATS_TEST_MCP_DELAY_MS',
  'PAIROFCLEATS_TEST_MAX_JSON_BYTES',
  'PAIROFCLEATS_TEST_MAX_OLD_SPACE_MB',
  'PAIROFCLEATS_TEST_NODE_OPTIONS',
  'PAIROFCLEATS_TEST_PID_FILE',
  'PAIROFCLEATS_TEST_RETRIES',
  'PAIROFCLEATS_TEST_SQLITE_P95_MAX_MS',
  'PAIROFCLEATS_TEST_STUB_DOCX_EXTRACT',
  'PAIROFCLEATS_TEST_STUB_PDF_EXTRACT',
  'PAIROFCLEATS_TEST_STUB_PDF_EXTRACT_DELAY_MS',
  'PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH',
  'PAIROFCLEATS_TEST_TANTIVY',
  'PAIROFCLEATS_TEST_THREADS',
  'PAIROFCLEATS_TEST_TIMEOUT_MS',
  'PAIROFCLEATS_TEST_WATCHDOG_MS',
  'PAIROFCLEATS_SUBLIME_TEST_CLI',
  'PAIROFCLEATS_SUBLIME_TEST_FIXTURE_REPO',
  'PAIROFCLEATS_SUBLIME_TEST_NODE',
  'PAIROFCLEATS_THREADS',
  'PAIROFCLEATS_TUI_ALT_SCREEN',
  'PAIROFCLEATS_TUI_CARGO',
  'PAIROFCLEATS_TUI_DIST_DIR',
  'PAIROFCLEATS_TUI_EVENT_LOG_DIR',
  'PAIROFCLEATS_TUI_INSTALL_ROOT',
  'PAIROFCLEATS_TUI_MOUSE',
  'PAIROFCLEATS_TUI_RUN_ID',
  'PAIROFCLEATS_TUI_UNICODE',
  'PAIROFCLEATS_TOOLING_LSP_GUARDRAIL_BASELINE',
  'PAIROFCLEATS_TOOLING_LSP_REPLAY_BASELINE',
  'PAIROFCLEATS_TOOLING_LSP_SLO_BASELINE',
  'PAIROFCLEATS_UPDATE_SNAPSHOTS',
  'PAIROFCLEATS_UV_THREADPOOL_SIZE',
  'PAIROFCLEATS_VERBOSE',
  'PAIROFCLEATS_WATCHER_BACKEND',
  'PAIROFCLEATS_WORKER_POOL',
  'PAIROFCLEATS_WORKER_POOL_HEAP_MAX_MB',
  'PAIROFCLEATS_WORKER_POOL_HEAP_MIN_MB',
  'PAIROFCLEATS_WORKER_POOL_HEAP_TARGET_MB',
  'PAIROFCLEATS_WORKER_POOL_MAX_WORKERS',
  'PAIROFCLEATS_XXHASH_BACKEND'
]);
const BUDGETS = {
  configKeys: 2,
  envVars: 1,
  cliFlags: 32
};
const PUBLIC_FLAG_SOURCES = new Set([
  'bin/pairofcleats.js',
  'src/shared/cli.js',
  'tools/service/indexer-service.js'
]);

const shouldCheck = process.argv.includes('--check');

export const buildInventory = async (options = {}) => {
  const root = options.root ? path.resolve(options.root) : resolveToolRoot();
  const schemaPath = options.schemaPath ? path.resolve(options.schemaPath) : defaultSchemaPath;
  const outputJsonPath = options.outputJsonPath
    ? path.resolve(options.outputJsonPath)
    : defaultOutputJsonPath;
  const outputMdPath = options.outputMdPath
    ? path.resolve(options.outputMdPath)
    : defaultOutputMdPath;
  const checkBudget = typeof options.check === 'boolean' ? options.check : shouldCheck;
  const sourceFiles = Array.isArray(options.sourceFiles)
    ? options.sourceFiles
    : await listSourceFiles(root);
  const schemaRaw = await fs.readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const entries = collectSchemaEntries(schema);
  const entryMap = new Map();
  for (const entry of entries) {
    if (!entry.path) continue;
    const existing = entryMap.get(entry.path);
    if (!existing) {
      entryMap.set(entry.path, { ...entry });
    } else {
      mergeEntry(existing, entry);
    }
  }
  const configEntries = Array.from(entryMap.values())
    .sort((a, b) => a.path.localeCompare(b.path));
  const configLeafEntries = getLeafEntries(configEntries);
  const topLevel = new Map();
  for (const entry of configEntries) {
    const rootKey = entry.path.split(/[.[\]]/)[0] || entry.path;
    topLevel.set(rootKey, (topLevel.get(rootKey) || 0) + 1);
  }

  const {
    envVarMap,
    cliFlagMap,
    cliFlagsByFile,
    dynamicOptionFiles,
    importedOptionSetRefs
  } = await scanSourceFiles(root, sourceFiles);

  const upsertCliFlag = (file, flag) => {
    const normalizedFile = String(file || '').trim();
    const normalizedFlag = String(flag || '').trim();
    if (!normalizedFile || !normalizedFlag) return;
    const currentFlags = new Set(cliFlagsByFile.get(normalizedFile) || []);
    currentFlags.add(normalizedFlag);
    cliFlagsByFile.set(normalizedFile, Array.from(currentFlags).sort((a, b) => a.localeCompare(b)));
    if (!cliFlagMap.has(normalizedFlag)) cliFlagMap.set(normalizedFlag, new Set());
    cliFlagMap.get(normalizedFlag).add(normalizedFile);
  };

  for (const [file, optionSetNames] of importedOptionSetRefs.entries()) {
    for (const optionSetName of optionSetNames) {
      const optionSet = sharedCliOptions?.[optionSetName];
      if (!optionSet || typeof optionSet !== 'object' || Array.isArray(optionSet)) continue;
      for (const flag of Object.keys(optionSet)) {
        upsertCliFlag(file, flag);
      }
    }
  }

  const envVars = Array.from(envVarMap.entries())
    .map(([name, files]) => ({ name, files: Array.from(files).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cliFlags = Array.from(cliFlagMap.entries())
    .map(([flag, files]) => ({ flag, files: Array.from(files).sort() }))
    .sort((a, b) => a.flag.localeCompare(b.flag));

  const cliFlagsByFileOutput = Array.from(cliFlagsByFile.entries())
    .map(([file, flags]) => ({ file, flags }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const isPublicFlagSource = (file) => PUBLIC_FLAG_SOURCES.has(file);

  const publicFlagsDetected = new Set();
  for (const entry of cliFlagsByFileOutput) {
    if (!isPublicFlagSource(entry.file)) continue;
    entry.flags.forEach((flag) => publicFlagsDetected.add(flag));
  }

  let existingInventory = null;
  try {
    const existingRaw = await fs.readFile(outputJsonPath, 'utf8');
    existingInventory = JSON.parse(existingRaw);
  } catch {}

  const knownConfigLeafKeys = [
    ...new Set([
      ...Array.from(KNOWN_CONFIG_KEYS),
      ...((!KNOWN_CONFIG_KEYS.size && !checkBudget)
        ? configLeafEntries.map((entry) => entry.path)
        : [])
    ])
  ];
  const publicConfigLeafKeys = configLeafEntries
    .filter((entry) => PUBLIC_CONFIG_KEYS.has(entry.path))
    .map((entry) => entry.path)
    .sort();
  const unknownConfigLeafKeys = configLeafEntries
    .filter((entry) => !knownConfigLeafKeys.includes(entry.path))
    .map((entry) => entry.path)
    .sort();

  const publicEnvVars = envVars
    .filter((entry) => PUBLIC_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const unknownEnvVars = envVars
    .filter((entry) => !KNOWN_ENV_VARS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const unknownEnvVarDetails = envVars
    .filter((entry) => !KNOWN_ENV_VARS.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      files: entry.files || []
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const publicFlags = cliFlags
    .filter((entry) => PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const internalFlags = cliFlags
    .filter((entry) => !PUBLIC_CLI_FLAGS.has(entry.flag))
    .map((entry) => entry.flag)
    .sort();
  const unknownPublicFlags = Array.from(publicFlagsDetected)
    .filter((flag) => !PUBLIC_CLI_FLAGS.has(flag))
    .sort();

  const duplicatedFlags = cliFlags
    .filter((entry) => entry.files.length > 1)
    .map((entry) => ({
      flag: entry.flag,
      count: entry.files.length,
      files: entry.files
    }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));

  const nowIso = new Date().toISOString();
  const inventory = {
    generatedAt: nowIso,
    budgets: { ...BUDGETS },
    allowlists: {
      configKeys: Array.from(PUBLIC_CONFIG_KEYS).sort(),
      envVars: Array.from(PUBLIC_ENV_VARS).sort(),
      cliFlags: Array.from(PUBLIC_CLI_FLAGS).sort(),
      knownEnvVars: Array.from(KNOWN_ENV_VARS).sort(),
      knownConfigKeys: Array.from(knownConfigLeafKeys).sort()
    },
    configSchema: {
      path: toPosix(path.relative(root, schemaPath)),
      totalKeys: configEntries.length,
      leafKeys: configLeafEntries.length,
      topLevel: Array.from(topLevel.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
    configKeys: configEntries,
    configKeysPublic: publicConfigLeafKeys,
    configKeysUnknown: unknownConfigLeafKeys,
    envVars,
    envVarsPublic: publicEnvVars,
    envVarsUnknown: unknownEnvVars,
    cliFlags: {
      totalFlags: cliFlags.length,
      publicFlags,
      internalFlags,
      publicDetected: Array.from(publicFlagsDetected).sort(),
      publicUnknown: unknownPublicFlags,
      byFile: cliFlagsByFileOutput,
      duplicated: duplicatedFlags,
      dynamicOptionFiles: Array.from(dynamicOptionFiles).sort()
    }
  };

  let preservedGeneratedAt = nowIso;
  if (existingInventory && typeof existingInventory.generatedAt === 'string') {
    const candidate = { ...inventory, generatedAt: existingInventory.generatedAt };
    if (JSON.stringify(candidate) === JSON.stringify(existingInventory)) {
      preservedGeneratedAt = existingInventory.generatedAt;
      inventory.generatedAt = preservedGeneratedAt;
    }
  }

  const jsonOutput = JSON.stringify(inventory, null, 2);
  const mdOutput = buildInventoryReportMarkdown(inventory);
  const applyLineEndings = (text, eol) => (
    typeof text === 'string' ? text.replace(/\r?\n/g, eol) : text
  );
  let writeJson = true;
  let writeMd = true;
  if (existingInventory && typeof existingInventory.generatedAt === 'string') {
    if (JSON.stringify(inventory) === JSON.stringify(existingInventory)) {
      writeJson = false;
    }
  }
  let mdOutputFinal = mdOutput;
  if (!writeJson) {
    // Keep md in sync when json hasn't changed.
    try {
      const existingMd = await fs.readFile(outputMdPath, 'utf8');
      const hasBom = existingMd.charCodeAt(0) === 0xfeff;
      const eol = existingMd.includes('\r\n') ? '\r\n' : '\n';
      mdOutputFinal = applyLineEndings(mdOutput, eol);
      if (hasBom && !mdOutputFinal.startsWith('\ufeff')) {
        mdOutputFinal = `\ufeff${mdOutputFinal}`;
      }
      if (existingMd === mdOutputFinal) writeMd = false;
    } catch {}
  }
  if (writeJson) {
    await fs.writeFile(outputJsonPath, jsonOutput);
  }
  if (writeMd) {
    await fs.writeFile(outputMdPath, mdOutputFinal);
  }

  if (checkBudget) {
    const errors = [];
    if (unknownConfigLeafKeys.length) {
      errors.push(`Config keys not in allowlist: ${unknownConfigLeafKeys.join(', ')}`);
    }
    if (unknownEnvVars.length) {
      const detailLines = unknownEnvVarDetails.map((entry) => {
        if (!entry.files.length) return entry.name;
        const files = entry.files.slice(0, 5);
        const suffix = entry.files.length > files.length ? ' …' : '';
        return `${entry.name} (${files.join(', ')}${suffix})`;
      });
      errors.push(`Env vars not in allowlist: ${detailLines.join(', ')}`);
    }
    if (unknownPublicFlags.length) {
      errors.push(`Public CLI flags not in allowlist: ${unknownPublicFlags.join(', ')}`);
    }
    if (publicConfigLeafKeys.length > BUDGETS.configKeys) {
      errors.push(`Public config keys exceed budget (${publicConfigLeafKeys.length}/${BUDGETS.configKeys}).`);
    }
    if (publicEnvVars.length > BUDGETS.envVars) {
      errors.push(`Public env vars exceed budget (${publicEnvVars.length}/${BUDGETS.envVars}).`);
    }
    if (publicFlagsDetected.size > BUDGETS.cliFlags) {
      errors.push(`Public CLI flags exceed budget (${publicFlagsDetected.size}/${BUDGETS.cliFlags}).`);
    }
    if (errors.length) {
      errors.forEach((msg) => console.error(`[config-budget] ${msg}`));
      process.exit(1);
    }
  }
};

export { collectSchemaEntries, getLeafEntries, mergeEntry };

await buildInventory();



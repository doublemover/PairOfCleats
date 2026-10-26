import { createRecordSourceUnion } from './record-source.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { recordsReusePolicy, readReusableRecordChunk } from './records-reuse.js';
import { createRecordsMarkdownInventory } from './records-inventory.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { analyzeLiteralText } from '../../shared/text-analyzer.js';
import { stableStringify } from '../../shared/stable-json.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, getRepoCacheRoot } from '../../shared/repo-paths.js';
import { getTriageConfig } from '../../shared/dict-utils.js';
import { SimpleMinHash } from '../../index/minhash.js';
import { getHeadline } from '../../index/headline.js';
import { STOP, SYN } from '../../index/constants.js';
import { createIndexState, appendChunk } from '../../index/build/state.js';
import {
  loadIncrementalState,
  normalizeIncrementalEmbeddingCoverageManifest,
  pruneIncrementalManifest,
  writeIncrementalBundle
} from '../../index/build/incremental.js';
import { buildPostings } from '../../index/build/postings.js';
import { writeIndexArtifacts } from '../../index/build/artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { buildIndexProfileState, INDEX_PROFILE_VECTOR_ONLY } from '../../contracts/index-profile.js';
import { buildChunkId } from '../../index/chunk-id.js';
import { buildMetaV2 } from '../../index/metadata-v2.js';
import { assignChunkUids } from '../../index/identity/chunk-uid.js';
import { getLanguageForFile } from '../../index/language-registry.js';
import { buildIndexStateArtifactsBlock } from '../../index/build/index-state-profile.js';
import { sha1 } from '../../shared/hash.js';
import { extractNgrams, splitId, splitWordsWithDict, stem } from '../../shared/tokenize.js';
import { forEachRollingChargramHash } from '../../shared/chargram-hash.js';
import { log, showProgress } from '../../shared/progress-runtime.js';
import { throwIfAborted } from '../../shared/abort.js';
import { setRecordsIncrementalCapability } from '../../storage/sqlite/build/index.js';
import { promoteRecordFields } from './record-utils.js';

export const recordsLogicalContentHash = ({ text, record, recordMeta, policy, sourceHash = null, recordSource = null }) => sha1(stableStringify({
  schema: 'records.logical-content.v4', text, sourceHash, recordSource,
  sidecar: record === null ? { status: 'absent' } : { status: 'present', value: record }, recordMeta, policy
}));

/**
 * Records service-mode builds enqueue embeddings without materializing dense artifacts.
 * `artifacts.present.dense_vectors*` must track emitted vectors on disk, not queue capability.
 *
 * @param {object} postings
 * @returns {boolean}
 */
const hasEmittedDenseVectors = (postings) => (
  (Array.isArray(postings?.quantizedVectors) && postings.quantizedVectors.length > 0)
  || (Array.isArray(postings?.quantizedDocVectors) && postings.quantizedDocVectors.length > 0)
  || (Array.isArray(postings?.quantizedCodeVectors) && postings.quantizedCodeVectors.length > 0)
);

/**
 * Vector-only builds are valid when embeddings are available inline or when
 * service queueing is enabled for deferred embedding generation.
 *
 * @param {object} runtime
 * @returns {boolean}
 */
const hasVectorEmbeddingBuildCapability = (runtime) => (
  runtime?.embeddingEnabled === true || runtime?.embeddingService === true
);

/**
 * Build the records index for a repo.
 * @param {{runtime:object,discovery?:{entries:Array}}} input
 * @returns {Promise<void>}
 */
export async function buildRecordsIndexForRepo({ runtime, discovery = null, abortSignal = null }) {
  throwIfAborted(abortSignal);
  const profile = buildIndexProfileState(runtime.profile?.id || runtime.indexingConfig?.profile);
  // Keep records indexing consistent with main indexer vector_only behavior:
  // retain chunk tokens but skip sparse postings/materialization work.
  const sparsePostingsEnabled = profile.id !== INDEX_PROFILE_VECTOR_ONLY;
  if (profile.id === INDEX_PROFILE_VECTOR_ONLY && !hasVectorEmbeddingBuildCapability(runtime)) {
    throw new Error(
      'indexing.profile=vector_only requires embeddings to be available during index build. '
      + 'Enable inline/stub embeddings or service-mode embedding queueing and rebuild.'
    );
  }
  const triageConfig = getTriageConfig(runtime.root, runtime.userConfig);
  const recordsDir = triageConfig.recordsDir;
  const outDir = getIndexDir(runtime.root, 'records', runtime.userConfig, { indexRoot: runtime.buildRoot });
  const postingsConfig = runtime.postingsConfig;
  await fs.mkdir(outDir, { recursive: true });

  log('\n📄  Scanning records ...');
  const timing = { start: Date.now() };

  const state = createIndexState({ postingsConfig });
  const resolvedRepoCacheRoot = runtime.repoCacheRoot || getRepoCacheRoot(runtime.root, runtime.userConfig);
  const incrementalState = await loadIncrementalState({
    repoRoot: runtime.root,
    repoCacheRoot: resolvedRepoCacheRoot,
    mode: 'records',
    enabled: runtime.incrementalEnabled === true,
    bundleFormat: runtime.incrementalBundleFormat,
    log
  });
  if (incrementalState?.manifest) {
    normalizeIncrementalEmbeddingCoverageManifest(incrementalState.manifest);
    setRecordsIncrementalCapability(incrementalState.manifest, true);
  }
  const seenFiles = new Set();
  const sourceUnion = createRecordSourceUnion({ repoRoot: runtime.root, recordsDir });
  const discoveredEntries = Array.isArray(discovery?.entries) ? discovery.entries : [];
  for (const entry of discoveredEntries) {
    throwIfAborted(abortSignal);
    if (!entry?.abs || entry.skip || !entry.record) continue;
    sourceUnion.addRepository(entry);
  }
  const inventory = createRecordsMarkdownInventory(recordsDir, { signal: abortSignal });
  for await (const absPath of inventory.files) {
    throwIfAborted(abortSignal);
    sourceUnion.addTriage(absPath);
  }
  const recordSources = sourceUnion.finish();
  const triageInputReceipt = inventory.receipt();

  log(`→ Found ${recordSources.length} record(s).`);

  const recordsPolicy = { promoteFields: triageConfig.promoteFields, postingsConfig, dictConfig: runtime.dictConfig,
    dictionary: sha1(stableStringify([...(runtime.dictWords || [])].sort())) };
  const reusePolicy = recordsReusePolicy({ runtime, policy: recordsPolicy, stop: STOP, synonyms: SYN instanceof Map ? SYN : Object.entries(SYN) });
  const reuseCounts = { hits: 0, misses: 0, reasons: {} };
  let processed = 0;
  const progressMeta = { stage: 'records', mode: 'records' };
  for (const recordEntry of recordSources) {
    throwIfAborted(abortSignal);
    const started = Date.now();
    const absPath = recordEntry.absPath;
    const relPath = recordEntry.relPath;
    const source = await readVerifiedContainedFile(recordEntry.root, absPath, { maxBytes: 32 * 1024 * 1024, signal: abortSignal });
    const sourceHash = sha1(source.buffer), fileStat = source.stat;
    const sourceText = source.buffer.toString('utf8');
    if (!sourceText) continue;

    const isTriage = recordEntry.recordSource.kind === 'triage';
    const recordSource = { ...recordEntry.recordSource, contentHash: sourceHash };
    const record = isTriage ? await loadRecordJson(recordsDir, absPath, abortSignal) : null;
    const docmeta = buildDocMeta(record, triageConfig, recordEntry.recordMeta);
    const recordName = record?.vuln?.vulnId
      || record?.recordId
      || path.basename(relPath, path.extname(relPath));

    const recordFile = recordSource.storagePath;
    const logicalHash = recordsLogicalContentHash({ text: sourceText, record, recordMeta: recordEntry.recordMeta, policy: reusePolicy.snapshot, sourceHash, recordSource });
    const reused = await readReusableRecordChunk({ incrementalState, repoRoot: runtime.root, file: recordFile,
      logicalHash, policy: reusePolicy, textLength: sourceText.length, sourceHash, recordSource, signal: abortSignal });
    if (reused.chunk) {
      // Admission reads exact current inputs; recheck after asynchronous bundle I/O.
      const again = await readVerifiedContainedFile(recordEntry.root, absPath, { maxBytes: 32 * 1024 * 1024, signal: abortSignal });
      const currentRecord = isTriage ? await loadRecordJson(recordsDir, absPath, abortSignal) : null;
      if (recordsLogicalContentHash({ text: again.buffer.toString('utf8'), record: currentRecord,
        recordMeta: recordEntry.recordMeta, policy: reusePolicy.snapshot, sourceHash: sha1(again.buffer), recordSource }) !== logicalHash) throw new Error(`Record changed during replay admission: ${recordFile}`);
      const chunk = reused.chunk;
      chunk.id = state.chunks.length; // IDs belong to this build's global ordering.
      appendChunk(state, chunk, postingsConfig, null, { sparsePostingsEnabled });
      seenFiles.add(recordFile); state.scannedFiles.push(recordFile);
      state.scannedFilesTimes.push({ file: recordFile, duration_ms: Date.now() - started, cached: true });
      reuseCounts.hits++;
      processed++; showProgress('Records', processed, recordSources.length, progressMeta);
      continue;
    }
    reuseCounts.misses++;
    reuseCounts.reasons[reused.reason] = (reuseCounts.reasons[reused.reason] || 0) + 1;
    const recordExt = path.extname(absPath) || '.txt';
    const tokenPayload = tokenizeRecord(
      sourceText,
      runtime.dictWords,
      runtime.dictConfig,
      recordExt,
      postingsConfig,
      [recordName, docmeta.doc || ''].filter(Boolean).join(' '),
      { sparsePostingsEnabled }
    );
    if (!tokenPayload.tokens.length) continue;

    const stats = computeTokenStats(tokenPayload.tokens);
    const fieldTokens = sparsePostingsEnabled && postingsConfig?.fielded !== false ? {
      name: recordName ? buildRecordSeq(recordName, runtime.dictWords, runtime.dictConfig, recordExt).tokens : [],
      signature: [],
      doc: docmeta.doc ? buildRecordSeq(docmeta.doc, runtime.dictWords, runtime.dictConfig, recordExt).tokens : [],
      comment: [],
      body: tokenPayload.tokens
    } : null;
    const embedText = docmeta.doc || sourceText;
    const embedding = await runtime.getChunkEmbedding(embedText);

    let minhashSig = [];
    let minhashHashIdentity = null;
    if (sparsePostingsEnabled) {
      const mh = new SimpleMinHash();
      tokenPayload.tokens.forEach((t) => mh.update(t));
      minhashSig = mh.hashValues;
      minhashHashIdentity = mh.hashIdentity;
    }

    const lines = sourceText.split(/\r?\n/);
    const startLine = 1;
    const endLine = lines.length;

    const recordLang = getLanguageForFile(recordExt, recordFile);
    const effectiveLanguageId = recordLang?.id || 'unknown';
    const chunkPayload = {
      file: recordFile,
      recordSource,
      displayPath: recordSource.displayPath,
      ext: recordExt,
      lang: effectiveLanguageId,
      containerLanguageId: recordLang?.id || null,
      fileHash: sourceHash,
      fileHashAlgo: 'sha1',
      fileSize: fileStat.size,
      start: 0,
      end: sourceText.length,
      startLine,
      endLine,
      kind: 'Record',
      name: recordName,
      tokens: tokenPayload.tokens,
      seq: tokenPayload.seq,
      phraseTokens: analyzeLiteralText(sourceText, { caseSensitive: true }),
      phraseTokensCasePreserved: true,
      ngrams: tokenPayload.ngrams,
      chargrams: tokenPayload.chargrams,
      codeRelations: {},
      docmeta,
      stats,
      complexity: {},
      lint: [],
      headline: getHeadline({ docmeta }, tokenPayload.tokens),
      preContext: [],
      postContext: [],
      embedding,
      minhashSig,
      minhashHashIdentity,
      weight: 1,
      externalDocs: [],
      ...(fieldTokens ? { fieldTokens } : {})
    };
    chunkPayload.chunkId = buildChunkId(chunkPayload);
    const chunkId = state.chunks.length;
    chunkPayload.id = chunkId;
    await assignChunkUids({
      chunks: [chunkPayload],
      fileText: sourceText,
      fileRelPath: recordFile,
      namespaceKey: `record-source-v1-${recordSource.rootKey}`,
      strict: true,
      log
    });
    chunkPayload.metaV2 = buildMetaV2({ chunk: chunkPayload, docmeta, toolInfo: runtime.toolInfo,
      analysisPolicy: runtime.analysisPolicy });
    const manifestEntry = await writeIncrementalBundle({
      enabled: incrementalState.enabled,
      bundleDir: incrementalState.bundleDir,
      manifest: incrementalState.manifest,
      relKey: recordFile,
      fileStat,
      fileHash: logicalHash,
      dependencySignatures: { recordsProducer: reusePolicy.key },
      fileChunks: [{ ...chunkPayload }],
      fileRelations: null,
      vfsManifestRows: null,
      bundleFormat: incrementalState.bundleFormat,
      previousManifestEntry: incrementalState.manifest?.files?.[recordFile] || null,
      fileEncoding: 'utf8',
      fileEncodingFallback: false,
      fileEncodingConfidence: 1
    });
    if (manifestEntry) {
      incrementalState.manifest.files[recordFile] = { ...manifestEntry, recordSource };
    }
    seenFiles.add(recordFile);

    appendChunk(
      state,
      chunkPayload,
      postingsConfig,
      null,
      { sparsePostingsEnabled }
    );
    state.scannedFiles.push(recordFile);
    state.scannedFilesTimes.push({
      file: recordFile,
      duration_ms: Date.now() - started,
      cached: false
    });
    processed += 1;
    showProgress('Records', processed, recordSources.length, progressMeta);
  }
  showProgress('Records', recordSources.length, recordSources.length, progressMeta);
  throwIfAborted(abortSignal);

  log(`[records-reuse] hits=${reuseCounts.hits} misses=${reuseCounts.misses} reasons=${JSON.stringify(reuseCounts.reasons)}`);
  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  throwIfAborted(abortSignal);
  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    phrasePostHashBuckets: state.phrasePostHashBuckets,
    triPost: state.triPost,
    postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log,
    workerPool: runtime.workerPool,
    embeddingsEnabled: runtime.embeddingEnabled,
    sparsePostingsEnabled
  });

  const artifacts = buildIndexStateArtifactsBlock({
    profileId: profile.id,
    mode: 'records',
    embeddingsEnabled: hasEmittedDenseVectors(postings),
    postingsConfig
  });
  const indexState = {
    generatedAt: new Date().toISOString(),
    extensions: { recordsInventory: { schemaVersion: 1, complete: true, selected: recordSources.length, triage: triageInputReceipt } },
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    profile,
    compatibilityKey: runtime.compatibilityKey || null,
    cohortKey: runtime.cohortKeys?.records || runtime.compatibilityKey || null,
    buildId: runtime.buildId || null,
    repoId: runtime.repoId || null,
    mode: 'records',
    stage: runtime.stage || null,
    embeddings: {
      enabled: runtime.embeddingEnabled || runtime.embeddingService,
      ready: runtime.embeddingEnabled,
      mode: runtime.embeddingMode,
      service: runtime.embeddingService === true
    },
    features: {
      treeSitter: false,
      lint: false,
      complexity: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      typeInference: false,
      typeInferenceCrossFile: false,
      gitBlame: false
    },
    shards: runtime.shards?.enabled
      ? { enabled: true, plan: null }
      : { enabled: false },
    enrichment: runtime.twoStage?.enabled
      ? { enabled: true, pending: runtime.stage === 'stage1', stage: runtime.stage || null }
      : { enabled: false },
    artifacts
  };

  throwIfAborted(abortSignal);
  await writeIndexArtifacts({
    outDir,
    buildRoot: runtime.buildRoot,
    mode: 'records',
    state,
    postings,
    postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    dictSummary: runtime.dictSummary,
    timing,
    root: runtime.root,
    userConfig: runtime.userConfig,
    incrementalEnabled: runtime.incrementalEnabled === true,
    fileCounts: { candidates: recordSources.length },
    indexState,
    repoProvenance: runtime.repoProvenance
  });
  await pruneIncrementalManifest({
    enabled: incrementalState.enabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });
}

async function loadRecordJson(recordsDir, mdPath, signal = null) {
  const base = path.basename(mdPath, '.md');
  const dir = path.dirname(mdPath);
  const jsonPath = path.join(dir, `${base}.json`);
  try {
    const source = await readVerifiedContainedFile(recordsDir, jsonPath, { maxBytes: 16 * 1024 * 1024, signal });
    const raw = source.buffer.toString('utf8');
    const record = JSON.parse(raw);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Invalid canonical record sidecar: ${jsonPath}`);
    return record;
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'record-sidecar-source' });
    if (diagnostic.code === 'ENOENT') return null;
    if (error?.name === 'AbortError') throw error;
    throw new Error(`Cannot establish record sidecar identity: ${jsonPath}`, { cause: error });
  }
}

function buildDocMeta(record, triageConfig, recordMeta = null) {
  const docmeta = {};
  const meta = recordMeta && typeof recordMeta === 'object' ? recordMeta : null;
  const mergedRecord = record && meta ? { ...meta, ...record } : (record || meta);
  if (mergedRecord) {
    docmeta.record = promoteRecordFields(mergedRecord, triageConfig.promoteFields);
    const summary = mergedRecord.vuln?.title
      || mergedRecord.vuln?.description
      || mergedRecord.decision?.justification;
    if (summary) docmeta.doc = String(summary);
  }
  return docmeta;
}

/**
 * Tokenize a records document and derive phrase/chargram side channels.
 * When `sparsePostingsEnabled` is false (vector_only profile), sparse-derived
 * structures are skipped while lexical tokens remain for query-AST matching.
 *
 * @param {string} text
 * @param {Set<string>} dictWords
 * @param {object} dictConfig
 * @param {string} ext
 * @param {object} postingsConfig
 * @param {string} [chargramFieldText='']
 * @param {{ sparsePostingsEnabled?: boolean }} [options]
 * @returns {{ tokens:string[], seq:string[], ngrams:string[]|null, chargrams:string[]|null }}
 */
function tokenizeRecord(
  text,
  dictWords,
  dictConfig,
  ext,
  postingsConfig,
  chargramFieldText = '',
  { sparsePostingsEnabled = true } = {}
) {
  const { tokens, seq } = buildRecordSeq(text, dictWords, dictConfig, ext);
  const phraseEnabled = sparsePostingsEnabled && postingsConfig?.enablePhraseNgrams !== false;
  const chargramEnabled = sparsePostingsEnabled && postingsConfig?.enableChargrams !== false;
  const chargramSource = typeof postingsConfig?.chargramSource === 'string'
    ? postingsConfig.chargramSource.trim().toLowerCase()
    : 'fields';
  const chargramMaxTokenLength = postingsConfig?.chargramMaxTokenLength == null
    ? null
    : Math.max(2, Math.floor(Number(postingsConfig.chargramMaxTokenLength)));
  const ngrams = phraseEnabled ? extractNgrams(seq, postingsConfig.phraseMinN, postingsConfig.phraseMaxN) : null;
  let chargrams = null;
  if (chargramEnabled) {
    const charSet = new Set();
    const sourceTokens = chargramSource === 'fields' && chargramFieldText
      ? buildRecordSeq(chargramFieldText, dictWords, dictConfig, ext).seq
      : seq;
    sourceTokens.forEach((w) => {
      if (chargramMaxTokenLength && w.length > chargramMaxTokenLength) return;
      forEachRollingChargramHash(
        w,
        postingsConfig.chargramMinN,
        postingsConfig.chargramMaxN,
        { maxTokenLength: chargramMaxTokenLength },
        (g) => {
          charSet.add(g);
          return true;
        }
      );
    });
    chargrams = Array.from(charSet);
  }

  return {
    tokens,
    seq,
    ngrams,
    chargrams
  };
}

function buildRecordSeq(text, dictWords, dictConfig, ext) {
  const scoringText = text.normalize('NFKD');
  let tokens = splitId(scoringText);

  if (ext !== '.md') {
    tokens = tokens.flatMap((t) => splitWordsWithDict(t, dictWords, dictConfig));
  }

  tokens = tokens.filter((w) => !STOP.has(w));
  tokens = tokens.flatMap((w) => [w, stem(w)]);

  const seq = [];
  for (const w of tokens) {
    seq.push(w);
    if (SYN[w]) seq.push(SYN[w]);
  }
  return { tokens, seq };
}

function computeTokenStats(tokens) {
  const freq = {};
  tokens.forEach((t) => {
    freq[t] = (freq[t] || 0) + 1;
  });
  const unique = Object.keys(freq).length;
  const counts = Object.values(freq);
  const sum = counts.reduce((a, b) => a + b, 0);
  const entropy = sum
    ? -counts.reduce((e, c) => e + (c / sum) * Math.log2(c / sum), 0)
    : 0;
  return { unique, entropy, sum };
}


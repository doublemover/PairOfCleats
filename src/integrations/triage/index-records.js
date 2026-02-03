import fs from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, getTriageConfig } from '../../../tools/dict-utils.js';
import { SimpleMinHash } from '../../index/minhash.js';
import { getHeadline } from '../../index/headline.js';
import { STOP, SYN } from '../../index/constants.js';
import { createIndexState, appendChunk } from '../../index/build/state.js';
import { buildPostings } from '../../index/build/postings.js';
import { writeIndexArtifacts } from '../../index/build/artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { buildChunkId } from '../../index/chunk-id.js';
import { assignChunkUids } from '../../index/identity/chunk-uid.js';
import { getLanguageForFile } from '../../index/language-registry.js';
import { toPosix } from '../../shared/files.js';
import { extractNgrams, splitId, splitWordsWithDict, stem, tri } from '../../shared/tokenize.js';
import { log, showProgress } from '../../shared/progress.js';
import { throwIfAborted } from '../../shared/abort.js';
import { promoteRecordFields } from './record-utils.js';

/**
 * Build the records index for a repo.
 * @param {{runtime:object,discovery?:{entries:Array}}} input
 * @returns {Promise<void>}
 */
export async function buildRecordsIndexForRepo({ runtime, discovery = null, abortSignal = null }) {
  throwIfAborted(abortSignal);
  const triageConfig = getTriageConfig(runtime.root, runtime.userConfig);
  const recordsDir = triageConfig.recordsDir;
  const outDir = getIndexDir(runtime.root, 'records', runtime.userConfig, { indexRoot: runtime.buildRoot });
  const postingsConfig = runtime.postingsConfig;
  await fs.mkdir(outDir, { recursive: true });

  log('\n📄  Scanning records ...');
  const timing = { start: Date.now() };

  const state = createIndexState();
  const recordSources = [];
  const seenAbs = new Set();
  const discoveredEntries = Array.isArray(discovery?.entries) ? discovery.entries : [];
  for (const entry of discoveredEntries) {
    throwIfAborted(abortSignal);
    if (!entry?.abs || entry.skip || !entry.record) continue;
    if (seenAbs.has(entry.abs)) continue;
    seenAbs.add(entry.abs);
    recordSources.push({
      absPath: entry.abs,
      relPath: entry.rel || toPosix(path.relative(runtime.root, entry.abs)),
      recordMeta: entry.record,
      source: entry.record?.source || 'repo'
    });
  }
  const triageFiles = await listMarkdownFiles(recordsDir);
  triageFiles.sort();
  for (const absPath of triageFiles) {
    throwIfAborted(abortSignal);
    if (seenAbs.has(absPath)) continue;
    seenAbs.add(absPath);
    recordSources.push({
      absPath,
      relPath: toPosix(path.relative(recordsDir, absPath)),
      recordMeta: { source: 'triage', recordType: 'record', reason: 'records-dir' },
      source: 'triage'
    });
  }

  recordSources.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  log(`→ Found ${recordSources.length} record(s).`);

  let processed = 0;
  const progressMeta = { stage: 'records', mode: 'records' };
  for (const recordEntry of recordSources) {
    throwIfAborted(abortSignal);
    const started = Date.now();
    const absPath = recordEntry.absPath;
    const relPath = recordEntry.relPath;
    let text;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    if (!text) continue;
    text = text.normalize('NFKD');

    const isTriage = recordEntry.source === 'triage'
      && recordsDir
      && isPathUnderDir(recordsDir, absPath);
    const record = isTriage ? await loadRecordJson(recordsDir, absPath) : null;
    const docmeta = buildDocMeta(record, triageConfig, recordEntry.recordMeta);
    const recordName = record?.vuln?.vulnId
      || record?.recordId
      || path.basename(relPath, path.extname(relPath));

    const recordExt = path.extname(absPath) || '.txt';
    const tokenPayload = tokenizeRecord(
      text,
      runtime.dictWords,
      runtime.dictConfig,
      recordExt,
      postingsConfig,
      [recordName, docmeta.doc || ''].filter(Boolean).join(' ')
    );
    if (!tokenPayload.tokens.length) continue;

    const stats = computeTokenStats(tokenPayload.tokens);
    const fieldTokens = postingsConfig?.fielded !== false ? {
      name: recordName ? buildRecordSeq(recordName, runtime.dictWords, runtime.dictConfig, recordExt).tokens : [],
      signature: [],
      doc: docmeta.doc ? buildRecordSeq(docmeta.doc, runtime.dictWords, runtime.dictConfig, recordExt).tokens : [],
      comment: [],
      body: tokenPayload.tokens
    } : null;
    const embedText = docmeta.doc || text;
    const embedding = await runtime.getChunkEmbedding(embedText);

    const mh = new SimpleMinHash();
    tokenPayload.tokens.forEach((t) => mh.update(t));

    const lines = text.split(/\r?\n/);
    const startLine = 1;
    const endLine = lines.length;

    const recordFile = isTriage ? `triage/records/${relPath}` : relPath;
    const recordLang = getLanguageForFile(recordExt, recordFile);
    const effectiveLanguageId = recordLang?.id || 'unknown';
    const chunkPayload = {
      file: recordFile,
      ext: recordExt,
      lang: effectiveLanguageId,
      containerLanguageId: recordLang?.id || null,
      start: 0,
      end: text.length,
      startLine,
      endLine,
      kind: 'Record',
      name: recordName,
      tokens: tokenPayload.tokens,
      seq: tokenPayload.seq,
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
      minhashSig: mh.hashValues,
      weight: 1,
      externalDocs: [],
      ...(fieldTokens ? { fieldTokens } : {})
    };
    chunkPayload.chunkId = buildChunkId(chunkPayload);
    await assignChunkUids({
      chunks: [chunkPayload],
      fileText: text,
      fileRelPath: recordFile,
      namespaceKey: 'repo',
      strict: true,
      log
    });

    appendChunk(state, chunkPayload, postingsConfig);
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
    triPost: state.triPost,
    postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log,
    workerPool: runtime.workerPool,
    embeddingsEnabled: runtime.embeddingEnabled
  });

  const indexState = {
    generatedAt: new Date().toISOString(),
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey: runtime.compatibilityKey || null,
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
      : { enabled: false }
  };

  throwIfAborted(abortSignal);
  await writeIndexArtifacts({
    outDir,
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
    incrementalEnabled: false,
    fileCounts: { candidates: recordSources.length },
    indexState,
    repoProvenance: runtime.repoProvenance
  });
}

const isPathUnderDir = (baseDir, targetPath) => {
  if (!baseDir || !targetPath) return false;
  const rel = path.relative(baseDir, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

async function listMarkdownFiles(rootDir) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(fullPath);
        files.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function loadRecordJson(recordsDir, mdPath) {
  const base = path.basename(mdPath, '.md');
  const dir = path.dirname(mdPath);
  const jsonPath = path.join(dir, `${base}.json`);
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
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

function tokenizeRecord(text, dictWords, dictConfig, ext, postingsConfig, chargramFieldText = '') {
  const { tokens, seq } = buildRecordSeq(text, dictWords, dictConfig, ext);
  const phraseEnabled = postingsConfig?.enablePhraseNgrams !== false;
  const chargramEnabled = postingsConfig?.enableChargrams !== false;
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
      for (let n = postingsConfig.chargramMinN; n <= postingsConfig.chargramMaxN; ++n) tri(w, n).forEach((g) => charSet.add(g));
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
  let tokens = splitId(text);
  tokens = tokens.map((t) => t.normalize('NFKD'));

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


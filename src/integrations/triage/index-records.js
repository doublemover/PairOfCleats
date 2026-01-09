import fs from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, getTriageConfig } from '../../../tools/dict-utils.js';
import { SimpleMinHash } from '../../index/minhash.js';
import { getHeadline } from '../../index/headline.js';
import { STOP, SYN } from '../../index/constants.js';
import { createIndexState, appendChunk } from '../../index/build/state.js';
import { buildPostings } from '../../index/build/postings.js';
import { writeIndexArtifacts } from '../../index/build/artifacts.js';
import { extractNgrams, splitId, splitWordsWithDict, stem, tri } from '../../shared/tokenize.js';
import { log, showProgress } from '../../shared/progress.js';
import { promoteRecordFields } from './record-utils.js';

/**
 * Build the records index for a repo.
 * @param {{runtime:object}} input
 * @returns {Promise<void>}
 */
export async function buildRecordsIndexForRepo({ runtime }) {
  const triageConfig = getTriageConfig(runtime.root, runtime.userConfig);
  const recordsDir = triageConfig.recordsDir;
  const outDir = getIndexDir(runtime.root, 'records', runtime.userConfig, { indexRoot: runtime.buildRoot });
  const postingsConfig = runtime.postingsConfig;
  await fs.mkdir(outDir, { recursive: true });

  log('\n📄  Scanning records …');
  const timing = { start: Date.now() };

  const state = createIndexState();
  const recordFiles = await listMarkdownFiles(recordsDir);
  recordFiles.sort();
  log(`→ Found ${recordFiles.length} record(s).`);

  let processed = 0;
  for (const absPath of recordFiles) {
    const started = Date.now();
    const relPath = toPosix(path.relative(recordsDir, absPath));
    let text;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      continue;
    }
    if (!text) continue;
    text = text.normalize('NFKD');

    const record = await loadRecordJson(recordsDir, absPath);
    const docmeta = buildDocMeta(record, triageConfig);

    const tokenPayload = tokenizeRecord(
      text,
      runtime.dictWords,
      runtime.dictConfig,
      '.md',
      postingsConfig,
      [record?.vuln?.vulnId || record?.recordId || '', docmeta.doc || ''].filter(Boolean).join(' ')
    );
    if (!tokenPayload.tokens.length) continue;

    const stats = computeTokenStats(tokenPayload.tokens);
    const embedText = docmeta.doc || text;
    const embedding = await runtime.getChunkEmbedding(embedText);

    const mh = new SimpleMinHash();
    tokenPayload.tokens.forEach((t) => mh.update(t));

    const lines = text.split(/\r?\n/);
    const startLine = 1;
    const endLine = lines.length;

    const chunkPayload = {
      file: `triage/records/${relPath}`,
      ext: '.md',
      start: 0,
      end: text.length,
      startLine,
      endLine,
      kind: 'Record',
      name: record?.vuln?.vulnId || record?.recordId || path.basename(relPath, '.md'),
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
      externalDocs: []
    };

    appendChunk(state, chunkPayload, postingsConfig);
    state.scannedFiles.push(relPath);
    state.scannedFilesTimes.push({
      file: relPath,
      duration_ms: Date.now() - started,
      cached: false
    });
    processed += 1;
    showProgress('Records', processed, recordFiles.length);
  }
  showProgress('Records', recordFiles.length, recordFiles.length);

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log,
    workerPool: runtime.workerPool
  });

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
    fileCounts: { candidates: recordFiles.length }
  });
}

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

function buildDocMeta(record, triageConfig) {
  const docmeta = {};
  if (record) {
    docmeta.record = promoteRecordFields(record, triageConfig.promoteFields);
    const summary = record.vuln?.title || record.vuln?.description || record.decision?.justification;
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

function toPosix(value) {
  return value.split(path.sep).join('/');
}

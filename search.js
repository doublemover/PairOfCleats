#!/usr/bin/env node
/**
 * Ultra-Complete Search Utility for Rich Semantic Index (Pretty Output)
 * By: ChatGPT & Nick, 2025
 *   [--calls function]  Filter for call relationships (calls to/from function)
 *   [--uses ident]      Filter for usage of identifier
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import Minhash from 'minhash';
import { getDictionaryPaths, getDictConfig, getIndexDir, getMetricsDir, loadUserConfig } from './tools/dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'human', 'stats', 'ann', 'headline', 'lint', 'churn', 'matched'],
  alias: { n: 'top', c: 'context', t: 'type' },
  default: { n: 5, context: 3 },
  string: ['calls', 'uses', 'signature', 'param', 'mode', 'backend', 'db'],
});
const t0 = Date.now();
const ROOT = process.cwd();
const userConfig = loadUserConfig(ROOT);
const sqliteConfig = userConfig.sqlite || {};
const metricsDir = getMetricsDir(ROOT, userConfig);
const rawArgs = process.argv.slice(2);
const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search "query" [--json|--human|--stats|--ann|--no-ann|--context N|--type T|...]|--mode');
  process.exit(1);
}
const contextLines = Math.max(0, parseInt(argv.context, 10) || 0);
const searchType = argv.type || null;
const searchAuthor = argv.author || null;
const searchCall = argv.calls || null;
const searchImport = argv.import || null;
const searchMode = argv.mode || "both";
const sqliteDbPath = argv.db
  ? path.resolve(argv.db)
  : (sqliteConfig.dbPath ? path.resolve(sqliteConfig.dbPath) : path.join(ROOT, 'index-sqlite', 'index.db'));
const backendArg = typeof argv.backend === 'string' ? argv.backend.toLowerCase() : '';
const backendForcedSqlite = backendArg === 'sqlite';
const backendDisabled = backendArg && backendArg !== 'sqlite';
const sqliteConfigured = sqliteConfig.use === true;
const sqliteAvailable = fsSync.existsSync(sqliteDbPath);
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');
const annDefault = userConfig.search?.annDefault === true;
const annEnabled = annFlagPresent ? argv.ann : annDefault;

if (backendForcedSqlite && !sqliteAvailable) {
  console.error(`SQLite backend requested but index not found (${sqliteDbPath}).`);
  process.exit(1);
}

let useSqlite = (backendForcedSqlite || (!backendDisabled && sqliteConfigured)) && sqliteAvailable;
const CODE_OFFSET = 0;
const PROSE_OFFSET = 1000000000;

let db = null;
if (useSqlite) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    console.error('better-sqlite3 is required for the SQLite backend. Run npm install first.');
    process.exit(1);
  }
  db = new Database(sqliteDbPath, { readonly: true });
  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = new Set(tableRows.map((row) => row.name));
  const requiredTables = [
    'chunks',
    'token_vocab',
    'token_postings',
    'doc_lengths',
    'phrase_vocab',
    'phrase_postings',
    'chargram_vocab',
    'chargram_postings',
    'minhash_signatures',
    'dense_vectors',
    'dense_meta'
  ];
  const missing = requiredTables.filter((name) => !tableNames.has(name));
  if (missing.length) {
    if (backendForcedSqlite) {
      console.error(`SQLite index is missing required tables (${missing.join(', ')}). Rebuild with npm run build-sqlite-index.`);
      process.exit(1);
    }
    console.warn(`SQLite index is missing required tables (${missing.join(', ')}); falling back to file-backed indexes.`);
    db.close();
    db = null;
    useSqlite = false;
  }
}

const backendLabel = useSqlite ? 'sqlite' : 'memory';

const stemmer = Snowball.newStemmer('english');
const stem = (w) => stemmer.stem(w);
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const splitId = (s) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2')        // split camelCase
    .replace(/[_\-]+/g, ' ')                   // split on _ and -
    .split(/[^a-zA-Z0-9]+/u)                   // split non-alphanum
    .flatMap(tok => tok.split(/(?<=.)(?=[A-Z])/)) // split merged camel even if lowercase input
    .map(t => t.toLowerCase())
    .filter(Boolean);

const dictConfig = getDictConfig(ROOT, userConfig);
const dictionaryPaths = await getDictionaryPaths(ROOT, dictConfig);
const dict = new Set();
for (const dictFile of dictionaryPaths) {
  try {
    const contents = fsSync.readFileSync(dictFile, 'utf8');
    contents
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .forEach((w) => dict.add(w));
  } catch {}
}

const color = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  magenta: (t) => `\x1b[35m${t}\x1b[0m`,
  blue: (t) => `\x1b[34m${t}\x1b[0m`,
  gray: (t) => `\x1b[90m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  underline: (t) => `\x1b[4m${t}\x1b[0m`
};

// --- LOAD INDEX ---
function loadIndex(dir) {
  const chunkMeta = JSON.parse(fsSync.readFileSync(path.join(dir, 'chunk_meta.json'), 'utf8'));
  const idx = {
    chunkMeta,
    denseVec: JSON.parse(fsSync.readFileSync(path.join(dir, 'dense_vectors_uint8.json'), 'utf8')),
    minhash: JSON.parse(fsSync.readFileSync(path.join(dir, 'minhash_signatures.json'), 'utf8')),
    phraseNgrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'phrase_ngrams.json'), 'utf8')),
    chargrams: JSON.parse(fsSync.readFileSync(path.join(dir, 'chargram_postings.json'), 'utf8'))
  };
  try {
    idx.tokenIndex = JSON.parse(fsSync.readFileSync(path.join(dir, 'token_postings.json'), 'utf8'));
  } catch {}
  return idx;
}
function resolveIndexDir(mode) {
  const cached = getIndexDir(ROOT, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  if (fsSync.existsSync(cachedMeta)) return cached;
  const local = path.join(ROOT, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  if (fsSync.existsSync(localMeta)) return local;
  return cached;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
  }
  return value;
}

function parseArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed, []);
      return Array.isArray(parsed) ? parsed : [];
    }
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return [];
}

function unpackUint32(buffer) {
  if (!buffer) return [];
  const view = new Uint32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
  return Array.from(view);
}

function loadIndexFromSqlite(mode) {
  if (!db) throw new Error('SQLite backend requested but database is not available.');
  const offset = mode === 'prose' ? PROSE_OFFSET : CODE_OFFSET;
  const chunkRows = db.prepare('SELECT * FROM chunks WHERE mode = ? ORDER BY id').all(mode);
  let maxLocalId = -1;
  for (const row of chunkRows) {
    const localId = row.id - offset;
    if (localId > maxLocalId) maxLocalId = localId;
  }

  const chunkMeta = maxLocalId >= 0 ? Array.from({ length: maxLocalId + 1 }) : [];
  for (const row of chunkRows) {
    const localId = row.id - offset;
    chunkMeta[localId] = {
      id: localId,
      file: row.file,
      start: row.start,
      end: row.end,
      startLine: row.startLine,
      endLine: row.endLine,
      ext: row.ext,
      kind: row.kind,
      name: row.name,
      weight: typeof row.weight === 'number' ? row.weight : 1,
      headline: row.headline,
      preContext: parseJson(row.preContext, []),
      postContext: parseJson(row.postContext, []),
      tokens: parseArrayField(row.tokens),
      ngrams: parseJson(row.ngrams, []),
      codeRelations: parseJson(row.codeRelations, null),
      docmeta: parseJson(row.docmeta, null),
      stats: parseJson(row.stats, null),
      complexity: parseJson(row.complexity, null),
      lint: parseJson(row.lint, null),
      externalDocs: parseJson(row.externalDocs, null),
      last_modified: row.last_modified,
      last_author: row.last_author,
      churn: row.churn,
      chunk_authors: parseJson(row.chunk_authors, null)
    };
  }

  const vocabRows = db.prepare('SELECT token_id, token FROM token_vocab WHERE mode = ? ORDER BY token_id').all(mode);
  const vocab = [];
  for (const row of vocabRows) {
    vocab[row.token_id] = row.token;
  }

  const postings = Array.from({ length: vocab.length }, () => []);
  const postingStmt = db.prepare('SELECT token_id, doc_id, tf FROM token_postings WHERE mode = ? ORDER BY token_id, doc_id');
  for (const row of postingStmt.iterate(mode)) {
    postings[row.token_id].push([row.doc_id, row.tf]);
  }

  const docLengths = Array.from({ length: chunkMeta.length }, () => 0);
  const lengthRows = db.prepare('SELECT doc_id, len FROM doc_lengths WHERE mode = ?').all(mode);
  for (const row of lengthRows) {
    docLengths[row.doc_id] = row.len;
  }

  const statsRow = db.prepare('SELECT avg_doc_len, total_docs FROM token_stats WHERE mode = ?').get(mode) || {};
  const tokenIndex = vocab.length ? {
    vocab,
    postings,
    docLengths,
    avgDocLen: typeof statsRow.avg_doc_len === 'number' ? statsRow.avg_doc_len : null,
    totalDocs: typeof statsRow.total_docs === 'number' ? statsRow.total_docs : docLengths.length
  } : null;

  const phraseVocabRows = db.prepare('SELECT phrase_id, ngram FROM phrase_vocab WHERE mode = ? ORDER BY phrase_id').all(mode);
  const phraseVocab = [];
  for (const row of phraseVocabRows) {
    phraseVocab[row.phrase_id] = row.ngram;
  }
  const phrasePostings = Array.from({ length: phraseVocab.length }, () => []);
  const phraseStmt = db.prepare('SELECT phrase_id, doc_id FROM phrase_postings WHERE mode = ? ORDER BY phrase_id, doc_id');
  for (const row of phraseStmt.iterate(mode)) {
    phrasePostings[row.phrase_id].push(row.doc_id);
  }
  const phraseNgrams = phraseVocab.length ? { vocab: phraseVocab, postings: phrasePostings } : null;

  const gramVocabRows = db.prepare('SELECT gram_id, gram FROM chargram_vocab WHERE mode = ? ORDER BY gram_id').all(mode);
  const chargramVocab = [];
  for (const row of gramVocabRows) {
    chargramVocab[row.gram_id] = row.gram;
  }
  const chargramPostings = Array.from({ length: chargramVocab.length }, () => []);
  const gramStmt = db.prepare('SELECT gram_id, doc_id FROM chargram_postings WHERE mode = ? ORDER BY gram_id, doc_id');
  for (const row of gramStmt.iterate(mode)) {
    chargramPostings[row.gram_id].push(row.doc_id);
  }
  const chargrams = chargramVocab.length ? { vocab: chargramVocab, postings: chargramPostings } : null;

  const signatures = Array.from({ length: chunkMeta.length });
  const sigStmt = db.prepare('SELECT doc_id, sig FROM minhash_signatures WHERE mode = ? ORDER BY doc_id');
  for (const row of sigStmt.iterate(mode)) {
    signatures[row.doc_id] = unpackUint32(row.sig);
  }
  const minhash = signatures.length ? { signatures } : null;

  const denseMeta = db.prepare('SELECT dims, scale FROM dense_meta WHERE mode = ?').get(mode) || {};
  const vectors = Array.from({ length: chunkMeta.length });
  const denseStmt = db.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id');
  for (const row of denseStmt.iterate(mode)) {
    vectors[row.doc_id] = row.vector;
  }
  const fallbackVec = vectors.find((vec) => vec && vec.length);
  const denseVec = vectors.length ? {
    dims: denseMeta.dims || (fallbackVec ? fallbackVec.length : 0),
    scale: typeof denseMeta.scale === 'number' ? denseMeta.scale : 1.0,
    vectors
  } : null;

  return {
    chunkMeta,
    denseVec,
    minhash,
    phraseNgrams,
    chargrams,
    tokenIndex
  };
}

const idxProse = useSqlite ? loadIndexFromSqlite('prose') : loadIndex(resolveIndexDir('prose'));
const idxCode = useSqlite ? loadIndexFromSqlite('code') : loadIndex(resolveIndexDir('code'));

// --- QUERY TOKENIZATION ---
function splitWordsWithDict(token, dict) {
  if (!dict || dict.size === 0) return [token];
  const result = [];
  let i = 0;
  while (i < token.length) {
    let found = false;
    for (let j = token.length; j > i; j--) {
      const sub = token.slice(i, j);
      if (dict.has(sub)) {
        result.push(sub);
        i = j;
        found = true;
        break;
      }
    }
    if (!found) {
      // fallback: add single char to avoid infinite loop
      result.push(token[i]);
      i++;
    }
  }
  return result;
}


let queryTokens = splitId(query);

queryTokens = queryTokens.flatMap(tok => {
  if (tok.length <= 3 || dict.has(tok)) return [tok];
  return splitWordsWithDict(tok, dict);
});

const rx = queryTokens.length ? new RegExp(`(${queryTokens.join('|')})`, 'ig') : null;

// --- SEARCH BM25 TOKENS/PHRASES ---
function rankBM25Legacy(idx, tokens, topN) {
  const scores = new Map();
  const ids = idx.chunkMeta.map((_, i) => i);
  ids.forEach((i) => {
    const chunk = idx.chunkMeta[i];
    if (!chunk) return;
    let score = 0;
    tokens.forEach(tok => {
      if (chunk.tokens && chunk.tokens.includes(tok)) score += 1 * (chunk.weight || 1);
      if (chunk.ngrams && chunk.ngrams.includes(tok)) score += 2 * (chunk.weight || 1);
      if (chunk.headline && chunk.headline.includes(tok)) score += 3 * (chunk.weight || 1);
    });
    scores.set(i, score);
  });
  return [...scores.entries()]
    .filter(([i, s]) => s > 0)
    .map(([i, s]) => ({ idx: i, score: s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function getTokenIndex(idx) {
  const tokenIndex = idx.tokenIndex;
  if (!tokenIndex || !tokenIndex.vocab || !tokenIndex.postings) return null;
  if (!tokenIndex.vocabIndex) {
    tokenIndex.vocabIndex = new Map(tokenIndex.vocab.map((t, i) => [t, i]));
  }
  if (!Array.isArray(tokenIndex.docLengths)) tokenIndex.docLengths = [];
  if (!tokenIndex.totalDocs) tokenIndex.totalDocs = tokenIndex.docLengths.length;
  if (!tokenIndex.avgDocLen) {
    const total = tokenIndex.docLengths.reduce((sum, len) => sum + len, 0);
    tokenIndex.avgDocLen = tokenIndex.docLengths.length ? total / tokenIndex.docLengths.length : 0;
  }
  return tokenIndex;
}

function rankBM25(idx, tokens, topN) {
  const tokenIndex = getTokenIndex(idx);
  if (!tokenIndex) return rankBM25Legacy(idx, tokens, topN);

  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map();
  const docLengths = tokenIndex.docLengths;
  const avgDocLen = tokenIndex.avgDocLen || 1;
  const totalDocs = tokenIndex.totalDocs || idx.chunkMeta.length || 1;

  const qtf = new Map();
  tokens.forEach((tok) => qtf.set(tok, (qtf.get(tok) || 0) + 1));

  for (const [tok, qCount] of qtf.entries()) {
    const tokIdx = tokenIndex.vocabIndex.get(tok);
    if (tokIdx === undefined) continue;
    const posting = tokenIndex.postings[tokIdx] || [];
    const df = posting.length;
    if (!df) continue;
    const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

    for (const [docId, tf] of posting) {
      const dl = docLengths[docId] || 0;
      const denom = tf + k1 * (1 - b + b * (dl / avgDocLen));
      const score = idf * ((tf * (k1 + 1)) / denom) * qCount;
      scores.set(docId, (scores.get(docId) || 0) + score);
    }
  }

  const weighted = [...scores.entries()].map(([docId, score]) => {
    const weight = idx.chunkMeta[docId]?.weight || 1;
    return { idx: docId, score: score * weight };
  });

  return weighted
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// --- SEARCH MINHASH ANN (for semantic embedding search) ---
function minhashSigForTokens(tokens) {
  const mh = new Minhash();
  tokens.forEach(t => mh.update(t));
  return mh.hashvalues;
}
function jaccard(sigA, sigB) {
  let match = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) match++;
  return match / sigA.length;
}
function rankMinhash(idx, tokens, topN) {
  if (!idx.minhash?.signatures?.length) return [];
  const qSig = minhashSigForTokens(tokens);
  const scored = idx.minhash.signatures
    .map((sig, i) => ({ idx: i, sim: jaccard(qSig, sig) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN);
  return scored;
}

function rankDenseVectors(idx, queryEmbedding, topN, candidateSet) {
  const vectors = idx.denseVec?.vectors;
  if (!queryEmbedding || !Array.isArray(vectors) || !vectors.length) return [];
  const dims = idx.denseVec?.dims || queryEmbedding.length;
  const levels = 256;
  const minVal = -1;
  const maxVal = 1;
  const scale = (maxVal - minVal) / (levels - 1);
  const ids = candidateSet ? Array.from(candidateSet) : vectors.map((_, i) => i);
  const scored = [];

  for (const id of ids) {
    const vec = vectors[id];
    if (!Array.isArray(vec) || vec.length !== dims) continue;
    let dot = 0;
    for (let i = 0; i < dims; i++) {
      const v = vec[i] * scale + minVal;
      dot += v * queryEmbedding[i];
    }
    scored.push({ idx: id, sim: dot });
  }

  return scored.sort((a, b) => b.sim - a.sim).slice(0, topN);
}

function extractNgrams(tokens, nStart = 2, nEnd = 4) {
  const grams = [];
  for (let n = nStart; n <= nEnd; ++n) {
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join('_'));
    }
  }
  return grams;
}

function tri(w, n = 3) {
  const s = `⟬${w}⟭`;
  const g = [];
  for (let i = 0; i <= s.length - n; i++) {
    g.push(s.slice(i, i + n));
  }
  return g;
}

function buildCandidateSet(idx, tokens) {
  const candidates = new Set();
  let matched = false;

  if (idx.phraseNgrams?.vocab && idx.phraseNgrams?.postings) {
    const vocabIndex = new Map(idx.phraseNgrams.vocab.map((t, i) => [t, i]));
    const ngrams = extractNgrams(tokens, 2, 4);
    for (const ng of ngrams) {
      const hit = vocabIndex.get(ng);
      if (hit === undefined) continue;
      const posting = idx.phraseNgrams.postings[hit] || [];
      posting.forEach((id) => candidates.add(id));
      matched = matched || posting.length > 0;
    }
  }

  if (idx.chargrams?.vocab && idx.chargrams?.postings) {
    const vocabIndex = new Map(idx.chargrams.vocab.map((t, i) => [t, i]));
    for (const token of tokens) {
      for (let n = 3; n <= 5; n++) {
        for (const gram of tri(token, n)) {
          const hit = vocabIndex.get(gram);
          if (hit === undefined) continue;
          const posting = idx.chargrams.postings[hit] || [];
          posting.forEach((id) => candidates.add(id));
          matched = matched || posting.length > 0;
        }
      }
    }
  }

  return matched ? candidates : null;
}

async function getQueryEmbedding(text) {
  try {
    const { pipeline } = await import('@xenova/transformers');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L12-v2');
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch {
    return null;
  }
}

// --- ADVANCED FILTERING ---
function filterChunks(meta, opts = {}) {
  return meta.filter(c => {
    if (opts.type && c.kind && c.kind.toLowerCase() !== opts.type.toLowerCase()) return false;
    if (opts.author && c.last_author && !c.last_author.toLowerCase().includes(opts.author.toLowerCase())) return false;
    if (opts.call && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => call === opts.call || fn === opts.call);
      if (!found) return false;
    }
    if (opts.import && c.codeRelations && c.codeRelations.imports) {
      if (!c.codeRelations.imports.includes(opts.import)) return false;
    }
    if (opts.lint && (!c.lint || !c.lint.length)) return false;
    if (opts.churn && (!c.churn || c.churn < opts.churn)) return false;
    if (argv.calls && c.codeRelations && c.codeRelations.calls) {
      const found = c.codeRelations.calls.find(([fn, call]) => fn === argv.calls || call === argv.calls);
      if (!found) return false;
    }
    if (argv.uses && c.codeRelations && c.codeRelations.usages) {
      if (!c.codeRelations.usages.includes(argv.uses)) return false;
    }
    if (argv.signature && c.docmeta?.signature) {
      if (!c.docmeta.signature.includes(argv.signature)) return false;
    }
    if (argv.param && c.docmeta?.params) {
      if (!c.docmeta.params.includes(argv.param)) return false;
    }
    return true;
  });
}

function cleanContext(lines) {
  return lines
    .filter(l => {
      const t = l.trim();
      if (!t || t === '```') return false;
      // Skip lines where there is no alphanumeric content
      if (!/[a-zA-Z0-9]/.test(t)) return false;
      return true;
    })
    .map(l => l.replace(/\s+/g, ' ').trim()); // <— normalize whitespace here
}


// --- FORMAT OUTPUT ---
function getBodySummary(h, maxWords = 80) {
  try {
    const absPath = path.join(ROOT, h.file);
    const text = fsSync.readFileSync(absPath, 'utf8');
    const chunkText = text.slice(h.start, h.end)
      .replace(/\s+/g, ' ') // normalize spaces
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

let lastCount = 0;
function printFullChunk(chunk, idx, mode, annScore, annType = 'bm25') {
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    c.green(`${annScore.toFixed(2)}`),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author && chunk.last_author !== '2xmvr')
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';

  if (chunk.imports?.length)
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  else if (chunk.codeRelations?.imports?.length)
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';

  if (chunk.exports?.length)
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  else if (chunk.codeRelations?.exports?.length)
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';

  if (chunk.codeRelations?.calls?.length)
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}→${b}`).join(', ') + '\n';

  if (chunk.codeRelations?.importLinks?.length)
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';

  // Usages
  if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach(uRaw => {
      const u = typeof uRaw === 'string' ? uRaw.trim() : '';
      if (!u) return;
      usageFreq[u] = (usageFreq[u] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([u, count]) => {
      if (count === 1) return u;
      if (count === maxCount) return c.bold(c.yellow(`${u} (${count})`));
      return c.cyan(`${u} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map(t => t.trim()).filter(t => t))];
  if (uniqueTokens.length)
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';

  if (argv.matched) {
    const matchedTokens = queryTokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
  }

  if (chunk.docmeta?.signature)
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';

  if (chunk.lint?.length)
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0,2).map(l => JSON.stringify(l.message)).join(', ') : '') + '\n';

  if (chunk.externalDocs?.length)
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length)
    out += c.gray('   preContext: ') + cleanedPreContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length)
    out += c.gray('   postContext: ') + cleanedPostContext.map(l => c.green(l.trim())).join(' | ') + '\n';

  if (idx === 0) {
    lastCount = 0;
  }
  if (idx < 5) {
    let maxWords = 10;
    let lessPer = 3;
    maxWords -= (lessPer*idx);
    const bodySummary = getBodySummary(chunk, maxWords);
    if (lastCount < maxWords) {
      maxWords = bodySummary.length; 
    }
    lastCount = bodySummary.length;
    out += c.gray('   Summary: ') + `${getBodySummary(chunk, maxWords)}` + '\n';
  }

  out += c.gray(''.padEnd(60, '—')) + '\n';
  return out;
}


function printShortChunk(chunk, idx, mode, annScore, annType = 'bm25') {        
  if (!chunk || !chunk.file) {
    return color.red(`   ${idx + 1}. [Invalid result — missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${idx + 1}. ${chunk.file}`))}`;
  out += color.yellow(` [${annScore.toFixed(2)}]`);
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  if (chunk.last_author && chunk.last_author !== '2xmvr') out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length && rx)
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));

  if (argv.matched) {
    const matchedTokens = queryTokens.filter(tok =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length)
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
  }

  out += '\n';
  return out;
}


// --- MAIN SEARCH PIPELINE ---
function runSearch(idx, mode, queryEmbedding) {
  const meta = idx.chunkMeta;

  // Filtering
  const filteredMeta = filterChunks(meta, {
    type: searchType,
    author: searchAuthor,
    call: searchCall,
    import: searchImport,
    lint: argv.lint,
    churn: argv.churn
  });
  const allowedIdx = new Set(filteredMeta.map(c => c.id));

  // Main search: BM25 token match
  const candidates = buildCandidateSet(idx, queryTokens);
  const bmHits = rankBM25(idx, queryTokens, argv.n * 3);
  // MinHash (embedding) ANN, if requested
  let annHits = [];
  if (annEnabled) {
    if (queryEmbedding && idx.denseVec?.vectors?.length) {
      annHits = rankDenseVectors(idx, queryEmbedding, argv.n * 3, candidates);
    } else {
      annHits = rankMinhash(idx, queryTokens, argv.n * 3);
    }
  }

  // Combine and dedup
  let allHits = new Map();
  bmHits.forEach(h => allHits.set(h.idx, { score: h.score, kind: 'bm25' }));
  annHits.forEach(h => {
    if (!allHits.has(h.idx) || h.sim > allHits.get(h.idx).score)
      allHits.set(h.idx, { score: h.sim, kind: 'ann' });
  });

  // Sort and map to final results
  const ranked = [...allHits.entries()]
    .filter(([idx, _]) => allowedIdx.has(idx))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, argv.n)
    .map(([idxVal, obj]) => {
      const chunk = meta[idxVal];
      return chunk ? { ...chunk, annScore: obj.score, annType: obj.kind } : null;
    })
    .filter(x => x);

  return ranked;
}


// --- MAIN ---
(async () => {
  const queryEmbedding = annEnabled ? await getQueryEmbedding(query) : null;
  const proseHits = runSearch(idxProse, 'prose', queryEmbedding);
  const codeHits = runSearch(idxCode, 'code', queryEmbedding);

  // Output
  if (argv.json) {
    // Full JSON
    console.log(JSON.stringify({
      backend: backendLabel,
      prose: proseHits,
      code: codeHits
    }, null, 2));
    process.exit(0);
  }

  let showProse = argv.n;
  let showCode = argv.n;

  if (proseHits.length < argv.n) {
    showCode += showProse;
  }
  if (codeHits.length < argv.n) {
    showProse += showCode;
  }

  // Human output, enhanced formatting and summaries
  console.log(color.bold(`\n===== 📖 Markdown Results (${backendLabel}) =====`));
  proseHits.slice(0, showProse).forEach((h, i) => {
    if (i < 2) {
      process.stdout.write(printFullChunk(h, i, 'prose', h.annScore, h.annType));
    } else {
      process.stdout.write(printShortChunk(h, i, 'prose', h.annScore, h.annType));
    }
  });
  console.log('\n');

  console.log(color.bold(`===== 🔨 Code Results (${backendLabel}) =====`));
  codeHits.slice(0, showCode).forEach((h, i) => {
    if (i < 1) {
      process.stdout.write(printFullChunk(h, i, 'code', h.annScore, h.annType));
    } else {
      process.stdout.write(printShortChunk(h, i, 'code', h.annScore, h.annType));
    }
  });
  console.log('\n');

  // Optionally stats
  if (argv.stats) {
    console.log(color.gray(`Stats: prose chunks=${idxProse.chunkMeta.length}, code chunks=${idxCode.chunkMeta.length}`));
  }

  /* ---------- Update .repoMetrics and .searchHistory ---------- */
  const metricsPath = path.join(metricsDir, 'metrics.json');
  const historyPath = path.join(metricsDir, 'searchHistory');
  const noResultPath = path.join(metricsDir, 'noResultQueries');
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });

  let metrics = {};
  try {
    metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
  } catch {
    metrics = {};
  }
  const inc = (f, key) => {
    if (!metrics[f]) metrics[f] = { md: 0, code: 0, terms: [] };
    metrics[f][key]++;
    queryTokens.forEach((t) => {
      if (!metrics[f].terms.includes(t)) metrics[f].terms.push(t);
    });
  };
  proseHits.forEach((h) => inc(h.file, 'md'));
  codeHits.forEach((h) => inc(h.file, 'code'));
  await fs.writeFile(metricsPath, JSON.stringify(metrics) + '\n');

  await fs.appendFile(
    historyPath,
    JSON.stringify({
      time: new Date().toISOString(),
      query,
      mdFiles: proseHits.length,
      codeFiles: codeHits.length,
      ms: Date.now() - t0,
    }) + '\n'
  );

  if (proseHits.length === 0 && codeHits.length === 0) {
    await fs.appendFile(
      noResultPath,
      JSON.stringify({ time: new Date().toISOString(), query }) + '\n'
    );
  }
})();

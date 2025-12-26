#!/usr/bin/env node
import path from 'node:path';
import minimist from 'minimist';
import { loadUserConfig } from './dict-utils.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required. Run npm install first.');
  process.exit(1);
}

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'ann'],
  string: ['mode', 'db'],
  alias: { n: 'top' },
  default: { n: 5 }
});

const query = argv._.join(' ').trim();
if (!query) {
  console.error('usage: search-sqlite "query" [--db path] [--mode code|prose] [--ann]');
  process.exit(1);
}

const root = process.cwd();
const userConfig = loadUserConfig(root);
const sqliteConfig = userConfig.sqlite || {};
const dbPath = argv.db
  ? path.resolve(argv.db)
  : (sqliteConfig.dbPath ? path.resolve(sqliteConfig.dbPath) : path.join(root, 'index-sqlite', 'index.db'));
const db = new Database(dbPath, { readonly: true });

function splitId(input) {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/u)
    .flatMap((tok) => tok.split(/(?<=.)(?=[A-Z])/))
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

function buildFtsQuery(tokens) {
  const unique = Array.from(new Set(tokens));
  if (!unique.length) return query;
  return unique.join(' OR ');
}

const queryTokens = splitId(query);
const ftsQuery = buildFtsQuery(queryTokens);
const topN = Math.max(1, parseInt(argv.n, 10) || 5);
const mode = argv.mode || null;

const ftsStmt = db.prepare(
  `SELECT rowid, bm25(chunks_fts) AS score
   FROM chunks_fts
   WHERE chunks_fts MATCH ?
   ${mode ? 'AND mode = ?' : ''}
   ORDER BY score ASC
   LIMIT ?`
);
const ftsRows = mode ? ftsStmt.all(ftsQuery, mode, topN * 3) : ftsStmt.all(ftsQuery, topN * 3);

const chunksStmt = db.prepare('SELECT * FROM chunks WHERE id = ?');
const hits = new Map();

for (const row of ftsRows) {
  const chunk = chunksStmt.get(row.rowid);
  if (!chunk) continue;
  const score = -row.score;
  hits.set(row.rowid, { chunk, score, kind: 'bm25' });
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

function loadDenseVectorsFromDb(mode) {
  const meta = db.prepare('SELECT dims, scale FROM dense_meta WHERE mode = ?').get(mode) || {};
  const vectors = [];
  const rows = db.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id').all(mode);
  for (const row of rows) {
    vectors[row.doc_id] = row.vector;
  }
  const fallbackVec = vectors.find((vec) => vec && vec.length);
  return {
    dims: meta.dims || (fallbackVec ? fallbackVec.length : 0),
    scale: typeof meta.scale === 'number' ? meta.scale : 1.0,
    vectors
  };
}

const CODE_OFFSET = 0;
const PROSE_OFFSET = 1000000000;
const denseCode = loadDenseVectorsFromDb('code');
const denseProse = loadDenseVectorsFromDb('prose');

function scoreVector(vec, queryEmbedding) {
  const levels = 256;
  const minVal = -1;
  const maxVal = 1;
  const scale = (maxVal - minVal) / (levels - 1);
  let dot = 0;
  const dims = Math.min(vec.length, queryEmbedding.length);
  for (let i = 0; i < dims; i++) {
    dot += (vec[i] * scale + minVal) * queryEmbedding[i];
  }
  return dot;
}

if (argv.ann) {
  const embedding = await getQueryEmbedding(query);
  const candidates = hits.size
    ? Array.from(hits.keys())
    : null;

  if (embedding && (denseCode?.vectors || denseProse?.vectors)) {
    const allCandidates = candidates || [];
    if (!candidates) {
      if (!mode || mode === 'code') {
        for (let i = 0; i < (denseCode?.vectors?.length || 0); i++) {
          allCandidates.push(CODE_OFFSET + i);
        }
      }
      if (!mode || mode === 'prose') {
        for (let i = 0; i < (denseProse?.vectors?.length || 0); i++) {
          allCandidates.push(PROSE_OFFSET + i);
        }
      }
    }

    for (const rowid of allCandidates) {
      let vec = null;
      if (rowid >= PROSE_OFFSET) {
        const idx = rowid - PROSE_OFFSET;
        vec = denseProse?.vectors?.[idx] || null;
      } else {
        vec = denseCode?.vectors?.[rowid] || null;
      }
      if (!vec) continue;
      const score = scoreVector(vec, embedding);
      const chunk = chunksStmt.get(rowid);
      if (!chunk) continue;
      if (mode && chunk.mode !== mode) continue;

      const existing = hits.get(rowid);
      if (existing) {
        hits.set(rowid, { chunk, score: existing.score + score, kind: 'ann' });
      } else {
        hits.set(rowid, { chunk, score, kind: 'ann' });
      }
    }
  }
}

function normalizeKind(kind) {
  if (!kind) return 'bm25';
  const value = String(kind).toLowerCase();
  if (value === 'fts') return 'bm25';
  if (value === 'fts+ann') return 'ann';
  return value;
}

const ranked = [...hits.values()]
  .sort((a, b) => b.score - a.score)
  .slice(0, topN)
  .map((hit) => ({ ...hit.chunk, annScore: hit.score, annType: normalizeKind(hit.kind) }));

if (argv.json) {
  console.log(JSON.stringify(ranked, null, 2));
} else {
  ranked.forEach((chunk, i) => {
    console.log(`${i + 1}. ${chunk.file} ${chunk.name || ''} [${chunk.annScore.toFixed(2)}]`);
  });
}

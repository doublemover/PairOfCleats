#!/usr/bin/env node
/**
 * Semantic Indexer & Analyzer for JS/Node/Bash Scripts/YAML & Prose (md/txt)
 * Usage: node ./tools/build_index_new.js
 *
 * Pure Node/JS
 *
 * Features:
 *  - Semantic (AST/heading) chunking
 *  - Phrase & char-n-gram/posting-list index
 *  - Field-weighted & path-boosted scoring
 *  - Dynamic BM25 parameter tuning
 *  - Incremental & parallel indexing
 *  - Posting-list compression (varint/gap)
 *  - Cross-file code relationship index (calls, imports, usages)
 *  - Churn metrics (git log/blame)
 *  - Rich docstring/type extraction
 *  - Neighbor context + headline summary
 *  - Complexity, lint, deprecation/TODO annotations
 *  - External doc links (package.json, imports)
 *  - Quantization/pruning
 *  - Ultra-rich per-chunk meta & top tokens
 *  - MinHash for embedding ANN
 *  - Progress bars/logging at every step
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import seedrandom from 'seedrandom';
import strip from 'strip-comments';
import { pipeline } from '@xenova/transformers';

import * as acorn from 'acorn';
import * as esprima from 'esprima';
import * as yaml from 'yaml';
import * as varint from 'varint';

import simpleGit from 'simple-git';
import escomplex from 'escomplex';
import { ESLint } from 'eslint';


// --- DICTIONARY LOADER ---
import readline from 'node:readline';
import { createReadStream } from 'node:fs';

const yourDict = new Set();
const rl = readline.createInterface({
  input: createReadStream('tools/words_alpha.txt'),
  crlfDelay: Infinity
});

for await (const line of rl) {
  yourDict.add(line.trim());
}

const argv = minimist(process.argv.slice(2), {
  default: { mode: 'all', chunk: 600, dims: 512, threads: os.cpus().length }
});
const MODES = argv.mode === 'all' ? ['prose', 'code'] : [argv.mode];
const ROOT = process.cwd();
const THREADS = +argv.threads;
const gitMetaCache = new Map();

const SKIP_DIRS = new Set([
  '.git',
  '.github',
  '.repoMetrics',
  'coverage',
  'css',
  'dist',
  'exports',
  'holiday93',
  'holiday94',
  'img',
  'index-code',
  'index-prose',
  'index-',
  'lemmings',
  'lemmings_all',
  'lemmings_ohNo',
  'node_modules',
  'xmas91',
  'xmas92',
  'tools'
]);

const SKIP_FILES = new Set([
  '.eslint.config.js',
  '.gitattributes',
  '.gitignore',
  '.jshintconfig',
  '.jshintignore',
  '.repometrics',
  '.scannedfiles',
  '.searchhistory',
  '.skippedfiles',
  'bash_aliases',
  'char3_postings.json',
  'chunk_meta.json',
  'dense_vectors',
  'fileformat.txt',
  'jquery.js',
  'metrics.json',
  '.repoMetrics.old',
  '.repoMetrics0.old',
  '.repoMetrics1.old',
  'noResultQueries',
  'package-lock.json',
  'package.json',
  'searchHistory',
  'site.webmanifest',
  'sparse_postings.json',
  'webmidi.js',
  'wordInfo.json',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'words_alpha.txt',
  'AGENTS.md'
]);

const EXTS_PROSE = new Set([
  '.md', '.txt'
]);

const EXTS_CODE = new Set([
  '.js', '.yml', '.sh', '.html',
  // Optionally:
  // '.css', '.json'
]);

// Single global embedder
const embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L12-v2');
// Other options: 
// 'Xenova/all-MiniLM-L12-v2' → better quality
// 'Xenova/bert-base-uncased' → big model
// 'Xenova/codebert-base' → CodeBERT (code only, bigger)

function quantizeVec(vec, minVal = -1, maxVal = 1, levels = 256) {
  return vec.map(f =>
    Math.max(0, Math.min(levels - 1, Math.round(((f - minVal) / (maxVal - minVal)) * (levels - 1))))
  );
}

const STOP = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'a', 'an', 'the',
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very',
  's', 't', 'can', 'will', 'just', 'don', 'should', 'now'
]);

const SYN = { err: 'error', cfg: 'config', msg: 'message', init: 'initialize' };
const snow = Snowball.newStemmer('english');
const stem = (w) => (typeof w === 'string' ? snow.stem(w) : '');
const camel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const splitId = (s) =>
  s.replace(/([a-z])([A-Z])/g, '$1 $2')        // split camelCase
    .replace(/[_\-]+/g, ' ')                   // split on _ and -
    .split(/[^a-zA-Z0-9]+/u)                   // split non-alphanum
    .flatMap(tok => tok.split(/(?<=.)(?=[A-Z])/)) // split merged camel even if lowercase input
    .map(t => t.toLowerCase())
    .filter(Boolean);

const rng = seedrandom('42');
const gauss = () => {
  let u, v, s;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (!s || s >= 1);
  return u * Math.sqrt(-2 * Math.log(s));
};
const tri = (w, n = 3) => {
  const s = `⟬${w}⟭`;
  const g = [];
  for (let i = 0; i <= s.length - n; i++) {
    g.push(s.slice(i, i + n));
  }
  return g;
};

class SimpleMinHash {
  constructor(numHashes = 128) {
    this.numHashes = numHashes;
    this.seeds = Array.from({ length: numHashes }, (_, i) => i + 1);
    this.hashValues = Array(numHashes).fill(Infinity);
  }

  hash(str, seed) {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  update(token) {
    this.seeds.forEach((seed, i) => {
      const hv = this.hash(token, seed);
      if (hv < this.hashValues[i]) {
        this.hashValues[i] = hv;
      }
    });
  }
}


function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}
function fileExt(f) {
  return path.extname(f).toLowerCase();
}
function showProgress(step, i, total) {
  const pct = ((i / total) * 100).toFixed(1);
  process.stderr.write(`\r${step.padEnd(40)} ${i}/${total} (${pct}%)`.padEnd(70));
  if (i === total) process.stderr.write('\n');
}
function log(msg) {
  process.stderr.write('\n' + msg + '\n');
}


// --- HEADLINE GENERATOR ---
function getHeadline(chunk, tokens, n = 7, tokenMaxLen = 30, headlineMaxLen = 120) {
  // Prefer docmeta.doc if present
  if (chunk.docmeta && chunk.docmeta.doc) {
    return chunk.docmeta.doc.split(/\s+/).slice(0, n).join(' ');
  }

  // Prefer codeRelations.name if present
  if (chunk.codeRelations && chunk.codeRelations.name) {
    return chunk.codeRelations.name;
  }

  // Fallback: filtered freq tokens
  const codeStop = new Set([
    'x', 'y', 'z', 'dx', 'dy', 'dt',
    'width', 'height', 'start', 'end',
    'left', 'right', 'top', 'bottom',
    'i', 'j', 'k', 'n', 'm', 'idx', 'val',
    'value', 'array', 'count', 'len', 'index',
    'file', 'path', 'data', 'object', 'this',
    'name', 'id', 'type', 'kind', 'ctx',
    'row', 'col', 'page', 'block', 'section',
    'input', 'output', 'temp', 'tmp', 'buffer'
  ]);

  const freq = {};
  tokens.forEach(t => {
    if (STOP.has(t)) return;
    if (codeStop.has(t)) return;
    if (t.length === 1) return;
    if (/^[0-9]+$/.test(t)) return;
    freq[t] = (freq[t] || 0) + 1;
  });

  const parts = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(x => x[0].slice(0, tokenMaxLen))
    .slice(0, n);

  let headline = parts.join(' ');
  if (headline.length > headlineMaxLen) {
    headline = headline.slice(0, headlineMaxLen).trim() + '…';
  }

  return headline || '(no headline)';
}


// --- SMART CHUNKING ---
function smartChunk({ text, ext, mode }) {
  if (mode === 'prose' && (ext === '.md' || ext === '.rst')) {
    const matches = [...text.matchAll(/^#{1,6} .+$/gm)];
    let chunks = [];
    for (let i = 0; i < matches.length; ++i) {
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const title = text.slice(start, text.indexOf('\n', start));
      chunks.push({
        start,
        end,
        name: title.replace(/^#+ /, '').trim(),
        kind: 'Section',
        meta: { title }
      });
    }
    if (!chunks.length) return [{ start: 0, end: text.length, name: 'root', kind: 'Section', meta: {} }];
    return chunks;
  }
  if (mode === 'code' && (ext === '.js' || ext === '.ts')) {
    try {
      const ast = acorn.parse(text, { ecmaVersion: 'latest', locations: true, sourceType: 'module' });
      const chunks = [];
      for (const node of ast.body) {
        // FunctionDeclaration
        if (node.type === 'FunctionDeclaration') {
          const start = node.start;
          const end = node.end;
          const name = node.id ? node.id.name : 'anonymous';
          chunks.push({
            start, end, name,
            kind: 'FunctionDeclaration',
            meta: {}
          });
        }

        // ClassDeclaration + MethodDefinitions inside
        if (node.type === 'ClassDeclaration') {
          const start = node.start;
          const end = node.end;
          const name = node.id ? node.id.name : 'anonymous';
          chunks.push({
            start, end, name,
            kind: 'ClassDeclaration',
            meta: {}
          });
          if (node.body && node.body.body) {
            for (const method of node.body.body) {
              if (method.type === 'MethodDefinition' && method.key && method.value) {
                chunks.push({
                  start: method.start,
                  end: method.end,
                  name: `${name}.${method.key.name || 'anonymous'}`,
                  kind: 'MethodDefinition',
                  meta: {}
                });
              }
            }
          }
        }

        // ExportNamedDeclaration → FunctionDeclaration or VariableDeclaration
        if (node.type === 'ExportNamedDeclaration' && node.declaration) {
          if (node.declaration.type === 'FunctionDeclaration') {
            const start = node.declaration.start;
            const end = node.declaration.end;
            const name = node.declaration.id ? node.declaration.id.name : 'anonymous';
            chunks.push({
              start, end, name,
              kind: 'ExportedFunction',
              meta: {}
            });
          }
          if (node.declaration.type === 'VariableDeclaration') {
            for (const decl of node.declaration.declarations) {
              if (decl.init && decl.init.type === 'ArrowFunctionExpression') {
                const start = decl.start;
                const end = decl.end;
                const name = decl.id.name;
                chunks.push({
                  start, end, name,
                  kind: 'ExportedArrowFunction',
                  meta: {}
                });
              }
            }
          }
        }

        // VariableDeclaration → ArrowFunctionExpression
        if (node.type === 'VariableDeclaration') {
          for (const decl of node.declarations) {
            if (decl.init && decl.init.type === 'ArrowFunctionExpression') {
              const start = decl.start;
              const end = decl.end;
              const name = decl.id.name;
              chunks.push({
                start, end, name,
                kind: 'ArrowFunction',
                meta: {}
              });
            }
          }
        }
      }

      if (!chunks.length) return [{ start: 0, end: text.length, name: 'root', kind: 'Module', meta: {} }];
      return chunks;
    } catch (e) {
      // Fallback below
    }
  }
  if (ext === '.yaml' || ext === '.yml') {
    try {
      const doc = yaml.parse(text);
      return Object.keys(doc).map(key => ({
        start: text.indexOf(key),
        end: text.length, // rough
        name: key, kind: 'Section', meta: {}
      }));
    } catch {}
  }
  // Fallback: chunk by size
  const fallbackChunkSize = 800;
  let out = [];
  for (let off = 0; off < text.length; off += fallbackChunkSize) {
    out.push({
      start: off,
      end: Math.min(text.length, off + fallbackChunkSize),
      name: 'blob',
      kind: 'Blob',
      meta: {}
    });
  }
  return out;
}

// --- FIELD WEIGHTING ---
function getFieldWeight(meta, file) {
  if (/test/i.test(file)) return 0.5;
  if (meta.kind === 'FunctionDeclaration') return 2.0;
  if (meta.kind === 'ClassDeclaration') return 1.5;
  if (fileExt(file) === '.js') return 1.2;
  if (fileExt(file) === '.md') return 0.8;
  return 1.0;
}

// --- GIT METADATA + CHURN ---
async function getGitMeta(file, start = 0, end = 0) {
  if (gitMetaCache.has(file)) {
    // Use cached log for this file
    const cached = gitMetaCache.get(file);
    let blameData = {};
    try {
      const git = simpleGit();
      const blame = await git.raw(['blame', '-L', `${start + 1},${end + 1}`, file]);
      const authors = new Set();
      for (const line of blame.split('\n')) {
        const m = line.match(/^\w+\s+\(([^)]+)\s+\d{4}/);
        if (m) authors.add(m[1].trim());
      }
      blameData = { chunk_authors: Array.from(authors) };
    } catch {}
    return {
      ...cached,
      ...blameData
    };
  }

  // First time for this file — run full git log
  try {
    const git = simpleGit();
    const log = await git.log({ file, n: 10 });
    let churn = 0;
    for (const c of log.all) {
      churn += c.body ? c.body.length : 0;
    }

    const meta = {
      last_modified: log.latest?.date || null,
      last_author: log.latest?.author_name || null,
      churn
    };

    // Cache it
    gitMetaCache.set(file, meta);

    // Run blame for first chunk
    let blameData = {};
    try {
      const blame = await git.raw(['blame', '-L', `${start + 1},${end + 1}`, file]);
      const authors = new Set();
      for (const line of blame.split('\n')) {
        const m = line.match(/^\w+\s+\(([^)]+)\s+\d{4}/);
        if (m) authors.add(m[1].trim());
      }
      blameData = { chunk_authors: Array.from(authors) };
    } catch {}

    return {
      ...meta,
      ...blameData
    };
  } catch {
    return {};
  }
}

// --- CROSS-FILE CODE RELATIONSHIPS ---
function buildCodeRelations(text, relPath, allImports) {
  let imports = [], exports = [], calls = [], usages = [];
  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration') {
        imports.push(node.source.value);
        node.specifiers.forEach(s => {
          if (s.local && s.local.name) usages.push(s.local.name);
        });
      }
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        if (node.declaration.id) exports.push(node.declaration.id.name);
        else if (node.declaration.declarations) {
          node.declaration.declarations.forEach(d => d.id && exports.push(d.id.name));
        }
      }
      // Function/Call graph
      if (node.type === 'FunctionDeclaration' && node.id) {
        function walk(node, parentFn) {
          if (!node) return;
          if (node.type === 'CallExpression' && node.callee && node.callee.name) {
            calls.push([parentFn, node.callee.name]);
          }
          for (let k in node) {
            if (node[k] && typeof node[k] === 'object') walk(node[k], parentFn);
          }
        }
        walk(node.body, node.id.name);
      }
    }
    // Usages: look for identifiers
    const tokens = esprima.tokenize(text, { tolerant: true });
    tokens.forEach(t => {
      if (t.type === 'Identifier') usages.push(t.value);
    });
  } catch {}
  // Cross-file import links
  const importLinks = imports
    .map(i => allImports[i])
    .filter(x => !!x)
    .flat();
  return { imports, exports, calls, usages, importLinks };
}

// --- DOCSTRING/TYPE EXTRACTION ---
function extractDocMeta(text, chunk) {
  const lines = text.slice(chunk.start, chunk.end).split('\n');
  const docLines = lines.filter(l => l.trim().startsWith('*') || l.trim().startsWith('//') || l.trim().startsWith('#'));
  const params = [...text.slice(chunk.start, chunk.end).matchAll(/@param +(\w+)/g)].map(m => m[1]);
  const returns = !!text.slice(chunk.start, chunk.end).match(/@returns? /);
  // Try to extract type signatures
  let signature = null;
  const matchFn = text.slice(chunk.start, chunk.end).match(/function\s+([A-Za-z0-9_$]+)?\s*\(([^\)]*)\)/);
  if (matchFn) {
    signature = `function ${matchFn[1] || ''}(${matchFn[2]})`;
  }
  return {
    doc: docLines.join('\n').slice(0, 300),
    params, returns, signature
  };
}

// --- COMPLEXITY/LINT ---
async function analyzeComplexity(code, relPath) {
  try {
    const report = escomplex.analyse(code, { esmImportExport: true });
    return report && report.functions ? {
      functions: report.functions.length,
      averageCyclomatic: (report.aggregate && report.aggregate.cyclomatic) || 0
    } : {};
  } catch {
    return {};
  }
}
async function lintChunk(text, relPath) {
  try {
    const eslint = new ESLint({ useEslintrc: false });
    const results = await eslint.lintText(text, { filePath: relPath });
    return results.length ? results[0].messages : [];
  } catch {
    return [];
  }
}

// --- TOKEN/GRAMS ---
function extractNgrams(tokens, nStart = 2, nEnd = 4) {
  const grams = [];
  for (let n = nStart; n <= nEnd; ++n) {
    for (let i = 0; i <= tokens.length - n; i++) {
      grams.push(tokens.slice(i, i + n).join('_'));
    }
  }
  return grams;
}

// --- EMBEDDING ---
async function getChunkEmbedding(text) {
  const embedder = await embedderPromise;
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function splitWordsWithDict(token, dict) {
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

// --- MAIN INDEXER ---
async function build(mode) {
  const OUT = `index-${mode}`;
  await fs.mkdir(OUT, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);

  const df = new Map();
  const wordFreq = new Map();
  const chunks = [];
  const triPost = new Map();
  const phrasePost = new Map();
  const scannedFiles = [];
  const scannedFilesTimes = [];
  const skippedFiles = [];
  const allImports = {}; // map: import path → rel files
  const complexityCache = new Map();
  const lintCache = new Map();

  // Discover files
  log('Discovering files...');
  async function discoverFiles(dir, arr = []) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) {
          skippedFiles.push(p);
        } else {
          await discoverFiles(p, arr);
        }
      } else if (!SKIP_FILES.has(e.name) &&
        ((mode === 'prose' && EXTS_PROSE.has(fileExt(p))) ||
          (mode === 'code' && EXTS_CODE.has(fileExt(p))))) {
        arr.push(p);
      } else {
        skippedFiles.push(p);
      }
    }
    return arr;
  }
  const allFiles = await discoverFiles(ROOT);
  log(`→ Found ${allFiles.length} files.`);

  // First pass: build import map (for cross-links)
  log('Scanning for imports...');

  const BATCH = 8; // Tune this per machine, 8 is usually fast + safe
  let processed = 0;

  for (let i = 0; i < allFiles.length; i += BATCH) {
    const batch = allFiles.slice(i, i + BATCH);
    await Promise.all(batch.map(async (absPath) => {
      const rel = path.relative(ROOT, absPath);
      let text;
      try {
        text = await fs.readFile(absPath, 'utf8');
      } catch {
        return; // skip broken file
      }
      if (fileExt(rel) === '.js' || fileExt(rel) === '.ts') {
        try {
          const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
          for (const node of ast.body) {
            if (node.type === 'ImportDeclaration') {
              const mod = node.source.value;
              if (!allImports[mod]) allImports[mod] = [];
              allImports[mod].push(rel);
            }
          }
        } catch {}
      }
      processed++;
      showProgress('Imports', processed, allFiles.length);
    }));
  }

  showProgress('Imports', allFiles.length, allFiles.length);

  // Figure out ideal context window (median chunk length in lines, capped at 10)
  let sampleChunkLens = [];
  for (let i = 0; i < Math.min(20, allFiles.length); ++i) {
    const text = await fs.readFile(allFiles[i], 'utf8');
    const ext = fileExt(allFiles[i]);
    const chunks0 = smartChunk({ text, ext, mode });
    sampleChunkLens.push(...chunks0.map(c =>
      text.slice(c.start, c.end).split('\n').length
    ));
  }
  sampleChunkLens.sort((a, b) => a - b);
  const medianChunkLines = sampleChunkLens.length ? sampleChunkLens[Math.floor(sampleChunkLens.length / 2)] : 8;
  const contextWin = Math.min(10, Math.max(3, Math.floor(medianChunkLines / 2)));
  log(`Auto-selected context window: ${contextWin} lines`);

  // Second pass: parallel file ingest, analysis, chunking, relationships
  log('Processing and indexing files...');
  let totalTokens = 0;
  await Promise.all(allFiles.map(async (abs, idx) => {
    showProgress('Files', idx, allFiles.length);
    const fileStart = Date.now();
    let text = (await fs.readFile(abs, 'utf8')).normalize('NFKD');
    const ext = fileExt(abs);
    const rel = path.relative(ROOT, abs);
    const sc = smartChunk({ text, ext, mode });
    // For each chunk:
    for (let ci = 0; ci < sc.length; ++ci) {
      const c = sc[ci];
      const ctext = text.slice(c.start, c.end);

      // Tokenization & normalization
      let tokens = splitId(ctext);
      tokens = tokens.map(t => t.normalize('NFKD'));

      // only apply your “dict” splitter when *not* a Markdown prose file
      if (!(mode === 'prose' && ext === '.md')) {
        tokens = tokens.flatMap(t => splitWordsWithDict(t, yourDict));
      }

      if (mode === 'prose') {
        tokens = tokens.filter(w => !STOP.has(w));
        tokens = tokens.flatMap(w => [w, stem(w)]);
      }
      const seq = [];
      for (const w of tokens) {
        seq.push(w);
        if (SYN[w]) seq.push(SYN[w]);
      }
      if (!seq.length) continue;
      totalTokens += seq.length;

      // N-grams & chargrams
      const ngrams = extractNgrams(seq, 2, 4);
      let chargrams = [];
      const charSet = new Set();
      seq.forEach(w => {
        for (let n = 3; n <= 5; ++n) tri(w, n).forEach(g => charSet.add(g));
      });
      charSet.forEach(tg => {
        if (!triPost.has(tg)) triPost.set(tg, new Set());
        triPost.get(tg).add(chunks.length);
      });
      // Posting
      for (const ng of ngrams) {
        if (!phrasePost.has(ng)) phrasePost.set(ng, new Set());
        phrasePost.get(ng).add(chunks.length);
      }
      for (const tg of chargrams) {
        if (!triPost.has(tg)) triPost.set(tg, new Set());
        triPost.get(tg).add(chunks.length);
      }
      tokens.forEach(t => df.set(t, (df.get(t) || 0) + 1));
      seq.forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));

      // Field/path weighting
      const meta = {
        ...c.meta, ext, path: rel, kind: c.kind, name: c.name, file: rel, weight: getFieldWeight(c, rel)
      };
      // Code relationships & analysis (JS/TS only)
      let codeRelations = {}, docmeta = {};
      if ((ext === '.js' || ext === '.ts') && mode === 'code') {
        codeRelations = buildCodeRelations(ctext, rel, allImports);
        docmeta = extractDocMeta(ctext, c);
      }
      // Complexity/lint
      let complexity = {}, lint = [];
      if ((ext === '.js' || ext === '.ts') && mode === 'code') {
        if (!complexityCache.has(rel)) {
          const fullCode = text; // entire file text
          const compResult = await analyzeComplexity(fullCode, rel);
          complexityCache.set(rel, compResult);
        }
        complexity = complexityCache.get(rel);

        if (!lintCache.has(rel)) {
          const fullCode = text; // entire file text
          const lintResult = await lintChunk(fullCode, rel);
          lintCache.set(rel, lintResult);
        }
        lint = lintCache.get(rel);
      }
      // Chunk stats
      const freq = {};
      tokens.forEach(t => freq[t] = (freq[t] || 0) + 1);
      const unique = Object.keys(freq).length;
      const counts = Object.values(freq);
      const sum = counts.reduce((a, b) => a + b, 0);
      const entropy = -counts.reduce((e, c) => e + (c / sum) * Math.log2(c / sum), 0);
      const stats = { unique, entropy, sum };

      // Embeddings (separate for doc, code, comments)
      const embed_doc = await getChunkEmbedding(docmeta.doc || '');
      const embed_code = await getChunkEmbedding(ctext);
      const dims = embed_doc.length; // auto-detect
      const embedding = embed_doc.map((v, i) => v + embed_code[i]);


      const mh = new SimpleMinHash();
      tokens.forEach(t => mh.update(t));
      const minhashSig = mh.hashValues;

      // Headline summary (chunk, top N tokens)
      const headline = getHeadline(c, tokens);

      // Neighboring context
      const lines = ctext.split('\n');
      let preContext = [], postContext = [];
      if (ci > 0) preContext = text.slice(sc[ci - 1].start, sc[ci - 1].end).split('\n').slice(-contextWin);
      if (ci + 1 < sc.length) postContext = text.slice(sc[ci + 1].start, sc[ci + 1].end).split('\n').slice(0, contextWin);

      // Git meta + churn
      const gitMeta = await getGitMeta(abs, c.start, c.end);

      // External docs (for imports)
      let externalDocs = [];
      if (codeRelations.imports && codeRelations.imports.length) {
        for (const mod of codeRelations.imports) {
          if (mod.startsWith('.')) continue;
          externalDocs.push(`https://www.npmjs.com/package/${mod.replace(/^@/, '')}`);
        }
      }

      // Compose chunk meta
      chunks.push({
        id: chunks.length,
        file: rel,
        ext,
        start: c.start,
        end: c.end,
        kind: c.kind,
        name: c.name,
        tokens,
        seq,
        ngrams,
        chargrams,
        meta,
        codeRelations,
        docmeta,
        stats,
        complexity,
        lint,
        headline,
        preContext,
        postContext,
        embedding,
        embed_doc,
        embed_code,
        minhashSig,
        weight: meta.weight,
        ...gitMeta,
        externalDocs
      });
    }
    const fileDurationMs = Date.now() - fileStart;
    scannedFilesTimes.push({ file: abs, duration_ms: fileDurationMs });
    scannedFiles.push(abs);
  }));

  log(`   → Indexed ${chunks.length} chunks, total tokens: ${totalTokens.toLocaleString()}`);

  // BM25 tuning
  function tuneBM25Params(chunks) {
    const avgLen = chunks.reduce((s, c) => s + c.tokens.length, 0) / chunks.length;
    let b = avgLen > 800 ? 0.6 : 0.8;
    let k1 = avgLen > 800 ? 1.2 : 1.7;
    return { k1, b };
  }
  const { k1, b } = tuneBM25Params(chunks);
  const N = chunks.length;
  const avgChunkLen = chunks.reduce((sum, c) => sum + c.tokens.length, 0) / Math.max(N, 1);

  // Build sparse postings for tokens
  const vocabAll = Array.from(df.keys());
  const trimmedVocab = vocabAll.slice();
  const vmap = new Map(trimmedVocab.map((t, i) => [t, i]));
  const posts = Array.from({ length: trimmedVocab.length }, () => []);
  const sparse = [];

  chunks.forEach((c, r) => {
    const row = [];
    c.tokens.forEach((t) => {
      const col = vmap.get(t);
      if (col === undefined) return;
      posts[col].push(r);
      const idf = Math.log((N - df.get(t) + 0.5) / (df.get(t) + 0.5) + 1);
      const freq = c.tokens.filter(x => x === t).length;
      const bm =
        idf *
        ((freq * (k1 + 1)) /
          (freq + k1 * (1 - b + b * (c.tokens.length / avgChunkLen))));
      if (bm) row.push([col, bm * c.weight]);
    });
    sparse.push(row);
  });

  log('Using real model embeddings for dense vectors...');
  const dims = chunks[0]?.embedding.length || 384;
  const embeddingVectors = chunks.map(c => c.embedding);
  const quantizedVectors = embeddingVectors.map(vec => quantizeVec(vec));


  // Posting-list compression: Varint encode
  const gap = posts.map((list) => {
    list.sort((a, b) => a - b);
    let prev = 0;
    return list.map((id) => {
      const g = id - prev;
      prev = id;
      return g;
    });
  });
  const postingBuffers = gap.map(list => Buffer.from(list.flatMap(id => varint.encode(id))));
  const postingsBin = Buffer.concat(postingBuffers);

  // Phrase and char n-gram indexes
  const phraseVocab = Array.from(phrasePost.keys());
  const phrasePostings = phraseVocab.map(k => Array.from(phrasePost.get(k)));
  const chargramVocab = Array.from(triPost.keys());
  const chargramPostings = chargramVocab.map(k => Array.from(triPost.get(k)));

  // MinHash index (signatures)
  const minhashSigs = chunks.map(c => c.minhashSig);
  // (MinHash search logic will be in search.js)

  // Chunk meta
  const chunkMeta = chunks.map((c, i) => ({
    id: c.id,
    file: c.file,
    start: c.start,
    end: c.end,
    kind: c.kind,
    name: c.name,
    weight: c.weight,
    headline: c.headline,
    preContext: c.preContext,
    postContext: c.postContext,
  }));

  // Write scanned + skipped files logs
  await fs.writeFile(
    path.join(OUT, '.scannedfiles.json'),
    JSON.stringify(scannedFilesTimes, null, 2)
  );
  await fs.writeFile(
    path.join(OUT, '.skippedfiles.json'),
    JSON.stringify(skippedFiles, null, 2)
  );
  log('→ Wrote .scannedfiles.json and .skippedfiles.json');

  log('Writing index files...');
  await Promise.all([
    fs.writeFile(path.join(OUT, 'sparse_postings_varint.bin'), postingsBin),
    fs.writeFile(
      path.join(OUT, 'dense_vectors_uint8.json'),
      JSON.stringify({ dims, scale: 1.0, vectors: quantizedVectors  }) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'chunk_meta.json'),
      JSON.stringify(chunkMeta) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'phrase_ngrams.json'),
      JSON.stringify({ vocab: phraseVocab, postings: phrasePostings }) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'chargram_postings.json'),
      JSON.stringify({ vocab: chargramVocab, postings: chargramPostings }) + '\n'
    ),
    fs.writeFile(
      path.join(OUT, 'minhash_signatures.json'),
      JSON.stringify({ signatures: minhashSigs }) + '\n'
    )
  ]);
  log(
    `📦  ${mode.padEnd(5)}: ${chunks.length.toLocaleString()} chunks, ${trimmedVocab.length.toLocaleString()} tokens, dims=${dims}`
  );
}

for (const m of MODES) {
  await build(m);
}
log('\nDone.');



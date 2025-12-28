#!/usr/bin/env node
/**
 * Semantic Indexer & Analyzer for JS/Node/Bash/Python/Swift/Rust/Go/Java/Perl/Shell/YAML & Prose (md/txt)
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
import minimist from 'minimist';
import ignore from 'ignore';
import * as varint from 'varint';
import { DEFAULT_MODEL_ID, getDictionaryPaths, getDictConfig, getIndexDir, getMetricsDir, getModelConfig, getRepoCacheRoot, loadUserConfig } from './tools/dict-utils.js';

import { analyzeComplexity, lintChunk } from './src/indexer/analysis.js';
import { smartChunk } from './src/indexer/chunking.js';
import {
  EXTS_CODE,
  EXTS_PROSE,
  SKIP_DIRS,
  SKIP_FILES,
  STOP,
  SYN,
  isCLike,
  isGo,
  isJava,
  isJsLike,
  isPerl,
  isShell,
  isSpecialCodeFile,
  isTypeScript,
  isCSharp,
  isKotlin,
  isRuby,
  isPhp,
  isLua,
  isSql
} from './src/indexer/constants.js';
import { createEmbedder, quantizeVec } from './src/indexer/embedding.js';
import { getFieldWeight } from './src/indexer/field-weighting.js';
import { getGitMeta } from './src/indexer/git.js';
import { getHeadline } from './src/indexer/headline.js';
import { SimpleMinHash } from './src/indexer/minhash.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, extractCLikeDocMeta } from './src/lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, extractGoDocMeta } from './src/lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, extractJavaDocMeta } from './src/lang/java.js';
import { buildCodeRelations, collectImports, extractDocMeta } from './src/lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, extractTypeScriptDocMeta } from './src/lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, extractCSharpDocMeta } from './src/lang/csharp.js';
import { buildKotlinChunks, buildKotlinRelations, collectKotlinImports, extractKotlinDocMeta } from './src/lang/kotlin.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports, extractRubyDocMeta } from './src/lang/ruby.js';
import { buildPhpChunks, buildPhpRelations, collectPhpImports, extractPhpDocMeta } from './src/lang/php.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports, extractLuaDocMeta } from './src/lang/lua.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports, extractSqlDocMeta } from './src/lang/sql.js';
import { buildPerlChunks, buildPerlRelations, collectPerlImports, extractPerlDocMeta } from './src/lang/perl.js';
import { getPythonAst, collectPythonImports, buildPythonRelations, extractPythonDocMeta } from './src/lang/python.js';
import { buildRustChunks, buildRustRelations, collectRustImports, extractRustDocMeta } from './src/lang/rust.js';
import { buildSwiftChunks, buildSwiftRelations, collectSwiftImports, extractSwiftDocMeta } from './src/lang/swift.js';
import { buildShellChunks, buildShellRelations, collectShellImports, extractShellDocMeta } from './src/lang/shell.js';
import { runWithConcurrency } from './src/shared/concurrency.js';
import { fileExt, toPosix } from './src/shared/files.js';
import { sha1 } from './src/shared/hash.js';
import { buildLineIndex, offsetToLine } from './src/shared/lines.js';
import { log, showProgress } from './src/shared/progress.js';
import { extractNgrams, splitId, splitWordsWithDict, stem, tri } from './src/shared/tokenize.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['incremental', 'stub-embeddings'],
  string: ['model'],
  alias: { i: 'incremental' },
  default: {
    mode: 'all',
    chunk: 600,
    dims: 512,
    threads: os.cpus().length,
    incremental: false,
    'stub-embeddings': false
  }
});
const MODES = argv.mode === 'all' ? ['prose', 'code'] : [argv.mode];
const ROOT = process.cwd();

const userConfig = loadUserConfig(ROOT);
const repoCacheRoot = getRepoCacheRoot(ROOT, userConfig);
const indexingConfig = userConfig.indexing || {};
const astDataflowEnabled = indexingConfig.astDataflow !== false;
const sqlConfig = userConfig.sql || {};
const defaultSqlDialects = {
  '.psql': 'postgres',
  '.pgsql': 'postgres',
  '.mysql': 'mysql',
  '.sqlite': 'sqlite'
};
const sqlDialectByExt = { ...defaultSqlDialects, ...(sqlConfig.dialectByExt || {}) };
const sqlDialectOverride = typeof sqlConfig.dialect === 'string' && sqlConfig.dialect.trim()
  ? sqlConfig.dialect.trim()
  : '';
const resolveSqlDialect = (ext) => (sqlDialectOverride || sqlDialectByExt[ext] || 'generic');
const threadsArgPresent = process.argv.includes('--threads');
const configConcurrency = Number(indexingConfig.concurrency);
const cliConcurrency = threadsArgPresent ? Number(argv.threads) : null;
const defaultConcurrency = Math.max(1, Math.min(4, os.cpus().length));
const fileConcurrency = Math.max(
  1,
  Math.min(
    16,
    Number.isFinite(configConcurrency)
      ? configConcurrency
      : Number.isFinite(cliConcurrency)
        ? cliConcurrency
        : defaultConcurrency
  )
);
const importConcurrency = Math.max(
  1,
  Math.min(
    16,
    Number.isFinite(Number(indexingConfig.importConcurrency))
      ? Number(indexingConfig.importConcurrency)
      : fileConcurrency
  )
);
const incrementalEnabled = argv.incremental === true;
const useStubEmbeddings = argv['stub-embeddings'] === true || process.env.PAIROFCLEATS_EMBEDDINGS === 'stub';
const modelConfig = getModelConfig(ROOT, userConfig);
const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const modelsDir = modelConfig.dir;
if (modelsDir) {
  try {
    await fs.mkdir(modelsDir, { recursive: true });
  } catch {}
}
const dictConfig = getDictConfig(ROOT, userConfig);
const dictionaryPaths = await getDictionaryPaths(ROOT, dictConfig);
const yourDict = new Set();
for (const dictFile of dictionaryPaths) {
  try {
    const contents = await fs.readFile(dictFile, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) yourDict.add(trimmed);
    }
  } catch {}
}
const dictSummary = { files: dictionaryPaths.length, words: yourDict.size };

const config = {
  useDefaultSkips: userConfig.useDefaultSkips !== false,
  useGitignore: userConfig.useGitignore !== false,
  usePairofcleatsIgnore: userConfig.usePairofcleatsIgnore !== false,
  ignoreFiles: Array.isArray(userConfig.ignoreFiles) ? userConfig.ignoreFiles : [],
  extraIgnore: Array.isArray(userConfig.extraIgnore) ? userConfig.extraIgnore : []
};

const ignoreMatcher = ignore();
if (config.useDefaultSkips) {
  const defaultIgnorePatterns = [
    ...Array.from(SKIP_DIRS, (dir) => `${dir}/`),
    ...Array.from(SKIP_FILES)
  ];
  ignoreMatcher.add(defaultIgnorePatterns);
}

const ignoreFiles = [];
if (config.useGitignore) ignoreFiles.push('.gitignore');
if (config.usePairofcleatsIgnore) ignoreFiles.push('.pairofcleatsignore');
ignoreFiles.push(...config.ignoreFiles);

for (const ignoreFile of ignoreFiles) {
  try {
    const ignorePath = path.join(ROOT, ignoreFile);
    const contents = await fs.readFile(ignorePath, 'utf8');
    ignoreMatcher.add(contents);
  } catch {}
}
if (config.extraIgnore.length) {
  ignoreMatcher.add(config.extraIgnore);
}

const { getChunkEmbedding } = createEmbedder({
  useStubEmbeddings,
  modelId,
  dims: argv.dims,
  modelsDir
});

if (dictSummary.files) {
  log(`Wordlists enabled: ${dictSummary.files} file(s), ${dictSummary.words.toLocaleString()} words for identifier splitting.`);
} else {
  log('Wordlists disabled: no dictionary files found; identifier splitting will be limited.');
}
if (useStubEmbeddings) {
  log('Embeddings: stub mode enabled (no model downloads).');
} else {
  log(`Embeddings: model ${modelId}`);
}
if (incrementalEnabled) {
  log(`Incremental cache enabled (root: ${path.join(repoCacheRoot, 'incremental')}).`);
}
if (!astDataflowEnabled) {
  log('AST dataflow metadata disabled via indexing.astDataflow.');
}

// --- MAIN INDEXER ---
/**
 * Build indexes for a given mode.
 * @param {'code'|'prose'} mode
 */
async function build(mode) {
  const OUT = getIndexDir(ROOT, mode, userConfig);
  await fs.mkdir(OUT, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };

  const df = new Map();
  const wordFreq = new Map();
  const chunks = [];
  const tokenPostings = new Map();
  const docLengths = [];
  const triPost = new Map();
  const phrasePost = new Map();
  const scannedFiles = [];
  const scannedFilesTimes = [];
  const skippedFiles = [];
  const allImports = {}; // map: import path → rel files
  const complexityCache = new Map();
  const lintCache = new Map();
  const incrementalDir = path.join(repoCacheRoot, 'incremental', mode);
  const bundleDir = path.join(incrementalDir, 'files');
  const manifestPath = path.join(incrementalDir, 'manifest.json');
  let manifest = { version: 1, mode, files: {} };
  if (incrementalEnabled && fsSync.existsSync(manifestPath)) {
    try {
      const loaded = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (loaded && typeof loaded === 'object') {
        manifest = { version: loaded.version || 1, mode, files: loaded.files || {} };
      }
    } catch {}
  }
  if (incrementalEnabled) {
    await fs.mkdir(bundleDir, { recursive: true });
  }

  // Discover files
  log('Discovering files...');
  const discoverStart = Date.now();
  /**
   * Recursively discover indexable files under a directory.
   * @param {string} dir
   * @param {string[]} [arr]
   * @returns {Promise<string[]>}
   */
  async function discoverFiles(dir, arr = []) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const relPosix = toPosix(path.relative(ROOT, p));
      const ignoreKey = e.isDirectory() ? `${relPosix}/` : relPosix;
      if (ignoreMatcher.ignores(ignoreKey)) {
        skippedFiles.push(p);
        continue;
      }
      if (e.isDirectory()) {
        await discoverFiles(p, arr);
      } else {
        const ext = fileExt(p);
        const isSpecial = isSpecialCodeFile(e.name);
        if ((mode === 'prose' && EXTS_PROSE.has(ext)) ||
          (mode === 'code' && (EXTS_CODE.has(ext) || isSpecial))) {
        arr.push(p);
        } else {
        skippedFiles.push(p);
        }
      }
    }
    return arr;
  }
  const allFiles = await discoverFiles(ROOT);
  allFiles.sort();
  log(`→ Found ${allFiles.length} files.`);
  timing.discoverMs = Date.now() - discoverStart;

  // First pass: build import map (for cross-links)
  log('Scanning for imports...');
  const importStart = Date.now();

  let processed = 0;
  await runWithConcurrency(allFiles, importConcurrency, async (absPath) => {
    const rel = path.relative(ROOT, absPath);
    const relKey = toPosix(rel);
    const ext = fileExt(rel);
    let text;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      processed++;
      showProgress('Imports', processed, allFiles.length);
      return;
    }
    if (isJsLike(ext)) {
      const imports = collectImports(text);
      for (const mod of imports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isTypeScript(ext)) {
      const imports = collectTypeScriptImports(text);
      for (const mod of imports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (ext === '.py') {
      const pythonImports = collectPythonImports(text).imports;
      for (const mod of pythonImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (ext === '.swift') {
      const swiftImports = collectSwiftImports(text).imports;
      for (const mod of swiftImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isCLike(ext)) {
      const clikeImports = collectCLikeImports(text);
      for (const mod of clikeImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (ext === '.rs') {
      const rustImports = collectRustImports(text);
      for (const mod of rustImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isGo(ext)) {
      const goImports = collectGoImports(text);
      for (const mod of goImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isJava(ext)) {
      const javaImports = collectJavaImports(text);
      for (const mod of javaImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isCSharp(ext)) {
      const csharpImports = collectCSharpImports(text);
      for (const mod of csharpImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isKotlin(ext)) {
      const kotlinImports = collectKotlinImports(text);
      for (const mod of kotlinImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isRuby(ext)) {
      const rubyImports = collectRubyImports(text);
      for (const mod of rubyImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isPhp(ext)) {
      const phpImports = collectPhpImports(text);
      for (const mod of phpImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isLua(ext)) {
      const luaImports = collectLuaImports(text);
      for (const mod of luaImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isSql(ext)) {
      const sqlImports = collectSqlImports(text);
      for (const mod of sqlImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isPerl(ext)) {
      const perlImports = collectPerlImports(text);
      for (const mod of perlImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    } else if (isShell(ext)) {
      const shellImports = collectShellImports(text);
      for (const mod of shellImports) {
        if (!allImports[mod]) allImports[mod] = [];
        allImports[mod].push(relKey);
      }
    }
    processed++;
    showProgress('Imports', processed, allFiles.length);
  });

  showProgress('Imports', allFiles.length, allFiles.length);
  timing.importsMs = Date.now() - importStart;

  // Figure out ideal context window (median chunk length in lines, capped at 10)
  let sampleChunkLens = [];
  for (let i = 0; i < Math.min(20, allFiles.length); ++i) {
    const text = await fs.readFile(allFiles[i], 'utf8');
    const relSample = path.relative(ROOT, allFiles[i]);
    const relSampleKey = toPosix(relSample);
    const baseName = path.basename(allFiles[i]);
    const rawExt = fileExt(allFiles[i]);
    const ext = rawExt || (isSpecialCodeFile(baseName)
      ? (baseName.toLowerCase() === 'dockerfile' ? '.dockerfile' : '.makefile')
      : rawExt);
    const pythonAst = ext === '.py' && mode === 'code' ? getPythonAst(text, log, { dataflow: astDataflowEnabled }) : null;
    const swiftChunks = ext === '.swift' && mode === 'code' ? buildSwiftChunks(text) : null;
    const clikeChunks = isCLike(ext) && mode === 'code' ? buildCLikeChunks(text, ext) : null;
    const rustChunks = ext === '.rs' && mode === 'code' ? buildRustChunks(text) : null;
    const goChunks = isGo(ext) && mode === 'code' ? buildGoChunks(text) : null;
    const javaChunks = isJava(ext) && mode === 'code' ? buildJavaChunks(text) : null;
    const perlChunks = isPerl(ext) && mode === 'code' ? buildPerlChunks(text) : null;
    const shellChunks = isShell(ext) && mode === 'code' ? buildShellChunks(text) : null;
    const tsChunks = isTypeScript(ext) && mode === 'code' ? buildTypeScriptChunks(text) : null;
    const csharpChunks = isCSharp(ext) && mode === 'code' ? buildCSharpChunks(text) : null;
    const kotlinChunks = isKotlin(ext) && mode === 'code' ? buildKotlinChunks(text) : null;
    const rubyChunks = isRuby(ext) && mode === 'code' ? buildRubyChunks(text) : null;
    const phpChunks = isPhp(ext) && mode === 'code' ? buildPhpChunks(text) : null;
    const luaChunks = isLua(ext) && mode === 'code' ? buildLuaChunks(text) : null;
    const sqlChunks = isSql(ext) && mode === 'code'
      ? buildSqlChunks(text, { dialect: resolveSqlDialect(ext) })
      : null;
    const chunks0 = smartChunk({
      text,
      ext,
      relPath: relSampleKey,
      mode,
      pythonAst,
      swiftChunks,
      clikeChunks,
      rustChunks,
      goChunks,
      javaChunks,
      perlChunks,
      shellChunks,
      tsChunks,
      csharpChunks,
      kotlinChunks,
      rubyChunks,
      phpChunks,
      luaChunks,
      sqlChunks
    });
    sampleChunkLens.push(...chunks0.map(c =>
      text.slice(c.start, c.end).split('\n').length
    ));
  }
  sampleChunkLens.sort((a, b) => a - b);
  const medianChunkLines = sampleChunkLens.length ? sampleChunkLens[Math.floor(sampleChunkLens.length / 2)] : 8;
  const contextWin = Math.min(10, Math.max(3, Math.floor(medianChunkLines / 2)));
  log(`Auto-selected context window: ${contextWin} lines`);

  // Second pass: file ingest, analysis, chunking, relationships
  log('Processing and indexing files...');
  const processStart = Date.now();
  let totalTokens = 0;
  const seenFiles = new Set();

  /**
   * Append a processed chunk into global index structures.
   * @param {object} chunk
   */
  function appendChunk(chunk) {
    const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : [];
    const seq = Array.isArray(chunk.seq) && chunk.seq.length ? chunk.seq : tokens;
    if (!seq.length) return;

    totalTokens += seq.length;
    const ngrams = Array.isArray(chunk.ngrams) && chunk.ngrams.length
      ? chunk.ngrams
      : extractNgrams(seq, 2, 4);

    const chargrams = Array.isArray(chunk.chargrams) && chunk.chargrams.length
      ? chunk.chargrams
      : null;
    const charSet = new Set(chargrams || []);
    if (!chargrams) {
      seq.forEach(w => {
        for (let n = 3; n <= 5; ++n) tri(w, n).forEach(g => charSet.add(g));
      });
    }

    const freq = {};
    tokens.forEach(t => freq[t] = (freq[t] || 0) + 1);
    const chunkId = chunks.length;

    docLengths[chunkId] = tokens.length;
    for (const [tok, count] of Object.entries(freq)) {
      let postings = tokenPostings.get(tok);
      if (!postings) {
        postings = [];
        tokenPostings.set(tok, postings);
      }
      postings.push([chunkId, count]);
    }

    for (const ng of ngrams) {
      if (!phrasePost.has(ng)) phrasePost.set(ng, new Set());
      phrasePost.get(ng).add(chunkId);
    }
    for (const tg of charSet) {
      if (!triPost.has(tg)) triPost.set(tg, new Set());
      triPost.get(tg).add(chunkId);
    }

    tokens.forEach(t => df.set(t, (df.get(t) || 0) + 1));
    seq.forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));

    chunk.id = chunkId;
    chunks.push(chunk);
  }

  log('Indexing concurrency: files=' + fileConcurrency + ', imports=' + importConcurrency);
  let processedFiles = 0;

  /**
   * Process a file: read, chunk, analyze, and produce chunk payloads.
   * @param {string} abs
   * @param {number} fileIndex
   * @returns {Promise<object|null>}
   */
  async function processFile(abs, fileIndex) {
    const fileStart = Date.now();
    const rel = path.relative(ROOT, abs);
    const relKey = toPosix(rel);
    seenFiles.add(relKey);
    const baseName = path.basename(abs);
    const rawExt = fileExt(abs);
    const ext = rawExt || (isSpecialCodeFile(baseName)
      ? (baseName.toLowerCase() === 'dockerfile' ? '.dockerfile' : '.makefile')
      : rawExt);
    let fileStat;
    try {
      fileStat = await fs.stat(abs);
    } catch {
      return null;
    }

    let cachedBundle = null;
    let text = null;
    let fileHash = null;
    if (incrementalEnabled) {
      const cacheKey = sha1(relKey);
      const bundlePath = path.join(bundleDir, `${cacheKey}.json`);
      const cachedEntry = manifest.files[relKey];
      if (cachedEntry && cachedEntry.size === fileStat.size && cachedEntry.mtimeMs === fileStat.mtimeMs && fsSync.existsSync(bundlePath)) {
        try {
          cachedBundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
        } catch {
          cachedBundle = null;
        }
      } else if (cachedEntry && cachedEntry.hash && fsSync.existsSync(bundlePath)) {
        try {
          text = await fs.readFile(abs, 'utf8');
          fileHash = sha1(text);
          if (fileHash === cachedEntry.hash) {
            cachedBundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
          }
        } catch {
          cachedBundle = null;
        }
      }
    }

    if (cachedBundle && Array.isArray(cachedBundle.chunks)) {
      const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
        const updatedChunk = { ...cachedChunk };
        if (updatedChunk.codeRelations?.imports) {
          const importLinks = updatedChunk.codeRelations.imports
            .map(i => allImports[i])
            .filter(x => !!x)
            .flat();
          updatedChunk.codeRelations = {
            ...updatedChunk.codeRelations,
            importLinks
          };
        }
        return updatedChunk;
      });
      const fileDurationMs = Date.now() - fileStart;
      return {
        abs,
        relKey,
        fileIndex,
        cached: true,
        durationMs: fileDurationMs,
        chunks: updatedChunks,
        manifestEntry: null
      };
    }

    if (!text) {
      try {
        text = await fs.readFile(abs, 'utf8');
      } catch {
        return null;
      }
    }
    if (!fileHash) fileHash = sha1(text);
    text = text.normalize('NFKD');

    const pythonAst = ext === '.py' && mode === 'code' ? getPythonAst(text, log, { dataflow: astDataflowEnabled }) : null;
    const swiftChunks = ext === '.swift' && mode === 'code' ? buildSwiftChunks(text) : null;
    const clikeChunks = isCLike(ext) && mode === 'code' ? buildCLikeChunks(text, ext) : null;
    const rustChunks = ext === '.rs' && mode === 'code' ? buildRustChunks(text) : null;
    const goChunks = isGo(ext) && mode === 'code' ? buildGoChunks(text) : null;
    const javaChunks = isJava(ext) && mode === 'code' ? buildJavaChunks(text) : null;
    const perlChunks = isPerl(ext) && mode === 'code' ? buildPerlChunks(text) : null;
    const shellChunks = isShell(ext) && mode === 'code' ? buildShellChunks(text) : null;
    const tsChunks = isTypeScript(ext) && mode === 'code' ? buildTypeScriptChunks(text) : null;
    const csharpChunks = isCSharp(ext) && mode === 'code' ? buildCSharpChunks(text) : null;
    const kotlinChunks = isKotlin(ext) && mode === 'code' ? buildKotlinChunks(text) : null;
    const rubyChunks = isRuby(ext) && mode === 'code' ? buildRubyChunks(text) : null;
    const phpChunks = isPhp(ext) && mode === 'code' ? buildPhpChunks(text) : null;
    const luaChunks = isLua(ext) && mode === 'code' ? buildLuaChunks(text) : null;
    const sqlChunks = isSql(ext) && mode === 'code'
      ? buildSqlChunks(text, { dialect: resolveSqlDialect(ext) })
      : null;
    const lineIndex = buildLineIndex(text);
    const fileRelations = (isJsLike(ext) && mode === 'code')
      ? buildCodeRelations(text, relKey, allImports, { dataflow: astDataflowEnabled })
      : (isTypeScript(ext) && mode === 'code')
        ? buildTypeScriptRelations(text, allImports, tsChunks)
        : (ext === '.py' && mode === 'code')
          ? buildPythonRelations(text, allImports, pythonAst)
          : (ext === '.swift' && mode === 'code')
            ? buildSwiftRelations(text, allImports)
            : (isCLike(ext) && mode === 'code')
              ? buildCLikeRelations(text, allImports, clikeChunks)
              : (ext === '.rs' && mode === 'code')
                ? buildRustRelations(text, allImports)
                : (isGo(ext) && mode === 'code')
                  ? buildGoRelations(text, allImports, goChunks)
                  : (isJava(ext) && mode === 'code')
                    ? buildJavaRelations(text, allImports, javaChunks)
                    : (isCSharp(ext) && mode === 'code')
                      ? buildCSharpRelations(text, allImports, csharpChunks)
                      : (isKotlin(ext) && mode === 'code')
                        ? buildKotlinRelations(text, allImports, kotlinChunks)
                        : (isRuby(ext) && mode === 'code')
                          ? buildRubyRelations(text, allImports, rubyChunks)
                          : (isPhp(ext) && mode === 'code')
                            ? buildPhpRelations(text, allImports, phpChunks)
                            : (isLua(ext) && mode === 'code')
                              ? buildLuaRelations(text, allImports, luaChunks)
                              : (isSql(ext) && mode === 'code')
                                ? buildSqlRelations(text, allImports, sqlChunks)
                                : (isPerl(ext) && mode === 'code')
                                  ? buildPerlRelations(text, allImports, perlChunks)
                                  : (isShell(ext) && mode === 'code')
                                    ? buildShellRelations(text, allImports, shellChunks)
                                    : null;
    const sc = smartChunk({
      text,
      ext,
      relPath: relKey,
      mode,
      pythonAst,
      swiftChunks,
      clikeChunks,
      rustChunks,
      goChunks,
      javaChunks,
      perlChunks,
      shellChunks,
      tsChunks,
      csharpChunks,
      kotlinChunks,
      rubyChunks,
      phpChunks,
      luaChunks,
      sqlChunks
    });
    const fileChunks = [];

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

      // N-grams & chargrams
      const ngrams = extractNgrams(seq, 2, 4);
      const charSet = new Set();
      seq.forEach(w => {
        for (let n = 3; n <= 5; ++n) tri(w, n).forEach(g => charSet.add(g));
      });
      const chargrams = Array.from(charSet);

      // Field/path weighting
      const meta = {
        ...c.meta, ext, path: relKey, kind: c.kind, name: c.name, file: relKey, weightt: getFieldWeight(c, rel)
      };
      // Code relationships & analysis (JS/TS only)
      let codeRelations = {}, docmeta = {};
      if (mode === 'code') {
        if (isJsLike(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls
            };
          }
          docmeta = extractDocMeta(text, c, fileRelations);
        } else if (isTypeScript(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractTypeScriptDocMeta(c);
        } else if (ext === '.py') {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractPythonDocMeta(c);
        } else if (ext === '.swift') {
          if (fileRelations) {
            codeRelations = {
              ...fileRelations,
              name: c.name
            };
          }
          docmeta = extractSwiftDocMeta(c);
        } else if (isCLike(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractCLikeDocMeta(c);
        } else if (ext === '.rs') {
          if (fileRelations) {
            codeRelations = {
              ...fileRelations,
              name: c.name
            };
          }
          docmeta = extractRustDocMeta(c);
        } else if (isGo(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractGoDocMeta(c);
        } else if (isJava(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractJavaDocMeta(c);
        } else if (isCSharp(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractCSharpDocMeta(c);
        } else if (isKotlin(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractKotlinDocMeta(c);
        } else if (isRuby(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractRubyDocMeta(c);
        } else if (isPhp(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractPhpDocMeta(c);
        } else if (isLua(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractLuaDocMeta(c);
        } else if (isSql(ext)) {
          if (fileRelations) {
            codeRelations = {
              ...fileRelations,
              name: c.name
            };
          }
          docmeta = extractSqlDocMeta(c);
        } else if (isPerl(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractPerlDocMeta(c);
        } else if (isShell(ext)) {
          if (fileRelations) {
            const callsForChunk = fileRelations.calls.filter(([caller]) => caller && caller === c.name);
            codeRelations = {
              ...fileRelations,
              calls: callsForChunk.length ? callsForChunk : fileRelations.calls,
              name: c.name
            };
          }
          docmeta = extractShellDocMeta(c);
        }
      }
      // Complexity/lint
      let complexity = {}, lint = [];
      if (isJsLike(ext) && mode === 'code') {
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
      const embedding = embed_doc.map((v, i) => v + embed_code[i]);

      const mh = new SimpleMinHash();
      tokens.forEach(t => mh.update(t));
      const minhashSig = mh.hashValues;

      // Headline summary (chunk, top N tokens)
      const headline = getHeadline(c, tokens);

      // Neighboring context
      let preContext = [], postContext = [];
      if (ci > 0) preContext = text.slice(sc[ci - 1].start, sc[ci - 1].end).split('\n').slice(-contextWin);
      if (ci + 1 < sc.length) postContext = text.slice(sc[ci + 1].start, sc[ci + 1].end).split('\n').slice(0, contextWin);

      // Git meta + churn
      const gitMeta = await getGitMeta(abs, c.start, c.end);

      // External docs (for imports)
      let externalDocs = [];
      if (codeRelations.imports && codeRelations.imports.length) {
        const isPython = ext === '.py';
        const isNode = isJsLike(ext);
        const isGoLang = isGo(ext);
        for (const mod of codeRelations.imports) {
          if (mod.startsWith('.')) continue;
          if (isPython) {
            const base = mod.split('.')[0];
            if (base) externalDocs.push(`https://pypi.org/project/${base}`);
          } else if (isNode) {
            externalDocs.push(`https://www.npmjs.com/package/${mod.replace(/^@/, '')}`);
          } else if (isGoLang) {
            externalDocs.push(`https://pkg.go.dev/${mod}`);
          }
        }
      }

      const startLine = c.meta?.startLine || offsetToLine(lineIndex, c.start);
      const endLine = c.meta?.endLine || offsetToLine(lineIndex, c.end);

      const chunkPayload = {
        file: relKey,
        ext,
        start: c.start,
        end: c.end,
        startLine,
        endLine,
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
      };

      fileChunks.push(chunkPayload);
    }

    let manifestEntry = null;
    if (incrementalEnabled) {
      const cacheKey = sha1(relKey);
      const bundlePath = path.join(bundleDir, `${cacheKey}.json`);
      const bundle = {
        file: relKey,
        hash: fileHash,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        chunks: fileChunks
      };
      try {
        await fs.writeFile(bundlePath, JSON.stringify(bundle) + '\n');
        manifestEntry = {
          hash: fileHash,
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
          bundle: path.basename(bundlePath)
        };
      } catch {}
    }

    const fileDurationMs = Date.now() - fileStart;
    return {
      abs,
      relKey,
      fileIndex,
      cached: false,
      durationMs: fileDurationMs,
      chunks: fileChunks,
      manifestEntry
    };
  }

  const fileResults = await runWithConcurrency(allFiles, fileConcurrency, async (abs, fileIndex) => {
    const result = await processFile(abs, fileIndex);
    processedFiles += 1;
    showProgress('Files', processedFiles, allFiles.length);
    return result;
  });
  showProgress('Files', allFiles.length, allFiles.length);

  for (const result of fileResults) {
    if (!result) continue;
    for (const chunk of result.chunks) {
      appendChunk({ ...chunk });
    }
    scannedFilesTimes.push({ file: result.abs, duration_ms: result.durationMs, cached: result.cached });
    scannedFiles.push(result.abs);
    if (result.manifestEntry) {
      manifest.files[result.relKey] = result.manifestEntry;
    }
  }

  timing.processMs = Date.now() - processStart;

  if (incrementalEnabled) {
    for (const relKey of Object.keys(manifest.files)) {
      if (seenFiles.has(relKey)) continue;
      const entry = manifest.files[relKey];
      if (entry?.bundle) {
        const bundlePath = path.join(bundleDir, entry.bundle);
        if (fsSync.existsSync(bundlePath)) {
          try {
            await fs.rm(bundlePath);
          } catch {}
        }
      }
      delete manifest.files[relKey];
    }
    try {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } catch {}
  }
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

  log(`Using real model embeddings for dense vectors (${modelId})...`);
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

  const tokenVocab = Array.from(tokenPostings.keys());
  const tokenPostingsList = tokenVocab.map((t) => tokenPostings.get(t));
  const avgDocLen = docLengths.length
    ? docLengths.reduce((sum, len) => sum + len, 0) / docLengths.length
    : 0;

  // MinHash index (signatures)
  const minhashSigs = chunks.map(c => c.minhashSig);
  // (MinHash search logic will be in search.js)

  // Chunk meta
  const chunkMeta = chunks.map((c, i) => ({
    id: c.id,
    file: c.file,
    start: c.start,
    end: c.end,
    startLine: c.startLine,
    endLine: c.endLine,
    ext: c.ext,
    kind: c.kind,
    name: c.name,
    weight: c.weight,
    headline: c.headline,
    preContext: c.preContext,
    postContext: c.postContext,
    tokens: c.tokens,
    ngrams: c.ngrams,
    codeRelations: c.codeRelations,
    docmeta: c.docmeta,
    stats: c.stats,
    complexity: c.complexity,
    lint: c.lint,
    externalDocs: c.externalDocs,
    last_modified: c.last_modified,
    last_author: c.last_author,
    churn: c.churn,
    chunk_authors: c.chunk_authors
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
  const writeStart = Date.now();
  await Promise.all([
    fs.writeFile(path.join(OUT, 'sparse_postings_varint.bin'), postingsBin),
    fs.writeFile(
      path.join(OUT, 'dense_vectors_uint8.json'),
      JSON.stringify({ model: modelId, dims, scale: 1.0, vectors: quantizedVectors }) + '\n'
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
    ),
    fs.writeFile(
      path.join(OUT, 'token_postings.json'),
      JSON.stringify({
        vocab: tokenVocab,
        postings: tokenPostingsList,
        docLengths,
        avgDocLen,
        totalDocs: docLengths.length
      }) + '\n'
    )
  ]);
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${chunks.length.toLocaleString()} chunks, ${trimmedVocab.length.toLocaleString()} tokens, dims=${dims}`
  );

  const cacheHits = scannedFilesTimes.filter((entry) => entry.cached).length;
  const cacheMisses = scannedFilesTimes.length - cacheHits;
  const metrics = {
    generatedAt: new Date().toISOString(),
    repoRoot: path.resolve(ROOT),
    mode,
    indexDir: path.resolve(OUT),
    incremental: incrementalEnabled,
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: scannedFilesTimes.length ? cacheHits / scannedFilesTimes.length : 0
    },
    files: {
      scanned: scannedFiles.length,
      skipped: skippedFiles.length,
      candidates: allFiles.length
    },
    chunks: {
      total: chunks.length,
      avgTokens: chunks.length ? totalTokens / chunks.length : 0
    },
    tokens: {
      total: totalTokens,
      vocab: trimmedVocab.length
    },
    bm25: {
      k1,
      b,
      avgChunkLen,
      totalDocs: N
    },
    embeddings: {
      dims,
      stub: useStubEmbeddings,
      model: modelId
    },
    dictionaries: dictSummary,
    timings: timing
  };
  try {
    const metricsDir = getMetricsDir(ROOT, userConfig);
    await fs.mkdir(metricsDir, { recursive: true });
    await fs.writeFile(
      path.join(metricsDir, `index-${mode}.json`),
      JSON.stringify(metrics, null, 2)
    );
  } catch {}
}

for (const m of MODES) {
  await build(m);
}
log('\nDone.');

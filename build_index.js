#!/usr/bin/env node
/**
 * Semantic Indexer & Analyzer for JS/Node/Bash/Python/Swift/Rust/YAML & Prose (md/txt)
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
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import Snowball from 'snowball-stemmers';
import seedrandom from 'seedrandom';
import strip from 'strip-comments';
import { pipeline, env } from '@xenova/transformers';
import ignore from 'ignore';
import { DEFAULT_MODEL_ID, getDictionaryPaths, getDictConfig, getIndexDir, getMetricsDir, getModelConfig, getRepoCacheRoot, loadUserConfig } from './tools/dict-utils.js';

import * as acorn from 'acorn';
import * as esprima from 'esprima';
import * as yaml from 'yaml';
import * as varint from 'varint';

import simpleGit from 'simple-git';
import escomplex from 'escomplex';
import { ESLint } from 'eslint';

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
  '.pairofcleats.json',
  '.pairofcleatsignore',
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

const userConfig = loadUserConfig(ROOT);
const repoCacheRoot = getRepoCacheRoot(ROOT, userConfig);
const indexingConfig = userConfig.indexing || {};
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
    env.cacheDir = modelsDir;
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

const EXTS_PROSE = new Set([
  '.md', '.txt'
]);

const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);
const CLIKE_EXTS = new Set(['.c', '.h', '.cc', '.cpp', '.hpp', '.hh', '.m', '.mm']);
const OBJC_EXTS = new Set(['.m', '.mm']);
const RUST_EXTS = new Set(['.rs']);
const isJsLike = (ext) => JS_EXTS.has(ext);
const isCLike = (ext) => CLIKE_EXTS.has(ext);
const isObjc = (ext) => OBJC_EXTS.has(ext);
const isRust = (ext) => RUST_EXTS.has(ext);

const EXTS_CODE = new Set([
  '.js', '.mjs', '.cjs', '.yml', '.sh', '.html', '.py', '.swift', '.rs',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.hh', '.m', '.mm',
  // Optionally:
  // '.css', '.json'
]);

// Single global embedder
const embedderPromise = useStubEmbeddings
  ? null
  : pipeline('feature-extraction', modelId);
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
function stubEmbedding(text, dims) {
  const hash = crypto.createHash('sha256').update(text).digest();
  let seed = 0;
  for (const byte of hash) seed = (seed * 31 + byte) >>> 0;
  const vec = new Array(dims);
  let x = seed;
  for (let i = 0; i < dims; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    vec[i] = (x / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
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
async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}
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

const PYTHON_CANDIDATES = ['python', 'python3'];
let pythonExecutable = null;
let pythonChecked = false;
let pythonWarned = false;
const PYTHON_AST_SCRIPT = `
import ast, json, sys
source = sys.stdin.read()
try:
    tree = ast.parse(source)
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(0)

def safe_unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return None

def deco_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = deco_name(node.value)
        return base + "." + node.attr if base else node.attr
    if isinstance(node, ast.Call):
        return deco_name(node.func)
    return None

def call_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = call_name(node.value)
        return base + "." + node.attr if base else node.attr
    return None

def format_arg(arg, default_map):
    name = arg.arg
    ann = safe_unparse(arg.annotation) if getattr(arg, "annotation", None) is not None else None
    value = name + (": " + ann if ann else "")
    if name in default_map:
        default = safe_unparse(default_map[name]) if default_map[name] is not None else None
        value += ("=" + default) if default else "=..."
    return value

def format_args(args):
    defaults = list(args.defaults) if args.defaults else []
    default_map = {}
    if defaults and args.args:
        for arg, default in zip(args.args[-len(defaults):], defaults):
            default_map[arg.arg] = default
    if getattr(args, "kw_defaults", None) and args.kwonlyargs:
        for arg, default in zip(args.kwonlyargs, args.kw_defaults):
            if default is not None:
                default_map[arg.arg] = default

    parts = []
    for arg in getattr(args, "posonlyargs", []):
        parts.append(format_arg(arg, default_map))
    if getattr(args, "posonlyargs", []):
        parts.append("/")
    for arg in args.args:
        parts.append(format_arg(arg, default_map))
    if args.vararg:
        parts.append("*" + format_arg(args.vararg, {}))
    elif args.kwonlyargs:
        parts.append("*")
    for arg in args.kwonlyargs:
        parts.append(format_arg(arg, default_map))
    if args.kwarg:
        parts.append("**" + format_arg(args.kwarg, {}))
    return ", ".join(parts)

def format_signature(node):
    args = format_args(node.args)
    sig = "def " + node.name + "(" + args + ")"
    if getattr(node, "returns", None) is not None:
        ret = safe_unparse(node.returns)
        if ret:
            sig += " -> " + ret
    return sig

def format_class_signature(node):
    bases = [safe_unparse(b) for b in node.bases] if node.bases else []
    bases = [b for b in bases if b]
    sig = "class " + node.name
    if bases:
        sig += "(" + ", ".join(bases) + ")"
    return sig

class Collector(ast.NodeVisitor):
    def __init__(self):
        self.defs = []
        self.imports = set()
        self.calls = []
        self.usages = set()
        self.exports = set()
        self.class_stack = []
        self.func_stack = []
        self.call_map = {}
    def current_func(self):
        return self.func_stack[-1] if self.func_stack else "(module)"
    def record_def(self, node, kind, name):
        doc = ast.get_docstring(node) or ""
        decorators = []
        for d in getattr(node, "decorator_list", []):
            dn = deco_name(d)
            if dn:
                decorators.append(dn)
        params = []
        if hasattr(node, "args"):
            params = [a.arg for a in node.args.args]
        entry = {
            "kind": kind,
            "name": name,
            "startLine": getattr(node, "lineno", None),
            "startCol": getattr(node, "col_offset", None),
            "endLine": getattr(node, "end_lineno", None),
            "endCol": getattr(node, "end_col_offset", None),
            "docstring": doc,
            "decorators": decorators,
            "params": params
        }
        if kind in ("FunctionDeclaration", "MethodDeclaration"):
            entry["signature"] = format_signature(node)
            entry["returns"] = safe_unparse(node.returns) if getattr(node, "returns", None) is not None else None
        elif kind == "ClassDeclaration":
            entry["signature"] = format_class_signature(node)
        self.defs.append(entry)
    def visit_ClassDef(self, node):
        name = node.name
        qualified = ".".join(self.class_stack + [name]) if self.class_stack else name
        if not self.func_stack:
            self.exports.add(qualified)
        self.record_def(node, "ClassDeclaration", qualified)
        self.class_stack.append(name)
        self.generic_visit(node)
        self.class_stack.pop()
    def visit_FunctionDef(self, node):
        name = node.name
        qualified = ".".join(self.class_stack + [name]) if self.class_stack else name
        is_method = bool(self.class_stack)
        if not self.func_stack or is_method:
            kind = "MethodDeclaration" if is_method else "FunctionDeclaration"
            if not self.func_stack:
                self.exports.add(qualified)
            self.record_def(node, kind, qualified)
        self.func_stack.append(qualified)
        self.generic_visit(node)
        self.func_stack.pop()
    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)
    def visit_Import(self, node):
        for alias in node.names:
            self.imports.add(alias.name)
            if alias.asname:
                self.usages.add(alias.asname)
    def visit_ImportFrom(self, node):
        if node.module:
            self.imports.add(node.module)
        for alias in node.names:
            if alias.name:
                self.usages.add(alias.name)
            if alias.asname:
                self.usages.add(alias.asname)
    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self.usages.add(node.id)
    def visit_Call(self, node):
        callee = call_name(node.func)
        if callee:
            caller = self.current_func()
            self.calls.append([caller, callee])
            self.call_map.setdefault(caller, set()).add(callee)
        self.generic_visit(node)

collector = Collector()
collector.visit(tree)
for entry in collector.defs:
    calls = collector.call_map.get(entry["name"])
    entry["calls"] = sorted(calls) if calls else []
result = {
    "defs": collector.defs,
    "imports": sorted(collector.imports),
    "calls": collector.calls,
    "usages": sorted(collector.usages),
    "exports": sorted(collector.exports)
}
print(json.dumps(result))
`;

function findPythonExecutable() {
  if (pythonChecked) return pythonExecutable;
  pythonChecked = true;
  for (const candidate of PYTHON_CANDIDATES) {
    const result = spawnSync(candidate, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') {
      pythonExecutable = candidate;
      break;
    }
  }
  if (!pythonExecutable && !pythonWarned) {
    log('Python AST unavailable (python not found); using heuristic chunking for .py.');
    pythonWarned = true;
  }
  return pythonExecutable;
}

function getPythonAst(text) {
  const pythonBin = findPythonExecutable();
  if (!pythonBin) return null;
  const result = spawnSync(pythonBin, ['-c', PYTHON_AST_SCRIPT], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed && parsed.error) return null;
    return parsed;
  } catch {
    return null;
  }
}

function lineColToOffset(lineIndex, line, col) {
  const lineIdx = Math.max(1, Number(line) || 1) - 1;
  const base = lineIndex[lineIdx] ?? lineIndex[lineIndex.length - 1] ?? 0;
  return base + (Number.isFinite(Number(col)) ? Number(col) : 0);
}

function buildPythonChunksFromAst(text, astData) {
  if (!astData || !Array.isArray(astData.defs) || !astData.defs.length) return null;
  const lineIndex = buildLineIndex(text);
  const defs = astData.defs
    .filter((def) => Number.isFinite(def.startLine))
    .map((def) => ({
      ...def,
      start: lineColToOffset(lineIndex, def.startLine, def.startCol)
    }))
    .sort((a, b) => a.start - b.start);
  if (!defs.length) return null;

  const chunks = [];
  for (let i = 0; i < defs.length; i++) {
    const current = defs[i];
    const next = defs[i + 1];
    let end = null;
    if (Number.isFinite(current.endLine)) {
      end = lineColToOffset(lineIndex, current.endLine, current.endCol || 0);
    }
    if (!end || end <= current.start) {
      end = next ? next.start : text.length;
    }
    const endLine = offsetToLine(lineIndex, end);
    chunks.push({
      start: current.start,
      end,
      name: current.name,
      kind: current.kind || 'FunctionDeclaration',
      meta: {
        startLine: current.startLine,
        endLine,
        decorators: current.decorators || [],
        signature: current.signature || null,
        params: current.params || [],
        returns: current.returns || null,
        docstring: current.docstring || '',
        calls: current.calls || null
      }
    });
  }
  return chunks;
}

const SWIFT_DECL_KEYWORDS = new Set([
  'class', 'struct', 'enum', 'protocol', 'extension', 'actor',
  'func', 'init', 'deinit'
]);
const SWIFT_MODIFIERS = new Set([
  'public', 'private', 'fileprivate', 'internal', 'open', 'final', 'static',
  'class', 'mutating', 'nonmutating', 'override', 'convenience', 'required',
  'async', 'throws', 'rethrows', 'lazy', 'weak', 'unowned', 'inout'
]);
const SWIFT_KIND_MAP = {
  class: 'ClassDeclaration',
  struct: 'StructDeclaration',
  enum: 'EnumDeclaration',
  protocol: 'ProtocolDeclaration',
  extension: 'ExtensionDeclaration',
  actor: 'ActorDeclaration'
};

function normalizeSwiftName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s:]/)[0];
}

function sliceSwiftSignature(text, start, bodyStart) {
  let end = bodyStart > start ? bodyStart : text.indexOf('\n', start);
  if (end === -1) end = text.length;
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function extractSwiftModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/);
  for (const tok of tokens) {
    if (SWIFT_DECL_KEYWORDS.has(tok)) break;
    if (SWIFT_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractSwiftParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  const parts = match[1].split(',');
  for (const part of parts) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/@[A-Za-z_][A-Za-z0-9_]*(\([^)]+\))?\s*/g, '');
    seg = seg.replace(/\b(inout|borrowing|consuming)\b\s*/g, '');
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) continue;
    const left = seg.slice(0, colonIdx).trim();
    if (!left) continue;
    const names = left.split(/\s+/).filter(Boolean);
    let name = names[names.length - 1];
    if (name === '_' && names.length > 1) name = names[names.length - 2];
    if (name && name !== '_') params.push(name);
  }
  return params;
}

function extractSwiftReturns(signature) {
  const arrow = signature.indexOf('->');
  if (arrow === -1) return null;
  let ret = signature.slice(arrow + 2).trim();
  ret = ret.replace(/\bwhere\b.*/, '').trim();
  ret = ret.replace(/\{$/, '').trim();
  return ret || null;
}

function extractSwiftConforms(signature) {
  const colon = signature.indexOf(':');
  if (colon === -1) return [];
  let tail = signature.slice(colon + 1).trim();
  tail = tail.replace(/\bwhere\b.*/, '').trim();
  tail = tail.replace(/\{$/, '').trim();
  return tail.split(',').map((t) => t.trim()).filter(Boolean);
}

function extractSwiftDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const trimmed = lines[i].trim();
  if (trimmed.startsWith('///')) {
    const out = [];
    while (i >= 0 && lines[i].trim().startsWith('///')) {
      out.unshift(lines[i].trim().replace(/^\/\/\/\s?/, ''));
      i--;
    }
    return out.join('\n').trim();
  }
  if (trimmed.includes('*/')) {
    const raw = [];
    while (i >= 0) {
      raw.unshift(lines[i]);
      if (lines[i].includes('/**')) break;
      i--;
    }
    return raw
      .map((line) =>
        line
          .replace(/^\s*\/\*\*?/, '')
          .replace(/\*\/\s*$/, '')
          .replace(/^\s*\*\s?/, '')
          .trim()
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function collectSwiftAttributes(lines, startLineIdx, signature) {
  const attrs = new Set();
  const addLine = (line) => {
    for (const match of line.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) {
      attrs.add(match[1]);
    }
  };
  if (signature) addLine(signature);
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (attrs.size) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('@')) {
      addLine(trimmed);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      i--;
      continue;
    }
    break;
  }
  return Array.from(attrs);
}

function isSwiftCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function findSwiftBodyBounds(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inTripleString = false;
  let braceDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (inTripleString) {
        if (ch === '"' && text.slice(i, i + 3) === '"""') {
          inString = false;
          inTripleString = false;
          i += 2;
        }
        continue;
      }
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      if (text.slice(i, i + 3) === '"""') {
        inString = true;
        inTripleString = true;
        i += 2;
      } else {
        inString = true;
      }
      continue;
    }
    if (ch === '{') {
      if (bodyStart === -1) bodyStart = i;
      braceDepth++;
      continue;
    }
    if (ch === '}' && bodyStart !== -1) {
      braceDepth--;
      if (braceDepth === 0) {
        return { bodyStart, bodyEnd: i + 1 };
      }
    }
  }
  return { bodyStart, bodyEnd: -1 };
}

function buildSwiftChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_][A-Za-z0-9_\.]*)/gm;
  const funcRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(func)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const initRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(init|deinit)\b/gm;

  const addDecl = (kindKey, rawName, start, isType) => {
    const startLine = offsetToLine(lineIndex, start);
    const line = lines[startLine - 1] || '';
    if (isSwiftCommentLine(line)) return;
    const bounds = findSwiftBodyBounds(text, start);
    const signature = sliceSwiftSignature(text, start, bounds.bodyStart);
    const name = normalizeSwiftName(rawName) || kindKey;
    const modifiers = extractSwiftModifiers(signature);
    const attributes = collectSwiftAttributes(lines, startLine - 1, signature);
    const docstring = extractSwiftDocComment(lines, startLine - 1);
    const params = isType ? [] : extractSwiftParams(signature);
    const returns = isType ? null : extractSwiftReturns(signature);
    const conforms = isType ? extractSwiftConforms(signature) : [];
    const kind = isType
      ? (SWIFT_KIND_MAP[kindKey] || 'ClassDeclaration')
      : (kindKey === 'init' ? 'Initializer' : kindKey === 'deinit' ? 'Deinitializer' : 'FunctionDeclaration');
    decls.push({
      start,
      startLine,
      bodyStart: bounds.bodyStart,
      bodyEnd: bounds.bodyEnd,
      name,
      kind,
      isType,
      meta: {
        signature,
        params,
        returns,
        modifiers,
        attributes,
        docstring,
        conforms
      }
    });
  };

  for (const match of text.matchAll(typeRe)) {
    addDecl(match[1], match[2], match.index, true);
  }
  for (const match of text.matchAll(funcRe)) {
    addDecl(match[1], match[2], match.index, false);
  }
  for (const match of text.matchAll(initRe)) {
    addDecl(match[1], match[1], match.index, false);
  }

  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);

  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i];
    let end = decl.bodyEnd;
    if (!Number.isFinite(end) || end <= decl.start) {
      const nextStart = decls[i + 1] ? decls[i + 1].start : text.length;
      const lineEnd = lineIndex[decl.startLine] ?? text.length;
      end = Math.min(nextStart, lineEnd);
    }
    if (end <= decl.start) end = decls[i + 1] ? decls[i + 1].start : text.length;
    decl.end = end;
    decl.endLine = offsetToLine(lineIndex, end);
    decl.meta = { ...decl.meta, startLine: decl.startLine, endLine: decl.endLine };
  }

  const typeDecls = decls.filter((d) => d.isType);
  const findParent = (start) => {
    let parent = null;
    for (const type of typeDecls) {
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  const chunks = [];
  for (const decl of decls) {
    if (!decl.name) continue;
    let name = decl.name;
    let kind = decl.kind;
    if (!decl.isType) {
      const parent = findParent(decl.start);
      if (parent && parent.name) {
        name = `${parent.name}.${name}`;
        if (kind === 'FunctionDeclaration') kind = 'MethodDeclaration';
      }
    }
    chunks.push({
      start: decl.start,
      end: decl.end,
      name,
      kind,
      meta: decl.meta
    });
  }
  return chunks;
}

const CLIKE_TYPE_MAP = {
  class: 'ClassDeclaration',
  struct: 'StructDeclaration',
  enum: 'EnumDeclaration',
  union: 'UnionDeclaration'
};
const OBJC_TYPE_MAP = {
  interface: 'InterfaceDeclaration',
  implementation: 'ImplementationDeclaration',
  protocol: 'ProtocolDeclaration'
};
const CLIKE_SKIP_PREFIXES = new Set([
  'if', 'for', 'while', 'switch', 'return', 'case', 'do', 'else',
  'typedef', 'struct', 'class', 'enum', 'union', 'namespace'
]);
const CLIKE_MODIFIERS = new Set([
  'static', 'inline', 'constexpr', 'virtual', 'explicit', 'extern', 'const',
  'volatile', 'friend', 'register'
]);

function normalizeCLikeTypeName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s:]/)[0];
}

function normalizeCLikeFuncName(raw) {
  if (!raw) return '';
  return raw.split(/[<\s]/)[0];
}

function findCLikeBodyBounds(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  let braceDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (inChar) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '\'') inChar = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '\'') {
      inChar = true;
      continue;
    }
    if (ch === '{') {
      if (bodyStart === -1) bodyStart = i;
      braceDepth++;
      continue;
    }
    if (ch === '}' && bodyStart !== -1) {
      braceDepth--;
      if (braceDepth === 0) {
        return { bodyStart, bodyEnd: i + 1 };
      }
    }
  }
  return { bodyStart, bodyEnd: -1 };
}

function findObjcEnd(text, start) {
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (text.slice(i, i + 4) === '@end') {
      return i + 4;
    }
  }
  return -1;
}

function parseObjcSelector(signature) {
  const cleaned = signature.replace(/^[\s+-]+/, '');
  const match = cleaned.match(/\)\s*([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
  if (!match) return '';
  const rest = match[1] + (match[2] || '');
  const parts = [];
  for (const seg of rest.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    parts.push(seg[1]);
  }
  if (parts.length) return `${parts.join(':')}:`;
  return match[1] || '';
}

function extractObjcParams(signature) {
  const params = [];
  for (const match of signature.matchAll(/:\s*\([^)]*\)\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    params.push(match[1]);
  }
  return params;
}

function extractObjcReturns(signature) {
  const match = signature.match(/^[\s+-]*\(\s*([^)]+)\s*\)/);
  return match ? match[1].trim() : null;
}

function extractObjcConforms(signature) {
  const match = signature.match(/<([^>]+)>/);
  if (!match) return [];
  return match[1].split(',').map((t) => t.trim()).filter(Boolean);
}

function extractCLikeModifiers(signature) {
  const mods = [];
  const tokens = signature.split(/\s+/);
  for (const tok of tokens) {
    if (CLIKE_MODIFIERS.has(tok)) mods.push(tok);
  }
  return mods;
}

function extractCLikeParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const parts = match[1].split(',');
  const params = [];
  for (const part of parts) {
    let seg = part.trim();
    if (!seg) continue;
    seg = seg.replace(/=[^,]+$/, '').trim();
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    let name = tokens[tokens.length - 1];
    name = name.replace(/[*&]+/g, '').replace(/\[.*\]$/, '');
    if (/^[A-Za-z_]/.test(name)) params.push(name);
  }
  return params;
}

function parseCLikeSignature(signature) {
  const idx = signature.indexOf('(');
  if (idx === -1) return { name: '', returns: null };
  const before = signature.slice(0, idx).replace(/\s+/g, ' ').trim();
  const match = before.match(/([A-Za-z_][A-Za-z0-9_:]*)$/);
  if (!match) return { name: '', returns: null };
  const name = match[1];
  const returns = before.slice(0, match.index).trim() || null;
  return { name, returns };
}

function readSignatureLines(lines, startLine) {
  const parts = [];
  let hasBrace = false;
  let hasSemi = false;
  let endLine = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    parts.push(line.trim());
    if (line.includes('{')) {
      hasBrace = true;
      endLine = i;
      break;
    }
    if (line.includes(';')) {
      hasSemi = true;
      endLine = i;
      break;
    }
    endLine = i;
  }
  const signature = parts.join(' ');
  const braceIdx = signature.indexOf('{');
  const semiIdx = signature.indexOf(';');
  const hasBody = hasBrace && (semiIdx === -1 || braceIdx !== -1 && braceIdx < semiIdx);
  return { signature, endLine, hasBody };
}

function collectCLikeImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

function buildCLikeChunks(text, ext) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];
  const objc = isObjc(ext);

  const addDecl = (entry, isType = false) => {
    decls.push(entry);
    if (isType) typeDecls.push(entry);
  };

  const typeRe = /^\s*(typedef\s+)?(struct|class|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const match of text.matchAll(typeRe)) {
    const start = match.index;
    const startLine = offsetToLine(lineIndex, start);
    const line = lines[startLine - 1] || '';
    if (isCLike(ext) && isSwiftCommentLine(line)) continue;
    const bounds = findCLikeBodyBounds(text, start);
    if (!Number.isFinite(bounds.bodyStart) || bounds.bodyStart === -1) continue;
    const signature = sliceSwiftSignature(text, start, bounds.bodyStart);
    const name = normalizeCLikeTypeName(match[3]);
    if (!name) continue;
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    const endLine = offsetToLine(lineIndex, end);
    const kind = CLIKE_TYPE_MAP[match[2]] || 'ClassDeclaration';
    addDecl({
      start,
      end,
      name,
      kind,
      meta: {
        startLine,
        endLine,
        signature,
        modifiers: extractCLikeModifiers(signature),
        docstring: extractSwiftDocComment(lines, startLine - 1),
        conforms: extractSwiftConforms(signature)
      }
    }, true);
  }

  if (objc) {
    const objcTypeRe = /^\s*@(?:(interface|implementation|protocol))\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
    for (const match of text.matchAll(objcTypeRe)) {
      const start = match.index;
      const startLine = offsetToLine(lineIndex, start);
      const end = findObjcEnd(text, start);
      const endLine = end > start ? offsetToLine(lineIndex, end) : startLine;
      const signature = sliceSwiftSignature(text, start, end);
      const name = normalizeCLikeTypeName(match[2]);
      if (!name) continue;
      const kind = OBJC_TYPE_MAP[match[1]] || 'InterfaceDeclaration';
      addDecl({
        start,
        end: end > start ? end : start,
        name,
        kind,
        meta: {
          startLine,
          endLine,
          signature,
          docstring: extractSwiftDocComment(lines, startLine - 1),
          conforms: extractObjcConforms(signature)
        }
      }, true);
    }
  }

  const findParent = (start, kinds) => {
    let parent = null;
    for (const type of typeDecls) {
      if (kinds && !kinds.has(type.kind)) continue;
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    if (objc && (trimmed.startsWith('-') || trimmed.startsWith('+'))) {
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const selector = parseObjcSelector(signature);
      if (!selector) {
        i = endLine;
        continue;
      }
      const start = lineIndex[i] + line.indexOf(trimmed);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const startLine = i + 1;
      const endLineNum = offsetToLine(lineIndex, end);
      const parent = findParent(start, new Set(['InterfaceDeclaration', 'ImplementationDeclaration', 'ProtocolDeclaration']));
      const name = parent && parent.name ? `${parent.name}.${selector}` : selector;
      const modifiers = trimmed.startsWith('+') ? ['class'] : [];
      addDecl({
        start,
        end,
        name,
        kind: 'MethodDeclaration',
        meta: {
          startLine,
          endLine: endLineNum,
          signature,
          params: extractObjcParams(signature),
          returns: extractObjcReturns(signature),
          docstring: extractSwiftDocComment(lines, i - 1),
          attributes: collectSwiftAttributes(lines, i - 1, signature),
          modifiers
        }
      });
      i = endLine;
      continue;
    }

    if (!trimmed.includes('(')) continue;
    const prefix = trimmed.split(/\s+/)[0];
    if (CLIKE_SKIP_PREFIXES.has(prefix)) continue;
    if (trimmed.startsWith('@') || trimmed.startsWith('-') || trimmed.startsWith('+')) continue;

    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    if (!hasBody) {
      i = endLine;
      continue;
    }
    const { name: rawName, returns } = parseCLikeSignature(signature);
    if (!rawName) {
      i = endLine;
      continue;
    }
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = findCLikeBodyBounds(text, start);
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const startLine = i + 1;
    const endLineNum = offsetToLine(lineIndex, end);
    let name = normalizeCLikeFuncName(rawName);
    const parent = findParent(start, new Set(['ClassDeclaration', 'StructDeclaration', 'UnionDeclaration']));
    if (parent && parent.name && !name.includes('::')) {
      name = `${parent.name}.${name}`;
    }
    addDecl({
      start,
      end,
      name,
      kind: 'FunctionDeclaration',
      meta: {
        startLine,
        endLine: endLineNum,
        signature,
        params: extractCLikeParams(signature),
        returns,
        modifiers: extractCLikeModifiers(signature),
        docstring: extractSwiftDocComment(lines, i - 1)
      }
    });
    i = endLine;
  }

  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
}

function buildCLikeRelations(text, allImports) {
  const imports = collectCLikeImports(text);
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: [],
    calls: [],
    usages: [],
    importLinks
  };
}

function extractRustDocComment(lines, startLineIdx) {
  let i = startLineIdx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return '';
  const trimmed = lines[i].trim();
  if (trimmed.startsWith('///') || trimmed.startsWith('//!')) {
    const out = [];
    while (i >= 0) {
      const line = lines[i].trim();
      if (!line.startsWith('///') && !line.startsWith('//!')) break;
      out.unshift(line.replace(/^\/\/[!/]\s?/, ''));
      i--;
    }
    return out.join('\n').trim();
  }
  if (trimmed.includes('*/')) {
    const raw = [];
    while (i >= 0) {
      raw.unshift(lines[i]);
      if (lines[i].includes('/**') || lines[i].includes('/*!')) break;
      i--;
    }
    return raw
      .map((line) =>
        line
          .replace(/^\s*\/\*+!?/, '')
          .replace(/\*\/\s*$/, '')
          .replace(/^\s*\*\s?/, '')
          .trim()
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function collectRustAttributes(lines, startLineIdx, signature) {
  const attrs = new Set();
  const addLine = (line) => {
    for (const match of line.matchAll(/#\s*\[\s*([A-Za-z_][A-Za-z0-9_:]*)/g)) {
      attrs.add(match[1]);
    }
  };
  if (signature) addLine(signature);
  let i = startLineIdx - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (attrs.size) break;
      i--;
      continue;
    }
    if (trimmed.startsWith('#[')) {
      addLine(trimmed);
      i--;
      continue;
    }
    if (trimmed.startsWith('///') || trimmed.startsWith('//!') || trimmed.startsWith('/*')
      || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      i--;
      continue;
    }
    break;
  }
  return Array.from(attrs);
}

function extractRustModifiers(signature) {
  const mods = [];
  const pubMatch = signature.match(/\bpub(?:\([^)]+\))?/);
  if (pubMatch) mods.push(pubMatch[0]);
  if (/\basync\b/.test(signature)) mods.push('async');
  if (/\bunsafe\b/.test(signature)) mods.push('unsafe');
  if (/\bconst\b/.test(signature)) mods.push('const');
  return mods;
}

function extractRustParams(signature) {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return [];
  const params = [];
  for (const part of match[1].split(',')) {
    let seg = part.trim();
    if (!seg) continue;
    if (/\bself\b/.test(seg)) {
      params.push('self');
      continue;
    }
    seg = seg.replace(/^&\s*/, '').replace(/\bmut\s+/, '');
    const namePart = seg.split(':')[0].trim();
    if (!namePart) continue;
    const tokens = namePart.split(/\s+/).filter(Boolean);
    let name = tokens[tokens.length - 1];
    if (!name || name === '_') continue;
    name = name.replace(/[()]/g, '');
    params.push(name);
  }
  return params;
}

function extractRustReturns(signature) {
  const arrow = signature.indexOf('->');
  if (arrow === -1) return null;
  let ret = signature.slice(arrow + 2);
  ret = ret.replace(/\{.*$/, '').replace(/\bwhere\b.*/, '').replace(/;.*$/, '').trim();
  return ret || null;
}

function normalizeRustTypeName(raw) {
  if (!raw) return '';
  let name = raw.trim();
  name = name.replace(/^[<\s]+/, '');
  name = name.replace(/<.*$/, '');
  name = name.replace(/\bwhere\b.*/, '');
  name = name.replace(/[^A-Za-z0-9_:]/g, '');
  return name;
}

function parseRustImplTarget(signature) {
  let rest = signature.replace(/^\s*pub(?:\([^)]+\))?\s+/, '').trim();
  rest = rest.replace(/^\s*impl\s+/, '');
  rest = rest.replace(/\{.*$/, '').trim();
  const forMatch = rest.match(/\bfor\s+([A-Za-z_][A-Za-z0-9_:<>]*)/);
  if (forMatch) return normalizeRustTypeName(forMatch[1]);
  const match = rest.match(/([A-Za-z_][A-Za-z0-9_:<>]*)\s*(?:where\b|$)/);
  return match ? normalizeRustTypeName(match[1]) : '';
}

function collectRustImports(text) {
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    let match = trimmed.match(/^(?:pub\s+)?use\s+([^;]+);/);
    if (match) {
      let path = match[1].split(/\s+as\s+/)[0].trim();
      path = path.replace(/\{.*\}/, '').replace(/::\*$/, '').replace(/::\s*$/, '').trim();
      if (path) imports.add(path);
      continue;
    }
    match = trimmed.match(/^extern\s+crate\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) imports.add(match[1]);
  }
  return Array.from(imports);
}

function buildRustChunks(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];
  const implBlocks = [];
  const typeRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?(struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const implRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?impl\b/;
  const fnRe = /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const match = trimmed.match(typeRe);
    if (!match) continue;
    const start = lineIndex[i] + line.indexOf(match[0]);
    const bounds = findCLikeBodyBounds(text, start);
    let end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    if (bounds.bodyStart === -1) {
      end = lineIndex[i] + line.length;
    }
    const kindMap = {
      struct: 'StructDeclaration',
      enum: 'EnumDeclaration',
      trait: 'TraitDeclaration',
      mod: 'ModuleDeclaration'
    };
    const kind = kindMap[match[1]] || 'StructDeclaration';
    const signature = sliceSwiftSignature(text, start, bounds.bodyStart);
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      modifiers: extractRustModifiers(signature),
      docstring: extractRustDocComment(lines, i),
      attributes: collectRustAttributes(lines, i, signature)
    };
    const entry = { start, end, name: match[2], kind, meta };
    decls.push(entry);
    if (kind !== 'ModuleDeclaration') typeDecls.push(entry);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    if (!implRe.test(trimmed)) continue;
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = findCLikeBodyBounds(text, start);
    if (bounds.bodyStart === -1) continue;
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
    const signature = sliceSwiftSignature(text, start, bounds.bodyStart);
    const typeName = parseRustImplTarget(signature);
    if (!typeName) continue;
    const entry = {
      start,
      end,
      name: typeName,
      kind: 'ImplDeclaration',
      meta: {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, end),
        signature,
        modifiers: extractRustModifiers(signature),
        docstring: extractRustDocComment(lines, i),
        attributes: collectRustAttributes(lines, i, signature),
        implFor: typeName
      }
    };
    implBlocks.push(entry);
    decls.push(entry);
  }

  const allParents = [...typeDecls, ...implBlocks];
  const findParent = (start) => {
    let parent = null;
    for (const type of allParents) {
      if (type.start < start && type.end > start) {
        if (!parent || type.start > parent.start) parent = type;
      }
    }
    return parent;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const fnMatch = trimmed.match(fnRe);
    if (!fnMatch) continue;
    const { signature, endLine, hasBody } = readSignatureLines(lines, i);
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const parent = findParent(start);
    let name = fnMatch[1];
    let kind = 'FunctionDeclaration';
    if (parent && parent.name) {
      if (parent.kind === 'ImplDeclaration' || parent.kind === 'TraitDeclaration' || parent.kind === 'StructDeclaration') {
        name = `${parent.name}.${name}`;
        kind = 'MethodDeclaration';
      }
    }
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature,
      params: extractRustParams(signature),
      returns: extractRustReturns(signature),
      modifiers: extractRustModifiers(signature),
      docstring: extractRustDocComment(lines, i),
      attributes: collectRustAttributes(lines, i, signature)
    };
    decls.push({ start, end, name, kind, meta });
    i = endLine;
  }

  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
}

function buildRustRelations(text, allImports) {
  const imports = collectRustImports(text);
  const exportRe = /^\s*pub(?:\([^)]+\))?\s+(struct|enum|trait|fn|mod|const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const exports = new Set();
  for (const match of text.matchAll(exportRe)) {
    exports.add(match[2]);
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages: [],
    importLinks
  };
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
function smartChunk({ text, ext, mode, pythonAst = null, swiftChunks = null, clikeChunks = null, rustChunks = null }) {
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
  if (mode === 'code' && isJsLike(ext)) {
    try {
      const ast = acorn.parse(text, { ecmaVersion: 'latest', locations: true, sourceType: 'module' });
      const chunks = [];
      const locMeta = (node) => node && node.loc ? {
        startLine: node.loc.start.line,
        endLine: node.loc.end.line
      } : {};
      const keyName = (key) => {
        if (!key) return 'anonymous';
        if (key.type === 'Identifier') return key.name;
        if (key.type === 'Literal') return String(key.value);
        if (key.type === 'PrivateIdentifier') return `#${key.name}`;
        return 'computed';
      };
      const addChunk = (node, name, kind) => {
        if (!node) return;
        chunks.push({
          start: node.start,
          end: node.end,
          name: name || 'anonymous',
          kind,
          meta: { ...locMeta(node) }
        });
      };

      const addFunctionFromDeclarator = (decl, kind) => {
        if (!decl || !decl.init) return;
        const init = decl.init;
        if (init.type !== 'FunctionExpression' && init.type !== 'ArrowFunctionExpression') return;
        const name = decl.id && decl.id.name ? decl.id.name : 'anonymous';
        const derivedKind = init.type === 'FunctionExpression' ? 'FunctionExpression' : 'ArrowFunction';
        addChunk(decl, name, kind || derivedKind);
      };

      const addFunctionFromAssignment = (expr, kind) => {
        if (!expr || expr.type !== 'AssignmentExpression') return;
        const right = expr.right;
        if (!right || (right.type !== 'FunctionExpression' && right.type !== 'ArrowFunctionExpression')) return;
        let name = 'anonymous';
        if (expr.left && expr.left.type === 'MemberExpression') {
          const obj = expr.left.object?.name || '';
          const prop = keyName(expr.left.property);
          name = obj ? `${obj}.${prop}` : prop;
        }
        addChunk(expr, name, kind);
      };

      for (const node of ast.body) {
        // FunctionDeclaration
        if (node.type === 'FunctionDeclaration') {
          addChunk(node, node.id ? node.id.name : 'anonymous', 'FunctionDeclaration');
        }

        // ClassDeclaration + MethodDefinitions inside
        if (node.type === 'ClassDeclaration') {
          const className = node.id ? node.id.name : 'anonymous';
          addChunk(node, className, 'ClassDeclaration');
          if (node.body && node.body.body) {
            for (const method of node.body.body) {
              if (method.type === 'MethodDefinition' && method.key && method.value) {
                addChunk(method, `${className}.${keyName(method.key)}`, 'MethodDefinition');
              }
              if (method.type === 'PropertyDefinition' && method.key && method.value &&
                (method.value.type === 'FunctionExpression' || method.value.type === 'ArrowFunctionExpression')) {
                addChunk(method, `${className}.${keyName(method.key)}`, 'ClassPropertyFunction');
              }
            }
          }
        }

        // ExportNamedDeclaration → FunctionDeclaration or VariableDeclaration  
        if (node.type === 'ExportNamedDeclaration' && node.declaration) {       
          if (node.declaration.type === 'FunctionDeclaration') {
            addChunk(node.declaration, node.declaration.id ? node.declaration.id.name : 'anonymous', 'ExportedFunction');
          }
          if (node.declaration.type === 'VariableDeclaration') {
            for (const decl of node.declaration.declarations) {
              const init = decl.init;
              if (!init) continue;
              const exportKind = init.type === 'FunctionExpression'
                ? 'ExportedFunctionExpression'
                : 'ExportedArrowFunction';
              addFunctionFromDeclarator(decl, exportKind);
            }
          }
          if (node.declaration.type === 'ClassDeclaration') {
            addChunk(node.declaration, node.declaration.id ? node.declaration.id.name : 'anonymous', 'ExportedClass');
          }
        }

        // VariableDeclaration → ArrowFunctionExpression
        if (node.type === 'VariableDeclaration') {
          for (const decl of node.declarations) {
            addFunctionFromDeclarator(decl);
          }
        }

        // ExportDefaultDeclaration → function/class/expression
        if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
          const decl = node.declaration;
          if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
            const name = decl.id ? decl.id.name : 'default';
            addChunk(decl, name, `ExportDefault${decl.type}`);
          } else if (decl.type === 'FunctionExpression' || decl.type === 'ArrowFunctionExpression') {
            addChunk(decl, 'default', 'ExportDefaultFunction');
          }
        }

        // module.exports / exports.* = function
        if (node.type === 'ExpressionStatement' && node.expression) {
          addFunctionFromAssignment(node.expression, 'ExportedAssignmentFunction');
        }
      }

      if (!chunks.length) return [{ start: 0, end: text.length, name: 'root', kind: 'Module', meta: {} }];
      return chunks;
    } catch (e) {
      // Fallback below
    }
  }
  if (mode === 'code' && ext === '.py') {
    const astChunks = buildPythonChunksFromAst(text, pythonAst);
    if (astChunks && astChunks.length) return astChunks;
    const lineIndex = buildLineIndex(text);
    const defs = [];
    const classStack = [];
    const indentValue = (prefix) => prefix.replace(/\t/g, '    ').length;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^([ \t]*)(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (!match) continue;
      const indent = indentValue(match[1]);
      while (classStack.length && indent <= classStack[classStack.length - 1].indent) {
        classStack.pop();
      }
      const kind = match[2] === 'class' ? 'ClassDeclaration' : 'FunctionDeclaration';
      let name = match[3];
      if (kind === 'ClassDeclaration') {
        classStack.push({ name, indent });
      } else if (classStack.length && indent > classStack[classStack.length - 1].indent) {
        name = `${classStack[classStack.length - 1].name}.${name}`;
      }
      defs.push({
        start: lineIndex[i],
        startLine: i + 1,
        indent,
        name,
        kind
      });
    }
    if (defs.length) {
      const chunks = [];
      for (let i = 0; i < defs.length; i++) {
        const current = defs[i];
        let end = text.length;
        for (let j = i + 1; j < defs.length; j++) {
          if (defs[j].indent <= current.indent) {
            end = defs[j].start;
            break;
          }
        }
        const endLine = offsetToLine(lineIndex, end);
        chunks.push({
          start: current.start,
          end,
          name: current.name,
          kind: current.kind,
          meta: { startLine: current.startLine, endLine }
        });
      }
      return chunks;
    }
  }
  if (mode === 'code' && ext === '.swift') {
    const chunkList = swiftChunks || buildSwiftChunks(text);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isCLike(ext)) {
    const chunkList = clikeChunks || buildCLikeChunks(text, ext);
    if (chunkList && chunkList.length) return chunkList;
  }
  if (mode === 'code' && isRust(ext)) {
    const chunkList = rustChunks || buildRustChunks(text);
    if (chunkList && chunkList.length) return chunkList;
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
  if (fileExt(file) === '.py') return 1.2;
  if (fileExt(file) === '.swift') return 1.2;
  if (fileExt(file) === '.rs') return 1.2;
  if (isCLike(fileExt(file))) return 1.1;
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
  const imports = new Set();
  const exports = new Set();
  const calls = [];
  const usages = new Set();
  const functionStack = [];
  const classStack = [];

  const keyName = (key) => {
    if (!key) return 'anonymous';
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
    if (key.type === 'PrivateIdentifier') return `#${key.name}`;
    return 'computed';
  };

  const getMemberName = (node) => {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'Super') return 'super';
    if (node.type === 'MemberExpression') {
      const obj = getMemberName(node.object);
      const prop = node.computed
        ? (node.property?.type === 'Literal' ? String(node.property.value) : null)
        : (node.property?.name || null);
      if (obj && prop) return `${obj}.${prop}`;
      return obj || prop;
    }
    return null;
  };

  const getCalleeName = (callee) => {
    if (!callee) return null;
    if (callee.type === 'ChainExpression') return getCalleeName(callee.expression);
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') return getMemberName(callee);
    if (callee.type === 'Super') return 'super';
    return null;
  };

  const inferFunctionName = (node, parent) => {
    if (node.id && node.id.name) return node.id.name;
    if (parent && parent.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
    if (parent && parent.type === 'AssignmentExpression') {
      const left = getMemberName(parent.left);
      if (left) return left;
    }
    if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    if (parent && parent.type === 'MethodDefinition' && parent.key) {
      const propName = keyName(parent.key);
      const className = classStack[classStack.length - 1];
      return className ? `${className}.${propName}` : propName;
    }
    return '(anonymous)';
  };

  const isFunctionNode = (node) =>
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression';

  const walk = (node, parent) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, parent));
      return;
    }
    if (typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration') {
      if (node.source?.value) imports.add(node.source.value);
      node.specifiers?.forEach((s) => {
        if (s.local?.name) usages.add(s.local.name);
      });
    }

    if (node.type === 'ImportExpression' && node.source?.type === 'Literal') {
      if (typeof node.source.value === 'string') imports.add(node.source.value);
    }

    if (node.type === 'ExportAllDeclaration') {
      exports.add('*');
    }

    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        if (node.declaration.id?.name) exports.add(node.declaration.id.name);
        if (node.declaration.declarations) {
          node.declaration.declarations.forEach((d) => d.id?.name && exports.add(d.id.name));
        }
      }
      node.specifiers?.forEach((s) => {
        if (s.exported?.name) exports.add(s.exported.name);
      });
    }

    if (node.type === 'ExportDefaultDeclaration') {
      if (node.declaration?.id?.name) exports.add(node.declaration.id.name);
      else exports.add('default');
    }

    if (node.type === 'AssignmentExpression') {
      const left = getMemberName(node.left);
      if (left === 'module.exports') exports.add('default');
      if (left && left.startsWith('exports.')) exports.add(left.slice('exports.'.length));
    }

    if (node.type === 'CallExpression') {
      const calleeName = getCalleeName(node.callee);
      const currentFn = functionStack.length ? functionStack[functionStack.length - 1] : '(module)';
      if (calleeName) calls.push([currentFn, calleeName]);

      if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        const arg = node.arguments?.[0];
        if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
          imports.add(arg.value);
        }
      }
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const className = node.id?.name || 'anonymous';
      classStack.push(className);
      walk(node.body, node);
      classStack.pop();
      return;
    }

    if (node.type === 'MethodDefinition') {
      const className = classStack[classStack.length - 1];
      const methodName = className ? `${className}.${keyName(node.key)}` : keyName(node.key);
      functionStack.push(methodName);
      walk(node.value, node);
      functionStack.pop();
      return;
    }

    if (isFunctionNode(node)) {
      const fnName = inferFunctionName(node, parent);
      functionStack.push(fnName);
      walk(node.body, node);
      functionStack.pop();
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        walk(child, node);
      }
    }
  };

  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    walk(ast, null);
    // Usages: look for identifiers
    const tokens = esprima.tokenize(text, { tolerant: true });
    tokens.forEach(t => {
      if (t.type === 'Identifier') usages.add(t.value);
    });
  } catch {}
  // Cross-file import links
  const importLinks = Array.from(imports)
    .map(i => allImports[i])
    .filter(x => !!x)
    .flat();
  return {
    imports: Array.from(imports),
    exports: Array.from(exports),
    calls,
    usages: Array.from(usages),
    importLinks
  };
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

function extractPythonDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.decorators) ? meta.decorators : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators
  };
}

function extractSwiftDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const conforms = Array.isArray(meta.conforms) ? meta.conforms : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers,
    conforms
  };
}

function extractCLikeDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  const conforms = Array.isArray(meta.conforms) ? meta.conforms : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers,
    conforms
  };
}

function extractRustDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const attributes = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returns: meta.returns || null,
    signature: meta.signature || null,
    decorators: attributes,
    modifiers
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

function collectImports(text) {
  const imports = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

    if (node.type === 'ImportDeclaration' && node.source?.value) {
      imports.add(node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source?.type === 'Literal') {
      if (typeof node.source.value === 'string') imports.add(node.source.value);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' &&
      node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
        imports.add(arg.value);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (child && typeof child === 'object') walk(child);
    }
  };

  try {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
    walk(ast);
  } catch {}

  return Array.from(imports);
}

function collectPythonImports(text) {
  const imports = new Set();
  const usages = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/^import\s+(.+)$/);
    if (match) {
      const parts = match[1].split(',').map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        const [moduleName, alias] = part.split(/\s+as\s+/);
        if (moduleName) imports.add(moduleName);
        if (alias) usages.add(alias);
      }
      continue;
    }
    match = trimmed.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)$/);
    if (match) {
      imports.add(match[1]);
      const names = match[2].split(',').map(p => p.trim()).filter(Boolean);
      for (const namePart of names) {
        const [name, alias] = namePart.split(/\s+as\s+/);
        if (name) usages.add(name);
        if (alias) usages.add(alias);
      }
    }
  }
  return { imports: Array.from(imports), usages: Array.from(usages) };
}

function collectSwiftImports(text) {
  const imports = new Set();
  const usages = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const match = trimmed.match(/^(?:@testable\s+)?import\s+([A-Za-z0-9_\.]+)/);
    if (!match) continue;
    imports.add(match[1]);
    const leaf = match[1].split('.').pop();
    if (leaf) usages.add(leaf);
  }
  return { imports: Array.from(imports), usages: Array.from(usages) };
}

function buildPythonRelations(text, allImports, pythonAst) {
  let imports = [];
  let usages = [];
  let calls = [];
  let exports = [];
  if (pythonAst) {
    imports = Array.isArray(pythonAst.imports) ? pythonAst.imports : [];
    usages = Array.isArray(pythonAst.usages) ? pythonAst.usages : [];
    calls = Array.isArray(pythonAst.calls) ? pythonAst.calls : [];
    exports = Array.isArray(pythonAst.exports) ? pythonAst.exports : [];
  } else {
    const fallback = collectPythonImports(text);
    imports = fallback.imports;
    usages = fallback.usages;
  }
  const importLinks = imports
    .map(i => allImports[i])
    .filter(x => !!x)
    .flat();
  return {
    imports,
    exports,
    calls,
    usages,
    importLinks
  };
}

function buildSwiftRelations(text, allImports) {
  const { imports, usages } = collectSwiftImports(text);
  const exports = new Set();
  const declRe = /^\s*(?:@[\w().,:]+\s+)*(?:[A-Za-z]+\s+)*(class|struct|enum|protocol|extension|actor|func)\s+([A-Za-z_][A-Za-z0-9_\.]*)/gm;
  for (const match of text.matchAll(declRe)) {
    const indent = match[0].match(/^\s*/)?.[0] ?? '';
    if (indent.length) continue;
    const name = normalizeSwiftName(match[2]);
    if (name) exports.add(name);
  }
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports: Array.from(exports),
    calls: [],
    usages,
    importLinks
  };
}

// --- EMBEDDING ---
async function getChunkEmbedding(text) {
  if (useStubEmbeddings) {
    const dims = Math.max(1, Number(argv.dims) || 384);
    return stubEmbedding(text, dims);
  }
  const embedder = await embedderPromise;
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

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

function buildLineIndex(text) {
  const index = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') index.push(i + 1);
  }
  return index;
}

function offsetToLine(lineIndex, offset) {
  let lo = 0;
  let hi = lineIndex.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineIndex[mid] <= offset) {
      if (mid === lineIndex.length - 1 || lineIndex[mid + 1] > offset) {
        return mid + 1;
      }
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return 1;
}

// --- MAIN INDEXER ---
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
  const toPosix = (p) => p.split(path.sep).join('/');
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
      } else if (((mode === 'prose' && EXTS_PROSE.has(fileExt(p))) ||
          (mode === 'code' && EXTS_CODE.has(fileExt(p))))) {
        arr.push(p);
      } else {
        skippedFiles.push(p);
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
    const ext = fileExt(allFiles[i]);
    const pythonAst = ext === '.py' && mode === 'code' ? getPythonAst(text) : null;
    const swiftChunks = ext === '.swift' && mode === 'code' ? buildSwiftChunks(text) : null;
    const clikeChunks = isCLike(ext) && mode === 'code' ? buildCLikeChunks(text, ext) : null;
    const rustChunks = ext === '.rs' && mode === 'code' ? buildRustChunks(text) : null;
    const chunks0 = smartChunk({ text, ext, mode, pythonAst, swiftChunks, clikeChunks, rustChunks });
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

  async function processFile(abs, fileIndex) {
    const fileStart = Date.now();
    const rel = path.relative(ROOT, abs);
    const relKey = toPosix(rel);
    seenFiles.add(relKey);
    const ext = fileExt(abs);
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

    const pythonAst = ext === '.py' && mode === 'code' ? getPythonAst(text) : null;
    const swiftChunks = ext === '.swift' && mode === 'code' ? buildSwiftChunks(text) : null;
    const clikeChunks = isCLike(ext) && mode === 'code' ? buildCLikeChunks(text, ext) : null;
    const rustChunks = ext === '.rs' && mode === 'code' ? buildRustChunks(text) : null;
    const lineIndex = buildLineIndex(text);
    const fileRelations = (isJsLike(ext) && mode === 'code')
      ? buildCodeRelations(text, relKey, allImports)
      : (ext === '.py' && mode === 'code')
        ? buildPythonRelations(text, allImports, pythonAst)
        : (ext === '.swift' && mode === 'code')
          ? buildSwiftRelations(text, allImports)
          : (isCLike(ext) && mode === 'code')
            ? buildCLikeRelations(text, allImports)
            : (ext === '.rs' && mode === 'code')
              ? buildRustRelations(text, allImports)
        : null;
    const sc = smartChunk({ text, ext, mode, pythonAst, swiftChunks, clikeChunks, rustChunks });
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
          docmeta = extractDocMeta(text, c);
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
            codeRelations = {
              ...fileRelations,
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
        for (const mod of codeRelations.imports) {
          if (mod.startsWith('.')) continue;
          if (isPython) {
            const base = mod.split('.')[0];
            if (base) externalDocs.push(`https://pypi.org/project/${base}`);
          } else {
            externalDocs.push(`https://www.npmjs.com/package/${mod.replace(/^@/, '')}`);
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

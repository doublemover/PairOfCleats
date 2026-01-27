#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(root, '.testCache', 'lsp-enrichment');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
const binRoot = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const cppSource = 'int add(int a, int b) { return a + b; }\n';
const swiftSource = 'func greet(name: String, count: Int) -> String { return "hi" }\n';
const pythonSource = 'def greet(name: str) -> str:\n    return "hi"\n';
await fsPromises.writeFile(path.join(srcDir, 'sample.cpp'), cppSource);
await fsPromises.writeFile(path.join(srcDir, 'sample.swift'), swiftSource);
await fsPromises.writeFile(path.join(srcDir, 'sample.py'), pythonSource);

const testConfig = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  }
};

for (const binName of ['clangd', 'sourcekit-lsp', 'pyright-langserver']) {
  try {
    await fsPromises.chmod(path.join(binRoot, binName), 0o755);
  } catch {}
}

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig),
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PATH: `${binRoot}${path.delimiter}${process.env.PATH || ''}`
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_TEST_CONFIG = env.PAIROFCLEATS_TEST_CONFIG;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--stub-embeddings'],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (buildResult.status !== 0) {
  console.error('LSP enrichment test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const metaPath = path.join(indexDir, 'chunk_meta.json');
if (!fs.existsSync(metaPath)) {
  console.error('LSP enrichment test failed: chunk_meta.json missing.');
  process.exit(1);
}

const chunks = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const fileMetaPath = path.join(indexDir, 'file_meta.json');
const fileMeta = fs.existsSync(fileMetaPath)
  ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
  : [];
const fileById = new Map(
  (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
);
const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;

const cppChunk = chunks.find((chunk) => resolveChunkFile(chunk) === 'src/sample.cpp' && chunk.name === 'add');
const swiftChunk = chunks.find((chunk) => resolveChunkFile(chunk) === 'src/sample.swift' && chunk.name === 'greet');
const pythonChunk = chunks.find((chunk) => resolveChunkFile(chunk) === 'src/sample.py' && chunk.name === 'greet');

const ensureChunkUid = (chunk, label) => {
  const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
  if (!chunkUid) {
    console.error(`LSP enrichment test failed: missing chunkUid for ${label}.`);
    process.exit(1);
  }
};

const hasToolingReturn = (chunk, type) => {
  const returns = chunk?.docmeta?.inferredTypes?.returns || [];
  return returns.some((entry) => entry?.source === 'tooling' && (!type || entry?.type === type));
};
const hasToolingParam = (chunk, name, type) => {
  const params = chunk?.docmeta?.inferredTypes?.params || {};
  const entries = params[name] || [];
  return entries.some((entry) => entry?.source === 'tooling' && (!type || entry?.type === type));
};

if (!cppChunk) {
  console.error('LSP enrichment test failed: missing C++ chunk.');
  process.exit(1);
}
if (!swiftChunk) {
  console.error('LSP enrichment test failed: missing Swift chunk.');
  process.exit(1);
}
if (!pythonChunk) {
  console.error('LSP enrichment test failed: missing Python chunk.');
  process.exit(1);
}
ensureChunkUid(cppChunk, 'C++');
ensureChunkUid(swiftChunk, 'Swift');
ensureChunkUid(pythonChunk, 'Python');

if (!hasToolingReturn(cppChunk, 'int')) {
  console.error('LSP enrichment test failed: missing tooling return type for C++.');
  process.exit(1);
}
if (!hasToolingParam(cppChunk, 'a', 'int') || !hasToolingParam(cppChunk, 'b', 'int')) {
  console.error('LSP enrichment test failed: missing tooling param types for C++.');
  process.exit(1);
}
if (!hasToolingReturn(swiftChunk, 'String')) {
  console.error('LSP enrichment test failed: missing tooling return type for Swift.');
  process.exit(1);
}
if (!hasToolingParam(swiftChunk, 'name', 'String') || !hasToolingParam(swiftChunk, 'count', 'Int')) {
  console.error('LSP enrichment test failed: missing tooling param types for Swift.');
  process.exit(1);
}
if (!hasToolingReturn(pythonChunk, 'str')) {
  console.error('LSP enrichment test failed: missing tooling return type for Python.');
  process.exit(1);
}
if (!hasToolingParam(pythonChunk, 'name', 'str')) {
  console.error('LSP enrichment test failed: missing tooling param types for Python.');
  process.exit(1);
}
const pyDiagnostics = pythonChunk.docmeta?.tooling?.diagnostics || [];
if (!pyDiagnostics.some((diag) => diag?.source === 'pyright')) {
  console.error('LSP enrichment test failed: missing pyright diagnostics for Python.');
  process.exit(1);
}

console.log('LSP enrichment test passed');


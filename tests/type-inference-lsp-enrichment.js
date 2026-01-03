#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoId } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'lsp-enrichment');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
const binRoot = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });

const cppSource = 'int add(int a, int b) { return a + b; }\n';
const swiftSource = 'func greet(name: String, count: Int) -> String { return "hi" }\n';
await fsPromises.writeFile(path.join(srcDir, 'sample.cpp'), cppSource);
await fsPromises.writeFile(path.join(srcDir, 'sample.swift'), swiftSource);

const config = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  },
  sqlite: {
    use: false
  },
  tooling: {
    autoEnableOnDetect: true
  }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2)
);

for (const binName of ['clangd', 'sourcekit-lsp']) {
  try {
    await fsPromises.chmod(path.join(binRoot, binName), 0o755);
  } catch {}
}

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PATH: `${binRoot}${path.delimiter}${process.env.PATH || ''}`
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoRoot, '--stub-embeddings'],
  { env, encoding: 'utf8' }
);

if (buildResult.status !== 0) {
  console.error('LSP enrichment test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const repoId = getRepoId(repoRoot);
const indexDir = path.join(cacheRoot, 'repos', repoId, 'index-code');
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

console.log('LSP enrichment test passed');

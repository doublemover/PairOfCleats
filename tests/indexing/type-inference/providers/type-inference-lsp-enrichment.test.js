#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAX_JSON_BYTES, loadChunkMeta, loadJsonArrayArtifact } from '../../../../src/shared/artifact-io.js';
import { getIndexDir, loadUserConfig } from '../../../../tools/shared/dict-utils.js';
import { repoRoot } from '../../../helpers/root.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = repoRoot();
const tempRoot = path.join(root, '.testCache', 'lsp-enrichment');
const repoDir = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoDir, 'src');
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
    scm: { provider: 'none' },
    typeInference: true,
    typeInferenceCrossFile: true
  }
};

for (const binName of ['clangd', 'sourcekit-lsp', 'pyright-langserver']) {
  try {
    await fsPromises.chmod(path.join(binRoot, binName), 0o755);
  } catch {}
}

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig,
  extraEnv: {
    PATH: `${binRoot}${path.delimiter}${process.env.PATH || ''}`
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--repo', repoDir, '--stub-embeddings', '--stage', 'stage2'],
  { cwd: repoDir, env, encoding: 'utf8' }
);

if (buildResult.status !== 0) {
  console.error('LSP enrichment test failed: build_index error.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoDir);
const indexDir = getIndexDir(repoDir, 'code', userConfig);
let chunks = [];
let fileMeta = [];
try {
  chunks = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  fileMeta = await loadJsonArrayArtifact(indexDir, 'file_meta', { maxBytes: MAX_JSON_BYTES, strict: true });
} catch (err) {
  console.error(`LSP enrichment test failed: unable to load artifacts (${err?.message || err}).`);
  process.exit(1);
}
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

const logChunkDiagnostics = (chunk, label) => {
  const docmeta = chunk?.docmeta || {};
  const inferred = docmeta?.inferredTypes || {};
  console.error(`LSP enrichment debug (${label}):`);
  console.error(`  returnType=${docmeta.returnType || ''}`);
  console.error(`  signature=${docmeta.signature || ''}`);
  console.error(`  paramTypes=${JSON.stringify(docmeta.paramTypes || {})}`);
  console.error(`  inferredReturns=${JSON.stringify(inferred.returns || [])}`);
  console.error(`  inferredParams=${JSON.stringify(inferred.params || {})}`);
  if (docmeta.tooling?.sources?.length) {
    console.error(`  toolingSources=${JSON.stringify(docmeta.tooling.sources)}`);
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
  logChunkDiagnostics(cppChunk, 'C++');
  console.error('LSP enrichment test failed: missing tooling return type for C++.');
  process.exit(1);
}
if (!hasToolingParam(cppChunk, 'a', 'int') || !hasToolingParam(cppChunk, 'b', 'int')) {
  logChunkDiagnostics(cppChunk, 'C++');
  console.error('LSP enrichment test failed: missing tooling param types for C++.');
  process.exit(1);
}
if (!hasToolingReturn(swiftChunk, 'String')) {
  logChunkDiagnostics(swiftChunk, 'Swift');
  console.error('LSP enrichment test failed: missing tooling return type for Swift.');
  process.exit(1);
}
if (!hasToolingParam(swiftChunk, 'name', 'String') || !hasToolingParam(swiftChunk, 'count', 'Int')) {
  logChunkDiagnostics(swiftChunk, 'Swift');
  console.error('LSP enrichment test failed: missing tooling param types for Swift.');
  process.exit(1);
}
if (!hasToolingReturn(pythonChunk, 'str')) {
  logChunkDiagnostics(pythonChunk, 'Python');
  console.error('LSP enrichment test failed: missing tooling return type for Python.');
  process.exit(1);
}
if (!hasToolingParam(pythonChunk, 'name', 'str')) {
  logChunkDiagnostics(pythonChunk, 'Python');
  console.error('LSP enrichment test failed: missing tooling param types for Python.');
  process.exit(1);
}
const pyDiagnostics = pythonChunk.docmeta?.tooling?.diagnostics || [];
if (!pyDiagnostics.some((diag) => diag?.source === 'pyright')) {
  console.error('LSP enrichment test failed: missing pyright diagnostics for Python.');
  process.exit(1);
}

console.log('LSP enrichment test passed');


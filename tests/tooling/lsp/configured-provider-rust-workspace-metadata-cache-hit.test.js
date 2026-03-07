#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-metadata-cache-hit-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'Cargo.toml'), '[package]\nname = "preflight"\nversion = "0.1.0"\nedition = "2021"\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), 'fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');

const counterScriptPath = path.join(tempRoot, 'cargo-metadata-count.js');
const metadataCountPath = path.join(tempRoot, 'metadata-count.txt');
await fs.writeFile(
  counterScriptPath,
  [
    "import fs from 'node:fs';",
    "const countPath = process.argv[2];",
    "let next = 1;",
    "try {",
    "  next = Number(fs.readFileSync(countPath, 'utf8')) + 1;",
    "} catch {}",
    "fs.writeFileSync(countPath, `${next}\\n`, 'utf8');",
    "process.stdout.write('{\"packages\":[]}\\n');"
  ].join('\n'),
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
const chunkUid = 'ck64:v1:test:src/lib.rs:rust-workspace-metadata-cache-hit';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-workspace-metadata-cache-hit'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-workspace-metadata-cache-hit',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        preflightRuntimeRequirements: [],
        rustWorkspaceMetadataCmd: process.execPath,
        rustWorkspaceMetadataArgs: [counterScriptPath, metadataCountPath]
      }]
    }
  },
  cache: {
    enabled: true,
    dir: toolingCacheDir
  }
});

const providerInputs = {
  documents: [{
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-cache-hit.txt',
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: 'hash-rust-workspace-metadata-cache-hit'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_rust_workspace_metadata_cache_hit',
      file: 'src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-metadata-cache-hit.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
};

const providerInputsCacheMiss = {
  documents: [{
    ...providerInputs.documents[0],
    docHash: 'hash-rust-workspace-metadata-cache-hit-b'
  }],
  targets: [{
    ...providerInputs.targets[0],
    chunkRef: {
      ...providerInputs.targets[0].chunkRef,
      chunkUid: `${chunkUid}:b`,
      chunkId: 'chunk_rust_workspace_metadata_cache_hit_b'
    }
  }],
  kinds: ['types']
};

const readCount = async (targetPath) => {
  try {
    return Number.parseInt(await fs.readFile(targetPath, 'utf8'), 10);
  } catch {
    return 0;
  }
};

const first = await runToolingProviders(createContext(), providerInputs);
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first rust metadata preflight run to be uncached');
assert.equal(await readCount(metadataCountPath), 1, 'expected first rust metadata preflight to execute once');

const second = await runToolingProviders(createContext(), providerInputsCacheMiss);
assert.equal(second.metrics?.preflights?.cached, 1, 'expected second rust metadata preflight run to hit persistent cache');
assert.equal(await readCount(metadataCountPath), 1, 'expected cached rust metadata preflight to skip rerun');
assert.equal(
  second.diagnostics?.['lsp-rust-workspace-metadata-cache-hit']?.preflight?.cached,
  true,
  'expected rust preflight diagnostics to report cached marker reuse'
);

console.log('configured LSP rust workspace metadata cache hit test passed');

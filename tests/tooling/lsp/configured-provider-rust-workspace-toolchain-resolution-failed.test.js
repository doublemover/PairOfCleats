#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-toolchain-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'crate-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'crate-b', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'crate-a', 'Cargo.toml'),
  '[package]\nname = "crate-a"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(
  path.join(tempRoot, 'crate-b', 'Cargo.toml'),
  '[package]\nname = "crate-b"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'crate-a', 'src', 'lib.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'crate-b', 'src', 'lib.rs'), 'pub fn sub(a: i32, b: i32) -> i32 { a - b }\n', 'utf8');

const metadataCounterPath = path.join(tempRoot, 'metadata-count.txt');
const metadataScriptPath = path.join(tempRoot, 'cargo-metadata-toolchain-fail.js');
await fs.writeFile(
  metadataScriptPath,
  [
    "import fs from 'node:fs';",
    "const countPath = process.argv[2];",
    'let next = 1;',
    'try {',
    "  next = Number(fs.readFileSync(countPath, 'utf8')) + 1;",
    '} catch {}',
    "fs.writeFileSync(countPath, `${next}\\n`, 'utf8');",
    "process.stderr.write('cargo metadata failed for C:\\\\toolchains\\\\rustlib\\\\src\\\\rust\\\\library\\\\std\\\\Cargo.toml\\n');",
    'process.exit(19);'
  ].join('\n'),
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docTextA = 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n';
const docTextB = 'pub fn sub(a: i32, b: i32) -> i32 { a - b }\n';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-toolchain-resolution'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-toolchain-resolution',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        preflightRuntimeRequirements: [],
        rustWorkspaceMetadataCmd: process.execPath,
        rustWorkspaceMetadataArgs: [metadataScriptPath, metadataCounterPath]
      }]
    }
  },
  cache: {
    enabled: true,
    dir: toolingCacheDir
  }
});

const createInputs = (suffix) => ({
  documents: [{
    virtualPath: `.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-toolchain-a-${suffix}.txt`,
    text: docTextA,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: `hash-rust-workspace-toolchain-a-${suffix}`
  }, {
    virtualPath: `.poc-vfs/crate-b/src/lib.rs#seg:rust-workspace-toolchain-b-${suffix}.txt`,
    text: docTextB,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: `hash-rust-workspace-toolchain-b-${suffix}`
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:crate-a/src/lib.rs:rust-workspace-toolchain-a:${suffix}`,
      chunkId: `chunk_rust_workspace_toolchain_a_${suffix}`,
      file: 'crate-a/src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docTextA.length }
    },
    virtualPath: `.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-toolchain-a-${suffix}.txt`,
    virtualRange: { start: 0, end: docTextA.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }, {
    chunkRef: {
      docId: 1,
      chunkUid: `ck64:v1:test:crate-b/src/lib.rs:rust-workspace-toolchain-b:${suffix}`,
      chunkId: `chunk_rust_workspace_toolchain_b_${suffix}`,
      file: 'crate-b/src/lib.rs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docTextB.length }
    },
    virtualPath: `.poc-vfs/crate-b/src/lib.rs#seg:rust-workspace-toolchain-b-${suffix}.txt`,
    virtualRange: { start: 0, end: docTextB.length },
    symbolHint: { name: 'sub', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const readCount = async () => {
  try {
    return Number.parseInt(await fs.readFile(metadataCounterPath, 'utf8'), 10);
  } catch {
    return 0;
  }
};

const first = await runToolingProviders(createContext(), createInputs('a'));
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first toolchain-resolution run to be uncached');
assert.equal(await readCount(), 2, 'expected first toolchain-resolution run to execute metadata probes for both partitions');
assert.equal(
  first.byChunkUid.size,
  2,
  'expected toolchain-only metadata noise not to block repo-local Rust coverage'
);
assert.equal(
  first.diagnostics?.['lsp-rust-toolchain-resolution']?.preflight?.reasonCode,
  'rust_workspace_toolchain_resolution_failed',
  'expected explicit toolchain-resolution preflight reason'
);
assert.equal(
  first.diagnostics?.['lsp-rust-toolchain-resolution']?.preflight?.state,
  'degraded',
  'expected toolchain-only metadata noise to degrade rather than block provider startup'
);
assert.equal(
  first.diagnostics?.['lsp-rust-toolchain-resolution']?.fidelity?.state,
  'degraded',
  'expected fidelity contract to classify toolchain-only metadata noise as degraded'
);
assert.equal(
  Array.isArray(first.diagnostics?.['lsp-rust-toolchain-resolution']?.fidelity?.runtimeIssues)
  && first.diagnostics['lsp-rust-toolchain-resolution'].fidelity.runtimeIssues.includes('toolchain_resolution_failed'),
  true,
  'expected fidelity contract to surface toolchain-resolution runtime issue class'
);
const firstChecks = first.diagnostics?.['lsp-rust-toolchain-resolution']?.checks || [];
assert.equal(
  firstChecks.some((check) => check?.name === 'rust_workspace_toolchain_resolution_failed'),
  true,
  'expected explicit toolchain-resolution warning check'
);

const second = await runToolingProviders(createContext(), createInputs('b'));
assert.equal(second.metrics?.preflights?.cached, 1, 'expected cached negative toolchain-resolution marker on second run');
assert.equal(await readCount(), 2, 'expected cached negative toolchain-resolution result to skip rerun');
assert.equal(
  second.byChunkUid.size,
  2,
  'expected cached toolchain-noise degradation to preserve repo-local Rust coverage'
);
assert.equal(
  second.diagnostics?.['lsp-rust-toolchain-resolution']?.preflight?.cached,
  true,
  'expected toolchain-resolution diagnostics to report cached negative reuse'
);
assert.equal(
  Array.isArray(second.diagnostics?.['lsp-rust-toolchain-resolution']?.fidelity?.runtimeIssues)
  && second.diagnostics['lsp-rust-toolchain-resolution'].fidelity.runtimeIssues.includes('toolchain_resolution_failed'),
  true,
  'expected cached negative reuse to retain the toolchain-resolution runtime issue class'
);

console.log('configured LSP rust workspace toolchain resolution failed test passed');

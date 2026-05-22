#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runRustAnalyzerWorkspaceFixture } from '../../helpers/lsp-provider-fixture.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-partial-${process.pid}-${Date.now()}`);
const docText = 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n';
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'examples', 'broken', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'Cargo.toml'),
  '[package]\nname = "root"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), docText, 'utf8');
await fs.writeFile(
  path.join(tempRoot, 'examples', 'broken', 'Cargo.toml'),
  '[package\nname = "broken-example"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'examples', 'broken', 'src', 'main.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');
const metadataCounterPath = path.join(tempRoot, 'metadata-count.txt');
const metadataScriptPath = path.join(tempRoot, 'cargo-metadata-count.js');
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
    "process.stdout.write('{\"packages\":[]}\\n');"
  ].join('\n'),
  'utf8'
);

const goodChunkUid = 'ck64:v1:test:src/lib.rs:rust-workspace-partial-coverage:good';
const badChunkUid = 'ck64:v1:test:examples/broken/src/main.rs:rust-workspace-partial-coverage:bad';

const result = await runRustAnalyzerWorkspaceFixture({
  tempRoot,
  metadataArgs: [metadataScriptPath, metadataCounterPath]
}, {
  documents: [
    {
      virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-partial-coverage-good.txt',
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: 'hash-rust-workspace-partial-coverage-good'
    },
    {
      virtualPath: '.poc-vfs/examples/broken/src/main.rs#seg:rust-workspace-partial-coverage-bad.txt',
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: 'hash-rust-workspace-partial-coverage-bad'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: goodChunkUid,
        chunkId: 'chunk_rust_workspace_partial_coverage_good',
        file: 'src/lib.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/src/lib.rs#seg:rust-workspace-partial-coverage-good.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: badChunkUid,
        chunkId: 'chunk_rust_workspace_partial_coverage_bad',
        file: 'examples/broken/src/main.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/examples/broken/src/main.rs#seg:rust-workspace-partial-coverage-bad.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(goodChunkUid), true, 'expected valid root partition to remain available');
assert.equal(result.byChunkUid.has(badChunkUid), false, 'expected broken nested example partition to be quarantined');
assert.equal(
  Number.parseInt(await fs.readFile(metadataCounterPath, 'utf8'), 10),
  1,
  'expected cargo metadata probe to run only for the valid partition'
);
const diagnostics = result.diagnostics?.['lsp-rust-analyzer'] || {};
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'rust_workspace_partial_repo_coverage',
  'expected partial coverage preflight reason code'
);
assert.equal(
  diagnostics?.fidelity?.state,
  'degraded',
  'expected fidelity contract to classify partial coverage as degraded'
);
assert.equal(
  diagnostics?.fidelity?.qualityDelta?.partialSuccess,
  true,
  'expected mixed Rust partition coverage to report truthful partial success'
);
assert.equal(
  diagnostics?.fidelity?.workspaceCoverage?.readyPartitionCount,
  1,
  'expected ready Rust partition count in fidelity contract'
);
assert.equal(
  diagnostics?.fidelity?.workspaceCoverage?.blockedPartitionCount,
  1,
  'expected blocked Rust partition count in fidelity contract'
);
assert.equal(
  Array.isArray(diagnostics?.fidelity?.runtimeIssues)
  && diagnostics.fidelity.runtimeIssues.includes('partial_workspace_coverage')
  && diagnostics.fidelity.runtimeIssues.includes('blocked_workspace_partitions')
  && diagnostics.fidelity.runtimeIssues.includes('repo_workspace_invalidity'),
  true,
  'expected fidelity contract to preserve partial-coverage and repo-invalidity runtime issue classes'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'rust_workspace_broken_manifest'),
  true,
  'expected broken nested manifest warning check'
);
assert.equal(
  checks.some((check) => check?.name === 'lsp-rust-analyzer_workspace_partition_blocked'),
  true,
  'expected blocked partition runtime check'
);

console.log('configured LSP rust workspace partial coverage test passed');

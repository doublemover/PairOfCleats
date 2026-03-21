#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-timeout-local-cache-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'crate-ok', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'examples', 'slow', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'crate-ok', 'Cargo.toml'),
  '[package]\nname = "crate-ok"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'crate-ok', 'src', 'lib.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');
await fs.writeFile(
  path.join(tempRoot, 'examples', 'slow', 'Cargo.toml'),
  '[package]\nname = "slow-example"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'examples', 'slow', 'src', 'main.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');

const metadataCountsPath = path.join(tempRoot, 'metadata-counts.json');
const metadataScriptPath = path.join(tempRoot, 'cargo-metadata-timeout-local.js');
await fs.writeFile(
  metadataScriptPath,
  [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const countPath = process.argv[2];",
    "const cwdName = path.basename(process.cwd());",
    "const counts = fs.existsSync(countPath) ? JSON.parse(fs.readFileSync(countPath, 'utf8')) : {};",
    "counts[cwdName] = Number(counts[cwdName] || 0) + 1;",
    "fs.writeFileSync(countPath, JSON.stringify(counts), 'utf8');",
    "if (cwdName === 'slow') {",
    "  setTimeout(() => process.exit(0), 5000);",
    '} else {',
    "  process.stdout.write('{\"packages\":[]}\\n');",
    '}'
  ].join('\n'),
  'utf8'
);

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-rust-timeout-local-cache'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-timeout-local-cache',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        uriScheme: 'poc-vfs',
        rustWorkspaceMetadataCmd: process.execPath,
        rustWorkspaceMetadataArgs: [metadataScriptPath, metadataCountsPath],
        rustWorkspaceMetadataTimeoutMs: 500
      }]
    }
  },
  cache: {
    enabled: true,
    dir: toolingCacheDir
  }
});

const createInputs = ({ targetPath, suffix }) => ({
  documents: [{
    virtualPath: `.poc-vfs/${targetPath}#seg:rust-timeout-local-cache-${suffix}.txt`,
    text: docText,
    languageId: 'rust',
    effectiveExt: '.rs',
    docHash: `hash-rust-timeout-local-cache-${suffix}`
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:${targetPath}:rust-timeout-local-cache:${suffix}`,
      chunkId: `chunk_rust_timeout_local_cache_${suffix}`,
      file: targetPath,
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: `.poc-vfs/${targetPath}#seg:rust-timeout-local-cache-${suffix}.txt`,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' },
    languageId: 'rust'
  }],
  kinds: ['types']
});

const readCounts = async () => {
  try {
    return JSON.parse(await fs.readFile(metadataCountsPath, 'utf8'));
  } catch {
    return {};
  }
};

const slowFirst = await runToolingProviders(createContext(), createInputs({
  targetPath: 'examples/slow/src/main.rs',
  suffix: 'slow-a'
}));
const slowDiagnostics = slowFirst.diagnostics?.['lsp-rust-timeout-local-cache'] || {};
assert.equal(slowDiagnostics?.preflight?.state, 'blocked', 'expected timed out partition to block when it is the only selected root');
assert.equal(
  ['rust_workspace_metadata_timeout', 'rust_workspace_blocked_all_partitions'].includes(String(slowDiagnostics?.preflight?.reasonCode || '')),
  true,
  'expected timeout-shaped rust preflight reason code'
);
assert.deepEqual(
  await readCounts(),
  { slow: 1 },
  'expected timed out partition to probe once'
);

const okSecond = await runToolingProviders(createContext(), createInputs({
  targetPath: 'crate-ok/src/lib.rs',
  suffix: 'ok-a'
}));
assert.equal(okSecond.byChunkUid.size, 1, 'expected healthy Rust partition to contribute after unrelated timeout cache entry');
assert.equal(
  okSecond.diagnostics?.['lsp-rust-timeout-local-cache']?.preflight?.cached || false,
  false,
  'expected healthy Rust partition not to reuse timed-out cache from a different root'
);
assert.deepEqual(
  await readCounts(),
  { slow: 1, 'crate-ok': 1 },
  'expected healthy partition probe to run independently of timed-out partition cache'
);

const slowThird = await runToolingProviders(createContext(), createInputs({
  targetPath: 'examples/slow/src/main.rs',
  suffix: 'slow-b'
}));
assert.equal(
  slowThird.diagnostics?.['lsp-rust-timeout-local-cache']?.preflight?.cached,
  true,
  'expected repeated timed-out partition to reuse its cached negative result'
);
assert.deepEqual(
  await readCounts(),
  { slow: 1, 'crate-ok': 1 },
  'expected cached timeout partition rerun not to repeat the slow metadata probe'
);

console.log('configured LSP rust workspace timeout local cache test passed');

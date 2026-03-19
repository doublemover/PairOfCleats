#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-rust-workspace-negative-cache-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'crate-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'examples', 'broken', 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'crate-a', 'Cargo.toml'),
  '[package]\nname = "crate-a"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'crate-a', 'src', 'lib.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');
await fs.writeFile(
  path.join(tempRoot, 'examples', 'broken', 'Cargo.toml'),
  '[package]\nname = "broken-example"\nversion = "0.1.0"\nedition = "2021"\n',
  'utf8'
);
await fs.writeFile(path.join(tempRoot, 'examples', 'broken', 'src', 'main.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n', 'utf8');
const metadataCounterPath = path.join(tempRoot, 'metadata-count.txt');
const metadataScriptPath = path.join(tempRoot, 'cargo-metadata-partitioned.js');
await fs.writeFile(
  metadataScriptPath,
  [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const countPath = process.argv[2];",
    'let next = 1;',
    'try {',
    "  next = Number(fs.readFileSync(countPath, 'utf8')) + 1;",
    '} catch {}',
    "fs.writeFileSync(countPath, `${next}\\n`, 'utf8');",
    "if (path.basename(process.cwd()) === 'broken') {",
    "  process.stderr.write('forced broken workspace partition\\n');",
    '  process.exit(19);',
    '}',
    "process.stdout.write('{\"packages\":[]}\\n');"
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
    enabledTools: ['lsp-rust-analyzer'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'rust-analyzer',
        preset: 'rust-analyzer',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'rust'],
        languages: ['rust'],
        uriScheme: 'poc-vfs',
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
  documents: [
    {
      virtualPath: `.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-negative-cache-good-${suffix}.txt`,
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: `hash-rust-workspace-negative-cache-good-${suffix}`
    },
    {
      virtualPath: `.poc-vfs/examples/broken/src/main.rs#seg:rust-workspace-negative-cache-bad-${suffix}.txt`,
      text: docText,
      languageId: 'rust',
      effectiveExt: '.rs',
      docHash: `hash-rust-workspace-negative-cache-bad-${suffix}`
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: `ck64:v1:test:crate-a/src/lib.rs:rust-workspace-negative-cache-good:${suffix}`,
        chunkId: `chunk_rust_workspace_negative_cache_good_${suffix}`,
        file: 'crate-a/src/lib.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: `.poc-vfs/crate-a/src/lib.rs#seg:rust-workspace-negative-cache-good-${suffix}.txt`,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: `ck64:v1:test:examples/broken/src/main.rs:rust-workspace-negative-cache-bad:${suffix}`,
        chunkId: `chunk_rust_workspace_negative_cache_bad_${suffix}`,
        file: 'examples/broken/src/main.rs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: `.poc-vfs/examples/broken/src/main.rs#seg:rust-workspace-negative-cache-bad-${suffix}.txt`,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'rust'
    }
  ],
  kinds: ['types']
});

const first = await runToolingProviders(createContext(), createInputs('a'));
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first rust workspace run to be uncached');
assert.equal(
  Number.parseInt(await fs.readFile(metadataCounterPath, 'utf8'), 10),
  2,
  'expected first rust workspace run to probe both partitions'
);

const second = await runToolingProviders(createContext(), createInputs('b'));
assert.equal(second.metrics?.preflights?.cached, 1, 'expected second rust workspace run to hit persistent preflight cache');
assert.equal(
  Number.parseInt(await fs.readFile(metadataCounterPath, 'utf8'), 10),
  2,
  'expected cached negative rust partition result to avoid rerunning metadata probes'
);
assert.equal(
  second.diagnostics?.['lsp-rust-analyzer']?.preflight?.cached,
  true,
  'expected rust workspace diagnostics to report cached negative probe reuse'
);

console.log('configured LSP rust workspace negative cache hit test passed');

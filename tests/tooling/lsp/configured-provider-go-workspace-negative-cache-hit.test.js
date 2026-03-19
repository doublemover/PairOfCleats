#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-workspace-negative-cache-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');

const counterScriptPath = path.join(tempRoot, 'count-failure.js');
await fs.writeFile(
  counterScriptPath,
  [
    "import fs from 'node:fs';",
    "const countPath = process.argv[2];",
    "let next = 1;",
    'try {',
    "  next = Number(fs.readFileSync(countPath, 'utf8')) + 1;",
    '} catch {}',
    "fs.writeFileSync(countPath, `${next}\\n`, 'utf8');",
    "process.stderr.write('forced go workspace module probe failure\\n');",
    'process.exit(17);'
  ].join('\n'),
  'utf8'
);

const moduleCountPath = path.join(tempRoot, 'module-count.txt');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/main.go:go-workspace-negative-cache-hit';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-go-workspace-negative-cache'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'go-workspace-negative-cache',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [counterScriptPath, moduleCountPath],
        goWorkspaceWarmup: false
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
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-negative-cache-hit-a.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-go-workspace-negative-cache-a'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_go_workspace_negative_cache_hit_a',
      file: 'src/main.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-negative-cache-hit-a.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
};

const providerInputsCacheMiss = {
  documents: [{
    ...providerInputs.documents[0],
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-negative-cache-hit-b.txt',
    docHash: 'hash-go-workspace-negative-cache-b'
  }],
  targets: [{
    ...providerInputs.targets[0],
    chunkRef: {
      ...providerInputs.targets[0].chunkRef,
      chunkUid: `${chunkUid}:b`,
      chunkId: 'chunk_go_workspace_negative_cache_hit_b'
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-negative-cache-hit-b.txt'
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
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first negative preflight run to be uncached');
assert.equal(await readCount(moduleCountPath), 1, 'expected first negative preflight run to execute once');
assert.equal(
  first.diagnostics?.['lsp-go-workspace-negative-cache']?.preflight?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected first negative preflight reason code'
);

const second = await runToolingProviders(createContext(), providerInputsCacheMiss);
assert.equal(second.metrics?.preflights?.cached, 1, 'expected cache-miss provider rerun to reuse negative preflight cache');
assert.equal(await readCount(moduleCountPath), 1, 'expected negative preflight cache to skip rerun');
assert.equal(
  second.diagnostics?.['lsp-go-workspace-negative-cache']?.preflight?.cached,
  true,
  'expected negative preflight diagnostics to report cached marker reuse'
);
assert.equal(
  second.diagnostics?.['lsp-go-workspace-negative-cache']?.preflight?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected cached negative preflight reason code to be preserved'
);

console.log('configured LSP go workspace negative cache hit test passed');

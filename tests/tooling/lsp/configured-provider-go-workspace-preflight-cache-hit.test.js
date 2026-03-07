#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-workspace-preflight-cache-hit-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'main.go'), 'package main\nfunc Add(a int, b int) int { return a + b }\n', 'utf8');

const counterScriptPath = path.join(tempRoot, 'count-success.js');
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
    "process.stdout.write('ok\\n');"
  ].join('\n'),
  'utf8'
);

const moduleCountPath = path.join(tempRoot, 'module-count.txt');
const warmupCountPath = path.join(tempRoot, 'warmup-count.txt');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';
const chunkUid = 'ck64:v1:test:src/main.go:go-workspace-preflight-cache-hit';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-go-workspace-preflight-cache-hit'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'go-workspace-preflight-cache-hit',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [counterScriptPath, moduleCountPath],
        goWorkspaceWarmup: true,
        goWorkspaceWarmupMinGoFiles: 1,
        goWorkspaceWarmupCmd: process.execPath,
        goWorkspaceWarmupArgs: [counterScriptPath, warmupCountPath]
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
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-preflight-cache-hit.txt',
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: 'hash-go-workspace-preflight-cache-hit'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_go_workspace_preflight_cache_hit',
      file: 'src/main.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/main.go#seg:go-workspace-preflight-cache-hit.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
};

const providerInputsCacheMiss = {
  documents: [{
    ...providerInputs.documents[0],
    docHash: 'hash-go-workspace-preflight-cache-hit-b'
  }],
  targets: [{
    ...providerInputs.targets[0],
    chunkRef: {
      ...providerInputs.targets[0].chunkRef,
      chunkUid: `${chunkUid}:b`,
      chunkId: 'chunk_go_workspace_preflight_cache_hit_b'
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
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first go preflight run to be uncached');
assert.equal(await readCount(moduleCountPath), 1, 'expected first run to execute go module preflight once');
assert.equal(await readCount(warmupCountPath), 1, 'expected first run to execute go warmup preflight once');

const second = await runToolingProviders(createContext(), providerInputs);
assert.equal(second.metrics?.preflights?.total, 0, 'expected provider output cache hit to skip preflight entirely');
assert.equal(await readCount(moduleCountPath), 1, 'expected cached go module preflight to skip rerun');
assert.equal(await readCount(warmupCountPath), 1, 'expected cached go warmup preflight to skip rerun');

const third = await runToolingProviders(createContext(), providerInputsCacheMiss);
assert.equal(third.metrics?.preflights?.cached, 1, 'expected cache-miss provider rerun to hit persistent go preflight cache');
assert.equal(
  third.diagnostics?.['lsp-go-workspace-preflight-cache-hit']?.preflight?.cached,
  true,
  'expected go preflight diagnostics to report cached marker reuse'
);

console.log('configured LSP go workspace preflight cache hit test passed');

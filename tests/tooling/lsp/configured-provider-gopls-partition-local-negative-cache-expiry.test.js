#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-partition-local-negative-cache-expiry-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-bad', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-bad', 'go.mod'), 'module example.com/svc-bad\n\ngo 1.22\n', 'utf8');

const selectiveProbePath = path.join(tempRoot, 'go-probe-selective-expiry.js');
await fs.writeFile(
  selectiveProbePath,
  [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "const countPath = process.argv[2];",
    "const cwdName = path.basename(process.cwd());",
    "const counts = fs.existsSync(countPath) ? JSON.parse(fs.readFileSync(countPath, 'utf8')) : {};",
    "counts[cwdName] = Number(counts[cwdName] || 0) + 1;",
    "fs.writeFileSync(countPath, JSON.stringify(counts), 'utf8');",
    "process.stderr.write('forced blocked workspace partition\\n');",
    'process.exit(19);'
  ].join('\n'),
  'utf8'
);

const moduleCountPath = path.join(tempRoot, 'module-counts.json');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';

const createContext = () => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-gopls-partition-local-negative-cache-expiry'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'gopls-partition-local-negative-cache-expiry',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [selectiveProbePath, moduleCountPath],
        goWorkspaceWarmup: false,
        goWorkspaceNegativeCacheTtlMs: 1
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
    virtualPath: `.poc-vfs/svc-bad/src/sample.go#seg:gopls-partition-local-negative-cache-expiry-${suffix}.txt`,
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: `hash-gopls-partition-local-negative-cache-expiry-${suffix}`
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:svc-bad/src/sample.go:gopls-partition-local-negative-cache-expiry:${suffix}`,
      chunkId: `chunk_gopls_partition_local_negative_cache_expiry_${suffix}`,
      file: 'svc-bad/src/sample.go',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: `.poc-vfs/svc-bad/src/sample.go#seg:gopls-partition-local-negative-cache-expiry-${suffix}.txt`,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Add', kind: 'function' },
    languageId: 'go'
  }],
  kinds: ['types']
});

const readCounts = async () => {
  try {
    return JSON.parse(await fs.readFile(moduleCountPath, 'utf8'));
  } catch {
    return {};
  }
};

const first = await runToolingProviders(createContext(), createInputs('first'));
assert.equal(first.metrics?.preflights?.cached || 0, 0, 'expected first blocked partition run to be uncached');
assert.deepEqual(await readCounts(), { 'svc-bad': 1 }, 'expected first blocked partition probe to run once');

await delay(25);

const second = await runToolingProviders(createContext(), createInputs('second'));
assert.equal(
  second.diagnostics?.['lsp-gopls-partition-local-negative-cache-expiry']?.preflight?.cached || false,
  false,
  'expected expired blocked partition cache entry to force revalidation'
);
assert.deepEqual(
  await readCounts(),
  { 'svc-bad': 2 },
  'expected expired blocked partition cache entry to rerun the failing probe'
);

console.log('configured LSP gopls partition-local negative cache expiry test passed');

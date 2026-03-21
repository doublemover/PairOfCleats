#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-gopls-partition-local-negative-cache-${process.pid}-${Date.now()}`);
const toolingCacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-ok', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'svc-bad', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-ok', 'go.mod'), 'module example.com/svc-ok\n\ngo 1.22\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-bad', 'go.mod'), 'module example.com/svc-bad\n\ngo 1.22\n', 'utf8');

const selectiveProbePath = path.join(tempRoot, 'go-probe-selective-cache.js');
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
    "if (cwdName === 'svc-bad') {",
    "  process.stderr.write('forced blocked workspace partition\\n');",
    '  process.exit(19);',
    '}',
    "process.stdout.write('ok\\n');"
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
    enabledTools: ['lsp-gopls-partition-local-negative-cache'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'gopls-partition-local-negative-cache',
        preset: 'gopls',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'go'],
        languages: ['go'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: [],
        goWorkspaceModuleCmd: process.execPath,
        goWorkspaceModuleArgs: [selectiveProbePath, moduleCountPath],
        goWorkspaceWarmup: false
      }]
    }
  },
  cache: {
    enabled: true,
    dir: toolingCacheDir
  }
});

const createInputs = ({ service, suffix }) => ({
  documents: [{
    virtualPath: `.poc-vfs/${service}/src/sample.go#seg:gopls-partition-local-negative-cache-${suffix}.txt`,
    text: docText,
    languageId: 'go',
    effectiveExt: '.go',
    docHash: `hash-gopls-partition-local-negative-cache-${suffix}`
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: `ck64:v1:test:${service}/src/sample.go:gopls-partition-local-negative-cache:${suffix}`,
      chunkId: `chunk_gopls_partition_local_negative_cache_${suffix}`,
      file: `${service}/src/sample.go`,
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: `.poc-vfs/${service}/src/sample.go#seg:gopls-partition-local-negative-cache-${suffix}.txt`,
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

const badFirst = await runToolingProviders(createContext(), createInputs({
  service: 'svc-bad',
  suffix: 'bad-a'
}));
assert.equal(badFirst.metrics?.preflights?.cached || 0, 0, 'expected first blocked partition run to be uncached');
assert.equal(
  badFirst.diagnostics?.['lsp-gopls-partition-local-negative-cache']?.preflight?.reasonCode,
  'go_workspace_blocked_workspace_shape',
  'expected blocked partition reason code to be preserved'
);
assert.deepEqual(
  await readCounts(),
  { 'svc-bad': 1 },
  'expected blocked partition probe to run once for svc-bad only'
);

const okSecond = await runToolingProviders(createContext(), createInputs({
  service: 'svc-ok',
  suffix: 'ok-a'
}));
assert.equal(
  okSecond.byChunkUid.size,
  1,
  'expected healthy partition to contribute after unrelated negative cache entry'
);
assert.equal(
  okSecond.diagnostics?.['lsp-gopls-partition-local-negative-cache']?.preflight?.cached || false,
  false,
  'expected healthy partition run not to reuse unrelated blocked cache entry'
);
assert.deepEqual(
  await readCounts(),
  { 'svc-bad': 1, 'svc-ok': 1 },
  'expected healthy partition probe to run independently of blocked partition cache'
);

const badThird = await runToolingProviders(createContext(), createInputs({
  service: 'svc-bad',
  suffix: 'bad-b'
}));
assert.equal(
  badThird.diagnostics?.['lsp-gopls-partition-local-negative-cache']?.preflight?.cached,
  true,
  'expected same blocked partition to reuse its cached negative result'
);
assert.deepEqual(
  await readCounts(),
  { 'svc-bad': 1, 'svc-ok': 1 },
  'expected cached blocked partition rerun to avoid repeating the doomed probe'
);

console.log('configured LSP gopls partition-local negative cache test passed');

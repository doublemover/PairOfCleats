#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  buildGoplsWorkspaceContext,
  buildGoplsWorkspaceInputs,
  goplsSampleDocText
} from './helpers/gopls-workspace-case.js';

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

const createContext = () => buildGoplsWorkspaceContext({
  root,
  tempRoot,
  providerId: 'lsp-gopls-partition-local-negative-cache',
  serverId: 'gopls-partition-local-negative-cache',
  probePath: selectiveProbePath,
  probeArgs: [moduleCountPath],
  cache: {
    enabled: true,
    dir: toolingCacheDir
  }
});

const createInputs = ({ service, suffix }) => buildGoplsWorkspaceInputs({
  scenario: 'gopls-partition-local-negative-cache',
  docText: goplsSampleDocText,
  partitions: [{ service, suffix }]
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

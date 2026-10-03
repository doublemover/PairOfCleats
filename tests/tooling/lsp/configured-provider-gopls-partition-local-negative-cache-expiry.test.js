#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  buildGoplsWorkspaceContext,
  buildGoplsWorkspaceInputs,
  goplsSampleDocText
} from './helpers/gopls-workspace-case.js';

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

const createContext = () => buildGoplsWorkspaceContext({
  root,
  tempRoot,
  providerId: 'lsp-gopls-partition-local-negative-cache-expiry',
  serverId: 'gopls-partition-local-negative-cache-expiry',
  probePath: selectiveProbePath,
  probeArgs: [moduleCountPath],
  cache: {
    enabled: true,
    dir: toolingCacheDir
  },
  serverConfig: {
    goWorkspaceNegativeCacheTtlMs: 1
  }
});

const createInputs = (suffix) => buildGoplsWorkspaceInputs({
  scenario: 'gopls-partition-local-negative-cache-expiry',
  docText: goplsSampleDocText,
  partitions: [{ service: 'svc-bad', suffix }]
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

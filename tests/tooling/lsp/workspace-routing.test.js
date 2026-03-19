#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveLspWorkspaceRouting } from '../../../src/index/tooling/lsp-workspace-routing.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-workspace-routing-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'svc-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'svc-b', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'nested', 'project', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'svc-a', 'app.csproj'), '<Project />\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'svc-b', 'app.csproj'), '<Project />\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'nested', 'project', 'app.csproj'), '<Project />\n', 'utf8');

const multiRoot = resolveLspWorkspaceRouting({
  repoRoot: tempRoot,
  providerId: 'csharp-ls',
  documents: [
    { virtualPath: '.poc-vfs/svc-a/src/a.cs#seg:a', languageId: 'csharp' },
    { virtualPath: '.poc-vfs/svc-b/src/b.cs#seg:b', languageId: 'csharp' }
  ],
  targets: [
    {
      virtualPath: '.poc-vfs/svc-a/src/a.cs#seg:a',
      chunkRef: { chunkUid: 'chunk-a' }
    },
    {
      virtualPath: '.poc-vfs/svc-b/src/b.cs#seg:b',
      chunkRef: { chunkUid: 'chunk-b' }
    }
  ],
  workspaceMarkerOptions: { extensionNames: ['.csproj', '.sln'] },
  requireWorkspaceModel: true,
  workspaceModelPolicy: 'block'
});

assert.equal(multiRoot.state, 'ready', 'expected ready routing state for multi-root selection');
assert.equal(multiRoot.partitions.length, 2, 'expected two deterministic workspace partitions');
assert.deepEqual(
  multiRoot.partitions.map((entry) => entry.rootRel),
  ['svc-a', 'svc-b'],
  'expected deterministic partition roots'
);
assert.equal(multiRoot.workspaceModel.partitioned, true, 'expected partitioned workspace summary');
assert.equal(
  multiRoot.checks.some((check) => check?.name === 'csharp-ls_workspace_partition_multi_root'),
  true,
  'expected multi-root info check'
);

const nested = resolveLspWorkspaceRouting({
  repoRoot: tempRoot,
  providerId: 'csharp-ls',
  documents: [{ virtualPath: '.poc-vfs/nested/project/src/main.cs#seg:nested', languageId: 'csharp' }],
  targets: [{ virtualPath: '.poc-vfs/nested/project/src/main.cs#seg:nested', chunkRef: { chunkUid: 'chunk-nested' } }],
  workspaceMarkerOptions: { extensionNames: ['.csproj', '.sln'] },
  requireWorkspaceModel: true,
  workspaceModelPolicy: 'block'
});

assert.equal(nested.state, 'ready', 'expected nested workspace routing to remain ready');
assert.equal(nested.partitions.length, 1, 'expected one nested workspace partition');
assert.equal(nested.partitions[0].rootRel, 'nested/project', 'expected nested workspace root to be selected');
assert.equal(
  nested.checks.some((check) => check?.name === 'csharp-ls_workspace_partition_narrowed'),
  true,
  'expected narrowed workspace info check'
);

const incomplete = resolveLspWorkspaceRouting({
  repoRoot: tempRoot,
  providerId: 'csharp-ls',
  documents: [
    { virtualPath: '.poc-vfs/svc-a/src/a.cs#seg:a', languageId: 'csharp' },
    { virtualPath: '.poc-vfs/unmatched/src/c.cs#seg:c', languageId: 'csharp' }
  ],
  targets: [
    { virtualPath: '.poc-vfs/svc-a/src/a.cs#seg:a', chunkRef: { chunkUid: 'chunk-a' } },
    { virtualPath: '.poc-vfs/unmatched/src/c.cs#seg:c', chunkRef: { chunkUid: 'chunk-c' } }
  ],
  workspaceMarkerOptions: { extensionNames: ['.csproj', '.sln'] },
  requireWorkspaceModel: true,
  workspaceModelPolicy: 'block'
});

assert.equal(incomplete.state, 'degraded', 'expected unmatched documents to degrade routing state');
assert.equal(incomplete.partitions.length, 1, 'expected matched workspace partition to remain runnable');
assert.equal(incomplete.workspaceModel.unmatchedDocumentCount, 1, 'expected unmatched document count in summary');
assert.equal(
  incomplete.checks.some((check) => check?.name === 'csharp-ls_workspace_partition_incomplete'),
  true,
  'expected incomplete routing warning check'
);

console.log('LSP workspace routing test passed');

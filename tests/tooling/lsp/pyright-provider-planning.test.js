#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `pyright-provider-planning-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'pkg-a', 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'pkg-a', 'tests'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'pkg-b', 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'pkg-a', 'pyproject.toml'), '[project]\nname = "a"\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'pkg-b', 'pyproject.toml'), '[project]\nname = "b"\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'pkg-a', 'src', 'core.py'), 'def alpha() -> int:\n    return 1\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'pkg-a', 'tests', 'test_core.py'), 'def test_alpha() -> None:\n    assert True\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'pkg-b', 'src', 'other.py'), 'def beta() -> int:\n    return 2\n', 'utf8');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
);

registerDefaultToolingProviders();

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['pyright'],
    pyright: {
      cmd: fixtureCmd
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [
    {
      virtualPath: 'pkg-a/src/core.py',
      text: 'def alpha() -> int:\n    return 1\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-plan-core'
    },
    {
      virtualPath: 'pkg-a/tests/test_core.py',
      text: 'def test_alpha() -> None:\n    assert True\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-plan-test'
    },
    {
      virtualPath: 'pkg-b/src/other.py',
      text: 'def beta() -> int:\n    return 2\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-plan-other'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck:test:pyright-plan:core',
        chunkId: 'chunk_pyright_plan_core',
        file: 'pkg-a/src/core.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 32 }
      },
      virtualPath: 'pkg-a/src/core.py',
      virtualRange: { start: 0, end: 32 },
      symbolHint: { name: 'alpha', kind: 'function' },
      languageId: 'python'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: 'ck:test:pyright-plan:test',
        chunkId: 'chunk_pyright_plan_test',
        file: 'pkg-a/tests/test_core.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 39 }
      },
      virtualPath: 'pkg-a/tests/test_core.py',
      virtualRange: { start: 0, end: 39 },
      symbolHint: { name: 'test_alpha', kind: 'function' },
      languageId: 'python'
    },
    {
      chunkRef: {
        docId: 2,
        chunkUid: 'ck:test:pyright-plan:other',
        chunkId: 'chunk_pyright_plan_other',
        file: 'pkg-b/src/other.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 31 }
      },
      virtualPath: 'pkg-b/src/other.py',
      virtualRange: { start: 0, end: 31 },
      symbolHint: { name: 'beta', kind: 'function' },
      languageId: 'python'
    }
  ],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has('ck:test:pyright-plan:core'), true, 'expected dominant workspace core doc to be enriched');
assert.equal(result.byChunkUid.has('ck:test:pyright-plan:test'), false, 'expected low-value test doc to be skipped');
assert.equal(result.byChunkUid.has('ck:test:pyright-plan:other'), false, 'expected secondary workspace doc to be skipped');
const diagnostics = result.diagnostics?.pyright || {};
assert.equal(diagnostics?.planning?.workspaceRootRel, 'pkg-a', 'expected planning summary to pick pkg-a workspace');
assert.equal(
  diagnostics?.planning?.countsByReason?.workspace_mismatch >= 1,
  true,
  'expected planning summary to count workspace mismatch docs'
);
assert.equal(
  diagnostics?.planning?.countsByReason?.path_policy_low_value >= 1,
  true,
  'expected planning summary to count low-value docs'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'pyright_workspace_partition_mismatch'),
  true,
  'expected workspace mismatch warning check'
);

console.log('pyright provider planning test passed');

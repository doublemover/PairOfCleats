#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'pyright-preflight-workspace-config-invalid');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'one.py'), 'def alpha() -> int:\n    return 1\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'pyrightconfig.json'), '{ "venvPath": ', 'utf8');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
);
await fs.access(fixtureCmd);

registerDefaultToolingProviders();

const chunkUid = 'ck:test:pyright-workspace-config-invalid:1';
const docText = 'def alpha() -> int:\n    return 1\n';
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
  documents: [{
    virtualPath: 'src/one.py',
    text: docText,
    languageId: 'python',
    effectiveExt: '.py',
    docHash: 'hash-pyright-workspace-config-invalid'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_pyright_workspace_config_invalid',
      file: 'src/one.py',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: 'src/one.py',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'alpha', kind: 'function' },
    languageId: 'python'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected pyright output even with degraded workspace-config preflight');
const diagnostics = result.diagnostics?.pyright || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected pyright preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'pyright_workspace_config_invalid',
  'expected pyright workspace-config invalid reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'pyright_workspace_config_invalid'),
  true,
  'expected pyright workspace-config invalid warning check'
);

console.log('pyright preflight workspace config invalid test passed');

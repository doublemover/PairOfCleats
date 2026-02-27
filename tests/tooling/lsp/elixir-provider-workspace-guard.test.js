#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `elixir-provider-guard-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
  const chunkUid = 'ck64:v1:test:lib/sample.ex:elixir-guard';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['elixir-ls'],
      elixir: {
        enabled: true
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'lib/sample.ex',
      text: docText,
      languageId: 'elixir',
      effectiveExt: '.ex',
      docHash: 'hash-elixir-guard'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_elixir_guard',
        file: 'lib/sample.ex',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'lib/sample.ex',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'elixir'
    }],
    kinds: ['types']
  });

  assert.equal(result.byChunkUid.has(chunkUid), false, 'expected guard to skip elixir-ls without mix.exs');
  const checks = result.diagnostics?.['elixir-ls']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'elixir_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );

  console.log('elixir provider workspace guard test passed');
} finally {
  restorePath();
}

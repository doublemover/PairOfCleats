#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `elixir-provider-bootstrap-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'mix.exs'), 'defmodule Sample.MixProject do\nend\n', 'utf8');

const restorePath = prependLspTestPath({ repoRoot: root });

try {
  registerDefaultToolingProviders();
  const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
  const chunkUid = 'ck64:v1:test:lib/sample.ex:elixir-bootstrap';
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
      docHash: 'hash-elixir-bootstrap'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_elixir_bootstrap',
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

  assert.equal(result.byChunkUid.has(chunkUid), true, 'expected elixir provider to enrich Elixir symbol');
  const hit = result.byChunkUid.get(chunkUid);
  assert.equal(hit.payload?.returnType, 'String.t()', 'expected parsed Elixir return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String.t()', 'expected parsed Elixir param type');
  const providerDiag = result.diagnostics?.['elixir-ls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for elixir provider');

  console.log('elixir provider bootstrap test passed');
} finally {
  restorePath();
}

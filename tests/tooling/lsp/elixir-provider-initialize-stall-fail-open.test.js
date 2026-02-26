#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `elixir-provider-initialize-stall-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'mix.exs'), 'defmodule Sample.MixProject do\nend\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
registerDefaultToolingProviders();
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const chunkUid = 'ck64:v1:test:lib/sample.ex:elixir-initialize-stall';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['elixir-ls'],
    elixir: {
      enabled: true,
      cmd: process.execPath,
      args: [serverPath, '--mode', 'stall-initialize'],
      timeoutMs: 1500
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
    docHash: 'hash-elixir-initialize-stall'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_elixir_initialize_stall',
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

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback on initialize stall');
const checks = result.diagnostics?.['elixir-ls']?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'tooling_initialize_failed'),
  true,
  'expected initialize failure check in elixir provider diagnostics'
);

console.log('elixir provider initialize stall fail-open test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `elixir-provider-command-fallback-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'lib'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'mix.exs'), 'defmodule Sample.MixProject do\nend\n', 'utf8');

registerDefaultToolingProviders();
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const chunkUid = 'ck64:v1:test:lib/sample.ex:elixir-command-fallback';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['elixir-ls'],
    elixir: {
      enabled: true,
      cmd: 'elixir-ls-not-found'
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
    docHash: 'hash-elixir-command-fallback'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_elixir_command_fallback',
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

assert.equal(result.byChunkUid.has(chunkUid), false, 'expected fail-open fallback when elixir-ls command is unavailable');
const checks = result.diagnostics?.['elixir-ls']?.checks || [];
assert.equal(
  checks.some((check) => check?.name === 'elixir_command_unavailable'),
  true,
  'expected command unavailable warning'
);

console.log('elixir provider command fallback test passed');

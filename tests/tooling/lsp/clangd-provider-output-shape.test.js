#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.join(root, '.testCache', 'clangd-provider-output-shape');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'one.c'), 'int alpha(void) { return 1; }\n', 'utf8');

registerDefaultToolingProviders();
const provider = getToolingProvider('clangd');
assert.ok(provider, 'expected clangd provider');

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {},
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.c',
  effectiveExt: '.c',
  languageId: 'c',
  text: 'int alpha(void) { return 1; }\n',
  docHash: 'doc-1',
  containerPath: 'src/one.c'
};

const target = {
  virtualPath: 'src/one.c',
  languageId: 'c',
  chunkRef: {
    chunkUid: 'ck:test:clangd:1',
    file: 'src/one.c',
    start: 0,
    end: 10
  }
};

const output = await provider.run(ctx, { documents: [document], targets: [target, target] });
assert.ok(output && typeof output === 'object', 'expected output object');
assert.ok(output.byChunkUid && typeof output.byChunkUid === 'object', 'expected byChunkUid output');
assert.ok(!('byFile' in output), 'unexpected byFile key in output');
const checks = output.diagnostics?.checks || [];
const duplicate = checks.find((check) => check.name === 'duplicate_chunk_uid');
assert.ok(duplicate, 'expected duplicate chunkUid warning');
assert.ok(
  Array.isArray(duplicate.samples) && duplicate.samples[0]?.startsWith('ck:'),
  'expected duplicate chunkUid samples to be chunk-style ids'
);

console.log('clangd provider output shape test passed');

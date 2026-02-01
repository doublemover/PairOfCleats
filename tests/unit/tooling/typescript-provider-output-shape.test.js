#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

registerDefaultToolingProviders();
const provider = getToolingProvider('typescript');
assert.ok(provider, 'expected typescript provider');

const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.ts',
  effectiveExt: '.ts',
  languageId: 'typescript',
  text: 'export function alpha(): number { return 1; }\n',
  docHash: 'doc-1',
  containerPath: 'src/one.ts'
};

const target = {
  virtualPath: 'src/one.ts',
  languageId: 'typescript',
  chunkRef: {
    chunkUid: 'ck:test:typescript:1',
    file: 'src/one.ts',
    start: 0,
    end: 10
  },
  symbolHint: { name: 'alpha', kind: 'function' }
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

console.log('typescript provider output shape test passed');

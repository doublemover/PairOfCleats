#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'pyright-provider-output-shape');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

registerDefaultToolingProviders();
const provider = getToolingProvider('pyright');
assert.ok(provider, 'expected pyright provider');

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {},
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.py',
  effectiveExt: '.py',
  languageId: 'python',
  text: 'def alpha():\n    return 1\n',
  docHash: 'doc-1',
  containerPath: 'src/one.py'
};

const target = {
  virtualPath: 'src/one.py',
  languageId: 'python',
  chunkRef: {
    chunkUid: 'ck:test:pyright:1',
    file: 'src/one.py',
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

console.log('pyright provider output shape test passed');

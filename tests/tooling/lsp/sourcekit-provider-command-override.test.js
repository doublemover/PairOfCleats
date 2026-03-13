#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'sourcekit-provider-command-override');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

registerDefaultToolingProviders();
const provider = getToolingProvider('sourcekit');
assert.ok(provider, 'expected sourcekit provider');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'sourcekit-lsp.cmd' : 'sourcekit-lsp'
);
await fs.access(fixtureCmd);

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    sourcekit: {
      cmd: fixtureCmd,
      args: [],
      hostConcurrencyGate: true
    }
  },
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.swift',
  effectiveExt: '.swift',
  languageId: 'swift',
  text: 'func alpha() -> Int { return 1 }\n',
  docHash: 'doc-sourcekit-override',
  containerPath: 'src/one.swift'
};

const chunkUid = 'ck:test:sourcekit-override:1';
const target = {
  virtualPath: 'src/one.swift',
  languageId: 'swift',
  chunkRef: {
    chunkUid,
    chunkId: 'chunk_sourcekit_override',
    file: 'src/one.swift',
    start: 0,
    end: document.text.length
  },
  virtualRange: {
    start: 0,
    end: document.text.length
  },
  symbolHint: {
    name: 'alpha',
    kind: 'function'
  }
};

const output = await provider.run(ctx, { documents: [document], targets: [target] });
assert.ok(output?.byChunkUid?.[chunkUid], 'expected sourcekit payload output');

const runtimeCommand = output?.diagnostics?.runtime?.command || '';
assert.equal(runtimeCommand.length > 0, true, 'expected runtime command in diagnostics envelope');
assert.equal(
  path.resolve(runtimeCommand),
  path.resolve(fixtureCmd),
  'expected sourcekit runtime command to honor tooling.sourcekit.cmd override'
);
assert.equal(
  output?.diagnostics?.runtime?.pooling?.enabled,
  false,
  'expected sourcekit host concurrency gate to disable pooled LSP sessions'
);

console.log('sourcekit provider command override test passed');

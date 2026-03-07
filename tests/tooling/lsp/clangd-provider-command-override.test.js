#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'clangd-provider-command-override');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

registerDefaultToolingProviders();
const provider = getToolingProvider('clangd');
assert.ok(provider, 'expected clangd provider');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'clangd.cmd' : 'clangd'
);
await fs.access(fixtureCmd);

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    clangd: {
      cmd: fixtureCmd,
      args: ['--background-index=false', '--log=error']
    }
  },
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.c',
  effectiveExt: '.c',
  languageId: 'c',
  text: 'int alpha(void) { return 1; }\n',
  docHash: 'doc-clangd-override',
  containerPath: 'src/one.c'
};

const chunkUid = 'ck:test:clangd-override:1';
const target = {
  virtualPath: 'src/one.c',
  languageId: 'c',
  chunkRef: {
    chunkUid,
    chunkId: 'chunk_clangd_override',
    file: 'src/one.c',
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
assert.ok(output?.byChunkUid?.[chunkUid], 'expected clangd payload output');

const runtimeCommand = output?.diagnostics?.runtime?.command || '';
assert.equal(runtimeCommand.length > 0, true, 'expected runtime command in diagnostics envelope');
assert.equal(
  path.resolve(runtimeCommand),
  path.resolve(fixtureCmd),
  'expected clangd runtime command to honor tooling.clangd.cmd override'
);

console.log('clangd provider command override test passed');

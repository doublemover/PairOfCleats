#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'pyright-provider-command-override');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

registerDefaultToolingProviders();
const provider = getToolingProvider('pyright');
assert.ok(provider, 'expected pyright provider');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
);
await fs.access(fixtureCmd);

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    pyright: {
      command: fixtureCmd,
      args: ['--stdio']
    }
  },
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.py',
  effectiveExt: '.py',
  languageId: 'python',
  text: 'def greet(name: str) -> str:\n    return "hi"\n',
  docHash: 'doc-pyright-override',
  containerPath: 'src/one.py'
};

const chunkUid = 'ck:test:pyright-override:1';
const target = {
  virtualPath: 'src/one.py',
  languageId: 'python',
  chunkRef: {
    chunkUid,
    chunkId: 'chunk_pyright_override',
    file: 'src/one.py',
    start: 0,
    end: document.text.length
  },
  virtualRange: {
    start: 0,
    end: document.text.length
  },
  symbolHint: {
    name: 'greet',
    kind: 'function'
  }
};

const output = await provider.run(ctx, { documents: [document], targets: [target] });
const payload = output?.byChunkUid?.[chunkUid]?.payload || null;
assert.ok(payload, 'expected payload from pyright provider');
assert.equal(payload.returnType, 'str', 'expected pyright return type');
assert.equal(payload.paramTypes?.name?.[0]?.type, 'str', 'expected pyright param type');

const runtimeCommand = output?.diagnostics?.runtime?.command || '';
assert.equal(runtimeCommand.length > 0, true, 'expected runtime command in diagnostics envelope');
assert.equal(
  path.basename(runtimeCommand).toLowerCase().startsWith('pyright-langserver'),
  true,
  'expected runtime command to use pyright-langserver binary'
);

console.log('pyright provider command override test passed');

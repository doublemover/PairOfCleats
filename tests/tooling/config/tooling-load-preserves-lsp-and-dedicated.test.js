#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tooling-config-load-'));
const configPath = path.join(tempRoot, '.pairofcleats.json');

try {
  await fsPromises.writeFile(
    configPath,
    JSON.stringify({
      tooling: {
        lifecycle: {
          lifecycleRestartWindowMs: 61_000
        },
        cache: {
          enabled: true,
          maxBytes: 123456,
          maxEntries: 987
        },
        vfs: {
          hashRouting: true,
          coalesceSegments: true,
          tokenMode: 'docHash+virtualPath',
          coldStartCache: { enabled: true }
        },
        lsp: {
          lifecycle: {
            lifecycleMaxRestartsPerWindow: 9,
            lifecycleSessionIdleTimeoutMs: 2_500
          },
          servers: [{ id: 'gopls', cmd: 'gopls', args: [] }]
        },
        jdtls: { enabled: true },
        csharp: { enabled: true },
        solargraph: { enabled: true },
        elixir: { enabled: true },
        haskell: { enabled: true },
        phpactor: { enabled: true },
        dart: { enabled: true }
      }
    }, null, 2),
    'utf8'
  );

  const loaded = loadUserConfig(tempRoot);
  assert.equal(
    loaded.tooling?.lifecycle?.lifecycleRestartWindowMs,
    61_000,
    'expected tooling lifecycle to persist through config load'
  );
  assert.equal(loaded.tooling?.cache?.maxBytes, 123456, 'expected tooling cache maxBytes passthrough');
  assert.equal(loaded.tooling?.cache?.maxEntries, 987, 'expected tooling cache maxEntries passthrough');
  assert.equal(loaded.tooling?.vfs?.hashRouting, true, 'expected vfs hashRouting passthrough');
  assert.equal(loaded.tooling?.vfs?.coalesceSegments, true, 'expected vfs coalesceSegments passthrough');
  assert.equal(loaded.tooling?.vfs?.tokenMode, 'docHash+virtualPath', 'expected vfs tokenMode passthrough');
  assert.equal(loaded.tooling?.lsp?.lifecycle?.lifecycleMaxRestartsPerWindow, 9, 'expected lsp lifecycle passthrough');
  assert.equal(loaded.tooling?.lsp?.lifecycle?.lifecycleSessionIdleTimeoutMs, 2500, 'expected lsp session idle passthrough');
  assert.equal(loaded.tooling?.jdtls?.enabled, true, 'expected jdtls passthrough');
  assert.equal(loaded.tooling?.csharp?.enabled, true, 'expected csharp passthrough');
  assert.equal(loaded.tooling?.solargraph?.enabled, true, 'expected solargraph passthrough');
  assert.equal(loaded.tooling?.elixir?.enabled, true, 'expected elixir passthrough');
  assert.equal(loaded.tooling?.haskell?.enabled, true, 'expected haskell passthrough');
  assert.equal(loaded.tooling?.phpactor?.enabled, true, 'expected phpactor passthrough');
  assert.equal(loaded.tooling?.dart?.enabled, true, 'expected dart passthrough');

  console.log('tooling config load preserves lsp and dedicated providers test passed');
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

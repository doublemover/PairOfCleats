#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getToolingConfig } from '../../../src/shared/dict-utils.js';

const repoRoot = process.cwd();
const userConfig = {
  tooling: {
    timeoutMs: 42000,
    lifecycle: {
      lifecycleRestartWindowMs: 61000
    },
    lsp: {
      enabled: true,
      lifecycle: {
        lifecycleMaxRestartsPerWindow: 9
      },
      servers: [{ id: 'gopls', cmd: 'gopls', args: [] }]
    },
    clangd: {
      maxRetries: 7,
      disableHoverWithoutCompileCommands: false
    },
    gopls: {
      useServe: true
    },
    jdtls: {
      enabled: true
    },
    csharp: {
      enabled: true,
      lifecycle: {
        fdPressureBackoffMs: 500
      }
    }
  }
};

const tooling = getToolingConfig(repoRoot, userConfig);

assert.equal(tooling.timeoutMs, 42000, 'expected global tooling timeout');
assert.equal(
  tooling.lifecycle?.lifecycleRestartWindowMs,
  61000,
  'expected top-level lifecycle passthrough'
);
assert.equal(
  tooling.lsp?.lifecycle?.lifecycleMaxRestartsPerWindow,
  9,
  'expected lsp lifecycle passthrough'
);
assert.equal(tooling.lsp?.servers?.length, 1, 'expected normalized lsp server list');
assert.equal(tooling.clangd?.maxRetries, 7, 'expected clangd passthrough settings');
assert.equal(tooling.clangd?.disableHoverWithoutCompileCommands, false, 'expected clangd passthrough boolean');
assert.equal(tooling.gopls?.useServe, true, 'expected gopls passthrough settings');
assert.equal(tooling.jdtls?.enabled, true, 'expected jdtls config passthrough');
assert.equal(tooling.csharp?.enabled, true, 'expected csharp config passthrough');
assert.equal(tooling.csharp?.lifecycle?.fdPressureBackoffMs, 500, 'expected dedicated lifecycle passthrough');

console.log('tooling config lifecycle and dedicated passthrough test passed');

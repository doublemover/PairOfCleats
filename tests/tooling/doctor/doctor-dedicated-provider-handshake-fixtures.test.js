#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-dedicated-handshake-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

try {
  registerDefaultToolingProviders();
  const providerIds = [
    'jdtls',
    'csharp-ls',
    'solargraph',
    'elixir-ls',
    'phpactor',
    'haskell-language-server',
    'dart'
  ];
  const report = await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: providerIds
    },
    strict: false
  }, providerIds, {
    log: () => {},
    handshakeTimeoutMs: 1500
  });

  for (const providerId of providerIds) {
    const provider = (report.providers || []).find((entry) => entry.id === providerId);
    assert.ok(provider, `expected provider report for ${providerId}`);
    assert.ok(provider.command, `expected command profile for ${providerId}`);
    assert.equal(provider.command?.probe?.ok, true, `expected command probe success for ${providerId}`);
    assert.ok(provider.handshake, `expected handshake probe result for ${providerId}`);
    assert.equal(provider.handshake?.ok, true, `expected handshake success for ${providerId}`);
  }
} finally {
  process.env.PATH = originalPath;
}

console.log('tooling doctor dedicated provider handshake fixtures test passed');

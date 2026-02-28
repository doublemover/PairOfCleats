#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { skip } from '../../helpers/skip.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-dedicated-handshake-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

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

  let probeSuccessCount = 0;
  let handshakeSuccessCount = 0;
  for (const providerId of providerIds) {
    const provider = (report.providers || []).find((entry) => entry.id === providerId);
    assert.ok(provider, `expected provider report for ${providerId}`);
    assert.ok(provider.command, `expected command profile for ${providerId}`);
    if (provider.command?.probe?.ok === true) {
      probeSuccessCount += 1;
      assert.ok(provider.handshake, `expected handshake probe result for ${providerId}`);
      assert.equal(
        typeof provider.handshake?.ok,
        'boolean',
        `expected boolean handshake status for ${providerId}`
      );
      if (provider.handshake?.ok === true) {
        handshakeSuccessCount += 1;
      } else {
        assert.equal(
          typeof provider.handshake?.errorCode === 'string' && provider.handshake.errorCode.length > 0,
          true,
          `expected handshake error code for ${providerId} when handshake is not ok`
        );
      }
    } else {
      assert.equal(
        provider.handshake == null,
        true,
        `expected no handshake probe result for ${providerId} when command probe fails`
      );
    }
  }
  if (probeSuccessCount === 0) {
    skip('Skipping dedicated provider handshake test; no provider command probes succeeded.');
  }
  if (handshakeSuccessCount === 0) {
    skip('Skipping dedicated provider handshake test; no provider completed initialize handshake.');
  }
} finally {
  await restorePath();
}

console.log('tooling doctor dedicated provider handshake fixtures test passed');


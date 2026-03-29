#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getToolingConfig, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { repoRoot } from '../../helpers/root.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

{
  const repo = process.cwd();
  const userConfig = {
    tooling: {
      timeoutMs: 42000,
      lifecycle: {
        lifecycleRestartWindowMs: 61000
      },
      lsp: {
        enabled: true,
        lifecycle: {
          lifecycleMaxRestartsPerWindow: 9,
          lifecycleSessionIdleTimeoutMs: 2500,
          lifecycleSessionMaxLifetimeMs: 120000
        },
        servers: [{ id: 'gopls', cmd: 'gopls', args: [] }]
      },
      clangd: {
        maxRetries: 7,
        disableHoverWithoutCompileCommands: false
      },
      jdtls: { enabled: true },
      csharp: {
        enabled: true,
        lifecycle: {
          fdPressureBackoffMs: 500
        }
      }
    }
  };

  const tooling = getToolingConfig(repo, userConfig);
  assert.equal(tooling.timeoutMs, 42000);
  assert.equal(tooling.lifecycle?.lifecycleRestartWindowMs, 61000);
  assert.equal(tooling.lsp?.lifecycle?.lifecycleMaxRestartsPerWindow, 9);
  assert.equal(tooling.lsp?.lifecycle?.lifecycleSessionIdleTimeoutMs, 2500);
  assert.equal(tooling.lsp?.lifecycle?.lifecycleSessionMaxLifetimeMs, 120000);
  assert.equal(tooling.lsp?.servers?.length, 1);
  assert.equal(tooling.clangd?.maxRetries, 7);
  assert.equal(tooling.clangd?.disableHoverWithoutCompileCommands, false);
  assert.equal(tooling.jdtls?.enabled, true);
  assert.equal(tooling.csharp?.enabled, true);
  assert.equal(tooling.csharp?.lifecycle?.fdPressureBackoffMs, 500);
}

{
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-profile-'));
  try {
    await fsPromises.writeFile(
      path.join(tempRoot, '.pairofcleats.json'),
      JSON.stringify({ profile: 'lite' }, null, 2),
      'utf8'
    );
    assert.throws(() => loadUserConfig(tempRoot), /profile/);
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
}

{
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tooling-config-load-'));
  try {
    await fsPromises.writeFile(
      path.join(tempRoot, '.pairofcleats.json'),
      JSON.stringify({
        tooling: {
          lifecycle: { lifecycleRestartWindowMs: 61_000 },
          cache: { enabled: true, maxBytes: 123456, maxEntries: 987 },
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
    assert.equal(loaded.tooling?.lifecycle?.lifecycleRestartWindowMs, 61_000);
    assert.equal(loaded.tooling?.cache?.maxBytes, 123456);
    assert.equal(loaded.tooling?.cache?.maxEntries, 987);
    assert.equal(loaded.tooling?.vfs?.hashRouting, true);
    assert.equal(loaded.tooling?.vfs?.coalesceSegments, true);
    assert.equal(loaded.tooling?.vfs?.tokenMode, 'docHash+virtualPath');
    assert.equal(loaded.tooling?.lsp?.lifecycle?.lifecycleMaxRestartsPerWindow, 9);
    assert.equal(loaded.tooling?.lsp?.lifecycle?.lifecycleSessionIdleTimeoutMs, 2500);
    for (const name of ['jdtls', 'csharp', 'solargraph', 'elixir', 'haskell', 'phpactor', 'dart']) {
      assert.equal(loaded.tooling?.[name]?.enabled, true, `expected ${name} passthrough`);
    }
  } finally {
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
}

{
  const root = repoRoot();
  const cacheRoot = resolveTestCachePath(root, 'config-validate');
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const validPath = path.join(cacheRoot, 'valid.json');
  const validAnyOfPath = path.join(cacheRoot, 'valid-anyof.json');
  const invalidPath = path.join(cacheRoot, 'invalid.json');

  await fsPromises.writeFile(validPath, JSON.stringify({ quality: 'balanced', cache: { root: 'C:/tmp/pairofcleats' } }, null, 2));
  await fsPromises.writeFile(validAnyOfPath, JSON.stringify({
    quality: 'balanced',
    threads: 4,
    tooling: { enabledTools: ['pyright', 'clangd'] },
    indexing: {
      riskInterprocedural: {
        caps: { maxMs: null },
        semantics: [
          {
            kind: 'callback',
            patterns: ['\\bregisterHandler\\b'],
            languages: ['javascript'],
            frameworks: ['express'],
            fromArgs: [1],
            taintHints: ['payload']
          }
        ]
      }
    }
  }, null, 2));
  await fsPromises.writeFile(invalidPath, JSON.stringify({ unknownKey: true }, null, 2));

  const validatorPath = path.join(root, 'tools', 'config/validate.js');
  assert.ok(fs.existsSync(validatorPath), `Missing validator script: ${validatorPath}`);

  const okResult = spawnSync(process.execPath, [validatorPath, '--config', validPath, '--json'], { encoding: 'utf8' });
  assert.equal(okResult.status, 0, okResult.stderr || okResult.stdout);
  assert.equal(JSON.parse(okResult.stdout || '{}').ok, true);

  const anyOfResult = spawnSync(process.execPath, [validatorPath, '--config', validAnyOfPath, '--json'], { encoding: 'utf8' });
  assert.equal(anyOfResult.status, 0, anyOfResult.stderr || anyOfResult.stdout);
  assert.equal(JSON.parse(anyOfResult.stdout || '{}').ok, true);

  const badResult = spawnSync(process.execPath, [validatorPath, '--config', invalidPath, '--json'], { encoding: 'utf8' });
  assert.notEqual(badResult.status, 0);
  const badPayload = JSON.parse(badResult.stdout || '{}');
  assert.equal(badPayload.ok, false);
  assert.ok(Array.isArray(badPayload.errors) && badPayload.errors.length > 0);
}

{
  const repo = repoRoot();
  const scriptPath = path.join(repo, 'tools', 'config', 'dump.js');
  const result = spawnSync(process.execPath, [scriptPath, '--json'], { encoding: 'utf8', cwd: repo });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout || '{}');
  assert.ok(payload.repoRoot);
  assert.ok(payload.derived?.cacheRoot);
  assert.ok(payload.derived?.capabilityManifest?.surfaces?.api?.workflowCapabilities?.search);
}

console.log('tooling config contract matrix test passed');

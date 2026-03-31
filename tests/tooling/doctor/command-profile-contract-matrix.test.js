#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  __resetToolingCommandProbeCacheForTests,
  __resolveToolingProbeTimeoutMsForTests,
  isProbeCommandDefinitelyMissing,
  resolveToolingCommandProfile
} from '../../../src/index/tooling/command-resolver.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const testRoot = resolveTestCachePath(root, `tooling-doctor-command-profile-contract-${process.pid}-${Date.now()}`);
const restorePath = prependLspTestPath({ repoRoot: root });

const makeExecutable = async (targetPath, body, helperBody = '#!/usr/bin/env node\nprocess.exit(0);\n') => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, body, 'utf8');
  if (process.platform !== 'win32') {
    await fs.chmod(targetPath, 0o755);
    return;
  }
  await fs.writeFile(path.join(path.dirname(targetPath), 'ok.js'), helperBody, 'utf8');
};

const csharpScript = process.platform === 'win32'
  ? '@echo off\r\nnode "%~dp0\\ok.js" %*\r\n'
  : '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nexit 0\n';

const phpactorScript = process.platform === 'win32'
  ? '@echo off\r\nnode "%~dp0\\ok.js" %*\r\n'
  : '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nif [ "$1" = "--help" ]; then exit 0; fi\nif [ "$1" = "language-server" ]; then exit 0; fi\nexit 0\n';

const runTimeoutTierCases = () => {
  const cases = [
    {
      label: 'gopls fast tier',
      input: { providerId: 'gopls', requestedCmd: 'gopls', resolvedCmd: 'gopls' },
      expected: 2000
    },
    {
      label: 'jdtls heavy tier',
      input: { providerId: 'jdtls', requestedCmd: 'jdtls', resolvedCmd: 'jdtls' },
      expected: 8000
    },
    {
      label: 'sourcekit command token heavy tier',
      input: { providerId: 'custom-provider', requestedCmd: 'sourcekit-lsp', resolvedCmd: 'sourcekit-lsp' },
      expected: 8000
    },
    {
      label: 'default balanced tier',
      input: { providerId: 'custom-unknown', requestedCmd: 'custom-tool', resolvedCmd: 'custom-tool' },
      expected: 4000
    },
    {
      label: 'explicit override wins',
      input: {
        providerId: 'jdtls',
        requestedCmd: 'jdtls',
        resolvedCmd: 'jdtls',
        explicitTimeoutMs: 1234
      },
      expected: 1234
    },
    {
      label: 'explicit floor clamps',
      input: {
        providerId: 'jdtls',
        requestedCmd: 'jdtls',
        resolvedCmd: 'jdtls',
        explicitTimeoutMs: 10
      },
      expected: 100
    }
  ];

  for (const testCase of cases) {
    assert.equal(
      __resolveToolingProbeTimeoutMsForTests(testCase.input),
      testCase.expected,
      `unexpected timeout for ${testCase.label}`
    );
  }
};

const runMissingDetectionCases = () => {
  const cases = [
    {
      label: 'enoent means missing',
      probe: {
        attempted: [{ args: ['--help'], errorCode: 'ENOENT', stderr: '', stdout: '', exitCode: null }]
      },
      expected: true
    },
    {
      label: 'shell text means missing',
      probe: {
        attempted: [{
          args: ['--version'],
          exitCode: 127,
          stderr: 'bash: sourcekit-lsp: command not found',
          stdout: '',
          errorCode: null
        }]
      },
      expected: true
    },
    {
      label: 'usage failure is inconclusive',
      probe: {
        attempted: [{
          args: ['--help'],
          exitCode: 1,
          stderr: 'usage: sourcekit-lsp [options]',
          stdout: '',
          errorCode: null
        }]
      },
      expected: false
    },
    {
      label: 'mixed attempts stay inconclusive',
      probe: {
        attempted: [
          { args: ['--version'], errorCode: 'ENOENT', stderr: '', stdout: '', exitCode: null },
          {
            args: ['--help'],
            exitCode: 1,
            stderr: 'usage: sourcekit-lsp [options]',
            stdout: '',
            errorCode: null
          }
        ]
      },
      expected: false
    }
  ];

  for (const testCase of cases) {
    assert.equal(
      isProbeCommandDefinitelyMissing(testCase.probe),
      testCase.expected,
      `unexpected missing-command detection for ${testCase.label}`
    );
  }
};

const runCommandResolutionCases = async () => {
  const runtimeDir = path.join(testRoot, 'runtime-bin-dirs');
  const dotnetDir = path.join(runtimeDir, 'tooling', 'dotnet');
  const composerBinDir = path.join(runtimeDir, 'tooling', 'composer', 'vendor', 'bin');

  await withTemporaryEnv({
    PATH: path.dirname(process.execPath),
    Path: path.dirname(process.execPath),
    PAIROFCLEATS_TESTING: '1'
  }, async () => {
    await fs.rm(runtimeDir, { recursive: true, force: true });
    await makeExecutable(
      path.join(dotnetDir, process.platform === 'win32' ? 'csharp-ls.cmd' : 'csharp-ls'),
      csharpScript
    );
    await makeExecutable(
      path.join(composerBinDir, process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor'),
      phpactorScript
    );

    const csharpProfile = resolveToolingCommandProfile({
      providerId: 'csharp-ls',
      cmd: 'csharp-ls',
      args: [],
      repoRoot: root,
      toolingConfig: { dir: path.join(runtimeDir, 'tooling') }
    });
    assert.equal(csharpProfile.probe.ok, true);
    assert.equal(path.dirname(csharpProfile.resolved.cmd), dotnetDir);

    const phpactorProfile = resolveToolingCommandProfile({
      providerId: 'phpactor',
      cmd: 'phpactor',
      args: ['language-server'],
      repoRoot: root,
      toolingConfig: { dir: path.join(runtimeDir, 'tooling') }
    });
    assert.equal(phpactorProfile.probe.ok, true);
    assert.equal(path.dirname(phpactorProfile.resolved.cmd), composerBinDir);
  });

  const globalDir = path.join(testRoot, 'global-bin-fallbacks');
  const homeDir = path.join(globalDir, 'home');
  const localAppDataDir = path.join(globalDir, 'localappdata');
  const dotnetGlobalBin = path.join(homeDir, '.dotnet', 'tools');
  const phpactorGlobalBin = path.join(localAppDataDir, 'Programs', 'phpactor');

  await withTemporaryEnv({
    HOME: homeDir,
    USERPROFILE: homeDir,
    LOCALAPPDATA: localAppDataDir,
    PATH: path.dirname(process.execPath),
    Path: path.dirname(process.execPath),
    PAIROFCLEATS_TESTING: '1'
  }, async () => {
    await fs.rm(globalDir, { recursive: true, force: true });
    await makeExecutable(
      path.join(dotnetGlobalBin, process.platform === 'win32' ? 'csharp-ls.cmd' : 'csharp-ls'),
      csharpScript
    );
    await makeExecutable(
      path.join(phpactorGlobalBin, process.platform === 'win32' ? 'phpactor.cmd' : 'phpactor'),
      phpactorScript
    );

    const csharpProfile = resolveToolingCommandProfile({
      providerId: 'csharp-ls',
      cmd: 'csharp-ls',
      args: [],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(csharpProfile.probe.ok, true);
    assert.equal(path.dirname(csharpProfile.resolved.cmd), dotnetGlobalBin);

    const phpactorProfile = resolveToolingCommandProfile({
      providerId: 'phpactor',
      cmd: 'phpactor',
      args: ['language-server'],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(phpactorProfile.probe.ok, true);
    assert.equal(path.dirname(phpactorProfile.resolved.cmd), phpactorGlobalBin);
  });
};

const runToolingDirPrecedenceCase = async () => {
  const toolingDir = path.join(root, 'tests', 'fixtures', 'lsp');
  const expectedBinDir = path.join(toolingDir, 'bin');
  const fixtureCacheDir = path.join(toolingDir, 'cache', 'command-probes');
  const cacheRoot = path.join(testRoot, 'tooling-dir-precedence');
  const expectedPersistentCacheDir = path.join(cacheRoot, 'cache', 'tooling', 'command-probes');
  const nodeBin = path.dirname(process.execPath);

  await withTemporaryEnv({
    PATH: nodeBin,
    Path: nodeBin,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_TESTING: '1'
  }, async () => {
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await fs.rm(fixtureCacheDir, { recursive: true, force: true });
    try {
      const profile = resolveToolingCommandProfile({
        providerId: 'jdtls',
        cmd: 'jdtls',
        args: [],
        repoRoot: root,
        toolingConfig: { dir: toolingDir }
      });
      assert.equal(profile.probe.ok, true, 'expected probe to succeed from tooling dir');
      assert.equal(path.dirname(profile.resolved.cmd), expectedBinDir, 'expected command to resolve from tooling dir bin');
      assert.equal(/^jdtls(\.cmd|\.exe|\.bat)?$/i.test(path.basename(profile.resolved.cmd)), true, 'expected jdtls binary');
      assert.equal(fsSync.existsSync(fixtureCacheDir), false, 'expected persistent probe cache to avoid fixture tooling dir');
      assert.equal(fsSync.existsSync(expectedPersistentCacheDir), true, 'expected persistent probe cache under test cache root');
    } finally {
      await fs.rm(cacheRoot, { recursive: true, force: true });
      await fs.rm(fixtureCacheDir, { recursive: true, force: true });
    }
  });
};

const runDirectProbeCases = async () => {
  const jdtlsProfile = resolveToolingCommandProfile({
    providerId: 'jdtls',
    cmd: 'jdtls',
    args: [],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(jdtlsProfile.probe.ok, true, 'expected jdtls probe to resolve command');
  assert.equal(
    Array.isArray(jdtlsProfile.probe.attempted) && jdtlsProfile.probe.attempted.length > 0,
    true,
    'expected jdtls probe to execute at least one probe argument'
  );
  assert.equal(jdtlsProfile.resolved.mode, 'direct', 'expected direct launch mode for jdtls');

  const zigProfile = resolveToolingCommandProfile({
    providerId: 'zig',
    cmd: 'zig',
    args: ['version'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(zigProfile.probe.attempted?.[0]?.args?.[0], 'version', 'expected zig probe to prefer `zig version`');

  const erlProfile = resolveToolingCommandProfile({
    providerId: 'elixir-ls-erl',
    cmd: 'erl',
    args: ['-version'],
    repoRoot: root,
    toolingConfig: {}
  });
  assert.equal(erlProfile.probe.attempted?.[0]?.args?.[0], '-version', 'expected erl probe to prefer `erl -version`');
};

const runPyrightOverrideCases = async () => {
  const fixtureCmd = path.join(
    root,
    'tests',
    'fixtures',
    'lsp',
    'bin',
    process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
  );
  const nodeBin = path.dirname(process.execPath);

  await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
    const explicitProfile = resolveToolingCommandProfile({
      providerId: 'pyright',
      cmd: fixtureCmd,
      args: ['--stdio'],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(explicitProfile.probe.ok, true, 'expected explicit pyright command path probe to succeed');
    assert.equal(path.resolve(explicitProfile.resolved.cmd), path.resolve(fixtureCmd), 'expected explicit pyright command path to be preserved');
  });

  await withTemporaryEnv({ PATH: nodeBin, Path: nodeBin }, async () => {
    const defaultProfile = resolveToolingCommandProfile({
      providerId: 'pyright',
      cmd: 'pyright-langserver',
      args: ['--stdio'],
      repoRoot: root,
      toolingConfig: {}
    });
    assert.equal(defaultProfile.probe.ok, true, 'expected default pyright command probe to tolerate stdio usage error output');
  });
};

const runProbeTimeoutCase = async () => {
  __resetToolingCommandProbeCacheForTests();
  const startedAt = Date.now();
  const profile = resolveToolingCommandProfile({
    providerId: 'timeout-probe',
    cmd: 'hang-probe',
    args: [],
    repoRoot: root,
    toolingConfig: {},
    probeTimeoutMs: 120
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(profile.probe.ok, false, 'expected hanging probe command to fail');
  assert.equal(profile.probe.attempted?.[0]?.args?.[0], '--version', 'expected default probe to start with --version');
  assert.equal(profile.probe.attempted?.[0]?.errorCode, 'SUBPROCESS_TIMEOUT', 'expected hanging probe to be classified as a timeout');
  assert.equal(elapsedMs < 2_000, true, `expected probe attempts to be bounded by timeout (elapsed=${elapsedMs}ms)`);
};

const runLuaManagedLayoutValidationCase = async () => {
  const caseRoot = path.join(testRoot, 'lua-managed-layout-validation');
  const toolingRoot = path.join(caseRoot, 'tooling-root');
  const binDir = path.join(toolingRoot, 'bin');

  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(binDir, { recursive: true });

  if (process.platform === 'win32') {
    await fs.writeFile(
      path.join(binDir, 'lua-language-server.cmd'),
      '@echo off\r\nif "%1"=="-v" exit /b 0\r\nif "%1"=="--version" exit /b 0\r\nexit /b 0\r\n',
      'utf8'
    );
  } else {
    await makeExecutable(path.join(binDir, 'lua-language-server'), '#!/bin/sh\nexit 0\n');
  }

  await withTemporaryEnv({ PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) }, async () => {
    const profile = resolveToolingCommandProfile({
      providerId: 'lua-language-server',
      cmd: 'lua-language-server',
      args: ['-v'],
      repoRoot: root,
      toolingConfig: { dir: toolingRoot }
    });
    assert.equal(profile.probe.ok, false, 'expected broken managed Lua layout to fail validation');
    assert.equal(profile.probe.validationFailure?.reasonCode, 'broken-layout');
    assert.equal(
      Array.isArray(profile.probe.failureReasons) && profile.probe.failureReasons.includes('broken-layout'),
      true,
      'expected broken layout failure reason to be surfaced'
    );
  });
};

const runProviderOverrideCase = async () => {
  registerDefaultToolingProviders();
  const requestedByProvider = new Map();
  const resolveCommandProfile = ({ providerId, cmd, args = [] }) => {
    if (!providerId.includes('-runtime-') && providerId !== 'zig') {
      requestedByProvider.set(providerId, {
        cmd,
        args: Array.isArray(args) ? args.slice() : []
      });
    }
    return {
      requested: { cmd, args },
      resolved: { cmd, args, mode: 'mock', reason: 'test' },
      probe: { ok: true, attempted: [{ args: ['--version'], exitCode: 0 }] }
    };
  };

  const tempRoot = path.join(testRoot, 'provider-overrides');
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  const providerIds = [
    'pyright',
    'csharp-ls',
    'dart',
    'elixir-ls',
    'haskell-language-server',
    'phpactor',
    'solargraph'
  ];

  await runToolingDoctor({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: providerIds,
      pyright: { command: 'pyright-custom', args: ['--stdio', '--watch'] },
      csharp: { cmd: 'csharp-custom' },
      dart: { cmd: 'dart-custom' },
      elixir: { cmd: 'elixir-custom' },
      haskell: { cmd: 'hls-custom' },
      phpactor: { cmd: 'phpactor-custom' },
      solargraph: { cmd: 'solargraph-custom' }
    },
    strict: false
  }, providerIds, {
    log: () => {},
    probeHandshake: false,
    resolveCommandProfile
  });

  assert.equal(requestedByProvider.get('pyright')?.cmd, 'pyright-custom');
  assert.deepEqual(requestedByProvider.get('pyright')?.args, ['--stdio', '--watch']);
  assert.equal(requestedByProvider.get('csharp-ls')?.cmd, 'csharp-custom');
  assert.equal(requestedByProvider.get('dart')?.cmd, 'dart-custom');
  assert.equal(requestedByProvider.get('elixir-ls')?.cmd, 'elixir-custom');
  assert.equal(requestedByProvider.get('haskell-language-server')?.cmd, 'hls-custom');
  assert.equal(requestedByProvider.get('phpactor')?.cmd, 'phpactor-custom');
  assert.equal(requestedByProvider.get('solargraph')?.cmd, 'solargraph-custom');
};

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

try {
  runTimeoutTierCases();
  runMissingDetectionCases();
  await runCommandResolutionCases();
  await runToolingDirPrecedenceCase();
  await runDirectProbeCases();
  await runPyrightOverrideCases();
  await runProbeTimeoutCase();
  await runLuaManagedLayoutValidationCase();
  await runProviderOverrideCase();
  console.log('tooling doctor command profile contract matrix test passed');
} finally {
  __resetToolingCommandProbeCacheForTests();
  await restorePath();
  await fs.rm(testRoot, { recursive: true, force: true });
}

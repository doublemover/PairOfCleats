#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'sourcekit-package-preflight-abort');
const binDir = path.join(tempRoot, 'bin');
const swiftCmdPath = path.join(binDir, 'swift.cmd');
const swiftPosixPath = path.join(binDir, 'swift');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(binDir, { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'one.swift'), 'func alpha() -> Int { return 1 }\n', 'utf8');
await fs.writeFile(
  path.join(tempRoot, 'Package.swift'),
  [
    '// swift-tools-version: 6.0',
    'import PackageDescription',
    'let package = Package(',
    '  name: "Sample",',
    '  dependencies: [',
    '    .package(url: "https://example.com/demo.git", from: "1.0.0")',
    '  ],',
    '  targets: [',
    '    .target(name: "Sample")',
    '  ]',
    ')',
    ''
  ].join('\n'),
  'utf8'
);
await fs.writeFile(
  swiftCmdPath,
  [
    '@echo off',
    'if "%1"=="--version" (',
    '  echo Swift stub',
    '  exit /b 0',
    ')',
    'if "%1"=="--help" (',
    '  echo Swift stub help',
    '  exit /b 0',
    ')',
    'if "%1"=="package" if "%2"=="resolve" (',
    '  ping -n 6 127.0.0.1 >nul',
    '  exit /b 0',
    ')',
    'exit /b 1',
    ''
  ].join('\r\n'),
  'utf8'
);
await fs.writeFile(
  swiftPosixPath,
  [
    '#!/usr/bin/env sh',
    'if [ "$1" = "--version" ]; then',
    '  echo "Swift stub"',
    '  exit 0',
    'fi',
    'if [ "$1" = "--help" ]; then',
    '  echo "Swift stub help"',
    '  exit 0',
    'fi',
    'if [ "$1" = "package" ] && [ "$2" = "resolve" ]; then',
    '  sleep 5',
    '  exit 0',
    'fi',
    'exit 1',
    ''
  ].join('\n'),
  'utf8'
);
try {
  await fs.chmod(swiftPosixPath, 0o755);
} catch {}

const restorePath = prependLspTestPath({
  repoRoot: root,
  extraPrepend: [binDir, path.dirname(process.execPath)]
});

try {
  registerDefaultToolingProviders();
  const provider = getToolingProvider('sourcekit');
  assert.ok(provider, 'expected sourcekit provider');

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(new Error('abort sourcekit preflight run')), 75);

  try {
    const ctx = {
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {},
      logger: () => {},
      strict: true,
      abortSignal: abortController.signal
    };
    const document = {
      virtualPath: 'src/one.swift',
      effectiveExt: '.swift',
      languageId: 'swift',
      text: 'func alpha() -> Int { return 1 }\n',
      docHash: 'doc-1',
      containerPath: 'src/one.swift'
    };
    const target = {
      virtualPath: 'src/one.swift',
      languageId: 'swift',
      chunkRef: {
        chunkUid: 'ck:test:sourcekit:preflight-abort:1',
        file: 'src/one.swift',
        start: 0,
        end: 12
      }
    };

    const startedAtMs = Date.now();
    await assert.rejects(
      () => provider.run(ctx, { documents: [document], targets: [target] }),
      (err) => err?.code === 'ABORT_ERR',
      'expected sourcekit run to abort while preflight is in progress'
    );
    const elapsedMs = Date.now() - startedAtMs;
    assert.ok(elapsedMs < 2000, `expected sourcekit preflight abort to short-circuit promptly (elapsed=${elapsedMs}ms)`);
  } finally {
    clearTimeout(abortTimer);
  }
} finally {
  await restorePath();
}

console.log('sourcekit package preflight abort test passed');


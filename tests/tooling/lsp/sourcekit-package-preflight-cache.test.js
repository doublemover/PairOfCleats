#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'sourcekit-package-preflight-cache');
const fixtureBinDir = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const markerPath = path.join(tempRoot, '.build', 'pairofcleats', 'sourcekit-package-preflight.json');
const counterPath = path.join(tempRoot, 'swift-preflight.counter');
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
    '  if not "%POC_SWIFT_PREFLIGHT_COUNTER%"=="" echo resolve>>"%POC_SWIFT_PREFLIGHT_COUNTER%"',
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
    '  if [ -n "$POC_SWIFT_PREFLIGHT_COUNTER" ]; then',
    '    printf "resolve\\n" >> "$POC_SWIFT_PREFLIGHT_COUNTER"',
    '  fi',
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

const originalPath = process.env.PATH;
const originalCounter = process.env.POC_SWIFT_PREFLIGHT_COUNTER;
const logs = [];

process.env.PATH = [binDir, fixtureBinDir, path.dirname(process.execPath)].filter(Boolean).join(path.delimiter);
process.env.POC_SWIFT_PREFLIGHT_COUNTER = counterPath;

try {
  registerDefaultToolingProviders();
  const provider = getToolingProvider('sourcekit');
  assert.ok(provider, 'expected sourcekit provider');

  const ctx = {
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {},
    logger: (line) => logs.push(String(line || '')),
    strict: true
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
      chunkUid: 'ck:test:sourcekit:preflight-cache:1',
      file: 'src/one.swift',
      start: 0,
      end: 12
    }
  };

  const first = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.ok(first && typeof first.byChunkUid === 'object', 'expected first sourcekit run output');

  const counterAfterFirst = await fs.readFile(counterPath, 'utf8');
  const firstCount = counterAfterFirst.split(/\r?\n/).filter(Boolean).length;
  assert.equal(firstCount, 1, 'expected swift package preflight to run exactly once on first pass');

  const second = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.ok(second && typeof second.byChunkUid === 'object', 'expected second sourcekit run output');

  const counterAfterSecond = await fs.readFile(counterPath, 'utf8');
  const secondCount = counterAfterSecond.split(/\r?\n/).filter(Boolean).length;
  assert.equal(secondCount, 1, 'expected sourcekit package preflight cache to skip repeated resolve');

  await fs.writeFile(
    path.join(tempRoot, 'Package.swift'),
    [
      '// swift-tools-version: 6.0',
      'import PackageDescription',
      'let package = Package(',
      '  name: "Sample",',
      '  dependencies: [',
      '    .package(url: "https://example.com/demo.git", from: "1.1.0")',
      '  ],',
      '  targets: [',
      '    .target(name: "Sample")',
      '  ]',
      ')',
      ''
    ].join('\n'),
    'utf8'
  );
  const third = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.ok(third && typeof third.byChunkUid === 'object', 'expected third sourcekit run output');
  const counterAfterThird = await fs.readFile(counterPath, 'utf8');
  const thirdCount = counterAfterThird.split(/\r?\n/).filter(Boolean).length;
  assert.equal(thirdCount, 2, 'expected manifest change to invalidate preflight cache');

  await fs.access(markerPath);
  assert.ok(
    logs.some((line) => line.includes('sourcekit package preflight cache hit')),
    'expected cache-hit log after repeated run'
  );
} finally {
  if (originalPath == null) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalCounter == null) {
    delete process.env.POC_SWIFT_PREFLIGHT_COUNTER;
  } else {
    process.env.POC_SWIFT_PREFLIGHT_COUNTER = originalCounter;
  }
}

console.log('sourcekit package preflight cache test passed');

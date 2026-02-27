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
const tempRoot = resolveTestCachePath(root, 'sourcekit-package-preflight-failure');
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
    '  echo forced preflight failure 1>&2',
    '  exit /b 7',
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
    '  echo "forced preflight failure" 1>&2',
    '  exit 7',
    'fi',
    'exit 1',
    ''
  ].join('\n'),
  'utf8'
);
try {
  await fs.chmod(swiftPosixPath, 0o755);
} catch {}

const originalCounter = process.env.POC_SWIFT_PREFLIGHT_COUNTER;
const logs = [];

const restorePath = prependLspTestPath({
  repoRoot: root,
  extraPrepend: [binDir, path.dirname(process.execPath)]
});
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
      chunkUid: 'ck:test:sourcekit:preflight-failure:1',
      file: 'src/one.swift',
      start: 0,
      end: 12
    }
  };

  const output = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.deepEqual(output.byChunkUid || {}, {}, 'expected sourcekit to skip enrichment after preflight failure');
  const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
  assert.ok(
    checks.some((check) => check?.name === 'sourcekit_package_preflight_failed'),
    'expected sourcekit preflight failure check in diagnostics'
  );
  assert.ok(
    logs.some((line) => line.includes('sourcekit skipped because package preflight did not complete safely')),
    'expected sourcekit skip log after preflight failure'
  );
  const counterAfterRun = await fs.readFile(counterPath, 'utf8');
  const count = counterAfterRun.split(/\r?\n/).filter(Boolean).length;
  assert.equal(count, 1, 'expected one preflight resolve attempt');
} finally {
  restorePath();
  if (originalCounter == null) {
    delete process.env.POC_SWIFT_PREFLIGHT_COUNTER;
  } else {
    process.env.POC_SWIFT_PREFLIGHT_COUNTER = originalCounter;
  }
}

console.log('sourcekit package preflight failure test passed');

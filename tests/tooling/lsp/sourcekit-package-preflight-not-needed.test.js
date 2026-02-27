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
const tempRoot = resolveTestCachePath(root, 'sourcekit-package-preflight-not-needed');
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
    '  dependencies: [],',
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
    'if "%1"=="--version" exit /b 0',
    'if "%1"=="--help" exit /b 0',
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
    'if [ "$1" = "--version" ]; then exit 0; fi',
    'if [ "$1" = "--help" ]; then exit 0; fi',
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
      chunkUid: 'ck:test:sourcekit:preflight-not-needed:1',
      file: 'src/one.swift',
      start: 0,
      end: 12
    }
  };

  const output = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.ok(output && typeof output.byChunkUid === 'object', 'expected sourcekit output');
  const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
  assert.equal(
    checks.some((check) => String(check?.name || '').startsWith('sourcekit_package_preflight_')),
    false,
    'expected no preflight diagnostics when package resolution is not needed'
  );
  let counterExists = true;
  try {
    await fs.access(counterPath);
  } catch {
    counterExists = false;
  }
  assert.equal(counterExists, false, 'expected no swift package resolve invocation');
  assert.equal(
    logs.some((line) => line.includes('sourcekit package preflight: running')),
    false,
    'expected no preflight-run log when manifest has no package dependencies'
  );
} finally {
  restorePath();
  if (originalCounter == null) {
    delete process.env.POC_SWIFT_PREFLIGHT_COUNTER;
  } else {
    process.env.POC_SWIFT_PREFLIGHT_COUNTER = originalCounter;
  }
}

console.log('sourcekit package preflight not-needed test passed');

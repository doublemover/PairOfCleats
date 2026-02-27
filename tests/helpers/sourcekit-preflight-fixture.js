import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from './test-cache.js';
import { prependLspTestPath } from './lsp-runtime.js';

const buildPackageSwift = ({ dependencyVersion = '1.0.0', includeDependencies = true }) => {
  const dependencyLines = includeDependencies
    ? [
      '  dependencies: [',
      `    .package(url: "https://example.com/demo.git", from: "${dependencyVersion}")`,
      '  ],'
    ]
    : [
      '  dependencies: [],'
    ];
  return [
    '// swift-tools-version: 6.0',
    'import PackageDescription',
    'let package = Package(',
    '  name: "Sample",',
    ...dependencyLines,
    '  targets: [',
    '    .target(name: "Sample")',
    '  ]',
    ')',
    ''
  ].join('\n');
};

const buildSwiftCmd = ({ resolveExitCode = 0, resolveStderr = '' }) => {
  const maybeStderr = resolveStderr ? `  echo ${resolveStderr} 1>&2` : '';
  return [
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
    ...(maybeStderr ? [maybeStderr] : []),
    `  exit /b ${Math.max(0, Math.floor(Number(resolveExitCode) || 0))}`,
    ')',
    'exit /b 1',
    ''
  ].join('\r\n');
};

const buildSwiftPosix = ({ resolveExitCode = 0, resolveStderr = '' }) => {
  const maybeStderr = resolveStderr ? `  echo "${resolveStderr}" 1>&2` : '';
  return [
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
    ...(maybeStderr ? [maybeStderr] : []),
    `  exit ${Math.max(0, Math.floor(Number(resolveExitCode) || 0))}`,
    'fi',
    'exit 1',
    ''
  ].join('\n');
};

/**
 * Create a reusable sourcekit preflight fixture workspace + command stubs.
 *
 * @param {{
 *   root:string,
 *   name:string,
 *   includeDependencies?:boolean,
 *   dependencyVersion?:string,
 *   resolveExitCode?:number,
 *   resolveStderr?:string
 * }} input
 * @returns {Promise<{
 *   tempRoot:string,
 *   binDir:string,
 *   markerPath:string,
 *   counterPath:string,
 *   restorePath:()=>void,
 *   writePackage:(options?:{dependencyVersion?:string,includeDependencies?:boolean})=>Promise<void>,
 *   contextFor:(logs:string[])=>{ctx:object,document:object,target:object}
 * }>}
 */
export const createSourcekitPreflightFixture = async (input) => {
  const root = path.resolve(String(input?.root || process.cwd()));
  const name = String(input?.name || 'sourcekit-preflight-fixture').trim() || 'sourcekit-preflight-fixture';
  const tempRoot = resolveTestCachePath(root, name);
  const markerPath = path.join(tempRoot, '.build', 'pairofcleats', 'sourcekit-package-preflight.json');
  const counterPath = path.join(tempRoot, 'swift-preflight.counter');
  const binDir = path.join(tempRoot, 'bin');
  const swiftCmdPath = path.join(binDir, 'swift.cmd');
  const swiftPosixPath = path.join(binDir, 'swift');

  const writePackage = async (options = {}) => {
    await fs.writeFile(
      path.join(tempRoot, 'Package.swift'),
      buildPackageSwift({
        dependencyVersion: options?.dependencyVersion ?? input?.dependencyVersion ?? '1.0.0',
        includeDependencies: options?.includeDependencies ?? input?.includeDependencies ?? true
      }),
      'utf8'
    );
  };

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'src', 'one.swift'), 'func alpha() -> Int { return 1 }\n', 'utf8');
  await writePackage();
  await fs.writeFile(
    swiftCmdPath,
    buildSwiftCmd({
      resolveExitCode: input?.resolveExitCode ?? 0,
      resolveStderr: input?.resolveStderr || ''
    }),
    'utf8'
  );
  await fs.writeFile(
    swiftPosixPath,
    buildSwiftPosix({
      resolveExitCode: input?.resolveExitCode ?? 0,
      resolveStderr: input?.resolveStderr || ''
    }),
    'utf8'
  );
  try {
    await fs.chmod(swiftPosixPath, 0o755);
  } catch {}

  const restorePath = prependLspTestPath({
    repoRoot: root,
    extraPrepend: [binDir, path.dirname(process.execPath)]
  });

  const contextFor = (logs) => {
    const logSink = Array.isArray(logs) ? logs : [];
    return {
      ctx: {
        repoRoot: tempRoot,
        buildRoot: tempRoot,
        toolingConfig: {},
        logger: (line) => logSink.push(String(line || '')),
        strict: true
      },
      document: {
        virtualPath: 'src/one.swift',
        effectiveExt: '.swift',
        languageId: 'swift',
        text: 'func alpha() -> Int { return 1 }\n',
        docHash: 'doc-1',
        containerPath: 'src/one.swift'
      },
      target: {
        virtualPath: 'src/one.swift',
        languageId: 'swift',
        chunkRef: {
          chunkUid: `ck:test:sourcekit:${name}:1`,
          file: 'src/one.swift',
          start: 0,
          end: 12
        }
      }
    };
  };

  return {
    tempRoot,
    binDir,
    markerPath,
    counterPath,
    restorePath,
    writePackage,
    contextFor
  };
};

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSourcekitPackageResolutionPreflight } from '../../../src/index/tooling/preflight/sourcekit-package-resolution.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `sourcekit-workspace-classification-${process.pid}-${Date.now()}`);
const packageRoot = path.join(tempRoot, 'package-workspace');
const xcodeRoot = path.join(tempRoot, 'xcode-workspace');
const mixedRoot = path.join(tempRoot, 'mixed-workspace');

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.mkdir(xcodeRoot, { recursive: true });
  await fs.mkdir(mixedRoot, { recursive: true });

  await fs.writeFile(
    path.join(packageRoot, 'Package.swift'),
    [
      '// swift-tools-version: 6.0',
      'import PackageDescription',
      'let package = Package(',
      '  name: "PackageOnly",',
      '  dependencies: [],',
      '  targets: [',
      '    .target(name: "PackageOnly")',
      '  ]',
      ')',
      ''
    ].join('\n'),
    'utf8'
  );
  await fs.mkdir(path.join(xcodeRoot, 'Demo.xcodeproj'), { recursive: true });
  await fs.writeFile(
    path.join(mixedRoot, 'Package.swift'),
    [
      '// swift-tools-version: 6.0',
      'import PackageDescription',
      'let package = Package(',
      '  name: "Mixed",',
      '  dependencies: [],',
      '  targets: [',
      '    .target(name: "Mixed")',
      '  ]',
      ')',
      ''
    ].join('\n'),
    'utf8'
  );
  await fs.mkdir(path.join(mixedRoot, 'Demo.xcodeproj'), { recursive: true });

  const packageResult = await ensureSourcekitPackageResolutionPreflight({
    repoRoot: packageRoot,
    log: () => {},
    sourcekitConfig: {}
  });
  const xcodeResult = await ensureSourcekitPackageResolutionPreflight({
    repoRoot: xcodeRoot,
    log: () => {},
    sourcekitConfig: {}
  });
  const mixedResult = await ensureSourcekitPackageResolutionPreflight({
    repoRoot: mixedRoot,
    log: () => {},
    sourcekitConfig: {}
  });

  assert.equal(packageResult.workspaceKind, 'package_managed_workspace');
  assert.equal(packageResult.dependencyState, 'not_needed');
  assert.equal(packageResult.preflightState, 'ready');

  assert.equal(xcodeResult.workspaceKind, 'xcode_workspace');
  assert.equal(xcodeResult.dependencyState, 'not_applicable');
  assert.equal(xcodeResult.preflightState, 'ready');

  assert.equal(mixedResult.workspaceKind, 'mixed_workspace');
  assert.equal(mixedResult.dependencyState, 'not_needed');
  assert.equal(mixedResult.preflightState, 'ready');

  console.log('sourcekit workspace classification test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

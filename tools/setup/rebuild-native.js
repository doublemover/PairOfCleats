#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REQUIRED_NATIVE_PACKAGES = [
  'tree-sitter',
  'tree-sitter-swift',
  'better-sqlite3',
  'hnswlib-node',
  'onnxruntime-node',
  '@lancedb/lancedb',
  'sharp',
  'lmdb'
];

const OPTIONAL_NATIVE_PACKAGES = [
  '@mongodb-js/zstd',
  '@parcel/watcher',
  're2',
  '@node-rs/xxhash'
];

const root = process.cwd();

const resolveNodeModulesPath = (pkgName) => (
  path.join(root, 'node_modules', ...pkgName.split('/'))
);

const isInstalled = (pkgName) => fs.existsSync(resolveNodeModulesPath(pkgName));

const rebuildPackage = (pkgName) => {
  const result = spawnSync('npm', ['rebuild', pkgName], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    return {
      ok: false,
      message: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    message: result.status === 0 ? null : `exit ${result.status ?? 'unknown'}`
  };
};

let requiredFailures = 0;
let optionalFailures = 0;

for (const pkgName of REQUIRED_NATIVE_PACKAGES) {
  if (!isInstalled(pkgName)) {
    console.error(`[rebuild:native] required package is missing: ${pkgName}`);
    requiredFailures += 1;
    continue;
  }

  console.error(`[rebuild:native] rebuilding required package: ${pkgName}`);
  const result = rebuildPackage(pkgName);
  if (!result.ok) {
    console.error(`[rebuild:native] failed required package ${pkgName}: ${result.message}`);
    requiredFailures += 1;
  }
}

for (const pkgName of OPTIONAL_NATIVE_PACKAGES) {
  if (!isInstalled(pkgName)) {
    console.error(`[rebuild:native] optional package not installed; skipping: ${pkgName}`);
    continue;
  }

  console.error(`[rebuild:native] rebuilding optional package: ${pkgName}`);
  const result = rebuildPackage(pkgName);
  if (!result.ok) {
    console.error(`[rebuild:native] optional package rebuild failed (${pkgName}): ${result.message}`);
    optionalFailures += 1;
  }
}

if (requiredFailures > 0) {
  console.error(`[rebuild:native] failed with ${requiredFailures} required rebuild failure(s).`);
  process.exit(1);
}

if (optionalFailures > 0) {
  console.error(`[rebuild:native] completed with ${optionalFailures} optional rebuild failure(s).`);
} else {
  console.error('[rebuild:native] completed successfully.');
}


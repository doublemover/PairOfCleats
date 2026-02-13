#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const REQUIRED_NATIVE_PACKAGES = [
  'tree-sitter',
  'tree-sitter-c',
  'tree-sitter-c-sharp',
  'tree-sitter-cpp',
  'tree-sitter-css',
  'tree-sitter-go',
  'tree-sitter-html',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-json',
  'tree-sitter-kotlin',
  'tree-sitter-objc',
  'tree-sitter-python',
  'tree-sitter-rust',
  'tree-sitter-swift',
  'tree-sitter-typescript',
  '@tree-sitter-grammars/tree-sitter-markdown',
  '@tree-sitter-grammars/tree-sitter-toml',
  '@tree-sitter-grammars/tree-sitter-yaml',
  'better-sqlite3',
  'hnswlib-node',
  'onnxruntime-node',
  '@lancedb/lancedb',
  'lmdb'
];

const OPTIONAL_NATIVE_PACKAGES = [
  'sharp',
  '@mongodb-js/zstd',
  '@parcel/watcher',
  're2',
  '@node-rs/xxhash'
];

const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const verifyOnly = process.argv.includes('--verify');

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

const probePackage = async (pkgName) => {
  try {
    requireFromRoot(pkgName);
    return { ok: true, message: null };
  } catch (error) {
    if (error?.code === 'ERR_REQUIRE_ESM') {
      try {
        await import(pkgName);
        return { ok: true, message: null };
      } catch (importError) {
        return {
          ok: false,
          message: importError?.message || `failed to import ${pkgName}`
        };
      }
    }

    return {
      ok: false,
      message: error?.message || `failed to require ${pkgName}`
    };
  }
};

const verifyRequiredPackages = async () => {
  let failures = 0;

  for (const pkgName of REQUIRED_NATIVE_PACKAGES) {
    if (!isInstalled(pkgName)) {
      console.error(`[verify:native] required package is missing: ${pkgName}`);
      failures += 1;
      continue;
    }

    const result = await probePackage(pkgName);
    if (!result.ok) {
      console.error(`[verify:native] required package is not loadable (${pkgName}): ${result.message}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`[verify:native] failed with ${failures} required package failure(s).`);
    process.exit(1);
  }

  console.error('[verify:native] all required packages are loadable.');
};

let requiredFailures = 0;
let optionalFailures = 0;

if (verifyOnly) {
  await verifyRequiredPackages();
  process.exit(0);
}

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

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
const repairOnly = process.argv.includes('--repair');

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
    await import(pkgName);
    return { ok: true, message: null };
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND'
      || error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT'
      || error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      || error?.code === 'ERR_UNKNOWN_FILE_EXTENSION'
    ) {
      try {
        requireFromRoot(pkgName);
        return { ok: true, message: null };
      } catch (importError) {
        return {
          ok: false,
          message: importError?.message || `failed to require ${pkgName}`
        };
      }
    }

    return {
      ok: false,
      message: error?.message || `failed to require ${pkgName}`
    };
  }
};

const getRequiredPackageFailures = async ({ label = 'verify:native' } = {}) => {
  const failures = [];

  for (const pkgName of REQUIRED_NATIVE_PACKAGES) {
    if (!isInstalled(pkgName)) {
      console.error(`[${label}] required package is missing: ${pkgName}`);
      failures.push({
        pkgName,
        missing: true,
        message: 'required package is missing'
      });
      continue;
    }

    const result = await probePackage(pkgName);
    if (!result.ok) {
      console.error(`[${label}] required package is not loadable (${pkgName}): ${result.message}`);
      failures.push({
        pkgName,
        missing: false,
        message: result.message || 'required package is not loadable'
      });
    }
  }

  return failures;
};

const verifyRequiredPackages = async () => {
  const failures = await getRequiredPackageFailures({ label: 'verify:native' });

  if (failures.length > 0) {
    console.error(`[verify:native] failed with ${failures.length} required package failure(s).`);
    process.exit(1);
  }

  console.error('[verify:native] all required packages are loadable.');
};

const repairRequiredPackages = async () => {
  const failures = await getRequiredPackageFailures({ label: 'repair:native' });
  if (failures.length === 0) {
    console.error('[repair:native] no required package repairs needed.');
    return;
  }

  let repairFailures = 0;

  for (const failure of failures) {
    if (failure.missing) {
      console.error(`[repair:native] cannot rebuild missing required package: ${failure.pkgName}`);
      repairFailures += 1;
      continue;
    }

    console.error(`[repair:native] rebuilding required package: ${failure.pkgName}`);
    const rebuildResult = rebuildPackage(failure.pkgName);
    if (!rebuildResult.ok) {
      console.error(`[repair:native] failed required package ${failure.pkgName}: ${rebuildResult.message}`);
      repairFailures += 1;
      continue;
    }

    const probeResult = await probePackage(failure.pkgName);
    if (!probeResult.ok) {
      console.error(`[repair:native] required package still not loadable (${failure.pkgName}): ${probeResult.message}`);
      repairFailures += 1;
    }
  }

  if (repairFailures > 0) {
    console.error(`[repair:native] failed with ${repairFailures} required package repair failure(s).`);
    process.exit(1);
  }

  console.error(`[repair:native] repaired ${failures.length} required package(s).`);
};

let requiredFailures = 0;
let optionalFailures = 0;

if (verifyOnly) {
  await verifyRequiredPackages();
  process.exit(0);
}

if (repairOnly) {
  await repairRequiredPackages();
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

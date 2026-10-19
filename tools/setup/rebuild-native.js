#!/usr/bin/env node
import { recordBootstrapReadiness } from '../../src/shared/bootstrap-readiness.js';
import { applyPatches } from './apply-patches.js';
import { probeNativePackage, probeNodeRealmLifecycle } from '../../src/shared/native-package-probe.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnResolvedSubprocessSync } from '../../src/shared/subprocess/command-invocation.js';
import { formatSpawnFailureReason } from './rebuild-native-exit.js';
import { probeSqliteNative, rebuildSqliteNativeFromSource } from './rebuild-native-sqlite.js';
import { listNativeTreeSitterGrammarModuleNames, NATIVE_GRAMMAR_MODULES } from '../../src/lang/tree-sitter/native-runtime.js';

const REQUIRED_NATIVE_PACKAGES = [
  'tree-sitter',
  ...listNativeTreeSitterGrammarModuleNames(),
  'better-sqlite3',
  'node-pty',
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
const TREE_SITTER_PERL_PACKAGE = '@ganezdragon/tree-sitter-perl';
const TREE_SITTER_PERL_PATCH_VERSION = '1.1.1';
const TREE_SITTER_PERL_PATCH_MARKERS = [
  'dynamic STRING queue in C',
  'clearStringQueue(scanner->heredoc.heredoc_identifier_queue);',
  'clearBoolQueue(scanner->heredoc.heredoc_allows_interpolation);',
  'if (scanner == NULL) return NULL;'
];

const root = process.cwd();
const verifyOnly = process.argv.includes('--verify');
const repairOnly = process.argv.includes('--repair');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor !== 26 || nodeMinor < 10) {
  console.error('[bootstrap] Node.js >=26.10.0 <27 is required for safe VM worker teardown.');
  process.exit(1);
}

const resolveNodeModulesPath = (pkgName) => (
  path.join(root, 'node_modules', ...pkgName.split('/'))
);

const isInstalled = (pkgName) => fs.existsSync(resolveNodeModulesPath(pkgName));

const readInstalledPackageVersion = (pkgName) => {
  try {
    const packageJsonPath = path.join(resolveNodeModulesPath(pkgName), 'package.json');
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
};

const verifyPerlScannerPatch = () => {
  if (!isInstalled(TREE_SITTER_PERL_PACKAGE)) {
    return { ok: false, message: `${TREE_SITTER_PERL_PACKAGE} is missing` };
  }
  const version = readInstalledPackageVersion(TREE_SITTER_PERL_PACKAGE);
  if (version !== TREE_SITTER_PERL_PATCH_VERSION) {
    return { ok: true, message: null };
  }
  const scannerPath = path.join(resolveNodeModulesPath(TREE_SITTER_PERL_PACKAGE), 'src', 'scanner.c');
  let scannerSource = '';
  try {
    scannerSource = fs.readFileSync(scannerPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      message: `failed to read scanner source (${err?.message || err})`
    };
  }
  for (const marker of TREE_SITTER_PERL_PATCH_MARKERS) {
    if (!scannerSource.includes(marker)) {
      return {
        ok: false,
        message: `patched scanner markers missing in ${scannerPath}`
      };
    }
  }
  return { ok: true, message: null };
};

/**
 * Build npm subprocess env with explicit script/source-build policy.
 *
 * @param {{buildFromSource?:boolean}} [options]
 * @returns {NodeJS.ProcessEnv}
 */
const buildNpmEnv = ({ buildFromSource = false } = {}) => {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key) continue;
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === 'npm_config_build-from-source' || normalizedKey === 'npm_config_build_from_source') {
      continue;
    }
    if (value == null) continue;
    env[key] = typeof value === 'string' ? value : String(value);
  }
  env.npm_config_ignore_scripts = 'false';
  if (buildFromSource) {
    env.npm_config_build_from_source = 'true';
  }
  return env;
};

const runNpmCommand = (args, { cwd = root, buildFromSource = false } = {}) => {
  const env = buildNpmEnv({ buildFromSource });
  try {
    const result = spawnResolvedSubprocessSync('npm', args, {
      cwd,
      stdio: 'inherit',
      env,
      rejectOnNonZeroExit: false
    });
    return {
      ok: result.exitCode === 0,
      message: result.exitCode === 0
        ? null
        : formatSpawnFailureReason({ status: result.exitCode, signal: result.signal })
    };
  } catch (err) {
    return {
      ok: false,
      message: err?.message || String(err)
    };
  }
};

const normalizePackageNameResult = (pkgName) => {
  const normalizedPkgName = typeof pkgName === 'string' ? pkgName.trim() : '';
  if (!normalizedPkgName) {
    return {
      ok: false,
      message: `invalid package name: ${String(pkgName)}`
    };
  }
  return { ok: true, pkgName: normalizedPkgName };
};

// This grammar carries a patched C scanner. Build its binding from the patched
// source directly: npm 11 warns about the legacy build-from-source config key,
// and a prebuilt binding would not contain the scanner repair.
const rebuildPatchedPerlFromSource = () => {
  try {
    const result = spawnResolvedSubprocessSync(process.execPath, [
      path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'), 'rebuild'
    ], {
      cwd: resolveNodeModulesPath(TREE_SITTER_PERL_PACKAGE),
      stdio: 'inherit',
      env: buildNpmEnv(),
      rejectOnNonZeroExit: false
    });
    return { ok: result.exitCode === 0,
      message: result.exitCode === 0 ? null
        : formatSpawnFailureReason({ status: result.exitCode, signal: result.signal }) };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
};

const rebuildPackage = (pkgName, { buildFromSource = false } = {}) => {
  const packageNameResult = normalizePackageNameResult(pkgName);
  if (!packageNameResult.ok) {
    return packageNameResult;
  }

  if (packageNameResult.pkgName === TREE_SITTER_PERL_PACKAGE && buildFromSource) {
    return rebuildPatchedPerlFromSource();
  }

  if (packageNameResult.pkgName === 'better-sqlite3' && buildFromSource
    && Number(readInstalledPackageVersion(pkgName)?.split('.')[0]) >= 13) {
    return rebuildSqliteNativeFromSource(root, runNpmCommand);
  }

  const args = ['rebuild', packageNameResult.pkgName];
  return runNpmCommand(args, { buildFromSource });
};

const runPackageInstallScript = (pkgName, { buildFromSource = false } = {}) => {
  const packageNameResult = normalizePackageNameResult(pkgName);
  if (!packageNameResult.ok) {
    return packageNameResult;
  }

  const args = ['run', 'install', '--if-present'];
  return runNpmCommand(args, {
    cwd: resolveNodeModulesPath(packageNameResult.pkgName),
    buildFromSource
  });
};

const LANGUAGE_SAMPLES = {
  javascript: 'function ok() { return 1; }', jsx: 'const view = <div />;',
  typescript: 'const value: number = 1;', tsx: 'const view = <div />;',
  python: 'value = 1\n', json: '{}', yaml: 'value: 1\n', toml: 'value = 1\n',
  xml: '<root/>', markdown: '# ok\n', kotlin: 'val value = 1', csharp: 'class Ok {}',
  clike: 'int ok(void) { return 1; }', c: 'int ok(void) { return 1; }',
  cpp: 'int ok() { return 1; }', objc: 'int ok(void) { return 1; }',
  go: 'package main\nfunc main() {}', rust: 'fn main() {}', java: 'class Ok {}',
  dart: 'void main() {}', scala: 'object Ok {}', groovy: 'def value = 1',
  r: 'value <- 1', julia: 'value = 1', ruby: 'value = 1', php: '<?php echo 1;',
  perl: 'my $value = 1;', shell: 'echo ok', sql: 'SELECT 1;', css: 'a { color: red; }',
  html: '<p>ok</p>', lua: 'return 1', swift: 'let value = 1'
};
const nativeCapabilities = new Map();
const probePackage = async (pkgName) => {
  const grammarRoutes = Object.entries(NATIVE_GRAMMAR_MODULES)
    .filter(([, spec]) => spec.moduleName === pkgName)
    .map(([languageId, spec]) => ({ ...spec, languageId, source: LANGUAGE_SAMPLES[languageId] }));
  if (grammarRoutes.some((route) => !route.source)) throw new Error('Missing bounded native language activation sample.');
  const result = await probeNativePackage(root, pkgName, { grammarRoutes });
  if (result.ok && result.capabilities) nativeCapabilities.set(pkgName, result.capabilities);
  return result;
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
      continue;
    }

    if (pkgName === TREE_SITTER_PERL_PACKAGE) {
      const perlPatchCheck = verifyPerlScannerPatch();
      if (!perlPatchCheck.ok) {
        console.error(`[${label}] required perl scanner patch check failed (${pkgName}): ${perlPatchCheck.message}`);
        failures.push({
          pkgName,
          missing: false,
          message: perlPatchCheck.message || 'perl scanner patch check failed'
        });
      }
    }
  }

  return failures;
};

const verifyRequiredPackages = async () => {
  const failures = await getRequiredPackageFailures({ label: 'verify:native' });

  const realmProbe = probeNodeRealmLifecycle(root);
  if (!realmProbe.ok) {
    console.error(`[verify:native] Node VM worker lifecycle failed: ${realmProbe.message}`);
    failures.push({ pkgName: 'node:vm', missing: false,
      message: realmProbe.message || 'worker lifecycle failed' });
  }

  if (failures.length > 0) {
    console.error(`[verify:native] failed with ${failures.length} required package failure(s).`);
    process.exit(1);
  }

  console.error('[verify:native] required packages loadable; registered native language routes parser-activated.');
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
    const rebuildResult = rebuildPackage(failure.pkgName, {
      buildFromSource: failure.pkgName === TREE_SITTER_PERL_PACKAGE
    });
    if (!rebuildResult.ok) {
      console.error(`[repair:native] failed required package ${failure.pkgName}: ${rebuildResult.message}`);
      repairFailures += 1;
      continue;
    }

    const probeResult = await probePackage(failure.pkgName);
    if (!probeResult.ok) {
      console.error(`[repair:native] required package still not loadable (${failure.pkgName}) after rebuild; retrying from source.`);
      const sourceRebuildResult = rebuildPackage(failure.pkgName, { buildFromSource: true });
      if (!sourceRebuildResult.ok) {
        console.error(`[repair:native] source rebuild failed required package ${failure.pkgName}: ${sourceRebuildResult.message}`);
        repairFailures += 1;
        continue;
      }

      const sourceProbeResult = await probePackage(failure.pkgName);
      if (!sourceProbeResult.ok) {
        console.error(`[repair:native] required package still not loadable (${failure.pkgName}) after source rebuild; running package install script.`);
        const installScriptResult = runPackageInstallScript(failure.pkgName, { buildFromSource: true });
        if (!installScriptResult.ok) {
          console.error(`[repair:native] package install script failed for ${failure.pkgName}: ${installScriptResult.message}`);
          repairFailures += 1;
          continue;
        }

        const installProbeResult = await probePackage(failure.pkgName);
        if (!installProbeResult.ok) {
          console.error(`[repair:native] required package still not loadable (${failure.pkgName}) after package install script: ${installProbeResult.message}`);
          repairFailures += 1;
        }
      }
    }
    if (failure.pkgName === TREE_SITTER_PERL_PACKAGE) {
      const perlPatchCheck = verifyPerlScannerPatch();
      if (!perlPatchCheck.ok) {
        console.error(`[repair:native] perl scanner patch check failed (${failure.pkgName}): ${perlPatchCheck.message}`);
        repairFailures += 1;
      }
    }
  }

  if (repairFailures > 0) {
    console.error(`[repair:native] failed with ${repairFailures} required package repair failure(s).`);
    process.exit(1);
  }

  console.error(`[repair:native] repaired ${failures.length} required package(s).`);
};

const recordReadiness = () => {
  applyPatches(root, { verifyOnly: true });
  recordBootstrapReadiness(root, REQUIRED_NATIVE_PACKAGES, {
    nativeCapabilities: [...nativeCapabilities.values()].flat().sort((a, b) => a.languageId.localeCompare(b.languageId))
  });
  console.error('[bootstrap] Verified readiness receipt saved.');
};

let requiredFailures = 0;
let optionalFailures = 0;

if (verifyOnly) {
  await verifyRequiredPackages();
  recordReadiness();
  process.exit(0);
}

if (repairOnly) {
  await repairRequiredPackages();
  await verifyRequiredPackages();
  recordReadiness();
  process.exit(0);
}

for (const pkgName of REQUIRED_NATIVE_PACKAGES) {
  if (!isInstalled(pkgName)) {
    console.error(`[rebuild:native] required package is missing: ${pkgName}`);
    requiredFailures += 1;
    continue;
  }

  console.error(`[rebuild:native] rebuilding required package: ${pkgName}`);
  const result = rebuildPackage(pkgName, {
    buildFromSource: pkgName === TREE_SITTER_PERL_PACKAGE
  });
  if (!result.ok) {
    console.error(`[rebuild:native] failed required package ${pkgName}: ${result.message}`);
    requiredFailures += 1;
    continue;
  }
  if (pkgName === 'better-sqlite3') {
    const probe = probeSqliteNative(root);
    if (!probe.ok) {
      console.error(`[rebuild:native] SQLite runtime probe failed: ${probe.message}. Run node tools/setup/rebuild-native.js --repair.`);
      requiredFailures += 1;
    }
  }
  if (pkgName === TREE_SITTER_PERL_PACKAGE) {
    const perlPatchCheck = verifyPerlScannerPatch();
    if (!perlPatchCheck.ok) {
      console.error(`[rebuild:native] perl scanner patch check failed (${pkgName}): ${perlPatchCheck.message}`);
      requiredFailures += 1;
    }
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

await verifyRequiredPackages();
recordReadiness();

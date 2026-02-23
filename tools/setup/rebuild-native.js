#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatSpawnFailureReason } from './rebuild-native-exit.js';
import { listNativeTreeSitterGrammarModuleNames } from '../../src/lang/tree-sitter/native-runtime.js';

const REQUIRED_NATIVE_PACKAGES = [
  'tree-sitter',
  ...listNativeTreeSitterGrammarModuleNames(),
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
const TREE_SITTER_PERL_PACKAGE = '@ganezdragon/tree-sitter-perl';
const TREE_SITTER_PERL_PATCH_VERSION = '1.1.1';
const TREE_SITTER_PERL_PATCH_MARKERS = [
  'dynamic STRING queue in C',
  'clearStringQueue(scanner->heredoc.heredoc_identifier_queue);',
  'clearBoolQueue(scanner->heredoc.heredoc_allows_interpolation);'
];

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const verifyOnly = process.argv.includes('--verify');
const repairOnly = process.argv.includes('--repair');

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

const buildNpmCommandArgs = (args) => {
  if (process.platform === 'win32') {
    return ['/d', '/s', '/c', 'npm', ...args];
  }
  return args;
};

const rebuildPackage = (pkgName, { buildFromSource = false } = {}) => {
  const normalizedPkgName = typeof pkgName === 'string' ? pkgName.trim() : '';
  if (!normalizedPkgName) {
    return {
      ok: false,
      message: `invalid package name: ${String(pkgName)}`
    };
  }

  const args = ['rebuild', normalizedPkgName];
  const env = buildNpmEnv({ buildFromSource });

  const commandArgs = buildNpmCommandArgs(args);
  let result;
  try {
    result = spawnSync(npmCommand, commandArgs, {
      cwd: root,
      stdio: 'inherit',
      env
    });
  } catch (err) {
    return {
      ok: false,
      message: err?.message || String(err)
    };
  }

  if (result.error) {
    return {
      ok: false,
      message: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    message: result.status === 0 ? null : formatSpawnFailureReason(result)
  };
};

const runPackageInstallScript = (pkgName, { buildFromSource = false } = {}) => {
  const normalizedPkgName = typeof pkgName === 'string' ? pkgName.trim() : '';
  if (!normalizedPkgName) {
    return {
      ok: false,
      message: `invalid package name: ${String(pkgName)}`
    };
  }

  const env = buildNpmEnv({ buildFromSource });
  const args = ['run', 'install', '--if-present'];

  const commandArgs = buildNpmCommandArgs(args);
  let result;
  try {
    result = spawnSync(npmCommand, commandArgs, {
      cwd: resolveNodeModulesPath(normalizedPkgName),
      stdio: 'inherit',
      env
    });
  } catch (err) {
    return {
      ok: false,
      message: err?.message || String(err)
    };
  }

  if (result.error) {
    return {
      ok: false,
      message: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    message: result.status === 0 ? null : formatSpawnFailureReason(result)
  };
};

const probePackage = async (pkgName) => {
  /**
   * `npm ci --ignore-scripts` can leave tree-sitter core loadable but not
   * actually usable with rebuilt grammars. Probe parser activation explicitly
   * so `verify:native` / `repair:native` detect this CI-only failure mode.
   */
  if (pkgName === 'tree-sitter') {
    const parserProbeScript = `
      try {
        const Parser = require('tree-sitter');
        const js = require('tree-sitter-javascript');
        const parser = new Parser();
        const candidates = [js, js.javascript, js.language, js.default].filter(Boolean);
        let activated = false;
        let lastError = null;
        for (const language of candidates) {
          try {
            parser.setLanguage(language);
            const tree = parser.parse('function ok() { return 1; }');
            if (!tree || !tree.rootNode) {
              throw new Error('tree-sitter parser activation produced no tree');
            }
            activated = true;
            break;
          } catch (err) {
            lastError = err;
          }
        }
        if (!activated) {
          throw lastError || new Error('tree-sitter parser activation failed');
        }
        process.exit(0);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    `.trim();

    const parserProbeResult = spawnSync(process.execPath, ['-e', parserProbeScript], {
      cwd: root,
      encoding: 'utf8'
    });

    if (parserProbeResult.status === 0) {
      return { ok: true, message: null };
    }

    const message = (parserProbeResult.stderr || parserProbeResult.stdout || '').trim();
    return {
      ok: false,
      message: message || 'failed to activate tree-sitter parser'
    };
  }

  const probeScript = `
    const pkg = process.argv[1];
    (async () => {
      try {
        await import(pkg);
        process.exit(0);
      } catch (importErr) {
        try {
          require(pkg);
          process.exit(0);
        } catch (requireErr) {
          const message = (requireErr && requireErr.message)
            || (importErr && importErr.message)
            || 'failed to load package';
          console.error(message);
          process.exit(1);
        }
      }
    })();
  `.trim();

  const result = spawnSync(process.execPath, ['-e', probeScript, pkgName], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status === 0) {
    return { ok: true, message: null };
  }

  const message = (result.stderr || result.stdout || '').trim();
  return {
    ok: false,
    message: message || `failed to load ${pkgName}`
  };
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
  const result = rebuildPackage(pkgName, {
    buildFromSource: pkgName === TREE_SITTER_PERL_PACKAGE
  });
  if (!result.ok) {
    console.error(`[rebuild:native] failed required package ${pkgName}: ${result.message}`);
    requiredFailures += 1;
    continue;
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

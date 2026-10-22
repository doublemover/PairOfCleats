#!/usr/bin/env node
import { recordBootstrapReadiness } from '../../src/shared/bootstrap-readiness.js';
import { applyPatchesAsync } from './apply-patches.js';
import { probeNodeRealmLifecycle } from '../../src/shared/native-package-probe.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { formatSpawnFailureReason } from './rebuild-native-exit.js';
import { probeSqliteNative, rebuildSqliteNativeFromSourceAsync } from './rebuild-native-sqlite.js';
import { listNativeTreeSitterGrammarModuleNames, NATIVE_GRAMMAR_MODULES } from '../../src/lang/tree-sitter/native-runtime.js';
import { resolveBootstrapBudget, runBootstrapTasks } from './bootstrap-tasks.js';
import { createNativeBuildTasks, inspectNativeBuildAdapter } from './native-build-plan.js';
import { formatSetupPreflight, runSetupPreflight } from './preflight.js';

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
  'All lexical state participates in parser branch restoration and incremental edits.',
  'dequeueBoolQueue(scanner->heredoc.heredoc_allows_indent);',
  'if (scanner == NULL) return NULL;'
];

const root = process.cwd();
const verifyOnly = process.argv.includes('--verify');
const selectedToolchain = verifyOnly ? null : runSetupPreflight();
if (selectedToolchain) console.error(formatSetupPreflight(selectedToolchain));
const repairOnly = process.argv.includes('--repair');
const bootstrapBudget = resolveBootstrapBudget();
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number);
if (nodeMajor !== 26 || nodeMinor < 12 || (nodeMinor === 12 && nodePatch < 1)) {
  console.error('[bootstrap] Node.js >=26.12.1 <27 is required for safe VM worker teardown.');
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
  Object.assign(env, selectedToolchain?.childEnv || {});
  return env;
};

const runNativeCommand = async (command, args, { cwd = root, buildFromSource = false,
  signal = null, compilerJobs = bootstrapBudget.cpuCount, env: extraEnv = {}, capture = false } = {}) => {
  const env = { ...buildNpmEnv({ buildFromSource }), ...extraEnv,
    npm_config_jobs: String(compilerJobs) };
  try {
    const result = await spawnResolvedSubprocess(command, args, {
      cwd, stdio: capture ? 'pipe' : 'inherit', env, signal, timeoutMs: 600000,
      maxOutputBytes: 8 * 1024 * 1024, rejectOnNonZeroExit: false, windowsHide: true
    });
    const truncated = result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated;
    return {
      ok: result.exitCode === 0 && !truncated,
      stdout: result.stdout, stderr: result.stderr,
      message: truncated ? 'Native task output exceeded the bounded transcript capacity.' : result.exitCode === 0
        ? null
        : formatSpawnFailureReason({ status: result.exitCode, signal: result.signal })
    };
  } catch (err) {
    return {
      ok: false,
      message: err?.message || String(err), stdout: err.result?.stdout, stderr: err.result?.stderr
    };
  }
};
const runNpmCommand = (args, options) => runNativeCommand('npm', args, options);

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
const rebuildPatchedPerlFromSource = (options = {}) => runNativeCommand(process.execPath, [
  path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'), 'rebuild',
  '--jobs=' + (options.compilerJobs || bootstrapBudget.cpuCount)
], { ...options, cwd: resolveNodeModulesPath(TREE_SITTER_PERL_PACKAGE) });

const rebuildPackage = async (pkgName, { buildFromSource = false, ...options } = {}) => {
  const packageNameResult = normalizePackageNameResult(pkgName);
  if (!packageNameResult.ok) {
    return packageNameResult;
  }

  if (packageNameResult.pkgName === TREE_SITTER_PERL_PACKAGE && buildFromSource) {
    return rebuildPatchedPerlFromSource(options);
  }

  if (packageNameResult.pkgName === 'better-sqlite3' && buildFromSource
    && Number(readInstalledPackageVersion(pkgName)?.split('.')[0]) >= 13) {
    return rebuildSqliteNativeFromSourceAsync(root, (args, sqliteOptions) =>
      runNpmCommand(args, { ...options, ...sqliteOptions }));
  }

  const args = ['rebuild', packageNameResult.pkgName];
  return runNpmCommand(args, { ...options, buildFromSource });
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
const probePackage = async (pkgName, signal) => {
  const grammarRoutes = Object.entries(NATIVE_GRAMMAR_MODULES)
    .filter(([, spec]) => spec.moduleName === pkgName)
    .map(([languageId, spec]) => ({ ...spec, languageId, source: LANGUAGE_SAMPLES[languageId] }));
  if (grammarRoutes.some((route) => !route.source)) throw new Error('Missing bounded native language activation sample.');
  const result = await probePackageIsolated(pkgName, grammarRoutes, signal);
  if (result.ok && result.capabilities) nativeCapabilities.set(pkgName, result.capabilities);
  return result;
};

const probePackageIsolated = async (pkgName, grammarRoutes, signal) => {
  // The compatibility probe owner uses synchronous child operations. Put that
  // owner in an isolated process so scheduling actually overlaps bounded probes
  // without changing its public sync APIs or loading natives in this coordinator.
  const probeUrl = pathToFileURL(path.join(root, 'src/shared/native-package-probe.js')).href;
  const script = `import { probeNativePackage } from ${JSON.stringify(probeUrl)};
    const request = JSON.parse(process.argv[1]);
    const result = await probeNativePackage(request.root, request.pkgName, { grammarRoutes: request.grammarRoutes });
    process.stdout.write(JSON.stringify(result));`;
  try {
    const child = await spawnResolvedSubprocess(process.execPath, ['--input-type=module', '-e', script,
      JSON.stringify({ root, pkgName, grammarRoutes })], {
      cwd: root, stdio: 'pipe',
      signal, timeoutMs: 30000, maxOutputBytes: 1024 * 1024, windowsHide: true
    });
    if (child.stderr?.trim()) return { ok: false, message: child.stderr.trim() };
    return JSON.parse(child.stdout);
  } catch (error) {
    return { ok: false, message: error.result?.stderr?.trim() || error.message };
  }
};

const getRequiredPackageFailures = async ({ label = 'verify:native' } = {}) => {
  const failures = [];
  const outcome = await runBootstrapTasks(REQUIRED_NATIVE_PACKAGES.map(pkgName => ({
    id: 'probe:' + pkgName, bytes: 256 * 1024 * 1024,
    run: async ({ signal }) => {
      if (!isInstalled(pkgName)) return { ok: false, missing: true, message: 'required package is missing' };
      const result = await probePackage(pkgName, signal);
      if (result.ok && pkgName === TREE_SITTER_PERL_PACKAGE) return verifyPerlScannerPatch();
      return result;
    }
  })), { budget: bootstrapBudget, stopOnRequiredFailure: false });
  for (const [index, pkgName] of REQUIRED_NATIVE_PACKAGES.entries()) {
    const row = outcome.results[index];
    const result = row.result || { ok: false, message: row.error?.message || row.status };
    if (!isInstalled(pkgName)) {
      console.error(`[${label}] required package is missing: ${pkgName}`);
      failures.push({
        pkgName,
        missing: true,
        message: 'required package is missing'
      });
      continue;
    }

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
    const rebuildResult = await rebuildPackage(failure.pkgName, {
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
      const sourceRebuildResult = await rebuildPackage(failure.pkgName, { buildFromSource: true });
      if (!sourceRebuildResult.ok) {
        console.error(`[repair:native] source rebuild failed required package ${failure.pkgName}: ${sourceRebuildResult.message}`);
        repairFailures += 1;
        continue;
      }

      const sourceProbeResult = await probePackage(failure.pkgName);
      if (!sourceProbeResult.ok) {
        console.error(`[repair:native] required package still not loadable (${failure.pkgName}) after source rebuild; running package install script.`);
        const installScriptResult = await runPackageInstallScript(failure.pkgName, { buildFromSource: true });
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

const recordReadiness = async () => {
  await applyPatchesAsync(root, { verifyOnly: true });
  recordBootstrapReadiness(root, REQUIRED_NATIVE_PACKAGES, {
    nativeCapabilities: [...nativeCapabilities.values()].flat().sort((a, b) => a.languageId.localeCompare(b.languageId))
  });
  console.error('[bootstrap] Verified readiness receipt saved.');
};

if (verifyOnly) {
  await verifyRequiredPackages();
  await recordReadiness();
  process.exit(0);
}

if (repairOnly) {
  await repairRequiredPackages();
  await verifyRequiredPackages();
  await recordReadiness();
  process.exit(0);
}

const packages = [
  ...REQUIRED_NATIVE_PACKAGES.map(packageName => ({ packageName, required: true })),
  ...OPTIONAL_NATIVE_PACKAGES.filter(isInstalled).map(packageName => ({ packageName, required: false }))
];
const adapters = new Map(packages.map(entry => [entry.packageName, inspectNativeBuildAdapter(root, entry.packageName)])
  .filter(([, adapter]) => adapter));
const headerCache = path.join(root, '.cache', 'native-build', 'headers');
const headerDirectory = path.join(headerCache, process.versions.node);
const prepareHeaders = async ({ signal, compilerJobs }) => {
  // No concurrent node-gyp downloads or global header-cache mutation. The
  // prepared headers become read-only inputs to every package-local build.
  let current = root;
  for (const part of ['.cache', 'native-build', 'headers']) {
    current = path.join(current, part);
    try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Native header cache must be a regular directory: ' + current);
  }
  const adapter = adapters.values().next().value;
  return runNativeCommand(process.execPath, [adapter.nodeGyp, 'install', '--ensure',
    '--devdir=' + headerCache, '--dist-url=https://nodejs.org/download/release',
    '--target=' + process.versions.node, '--arch=' + process.arch], { signal, compilerJobs });
};
const buildLocal = async (adapter, context) => {
  // Recheck the admitted owner at dispatch, not only while constructing the DAG.
  const current = inspectNativeBuildAdapter(root, adapter.packageName);
  if (!current || current.nodeGyp !== adapter.nodeGyp) return { ok: false, message: 'Native adapter input changed before dispatch.' };
  const env = { npm_config_nodedir: headerDirectory, npm_config_devdir: headerCache };
  const options = { ...context, cwd: adapter.packageRoot, capture: true, env };
  if (!adapter.forceSource) {
    const prebuild = await runNativeCommand(process.execPath, [adapter.prebuildTest], options);
    if (prebuild.ok) return prebuild;
    if (context.signal.aborted) return prebuild;
  }
  return runNativeCommand(process.execPath, [adapter.nodeGyp, 'rebuild',
    '--jobs=' + context.compilerJobs, '--nodedir=' + headerDirectory,
    '--arch=' + process.arch], options);
};
const buildFallback = async (entry, context) => {
  if (!isInstalled(entry.packageName)) return { ok: false, message: 'required package is missing' };
  const result = await rebuildPackage(entry.packageName, { ...context,
    buildFromSource: ['tree-sitter', TREE_SITTER_PERL_PACKAGE, 'tree-sitter-swift', 'better-sqlite3']
      .includes(entry.packageName) });
  if (result.ok && entry.packageName === TREE_SITTER_PERL_PACKAGE) return verifyPerlScannerPatch();
  if (result.ok && entry.packageName === 'better-sqlite3') return probeSqliteNative(root);
  return result;
};
console.error('[rebuild:native] dependency plan: ' + JSON.stringify({
  jobs: bootstrapBudget.jobs, cpuTokens: bootstrapBudget.cpuCount,
  compilerJobsPerLocalTask: bootstrapBudget.compilerJobs, memoryBytes: bootstrapBudget.memoryBytes,
  packageLocal: [...adapters.keys()], exclusiveFallback: packages.filter(entry => !adapters.has(entry.packageName))
    .map(entry => entry.packageName), cpuMethod: bootstrapBudget.cpuMethod, memoryMethod: bootstrapBudget.memoryMethod
}));
const outcome = await runBootstrapTasks(createNativeBuildTasks({
  packages, adapters, budget: bootstrapBudget, prepareHeaders, buildLocal, buildFallback
}), { budget: bootstrapBudget });
let requiredFailures = 0, optionalFailures = 0;
// Report in dependency/input order regardless of completion order.
for (const row of outcome.results) {
  if (row.result?.stdout) process.stdout.write(row.result.stdout);
  if (row.result?.stderr) process.stderr.write(row.result.stderr);
  console.error('[rebuild:native] ' + row.id + ': ' + row.status
    + (row.error ? ' (' + row.error.message + ')' : ''));
  if (row.status !== 'succeeded') {
    if (row.required) requiredFailures++;
    else optionalFailures++;
  }
}
for (const packageName of OPTIONAL_NATIVE_PACKAGES.filter(name => !isInstalled(name))) {
  console.error('[rebuild:native] optional package not installed; skipping: ' + packageName);
}
if (requiredFailures > 0) {
  console.error('[rebuild:native] failed with ' + requiredFailures + ' required rebuild failure(s).');
  process.exit(1);
}
if (optionalFailures > 0) console.error('[rebuild:native] completed with ' + optionalFailures + ' optional rebuild failure(s).');
else console.error('[rebuild:native] completed successfully.');
await verifyRequiredPackages();
await recordReadiness();

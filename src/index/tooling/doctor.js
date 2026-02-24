import fsSync from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { execaSync } from 'execa';
import { getXxhashBackend } from '../../shared/hash.js';
import { listToolingProviders } from './provider-registry.js';
import { normalizeProviderId } from './provider-contract.js';
import { findBinaryInDirs } from './binary-utils.js';
import { loadTypeScript } from './typescript/load.js';
import { resolveToolRoot } from '../../shared/dict-utils.js';
import { getScmProviderAndRoot, resolveScmConfig } from '../scm/registry.js';
import { setScmRuntimeConfig } from '../scm/runtime.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';

const MIN_TYPESCRIPT_VERSION = '4.8.0';

const canRunBinary = (cmd, argsList) => {
  if (!cmd) return false;
  for (const args of argsList) {
    try {
      const result = execaSync(cmd, args, {
        stdio: 'ignore',
        reject: false
      });
      if (typeof result.exitCode === 'number' && result.exitCode === 0) return true;
    } catch {}
  }
  return false;
};

const commandExists = (cmd) => {
  if (!cmd) return false;
  if (isAbsolutePathNative(cmd) || cmd.includes(path.sep)) return fsSync.existsSync(cmd);
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return Boolean(findBinaryInDirs(cmd, pathEntries));
};

const resolveCompileCommandsDir = (rootDir, clangdConfig) => {
  const candidates = [];
  if (clangdConfig?.compileCommandsDir) {
    const value = clangdConfig.compileCommandsDir;
    candidates.push(isAbsolutePathNative(value) ? value : path.join(rootDir, value));
  } else {
    candidates.push(rootDir);
    candidates.push(path.join(rootDir, 'build'));
    candidates.push(path.join(rootDir, 'out'));
    candidates.push(path.join(rootDir, 'cmake-build-debug'));
    candidates.push(path.join(rootDir, 'cmake-build-release'));
  }
  for (const dir of candidates) {
    const candidate = path.join(dir, 'compile_commands.json');
    if (fsSync.existsSync(candidate)) return dir;
  }
  return null;
};

const resolvePyrightCommand = (repoRoot, toolingConfig) => {
  const cmd = 'pyright-langserver';
  const toolRoot = resolveToolRoot();
  const repoBin = path.join(repoRoot, 'node_modules', '.bin');
  const toolBin = toolRoot ? path.join(toolRoot, 'node_modules', '.bin') : null;
  const toolingBin = toolingConfig?.dir
    ? path.join(toolingConfig.dir, 'node', 'node_modules', '.bin')
    : null;
  const found = findBinaryInDirs(cmd, [repoBin, toolBin, toolingBin].filter(Boolean));
  if (found) return found;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return findBinaryInDirs(cmd, pathEntries) || cmd;
};

const resolveCommand = (cmd) => {
  if (process.platform !== 'win32') return cmd;
  const lowered = String(cmd || '').toLowerCase();
  if (lowered.endsWith('.exe') || lowered.endsWith('.cmd') || lowered.endsWith('.bat')) return cmd;
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return cmd;
};

const summarizeStatus = (errors, warnings) => {
  if (errors > 0) return 'error';
  if (warnings > 0) return 'warn';
  return 'ok';
};

const writeReport = async (reportPath, report) => {
  await atomicWriteJson(reportPath, report, {
    spaces: 2,
    newline: false
  });
};

export const runToolingDoctor = async (ctx, providerIds = null, options = {}) => {
  const repoRoot = ctx?.repoRoot || process.cwd();
  const buildRoot = ctx?.buildRoot || repoRoot;
  const toolingConfig = ctx?.toolingConfig || {};
  const strict = ctx?.strict !== false;
  const log = typeof options?.log === 'function' ? options.log : (() => {});
  const scmConfig = ctx?.scmConfig || resolveScmConfig({
    indexingConfig: ctx?.indexingConfig || {},
    analysisPolicy: ctx?.analysisPolicy || null
  });
  setScmRuntimeConfig(scmConfig);

  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    buildRoot,
    config: {
      enabledTools: [],
      disabledTools: []
    },
    xxhash: {
      backend: 'none',
      module: 'none',
      ok: false
    },
    identity: {
      chunkUid: {
        required: true,
        available: false,
        backend: 'none',
        notes: []
      }
    },
    scm: null,
    providers: [],
    summary: {
      status: 'ok',
      warnings: 0,
      errors: 0
    }
  };

  const backend = await getXxhashBackend();
  report.identity.chunkUid.available = Boolean(backend);
  report.identity.chunkUid.backend = backend || 'none';
  report.xxhash.backend = backend || 'none';
  report.xxhash.module = backend === 'native'
    ? 'xxhash-native'
    : (backend === 'wasm' ? 'xxhash-wasm' : 'none');
  report.xxhash.ok = Boolean(backend);
  if (!backend) {
    report.identity.chunkUid.notes.push('xxhash backend not available; chunkUid cannot be computed.');
    report.summary.errors += 1;
  } else if (backend === 'wasm') {
    report.identity.chunkUid.notes.push('native backend unavailable; using wasm backend.');
  }

  const enabledTools = Array.isArray(toolingConfig.enabledTools) ? toolingConfig.enabledTools : [];
  const disabledTools = Array.isArray(toolingConfig.disabledTools) ? toolingConfig.disabledTools : [];
  report.config.enabledTools = enabledTools.slice();
  report.config.disabledTools = disabledTools.slice();
  const isProviderExplicitlyEnabled = (id) => (
    enabledTools.length > 0 && enabledTools.includes(normalizeProviderId(id))
  );
  let scmSelection = null;
  let scmProvenance = null;
  let scmError = null;
  try {
    scmSelection = getScmProviderAndRoot({
      provider: scmConfig?.provider || 'auto',
      startPath: repoRoot,
      log
    });
    scmProvenance = await scmSelection.providerImpl.getRepoProvenance({
      repoRoot: scmSelection.repoRoot
    });
  } catch (err) {
    scmError = err?.message || String(err);
  }
  if (!scmSelection) {
    scmSelection = { provider: 'none', repoRoot, detectedBy: 'none' };
  }
  const resolvedProvenance = scmProvenance && typeof scmProvenance === 'object'
    ? {
      ...scmProvenance,
      provider: scmProvenance.provider || scmSelection.provider,
      root: scmProvenance.root || scmSelection.repoRoot,
      detectedBy: scmProvenance.detectedBy ?? scmSelection.detectedBy
    }
    : {
      provider: scmSelection.provider,
      root: scmSelection.repoRoot,
      head: null,
      dirty: null,
      detectedBy: scmSelection.detectedBy
    };
  const annotateEnabled = scmConfig?.annotate?.enabled !== false
    && resolvedProvenance.provider !== 'none';
  report.scm = {
    provider: resolvedProvenance.provider,
    repoRoot: resolvedProvenance.root,
    detectedBy: resolvedProvenance.detectedBy || null,
    head: resolvedProvenance.head || null,
    dirty: resolvedProvenance.dirty ?? null,
    annotateEnabled,
    error: scmError
  };
  const getDisableReasons = (id) => {
    const normalized = normalizeProviderId(id);
    if (!normalized) return ['unknown-provider'];
    const reasons = [];
    if (disabledTools.includes(normalized)) reasons.push('disabled-by-config');
    if (enabledTools.length && !enabledTools.includes(normalized)) reasons.push('not-in-enabled-tools');
    return reasons;
  };

  const allProviders = listToolingProviders(toolingConfig);
  const providers = Array.isArray(providerIds) && providerIds.length
    ? providerIds
      .map((id) => allProviders.find((provider) => normalizeProviderId(provider?.id) === normalizeProviderId(id)))
      .filter(Boolean)
    : allProviders;

  for (const provider of providers) {
    const providerId = normalizeProviderId(provider?.id);
    if (!providerId) continue;
    const reasonsDisabled = getDisableReasons(providerId);
    const enabled = reasonsDisabled.length === 0;
    const providerReport = {
      id: providerId,
      version: provider?.version || null,
      enabled,
      available: true,
      reasonsDisabled,
      requires: provider?.requires || null,
      languages: Array.isArray(provider?.languages) ? provider.languages.slice() : [],
      capabilities: provider?.capabilities || {},
      status: 'ok',
      checks: []
    };
    let providerErrors = 0;
    let providerWarnings = 0;
    let providerAvailable = true;
    const addCheck = (check) => {
      providerReport.checks.push(check);
      if (check.status === 'error') {
        providerAvailable = false;
        providerErrors += 1;
        report.summary.errors += 1;
      } else if (check.status === 'warn') {
        providerWarnings += 1;
        report.summary.warnings += 1;
      }
    };
    const missingBinaryStatus = isProviderExplicitlyEnabled(providerId) ? 'error' : 'warn';

    if (!providerReport.enabled) {
      addCheck({
        name: 'enabled',
        status: 'warn',
        message: 'Provider disabled by tooling configuration.'
      });
    } else if (providerId === 'typescript') {
      const ts = await loadTypeScript(toolingConfig, repoRoot);
      if (!ts) {
        addCheck({
          name: 'typescript',
          status: 'error',
          message: 'TypeScript module not found.'
        });
      } else {
        const version = ts.version || 'unknown';
        if (semver.valid(version) && !semver.gte(version, MIN_TYPESCRIPT_VERSION)) {
          addCheck({
            name: 'typescript-version',
            status: 'warn',
            message: `TypeScript ${version} below minimum ${MIN_TYPESCRIPT_VERSION}.`
          });
        } else {
          addCheck({
            name: 'typescript-version',
            status: 'ok',
            message: `TypeScript ${version} detected.`
          });
        }
      }

      if (toolingConfig.typescript?.useTsconfig !== false && toolingConfig.typescript?.tsconfigPath) {
        const tsconfigPath = isAbsolutePathNative(toolingConfig.typescript.tsconfigPath)
          ? toolingConfig.typescript.tsconfigPath
          : path.join(repoRoot, toolingConfig.typescript.tsconfigPath);
        if (!fsSync.existsSync(tsconfigPath)) {
          addCheck({
            name: 'tsconfig',
            status: 'warn',
            message: `tsconfig not found at ${tsconfigPath}.`
          });
        } else {
          addCheck({
            name: 'tsconfig',
            status: 'ok',
            message: 'tsconfig resolved.'
          });
        }
      }

      const allowJs = toolingConfig.typescript?.allowJs !== false;
      const checkJs = toolingConfig.typescript?.checkJs !== false;
      const includeJsx = toolingConfig.typescript?.includeJsx !== false;
      if (!allowJs || !checkJs || !includeJsx) {
        addCheck({
          name: 'javascript-parity',
          status: 'warn',
          message: 'JavaScript parity disabled via tooling config.'
        });
      }
    } else if (providerId === 'clangd') {
      const clangdConfig = toolingConfig.clangd || {};
      if (clangdConfig.requireCompilationDatabase) {
        const compileCommandsDir = resolveCompileCommandsDir(repoRoot, clangdConfig);
        if (!compileCommandsDir) {
          addCheck({
            name: 'compile-commands',
            status: 'warn',
            message: 'compile_commands.json not found; clangd will be skipped.'
          });
        } else {
          addCheck({
            name: 'compile-commands',
            status: 'ok',
            message: `compile_commands.json found in ${compileCommandsDir}.`
          });
        }
      }
      const resolvedCmd = resolveCommand('clangd');
      if (!canRunBinary(resolvedCmd, [['--version'], ['--help']])) {
        providerAvailable = false;
        addCheck({
          name: 'clangd',
          status: missingBinaryStatus,
          message: 'clangd binary not available.'
        });
      }
    } else if (providerId === 'pyright') {
      const resolvedCmd = resolvePyrightCommand(repoRoot, toolingConfig);
      if (!commandExists(resolvedCmd)) {
        providerAvailable = false;
        addCheck({
          name: 'pyright-langserver',
          status: missingBinaryStatus,
          message: 'pyright-langserver binary not available.'
        });
      }
    } else if (providerId === 'sourcekit') {
      const resolvedCmd = resolveCommand('sourcekit-lsp');
      if (!canRunBinary(resolvedCmd, [['--help'], ['--version']])) {
        providerAvailable = false;
        addCheck({
          name: 'sourcekit-lsp',
          status: missingBinaryStatus,
          message: 'sourcekit-lsp binary not available.'
        });
      }
    } else if (provider?.requires?.cmd) {
      const resolvedCmd = resolveCommand(provider.requires.cmd);
      if (!canRunBinary(resolvedCmd, [['--version'], ['--help']])) {
        providerAvailable = false;
        addCheck({
          name: provider.requires.cmd,
          status: 'warn',
          message: `${provider.requires.cmd} binary not available.`
        });
      }
    }

    providerReport.status = summarizeStatus(providerErrors, providerWarnings);
    providerReport.available = providerAvailable;
    report.providers.push(providerReport);
  }

  report.summary.status = summarizeStatus(report.summary.errors, report.summary.warnings);
  report.providers.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const reportPath = path.join(buildRoot, 'tooling_report.json');
  await writeReport(reportPath, report);
  if (report.summary.status === 'error') {
    log(`[tooling] doctor: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`);
  } else if (report.summary.status === 'warn') {
    log(`[tooling] doctor: ${report.summary.warnings} warning(s).`);
  } else {
    log('[tooling] doctor: ok.');
  }

  if (strict && !report.identity.chunkUid.available) {
    throw new Error('Tooling doctor failed: xxhash backend unavailable for chunkUid.');
  }

  return report;
};

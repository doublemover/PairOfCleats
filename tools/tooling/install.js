#!/usr/bin/env node
import fs from 'node:fs';
import { createCli } from '../../src/shared/cli.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { resolveEnvPath } from '../../src/shared/env-path.js';
import path from 'node:path';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { buildToolingReport, detectTool, normalizeLanguageList, resolveToolsById, resolveToolsForLanguages, selectInstallPlan } from './utils.js';
import { splitPathEntries } from '../../src/index/tooling/binary-utils.js';
import { getToolingConfig, resolveRepoRootArg } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'tooling-install',
  options: {
    json: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'no-fallback': { type: 'boolean', default: false },
    root: { type: 'string' },
    repo: { type: 'string' },
    scope: { type: 'string' },
    languages: { type: 'string' },
    tools: { type: 'string' }
  }
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = resolveRepoRootArg(explicitRoot);
const toolingConfig = getToolingConfig(root);
const scope = argv.scope || toolingConfig.installScope || 'cache';
const allowFallback = argv['no-fallback'] ? false : toolingConfig.allowGlobalFallback !== false;
const stdoutGuard = createStdoutGuard({
  enabled: argv.json === true,
  stream: process.stdout,
  label: 'tooling-install stdout'
});
const languageOverride = normalizeLanguageList(argv.languages);
const toolOverride = normalizeLanguageList(argv.tools);
const shouldUseCmdShell = (command) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
const WINDOWS_EXEC_EXTS = ['.exe', '.cmd', '.bat', '.com'];
const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^();]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const resolveSpawnCommand = (cmd) => {
  const value = String(cmd || '').trim();
  if (!value || process.platform !== 'win32') return value;
  if (path.extname(value) || value.includes(path.sep) || value.includes('/')) return value;
  const pathEntries = splitPathEntries(resolveEnvPath(process.env));
  for (const ext of WINDOWS_EXEC_EXTS) {
    for (const dir of pathEntries) {
      const candidate = path.join(dir, `${value}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return value;
};

const spawnToolCommand = (command, args, options) => {
  const run = (cmd, cmdArgs) => {
    try {
      const result = spawnSubprocessSync(cmd, cmdArgs, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: options?.stdio,
        outputEncoding: options?.encoding || 'utf8',
        timeoutMs: options?.timeoutMs,
        rejectOnNonZeroExit: false,
        captureStdout: true,
        captureStderr: true,
        outputMode: 'string'
      });
      return {
        status: result.exitCode ?? null,
        signal: result.signal ?? null,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
        error: null
      };
    } catch (error) {
      const output = error?.result && typeof error.result === 'object' ? error.result : null;
      return {
        status: output?.exitCode ?? null,
        signal: output?.signal ?? null,
        stdout: typeof output?.stdout === 'string' ? output.stdout : '',
        stderr: typeof output?.stderr === 'string' ? output.stderr : '',
        error
      };
    }
  };
  if (!shouldUseCmdShell(command)) {
    return run(command, args);
  }
  const commandLine = [command, ...args].map(quoteWindowsCmdArg).join(' ');
  const shellExe = process.env.ComSpec || 'cmd.exe';
  return run(shellExe, ['/d', '/s', '/c', commandLine]);
};

const resolveRequirementCheckArgCandidates = (commandName) => {
  const normalized = String(commandName || '').trim().toLowerCase();
  if (normalized === 'go') return [['version'], ['--version']];
  if (normalized === 'dotnet') return [['--info'], ['--version']];
  if (normalized === 'composer') return [['--version']];
  if (normalized === 'gem') return [['--version']];
  return [['--version'], ['version']];
};

const report = toolOverride.length
  ? { languages: {}, formats: {} }
  : await buildToolingReport(root, languageOverride, { skipScan: languageOverride.length > 0 });
const languageList = languageOverride.length ? languageOverride : Object.keys(report.languages || {});
const tools = toolOverride.length
  ? resolveToolsById(toolOverride, toolingConfig.dir, root, toolingConfig)
  : resolveToolsForLanguages(languageList, toolingConfig.dir, root, toolingConfig);

const actions = [];
const results = [];

for (const tool of tools) {
  const status = detectTool(tool);
  if (status.found) {
    results.push({ id: tool.id, status: 'already-installed', path: status.path });
    continue;
  }
  const selection = selectInstallPlan(tool, scope, allowFallback);
  if (!selection.plan) {
    results.push({ id: tool.id, status: 'manual', docs: tool.docs || null });
    continue;
  }
  const { cmd, args, env, requires } = selection.plan;
  if (requires) {
    const requirementCommand = resolveSpawnCommand(requires);
    const requirementArgCandidates = resolveRequirementCheckArgCandidates(requires);
    let requirementSatisfied = false;
    let requirementTerminated = false;
    for (const requirementArgs of requirementArgCandidates) {
      const requireCheck = spawnToolCommand(requirementCommand, requirementArgs, {
        encoding: 'utf8',
        stdio: 'ignore',
        timeoutMs: 4000
      });
      if (typeof requireCheck.signal === 'string' && requireCheck.signal.trim()) {
        requirementTerminated = true;
        continue;
      }
      if (requireCheck.status === 0) {
        requirementSatisfied = true;
        break;
      }
    }
    if (!requirementSatisfied) {
      results.push({
        id: tool.id,
        status: 'missing-requirement',
        requires,
        ...(requirementTerminated ? { error: `${requires} probe timed out or terminated.` } : {}),
        docs: tool.docs || null
      });
      continue;
    }
  }
  actions.push({ id: tool.id, cmd, args, env, scope: selection.scope, fallback: selection.fallback || false, docs: tool.docs || null });
}

if (argv['dry-run']) {
  const payload = { root, scope, allowFallback, actions, results };
  if (argv.json) {
    stdoutGuard.writeJson(payload);
  } else {
    console.error('[tooling-install] Dry run. Planned actions:');
    for (const action of actions) {
      console.error(`- ${action.id}: ${action.cmd} ${action.args.join(' ')}`);
    }
  }
  process.exit(0);
}

for (const action of actions) {
  console.error(`[tooling-install] Installing ${action.id} (${action.scope})...`);
  const env = action.env ? { ...process.env, ...action.env } : process.env;
  const command = resolveSpawnCommand(action.cmd);
  const spawnOpts = {
    env,
    // Keep JSON mode machine-parseable: suppress child stdout and stream
    // installer diagnostics through stderr only.
    stdio: argv.json ? ['inherit', 'ignore', 'inherit'] : 'inherit'
  };
  const result = spawnToolCommand(command, action.args, spawnOpts);
  if (typeof result.signal === 'string' && result.signal.trim()) {
    results.push({
      id: action.id,
      status: 'failed',
      exitCode: 1,
      error: `terminated by signal ${result.signal}`,
      docs: action.docs
    });
    continue;
  }
  if (result.status !== 0) {
    const exitCode = Number.isInteger(result.status) ? Number(result.status) : 1;
    const error = result.error?.message ? String(result.error.message) : null;
    results.push({
      id: action.id,
      status: 'failed',
      exitCode,
      ...(error ? { error } : {}),
      docs: action.docs
    });
    continue;
  }
  results.push({ id: action.id, status: 'installed' });
}

const payload = { root, scope, allowFallback, actions, results };
const hasFailedInstalls = results.some((entry) => (
  entry?.status === 'failed' || entry?.status === 'missing-requirement'
));
if (argv.json) {
  stdoutGuard.writeJson(payload);
} else {
  if (hasFailedInstalls) {
    console.error('[tooling-install] Some installs failed.');
  } else {
    console.error('[tooling-install] Completed.');
  }
}
process.exit(hasFailedInstalls ? 1 : 0);

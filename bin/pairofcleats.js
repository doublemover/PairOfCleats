#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getAutoPolicy,
  getRuntimeConfig,
  getToolVersion,
  loadUserConfig,
  resolveRepoRoot,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../tools/dict-utils.js';
import { resolveRuntimeEnvelope, resolveRuntimeEnv as resolveRuntimeEnvFromEnvelope } from '../src/shared/runtime-envelope.js';
import { createCli } from '../src/shared/cli.js';
import { INDEX_BUILD_OPTIONS } from '../src/shared/cli-options.js';
import { spawnSubprocessSync } from '../src/shared/subprocess.js';

const ROOT = resolveToolRoot();

const args = process.argv.slice(2);
const command = args[0];

if (!command || isHelpCommand(command)) {
  printHelp();
  process.exit(0);
}

if (isVersionCommand(command)) {
  console.error(readVersion());
  process.exit(0);
}

const primary = args.shift();
const resolved = resolveCommand(primary, args);
if (!resolved) {
  console.error(`Unknown command: ${primary}`);
  printHelp();
  process.exit(1);
}

runScript(resolved.script, resolved.extraArgs, resolved.args).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

function resolveCommand(primary, rest) {
  if (primary === 'index') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'build') {
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'watch') {
      return { script: 'build_index.js', extraArgs: ['--watch'], args: rest };
    }
    if (sub === 'validate') {
      return { script: 'tools/index-validate.js', extraArgs: [], args: rest };
    }
    return { script: 'build_index.js', extraArgs: [], args: [sub, ...rest] };
  }
  if (primary === 'search') {
    validateArgs(rest, ['repo', 'mode', 'top', 'json', 'explain', 'filter', 'backend'], ['repo', 'mode', 'top', 'filter', 'backend']);
    const backend = readFlagValue(rest, 'backend');
    if (backend && !['auto', 'sqlite', 'lmdb'].includes(backend.toLowerCase())) {
      console.error(`Unsupported --backend ${backend}. Use auto|sqlite|lmdb.`);
      process.exit(1);
    }
    return { script: 'search.js', extraArgs: [], args: rest };
  }
  if (primary === 'setup') {
    validateArgs(rest, [], []);
    return { script: 'tools/setup.js', extraArgs: [], args: rest };
  }
  if (primary === 'bootstrap') {
    validateArgs(rest, [], []);
    return { script: 'tools/bootstrap.js', extraArgs: [], args: rest };
  }
  if (primary === 'service') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('service requires a subcommand: api');
      printHelp();
      process.exit(1);
    }
    if (sub === 'api') {
      validateArgs(rest, ['host', 'port', 'repo'], ['host', 'port', 'repo']);
      return { script: 'tools/api-server.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown service subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'tooling') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('tooling requires a subcommand: doctor');
      printHelp();
      process.exit(1);
    }
    if (sub === 'doctor') {
      validateArgs(rest, ['repo', 'json', 'strict', 'non-strict'], ['repo']);
      return { script: 'tools/tooling-doctor.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown tooling subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'lmdb') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('lmdb requires a subcommand: build');
      printHelp();
      process.exit(1);
    }
    if (sub === 'build') {
      validateArgs(rest, ['repo', 'mode'], ['repo', 'mode']);
      return { script: 'tools/build-lmdb-index.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown lmdb subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  return null;
}

function validateArgs(args, allowedFlags, valueFlags) {
  const allowed = new Set(allowedFlags);
  const expectsValue = new Set(valueFlags);
  const errors = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === '--') break;
    if (!arg.startsWith('-')) continue;
    if (arg === '--help' || arg === '-h') continue;
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const flag = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
      if (!allowed.has(flag)) {
        errors.push(`Unknown flag: --${flag}`);
        continue;
      }
      if (expectsValue.has(flag)) {
        if (eqIndex !== -1) continue;
        const next = args[i + 1];
        if (!next || String(next).startsWith('-')) {
          errors.push(`Missing value for --${flag}`);
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (arg.startsWith('-')) {
      errors.push(`Unknown short flag: ${arg}`);
    }
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
}

function readFlagValue(args, name) {
  const flag = `--${name}`;
  const flagEq = `${flag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === flag) {
      const next = args[i + 1];
      return next ? String(next) : null;
    }
    if (arg.startsWith(flagEq)) {
      return arg.slice(flagEq.length);
    }
  }
  return null;
}

async function runScript(scriptPath, extraArgs, restArgs) {
  const resolved = path.join(ROOT, scriptPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Script not found: ${resolved}`);
    process.exit(1);
  }
  const repoOverride = extractRepoArg(restArgs);
  const repoRoot = repoOverride ? path.resolve(repoOverride) : resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(repoRoot);
  let env = process.env;
  if (scriptPath === 'build_index.js') {
    const rawArgs = [...extraArgs, ...restArgs];
    const cli = createCli({
      argv: ['node', 'build_index.js', ...rawArgs],
      options: INDEX_BUILD_OPTIONS
    }).help(false).version(false).exitProcess(false);
    const argv = typeof cli.parseSync === 'function' ? cli.parseSync() : cli.parse();
    const autoPolicy = await getAutoPolicy(repoRoot, userConfig);
    const envelope = resolveRuntimeEnvelope({
      argv,
      rawArgv: rawArgs,
      userConfig,
      autoPolicy,
      env: process.env,
      execArgv: process.execArgv,
      cpuCount: os.cpus().length,
      processInfo: {
        pid: process.pid,
        argv: process.argv,
        execPath: process.execPath,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: os.cpus().length
      },
      toolVersion: getToolVersion()
    });
    env = resolveRuntimeEnvFromEnvelope(envelope, process.env);
  } else {
    const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
    env = resolveRuntimeEnv(runtimeConfig, process.env);
  }
  const result = spawnSubprocessSync(process.execPath, [resolved, ...extraArgs, ...restArgs], {
    stdio: 'inherit',
    env,
    rejectOnNonZeroExit: false
  });
  process.exit(result.exitCode ?? 1);
}

function extractRepoArg(args) {
  const idx = args.indexOf('--repo');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

function isHelpCommand(value) {
  return value === 'help' || value === '--help' || value === '-h';
}

function isVersionCommand(value) {
  return value === 'version' || value === '--version' || value === '-v';
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp() {
  process.stderr.write(`Usage: pairofcleats <command> [args]

Core:
  setup                   Guided setup flow
  bootstrap               Fast bootstrap flow

Index:
  index build             Build file-backed indexes
  index watch             Watch and rebuild indexes incrementally
  index validate          Validate index artifacts

Search:
  search "<query>"         Query indexed data

Service:
  service api             Run local HTTP JSON API

Tooling:
  tooling doctor          Inspect tooling availability and config

LMDB:
  lmdb build              Build LMDB indexes
`);
}

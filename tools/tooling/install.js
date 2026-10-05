#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLING_INSTALL_OPTIONS } from '../../src/shared/cli-options.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { exitLikeCommandResult, probeCommand, runCommand } from '../shared/cli-utils.js';
import { buildToolingReport, detectTool, normalizeLanguageList, resolveToolsById, resolveToolsForLanguages, selectInstallPlan } from './utils.js';
import { getToolingConfig, resolveRepoRootArg, resolveToolRoot } from '../shared/dict-utils.js';
import { buildToolInstallReadiness } from '../setup/readiness.js';
import { invalidateToolingCommandProbeCache } from '../../src/index/tooling/command-resolver.js';
import { findBinaryOnPath } from '../../src/index/tooling/binary-utils.js';
import { resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from './install-requirements.js';

const argv = createCli({
  scriptName: 'pairofcleats tooling install',
  options: TOOLING_INSTALL_OPTIONS
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = resolveRepoRootArg(explicitRoot);
const installationCwd = resolveToolRoot();
const toolingConfig = getToolingConfig(root);
const scope = argv.scope || toolingConfig.installScope || 'cache';
const allowFallback = argv['no-fallback'] ? false : toolingConfig.allowGlobalFallback !== false;
const stdoutGuard = createStdoutGuard({
  enabled: argv.json === true,
  stream: process.stdout,
  label: 'tooling-install stdout'
});
const languageOverride = normalizeLanguageList(argv.languages);
const toolOverride = [...new Set(normalizeLanguageList(argv.tools))];

const runInstallCommand = (command, args, options = {}) => {
  try {
    const result = runCommand(command, args, options);
    return { ...result, error: null };
  } catch (error) {
    const output = error?.result && typeof error.result === 'object'
      ? error.result
      : null;
    return {
      ok: false,
      status: Number.isInteger(output?.exitCode) ? Number(output.exitCode) : null,
      signal: typeof output?.signal === 'string' ? output.signal : null,
      stdout: typeof output?.stdout === 'string' ? output.stdout : '',
      stderr: typeof output?.stderr === 'string' ? output.stderr : '',
      error
    };
  }
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
for (const id of toolOverride) {
  if (!tools.some((tool) => tool.id === id)) results.push({
    id, status: 'unavailable', error: 'Requested tool is unknown or disabled by configuration.'
  });
}

const resolveVerifiedPath = (status) => {
  if (!status?.found || status.probe?.ok !== true || !status.path) return null;
  const candidate = path.isAbsolute(status.path) ? status.path : findBinaryOnPath(status.path);
  if (!candidate) return null;
  try { return fs.realpathSync(candidate); }
  catch { return null; }
};

for (const tool of tools) {
  const status = detectTool(tool);
  const verifiedPath = resolveVerifiedPath(status);
  if (verifiedPath) {
    results.push({
      id: tool.id,
      status: 'already-installed',
      path: verifiedPath,
      probe: status.probe || null
    });
    continue;
  }
  const selection = selectInstallPlan(tool, scope, allowFallback);
  if (!selection.plan) {
    results.push({
      id: tool.id,
      status: 'manual',
      docs: tool.docs || null,
      probe: status.probe || null
    });
    continue;
  }
  const { cmd, args, env, requires } = selection.plan;
  if (requires) {
    const requirementArgCandidates = resolveInstallerRequirementProbeArgs(requires);
    let requirementSatisfied = false;
    const requirementChecks = [];
    for (const requirementArgs of requirementArgCandidates) {
      const requireCheck = probeCommand(requires, requirementArgs, {
        cwd: installationCwd,
        stdio: 'pipe',
        timeoutMs: 4000,
        maxOutputBytes: 64 * 1024,
        outputEncoding: 'utf8'
      });
      const verification = verifyInstallerRequirementProbe(requires, requireCheck);
      requirementChecks.push({
        args: requirementArgs,
        outcome: requireCheck?.outcome || 'inconclusive',
        status: Number.isInteger(requireCheck?.status) ? Number(requireCheck.status) : null,
        signal: typeof requireCheck?.signal === 'string' ? requireCheck.signal : null,
        errorCode: typeof requireCheck?.errorCode === 'string' ? requireCheck.errorCode : null,
        verificationLevel: verification.verificationLevel || null,
        identity: verification.identity || null,
        reason: verification.reason || null
      });
      if (verification.ok === true) {
        requirementSatisfied = true;
        break;
      }
    }
    if (!requirementSatisfied) {
      results.push({
        id: tool.id,
        status: 'missing-requirement',
        requires,
        requirementChecks,
        ...(requirementChecks.some((check) => check.reason === 'unrecognized_go_sdk_version')
          ? { error: 'The go command did not emit a recognized Go SDK version.' } : {}),
        docs: tool.docs || null,
        probe: status.probe || null
      });
      continue;
    }
  }
  actions.push({ id: tool.id, cmd, args, env, scope: selection.scope, fallback: selection.fallback || false, docs: tool.docs || null });
}

if (argv['dry-run']) {
  const readiness = buildToolInstallReadiness([...results, ...actions.map((action) => ({ id: action.id, status: 'planned' }))], { dryRun: true });
  const payload = { root, scope, allowFallback, actions, results, readiness };
  if (argv.json) {
    stdoutGuard.writeJson(payload);
    await new Promise((resolve) => process.stdout.write('', resolve));
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
  const spawnOpts = {
    cwd: installationCwd,
    env,
    // Keep JSON mode machine-parseable: suppress child stdout and stream
    // installer diagnostics through stderr only.
    stdio: argv.json ? ['inherit', 'ignore', 'inherit'] : 'inherit'
  };
  const result = runInstallCommand(action.cmd, action.args, spawnOpts);
  if (typeof result.signal === 'string' && result.signal.trim()) {
    exitLikeCommandResult({ status: null, signal: result.signal });
  }
  if (result.ok !== true) {
    const exitCode = Number.isInteger(result.status) ? Number(result.status) : 1;
    const error = String(
      result.stderr
      || result.stdout
      || result.error?.message
      || ''
    ).trim() || null;
    results.push({
      id: action.id,
      status: 'failed',
      exitCode,
      ...(error ? { error } : {}),
      docs: action.docs
    });
    continue;
  }
  // An installer can exit successfully while leaving a missing executable or
  // broken package layout. Re-check from the future runtime environment.
  invalidateToolingCommandProbeCache({ providerId: action.id });
  const tool = tools.find((entry) => entry.id === action.id);
  const verified = detectTool(tool);
  const verifiedPath = resolveVerifiedPath(verified);
  results.push(verifiedPath
    ? { id: action.id, status: 'installed', path: verifiedPath, source: verified.source, probe: verified.probe }
    : { id: action.id, status: 'verification-failed', path: verified.path, probe: verified.probe,
      error: 'Installer exited successfully, but the executable probe or package layout check failed.', docs: action.docs });
}

const readiness = buildToolInstallReadiness(results);
const payload = { root, scope, allowFallback, actions, results, readiness };
const hasFailedInstalls = readiness.state === 'blocked';
if (argv.json) {
  stdoutGuard.writeJson(payload);
} else {
  if (hasFailedInstalls) {
    console.error(`[tooling-install] Required tools are not ready: ${readiness.blockedIds.join(', ')}.`);
  } else {
    console.error('[tooling-install] Completed.');
  }
}
process.exitCode = hasFailedInstalls ? 1 : 0;

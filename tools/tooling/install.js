#!/usr/bin/env node
import { createCli } from '../../src/shared/cli.js';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLING_INSTALL_OPTIONS } from '../../src/shared/cli-options.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { exitLikeCommandResult, probeCommand } from '../shared/cli-utils.js';
import { buildToolingReport, detectTool, normalizeLanguageList, resolveToolsById, resolveToolsForLanguages, selectInstallPlan } from './utils.js';
import { getToolingConfig, resolveRepoRootArg, resolveToolRoot } from '../shared/dict-utils.js';
import { buildToolInstallReadiness } from '../setup/readiness.js';
import { invalidateToolingCommandProbeCache, resolveNoProvisionToolingEnvironment } from '../../src/index/tooling/command-resolver.js';
import { findBinaryOnPath } from '../../src/index/tooling/binary-utils.js';
import { isGoSdkVersionAtLeast, resolveInstallerRequirementProbeArgs, verifyInstallerRequirementProbe } from './install-requirements.js';
import { ensureManagedGoSdk } from './install-go-sdk.js';
import { applyManagedGoEnvironment, resolveManagedGoSdk } from '../../src/shared/managed-go.js';
import { isApplicationOwnedCommand, isRepoTrusted } from '../../src/shared/config-authority.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { bindProvisioningCommand, createToolProvisioningPlan } from './provisioning-plan.js';
import { buildToolInstallReceipt, writeToolInstallReceipt } from './install-receipts.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../src/shared/storage/child-environment.js';
import { resolveDeclaredInstallAdmission, runToolInstallChild } from './install-execution.js';
import { installPinnedManagedTool, validatePinnedInstallDescriptor } from './managed-install.js';

const argv = createCli({
  scriptName: 'pairofcleats tooling install',
  options: TOOLING_INSTALL_OPTIONS
}).parserConfiguration({ 'boolean-negation': false }).parse();

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

const report = toolOverride.length
  ? { languages: {}, formats: {} }
  : await buildToolingReport(root, languageOverride, { skipScan: languageOverride.length > 0, skipToolDetection: true });
const languageList = languageOverride.length ? languageOverride : Object.keys(report.languages || {});
const tools = toolOverride.length
  ? resolveToolsById(toolOverride, toolingConfig.dir, root, toolingConfig)
  : resolveToolsForLanguages(languageList, toolingConfig.dir, root, toolingConfig);

const actions = [];
const results = [];
let managedGoSdk = resolveManagedGoSdk(toolingConfig.dir);
let goBootstrapFailure = null;
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

const isAllowedRequirementCommand = (command) => {
  if (isRepoTrusted(root)) return true;
  try {
    const insideRepo = isPathWithinRoot(fs.realpathSync(command), fs.realpathSync(root))
      || isPathWithinRoot(path.resolve(command), root);
    return !insideRepo || isApplicationOwnedCommand({ commandPath: command, repoRoot: root, toolRoot: installationCwd });
  } catch {
    return false;
  }
};

for (const tool of tools) {
  const status = detectTool(tool);
  const verifiedPath = resolveVerifiedPath(status);
  const selection = selectInstallPlan(tool, scope, allowFallback);
  const storageAdmission = selection.plan ? resolveDeclaredInstallAdmission(selection.plan) : null;
  // Admission precedes prerequisite acquisition as well as the final package
  // child. An unknown package build cannot first download an unrelated SDK.
  if (!verifiedPath && selection.plan && selection.scope === 'cache' && storageAdmission.requiredBytes === null) {
    results.push({ id: tool.id, status: 'missing-requirement', reason: 'storage-estimate-unavailable', storageAdmission,
      error: 'Selected managed recipe has no complete artifact/build allocation estimate; writes are deferred without cleanup.' });
    continue;
  }
  // Launch requirements are checked even when server bytes already exist.
  const provisioning = createToolProvisioningPlan({ tool, selection: verifiedPath ? { ...selection, plan: null } : selection,
    probe: argv['dry-run'] ? null : (command, args, options) => probeCommand(command, args, { ...options, cwd: installationCwd }),
    isAllowed: isAllowedRequirementCommand });
  const blockedPrerequisites = provisioning.steps.filter(step => ['missing', 'incompatible'].includes(step.state)
    && step.id !== 'go');
  if (blockedPrerequisites.length && !argv['dry-run']) {
    results.push({ id: tool.id, status: 'missing-requirement', provisioning,
      error: blockedPrerequisites.map(step => `${step.id}: ${step.reason || 'not ready'}`).join('; ') });
    continue;
  }
  if (verifiedPath && !selection.plan) {
    results.push({ id: tool.id, status: 'already-installed', path: verifiedPath, probe: status.probe || null, provisioning });
    continue;
  }
  if (!selection.plan) {
    results.push({
      id: tool.id,
      status: 'manual',
      reason: tool.provisioningBlocker || 'No selected managed recipe is declared for this platform/scope.',
      docs: tool.docs || null,
      probe: status.probe || null
    });
    continue;
  }
  if (selection.plan.managedDescriptor) {
    const pinned = validatePinnedInstallDescriptor(selection.plan.managedDescriptor, { approvedOrigins: selection.plan.approvedOrigins });
    if (pinned.toolId !== tool.id) throw new Error('Canonical tool and managed descriptor identity disagree.');
    if (argv['dry-run']) {
      actions.push({ id: tool.id, kind: 'immutable-managed-archive', descriptor: pinned,
        scope: selection.scope, provisioning, status: 'planned' });
      continue;
    }
    try {
      const installed = await installPinnedManagedTool({ toolingRoot: path.resolve(toolingConfig.dir),
        descriptor: selection.plan.managedDescriptor, approvedOrigins: selection.plan.approvedOrigins,
        verify: tool.verifyManagedInstall, onProgress: event => console.error(`[tooling-install] ${tool.id}: ${event.state}`) });
      results.push({ id: tool.id, status: installed.ok ? installed.reused ? 'already-installed' : 'installed' : 'verification-failed',
        path: installed.command || null, provisioning, managedInstallation: installed,
        probe: { ok: installed.ok, verificationLevel: installed.verification?.level || 'canonical-recipe-verification' } });
    } catch (error) {
      if (error.cacheOwnershipPending) throw error;
      results.push({ id: tool.id, status: 'failed', error: error.message, code: error.code || null, provisioning });
    }
    continue;
  }
  const { cmd, args, env, requires } = selection.plan;
  if (Array.isArray(tool.install.platforms) && !tool.install.platforms.includes(process.platform)) {
    results.push({ id: tool.id, status: 'missing-requirement', reason: 'unsupported_platform',
      requires: tool.install.platformRequirement, error: tool.install.platformRequirement, docs: tool.docs || null });
    continue;
  }
  const minimumGoVersion = requires === 'go' && !verifiedPath ? selection.plan.minimumGoVersion || null : null;
  const goRootPin = requires === 'go' ? String(process.env.GOROOT || '').trim() : '';
  const goVersionPin = requires === 'go' && /^go\d/u.test(String(process.env.GOTOOLCHAIN || ''));
  const pinnedGoCommand = goRootPin && path.isAbsolute(goRootPin)
    ? path.join(goRootPin, 'bin', process.platform === 'win32' ? 'go.exe' : 'go') : null;
  let requirementCommand = requires;
  let goPrerequisite = null;
  if (requires) {
    const requirementArgCandidates = resolveInstallerRequirementProbeArgs(requires);
    let requirementSatisfied = false;
    const requirementChecks = [];
    const requirementCommands = requires === 'go'
      ? goRootPin ? [pinnedGoCommand].filter(Boolean)
        : goVersionPin ? [findBinaryOnPath('go')].filter(Boolean)
          : [...new Set([managedGoSdk?.command, findBinaryOnPath('go')].filter(Boolean))]
      : [findBinaryOnPath(requires)].filter(Boolean);
    for (const candidate of requirementCommands) {
      if (!isAllowedRequirementCommand(candidate)) {
        requirementChecks.push({ command: candidate, outcome: 'blocked', reason: 'installer_requirement_unavailable_or_repo_untrusted' });
        continue;
      }
      for (const requirementArgs of requirementArgCandidates) {
        const requireCheck = probeCommand(candidate, requirementArgs, {
          cwd: installationCwd,
          env: requires === 'go' ? resolveNoProvisionToolingEnvironment(candidate === managedGoSdk?.command
            ? applyManagedGoEnvironment(process.env, { toolingRoot: toolingConfig.dir, sdk: managedGoSdk }) : process.env,
          { cwd: installationCwd, command: candidate, providerId: 'go-sdk' }) : resolveNoProvisionToolingEnvironment(process.env,
          { cwd: installationCwd, command: candidate, providerId: requires }),
          stdio: 'pipe',
          timeoutMs: 4000,
          maxOutputBytes: 64 * 1024,
          outputEncoding: 'utf8'
        });
        const verification = verifyInstallerRequirementProbe(requires, requireCheck, { minimumGoVersion });
        requirementChecks.push({
          command: candidate,
          args: requirementArgs,
          outcome: requireCheck?.outcome || 'inconclusive',
          status: Number.isInteger(requireCheck?.status) ? Number(requireCheck.status) : null,
          signal: typeof requireCheck?.signal === 'string' ? requireCheck.signal : null,
          errorCode: typeof requireCheck?.errorCode === 'string' ? requireCheck.errorCode : null,
          verificationLevel: verification.verificationLevel || null,
          identity: verification.identity || null,
          ...(minimumGoVersion ? { minimumGoVersion } : {}),
          reason: verification.reason || null
        });
        if (verification.ok === true) {
          requirementSatisfied = true;
          requirementCommand = candidate;
          if (requires === 'go' && candidate === managedGoSdk?.command) {
            goPrerequisite = { id: 'go-sdk', state: 'available-and-verified',
              version: managedGoSdk.version, platform: managedGoSdk.os, arch: managedGoSdk.arch,
              sourceUrl: managedGoSdk.sourceUrl, archiveSha256: managedGoSdk.archiveSha256,
              reused: true, verificationLevel: managedGoSdk.verificationLevel };
          }
          break;
        }
      }
      if (requirementSatisfied) break;
    }
    if (!requirementSatisfied && requires === 'go' && !goRootPin && !goVersionPin
      && !requirementChecks.some(check => check.identity?.family === 'go')) {
      if (argv['dry-run']) {
        goPrerequisite = { id: 'go-sdk', state: 'planned', recipe: 'official-portable-archive',
          verificationLevel: 'official-release-sha256-and-executable-version' };
        requirementSatisfied = true;
      } else {
        try {
          if (goBootstrapFailure) throw goBootstrapFailure;
          managedGoSdk = await ensureManagedGoSdk({ toolingRoot: path.resolve(toolingConfig.dir), cwd: installationCwd });
          if (minimumGoVersion && !isGoSdkVersionAtLeast(managedGoSdk.version, minimumGoVersion)) {
            throw Object.assign(new Error(`The verified SDK ${managedGoSdk.version} does not meet ${minimumGoVersion}.`),
              { reason: 'unsupported_go_sdk_version' });
          }
          requirementCommand = managedGoSdk.command;
          requirementSatisfied = true;
          goPrerequisite = { id: 'go-sdk', state: 'available-and-verified',
            version: managedGoSdk.version, platform: managedGoSdk.os, arch: managedGoSdk.arch,
            sourceUrl: managedGoSdk.sourceUrl, archiveSha256: managedGoSdk.archiveSha256,
            reused: managedGoSdk.reused, verificationLevel: managedGoSdk.verificationLevel };
        } catch (error) {
          goBootstrapFailure = error;
          goPrerequisite = { id: 'go-sdk', state: 'failed', reason: error.reason || error.code || 'go_sdk_install_failed',
            error: String(error.message || error).slice(0, 4096) };
        }
      }
    }
    if (!requirementSatisfied) {
      results.push({
        id: tool.id,
        status: 'missing-requirement',
        requires,
        requirementChecks,
        ...(goPrerequisite ? { prerequisite: goPrerequisite } : {}),
        ...(requirementChecks.some((check) => check.reason === 'unrecognized_go_sdk_version')
          ? { error: 'The go command did not emit a recognized Go SDK version.' } : {}),
        ...(requirementChecks.some(check => check.reason === 'unsupported_go_sdk_version')
          ? { error: `${tool.id} installation requires ${minimumGoVersion} or newer; the selected SDK was retained.` } : {}),
        ...(goRootPin || goVersionPin ? { selectedGoRoot: goRootPin || null, selectedGoToolchain: process.env.GOTOOLCHAIN || null } : {}),
        docs: tool.docs || null,
        probe: status.probe || null
      });
      continue;
    }
  }
  if (verifiedPath) {
    results.push({ id: tool.id, status: 'already-installed', path: verifiedPath, probe: status.probe || null,
      provisioning,
      ...(goPrerequisite ? { prerequisite: goPrerequisite } : {}) });
    continue;
  }
  const bound = bindProvisioningCommand({ ...selection.plan, cmd: requires && cmd === requires ? requirementCommand : cmd }, provisioning);
  actions.push({ id: tool.id, cmd: bound.command,
    args, env, requires, provisioning, ...(goPrerequisite ? { prerequisite: goPrerequisite } : {}),
    storageAdmission,
    ...(minimumGoVersion ? { minimumGoVersion } : {}),
    scope: selection.scope, fallback: selection.fallback || false, docs: tool.docs || null });
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
  if (action.requires && !isAllowedRequirementCommand(action.cmd)) {
    results.push({ id: action.id, status: 'failed', error: 'Go installer command is unavailable or no longer authorized for this repository.',
      ...(action.prerequisite ? { prerequisite: action.prerequisite } : {}) });
    continue;
  }
  console.error(`[tooling-install] Installing ${action.id} (${action.scope})...`);
  const bound = bindProvisioningCommand({ cmd: action.cmd, args: action.args, env: action.env, requires: action.requires }, action.provisioning);
  let env = bound.env;
  if (action.requires === 'go') {
    if (managedGoSdk && action.cmd === managedGoSdk.command) {
      env = applyManagedGoEnvironment(env, { toolingRoot: toolingConfig.dir, sdk: managedGoSdk });
    }
    env = { ...env, GOENV: 'off', GOWORK: 'off', GOMAXPROCS: env.GOMAXPROCS || '1',
      GOTOOLCHAIN: env.GOTOOLCHAIN || 'local' };
    env = resolveNoProvisionToolingEnvironment(env, { cwd: installationCwd, command: action.cmd, providerId: 'go-sdk' });
    if (!/(?:^|\s)-p(?:=|\s)/.test(env.GOFLAGS || '')) env.GOFLAGS = `${env.GOFLAGS || ''} -p=1`.trim();
  }
  const layout = resolveStorageLayout({ overrides: { tooling: toolingConfig.dir } });
  const storagePlan = planManagedChildStorage({ baseEnv: env, layout, command: action.cmd,
    family: action.requires === 'gem' ? 'ruby' : action.requires || null,
    managed: action.scope === 'cache', toolId: action.id,
    toolIdentity: action.provisioning.planId, projectIdentity: root });
  env = storagePlan.env;
  const spawnOpts = {
    cwd: installationCwd,
    env,
    // Keep JSON mode machine-parseable: suppress child stdout and stream
    // installer diagnostics through stderr only.
    stdio: argv.json ? ['inherit', 'ignore', 'inherit'] : 'inherit'
  };
  const result = await runToolInstallChild({ command: action.cmd, args: action.args,
    options: spawnOpts, storagePlan, layout, admission: action.storageAdmission });
  action.storage = result.storage;
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
      docs: action.docs,
      ...(action.prerequisite ? { prerequisite: action.prerequisite } : {})
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
    ? { id: action.id, status: 'installed', path: verifiedPath, source: verified.source, probe: verified.probe,
      ...(action.prerequisite ? { prerequisite: action.prerequisite } : {}) }
    : { id: action.id, status: 'verification-failed', path: verified.path, probe: verified.probe,
      error: 'Installer exited successfully, but the executable probe or package layout check failed.', docs: action.docs,
      ...(action.prerequisite ? { prerequisite: action.prerequisite } : {}) });
}

for (const result of results) {
  if (!['installed', 'already-installed'].includes(result.status) || !result.path) continue;
  const tool = tools.find(entry => entry.id === result.id);
  try {
    // Explicit installer execution may persist evidence; detect/doctor never do.
    fs.mkdirSync(toolingConfig.dir, { recursive: true });
    const receipt = buildToolInstallReceipt({ tool, action: actions.find(entry => entry.id === result.id), result, toolingRoot: toolingConfig.dir });
    result.receiptPath = writeToolInstallReceipt(toolingConfig.dir, receipt);
    result.receiptId = receipt.receiptId;
    result.verification = receipt.verification;
  } catch (error) {
    result.status = 'verification-failed';
    result.error = 'Tool executable was observed, but durable install evidence could not be published: ' + error.message;
  }
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

#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { isRepoTrusted } from '../../src/shared/config-authority.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { getToolingConfig, resolveRepoRootArg } from '../shared/dict-utils.js';
import { createSourcekitOperationPlan, verifySourcekitOperationPlan } from '../../src/index/tooling/preflight/sourcekit-operation-plan.js';
import { ensureSourcekitPackageResolutionPreflight } from '../../src/index/tooling/preflight/sourcekit-package-resolution.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';
import { toolingFailureReport } from './cli-failure-report.js';

const EFFECTS = Object.freeze([
  'The fixed swift package resolve operation may evaluate Package.swift, fetch selected dependencies and change Package.resolved, .build or .swiftpm.',
  'SourceKit workspace loading may evaluate project build-server hooks and plugins; review and trust this exact repository first.',
  'SwiftPM uses the selected Swift environment and its cache configuration; this operation adds no separate cache routing or cleanup authority.'
]);

/** A deliberate operational entry point, separate from passive indexing. The
 * canonical SourceKit owner creates/verifies authority in this process only.
 * A saved report cannot grant workspace loading to a future index invocation.
 */
export const prepareSourcekitWorkspace = async ({ repoRoot, swiftCommand, apply = false, signal = null, log = () => {} } = {}, dependencies = {}) => {
  signal?.throwIfAborted();
  if (!path.isAbsolute(repoRoot || '') || !path.isAbsolute(swiftCommand || '')) throw new Error('SourceKit preparation requires an absolute exact repository and selected Swift command.');
  const root = await fs.realpath(repoRoot);
  const tooling = (dependencies.getConfig || getToolingConfig)(root);
  const preflight = dependencies.preflight || ensureSourcekitPackageResolutionPreflight;
  const sourcekitConfig = { ...(tooling.sourcekit || {}), preflightFailOpen: false, preflightTimeoutMs: 30000, preflightLockWaitMs: 0 };
  const base = { schemaVersion: 1, kind: 'sourcekit-workspace-prepare', repoRoot: root, swiftCommand,
    requestedOperation: ['package', 'resolve'], effects: EFFECTS,
    authority: 'exact-trusted-root-and-selected-command; in-process-only', consumerQualified: false };
  if (apply !== true) {
    const blockers = [];
    if (!isRepoTrusted(root)) blockers.push({ code: 'sourcekit_workspace_trust_required',
      nextAction: 'Review this repository and grant exact repository execution trust before selecting preparation.' });
    let executable = null;
    try { executable = identifyProvisioningExecutable(swiftCommand, { signal }); }
    catch (error) {
      signal?.throwIfAborted();
      blockers.push({ code: 'selected-swift-command-unavailable', nextAction: 'Select an existing absolute trusted Swift command; no PATH fallback or installation is attempted.',
        diagnostic: toolingFailureReport(error).error });
    }
    const passive = await preflight({ repoRoot: root, signal, log, sourcekitConfig, timeoutMs: 30000, resolutionPlan: null });
    signal?.throwIfAborted();
    return sanitizeRuntimeReceipt({ ...base, ok: blockers.length === 0, state: blockers.length ? 'blocked' : 'planned-not-probed',
      applied: false, execution: 'none', executable, blockers, passivePreflight: passive,
      nextAction: 'After reviewing the listed project execution, dependency and cache effects, invoke the same selected operation with --apply.' });
  }
  const operation = await (dependencies.createPlan || createSourcekitOperationPlan)({ repoRoot: root, swiftCommand,
    allowWorkspaceLoad: true, toolingConfig: tooling, signal });
  await (dependencies.verifyPlan || verifySourcekitOperationPlan)(operation, { repoRoot: root, signal });
  const result = await preflight({ repoRoot: root, signal, log, sourcekitConfig, timeoutMs: 30000, resolutionPlan: operation });
  signal?.throwIfAborted();
  const ok = result.blockSourcekit === false && result.state === 'ready';
  return sanitizeRuntimeReceipt({ ...base, ok, state: ok ? 'prepared' : 'blocked', applied: true,
    operationPlanIdentity: operation.identity, preflight: result, verification: 'workspace-package-preflight-only',
    futureWorkspaceAuthority: 'none; a future operational caller must create its own current in-process plan' });
};

export const runPrepareSourcekitCli = async () => {
  const argv = createCli({ scriptName: 'pairofcleats tooling prepare-sourcekit', options: {
    repo: { type: 'string', demandOption: true }, swift: { type: 'string', demandOption: true },
    apply: { type: 'boolean', default: false }, json: { type: 'boolean', default: false }
  } }).strictOptions().parse();
  const stdout = createStdoutGuard({ enabled: argv.json, label: 'tooling prepare-sourcekit' });
  const cancellation = new AbortController();
  const interrupt = () => { process.exitCode = 130; cancellation.abort(new Error('SourceKit preparation interrupted.')); };
  const terminate = () => { process.exitCode = 143; cancellation.abort(new Error('SourceKit preparation terminated.')); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const result = await prepareSourcekitWorkspace({ repoRoot: resolveRepoRootArg(argv.repo), swiftCommand: argv.swift,
      apply: argv.apply, signal: cancellation.signal, log: line => console.error(redactDiagnosticText(String(line), 2048)) });
    if (argv.json) stdout.writeJson(result);
    else console.error(JSON.stringify(result, null, 2));
    if (!process.exitCode) process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const failure = { ...toolingFailureReport(error, { signal: cancellation.signal, fallbackCode: 'ERR_SOURCEKIT_PREPARE' }),
      kind: 'sourcekit-workspace-prepare', applied: argv.apply ? null : false, operationRequested: argv.apply,
      consumerQualified: false };
    if (argv.json) stdout.writeJson(failure);
    else console.error(`[tooling prepare-sourcekit] ${failure.state}: ${failure.error.message}`);
    if (!process.exitCode) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
};

if (isDirectExecution(import.meta.url)) runPrepareSourcekitCli().catch(error => { console.error(error.message); if (!process.exitCode) process.exitCode = 1; });

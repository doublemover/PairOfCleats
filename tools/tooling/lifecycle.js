#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCli } from '../../src/shared/cli.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { getToolingConfig, resolveRepoRootArg } from '../shared/dict-utils.js';
import { readToolInstallReceipts, verifyToolInstallReceipt } from './install-receipts.js';
import { inspectManagedInstallation, inspectManagedToolRemoval, installPinnedManagedTool, removePinnedManagedTool, validatePinnedInstallDescriptor } from './managed-install.js';
import { resolveToolsById, selectInstallPlan } from './utils.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
export const planToolLifecycle = async ({ toolingRoot, id, operation = 'verify', receiptId = null, tool = null, signal = null } = {}) => {
  signal?.throwIfAborted();
  if (!['install', 'verify', 'update', 'repair', 'remove'].includes(operation)) throw new Error('Unknown tool lifecycle operation.');
  const receipts = readToolInstallReceipts(toolingRoot, id);
  const receipt = receiptId ? receipts.find(entry => entry.receiptId === receiptId)
    : receipts.sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  const verification = receipt ? verifyToolInstallReceipt(receipt) : null;
  const blockers = [];
  const managed = await inspectManagedInstallation({ toolingRoot, toolId: id, signal });
  const selection = tool ? selectInstallPlan(tool, 'cache', false) : null;
  const descriptor = selection?.plan?.managedDescriptor;
  if (managed.ok || descriptor) {
    let pinned = null;
    if (descriptor) pinned = validatePinnedInstallDescriptor(descriptor, { approvedOrigins: selection.plan.approvedOrigins });
    if (pinned && pinned.toolId !== id) throw new Error('Canonical tool and managed recipe identity disagree.');
    if (['install', 'update', 'repair'].includes(operation) && (!pinned || typeof tool.verifyManagedInstall !== 'function')) blockers.push({ code: 'canonical-pinned-recipe-verifier-required', nextAction: 'Select a canonical approved profile with a pinned source and exact resource-settlement verifier.' });
    const removal = operation === 'remove' ? await inspectManagedToolRemoval({ toolingRoot, toolId: id, signal }) : null;
    if (removal && removal.state !== 'owned-and-idle') blockers.push({ code: 'active-or-unknown-managed-owner', nextAction: 'Wait for exact consumers to settle, then re-plan removal.' });
    if (operation === 'verify' && !managed.ok) blockers.push({ code: 'managed-generation-not-ready', nextAction: 'Inspect the selected owned generation; no external bytes are adopted.' });
    const body = { schemaVersion: 1, kind: 'tool-lifecycle-plan', toolId: id, operation, toolingRoot: path.resolve(toolingRoot),
      receiptId: managed.receipt?.installId || null, ownership: 'managed', desiredDescriptorId: pinned?.descriptorId || null,
      verification: { state: managed.state, protocol: 'not-probed' }, removal,
      state: blockers.length ? 'blocked' : 'ready-for-explicit-apply', blockers,
      effects: operation === 'remove' ? ['remove only selected owned idle generation; retain receipts and other versions']
        : ['install', 'update', 'repair'].includes(operation) ? ['download exact approved archive if needed', 'verify immutable sibling', 'atomically select only after verification; preserve prior version and drift evidence']
          : ['read-only receipt and executable-byte verification'] };
    return { ...body, planId: digest(body) };
  }
  if (!receipt) blockers.push({ code: 'install-receipt-missing', nextAction: 'Run explicit tooling install for this selected tool; existing unowned bytes are preserved.' });
  if (operation === 'remove' && receipt?.ownership !== 'managed') blockers.push({ code: 'external-install-not-owned', nextAction: 'Use the installation owner to remove this external tool.' });
  if (operation === 'remove' && receipt?.ownedPaths.length) blockers.push({ code: 'asset-lease-and-package-ownership-required',
    nextAction: 'Targeted removal requires package-level ownership and the shared managed-asset lease guard; consumer-file evidence alone is insufficient.' });
  if (['update', 'repair', 'install'].includes(operation)) blockers.push({ code: 'isolated-recipe-publication-required',
    nextAction: 'An immutable versioned sibling recipe and shared publication/lease owner are required before replacing existing tool bytes.' });
  const body = { schemaVersion: 1, kind: 'tool-lifecycle-plan', toolId: id, operation, toolingRoot: path.resolve(toolingRoot),
    receiptId: receipt?.receiptId || null, ownership: receipt?.ownership || 'unknown', verification,
    state: blockers.length ? 'blocked' : 'ready-for-explicit-apply', blockers,
    effects: operation === 'verify' ? ['read-only receipt and executable-byte verification'] : [] };
  return { ...body, planId: digest(body) };
};

export const applyToolLifecyclePlan = async (approved, { tool = null, signal = null } = {}) => {
  signal?.throwIfAborted();
  const current = await planToolLifecycle({ toolingRoot: approved.toolingRoot, id: approved.toolId,
    operation: approved.operation, receiptId: approved.receiptId, tool, signal });
  if (approved.planId !== current.planId) throw new Error('Tool lifecycle plan changed; review a new plan.');
  if (current.state === 'blocked') return { ...current, ok: false, applied: false };
  signal?.throwIfAborted();
  if (current.removal) return { ...await removePinnedManagedTool(current.removal, { signal }), applied: true };
  if (['install', 'update', 'repair'].includes(current.operation) && current.desiredDescriptorId) {
    const selection = selectInstallPlan(tool, 'cache', false);
    return { ...await installPinnedManagedTool({ toolingRoot: approved.toolingRoot,
      descriptor: selection.plan.managedDescriptor, approvedOrigins: selection.plan.approvedOrigins,
      verify: tool.verifyManagedInstall, repair: current.operation === 'repair', signal }), applied: true };
  }
  // Verification does not execute or adopt the tool. Mutating operations fail
  // closed until the owning versioned recipe exposes publication and leases.
  return { ...current, ok: current.verification?.ok === true || current.verification?.state === 'bytes-intact', applied: false };
};

export const runToolLifecycleCli = async () => {
  const argv = createCli({ scriptName: 'tooling-lifecycle', options: {
    repo: { type: 'string' }, tool: { type: 'string', demandOption: true },
    operation: { type: 'string', choices: ['install', 'verify', 'update', 'repair', 'remove'], default: 'verify' },
    receipt: { type: 'string' }, 'apply-plan': { type: 'string' }, json: { type: 'boolean', default: false }
  } }).strictOptions().parse();
  const cancellation = new AbortController();
  const onInterrupt = () => { process.exitCode = 130; cancellation.abort(new Error('Tool lifecycle interrupted.')); };
  const onTerminate = () => { process.exitCode = 143; cancellation.abort(new Error('Tool lifecycle terminated.')); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
  const root = resolveRepoRootArg(argv.repo);
  const tooling = getToolingConfig(root);
  const tool = resolveToolsById([argv.tool], tooling.dir, root, tooling)[0] || null;
  let payload;
  if (argv['apply-plan']) {
    const file = path.resolve(argv['apply-plan']);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Lifecycle plan must be a bounded regular JSON file.');
    const approved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (path.resolve(approved.toolingRoot) !== path.resolve(tooling.dir) || approved.toolId !== argv.tool) throw new Error('Lifecycle plan target does not match selected configuration/tool.');
    payload = await applyToolLifecyclePlan(approved, { tool, signal: cancellation.signal });
  } else payload = await planToolLifecycle({ toolingRoot: tooling.dir, id: argv.tool, operation: argv.operation, receiptId: argv.receipt, tool,
    signal: cancellation.signal });
  if (argv.json) console.log(JSON.stringify(payload, null, 2));
  else console.error(JSON.stringify(payload, null, 2));
  if (!process.exitCode) process.exitCode = payload.state === 'blocked' || payload.ok === false ? 1 : 0;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
};

if (isDirectExecution(import.meta.url)) runToolLifecycleCli().catch(error => { console.error(error.message); if (!process.exitCode) process.exitCode = 1; });

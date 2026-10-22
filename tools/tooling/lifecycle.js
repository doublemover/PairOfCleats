#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCli } from '../../src/shared/cli.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { getToolingConfig, resolveRepoRootArg } from '../shared/dict-utils.js';
import { readToolInstallReceipts, verifyToolInstallReceipt } from './install-receipts.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
export const planToolLifecycle = ({ toolingRoot, id, operation = 'verify', receiptId = null } = {}) => {
  if (!['install', 'verify', 'update', 'repair', 'remove'].includes(operation)) throw new Error('Unknown tool lifecycle operation.');
  const receipts = readToolInstallReceipts(toolingRoot, id);
  const receipt = receiptId ? receipts.find(entry => entry.receiptId === receiptId)
    : receipts.sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  const verification = receipt ? verifyToolInstallReceipt(receipt) : null;
  const blockers = [];
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

export const applyToolLifecyclePlan = approved => {
  const current = planToolLifecycle({ toolingRoot: approved.toolingRoot, id: approved.toolId,
    operation: approved.operation, receiptId: approved.receiptId });
  if (approved.planId !== current.planId) throw new Error('Tool lifecycle plan changed; review a new plan.');
  if (current.state === 'blocked') return { ...current, ok: false, applied: false };
  // Verification does not execute or adopt the tool. Mutating operations fail
  // closed until the owning versioned recipe exposes publication and leases.
  return { ...current, ok: current.verification?.ok === true, applied: false };
};

export const runToolLifecycleCli = async () => {
  const argv = createCli({ scriptName: 'tooling-lifecycle', options: {
    repo: { type: 'string' }, tool: { type: 'string', demandOption: true },
    operation: { type: 'string', choices: ['install', 'verify', 'update', 'repair', 'remove'], default: 'verify' },
    receipt: { type: 'string' }, 'apply-plan': { type: 'string' }, json: { type: 'boolean', default: false }
  } }).strictOptions().parse();
  const root = resolveRepoRootArg(argv.repo);
  const tooling = getToolingConfig(root);
  let payload;
  if (argv['apply-plan']) {
    const file = path.resolve(argv['apply-plan']);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Lifecycle plan must be a bounded regular JSON file.');
    const approved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (path.resolve(approved.toolingRoot) !== path.resolve(tooling.dir) || approved.toolId !== argv.tool) throw new Error('Lifecycle plan target does not match selected configuration/tool.');
    payload = applyToolLifecyclePlan(approved);
  } else payload = planToolLifecycle({ toolingRoot: tooling.dir, id: argv.tool, operation: argv.operation, receiptId: argv.receipt });
  if (argv.json) console.log(JSON.stringify(payload, null, 2));
  else console.error(JSON.stringify(payload, null, 2));
  process.exitCode = payload.state === 'blocked' || payload.ok === false ? 1 : 0;
};

if (isDirectExecution(import.meta.url)) runToolLifecycleCli().catch(error => { console.error(error.message); process.exitCode = 1; });

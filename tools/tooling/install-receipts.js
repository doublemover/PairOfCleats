import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';

export const TOOL_INSTALL_RECEIPT_VERSION = 1;
const hash = value => createHash('sha256').update(value).digest('hex');
const toolId = id => {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) throw new Error('Invalid tool receipt id.');
  return id;
};
const safeDirectory = (root, components, { create = false } = {}) => {
  let current = fs.realpathSync(root);
  const physicalRoot = current;
  for (const component of components) {
    current = path.join(current, component);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isPathWithinRoot(fs.realpathSync(current), physicalRoot)) throw new Error('Tool receipt directory escapes its managed owner.');
  }
  return current;
};

/** A persisted observation does not promote version output to protocol qualification. */
export const buildToolInstallReceipt = ({ tool, action = null, result, toolingRoot }) => {
  const root = fs.realpathSync(toolingRoot);
  const consumer = identifyProvisioningExecutable(result.path);
  const ownership = isPathWithinRoot(consumer.path, root) ? 'managed' : 'external';
  const recipe = action ? { command: action.cmd, args: action.args, scope: action.scope,
    identity: hash(stableStringify({ command: action.cmd, args: action.args, scope: action.scope })) } : null;
  const floating = !recipe || recipe.args.some(argument => /@(?:latest|next|nightly)$/.test(argument))
    || (['npm', 'gem'].some(manager => path.basename(recipe.command).startsWith(manager))
      && !recipe.args.some(argument => /@\d|^\d+\.\d+\.\d+/.test(argument)));
  const body = {
    schemaVersion: TOOL_INSTALL_RECEIPT_VERSION, kind: 'tool-install-receipt', toolId: toolId(tool.id),
    observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    ownership, managedRoot: ownership === 'managed' ? root : null,
    requestedVersion: tool.version || null, resolvedVersion: result.probe?.identity?.version || null,
    source: { kind: recipe ? 'observed-package-manager-or-archive-recipe' : 'external-or-prior-install', immutable: !floating, recipe },
    consumer: { command: consumer.path, args: result.managedInstallation?.args || [], executable: consumer },
    ownedPaths: ownership === 'managed' ? [{ path: consumer.path, sha256: consumer.sha256, kind: 'consumer-file' }] : [],
    prerequisites: action?.provisioning?.steps || result.provisioning?.steps || [],
    verification: { bytes: 'identified', executable: result.probe?.ok ? 'probe-passed' : 'not-probed',
      runtime: (action?.provisioning || result.provisioning)?.state === 'requirements-verified' ? 'verified' : 'not-probed',
      protocol: 'not-probed', consumer: 'not-qualified' }
  };
  return { ...body, receiptId: hash(stableStringify(body)) };
};

export const writeToolInstallReceipt = (toolingRoot, receipt) => {
  const directory = safeDirectory(toolingRoot, ['install-receipts', toolId(receipt.toolId)], { create: true });
  const target = path.join(directory, receipt.receiptId + '.json');
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
  return target;
};

export const readToolInstallReceipts = (toolingRoot, id) => {
  let directory;
  try { directory = safeDirectory(toolingRoot, ['install-receipts', toolId(id)]); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const names = fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  if (names.length > 1024) throw new Error('Tool receipt inventory exceeds its bound.');
  return names.sort().map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid tool receipt file.');
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { receiptId, ...body } = receipt;
    if (receipt.schemaVersion !== TOOL_INSTALL_RECEIPT_VERSION || receipt.toolId !== id
      || receiptId !== name.slice(0, -5) || hash(stableStringify(body)) !== receiptId) throw new Error('Tool install receipt identity is invalid.');
    return { receiptPath: file, ...receipt };
  });
};

export const verifyToolInstallReceipt = receipt => {
  const problems = [];
  if (receipt.schemaVersion !== TOOL_INSTALL_RECEIPT_VERSION) problems.push({ code: 'unsupported-receipt-version' });
  if (receipt.platform !== process.platform || receipt.arch !== process.arch) problems.push({ code: 'platform-mismatch' });
  try {
    const actual = identifyProvisioningExecutable(receipt.consumer.command);
    if (actual.path !== receipt.consumer.executable.path || actual.sha256 !== receipt.consumer.executable.sha256) problems.push({ code: 'consumer-bytes-changed' });
  } catch (error) { problems.push({ code: error.code || 'consumer-unreadable' }); }
  return { ok: problems.length === 0, toolId: receipt.toolId, receiptId: receipt.receiptId,
    state: problems.length ? 'repair-required' : 'bytes-intact', problems,
    verification: { ...receipt.verification, protocol: 'not-probed', consumer: 'not-qualified' } };
};

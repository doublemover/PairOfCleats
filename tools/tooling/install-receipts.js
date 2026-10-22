import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { identifyProvisioningExecutable } from './provisioning-plan.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { MANAGED_CHILD_STORAGE_RETENTION_TIERS } from '../../src/shared/storage/child-environment.js';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../../src/shared/contained-file.js';

export const TOOL_INSTALL_RECEIPT_VERSION = 1;
const hash = value => createHash('sha256').update(value).digest('hex');
export const TOOL_SECONDARY_STORAGE_VERSION = 1;
/** Accept only the actual install child's settled canonical projection. No env
 * object, value bag or inferred scratch path is ever copied into a receipt.
 */
export const projectToolSecondaryStorage = storage => {
  const absent = reason => ({ schemaVersion: TOOL_SECONDARY_STORAGE_VERSION, state: 'unknown-or-not-recorded',
    reason, profileIdentity: null, runId: null, locations: [], exceptions: [] });
  if (!storage) return absent('no-canonical-child-storage-projection');
  if (storage.prepared !== true || storage.source !== 'declared-not-observed-writes') return absent('managed-storage-not-prepared-or-external');
  if (storage.settlement?.settled !== true || storage.settlement.pending !== false
    || storage.settlement.resourceId !== `${storage.profileIdentity}:${storage.runId}`) return absent('actual-child-storage-settlement-unconfirmed');
  if (!/^[a-f0-9]{64}$/.test(storage.profileIdentity || '') || !/^[a-zA-Z0-9._-]{1,120}$/.test(storage.runId || '')
    || ['.', '..'].includes(storage.runId) || !Array.isArray(storage.locations) || storage.locations.length > 128
    || !Array.isArray(storage.exceptions) || storage.exceptions.length > 128) throw new Error('Invalid canonical secondary storage identity/inventory.');
  const text = value => typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f]/.test(value) ? redactDiagnosticText(value, 256) : null;
  const locations = storage.locations.map(location => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(location.environmentKey || '') || !path.isAbsolute(location.path || '')
      || /[\x00-\x1f]/.test(location.path) || !MANAGED_CHILD_STORAGE_RETENTION_TIERS.includes(location.retention)
      || typeof location.external !== 'boolean' || typeof location.file !== 'boolean'
      || !['inherited-or-explicit-environment', 'managed-storage-profile'].includes(location.source)) throw new Error('Invalid canonical secondary storage location.');
    return { environmentKey: location.environmentKey, path: location.path, retention: location.retention, external: location.external,
      source: location.source, purpose: text(location.purpose), file: location.file, cleanupAuthority: false };
  });
  const exceptions = storage.exceptions.map(exception => ({ ...(text(exception.environmentKey) ? { environmentKey: text(exception.environmentKey) } : {}),
    ...(path.isAbsolute(exception.path || '') && !/[\x00-\x1f]/.test(exception.path) ? { path: exception.path } : {}),
    kind: text(exception.kind), status: text(exception.status) }));
  return { schemaVersion: TOOL_SECONDARY_STORAGE_VERSION, state: 'settled-declared-not-observed', profileIdentity: storage.profileIdentity,
    runId: storage.runId, locations, exceptions };
};
const toolId = id => {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(id)) throw new Error('Invalid tool receipt id.');
  return id;
};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = value => typeof value === 'string' && !/[\x00-\x1f]/.test(value);
const absolute = value => text(value) && path.isAbsolute(value);
const strings = value => Array.isArray(value) && value.length <= 1024 && value.every(argument => typeof argument === 'string');
const invalidReceipt = () => Object.assign(new Error('Tool install receipt identity or registered metadata is invalid.'), {
  code: 'ERR_TOOL_INSTALL_RECEIPT'
});

export const validateToolSecondaryStorage = value => {
  if (value?.state === 'unknown-or-not-recorded') {
    if (!exact(value, ['schemaVersion', 'state', 'reason', 'profileIdentity', 'runId', 'locations', 'exceptions'])
      || value.schemaVersion !== TOOL_SECONDARY_STORAGE_VERSION || !text(value.reason)
      || value.profileIdentity !== null || value.runId !== null || !Array.isArray(value.locations) || value.locations.length
      || !Array.isArray(value.exceptions) || value.exceptions.length) throw invalidReceipt();
    return value;
  }
  if (!exact(value, ['schemaVersion', 'state', 'profileIdentity', 'runId', 'locations', 'exceptions'])
    || value.schemaVersion !== TOOL_SECONDARY_STORAGE_VERSION || value.state !== 'settled-declared-not-observed'
    || !/^[a-f0-9]{64}$/.test(value.profileIdentity || '') || !/^[a-zA-Z0-9._-]{1,120}$/.test(value.runId || '')
    || ['.', '..'].includes(value.runId) || !Array.isArray(value.locations) || value.locations.length > 128
    || !Array.isArray(value.exceptions) || value.exceptions.length > 128) throw invalidReceipt();
  for (const location of value.locations) {
    if (!exact(location, ['environmentKey', 'path', 'retention', 'external', 'source', 'purpose', 'file', 'cleanupAuthority'])
      || !/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(location.environmentKey || '') || !absolute(location.path)
      || !MANAGED_CHILD_STORAGE_RETENTION_TIERS.includes(location.retention) || typeof location.external !== 'boolean'
      || typeof location.file !== 'boolean' || location.cleanupAuthority !== false
      || !['inherited-or-explicit-environment', 'managed-storage-profile'].includes(location.source)
      || (location.purpose !== null && (!text(location.purpose) || location.purpose.length > 256))) throw invalidReceipt();
  }
  for (const exception of value.exceptions) {
    if (!exception || typeof exception !== 'object' || Array.isArray(exception)
      || Object.keys(exception).some(key => !['environmentKey', 'path', 'kind', 'status'].includes(key))
      || ['kind', 'status'].some(key => exception[key] !== null && (!text(exception[key]) || exception[key].length > 256))
      || (exception.environmentKey !== undefined && (!text(exception.environmentKey) || exception.environmentKey.length > 256))
      || (exception.path !== undefined && !absolute(exception.path))) throw invalidReceipt();
  }
  return value;
};

/** Checks persisted observation vocabulary and identity, never removal authority. */
export const validateToolInstallReceipt = receipt => {
  const keys = ['schemaVersion', 'kind', 'toolId', 'observedAt', 'platform', 'arch', 'ownership', 'managedRoot',
    'requestedVersion', 'resolvedVersion', 'source', 'consumer', 'ownedPaths', 'prerequisites', 'verification', 'receiptId'];
  if (Object.hasOwn(receipt || {}, 'secondaryStorage')) keys.push('secondaryStorage');
  if (!exact(receipt, keys) || receipt.schemaVersion !== TOOL_INSTALL_RECEIPT_VERSION || receipt.kind !== 'tool-install-receipt'
    || !/^[a-z0-9][a-z0-9.-]{0,100}$/.test(receipt.toolId || '') || !/^[a-f0-9]{64}$/.test(receipt.receiptId || '')
    || !text(receipt.observedAt) || !Number.isFinite(Date.parse(receipt.observedAt)) || !text(receipt.platform) || !text(receipt.arch)
    || !['managed', 'external'].includes(receipt.ownership)
    || ['requestedVersion', 'resolvedVersion'].some(key => receipt[key] !== null && !text(receipt[key]))
    || !Array.isArray(receipt.prerequisites) || receipt.prerequisites.length > 256) throw invalidReceipt();
  const source = receipt.source, consumer = receipt.consumer, executable = consumer?.executable;
  if (!exact(source, ['kind', 'immutable', 'recipe']) || typeof source.immutable !== 'boolean'
    || !['observed-package-manager-or-archive-recipe', 'external-or-prior-install'].includes(source.kind)
    || !exact(consumer, ['command', 'args', 'executable']) || !absolute(consumer.command) || !strings(consumer.args)
    || !exact(executable, ['path', 'sha256', 'size']) || executable.path !== consumer.command
    || !/^[a-f0-9]{64}$/.test(executable.sha256 || '') || !Number.isSafeInteger(executable.size) || executable.size < 0) throw invalidReceipt();
  if (source.recipe === null) {
    if (source.kind !== 'external-or-prior-install') throw invalidReceipt();
  } else {
    const recipe = source.recipe;
    if (source.kind !== 'observed-package-manager-or-archive-recipe' || !exact(recipe, ['command', 'args', 'scope', 'identity'])
      || !text(recipe.command) || !strings(recipe.args) || !['cache', 'user', 'system'].includes(recipe.scope)
      || recipe.identity !== hash(stableStringify({ command: recipe.command, args: recipe.args, scope: recipe.scope }))) throw invalidReceipt();
  }
  if (!Array.isArray(receipt.ownedPaths) || (receipt.ownership === 'external'
    ? receipt.managedRoot !== null || receipt.ownedPaths.length !== 0
    : !absolute(receipt.managedRoot) || !isPathWithinRoot(consumer.command, receipt.managedRoot) || receipt.ownedPaths.length !== 1)) throw invalidReceipt();
  for (const owned of receipt.ownedPaths) {
    if (!exact(owned, ['path', 'sha256', 'kind']) || owned.path !== consumer.command || owned.sha256 !== executable.sha256
      || owned.kind !== 'consumer-file') throw invalidReceipt();
  }
  const verification = receipt.verification;
  if (!exact(verification, ['bytes', 'executable', 'runtime', 'protocol', 'consumer']) || verification.bytes !== 'identified'
    || !['probe-passed', 'not-probed'].includes(verification.executable) || !['verified', 'not-probed'].includes(verification.runtime)
    || verification.protocol !== 'not-probed' || verification.consumer !== 'not-qualified') throw invalidReceipt();
  if (receipt.secondaryStorage !== undefined) validateToolSecondaryStorage(receipt.secondaryStorage);
  const { receiptId, ...body } = receipt;
  if (receiptId !== hash(stableStringify(body))) throw invalidReceipt();
  return receipt;
};
const safeDirectory = (root, components, { create = false } = {}) => {
  assertNoSymlinkPath(path.parse(path.resolve(root)).root, root);
  let current = fs.realpathSync(root);
  const physicalRoot = current;
  for (const component of components) {
    current = path.join(current, component);
    if (create) {
      try { fs.mkdirSync(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
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
  const recipe = typeof action?.cmd === 'string' && Array.isArray(action.args) ? { command: action.cmd, args: action.args, scope: action.scope,
    identity: hash(stableStringify({ command: action.cmd, args: action.args, scope: action.scope })) } : null;
  const body = {
    schemaVersion: TOOL_INSTALL_RECEIPT_VERSION, kind: 'tool-install-receipt', toolId: toolId(tool.id),
    observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    ownership, managedRoot: ownership === 'managed' ? root : null,
    requestedVersion: tool.version || null, resolvedVersion: result.probe?.identity?.version || null,
    source: { kind: recipe ? 'observed-package-manager-or-archive-recipe' : 'external-or-prior-install', immutable: false, recipe },
    consumer: { command: consumer.path, args: result.managedInstallation?.args || [], executable: consumer },
    ownedPaths: ownership === 'managed' ? [{ path: consumer.path, sha256: consumer.sha256, kind: 'consumer-file' }] : [],
    prerequisites: action?.provisioning?.steps || result.provisioning?.steps || [],
    secondaryStorage: projectToolSecondaryStorage(action?.storage),
    verification: { bytes: 'identified', executable: result.probe?.ok ? 'probe-passed' : 'not-probed',
      runtime: (action?.provisioning || result.provisioning)?.state === 'requirements-verified' ? 'verified' : 'not-probed',
      protocol: 'not-probed', consumer: 'not-qualified' }
  };
  return { ...body, receiptId: hash(stableStringify(body)) };
};

export const writeToolInstallReceipt = (toolingRoot, receipt) => {
  validateToolInstallReceipt(receipt);
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  if (bytes.length > 1024 * 1024) throw invalidReceipt();
  const directory = safeDirectory(toolingRoot, ['install-receipts', toolId(receipt.toolId)], { create: true });
  const target = path.join(directory, receipt.receiptId + '.json');
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  let failure = null, temporaryOwned = false;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600, flush: true });
    temporaryOwned = true;
    assertNoSymlinkPath(path.parse(directory).root, temporary);
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = JSON.parse(readVerifiedContainedFileSync(directory, target, { maxBytes: 1024 * 1024 }).buffer.toString('utf8'));
      validateToolInstallReceipt(existing);
      if (stableStringify(existing) !== stableStringify(receipt)) throw invalidReceipt();
    }
    const published = validateToolInstallReceipt(JSON.parse(readVerifiedContainedFileSync(directory, target, { maxBytes: 1024 * 1024 }).buffer.toString('utf8')));
    if (stableStringify(published) !== stableStringify(receipt)) throw invalidReceipt();
  } catch (error) { failure = error; }
  try { if (temporaryOwned) fs.rmSync(temporary, { force: true }); }
  catch (error) {
    failure = failure ? new AggregateError([failure, error], failure.message, { cause: failure }) : error;
  }
  if (failure) throw failure;
  return target;
};

export const readToolInstallReceipts = (toolingRoot, id) => {
  let directory;
  try { directory = safeDirectory(toolingRoot, ['install-receipts', toolId(id)]); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const names = [];
  const entries = fs.opendirSync(directory);
  try {
    let entry, visited = 0;
    while ((entry = entries.readSync())) {
      if (++visited > 4096) throw new Error('Tool receipt inventory exceeds its entry bound.');
      if (/^[a-f0-9]{64}\.json$/.test(entry.name)) names.push(entry.name);
      if (names.length > 1024) throw new Error('Tool receipt inventory exceeds its bound.');
    }
  } finally { entries.closeSync(); }
  return names.sort().map(name => {
    const file = path.join(directory, name);
    const receipt = validateToolInstallReceipt(JSON.parse(readVerifiedContainedFileSync(directory, file, { maxBytes: 1024 * 1024 }).buffer.toString('utf8')));
    if (receipt.toolId !== id || receipt.receiptId !== name.slice(0, -5)) throw invalidReceipt();
    return { receiptPath: file, ...receipt };
  });
};

export const verifyToolInstallReceipt = receipt => {
  const problems = [];
  let registered = null;
  try {
    const { receiptPath, ...persisted } = receipt;
    if (receiptPath !== undefined && !absolute(receiptPath)) throw invalidReceipt();
    registered = validateToolInstallReceipt(persisted);
    if (receipt.platform !== process.platform || receipt.arch !== process.arch) problems.push({ code: 'platform-mismatch' });
    const actual = identifyProvisioningExecutable(receipt.consumer.command);
    if (actual.path !== receipt.consumer.executable.path || actual.sha256 !== receipt.consumer.executable.sha256) problems.push({ code: 'consumer-bytes-changed' });
  } catch (error) { problems.push({ code: error.code || 'consumer-unreadable' }); }
  return { ok: problems.length === 0, toolId: receipt?.toolId || null, receiptId: receipt?.receiptId || null,
    state: problems.length ? 'repair-required' : 'bytes-intact', problems,
    verification: { ...(registered?.verification || { bytes: 'unverified', executable: 'not-probed', runtime: 'not-probed' }),
      protocol: 'not-probed', consumer: 'not-qualified' } };
};

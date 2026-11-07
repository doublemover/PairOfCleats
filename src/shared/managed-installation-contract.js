// Shared persisted ownership vocabulary. Source and regressions UNVALIDATED.
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const exact = (value, keys) => only(value, keys) && Object.keys(value).length === keys.length;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const archiveBaseKeys = ['url', 'type', 'bytes'];
const digestKeys = ['sha256', 'sha512'];
export const isKnownManagedInstallationArchive = archive => {
  if (!record(archive)) return false;
  const selected = digestKeys.filter(key => Object.hasOwn(archive, key));
  return selected.length === 1 && exact(archive, [...archiveBaseKeys, selected[0]])
    && typeof archive[selected[0]] === 'string'
    && (selected[0] === 'sha256' ? /^[a-f0-9]{64}$/u : /^[a-f0-9]{128}$/u).test(archive[selected[0]]);
};
const descriptorKeys = ['schemaVersion', 'toolId', 'recipeId', 'version', 'platform', 'arch',
  'archive', 'root', 'command', 'args', 'requiredFiles', 'executables', 'storageEstimate'];
const receiptKeys = ['schemaVersion', 'application', 'toolId', 'descriptorId', 'installId', 'descriptor',
  'root', 'source', 'files', 'filesIdentity', 'selectorIdentity', 'verification', 'installedAt', 'ownership', 'leaseProtocol'];

/** An intact digest identifies bytes, but does not qualify unknown retention,
 * ownership or future receipt semantics for reuse/replacement/removal.
 */
export const isKnownManagedInstallationDescriptor = descriptor => only(descriptor, descriptorKeys)
  && descriptor.schemaVersion === 1 && isKnownManagedInstallationArchive(descriptor.archive);

export const isKnownManagedInstallationReceipt = receipt => Boolean(exact(receipt, receiptKeys)
  && receipt.schemaVersion === 1 && receipt.application === 'pairofcleats'
  && receipt.ownership === 'managed' && receipt.leaseProtocol === 'storage-asset-access-v1'
  && hash(receipt.descriptorId) && hash(receipt.installId) && hash(receipt.filesIdentity) && hash(receipt.selectorIdentity)
  && isKnownManagedInstallationDescriptor(receipt.descriptor) && isKnownManagedInstallationArchive(receipt.source)
  && Object.keys(receipt.source).length === Object.keys(receipt.descriptor.archive).length
  && Object.keys(receipt.source).every(key => receipt.source[key] === receipt.descriptor.archive[key])
  && Array.isArray(receipt.files) && receipt.files.length <= 50000
  && receipt.files.every(file => exact(file, ['path', 'bytes', 'sha256']) && typeof file.path === 'string'
    && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && hash(file.sha256))
  && typeof receipt.installedAt === 'string' && Number.isFinite(Date.parse(receipt.installedAt))
  && record(receipt.verification) && receipt.verification.ok === true
  && exact(receipt.verification.settlement, ['resourceId', 'settled', 'pending'])
  && typeof receipt.verification.settlement.resourceId === 'string' && receipt.verification.settlement.resourceId.length > 0
  && receipt.verification.settlement.resourceId.length <= 256
  && receipt.verification.settlement.settled === true && receipt.verification.settlement.pending === false);

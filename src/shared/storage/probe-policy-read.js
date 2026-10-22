import path from 'node:path';
import { readVerifiedContainedFileSync } from '../contained-file.js';
import { STORAGE_POLICY_VERSION, COMMAND_PROBE_POLICY_DEFAULTS,
  assertCommandProbeStoragePolicy } from '../../contracts/schemas/storage-policy.js';

export const STORAGE_POLICY_FILE = 'storage-policies.json';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** Machine-local policy only. Invalid metadata preserves cached bytes and
 * disables cache use until explicit repair; it never falls back to eviction.
 */
export const readStorageProbePolicy = home => {
  home = path.resolve(home);
  const target = path.join(home, 'config', STORAGE_POLICY_FILE);
  let locatorRead = false;
  try {
    const read = readVerifiedContainedFileSync(path.parse(target).root, target, { maxBytes: 1024 * 1024 });
    locatorRead = true;
    const value = JSON.parse(read.buffer.toString('utf8'));
    if (!exactKeys(value, ['schemaVersion', 'kind', 'policies']) || value.schemaVersion !== STORAGE_POLICY_VERSION
      || value.kind !== 'pairofcleats-storage-policy-locator' || !value.policies || typeof value.policies !== 'object'
      || Array.isArray(value.policies) || Object.keys(value.policies).some(key => key !== 'command-probes')) throw new Error('Storage policy locator is incompatible or contains unknown categories.');
    const entry = value.policies['command-probes'];
    if (entry !== undefined) {
      if (!exactKeys(entry, ['policy', 'selectionId', 'receiptHash']) || !hash(entry.selectionId) || !hash(entry.receiptHash)) throw new Error('Command-probe policy selection is invalid.');
      assertCommandProbeStoragePolicy(entry.policy);
      const receiptFile = path.join(home, 'config', 'storage-policy-selections', `${entry.selectionId}.json`);
      const receiptRead = readVerifiedContainedFileSync(path.parse(receiptFile).root, receiptFile, { maxBytes: 1024 * 1024 });
      const receipt = JSON.parse(receiptRead.buffer.toString('utf8'));
      if (receiptRead.hash !== entry.receiptHash || !exactKeys(receipt, ['schemaVersion', 'kind', 'selectionId', 'home', 'category', 'policy', 'priorSelection'])
        || receipt.schemaVersion !== STORAGE_POLICY_VERSION || receipt.kind !== 'pairofcleats-storage-policy-selection'
        || receipt.home !== home || receipt.category !== 'command-probes' || receipt.selectionId !== entry.selectionId
        || JSON.stringify(receipt.policy) !== JSON.stringify(entry.policy)) throw new Error('Immutable storage policy receipt is missing, changed or belongs to another owner.');
    }
    return { status: 'present', target, value, sha256: read.hash, policy: entry?.policy || { ...COMMAND_PROBE_POLICY_DEFAULTS },
      source: entry ? 'machine-local-reviewed-policy' : 'legacy-defaults', policyId: entry?.selectionId || null, mutationPerformed: false };
  } catch (error) {
    if (!locatorRead && error.code === 'ENOENT') return { status: 'missing', target,
      value: { schemaVersion: STORAGE_POLICY_VERSION, kind: 'pairofcleats-storage-policy-locator', policies: {} },
      sha256: null, policy: { ...COMMAND_PROBE_POLICY_DEFAULTS }, source: 'legacy-defaults', policyId: null, mutationPerformed: false };
    return { status: 'invalid', target, value: null, sha256: null, policy: null, policyId: null,
      source: 'invalid-policy-preserve-cache-bytes', mutationPerformed: false,
      error: { code: error.code || 'ERR_STORAGE_POLICY', message: error.message } };
  }
};

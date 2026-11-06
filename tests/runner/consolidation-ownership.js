import fsPromises from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OWNERSHIP_PATH = path.join('docs', 'testing', 'consolidation-ownership.json');

const normalizeId = (value) => String(value || '').trim().replace(/\\/g, '/');

export const normalizeOwnershipPayload = (payload) => {
  const suites = Array.isArray(payload?.suites) ? payload.suites : [];
  return {
    schemaVersion: Number(payload?.schemaVersion) || 0,
    consumerWitnesses: payload?.consumerWitnesses ?? [],
    suites: suites.map((entry) => ({
      id: normalizeId(entry?.id),
      suiteCategory: String(entry?.suiteCategory || '').trim(),
      coverageOwner: String(entry?.coverageOwner || '').trim(),
      replacementIds: Array.from(new Set(
        (Array.isArray(entry?.replacementIds) ? entry.replacementIds : [])
          .map((item) => normalizeId(item))
          .filter(Boolean)
      )).sort(),
      overlapPolicy: String(entry?.overlapPolicy || '').trim(),
      matrixStrategy: String(entry?.matrixStrategy || '').trim(),
      processIsolationRequired: Boolean(entry?.processIsolationRequired),
      notes: String(entry?.notes || '').trim()
    })).filter((entry) => entry.id)
  };
};

export const validateOwnershipPayload = (payload) => {
  const errors = [];
  if (payload.schemaVersion !== 1) {
    errors.push('expected schemaVersion=1');
  }

  const suiteIds = new Set();
  const replacementOwners = new Map();
  for (const entry of payload.suites) {
    if (!entry.id) {
      errors.push('ownership entry missing id');
      continue;
    }
    if (suiteIds.has(entry.id)) {
      errors.push(`duplicate owner suite id: ${entry.id}`);
    }
    suiteIds.add(entry.id);
    if (!entry.suiteCategory) {
      errors.push(`ownership entry ${entry.id} missing suiteCategory`);
    }
    if (!entry.coverageOwner) {
      errors.push(`ownership entry ${entry.id} missing coverageOwner`);
    }
    if (!entry.overlapPolicy) {
      errors.push(`ownership entry ${entry.id} missing overlapPolicy`);
    }
    for (const replacementId of entry.replacementIds) {
      const existingOwner = replacementOwners.get(replacementId);
      if (existingOwner && existingOwner !== entry.id) {
        errors.push(`replacement id ${replacementId} claimed by multiple owner suites: ${existingOwner}, ${entry.id}`);
        continue;
      }
      replacementOwners.set(replacementId, entry.id);
    }
  }

  const witnesses = payload.consumerWitnesses ?? [];
  const witnessKeys = new Set();
  const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_.:-]{0,199}$/.test(value);
  const sourcePath = value => label(value) && !value.includes(':')
    && value.split('/').every(part => part !== '.' && part !== '..');
  const boundedList = (value, check, limit) => Array.isArray(value) && value.length > 0 && value.length <= limit
    && new Set(value).size === value.length && value.every(check);
  if (!Array.isArray(witnesses) || witnesses.length > 4096) errors.push('invalid bounded consumerWitnesses inventory');
  else for (const witness of witnesses) {
    const fields = ['contractId', 'consumerId', 'caseId', 'sourcePaths', 'requiredScope', 'expectedOracleKind', 'negativeCaseIds'];
    if (!witness || typeof witness !== 'object' || Array.isArray(witness)
      || Object.keys(witness).length !== fields.length || fields.some(field => !Object.hasOwn(witness, field))
      || !label(witness.contractId) || !label(witness.consumerId) || !label(witness.caseId)
      || !boundedList(witness.sourcePaths, sourcePath, 16)
      || !boundedList(witness.negativeCaseIds, label, 32)
      || !boundedList(witness.requiredScope, value => typeof value === 'string' && value.length > 0 && value.length <= 256, 16)
      || !['physical-identity', 'independent-values', 'original-resource-settlement', 'independent-content'].includes(witness.expectedOracleKind)) {
      errors.push('invalid consumer witness declaration'); continue;
    }
    const key = JSON.stringify([witness.contractId, witness.consumerId, witness.caseId]);
    if (witnessKeys.has(key)) errors.push(`duplicate consumer witness: ${key}`);
    witnessKeys.add(key);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

export const loadConsolidationOwnership = async ({ root = process.cwd(), ownershipPath, readText = null } = {}) => {
  const resolvedPath = ownershipPath
    ? path.resolve(root, ownershipPath)
    : path.join(root, DEFAULT_OWNERSHIP_PATH);
  const raw = await (readText ? readText(resolvedPath) : fsPromises.readFile(resolvedPath, 'utf8'));
  const parsed = JSON.parse(raw);
  const payload = normalizeOwnershipPayload(parsed);
  const validation = validateOwnershipPayload(payload);
  if (!validation.valid) {
    const error = new Error(`Invalid consolidation ownership payload: ${validation.errors.join('; ')}`);
    error.code = 'ERR_INVALID_CONSOLIDATION_OWNERSHIP';
    throw error;
  }
  return {
    path: resolvedPath,
    payload
  };
};

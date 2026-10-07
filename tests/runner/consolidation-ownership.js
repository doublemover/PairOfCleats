import fsPromises from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OWNERSHIP_PATH = path.join('docs', 'testing', 'consolidation-ownership.json');

const normalizeId = (value) => String(value || '').trim().replace(/\\/g, '/');

export const normalizeOwnershipPayload = (payload) => {
  const suites = Array.isArray(payload?.suites) ? payload.suites : [];
  return {
    schemaVersion: Number(payload?.schemaVersion) || 0,
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

  return {
    valid: errors.length === 0,
    errors
  };
};

export const loadConsolidationOwnership = async ({ root = process.cwd(), ownershipPath } = {}) => {
  const resolvedPath = ownershipPath
    ? path.resolve(root, ownershipPath)
    : path.join(root, DEFAULT_OWNERSHIP_PATH);
  const raw = await fsPromises.readFile(resolvedPath, 'utf8');
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

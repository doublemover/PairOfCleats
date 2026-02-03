import {
  buildBaseRecord,
  ensureRecordId,
  normalizeExposure,
  normalizeSeverity,
  normalizeStringArray,
  pickFirst,
  toIso
} from './helpers.js';

/**
 * Normalize a generic record payload into the triage record schema.
 * @param {object} raw
 * @param {object} meta
 * @param {{repoRoot:string,storeRawPayload:boolean}} options
 * @returns {object}
 */
export function normalizeGeneric(raw, meta = {}, options = {}) {
  const warnings = [];
  const source = raw?.source || 'generic';
  const recordType = raw?.recordType || 'finding';
  const createdAt = raw?.createdAt || null;
  const updatedAt = raw?.updatedAt || raw?.createdAt || null;

  const baseRecord = buildBaseRecord({
    source,
    recordType,
    meta,
    repoRoot: options.repoRoot,
    createdAt,
    updatedAt
  });
  const rawPayload = raw && typeof raw === 'object' ? raw : {};
  const record = { ...rawPayload, ...baseRecord };
  if (rawPayload.recordId) record.recordId = rawPayload.recordId;
  const normalizedCreatedAt = toIso(record.createdAt) || baseRecord.createdAt;
  const normalizedUpdatedAt = toIso(record.updatedAt) || normalizedCreatedAt || baseRecord.updatedAt;
  record.createdAt = normalizedCreatedAt;
  record.updatedAt = normalizedUpdatedAt;

  const vulnId = pickFirst(record.vuln?.vulnId, record.vulnId, record.vulnerabilityId);
  const cve = pickFirst(record.vuln?.cve, record.cve);
  const severity = normalizeSeverity(pickFirst(record.vuln?.severity, record.severity));
  if (vulnId || record.title || record.description) {
    record.vuln = {
      vulnId,
      cve: cve || null,
      title: pickFirst(record.vuln?.title, record.title) || '',
      description: pickFirst(record.vuln?.description, record.description) || '',
      severity,
      cvss: record.vuln?.cvss || record.cvss || null,
      cwe: normalizeStringArray(record.vuln?.cwe || record.cwe || record.cwes),
      references: normalizeStringArray(record.vuln?.references || record.references)
    };
  }

  if (!record.package && (record.packageName || record.packageEcosystem)) {
    record.package = {
      name: record.packageName || null,
      ecosystem: record.packageEcosystem || null,
      installedVersion: record.installedVersion || null,
      affectedRange: record.affectedRange || null,
      fixedVersion: record.fixedVersion || null,
      manifestPath: record.manifestPath || null,
      purl: record.purl || null
    };
  }

  if (!record.asset && (record.assetId || record.assetType)) {
    record.asset = {
      assetId: record.assetId || null,
      assetType: record.assetType || null,
      account: record.account || null,
      region: record.region || null,
      tags: record.tags || null
    };
  }

  const exposure = normalizeExposure(raw, meta);
  if (exposure) record.exposure = exposure;

  const stableKey = pickFirst(record.stableKey, record.recordId, vulnId, record.package?.name, record.asset?.assetId);
  ensureRecordId(record, record.source, stableKey, raw, warnings);

  if (options.storeRawPayload) record.raw = raw;
  if (warnings.length) record.parseWarnings = warnings;

  return record;
}

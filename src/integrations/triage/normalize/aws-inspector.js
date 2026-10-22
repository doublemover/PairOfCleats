import {
  buildStableKeyCandidate,
  buildBaseRecord,
  ensureRecordId,
  normalizeExposure,
  normalizeReferences,
  normalizeSeverity,
  normalizeStringArray,
  pickFirst,
  toIso
} from './helpers.js';
import { sha1 } from '../../../shared/hash.js';
import { stableStringify } from '../../../shared/stable-json.js';

/**
 * Normalize an AWS Inspector finding into the triage record schema.
 * @param {object} raw
 * @param {object} meta
 * @param {{repoRoot:string,storeRawPayload:boolean}} options
 * @returns {object}
 */
export function normalizeAwsInspector(raw, meta = {}, options = {}) {
  const warnings = [];
  const awsDate = (value, field) => {
    if (value === null || value === undefined || value === '') return null;
    // AWS wire numeric timestamps are Unix seconds, including fractional seconds.
    // Numeric strings are deliberately unsupported; ISO/offset strings stay valid.
    const candidate = typeof value === 'number' ? value * 1000
      : typeof value === 'string' && !/^[+-]?[\d.]+$/.test(value) ? value : NaN;
    const date = new Date(candidate);
    if (!Number.isFinite(date.getTime())) { warnings.push(`invalid AWS timestamp: ${field}`); return null; }
    return date.toISOString();
  };
  const createdAt = awsDate(raw?.firstObservedAt, 'firstObservedAt') || toIso(raw?.createdAt) || toIso(raw?.created_at);
  const updatedAt = awsDate(raw?.lastObservedAt, 'lastObservedAt') || toIso(raw?.updatedAt) || toIso(raw?.updated_at) || createdAt;

  const record = buildBaseRecord({
    source: 'aws_inspector',
    recordType: 'finding',
    meta,
    repoRoot: options.repoRoot,
    createdAt,
    updatedAt
  });

  const details = raw?.packageVulnerabilityDetails
    || raw?.package_vulnerability_details
    || raw?.vulnerabilityDetails
    || {};

  const vulnId = pickFirst(details.vulnerabilityId, raw?.vulnerabilityId, raw?.vulnId, raw?.title, raw?.id);
  if (!vulnId) warnings.push('missing vulnId');
  const cveCandidate = pickFirst(details.cveId, details.cve, raw?.cve, raw?.cveId);
  const cve = (vulnId && vulnId.startsWith('CVE-')) ? vulnId : cveCandidate;

  const title = pickFirst(raw?.title, details.title, vulnId) || '';
  const description = pickFirst(raw?.description, details.description) || '';
  const severity = normalizeSeverity(pickFirst(raw?.severity, details.severity));

  const cvssRaw = details.cvss || raw?.cvss || {};
  const cvssScore = Number(cvssRaw.score ?? cvssRaw.baseScore);
  const hasScore = Number.isFinite(cvssScore);
  const cvss = (hasScore || cvssRaw.vector || cvssRaw.vectorString || cvssRaw.vector_string || cvssRaw.version)
    ? {
      score: hasScore ? cvssScore : null,
      vector: pickFirst(cvssRaw.vector, cvssRaw.vectorString, cvssRaw.vector_string),
      version: pickFirst(cvssRaw.version, cvssRaw.cvss_version, cvssRaw.cvssVersion)
    }
    : null;

  const cwe = normalizeStringArray(details.cwe || details.cwes || raw?.cwe || raw?.cwes);
  const references = normalizeReferences(details.referenceUrls || details.references || raw?.references);

  record.vuln = {
    vulnId,
    cve: cve || null,
    title,
    description,
    severity,
    cvss,
    cwe,
    references
  };

  const suppliedPackages = details.vulnerablePackages ?? details.vulnerable_packages ?? details.packages;
  const packages = suppliedPackages === undefined
    ? [details.package || (raw?.package && typeof raw.package === 'object' ? raw.package : {
      name: pickFirst(raw?.packageName, raw?.package), ecosystem: raw?.ecosystem,
      installedVersion: raw?.installedVersion, affectedRange: raw?.affectedRange, purl: raw?.purl
    })].filter(value => value && typeof value === 'object')
    : Array.isArray(suppliedPackages) ? suppliedPackages : [];
  if (suppliedPackages !== undefined && !Array.isArray(suppliedPackages)) warnings.push('malformed affected packages collection');
  const normalizedPackages = [];
  for (const [index, pkg] of packages.entries()) {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) { warnings.push(`malformed affected package at ${index}`); continue; }
    const name = pickFirst(pkg.name, pkg.packageName);
    if (!name) { warnings.push(`missing affected package name at ${index}`); continue; }
    const nativeFix = pickFirst(pkg.fixedInVersion);
    const legacyFix = pickFirst(pkg.fixedVersion);
    if (nativeFix && legacyFix && nativeFix !== legacyFix) warnings.push(`conflicting fixed version for package ${name}; fixedInVersion takes precedence`);
    normalizedPackages.push({
      name, ecosystem: pickFirst(pkg.packageManager, pkg.ecosystem),
      installedVersion: pickFirst(pkg.version, pkg.installedVersion),
      affectedRange: pickFirst(pkg.vulnerableVersionRange, pkg.affectedRange, details.vulnerableVersionRange, details.affectedRange),
      // Finding-level legacy aliases apply only to a singleton, never across packages.
      fixedVersion: nativeFix || legacyFix || (packages.length === 1 ? pickFirst(details.fixedVersion, raw?.fixedVersion) : null),
      manifestPath: pickFirst(pkg.filePath, pkg.manifestPath), purl: pickFirst(pkg.purl),
      sourceLayerHash: pickFirst(pkg.sourceLayerHash), architecture: pickFirst(pkg.arch),
      epoch: pkg.epoch ?? null, release: pickFirst(pkg.release)
    });
  }
  normalizedPackages.sort((a, b) => {
    const left = stableStringify(a), right = stableStringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const occurrences = new Map();
  record.packages = normalizedPackages.map(pkg => {
    const identity = sha1(stableStringify(pkg));
    const ordinal = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, ordinal);
    return { ...pkg, occurrenceId: `${identity}:${ordinal}` };
  });
  // Compatibility representative is deterministic; packages is the full authority.
  record.package = record.packages[0] || null;
  if (!record.packages.length && packages.length) warnings.push('no valid affected packages retained');

  const resource = Array.isArray(raw?.resources) ? raw.resources[0] : (raw?.resource || {});
  const assetId = pickFirst(resource.id, resource.resourceId, raw?.resourceId, raw?.assetId, raw?.instanceId, raw?.imageId);
  const assetType = pickFirst(resource.type, resource.resourceType, raw?.assetType);
  const account = pickFirst(raw?.awsAccountId, raw?.accountId, resource.accountId);
  const region = pickFirst(raw?.region, raw?.awsRegion, resource.region);

  if (assetId || assetType || account || region || resource.tags || raw?.tags) {
    record.asset = {
      assetId: assetId || null,
      assetType: assetType || null,
      account: account || null,
      region: region || null,
      tags: resource.tags || raw?.tags || null
    };
  }

  const exposure = normalizeExposure(raw, meta);
  if (exposure) record.exposure = exposure;

  let stableKey = buildStableKeyCandidate('findingArn', raw?.findingArn)
    || buildStableKeyCandidate('arn', raw?.arn)
    || buildStableKeyCandidate('id', raw?.id);
  if (!stableKey && vulnId && assetId) {
    stableKey = buildStableKeyCandidate('vulnId-assetId', `${vulnId}:${assetId}`);
  }

  ensureRecordId(record, record.source, stableKey, raw, warnings);

  if (options.storeRawPayload) record.raw = raw;
  if (warnings.length) record.parseWarnings = warnings;

  return record;
}

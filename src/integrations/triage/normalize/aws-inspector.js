import {
  buildBaseRecord,
  ensureRecordId,
  normalizeExposure,
  normalizeReferences,
  normalizeSeverity,
  normalizeStringArray,
  pickFirst,
  toIso
} from './helpers.js';

/**
 * Normalize an AWS Inspector finding into the triage record schema.
 * @param {object} raw
 * @param {object} meta
 * @param {{repoRoot:string,storeRawPayload:boolean}} options
 * @returns {object}
 */
export function normalizeAwsInspector(raw, meta = {}, options = {}) {
  const warnings = [];
  const createdAt = toIso(raw?.firstObservedAt) || toIso(raw?.createdAt) || toIso(raw?.created_at) || null;
  const updatedAt = toIso(raw?.lastObservedAt) || toIso(raw?.updatedAt) || toIso(raw?.updated_at) || createdAt;

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

  const packages = details.vulnerablePackages || details.vulnerable_packages || details.packages || [];
  const pkg = Array.isArray(packages) && packages.length
    ? packages[0]
    : (details.package || raw?.package || {});
  const packageName = pickFirst(pkg.name, pkg.packageName, raw?.packageName, raw?.package);
  if (!packageName) warnings.push('missing package name');
  const packageEcosystem = pickFirst(pkg.packageManager, pkg.ecosystem, raw?.ecosystem);
  const installedVersion = pickFirst(pkg.version, pkg.installedVersion, raw?.installedVersion);
  const affectedRange = pickFirst(details.vulnerableVersionRange, details.affectedRange, raw?.affectedRange);
  const fixedVersion = pickFirst(pkg.fixedVersion, details.fixedVersion, raw?.fixedVersion);

  if (packageName || packageEcosystem || installedVersion || affectedRange || fixedVersion) {
    record.package = {
      name: packageName || null,
      ecosystem: packageEcosystem || null,
      installedVersion: installedVersion || null,
      affectedRange: affectedRange || null,
      fixedVersion: fixedVersion || null,
      manifestPath: null,
      purl: pickFirst(pkg.purl, raw?.purl)
    };
  }

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

  let stableKey = pickFirst(raw?.findingArn, raw?.arn, raw?.id);
  if (!stableKey && vulnId && assetId) stableKey = `${vulnId}:${assetId}`;

  ensureRecordId(record, record.source, stableKey, raw, warnings);

  if (options.storeRawPayload) record.raw = raw;
  if (warnings.length) record.parseWarnings = warnings;

  return record;
}

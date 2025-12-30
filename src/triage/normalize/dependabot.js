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
 * Normalize a Dependabot finding into the triage record schema.
 * @param {object} raw
 * @param {object} meta
 * @param {{repoRoot:string,storeRawPayload:boolean}} options
 * @returns {object}
 */
export function normalizeDependabot(raw, meta = {}, options = {}) {
  const warnings = [];
  const createdAt = toIso(raw?.created_at) || toIso(raw?.createdAt) || toIso(raw?.created) || null;
  const updatedAt = toIso(raw?.updated_at) || toIso(raw?.updatedAt) || toIso(raw?.updated) || createdAt;

  const record = buildBaseRecord({
    source: 'dependabot',
    recordType: 'finding',
    meta,
    repoRoot: options.repoRoot,
    createdAt,
    updatedAt
  });

  const advisory = raw?.security_advisory || raw?.securityAdvisory || {};
  const vulnDetails = raw?.security_vulnerability || raw?.securityVulnerability || {};

  const cve = pickFirst(advisory.cve_id, advisory.cveId, raw?.cve, raw?.cveId);
  const ghsa = pickFirst(advisory.ghsa_id, advisory.ghsaId, raw?.ghsaId, raw?.ghsa_id);
  const vulnId = pickFirst(cve, ghsa, raw?.vulnId, raw?.vulnerabilityId, advisory.id, vulnDetails.id);
  if (!vulnId) warnings.push('missing vulnId');

  const title = pickFirst(advisory.summary, advisory.title, raw?.title) || '';
  const description = pickFirst(advisory.description, raw?.description) || '';
  const severity = normalizeSeverity(pickFirst(advisory.severity, vulnDetails.severity, raw?.severity));

  const cvssRaw = advisory.cvss || raw?.cvss || {};
  const cvssScore = Number(cvssRaw.score ?? cvssRaw.baseScore);
  const cvss = (cvssScore || cvssRaw.vector_string || cvssRaw.vectorString || cvssRaw.vector || cvssRaw.version)
    ? {
      score: Number.isFinite(cvssScore) ? cvssScore : null,
      vector: pickFirst(cvssRaw.vector_string, cvssRaw.vectorString, cvssRaw.vector),
      version: pickFirst(cvssRaw.version, cvssRaw.cvss_version, cvssRaw.cvssVersion)
    }
    : null;

  const cwe = normalizeStringArray(advisory.cwes || advisory.cwe || raw?.cwe || raw?.cwes);
  const references = normalizeReferences(advisory.references || raw?.references);

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

  const depPackage = raw?.dependency?.package || vulnDetails.package || raw?.package || {};
  const packageName = pickFirst(depPackage.name, raw?.packageName, raw?.package);
  if (!packageName) warnings.push('missing package name');
  const packageEcosystem = pickFirst(depPackage.ecosystem, raw?.ecosystem);
  const manifestPath = pickFirst(raw?.dependency?.manifest_path, raw?.dependency?.manifestPath, raw?.manifest_path, raw?.manifestPath);
  const installedVersion = pickFirst(raw?.dependency?.version, raw?.dependency?.manifest_version, raw?.current_version, raw?.installedVersion);
  const affectedRange = pickFirst(vulnDetails.vulnerable_version_range, vulnDetails.vulnerableVersionRange, raw?.affectedRange);
  const fixedVersion = pickFirst(
    vulnDetails.first_patched_version?.identifier,
    vulnDetails.firstPatchedVersion?.identifier,
    raw?.fixedVersion
  );
  const purl = pickFirst(depPackage.purl, raw?.purl);

  if (packageName || packageEcosystem || installedVersion || affectedRange || fixedVersion || manifestPath || purl) {
    record.package = {
      name: packageName || null,
      ecosystem: packageEcosystem || null,
      installedVersion: installedVersion || null,
      affectedRange: affectedRange || null,
      fixedVersion: fixedVersion || null,
      manifestPath: manifestPath || null,
      purl: purl || null
    };
  }

  const exposure = normalizeExposure(raw, meta);
  if (exposure) record.exposure = exposure;

  let stableKey = pickFirst(raw?.alert?.id, raw?.alertId, raw?.id, raw?.number);
  if (!stableKey && ghsa && packageName) {
    stableKey = `${ghsa}:${packageName}:${manifestPath || ''}`;
  }
  if (!stableKey && vulnId && packageName) {
    stableKey = `${vulnId}:${packageName}:${manifestPath || ''}`;
  }

  ensureRecordId(record, record.source, stableKey, raw, warnings);

  if (options.storeRawPayload) record.raw = raw;
  if (warnings.length) record.parseWarnings = warnings;

  return record;
}

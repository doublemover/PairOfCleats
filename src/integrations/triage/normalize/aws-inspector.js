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

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const cvssVersion = value => {
  const match = typeof value === 'string' && /^(\d+)(?:\.(\d+))?$/.exec(value);
  const parts = match ? [Number(match[1]), Number(match[2] || 0)] : [-1, -1];
  return parts.every(Number.isSafeInteger) ? parts : [-1, -1];
};
const compareCvss = (left, right) => {
  const l = cvssVersion(left.version), r = cvssVersion(right.version);
  return (right.score ?? -1) - (left.score ?? -1) || r[0] - l[0] || r[1] - l[1]
    || compareText(left.source || '', right.source || '') || compareText(left.vector || '', right.vector || '')
    || compareText(left.version || '', right.version || '');
};

/** Inspector v2 supplies native score entries. Keep the canonical single-score
 * projection deterministic without array-order authority or a new record shape.
 * Original alternatives remain available under existing raw-payload retention.
 */
const normalizeCvss = (input, warnings) => {
  if (input == null) return null;
  const native = Array.isArray(input), entries = native ? input : [input];
  let selected = null, valid = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`malformed AWS CVSS entry at ${index}`); continue;
    }
    const rawScore = native ? entry.baseScore : entry.score ?? entry.baseScore;
    const candidate = typeof rawScore === 'number' ? rawScore
      : !native && typeof rawScore === 'string' && rawScore.trim() ? Number(rawScore) : NaN;
    const score = Number.isFinite(candidate) && candidate >= 0 && candidate <= 10 ? candidate : null;
    const vector = pickFirst(entry.scoringVector, entry.vector, entry.vectorString, entry.vector_string);
    const version = pickFirst(entry.version, entry.cvss_version, entry.cvssVersion);
    const source = pickFirst(entry.source);
    if (native && (score === null || typeof entry.scoringVector !== 'string' || !entry.scoringVector.trim()
      || typeof entry.version !== 'string' || !entry.version.trim() || typeof entry.source !== 'string' || !entry.source.trim())) {
      warnings.push(`malformed AWS CVSS entry at ${index}`); continue;
    }
    if (!native && rawScore != null && score === null) warnings.push('invalid legacy AWS CVSS score');
    if (score === null && !vector && !version) continue;
    const current = { score, vector, version, source }; valid++;
    if (!selected || compareCvss(current, selected) < 0) selected = current;
  }
  if (!selected) return null;
  if (native && valid > 1) warnings.push(`AWS CVSS max-base-score.v1 selected ${selected.source} version ${selected.version} from ${valid} valid entries; canonical cvss projects one score`);
  return { score: selected.score, vector: selected.vector, version: selected.version };
};

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

  const cvss = normalizeCvss(details.cvss ?? raw?.cvss, warnings);

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

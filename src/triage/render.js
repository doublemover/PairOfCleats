/**
 * Render a triage record to a markdown view.
 * @param {object} record
 * @returns {string}
 */
export function renderRecordMarkdown(record) {
  const lines = [];
  const recordType = record?.recordType || 'record';
  const vulnId = record?.vuln?.vulnId || record?.vulnId || record?.recordId || '';
  const packageName = record?.package?.name || '';
  const packageVersion = record?.package?.installedVersion || '';
  const service = record?.service || '';
  const env = record?.env || '';
  const severity = record?.vuln?.severity || '';
  const decisionStatus = record?.decision?.status || '';

  const headerParts = [capitalize(recordType)];
  if (decisionStatus) headerParts.push(decisionStatus);
  if (vulnId) headerParts.push(vulnId);
  if (packageName) headerParts.push(`(${packageName}${packageVersion ? `@${packageVersion}` : ''})`);
  if (service || env) headerParts.push(`[${[service, env].filter(Boolean).join(' / ')}]`);
  if (severity) headerParts.push(`[${severity}]`);
  lines.push(`# ${headerParts.join(' ')}`);
  lines.push('');

  lines.push('## Summary');
  addLine(lines, 'Title', record?.vuln?.title || record?.title);
  addLine(lines, 'Severity', severity);
  addLine(lines, 'Description', record?.vuln?.description || record?.description);
  lines.push('');

  lines.push('## Environment');
  addLine(lines, 'Service', service);
  addLine(lines, 'Env', env);
  addLine(lines, 'Team', record?.team);
  addLine(lines, 'Owner', record?.owner);
  addLine(lines, 'Repo', record?.repo);
  lines.push('');

  const exposureLines = [];
  const exposure = record?.exposure;
  if (exposure && typeof exposure === 'object') {
    addLine(exposureLines, 'Internet exposed', exposure.internetExposed);
    addLine(exposureLines, 'Public endpoint', exposure.publicEndpoint);
    addLine(exposureLines, 'Data sensitivity', exposure.dataSensitivity);
    addLine(exposureLines, 'Business criticality', exposure.businessCriticality);
    addLine(exposureLines, 'Compensating controls', exposure.compensatingControls);
  }
  if (exposureLines.length) {
    lines.push('## Exposure');
    lines.push(...exposureLines);
    lines.push('');
  }

  if (record?.package) {
    lines.push('## Package');
    addLine(lines, 'Name', record.package.name);
    addLine(lines, 'Ecosystem', record.package.ecosystem);
    addLine(lines, 'Installed version', record.package.installedVersion);
    addLine(lines, 'Affected range', record.package.affectedRange);
    addLine(lines, 'Fixed version', record.package.fixedVersion);
    addLine(lines, 'Manifest path', record.package.manifestPath);
    addLine(lines, 'PURL', record.package.purl);
    lines.push('');
  }

  if (record?.asset) {
    lines.push('## Asset');
    addLine(lines, 'Asset ID', record.asset.assetId);
    addLine(lines, 'Asset type', record.asset.assetType);
    addLine(lines, 'Account', record.asset.account);
    addLine(lines, 'Region', record.asset.region);
    if (record.asset.tags) {
      lines.push(`- Tags: ${formatValue(record.asset.tags)}`);
    }
    lines.push('');
  }

  if (record?.decision) {
    lines.push('## Decision');
    addLine(lines, 'Status', record.decision.status);
    addLine(lines, 'Justification', record.decision.justification);
    addLine(lines, 'Reviewer', record.decision.reviewer);
    addLine(lines, 'Expires', record.decision.expiresAt);
    if (Array.isArray(record.decision.justificationCodes) && record.decision.justificationCodes.length) {
      lines.push(`- Codes: ${record.decision.justificationCodes.join(', ')}`);
    }
    if (Array.isArray(record.decision.evidenceRefs) && record.decision.evidenceRefs.length) {
      lines.push('- Evidence:');
      for (const ref of record.decision.evidenceRefs) {
        lines.push(`  - ${ref}`);
      }
    }
    lines.push('');
  }

  const refs = record?.vuln?.references || [];
  if (Array.isArray(refs) && refs.length) {
    lines.push('## References');
    for (const ref of refs) {
      lines.push(`- ${ref}`);
    }
    lines.push('');
  }

  if (Array.isArray(record?.parseWarnings) && record.parseWarnings.length) {
    lines.push('## Parse warnings');
    for (const warning of record.parseWarnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (record?.raw) {
    lines.push('## Raw');
    lines.push('```json');
    lines.push(JSON.stringify(record.raw, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Add a markdown bullet if the value is present.
 * @param {string[]} lines
 * @param {string} label
 * @param {unknown} value
 */
function addLine(lines, label, value) {
  if (value === null || value === undefined) return;
  const formatted = formatValue(value);
  if (!formatted) return;
  lines.push(`- ${label}: ${formatted}`);
}

/**
 * Render a value as a string.
 * @param {unknown} value
 * @returns {string}
 */
function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

/**
 * Capitalize a label.
 * @param {string} value
 * @returns {string}
 */
function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

import { compareGraphNodes } from '../../graph/ordering.js';

const formatNodeRef = (ref) => {
  if (!ref || typeof ref !== 'object') return 'unknown';
  if (ref.type === 'chunk') return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol') return `symbol:${ref.symbolId}`;
  if (ref.type === 'file') return `file:${ref.path}`;
  return 'unknown';
};

const formatSeed = (seed) => {
  if (!seed || typeof seed !== 'object') return 'unknown';
  if (seed.type) return formatNodeRef(seed);
  if ('status' in seed) {
    const status = seed.status || 'unresolved';
    const candidate = Array.isArray(seed.candidates) ? seed.candidates[0] : null;
    if (candidate?.chunkUid) return `${status}:chunk:${candidate.chunkUid}`;
    if (candidate?.symbolId) return `${status}:symbol:${candidate.symbolId}`;
    if (candidate?.path) return `${status}:file:${candidate.path}`;
    return status;
  }
  return 'unknown';
};

const formatWitnessPath = (path) => {
  if (!path || !Array.isArray(path.nodes)) return null;
  return path.nodes.map(formatNodeRef).join(' -> ');
};

const formatTruncation = (record) => {
  if (!record) return '';
  const pieces = [`${record.cap}`];
  if (record.limit != null) pieces.push(`limit=${JSON.stringify(record.limit)}`);
  if (record.observed != null) pieces.push(`observed=${JSON.stringify(record.observed)}`);
  if (record.omitted != null) pieces.push(`omitted=${JSON.stringify(record.omitted)}`);
  return pieces.join(' ');
};

export const renderGraphImpact = (payload) => {
  const lines = [];
  lines.push('Graph Impact');
  lines.push(`Seed: ${formatSeed(payload?.seed)}`);
  lines.push(`Direction: ${payload?.direction || 'downstream'}`);
  lines.push(`Depth: ${payload?.depth ?? 0}`);
  lines.push('');
  lines.push('Impacted:');
  const impacted = Array.isArray(payload?.impacted) ? payload.impacted.slice() : [];
  impacted.sort((a, b) => compareGraphNodes(
    { ref: a?.ref, distance: a?.distance },
    { ref: b?.ref, distance: b?.distance }
  ));
  if (!impacted.length) {
    lines.push('- (none)');
  } else {
    for (const entry of impacted) {
      const ref = formatNodeRef(entry?.ref);
      const distance = Number.isFinite(entry?.distance) ? entry.distance : '?';
      lines.push(`- ${ref} (distance ${distance})`);
      const witness = formatWitnessPath(entry?.witnessPath);
      if (witness) {
        lines.push(`  path: ${witness}`);
      }
    }
  }

  const truncation = Array.isArray(payload?.truncation) ? payload.truncation : [];
  if (truncation.length) {
    lines.push('');
    lines.push('Truncation:');
    for (const record of truncation) {
      lines.push(`- ${formatTruncation(record)}`);
    }
  }

  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  if (warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of warnings) {
      const key = warning?.code ? `${warning.code}: ` : '';
      lines.push(`- ${key}${warning?.message || ''}`.trim());
    }
  }
  return lines.join('\n');
};

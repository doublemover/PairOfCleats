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

export const renderGraphImpact = (payload) => {
  const lines = [];
  lines.push('Graph Impact');
  lines.push(`Seed: ${formatSeed(payload?.seed)}`);
  lines.push(`Direction: ${payload?.direction || 'downstream'}`);
  lines.push(`Depth: ${payload?.depth ?? 0}`);
  lines.push('');
  lines.push('Impacted:');
  const impacted = Array.isArray(payload?.impacted) ? payload.impacted : [];
  if (!impacted.length) {
    lines.push('- (none)');
    return lines.join('\n');
  }
  for (const entry of impacted) {
    const ref = formatNodeRef(entry?.ref);
    const distance = Number.isFinite(entry?.distance) ? entry.distance : '?';
    lines.push(`- ${ref} (distance ${distance})`);
    const witness = formatWitnessPath(entry?.witnessPath);
    if (witness) {
      lines.push(`  path: ${witness}`);
    }
  }
  return lines.join('\n');
};

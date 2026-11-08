function pinnedGeneration(value) {
  if (!value || typeof value.baseBuildId !== 'string' || !value.baseBuildId
    || value.baseBuildId.length > 512 || value.semanticRevision !== 0
    || ['.', '..'].includes(value.baseBuildId) || /[\\/:\0]/.test(value.baseBuildId)) return null;
  return { baseBuildId: value.baseBuildId, semanticRevision: 0 };
}

/** The typed semantic section is authoritative. Index paths, Git revisions,
 * search signatures and runtime attempts are never substituted for it. */
function generationFromContextPack(payload, expectedRepoRoot) {
  const semantic = payload?.semantic;
  if (!semantic || semantic.schemaVersion !== 1 || semantic.repoRoot !== expectedRepoRoot) return null;
  const generation = pinnedGeneration(semantic.generation);
  if (!generation) return null;
  for (const page of [semantic.discovery, semantic.detail, semantic.trace]) {
    if (page && (page.generation?.baseBuildId !== generation.baseBuildId || page.generation?.semanticRevision !== 0)) {
      throw new Error('Canonical semantic context contains conflicting generation evidence.');
    }
  }
  for (const item of semantic.followUps || []) {
    if (item.request?.repoRoot !== expectedRepoRoot || item.request?.generation?.baseBuildId !== generation.baseBuildId
      || item.request?.generation?.semanticRevision !== 0) throw new Error('Canonical semantic follow-up scope differs from discovery.');
  }
  return { generation, status: semantic.status, warnings: [...(semantic.warnings || [])],
    selector: semantic.selector || null, source: 'canonical-context-pack-semantic-section' };
}

function contextDiscoveryRequest(repo, seed) {
  if (!repo || typeof seed !== 'string' || !seed || seed.length > 4096) throw new Error('A selected repository and bounded source/chunk seed are required.');
  return { repo, seed, hops: 0, includeSemantic: true, includeGraph: false, includeTypes: false,
    includeRisk: false, includeImports: false, includeUsages: false, includeCallersCallees: false,
    maxBytes: 8192, maxNodes: 8, maxEdges: 0, maxCandidates: 8, maxWorkUnits: 64, maxWallClockMs: 250 };
}

function contextDiscoveryCliArgs(repo, seed) {
  const request = contextDiscoveryRequest(repo, seed);
  return ['context-pack', '--json', ...Object.entries(request).flatMap(([key, value]) => [`--${key}`, String(value)])];
}

module.exports = { pinnedGeneration, generationFromContextPack, contextDiscoveryRequest, contextDiscoveryCliArgs };

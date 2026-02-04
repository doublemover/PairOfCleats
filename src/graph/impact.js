import { compareStrings } from '../shared/sort.js';
import { normalizeDepth } from '../shared/limits.js';
import { resolveProvenance } from '../shared/provenance.js';
import { createTruncationRecorder } from '../shared/truncation.js';
import { compareGraphNodes, compareWitnessPaths, nodeKey } from './ordering.js';
import { buildGraphNeighborhood } from './neighborhood.js';

const normalizeDirection = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'upstream' || raw === 'downstream') return raw;
  return 'downstream';
};

const normalizePaths = (paths) => {
  if (!paths) return [];
  const list = Array.isArray(paths) ? paths : [paths];
  const unique = Array.from(new Set(list.map((entry) => String(entry || '').trim()).filter(Boolean)));
  unique.sort(compareStrings);
  return unique;
};

const buildSeedEnvelope = ({ paths, maxCandidates, recordTruncation }) => {
  if (!paths.length) return null;
  let candidates = paths;
  if (maxCandidates != null && candidates.length > maxCandidates) {
    recordTruncation('maxCandidates', {
      limit: maxCandidates,
      observed: candidates.length,
      omitted: candidates.length - maxCandidates
    });
    candidates = candidates.slice(0, maxCandidates);
  }
  if (candidates.length === 1) {
    return {
      seedRef: { type: 'file', path: candidates[0] },
      seeds: [{ type: 'file', path: candidates[0] }]
    };
  }
  const seedRef = {
    v: 1,
    status: 'ambiguous',
    targetName: null,
    kindHint: null,
    importHint: null,
    candidates: candidates.map((path) => ({ path })),
    resolved: null,
    reason: 'changed-set',
    confidence: null
  };
  return {
    seedRef,
    seeds: candidates.map((path) => ({ type: 'file', path }))
  };
};

const resolveSeeds = ({ seed, changed, caps, recordTruncation, warnings }) => {
  if (seed && Array.isArray(seed)) {
    return { seedRef: seed[0], seeds: seed };
  }
  if (seed && typeof seed === 'object' && seed.type) {
    return { seedRef: seed, seeds: [seed] };
  }
  if (seed && typeof seed === 'object' && 'status' in seed) {
    const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
    const resolvedSeeds = [];
    if (seed.resolved && typeof seed.resolved === 'object') {
      if (seed.resolved.chunkUid) resolvedSeeds.push({ type: 'chunk', chunkUid: seed.resolved.chunkUid });
      else if (seed.resolved.symbolId) resolvedSeeds.push({ type: 'symbol', symbolId: seed.resolved.symbolId });
      else if (seed.resolved.path) resolvedSeeds.push({ type: 'file', path: seed.resolved.path });
    }
    for (const candidate of candidates) {
      if (candidate?.chunkUid) resolvedSeeds.push({ type: 'chunk', chunkUid: candidate.chunkUid });
      else if (candidate?.symbolId) resolvedSeeds.push({ type: 'symbol', symbolId: candidate.symbolId });
      else if (candidate?.path) resolvedSeeds.push({ type: 'file', path: candidate.path });
    }
    return { seedRef: seed, seeds: resolvedSeeds };
  }
  const changedPaths = normalizePaths(changed);
  if (!changedPaths.length) {
    warnings.push({
      code: 'EMPTY_CHANGED_SET',
      message: 'No changed paths provided; impact analysis skipped.'
    });
    return { seedRef: null, seeds: [] };
  }
  const maxCandidates = Number.isFinite(caps?.maxCandidates) ? caps.maxCandidates : null;
  const envelope = buildSeedEnvelope({
    paths: changedPaths,
    maxCandidates,
    recordTruncation
  });
  return envelope || { seedRef: null, seeds: [] };
};

const mergeWarnings = (target, warnings) => {
  for (const warning of warnings || []) {
    if (!warning?.code || !warning?.message) continue;
    const key = `${warning.code}:${warning.message}`;
    if (target.seen.has(key)) continue;
    target.seen.add(key);
    target.list.push(warning);
  }
};

const mergeTruncation = (target, truncation) => {
  for (const record of truncation || []) {
    if (!record?.cap || !record?.scope) continue;
    const key = `${record.scope}:${record.cap}`;
    if (target.seen.has(key)) continue;
    target.seen.add(key);
    target.list.push(record);
  }
};

const compareImpactNodes = (left, right) => compareGraphNodes(left, right);

export const buildImpactAnalysis = ({
  seed = null,
  changed = null,
  graphRelations = null,
  symbolEdges = null,
  callSites = null,
  graphIndex = null,
  direction = 'downstream',
  depth = 1,
  edgeFilters = null,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  const truncation = createTruncationRecorder({ scope: 'impact' });
  const warnings = { list: [], seen: new Set() };
  const recordTruncation = (cap, detail) => truncation.record(cap, detail);

  const resolvedSeeds = resolveSeeds({
    seed,
    changed,
    caps,
    recordTruncation,
    warnings: warnings.list
  });
  if (!resolvedSeeds.seedRef) {
    return {
      version: '1.0.0',
      seed: seed && typeof seed === 'object' ? seed : { v: 1, status: 'unresolved', candidates: [], resolved: null },
      direction: normalizeDirection(direction),
      depth: normalizeDepth(depth, 1),
      impacted: [],
      truncation: truncation.list.length ? truncation.list : null,
      warnings: warnings.list.length ? warnings.list : null,
      provenance: resolveProvenance({
        provenance,
        indexSignature,
        indexCompatKey,
        capsUsed: { graph: { ...caps } },
        repo,
        indexDir,
        now,
        label: 'GraphImpact'
      }),
      stats: {
        counts: {
          impacted: 0,
          workUnitsUsed: 0
        }
      }
    };
  }

  const seedRef = resolvedSeeds.seedRef;
  const seeds = resolvedSeeds.seeds;
  const directionMode = normalizeDirection(direction);
  const traversalDirection = directionMode === 'upstream' ? 'in' : 'out';
  const effectiveDepth = normalizeDepth(depth, 1);

  const impactedMap = new Map();
  const witnessMap = new Map();
  const mergeWitnessPath = (path) => {
    if (!path?.to) return;
    const key = nodeKey(path.to);
    if (!key) return;
    const existing = witnessMap.get(key);
    if (!existing) {
      witnessMap.set(key, path);
      return;
    }
    const distanceCompare = Number(path.distance) - Number(existing.distance);
    if (Number.isFinite(distanceCompare) && distanceCompare < 0) {
      witnessMap.set(key, path);
      return;
    }
    if (distanceCompare === 0 && compareWitnessPaths(path, existing) < 0) {
      witnessMap.set(key, path);
    }
  };

  let workUnitsUsed = 0;
  let graphRelationsUsed = false;
  let symbolEdgesUsed = false;
  let callSitesUsed = false;

  for (const seedNode of seeds) {
    if (!seedNode?.type) continue;
    const neighborhood = buildGraphNeighborhood({
      seed: seedNode,
      graphRelations,
      symbolEdges,
      callSites,
      graphIndex,
      direction: traversalDirection,
      depth: effectiveDepth,
      edgeFilters,
      caps,
      includePaths: true
    });

    if (neighborhood?.stats?.artifactsUsed) {
      graphRelationsUsed = graphRelationsUsed || neighborhood.stats.artifactsUsed.graphRelations;
      symbolEdgesUsed = symbolEdgesUsed || neighborhood.stats.artifactsUsed.symbolEdges;
      callSitesUsed = callSitesUsed || neighborhood.stats.artifactsUsed.callSites;
    }
    if (neighborhood?.stats?.counts?.workUnitsUsed) {
      workUnitsUsed += neighborhood.stats.counts.workUnitsUsed;
    }

    mergeWarnings(warnings, neighborhood?.warnings);
    mergeTruncation(truncation, neighborhood?.truncation);

    const nodes = Array.isArray(neighborhood?.nodes) ? neighborhood.nodes : [];
    for (const node of nodes) {
      if (!node?.ref) continue;
      if (node.distance === 0) continue;
      const key = nodeKey(node.ref);
      if (!key) continue;
      const existing = impactedMap.get(key);
      if (!existing || node.distance < existing.distance) {
        impactedMap.set(key, {
          ref: node.ref,
          distance: node.distance,
          confidence: node.confidence ?? null,
          witnessPath: null,
          partial: false
        });
      }
    }

    const paths = Array.isArray(neighborhood?.paths) ? neighborhood.paths : [];
    for (const path of paths) mergeWitnessPath(path);
  }

  const impacted = Array.from(impactedMap.values());
  impacted.sort(compareImpactNodes);
  for (const entry of impacted) {
    const key = nodeKey(entry.ref);
    if (!key) continue;
    const witness = witnessMap.get(key);
    if (witness) {
      entry.witnessPath = witness;
    } else {
      entry.partial = true;
    }
  }

  const capsUsed = { graph: { ...caps } };

  return {
    version: '1.0.0',
    seed: seedRef,
    direction: directionMode,
    depth: effectiveDepth,
    impacted,
    truncation: truncation.list.length ? truncation.list : null,
    warnings: warnings.list.length ? warnings.list : null,
    provenance: resolveProvenance({
      provenance,
      indexSignature,
      indexCompatKey,
      capsUsed,
      repo,
      indexDir,
      now,
      label: 'GraphImpact'
    }),
    stats: {
      artifactsUsed: {
        graphRelations: graphRelationsUsed,
        symbolEdges: symbolEdgesUsed,
        callSites: callSitesUsed
      },
      counts: {
        impacted: impacted.length,
        workUnitsUsed
      }
    }
  };
};

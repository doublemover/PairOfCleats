/** Bounded, renderer-independent projections. Original envelopes remain the evidence owner. */
export const PROJECTION_VERSION = 1;
export const VIEW_LIMITS = Object.freeze({ nodes: 200, edges: 400, bytes: 2 * 1024 * 1024, sourceBytes: 262144 });
/** One replaceable admitted page; preserve Array.find's first strict match. */
export function createPageIdentityLookup(projection) {
  if (!Array.isArray(projection?.nodes) || projection.nodes.length > VIEW_LIMITS.nodes) throw new TypeError('Expected one bounded admitted projection page.');
  const byId = new Map();
  for (const node of projection.nodes) {
    const id = node.id;
    if (id === id && !byId.has(id)) byId.set(id, node);
  }
  return Object.freeze({ get: id => byId.get(id), has: id => byId.has(id), size: byId.size });
}
export const array = value => Array.isArray(value) ? value : [];
export const refKey = ref => {
  if (!ref || typeof ref !== 'object') return null;
  if (typeof ref.partitionId === 'string' && Number.isSafeInteger(ref.localId)) return `semantic:${ref.partitionId}:${ref.localId}`;
  if (ref.type === 'file' && typeof ref.path === 'string') return `file:${ref.path}`;
  if (ref.type === 'chunk' && ref.chunkUid != null) return `chunk:${ref.chunkUid}`;
  if (ref.type === 'symbol' && ref.symbolId != null) return `symbol:${ref.symbolId}`;
  return null;
};
const labelRef = ref => ref?.path ?? ref?.chunkUid ?? ref?.symbolId ?? (ref?.localId != null ? `${ref.partitionId?.slice(0, 12)}:${ref.localId}` : 'Unresolved reference');
export const unwrapOutput = envelope => envelope?.result && typeof envelope.result === 'object' ? envelope.result : envelope;
export const detectFamily = input => {
  const data = unwrapOutput(input);
  if (!data || typeof data !== 'object') return 'unknown';
  if (data.operation === 'classify-compressed' || (array(data.typeResults).length && !array(data.records).length)) return 'symbolic';
  if (data.kind === 'artifact-catalog' || data.kind === 'artifact-page') return 'artifacts';
  if (data.primary && data.evidence) return 'context';
  if (data.options && data.summary && Array.isArray(data.nodes)) return 'map';
  if (Array.isArray(data.records) && data.coverage && data.generation) return 'semantic';
  if (Array.isArray(data.tasks) && data.action && data.generation) return 'enrichment';
  if (Array.isArray(data.observations) || Array.isArray(data.families) || Array.isArray(data.derivedClaims) || (Array.isArray(data.claims) && (data.pinnedFamilies || data.claimGeneration))) return 'runtime';
  if (Array.isArray(data.impacted)) return 'impact';
  if (Array.isArray(data.violations)) return 'architecture';
  if (Array.isArray(data.suggestions)) return 'tests';
  if (data.seed && Array.isArray(data.nodes) && Array.isArray(data.edges)) return 'graph';
  if (Array.isArray(data.code) || Array.isArray(data.prose) || Array.isArray(data.hits) || Array.isArray(data.results)) return 'search';
  if (data.deltas?.flows && data.from && data.to) return 'risk-delta';
  if (Array.isArray(data.flows) || data.risk?.flows || data.analysisStatus) return 'risk';
  if (data.artifactSurfaceVersion || data.partitions || data.pieces || data.buildId || data.snapshots) return 'index';
  return 'unknown';
};

/** Projection is one replaceable page, never an accumulating expanded-path cache. */
export function projectOutput(envelope, { page = 0, relation = '', family = detectFamily(envelope), onEntity = null, metadataOnly = false } = {}) {
  const data = unwrapOutput(envelope);
  if (!data || typeof data !== 'object') throw new TypeError('Expected a JSON output object.');
  if (!Number.isSafeInteger(page) || page < 0) throw new RangeError('Invalid projection page.');
  const nodes = [], edges = [], sections = [], byId = new Map(), relationKinds = new Set();
  const start = page * VIEW_LIMITS.nodes;
  let seen = 0, edgeCount = 0;
  const add = (id, label, kind, detail, ref = null, parentId = null, searchHint = null) => {
    const ordinal = seen++;
    if (onEntity) {
      const value = typeof detail === 'function' ? null : detail;
      onEntity({ id, label: String(label ?? id), kind, ordinal, parentId,
        file: searchHint?.file ?? value?.file ?? value?.path ?? value?.source?.path ?? ref?.path
          ?? (typeof parentId === 'string' && parentId.startsWith('file:') ? parentId.slice(5) : null),
        mode: searchHint?.mode ?? value?.mode ?? null, originalRank: searchHint?.originalRank ?? value?.originalRank ?? null });
    }
    if (metadataOnly) return;
    if (ordinal < start || nodes.length >= VIEW_LIMITS.nodes) return;
    if (byId.has(id)) return;
    const node = { id, label: String(label ?? id), kind, ref, parentId,
      detail: typeof detail === 'function' ? detail() : detail, ordinal };
    nodes.push(node); byId.set(id, node);
  };
  const edge = (from, to, kind, detail) => {
    if (metadataOnly) return;
    kind = kind || 'relation';
    relationKinds.add(kind);
    if (relation && kind !== relation) return;
    edgeCount++;
    if (!from || !to || !byId.has(from) || !byId.has(to) || edges.length >= VIEW_LIMITS.edges) return;
    edges.push({ id: `edge:${edges.length}`, from, to, kind: kind || 'relation', detail });
  };
  const section = (title, value, presentation = 'records') => {
    if (metadataOnly) return;
    if (value != null) sections.push({ title, value, presentation });
  };
  const graph = pack => {
    for (const row of array(pack?.nodes)) add(refKey(row.ref) || `unresolved:${seen}`, row.label ?? row.name ?? labelRef(row.ref), row.kind || row.ref?.type || 'entity', row, row.ref);
    for (const row of array(pack?.edges)) edge(refKey(row.from), refKey(row.to), row.edgeType, row);
    section('Witness paths', pack?.paths, 'paths');
    section('Unresolved or nonresident relationships', array(pack?.edges).filter(row => !byId.has(refKey(row.from)) || !byId.has(refKey(row.to))), 'relations');
    section('Traversal limits', pack?.truncation);
  };
  if (family === 'symbolic') {
    const results = data.typeResults || [data];
    for (const result of results) {
      const entry = result.witnesses?.representation === 'finite-string-word-dag-v1' ? result.witnesses.graphEntry : null;
      section(`${result.operation} · ${result.cardinality ?? result.contains ?? 'unknown'}`, result, 'types');
      if (!entry?.graph) continue;
      for (const row of array(entry.graph.nodes)) add(`word:${entry.graphId}:${row.id}`,
        row.kind === 'Literal' ? String(row.value).slice(0, 80) : 'Ordered concatenation', row.kind,
        () => ({ ...row, graphId: entry.graphId, root: array(entry.graph.rootIds).includes(row.id), location: 'response-inline' }));
      for (const row of array(entry.graph.nodes)) array(row.children).forEach((child, ordinal) =>
        edge(`word:${entry.graphId}:${row.id}`, `word:${entry.graphId}:${child}`, `child:${ordinal}`, { parent: row.id, child, ordinal, graphId: entry.graphId }));
    }
    section('Interpretation', { meaning: 'Compressed word DAG; literal/ordered-concat structure only. No unbounded string expansion.', backend: 'classify-compressed requires the separately unpublished symbolic backend.' });
  } else if (family === 'artifacts') {
    const rows = data.artifacts ?? data.rows ?? [];
    array(rows).forEach((row, ordinal) => {
      const absoluteOrdinal = (data.ordinal || 0) + ordinal;
      const id = data.kind === 'artifact-catalog' ? `artifact:${row.name}`
        : `artifact-row:${JSON.stringify([data.name ?? '', data.generation ?? null, absoluteOrdinal])}`;
      add(id, row.name ?? row.path ?? row.id ?? `Row ${absoluteOrdinal}`, row.family ?? data.mode ?? 'artifact', row);
    });
    section('Logical artifact inventory', data.artifacts, 'manifest');
    section('Artifact values', data.value ?? data.rows, 'records');
    section('Storage provenance', data.provenance, 'manifest');
  } else if (family === 'map') {
    for (const file of array(data.nodes)) {
      add(`file:${file.path}`, file.name ?? file.path, file.category || 'file', file, { type: 'file', path: file.path });
      for (const member of array(file.members)) add(`member:${member.id}`, member.name, member.kind || member.type || 'symbol', member, null, `file:${file.path}`);
    }
    const endpoint = value => value?.member != null ? `member:${value.member}` : value?.file != null ? `file:${value.file}` : null;
    for (const row of array(data.edges)) edge(endpoint(row.from), endpoint(row.to), row.type, row);
    section('Source scope and omissions', data.summary);
    section('File-level relationship totals (source scope)', data.edgeAggregates, 'relations');
    section('Legend', data.legend);
    section('Build measurements', data.buildMetrics);
  } else if (family === 'semantic') {
    const names = new Map(array(data.names).map(row => [`${row.partitionId}:${row.id}`, row.value]));
    for (const row of array(data.records)) add(refKey(row.ref), names.get(`${row.ref.partitionId}:${row.data?.nameId}`) ?? row.data?.operation ?? row.data?.astKind ?? `${row.kind} ${row.id}`, row.kind, row, row.ref, refKey(row.scope));
    for (const row of array(data.edges)) edge(refKey(row.from), refKey(row.to), row.kind, row);
    for (const row of array(data.operands)) edge(refKey(row.parent), refKey(row.child), `operand:${row.slot}`, row);
    section('Operand slots and ordinals', data.operands, 'relations');
    section('Name table', data.names);
    section('Chunk ownership', data.ownership);
    section('Evidence references', data.evidenceRefs, 'references');
    section('Structural matches (candidate semantics)', data.matches, 'ranked');
    section('Explanations and limitations', data.explanations, 'evidence');
    section('Source references (UTF-16 offsets)', data.sourceRefs, 'references');
    section('Symbolic type results', data.typeResults, 'types');
    section('Enrichment suggestions (read-only)', data.enrichment);
    section('Unloaded endpoints', array(data.edges).filter(row => !byId.has(refKey(row.from)) || !byId.has(refKey(row.to))), 'relations');
  } else if (family === 'graph') graph(data);
  else if (family === 'context') {
    graph(data.graph);
    section('Primary source and exact range', data.primary, 'source');
    for (const key of ['semantic', 'semanticFederation', 'types', 'risk', 'evidence']) section(key, data[key], key === 'risk' ? 'paths' : 'evidence');
  } else if (family === 'search') {
    for (const mode of ['code', 'prose', 'extractedProse', 'records', 'hits', 'results']) {
      const rows = array(data[mode]);
      section(`${mode} · original ranking`, rows, 'ranked');
      rows.forEach((row, rank) => add(`hit:${mode}:${rank}`, `${rank + 1}. ${row.name ?? row.file ?? row.path ?? row.id ?? 'hit'}`, mode, () => ({ ...row, originalRank: rank + 1, mode }), row.ref || (row.chunkUid ? { type: 'chunk', chunkUid: row.chunkUid } : null), null,
        { file: row.file ?? row.path ?? null, mode, originalRank: rank + 1 }));
    }
    section('Query and ranking metadata', data.stats ?? data.meta ?? data.query);
  } else if (family === 'enrichment') {
    for (const task of array(data.tasks)) add(`task:${task.taskId}`, task.kind, task.state || 'task', task);
    section('Task state and execution authority', { status: data.status, action: data.action, executionAuthorized: data.executionAuthorized, validation: data.validation });
    section('Publication lineage', data.lineage);
    section('Published generation', data.publishedGeneration);
    section('Diagnostics', data.diagnostics);
  } else if (family === 'runtime') {
    for (const key of ['observations', 'derivedClaims', 'claims', 'families']) {
      section(key, data[key], 'evidence');
      for (const row of array(data[key])) add(`${key}:${row.evidenceId ?? row.generationId ?? seen}`, row.kind ?? row.captureId ?? key, key, row);
    }
    for (const key of ['explanations', 'derivedCoverage', 'integrity', 'cost', 'omitted', 'pinnedFamilies', 'status', 'reasons', 'claimGeneration']) section(key, data[key]);
  } else if (family === 'risk-delta') {
    for (const kind of ['flows', 'partialFlows']) {
      const delta = data.deltas[kind];
      for (const change of ['added', 'removed', 'changed']) {
        const rows = array(delta?.[change]); section(`${kind} · ${change}`, rows, 'paths');
        for (const row of rows) add(`delta:${kind}:${change}:${seen}`, row.flowId ?? row.partialFlowId ?? `${change} ${seen + 1}`, change, row);
      }
    }
    section('Before snapshot and source scope', data.from, 'manifest');
    section('After snapshot and source scope', data.to, 'manifest');
    section('Delta totals and unchanged counts', data.summary);
    section('Delta filters', data.filters);
  } else if (family === 'impact') {
    for (const row of array(data.impacted)) add(refKey(row.ref), labelRef(row.ref), 'impacted', row, row.ref);
    section('Impact witnesses', data.impacted, 'paths');
    section('Traversal', { seed: data.seed, direction: data.direction, depth: data.depth });
  } else if (['risk', 'architecture', 'tests'].includes(family)) {
    for (const key of ['flows', 'partialFlows', 'violations', 'suggestions']) {
      const rows = array(data[key] ?? data.risk?.[key]); section(key, rows, 'paths');
      for (const row of rows) add(`${key}:${seen}`, row.ruleId ?? row.title ?? row.file ?? row.id ?? `${key} ${seen + 1}`, key, row);
    }
    for (const key of ['analysisStatus', 'summary', 'support', 'guidance', 'caps', 'filters', 'stats']) section(key, data[key]);
  } else if (family === 'index') {
    for (const key of ['partitions', 'pieces', 'snapshots', 'planning', 'contexts']) {
      section(key, data[key], 'manifest');
      for (const row of array(data[key])) add(`${key}:${seen}`, row.partitionId ?? row.path ?? row.id ?? `${key} ${seen + 1}`, key, row);
    }
    section('Generation and manifest', data, 'manifest');
  } else section('Unrecognized output · no semantic graph inferred', data, 'records');
  for (const key of ['provenance', 'coverage', 'frontier', 'truncation', 'warnings']) section(key, data[key], 'coverage');
  section('Complete original output', data, 'records');
  return { version: PROJECTION_VERSION, family, generation: data.generation ?? data.provenance?.indexSignature ?? null,
    graphCapability: data.graphCapability ?? null,
    nodes, edges, sections, page, relationKinds: [...relationKinds].sort(), hasNext: seen > start + VIEW_LIMITS.nodes,
    cursor: family === 'search' ? (data.pagination?.nextCursor ?? null) : (data.cursor ?? data.nextCursor ?? null),
    continuation: family === 'search' ? (data.pagination || null) : null,
    coverage: { source: data.coverage ?? data.summary ?? null, sourceTotal: null,
      responseEntities: seen, admittedEntities: nodes.length, responseRelations: edgeCount,
      admittedRelations: edges.length, omittedEntities: Math.max(0, seen - nodes.length),
      omittedRelations: Math.max(0, edgeCount - edges.length) } };
}

import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../../contracts/validators/semantic.js';
import { readRetainedSemanticSourceSnapshot } from '../../semantic/retained-source-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createSourceRoleView } from './source-motifs.js';
import { composeCheckedSemanticEvidenceBags } from './checked-evidence-bags.js';

const key = canonicalSemanticJson;
const kinds = ['callTarget', 'constructTarget'];
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;

/** Canonical retained records and incident edges feed the existing motif owner.
 * Caller roles label questions only; canonical source spans, edge qualifiers and
 * conditions are never inferred from names, snippets or graph display previews. */
export const projectRetainedSemanticRoleView = async ({ store, world, nodes,
  maxIncidentRows = 4096, maxSourceBytes = 8 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  if (store?.backend !== 'artifact' || !world || !Array.isArray(nodes) || !nodes.length || nodes.length > 64
    || !Number.isSafeInteger(maxIncidentRows) || maxIncidentRows < 1 || maxIncidentRows > 4096
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 8 * 1024 * 1024) {
    throw new TypeError('Bounded generation-pinned semantic role projection required.');
  }
  let retainedMetadataBytes = 0;
  const charge = encoded => {
    retainedMetadataBytes += Buffer.byteLength(encoded);
    if (retainedMetadataBytes > 4 * 1024 * 1024) throw new RangeError('Semantic role retained metadata allowance exhausted.');
  };
  const pin = value => { const encoded = key(value); charge(encoded); return JSON.parse(encoded); };
  // Canonical own-data admission rejects accessors and pins every caller-owned
  // selection before storage can yield. Later mutations cannot retarget a view.
  world = pin(world); nodes = pin(nodes);
  if (Object.keys(world).length !== 3 || !Object.hasOwn(world, 'generation')
    || !Object.hasOwn(world, 'repositoryNamespace') || !Object.hasOwn(world, 'contextKey')
    || key(assertSemanticEnvelope('generation', world.generation)) !== key(store.generation)
    || !text(world.repositoryNamespace) || !text(world.contextKey)) {
    throw new TypeError('Bounded generation-pinned semantic role projection required.');
  }
  const selected = new Map();
  for (const node of nodes) {
    if (!node || Object.keys(node).length !== 2 || !Object.hasOwn(node, 'ref') || !Object.hasOwn(node, 'roles')
      || !validateSemanticRecord('recordRef', node.ref).ok || !Array.isArray(node.roles)
      || !node.roles.length || node.roles.length > 16 || node.roles.some(role => !text(role))
      || selected.has(key(node.ref))) throw new TypeError('Unique selected semantic role records required.');
    selected.set(key(node.ref), node);
  }
  const records = await store.getRecords(nodes.map(node => node.ref), ['span'], { signal });
  if (!Array.isArray(records) || records.length !== nodes.length) throw new TypeError('Semantic role record inventory is incomplete.');
  const sources = new Map(), partitions = new Map(), projected = [];
  let sourceReadBytes = 0;
  for (let index = 0; index < records.length; index++) {
    throwIfAborted(signal);
    const record = pin(records[index]), node = nodes[index];
    if (!record?.span || key(record.ref) !== key(node.ref)) throw new TypeError('Selected semantic role lacks a retained source span.');
    let source = partitions.get(record.ref.partitionId);
    if (!source) {
      if (sourceReadBytes >= maxSourceBytes) throw new RangeError('Semantic role source allowance exhausted.');
      const captured = await readRetainedSemanticSourceSnapshot({ store, partitionId: record.ref.partitionId,
        repositoryNamespace: world.repositoryNamespace, maxBytes: maxSourceBytes - sourceReadBytes, signal });
      sourceReadBytes += captured.bytes.length;
      source = captured.source;
      charge(key(source));
      if (source.mapping !== null) throw new TypeError('Semantic role projection requires an independently qualified original-source mapping.');
      if (sources.has(source.sourceUnitId) && key(sources.get(source.sourceUnitId).manifest) !== key(source)) {
        throw new TypeError('Conflicting retained semantic role source manifests.');
      }
      sources.set(source.sourceUnitId, captured.snapshot);
      partitions.set(record.ref.partitionId, source);
    }
    projected.push(pin({ id: key(record.ref), kind: record.kind, roles: [...node.roles],
      sourceRef: { sourceUnitId: source.sourceUnitId, span: record.span, coordinateUnit: source.coordinateUnit } }));
  }
  const relations = [], evidence = [], seen = new Map();
  let scanned = 0, truncated = false, otherContexts = 0;
  for (const node of nodes) {
    let offset = 0, done = false;
    do {
      throwIfAborted(signal);
      if (scanned >= maxIncidentRows) { truncated = true; break; }
      const limit = Math.min(128, maxIncidentRows - scanned);
      const page = await store.getNeighbors(node.ref, 'downstream', kinds, { offset, limit, signal });
      throwIfAborted(signal);
      if (!page || !Number.isSafeInteger(page.offset) || page.offset < offset || page.offset - offset > limit
        || typeof page.done !== 'boolean' || !page.done && page.offset === offset
        || !Array.isArray(page.edges) || page.edges.length > page.offset - offset) {
        throw new TypeError('Semantic role incident page did not make bounded progress.');
      }
      scanned += page.offset - offset;
      offset = page.offset; done = page.done;
      for (const candidate of page.edges) {
        const edge = pin(candidate);
        if (!validateSemanticRecord('edge', edge).ok || !kinds.includes(edge.kind)
          || key(edge.from) !== key(node.ref)) throw new TypeError('Semantic role edge differs from its canonical direction or family.');
        if (edge.contextKey !== world.contextKey) { otherContexts++; continue; }
        if (!selected.has(key(edge.to))) continue;
        const id = 'semantic-edge:' + semanticHash('pairofcleats.motif-retained-edge.v1', edge);
        const encoded = key(edge);
        if (seen.has(id)) {
          if (seen.get(id) !== encoded) throw new TypeError('Conflicting retained semantic edge identity.');
          continue;
        }
        seen.set(id, encoded);
        relations.push(pin({ id, kind: edge.kind, from: key(edge.from), to: key(edge.to),
          contextKey: world.contextKey, evidenceId: id,
          certainty: edge.certainty === 'exact-static' ? 'exact-in-model' : edge.certainty === 'modeled' ? 'may' : 'heuristic' }));
        evidence.push({ id, edge });
      }
    } while (!done);
    if (truncated) break;
  }
  const composed = composeCheckedSemanticEvidenceBags({ evidence, world, complete: !truncated, signal });
  const relationById = new Map(relations.map(relation => [relation.id, relation]));
  const view = createSourceRoleView({ world, nodes: projected,
    relations: composed.evidence.map(entry => relationById.get(entry.id)),
    sources: [...sources.values()], coverage: truncated ? 'partial' : 'complete-declared-view' });
  throwIfAborted(signal);
  return { view, projection: 'retained-canonical-semantic-records/v1', evidence: composed.evidence,
    normalization: composed.normalization, scannedIncidentRows: scanned,
    sourceReadBytes, retainedMetadataBytes, otherContextEdges: otherContexts, truncated,
    storeScope: store.cursorScope || null, analysisClosure: 'not-implied',
    behaviorConditions: 'not-discharged', continuation: 'restart-same-pinned-store-and-selection' };
};

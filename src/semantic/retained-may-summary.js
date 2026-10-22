import { readCheckedMaySummary } from './checked-may-summary.js';
import { readRetainedSemanticSourceSnapshot } from './retained-source-snapshot.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { materializeTaskLens } from '../context-pack/task-evidence/lens.js';

const key = canonicalSemanticJson;
const owners = new WeakMap();
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const boundary = (value, offset) => offset === 0 || offset === value.length
  || !(value.charCodeAt(offset - 1) >= 0xd800 && value.charCodeAt(offset - 1) <= 0xdbff
    && value.charCodeAt(offset) >= 0xdc00 && value.charCodeAt(offset) <= 0xdfff);
const allowedKinds = new Set(['flowsTo', 'defines', 'reads', 'writes', 'returns', 'captures', 'sharesStorage', 'copies', 'packs', 'transfers']);
const fail = message => { throw new TypeError('Retained may summary: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Canonical edges admit one finite relation model, not source-language transfer
 * semantics. A checked invariant cannot upgrade producer certainty, feasibility,
 * native effects, source extraction coverage or unselected graph boundaries. */
export const projectRetainedMaySummarySystem = async ({ store, world, nodes, seeds,
  kinds = ['flowsTo', 'defines', 'reads', 'writes', 'returns'], maxIncidentRows = 4096,
  maxSourceBytes = 8 * 1024 * 1024, maxMetadataBytes = 4 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  if (store?.backend !== 'artifact' || !world
    || key(assertSemanticEnvelope('generation', world.generation)) !== key(store.generation)
    || !text(world.repositoryNamespace) || !text(world.contextKey)
    || Object.keys(world).some(name => !['generation', 'repositoryNamespace', 'contextKey', 'sourceSnapshotId'].includes(name))
    || Object.hasOwn(world, 'sourceSnapshotId') && !text(world.sourceSnapshotId)
    || !Array.isArray(nodes) || !nodes.length || nodes.length > 64
    || !Array.isArray(seeds) || !seeds.length || seeds.length > 8
    || !Array.isArray(kinds) || !kinds.length || new Set(kinds).size !== kinds.length || kinds.some(kind => !allowedKinds.has(kind))
    || !Number.isSafeInteger(maxIncidentRows) || maxIncidentRows < 1 || maxIncidentRows > 4096
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 8 * 1024 * 1024
    || !Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1024 || maxMetadataBytes > 4 * 1024 * 1024) fail('bounded generation-pinned projection required');
  // Canonical cloning pins caller selections before any awaited store read.
  world = JSON.parse(key(world)); nodes = JSON.parse(key(nodes)); seeds = JSON.parse(key(seeds)); kinds = [...kinds].sort();
  const selected = new Map();
  for (const ref of nodes) {
    if (!validateSemanticRecord('recordRef', ref).ok || selected.has(key(ref))) fail('unique canonical nodes required');
    selected.set(key(ref), ref);
  }
  if (seeds.some(ref => !validateSemanticRecord('recordRef', ref).ok || !selected.has(key(ref)))
    || new Set(seeds.map(key)).size !== seeds.length) fail('unique selected entry seeds required');
  let sourceReadBytes = 0, retainedMetadataBytes = 0;
  const charge = value => {
    retainedMetadataBytes += Buffer.byteLength(key(value));
    if (retainedMetadataBytes > maxMetadataBytes) fail('retained metadata allowance exhausted');
  };
  const rows = await store.getRecords(nodes, ['span'], { signal });
  throwIfAborted(signal);
  if (!Array.isArray(rows) || rows.length !== nodes.length) fail('selected record inventory is incomplete');
  charge(rows);
  const records = JSON.parse(key(rows));
  const partitions = new Map(), sources = new Map(), sourceWitnesses = [], snapshots = new Map();
  for (let index = 0; index < records.length; index++) {
    throwIfAborted(signal);
    const record = records[index], ref = nodes[index];
    if (!record || key(record.ref) !== key(ref)) fail('selected canonical record is unavailable');
    let captured = partitions.get(ref.partitionId);
    if (!captured) {
      const remaining = maxSourceBytes - sourceReadBytes;
      if (remaining < 1) fail('retained source allowance exhausted');
      const snapshot = await readRetainedSemanticSourceSnapshot({ store, partitionId: ref.partitionId,
        repositoryNamespace: world.repositoryNamespace, maxBytes: remaining, signal });
      sourceReadBytes += snapshot.bytes.length; captured = { source: snapshot.source, text: snapshot.text };
      const source = captured.source;
      charge(source);
      if (source.mapping !== null) fail('an independently qualified original-source mapping is required');
      if (sources.has(source.sourceUnitId) && key(sources.get(source.sourceUnitId)) !== key(source)) fail('conflicting retained source identity');
      sources.set(source.sourceUnitId, source); snapshots.set(source.sourceUnitId, snapshot.snapshot); partitions.set(ref.partitionId, captured);
    }
    const source = captured.source;
    if (record.span && (!Array.isArray(record.span) || record.span.length !== 2
      || record.span.some(offset => !Number.isSafeInteger(offset) || offset < 0 || offset > source.textLength || !boundary(captured.text, offset))
      || record.span[1] < record.span[0])) fail('selected source coordinates are unavailable');
    const witness = { ref, kind: record.kind, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      path: source.path, coordinateUnit: source.coordinateUnit, span: record.span };
    charge(witness); sourceWitnesses.push(witness);
  }
  const evidence = [], seen = new Map(), certainties = { 'exact-static': 0, modeled: 0, heuristic: 0 };
  let scannedIncidentRows = 0, truncated = false, boundaryEdges = 0, otherContextEdges = 0;
  for (const ref of nodes) {
    let offset = 0, done = false;
    do {
      throwIfAborted(signal);
      if (scannedIncidentRows >= maxIncidentRows) { truncated = true; break; }
      const limit = Math.min(128, maxIncidentRows - scannedIncidentRows);
      const page = await store.getNeighbors(ref, 'downstream', kinds, { offset, limit, signal });
      if (!Number.isSafeInteger(page.offset) || page.offset < offset || page.offset - offset > limit
        || typeof page.done !== 'boolean' || !page.done && page.offset === offset || !Array.isArray(page.edges)
        || page.edges.length > page.offset - offset) fail('incident page does not make bounded progress');
      scannedIncidentRows += page.offset - offset; offset = page.offset; done = page.done;
      for (const edge of page.edges) {
        if (!validateSemanticRecord('edge', edge).ok || !kinds.includes(edge.kind) || key(edge.from) !== key(ref)) fail('incident edge differs from its canonical direction or family');
        if (edge.contextKey !== world.contextKey) { otherContextEdges++; continue; }
        if (!selected.has(key(edge.to))) { boundaryEdges++; continue; }
        const transferId = semanticHash('semantic.retained-may-transfer.v1', edge), encoded = key(edge);
        if (seen.has(transferId)) {
          if (seen.get(transferId) !== encoded) fail('conflicting transfer identity');
          continue;
        }
        seen.set(transferId, encoded);
        const entry = { transferId, edge: JSON.parse(encoded) };
        charge(entry); evidence.push(entry); certainties[edge.certainty]++;
      }
    } while (!done);
    if (truncated) break;
  }
  const sourceSnapshotId = semanticHash('semantic.retained-may-sources.v1', {
    storeScope: store.cursorScope || null, sources: [...sources.values()].sort((a, b) => a.sourceUnitId < b.sourceUnitId ? -1 : 1)
  });
  if (Object.hasOwn(world, 'sourceSnapshotId') && world.sourceSnapshotId !== sourceSnapshotId) fail('requested source snapshot differs from retained inputs');
  const pending = [...(truncated ? ['incident-row-budget'] : []), ...(boundaryEdges ? ['selected-boundary-open'] : [])];
  const system = { profile: 'finite-may-set-v1', transferVersion: 1,
    world: { generation: world.generation, repositoryNamespace: world.repositoryNamespace, contextKey: world.contextKey,
      sourceSnapshotId, providerId: 'retained-canonical-edge-relation/v1' },
    universe: seeds.map(key).sort(), nodes: [...selected.keys()].sort(),
    entries: seeds.map(ref => ({ node: key(ref), facts: [key(ref)] })).sort((a, b) => a.node < b.node ? -1 : 1),
    edges: evidence.map(({ transferId, edge }) => ({ id: transferId, from: key(edge.from), to: key(edge.to), operation: 'identity' }))
      .sort((a, b) => a.id < b.id ? -1 : 1),
    extractionClosure: truncated ? 'partial' : 'complete-in-model',
    boundaryClosure: boundaryEdges ? 'partial' : 'complete-in-model', pending };
  charge(system);
  const projection = freeze({ kind: 'retained-canonical-may-relation/v1', system, sourceWitnesses, evidence,
    projectionId: semanticHash('semantic.retained-may-projection.v1', { system, evidence }),
    storeScope: store.cursorScope || null, scannedIncidentRows, retainedMetadataBytes, sourceReadBytes,
    boundaryEdges, otherContextEdges, inputCertainties: certainties, truncated,
    conditions: 'retained-but-not-discharged', sourceLanguageClosure: 'not-implied', pathFeasibility: 'not-implied',
    producerSemantics: 'retained-claims-not-independently-rechecked' });
  owners.set(projection, { selected, snapshots, witnesses: new Map(sourceWitnesses.map(witness => [key(witness.ref), witness])) });
  return projection;
};

/** Only an owned canonical projection can supply the authoritative checker
 * system. The untrusted capsule remains a full simultaneous invariant. */
export const readCheckedRetainedMaySummary = ({ projection, capsule, node,
  maxObligations = 100000, maxBytes = 8 * 1024 * 1024, signal = null }) => {
  node = JSON.parse(key(node));
  const owned = owners.get(projection);
  if (!owned || !validateSemanticRecord('recordRef', node).ok || !owned.selected.has(key(node))
    || !Number.isSafeInteger(maxObligations) || maxObligations < 0 || maxObligations > 100000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) fail('owned projection and bounded selected node required');
  const answer = readCheckedMaySummary({ system: projection.system, capsule, node: key(node), maxObligations, maxBytes, signal });
  return { ...answer, projectionId: projection.projectionId, node: structuredClone(node),
    seedRefs: answer.facts === null ? null : answer.facts.map(fact => structuredClone(owned.selected.get(fact))),
    negativeMeaning: answer.facts === null ? 'unknown' : 'absent-only-from-checked-retained-relation-model',
    producerCertainty: 'not-upgraded', sourceLanguageCompleteness: 'not-implied', pathFeasibility: 'not-implied', editAuthority: 'none' };
};

/** A checked upper-model member is an abstract candidate, not a feasible path.
 * The query and every admitted seed source are mandatory inspection facets. */
export const materializeCheckedRetainedMaySummaryLens = ({ projection, capsule, node, taskId,
  maxFacets = 12, maxObligations = 100000, maxBytes = 8 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  if (typeof taskId !== 'string' || !taskId || !Number.isSafeInteger(maxFacets) || maxFacets < 1 || maxFacets > 64) {
    fail('bounded task lens required');
  }
  node = JSON.parse(key(node));
  const answer = readCheckedRetainedMaySummary({ projection, capsule, node, maxObligations, maxBytes, signal });
  throwIfAborted(signal);
  const owned = owners.get(projection), selected = new Map([[key(node), { ref: node, roles: ['summaryQuery'] }]]);
  for (const ref of answer.seedRefs || []) {
    const id = key(ref);
    if (!selected.has(id)) selected.set(id, { ref, roles: [] });
    selected.get(id).roles.push('abstractCandidate');
  }
  const candidates = [], sourceIds = new Set(), sourceFrontier = [];
  for (const [id, selection] of selected) {
    const witness = owned.witnesses.get(id);
    if (!witness?.span) { sourceFrontier.push({ ref: structuredClone(selection.ref), reason: 'retained-source-span-unavailable' }); continue; }
    sourceIds.add(witness.sourceUnitId);
    candidates.push({ id, worldRef: projection.system.world, kind: 'checked-summary', roles: selection.roles, mandatory: true, score: 1,
      sourceRef: { sourceUnitId: witness.sourceUnitId, span: witness.span, coordinateUnit: witness.coordinateUnit },
      qualification: { certainty: 'exact-retained-source', checkerStatus: answer.check.status,
        closure: answer.check.status === 'checked-in-model' ? 'checked-upper-retained-relation-model' : 'unaccepted-summary',
        candidateMembership: selection.roles.includes('abstractCandidate') ? 'in-checked-upper-model-not-proven-reachable' : 'query-only',
        precision: answer.check.precision, producerCertainty: 'not-upgraded', sourceLanguageClosure: 'not-implied', pathFeasibility: 'not-implied' },
      reason: selection.roles.includes('abstractCandidate')
        ? 'Entry seed retained by the checked upper invariant; membership does not establish a feasible path.'
        : 'Exact retained source selected for this finite relation query.' });
  }
  if (sourceFrontier.length) return { answer, lens: null, status: 'sourceUnavailable', sourceFrontier,
    completeness: 'not-implied', actionAuthority: 'none' };
  const lens = materializeTaskLens({ taskId, worldRef: projection.system.world, maxFacets,
    requiredRoles: ['summaryQuery', ...(answer.seedRefs?.length ? ['abstractCandidate'] : [])], candidates,
    sources: [...sourceIds].map(id => owned.snapshots.get(id)),
    retainedResult: { ownerHandle: projection.projectionId, enumeration: 'explicit-selected-relation-model', checkId: answer.check.checkId || null } });
  throwIfAborted(signal);
  return { answer, lens, sourceFrontier, status: lens.status === 'mandatoryOverflow' ? 'mandatoryOverflow'
    : answer.check.status === 'checked-in-model' ? 'projected' : 'checkerUnaccepted',
  completeness: 'not-implied', actionAuthority: 'none' };
};

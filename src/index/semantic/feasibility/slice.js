import { captureFiniteFeasibilityRequest } from '../../../contracts/validators/finite-feasibility.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { admitOwnedSemanticSourceSnapshot } from '../source-snapshot-admission.js';
import { isUtf16Boundary } from '../../../shared/embedded-content.js';

export const fail = message => Object.assign(new TypeError(message), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
const MAX_BYTES = 1024 * 1024;
const successors = block => block.terminator.kind === 'goto' ? [block.terminator.target]
  : block.terminator.kind === 'branch' ? [...new Set([block.terminator.onTrue, block.terminator.onFalse])] : [];

/** Original source capabilities verify actual bytes/coordinates. Translation
 * remains declared: these source anchors do not prove a frontend's semantics.
 */
export const prepareFiniteFeasibilitySlice = (input, sourceSnapshots) => {
  const request = captureFiniteFeasibilityRequest(input);
  canonicalSemanticJson(request, { maxBytes: MAX_BYTES });
  if (!Array.isArray(sourceSnapshots) || !sourceSnapshots.length || sourceSnapshots.length > 16) throw fail('One to sixteen original source snapshots required.');
  let sourceBytes = 0;
  const sources = new Map();
  for (const snapshot of sourceSnapshots) {
    const source = admitOwnedSemanticSourceSnapshot(snapshot, { maxBytes: MAX_BYTES - sourceBytes,
      repositoryNamespace: request.world.repositoryNamespace });
    sourceBytes += source.byteLength;
    if (sources.has(source.manifest.sourceUnitId) || sourceBytes > MAX_BYTES) throw fail('Duplicate or oversized source set.');
    sources.set(source.manifest.sourceUnitId, source);
  }
  const anchors = new Map();
  for (const anchor of request.anchors) {
    const ref = anchor.source, source = sources.get(ref.sourceUnitId);
    if (anchors.has(anchor.id) || !source || ref.sourceHash !== source.manifest.byteHash || ref.path !== source.manifest.path
      || ref.span[0] >= ref.span[1] || !isUtf16Boundary(source.text, ref.span[0]) || !isUtf16Boundary(source.text, ref.span[1])) throw fail('Exact original source anchor required.');
    anchors.set(anchor.id, anchor);
  }
  const blocks = new Map(), definitions = new Map(request.inputs.map(id => [id, { block: null, position: -1 }]));
  let operations = 0;
  for (const block of request.blocks) {
    if (blocks.has(block.id) || !anchors.has(block.anchorId)) throw fail('Unique anchored blocks required.');
    blocks.set(block.id, block);
    for (const [position, instruction] of [...block.phis, ...block.operations].entries()) {
      operations++;
      if (definitions.has(instruction.id) || operations > 512) throw fail('Unique SSA definitions and at most 512 instructions required.');
      definitions.set(instruction.id, { block: block.id, position });
    }
  }
  if (!blocks.has(request.entry) || !blocks.has(request.predicate.block)) throw fail('Entry and predicate must name admitted blocks.');
  const fixedInputs = new Map();
  for (const condition of request.entryConditions) {
    if (!request.inputs.includes(condition.input) || fixedInputs.has(condition.input)) throw fail('Entry conditions need unique input bindings.');
    fixedInputs.set(condition.input, condition.value);
  }
  const predecessors = new Map([...blocks.keys()].map(id => [id, new Set()]));
  for (const block of blocks.values()) for (const target of successors(block)) {
    if (!blocks.has(target)) throw fail('Control-flow successor is outside the admitted slice.');
    predecessors.get(target).add(block.id);
  }
  const indegree = new Map([...predecessors].map(([id, rows]) => [id, rows.size]));
  const queue = [...indegree].filter(([, size]) => size === 0).map(([id]) => id), order = [];
  for (let offset = 0; offset < queue.length; offset++) {
    const id = queue[offset]; order.push(id);
    for (const next of successors(blocks.get(id))) {
      indegree.set(next, indegree.get(next) - 1); if (indegree.get(next) === 0) queue.push(next);
    }
  }
  // Loops/recursion have no admitted finite unrolling or closure theorem.
  const cyclic = order.length !== blocks.size;
  if (!cyclic && (predecessors.get(request.entry).size || blocks.get(request.entry).phis.length)) throw fail('Entry must have no predecessor or phi.');
  const dominators = new Map();
  if (!cyclic) for (const id of order) {
    const prior = [...predecessors.get(id)];
    const common = prior.length ? new Set(dominators.get(prior[0])) : new Set();
    for (const predecessor of prior.slice(1)) for (const member of common) if (!dominators.get(predecessor).has(member)) common.delete(member);
    common.add(id); dominators.set(id, common);
  }
  const available = (value, block, position) => {
    const definition = definitions.get(value);
    if (!definition) throw fail('Undefined SSA operand.');
    if (definition.block === null || cyclic) return;
    if (definition.block === block ? definition.position >= position : !dominators.get(block).has(definition.block)) throw fail('SSA operand does not dominate its use.');
  };
  for (const block of blocks.values()) {
    for (const phi of block.phis) {
      const named = new Set(phi.incoming.map(row => row.predecessor));
      if (named.size !== phi.incoming.length || named.size !== predecessors.get(block.id).size
        || [...named].some(id => !predecessors.get(block.id).has(id))) throw fail('Phi alternatives must exactly cover predecessors.');
      for (const row of phi.incoming) available(row.value, row.predecessor, Infinity);
    }
    for (const [index, instruction] of block.operations.entries()) {
      const position = block.phis.length + index;
      if (['copy', 'not'].includes(instruction.kind)) available(instruction.operand, block.id, position);
      if (['and', 'or', 'xor', 'equal'].includes(instruction.kind)) {
        available(instruction.left, block.id, position); available(instruction.right, block.id, position);
      }
    }
    if (block.terminator.kind === 'branch') available(block.terminator.condition, block.id, Infinity);
    if (['return', 'throw'].includes(block.terminator.kind)) available(block.terminator.value, block.id, Infinity);
  }
  const sourceIdentities = [...sources.values()].map(source => Object.freeze({ sourceUnitId: source.manifest.sourceUnitId,
    sourceHash: source.manifest.byteHash })).sort((a, b) => a.sourceUnitId < b.sourceUnitId ? -1 : 1);
  const sourceSetId = semanticHash('finite-feasibility.source-set.v1', sourceIdentities);
  return { request, blocks, fixedInputs, freeInputs: request.inputs.filter(id => !fixedInputs.has(id)), cyclic, sourceBytes,
    sourceIdentities, sourceSetId, targetIdentity: semanticHash('finite-feasibility.target.v1', { request, sourceSetId }) };
};

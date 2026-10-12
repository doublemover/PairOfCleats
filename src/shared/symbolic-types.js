import { createHash } from 'node:crypto';
import { compileSchema, createAjv } from './validation/ajv-factory.js';
import { deserializeTypeIr } from '../index/tooling/typescript/type-ir/index.js';
import { ToolingRequiredComputationError } from '../index/tooling/required-computation.js';
import { SYMBOLIC_TYPE_GRAPH_ENTRY_SCHEMA, SYMBOLIC_TYPE_GRAPH_SCHEMA, TYPE_EXPRESSIONS_SCHEMA,
  SYMBOLIC_TYPE_REF_SCHEMA, SYMBOLIC_TYPE_MANIFEST_SCHEMA, SYMBOLIC_TYPE_GRAPH_MAX_BYTES,
  SYMBOLIC_TYPE_TOTAL_MAX_BYTES } from '../contracts/schemas/symbolic-types.js';

const ajv = createAjv({ allErrors: false, strict: true });
const validators = Object.fromEntries(Object.entries({ graph: SYMBOLIC_TYPE_GRAPH_SCHEMA,
  graphEntry: SYMBOLIC_TYPE_GRAPH_ENTRY_SCHEMA, expressions: TYPE_EXPRESSIONS_SCHEMA,
  ref: SYMBOLIC_TYPE_REF_SCHEMA, manifest: SYMBOLIC_TYPE_MANIFEST_SCHEMA })
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
const validated = new WeakMap();
export const symbolicTypeError = (reason, message, details = null) => new ToolingRequiredComputationError(message,
  { operation: 'symbolic-types', reason, details: { coverage: 'incomplete', reason, ...details } });
const assertShape = (name, value) => {
  if (!validators[name](value)) throw symbolicTypeError('symbolic_type_corrupt',
    `Invalid symbolic type ${name}: ${ajv.errorsText(validators[name].errors)}`);
  return value;
};

/** Hash the canonical flat encoding incrementally, without copying the whole DAG. */
export const measureSymbolicTypeGraph = graph => {
  assertShape('graph', graph);
  if (graph.nodes.some((node, index) => index > 0 && graph.nodes[index - 1].id >= node.id)
    || graph.rootIds.some((id, index) => index > 0 && graph.rootIds[index - 1] >= id)) {
    throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph records and roots must have canonical identity order.');
  }
  const hash = createHash('sha256');
  let bytes = 0;
  const write = text => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > SYMBOLIC_TYPE_GRAPH_MAX_BYTES) throw symbolicTypeError('symbolic_type_limit', 'Symbolic graph exceeds its byte allowance.');
    hash.update(text);
  };
  write('{"schemaVersion":1,"domain":"finite-string","contextKey":');
  write(JSON.stringify(graph.contextKey));
  write(',"rootIds":'); write(JSON.stringify(graph.rootIds)); write(',"nodes":[');
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (i) write(',');
    const node = graph.nodes[i];
    write(JSON.stringify(node.kind === 'Literal'
      ? { id: node.id, kind: node.kind, value: node.value }
      : { id: node.id, kind: node.kind, children: node.children }));
  }
  write(']}');
  return { hash: hash.digest('hex'), bytes };
};

export const validateSymbolicTypeGraph = (entry, options = {}) => {
  if (entry && validated.has(entry)) return entry;
  assertShape('graphEntry', entry);
  const measured = measureSymbolicTypeGraph(entry.graph);
  if (entry.graphId !== 'stg1:' + measured.hash) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph content identity mismatch.');
  try {
    const hydrated = deserializeTypeIr(entry.graph, { ...options, contextKey: entry.graph.contextKey });
    options.onHydrated?.(hydrated);
  }
  catch (cause) {
    if (cause?.code !== 'ERR_TYPE_IR_INVALID') throw cause;
    throw symbolicTypeError('symbolic_type_corrupt', cause.message);
  }
  const nodeIds = new Set();
  for (const node of entry.graph.nodes) {
    nodeIds.add(node.id);
    if (node.children) Object.freeze(node.children);
    Object.freeze(node);
  }
  Object.freeze(entry.graph.rootIds); Object.freeze(entry.graph.nodes); Object.freeze(entry.graph); Object.freeze(entry);
  validated.set(entry, { ...measured, nodeIds });
  return entry;
};
export const createSymbolicTypeGraph = (serialized, options = {}) => {
  if (typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') > SYMBOLIC_TYPE_GRAPH_MAX_BYTES) {
    throw symbolicTypeError('symbolic_type_limit', 'Symbolic graph exceeds its byte allowance.');
  }
  let graph;
  try { graph = typeof serialized === 'string' ? JSON.parse(serialized) : serialized; }
  catch { throw symbolicTypeError('symbolic_type_corrupt', 'Invalid symbolic graph JSON.'); }
  const { hash } = measureSymbolicTypeGraph(graph);
  return validateSymbolicTypeGraph({ graphId: 'stg1:' + hash, graph }, options);
};
export const mergeSymbolicTypeGraphs = (existing = [], incoming = []) => {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graphs must be an array.');
  const graphs = new Map();
  const contexts = new Map();
  let bytes = 0;
  for (const list of [existing, incoming]) for (const raw of list) {
    const entry = validateSymbolicTypeGraph(raw);
    const existingContext = contexts.get(entry.graph.contextKey);
    if (existingContext && existingContext !== entry.graphId) {
      throw symbolicTypeError('symbolic_type_context_conflict', 'A compiler context must publish one complete shared graph snapshot.');
    }
    if (graphs.has(entry.graphId)) {
      const previous = graphs.get(entry.graphId).graph;
      const graph = entry.graph;
      if (previous !== graph && (previous.contextKey !== graph.contextKey || previous.rootIds.length !== graph.rootIds.length
        || previous.rootIds.some((id, index) => id !== graph.rootIds[index])
        || previous.nodes.length !== graph.nodes.length || previous.nodes.some((node, index) => {
        const other = graph.nodes[index];
        return node.id !== other.id || node.kind !== other.kind || (node.kind === 'Literal'
          ? node.value !== other.value
          : node.children.length !== other.children.length || node.children.some((id, childIndex) => id !== other.children[childIndex]));
      }))) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph identity collision.');
      continue;
    }
    bytes += validated.get(entry).bytes;
    if (graphs.size >= 256 || bytes > SYMBOLIC_TYPE_TOTAL_MAX_BYTES) throw symbolicTypeError('symbolic_type_limit', 'Shared symbolic graphs exceed their total allowance.');
    graphs.set(entry.graphId, entry);
    contexts.set(entry.graph.contextKey, entry.graphId);
  }
  return [...graphs.values()].sort((a, b) => a.graphId.localeCompare(b.graphId));
};
export const normalizeSymbolicTypeRef = value => Object.freeze({ ...assertShape('ref', value) });
const assertExpressionAllowance = value => {
  let bytes = 128, refs = 0, strings = 0;
  const charge = text => {
    if (typeof text !== 'string') return;
    if (text.length > 256 * 1024) throw symbolicTypeError('symbolic_type_limit', 'Symbolic metadata text exceeds its aggregate allowance.');
    strings += 1;
    bytes += Buffer.byteLength(text, 'utf8') + 32;
    if (bytes > 256 * 1024 || strings > 16384) throw symbolicTypeError('symbolic_type_limit', 'Symbolic declaration metadata exceeds its aggregate allowance.');
  };
  const ref = entry => {
    refs += 1;
    if (refs > 4096) throw symbolicTypeError('symbolic_type_limit', 'Symbolic parameter references exceed the per-declaration allowance.');
    for (const key of ['domain', 'graphId', 'contextKey', 'nodeId']) charge(entry?.[key]);
  };
  const declaration = entry => {
    charge(entry?.sourceId); charge(entry?.sourceHash);
    for (const key of ['kind', 'virtualPath', 'containerPath', 'segmentUid', 'mappingIdentity', 'mappingQuality']) charge(entry?.origin?.[key]);
  };
  if (value?.returnType) ref(value.returnType);
  if (value?.params && typeof value.params === 'object') {
    const names = Object.keys(value.params);
    if (names.length > 1024) throw symbolicTypeError('symbolic_type_limit', 'Symbolic parameter count exceeds its allowance.');
    for (const name of names) {
      charge(name);
      if (Array.isArray(value.params[name])) {
        if (value.params[name].length > 4096 - refs) throw symbolicTypeError('symbolic_type_limit', 'Symbolic parameter references exceed their allowance.');
        for (const entry of value.params[name]) ref(entry);
      }
    }
  }
  declaration(value?.declarationRef);
  if (Array.isArray(value?.provenance)) {
    if (value.provenance.length > 4096) throw symbolicTypeError('symbolic_type_limit', 'Symbolic provenance exceeds its allowance.');
    for (const entry of value.provenance) declaration(entry);
  }
  charge(value?.display?.signature); charge(value?.display?.returnType);
  if (value?.display?.params && typeof value.display.params === 'object') {
    const names = Object.keys(value.display.params);
    if (names.length > 1024) throw symbolicTypeError('symbolic_type_limit', 'Symbolic display parameter count exceeds its allowance.');
    for (const name of names) {
      charge(name);
      const values = value.display.params[name];
      if (Array.isArray(values)) {
        if (values.length > 4096) throw symbolicTypeError('symbolic_type_limit', 'Symbolic display entries exceed their allowance.');
        for (const text of values) charge(text);
      }
    }
  }
};
const normalizeDeclaration = value => {
  if (value.end < value.start || (value.origin?.segmentRange && value.origin.segmentRange.end < value.origin.segmentRange.start)) {
    throw symbolicTypeError('symbolic_type_corrupt', 'Invalid symbolic declaration or mapping range.');
  }
  return Object.freeze({ ...value, ...(value.origin ? { origin: Object.freeze({ ...value.origin,
    segmentRange: value.origin.segmentRange ? Object.freeze({ ...value.origin.segmentRange }) : null }) } : {}) });
};
export const normalizeTypeExpressions = value => {
  assertExpressionAllowance(value);
  assertShape('expressions', value);
  const declarationRef = normalizeDeclaration(value.declarationRef);
  const params = Object.create(null);
  for (const name of Object.keys(value.params).sort()) {
    const refs = new Map(value.params[name].map(ref => {
      const normalized = normalizeSymbolicTypeRef(ref);
      return [normalized.graphId + ':' + normalized.nodeId, normalized];
    }));
    params[name] = Object.freeze([...refs.values()].sort((a, b) => (a.graphId + a.nodeId).localeCompare(b.graphId + b.nodeId)));
  }
  const display = {};
  for (const key of ['returnType', 'signature']) if (Object.hasOwn(value.display, key)) display[key] = value.display[key];
  if (value.display.params) {
    display.params = Object.create(null);
    for (const name of Object.keys(value.display.params).sort()) display.params[name] = Object.freeze(value.display.params[name].slice());
    Object.freeze(display.params);
  }
  return Object.freeze({ schemaVersion: 1, interpretation: 'declared-type-denotation',
    returnType: value.returnType ? normalizeSymbolicTypeRef(value.returnType) : null,
    params: Object.freeze(params), declarationRef, display: Object.freeze(display),
    ...(value.provenance ? { provenance: Object.freeze(value.provenance.map(normalizeDeclaration)) } : {}) });
};
export const typeExpressionRefs = value => {
  const expressions = normalizeTypeExpressions(value);
  return [...(expressions.returnType ? [expressions.returnType] : []), ...Object.values(expressions.params).flat()];
};
export const validateTypeExpressionReferences = (expressions, graphs) => {
  const inventory = graphs instanceof Map ? graphs : new Map(mergeSymbolicTypeGraphs([], graphs).map(entry => [entry.graphId, entry]));
  for (const ref of typeExpressionRefs(expressions)) {
    const entry = inventory.get(ref.graphId);
    if (!entry) throw symbolicTypeError('symbolic_type_missing', 'Referenced symbolic graph is missing.', { graphId: ref.graphId });
    validateSymbolicTypeGraph(entry);
    if (entry.graph.contextKey !== ref.contextKey || !validated.get(entry).nodeIds.has(ref.nodeId)) {
      throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic reference has an unknown context or node.', { graphId: ref.graphId, nodeId: ref.nodeId });
    }
  }
  return expressions;
};
export const validateSymbolicTypeManifest = value => assertShape('manifest', value);

import { createHash } from 'node:crypto';
import { assertRepositoryQuestion } from '../../contracts/validators/repository-question.js';
import { REPOSITORY_QUESTION_SCHEMA, REPOSITORY_QUESTION_VERSION } from '../../contracts/schemas/repository-question.js';
import { captureSemanticRequest } from '../request-snapshot.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';

const plans = new WeakMap();
const predicate = signature => {
  for (const value of Object.values(signature)) if (Array.isArray(value)) Object.freeze(value);
  return Object.freeze(signature);
};
export const QUESTION_PREDICATES = Object.freeze({
  recordedTargetCandidate: predicate({ version: 1, meaning: 'recorded-candidate-not-runtime-callee', inputs: [0],
    sorts: ['Invocation', 'Declaration'], variables: [0, 1], outputs: [1], priority: 2 }),
  declaredNameEquals: predicate({ version: 1, meaning: 'exact-retained-declaration-name', inputs: [0],
    sorts: ['Declaration', 'text'], variables: [0], outputs: [], priority: 0 }),
  operandAt: predicate({ version: 1, meaning: 'recorded-syntactic-operand-not-runtime-argument', inputs: [0],
    sorts: ['Invocation', 'role', 'ordinal', 'Literal'], variables: [0, 3], outputs: [3], priority: 1 }),
  parserLiteralEquals: predicate({ version: 1, meaning: 'exact-typed-scalar-representation', inputs: [0],
    sorts: ['Literal', 'scalar'], variables: [0], outputs: [], priority: 0 })
});
const hash = (domain, value) => createHash('sha256').update(domain + '\0').update(canonicalSemanticJson(value, { maxBytes: 256 * 1024 })).digest('hex');
const freeze = value => {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop(); if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue;
    pending.push(...Object.values(current)); Object.freeze(current);
  }
  return value;
};
export const isQuestionSourcePath = value => typeof value === 'string' && value.length > 0 && !/[\\:\0]/.test(value)
  && !value.startsWith('\\') && !/^[A-Za-z]:/.test(value)
  && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Compile only the exact retained-fact fragment. No reader, predicate callback,
 * executable expression, query string or inferred program negation is admitted.
 */
export const compileRepositoryQuestion = (input, capabilityCatalog = null) => {
  const request = captureSemanticRequest(input, REPOSITORY_QUESTION_SCHEMA);
  assertRepositoryQuestion('request', request);
  const diagnostics = [], bindings = new Map(), authored = [], clauseIds = new Set();
  const diagnose = (code, path, message) => diagnostics.push({ code, path, message });
  let scanIndex = null, scan;
  for (let index = 0; index < request.bind.length; index++) {
    const binder = request.bind[index];
    if (bindings.has(binder.id)) diagnose('duplicate-binder', ['bind', index], 'Binder identity is already declared.');
    else bindings.set(binder.id, { ...binder, index, canonicalId: 'b' + index });
    if (binder.scan) {
      if (scanIndex !== null || binder.sort !== 'Invocation') diagnose('unsupported-scan', ['bind', index, 'scan'], 'The current fragment requires one Invocation scan.');
      scanIndex = index;
      if (binder.scan.sourcePaths) {
        if (binder.scan.sourcePaths.some(value => !isQuestionSourcePath(value))) diagnose('invalid-source-path', ['bind', index, 'scan'], 'Exact source paths must preserve normalized repository segments.');
        scan = { invocationKind: binder.scan.invocationKind, sourcePaths: [...binder.scan.sourcePaths].sort(compare) };
      } else {
        const prefix = binder.scan.sourcePrefix.replace(/\/$/, '');
        if (!isQuestionSourcePath(prefix)) diagnose('invalid-source-prefix', ['bind', index, 'scan'], 'Source prefix must name nonempty repository segments.');
        scan = { invocationKind: binder.scan.invocationKind, sourcePrefix: prefix };
      }
    }
  }
  if (scanIndex === null) diagnose('unbound-domain', ['bind'], 'An explicit bounded source scan is required.');
  const available = captureSemanticRequest(capabilityCatalog === null ? Object.entries(QUESTION_PREDICATES).map(([id, signature]) => ({ id, version: signature.version, executionClass: 'read-only' })) : capabilityCatalog,
    { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false,
      required: ['id', 'version', 'executionClass'], properties: { id: { type: 'string', maxLength: 128 },
        version: { type: 'integer' }, executionClass: { type: 'string', maxLength: 64 } } } });
  if (!Array.isArray(available) || available.length > 64) throw new TypeError('Bounded predicate capability catalog required.');
  const capabilities = new Map();
  for (const capability of available) {
    if (!capability || typeof capability.id !== 'string' || capabilities.has(capability.id)
      || !Object.hasOwn(QUESTION_PREDICATES, capability.id)
      || capability.executionClass !== 'read-only' || capability.version !== QUESTION_PREDICATES[capability.id]?.version) {
      diagnose('unsupported-capability', ['capabilities'], 'Only current known read-only predicate versions are supported.'); continue;
    }
    capabilities.set(capability.id, capability.version);
  }
  const variable = value => typeof value === 'string' && value.startsWith('$') ? bindings.get(value.slice(1)) : null;
  for (let index = 0; index < request.where.all.length; index++) {
    const atom = request.where.all[index], path = ['where', 'all', index];
    if (clauseIds.has(atom.id)) diagnose('duplicate-clause', path, 'Clause identity is already declared.');
    clauseIds.add(atom.id);
    const signature = Object.hasOwn(QUESTION_PREDICATES, atom.predicate) ? QUESTION_PREDICATES[atom.predicate] : null;
    if (!signature || !capabilities.has(atom.predicate)) { diagnose('unsupported-predicate', path, 'Requested retained-fact predicate is unavailable: ' + atom.predicate); continue; }
    if (atom.args.length !== signature.sorts.length) { diagnose('predicate-arity', path, 'Predicate argument count differs from its signature.'); continue; }
    const args = [];
    let valid = true;
    for (let argument = 0; argument < atom.args.length; argument++) {
      const value = atom.args[argument], sort = signature.sorts[argument];
      if (signature.variables.includes(argument)) {
        const binder = variable(value);
        if (!binder || binder.sort !== sort) { diagnose('binder-sort', [...path, 'args', argument], 'A declared ' + sort + ' binder is required.'); valid = false; }
        args.push(binder?.index ?? -1);
      } else {
        const matches = sort === 'text' ? typeof value === 'string' : sort === 'role' ? value === 'argument'
          : sort === 'ordinal' ? Number.isSafeInteger(value) && value >= 0 : value && typeof value === 'object' && !Array.isArray(value);
        if (!matches) { diagnose('predicate-literal', [...path, 'args', argument], 'Predicate constant has the wrong type.'); valid = false; }
        args.push(value);
      }
    }
    if (valid) authored.push({ predicate: atom.predicate, args, origins: [{ clauseId: atom.id, path }] });
  }
  const select = request.select.map((value, index) => {
    const binder = variable(value);
    if (!binder) diagnose('unknown-projection', ['select', index], 'Projection requires a declared binder.');
    return binder?.index ?? -1;
  });
  if (JSON.stringify(request.distinctBy) !== JSON.stringify(request.select)) diagnose('unsupported-distinct', ['distinctBy'], 'The current fragment deduplicates the entire selected binding tuple.');
  if (diagnostics.length) return freeze({ schemaVersion: REPOSITORY_QUESTION_VERSION, status: 'rejected', diagnostics });
  const normalized = new Map();
  for (const atom of authored) {
    const key = canonicalSemanticJson({ predicate: atom.predicate, args: atom.args });
    const previous = normalized.get(key);
    if (previous) previous.origins.push(...atom.origins); else normalized.set(key, { ...atom, key });
  }
  const bound = new Set([scanIndex]), pending = [...normalized.values()], atoms = [];
  while (pending.length) {
    const ready = pending.filter(atom => QUESTION_PREDICATES[atom.predicate].inputs.every(position => bound.has(atom.args[position])))
      .sort((a, b) => QUESTION_PREDICATES[a.predicate].priority - QUESTION_PREDICATES[b.predicate].priority || compare(a.key, b.key));
    if (!ready.length) { diagnose('unbound-predicate-input', pending[0].origins[0].path, 'Predicate inputs cannot be derived from this source scan.'); break; }
    const atom = ready[0]; pending.splice(pending.indexOf(atom), 1); atoms.push(atom);
    for (const position of QUESTION_PREDICATES[atom.predicate].outputs) bound.add(atom.args[position]);
  }
  for (const binder of bindings.values()) if (!bound.has(binder.index)) diagnose('unbound-binder', ['bind', binder.index], 'Binder is not range-restricted by a supported producer.');
  if (diagnostics.length) return freeze({ schemaVersion: REPOSITORY_QUESTION_VERSION, status: 'rejected', diagnostics });
  const logical = { version: 1, semantics: request.semantics, world: request.world,
    binders: request.bind.map((binder, index) => ({ id: 'b' + index, sort: binder.sort })), scanIndex, scan,
    predicates: [...new Set(authored.map(atom => atom.predicate))].sort(compare).map(id => ({ id,
      version: QUESTION_PREDICATES[id].version, meaning: QUESTION_PREDICATES[id].meaning })),
    atoms: [...normalized.values()].sort((a, b) => compare(a.key, b.key)).map(({ predicate, args }) => ({ predicate, args })), select };
  const logicalPlanId = hash('pairofcleats.repository-question.logical.v1', logical);
  const physical = { version: 1, algorithm: 'source-scan-correlated-nested-join', logicalPlanId,
    atoms: atoms.map(({ predicate, args }) => ({ predicate, args })),
    capabilities: [...capabilities].sort(([a], [b]) => compare(a, b)) };
  const plan = freeze({ schemaVersion: REPOSITORY_QUESTION_VERSION, status: 'compiled', requestDigest: hash('pairofcleats.repository-question.request.v1', request),
    logicalPlanId, physicalPlanId: hash('pairofcleats.repository-question.physical.v1', physical), logical, physical,
    originMap: atoms.map((atom, index) => ({ operatorId: index, authored: atom.origins })),
    interpretation: 'retained-candidates-and-syntactic-facts', executionClass: 'read-only' });
  plans.set(plan, freeze({ request, atoms, select, scanIndex, scan })); return plan;
};

export const readCompiledRepositoryQuestion = plan => {
  const compiled = plans.get(plan);
  if (!compiled) throw new TypeError('An original compiled repository question is required.');
  return compiled;
};

import { createHash } from 'node:crypto';
import { FINITE_QUESTION_MODEL_SCHEMA, REPOSITORY_QUESTION_VERSION } from '../../contracts/schemas/repository-question.js';
import { assertRepositoryQuestion } from '../../contracts/validators/repository-question.js';
import { throwIfAborted } from '../../shared/abort.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../request-snapshot.js';
import { readCompiledRepositoryQuestion, isQuestionSourcePath } from './compile.js';

const refKey = ref => ref.partitionId + ':' + ref.localId;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareEntity = (a, b) => compare(a.source.path, b.source.path) || a.source.span[0] - b.source.span[0]
  || a.source.span[1] - b.source.span[1] || compare(a.source.sourceHash, b.source.sourceHash)
  || compare(a.ref.partitionId, b.ref.partitionId) || a.ref.localId - b.ref.localId;
const invalid = message => Object.assign(new TypeError(message), { code: 'ERR_REPOSITORY_QUESTION_MODEL' });
const WORK_EXHAUSTED = Symbol('finite-question-work-exhausted');

/** Independent finite interpreter. Inputs are supplied records, not live store
 * capabilities or source verification. This oracle never opens files, executes
 * predicates supplied by callers or upgrades a finite relation to program truth.
 */
export const executeFiniteRepositoryQuestion = (plan, input, { maxRows = 128, maxBytes = 65536,
  maxWork = 65536, signal = null } = {}) => {
  const compiled = readCompiledRepositoryQuestion(plan);
  for (const [name, value, maximum, minimum] of [['maxRows', maxRows, 128, 1], ['maxBytes', maxBytes, 65536, 1024], ['maxWork', maxWork, 262144, 1]]) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError('Invalid finite question ' + name + '.');
  }
  throwIfAborted(signal);
  const model = captureSemanticRequest(input, FINITE_QUESTION_MODEL_SCHEMA);
  assertRepositoryQuestion('finiteModel', model);
  if (canonicalSemanticJson(model.world, { maxBytes: 256 * 1024 }) !== canonicalSemanticJson(compiled.request.world, { maxBytes: 256 * 1024 })) throw invalid('Question and finite input worlds differ.');
  const encoded = canonicalSemanticJson(model, { maxBytes: 2 * 1024 * 1024 });
  const modelId = createHash('sha256').update('pairofcleats.finite-question-input.v1\0').update(encoded).digest('hex');
  const result = { schemaVersion: REPOSITORY_QUESTION_VERSION, kind: 'repository-question-finite-reference', logicalPlanId: plan.logicalPlanId,
    physicalPlanId: plan.physicalPlanId, requestDigest: plan.requestDigest, modelId, world: model.world, status: 'partial', rows: [], frontier: [], refutations: [],
    completion: { enumeration: 'partial', domain: model.domain.state, programSemantics: 'not-established', rankedPrefix: 'not-established' },
    counts: { returnedRows: 0, totalInSuppliedModel: null, programTotal: null },
    supportSelection: 'one-deterministic-witness-per-row', verification: 'supplied-finite-model',
    diagnosticSelection: 'bounded-observed-clause-failures',
    work: { preparationRecords: 0, comparisons: 0, joinAdvances: 0, projectionComparisons: 0 }, frontierOmitted: 0, refutationsOmitted: 0 };
  let usedWork = 0, outputBytes = Buffer.byteLength(JSON.stringify(result)) + 1024, stopped = false;
  if (outputBytes > maxBytes) throw Object.assign(new RangeError('Question world metadata exceeds response allowance.'), { code: 'ERR_SEMANTIC_QUERY_LIMIT' });
  const charge = kind => {
    throwIfAborted(signal);
    if (usedWork >= maxWork) throw WORK_EXHAUSTED;
    usedWork++; result.work[kind]++;
  };
  const append = (family, value) => {
    const bytes = Buffer.byteLength(JSON.stringify(value)) + 1;
    if (outputBytes + bytes > maxBytes || family !== 'rows' && result[family].length === 128) {
      if (family !== 'rows') result[family + 'Omitted']++;
      return false;
    }
    outputBytes += bytes; result[family].push(value); return true;
  };
  const unresolved = (operatorId, reason, entity = null) => append('frontier', { operatorId, reason, ...(entity ? { ref: entity.ref } : {}) });
  const refuted = (operatorId, reason, entity) => append('refutations', { operatorId, reason, ref: entity.ref });
  const entities = new Map(), targetIndex = new Map(), operandIndex = new Map(), sourceIdentities = new Map();
  const ids = new Set();
  const addFact = (row, family) => {
    if (ids.has(family + '\0' + row.id)) throw invalid('Duplicate finite fact identity.');
    ids.add(family + '\0' + row.id);
    const parent = entities.get(refKey(row.invocation));
    if (parent?.sort !== 'Invocation') throw invalid('Finite fact requires an existing Invocation endpoint.');
    if (family === 'target' && entities.get(refKey(row.declaration))?.sort !== 'Declaration') throw invalid('Target candidate requires an existing Declaration endpoint.');
    const index = family === 'target' ? targetIndex : operandIndex, key = refKey(row.invocation);
    if (!index.has(key)) index.set(key, []); index.get(key).push(row);
  };
  let finished = false;
  try {
    for (const entity of model.entities) {
      charge('preparationRecords');
      const key = refKey(entity.ref);
      if (entities.has(key) || !isQuestionSourcePath(entity.source.path) || entity.source.span[1] < entity.source.span[0]) throw invalid('Duplicate entity or invalid source coordinates.');
      const identity = canonicalSemanticJson([entity.source.sourceHash, entity.source.path]);
      const prior = sourceIdentities.get(entity.source.sourceUnitId);
      if (prior && prior !== identity) throw invalid('Conflicting immutable source identity.');
      sourceIdentities.set(entity.source.sourceUnitId, identity); entities.set(key, entity);
    }
    for (const row of model.targets) { charge('preparationRecords'); addFact(row, 'target'); }
    for (const row of model.operands) { charge('preparationRecords'); addFact(row, 'operand'); }
    const entityCompare = (a, b) => { charge('comparisons'); return compareEntity(a, b); };
    const seeds = model.entities.filter(entity => entity.sort === 'Invocation' && entity.invocationKind === compiled.scan.invocationKind
      && (compiled.scan.sourcePaths ? compiled.scan.sourcePaths.includes(entity.source.path)
        : entity.source.path === compiled.scan.sourcePrefix || entity.source.path.startsWith(compiled.scan.sourcePrefix + '/'))).sort(entityCompare);
    for (const rows of targetIndex.values()) rows.sort((a, b) => entityCompare(entities.get(refKey(a.declaration)), entities.get(refKey(b.declaration))) || compare(a.id, b.id));
    for (const rows of operandIndex.values()) rows.sort((a, b) => { charge('comparisons'); return a.ordinal - b.ordinal || compare(a.id, b.id); });
    const extend = (bindings, index, entity) => {
      const previous = bindings[index];
      if (previous && refKey(previous.ref) !== refKey(entity.ref)) return null;
      return previous ? bindings : { ...bindings, [index]: entity };
    };
    function* evaluate(atom, bindings, operatorId) {
      const [first, second, third, fourth] = atom.args, entity = bindings[first];
      if (atom.predicate === 'recordedTargetCandidate') {
        const facts = targetIndex.get(refKey(entity.ref)) || [];
        if (!facts.length) {
          if (model.domain.state === 'partial') unresolved(operatorId, 'target-domain-incomplete', entity);
          else refuted(operatorId, 'no-candidate-in-supplied-facts', entity);
        }
        for (const fact of facts) {
          charge('joinAdvances');
          const next = extend(bindings, second, entities.get(refKey(fact.declaration)));
          if (next) yield { bindings: next, witness: { operatorId, factId: fact.id, certainty: fact.certainty } };
        }
      } else if (atom.predicate === 'operandAt') {
        const facts = operandIndex.get(refKey(entity.ref)) || [];
        let observed = false;
        for (const fact of facts) {
          charge('joinAdvances'); if (fact.role !== second || fact.ordinal !== third) continue;
          observed = true;
          const child = fact.child && entities.get(refKey(fact.child));
          if (!child || fact.flags.some(flag => ['spread', 'rest', 'hole'].includes(flag))) { unresolved(operatorId, 'operand-unavailable-or-unqualified', entity); continue; }
          if (child.sort !== 'Literal') { refuted(operatorId, 'operand-is-not-a-retained-literal', child); continue; }
          const next = extend(bindings, fourth, child);
          if (next) yield { bindings: next, witness: { operatorId, factId: fact.id, positionMeaning: 'syntactic-zero-based' } };
        }
        if (!observed) {
          if (model.domain.state === 'partial') unresolved(operatorId, 'operand-domain-incomplete', entity);
          else refuted(operatorId, 'operand-absent-from-supplied-facts', entity);
        }
      } else if (atom.predicate === 'declaredNameEquals') {
        charge('joinAdvances');
        if (entity.name === second) yield { bindings, witness: { operatorId, ref: entity.ref } };
        else refuted(operatorId, 'retained-name-differs', entity);
      } else {
        charge('joinAdvances');
        if (entity.scalar === null) unresolved(operatorId, 'parser-scalar-unavailable', entity);
        else if (entity.scalar.type === second.type && entity.scalar.representation === second.representation) yield { bindings, witness: { operatorId, ref: entity.ref } };
        else refuted(operatorId, 'typed-scalar-differs', entity);
      }
    }
    const seenRows = new Set();
    for (const seed of seeds) {
      const frames = [{ index: 0, bindings: { [compiled.scanIndex]: seed }, witnesses: [], iterator: null }];
      while (frames.length) {
        charge('joinAdvances');
        const frame = frames[frames.length - 1];
        if (frame.index === compiled.atoms.length) {
          frames.pop();
          const selected = compiled.select.map(index => frame.bindings[index]);
          const identity = selected.map(entity => refKey(entity.ref)).join('\0');
          if (seenRows.has(identity)) continue;
          const row = { bindings: selected.map((entity, index) => ({ variable: compiled.request.select[index],
            sort: entity.sort, ref: entity.ref, source: entity.source,
            ...(entity.sort === 'Declaration' ? { name: entity.name } : entity.sort === 'Literal' ? { scalar: entity.scalar } : { invocationKind: entity.invocationKind }) })),
          witnesses: frame.witnesses };
          if (result.rows.length === maxRows || !append('rows', row)) { unresolved(null, 'response-budget'); stopped = true; break; }
          seenRows.add(identity); continue;
        }
        frame.iterator ||= evaluate(compiled.atoms[frame.index], frame.bindings, frame.index);
        const next = frame.iterator.next();
        if (next.done) { frames.pop(); continue; }
        frames.push({ index: frame.index + 1, bindings: next.value.bindings,
          witnesses: [...frame.witnesses, next.value.witness], iterator: null });
      }
      if (stopped) break;
    }
    finished = !stopped;
  } catch (error) {
    if (error !== WORK_EXHAUSTED) throw error;
    unresolved(null, 'work-budget');
  }
  if (model.domain.state === 'partial') unresolved(null, 'supplied-input-domain-incomplete');
  result.rows.sort((a, b) => {
    result.work.projectionComparisons++;
    for (let index = 0; index < a.bindings.length; index++) {
      const compared = compareEntity(a.bindings[index], b.bindings[index]); if (compared) return compared;
    }
    return 0;
  });
  result.completion.enumeration = finished ? 'complete-in-supplied-input' : 'partial';
  result.counts.returnedRows = result.rows.length;
  if (finished && model.domain.state === 'complete' && !result.frontier.length && !result.frontierOmitted) {
    result.status = 'complete-in-supplied-model'; result.counts.totalInSuppliedModel = result.rows.length;
  }
  throwIfAborted(signal);
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw new Error('Finite question response accounting exceeded its admitted allowance.');
  return assertRepositoryQuestion('finiteResult', result);
};

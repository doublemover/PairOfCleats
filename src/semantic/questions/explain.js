import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { throwIfAborted } from '../../shared/abort.js';
import { REPOSITORY_QUESTION_VERSION } from '../../contracts/schemas/repository-question.js';
import { assertRepositoryQuery } from '../../contracts/validators/repository-question-live.js';
import { semanticCoverageIsComplete } from '../coverage-qualification.js';
import { sourceOrderEntry } from '../source-order.js';
import { CURRENT_READER_QUESTION_PROFILE } from './current-reader-profile.js';
import { QUESTION_PREDICATES } from './compile.js';
import { createQuestionSeed } from './current-reader-state.js';
import { createCurrentQuestionFacts, questionRefKey } from './current-reader-facts.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
/** Explain one original, fully bound tuple. Relations are collected by the same
 * production reader owner, without the optimizer's conjunction short-circuit.
 * This does not rerun a search, relax a clause or infer a causal explanation.
 */
export const explainRepositoryQuestion = async ({ store, request, profile, plan, state, signal, limits, began, maxStateBytes }) => {
  const result = { schemaVersion: REPOSITORY_QUESTION_VERSION, kind: 'repository-question-clause-page', profile: CURRENT_READER_QUESTION_PROFILE,
    world: profile.world, requestDigest: plan.requestDigest, logicalPlanId: plan.logicalPlanId, physicalPlanId: plan.physicalPlanId,
    bindingRefs: request.bindingRefs, qualifiedBindings: [], originMap: plan.originMap, clauses: [], questionAtBinding: 'incomplete', frontier: [], frontierOmitted: 0,
    completion: { clauses: 'partial', analysis: 'unobserved', programSemantics: 'not-established' },
    counts: { returnedClauses: 0, evaluatedThroughCursor: state.explanation?.offset || 0, totalClauses: profile.compiled.atoms.length },
    verification: 'retained-records-and-source-headers', diagnosticSelection: 'all-compiled-clauses-at-the-original-binding',
    cursor: randomUUID(), work: { steps: 0, elapsedMs: 0, retainedStateBytes: state.retainedBytes } };
  const fits = () => Buffer.byteLength(JSON.stringify(result)) + 2048 <= limits.bytes;
  if (!fits()) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Original binding and clause metadata exceed this explanation page allowance.');
  if (!state.explanation) state.explanation = { admitted: false, offset: 0, targetUnknown: false, operandUnknown: false, refuted: false, unknown: false };
  const explanation = state.explanation;
  const diagnose = (kind, operatorId, reason, ref = null) => {
    if (kind !== 'unknown') return;
    if (operatorId === null || operatorId === profile.target.operatorId) explanation.targetUnknown = true;
    if (operatorId === null || operatorId === profile.operand.operatorId) explanation.operandUnknown = true;
    const value = { operatorId, reason, ...(ref ? { ref } : {}) };
    if (result.frontier.length === 64) { result.frontierOmitted++; return; }
    result.frontier.push(value);
    if (!fits()) { result.frontier.pop(); result.frontierOmitted++; }
  };
  const refs = [request.bindingRefs.invocation, request.bindingRefs.declaration, request.bindingRefs.literal];
  if (!explanation.admitted) {
    for (const ref of refs) if (typeof store.getPartitionSourceUnitId === 'function' && !store.getPartitionSourceUnitId(ref.partitionId)) {
      throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Explanation binding is outside the admitted generation inventory.');
    }
    const records = await store.getRecords(refs, ['span', 'scope', 'data'], { signal });
    for (const [index, kind] of ['expression', 'declaration', 'literal'].entries()) {
      if (!records[index] || records[index].kind !== kind || questionRefKey(records[index].ref) !== questionRefKey(refs[index])) {
        throw fail('ERR_SEMANTIC_QUERY_CONTRACT', 'Explanation requires an existing Invocation, Declaration and Literal tuple.');
      }
    }
    const invocation = records[0], source = await store.getSourceReference(invocation, { signal });
    const scan = profile.compiled.scan;
    if (!source || source.coordinateUnit !== 'utf16') throw fail('ERR_SEMANTIC_UNAVAILABLE', 'The selected Invocation requires an unavailable source-coordinate adapter.');
    const inDomain = scan.sourcePaths ? scan.sourcePaths.includes(source.path)
      : source.path === scan.sourcePrefix || source.path.startsWith(scan.sourcePrefix + '/');
    if (!inDomain || invocation.data.invocationKind !== scan.invocationKind) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Selected Invocation is outside the original question source domain.');
    state.path = source.path; state.seed = createQuestionSeed(refs[0]);
    state.after = { ref: refs[0], value: sourceOrderEntry(invocation, refs[0], source.path, source.sourceHash).value };
    explanation.admitted = true; result.work.steps++;
  }
  // Independent clause truth must not inherit the conjunction optimizer's name
  // or scalar filters. The original predicates are evaluated below unchanged.
  const facts = createCurrentQuestionFacts({ store, profile: { ...profile, filters: [] }, state, signal, diagnose, maxStateBytes, diagnosticMode: true });
  while (!['emit', 'done'].includes(state.seed.phase) && result.work.steps < 512
    && (result.work.steps === 0 || performance.now() - began < limits.workMs)) {
    throwIfAborted(signal); await facts.advance(); result.work.steps++;
  }
  if (['emit', 'done'].includes(state.seed.phase)) {
    const values = [];
    for (const [index, sort] of ['Invocation', 'Declaration', 'Literal'].entries()) {
      values[index] = await facts.readEntity(refs[index], sort, null);
      if (values[index]) {
        const variableIndex = [profile.scan, profile.declaration, profile.literal][index];
        result.qualifiedBindings.push({ variable: '$' + profile.compiled.request.bind[variableIndex].id, ...values[index] });
      }
    }
    if (!fits()) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Qualified binding metadata exceeds this explanation page allowance; use individual semantic-detail expansion.');
    while (explanation.offset < profile.compiled.atoms.length && result.clauses.length < limits.records
      && result.work.steps < 512 && (!result.clauses.length || performance.now() - began < limits.workMs)) {
      throwIfAborted(signal);
      const operatorId = explanation.offset, atom = profile.compiled.atoms[operatorId];
      const clause = { operatorId, status: 'unknown', meaning: QUESTION_PREDICATES[atom.predicate].meaning,
        reason: 'binding-source-or-value-unavailable', witnesses: [] };
      if (atom.predicate === 'recordedTargetCandidate' || atom.predicate === 'operandAt') {
        const target = atom.predicate === 'recordedTargetCandidate', wanted = target ? refs[1] : refs[2];
        const found = state.seed[target ? 'targets' : 'literals'].find(entry => questionRefKey(entry.ref) === questionRefKey(wanted));
        if (found && values[0] && values[target ? 1 : 2]) {
          await facts.verifyFact(found.witness);
          clause.status = 'satisfied-in-retained-input'; clause.reason = 'exact-bound-tuple-in-retained-facts'; clause.witnesses.push(found.witness);
        } else if (!found && !explanation[target ? 'targetUnknown' : 'operandUnknown']) {
          clause.status = 'refuted-in-retained-input'; clause.reason = 'bound-tuple-absent-from-exhausted-retained-call-facts';
        } else clause.reason = target ? 'retained-target-facts-unqualified' : 'retained-operand-facts-unqualified';
      } else {
        const name = atom.predicate === 'declaredNameEquals', value = values[name ? 1 : 2];
        clause.expected = atom.args[1]; clause.actual = value ? name ? value.name : value.scalar : null;
        if (value && (name || value.scalar !== null)) {
          const matches = name ? value.name === atom.args[1] : value.scalar.type === atom.args[1].type && value.scalar.representation === atom.args[1].representation;
          clause.status = matches ? 'satisfied-in-retained-input' : 'refuted-in-retained-input';
          clause.reason = matches ? 'exact-bound-retained-value-matches' : 'exact-bound-retained-value-differs';
          clause.witnesses.push({ operatorId, ref: value.ref });
        }
      }
      result.clauses.push(clause);
      if (!fits()) {
        result.clauses.pop();
        if (!result.clauses.length) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'One clause explanation exceeds this page byte allowance.');
        break;
      }
      if (clause.status === 'refuted-in-retained-input') explanation.refuted = true;
      if (clause.status === 'unknown') explanation.unknown = true;
      explanation.offset++; result.work.steps++;
    }
  }
  const complete = explanation.offset === profile.compiled.atoms.length;
  if (complete) {
    result.cursor = null; result.completion.clauses = 'complete';
    result.questionAtBinding = explanation.refuted ? 'refuted-in-retained-input' : explanation.unknown ? 'unknown' : 'satisfied-in-retained-input';
  } else {
    if (result.frontier.length === 64) result.frontierOmitted++;
    else {
      result.frontier.push({ operatorId: null, reason: 'original-binding-explanation-budget' });
      if (!fits()) { result.frontier.pop(); result.frontierOmitted++; }
    }
  }
  result.completion.analysis = !state.qualification.observed ? 'unobserved' : semanticCoverageIsComplete(state.qualification) ? 'complete' : 'incomplete';
  result.counts.returnedClauses = result.clauses.length; result.counts.evaluatedThroughCursor = explanation.offset;
  result.work.elapsedMs = performance.now() - began; result.work.retainedStateBytes = state.retainedBytes;
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Clause explanation exceeds its admitted response allowance.');
  throwIfAborted(signal); return assertRepositoryQuery('explanation', result);
};

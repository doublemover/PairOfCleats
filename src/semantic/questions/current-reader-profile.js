import { semanticHash, canonicalSemanticJson } from '../../index/semantic/identity.js';
import { SEMANTIC_OPERATION_INDEX_VERSION, captureSourcePath } from '../source-order.js';
import { captureSemanticRequest } from '../request-snapshot.js';
import { QUESTION_SCAN_SCHEMA } from '../../contracts/schemas/repository-question.js';
import { readCompiledRepositoryQuestion } from './compile.js';
import { assertRepositoryQuestion } from '../../contracts/validators/repository-question.js';

export const CURRENT_READER_QUESTION_PROFILE = 'retained-invocation-target-literal-v1';
const fail = (message, diagnostics = []) => Object.assign(new TypeError(message), { code: 'ERR_SEMANTIC_QUERY_CONTRACT', diagnostics });
export const normalizeQuestionScan = input => {
  const scan = captureSemanticRequest(input, QUESTION_SCAN_SCHEMA);
  assertRepositoryQuestion('scan', scan);
  // Full AST validation remains the compiler's owner. Describe admits the same
  // bounded shape without manufacturing a caller's world or executable plan.
  if (!scan || !['call', 'optionalCall', 'construct', 'tag', 'import'].includes(scan.invocationKind)
    || Boolean(scan.sourcePaths) === Boolean(scan.sourcePrefix)) throw fail('An exact source scan is required.');
  if (scan.sourcePaths) {
    if (!Array.isArray(scan.sourcePaths) || !scan.sourcePaths.length || scan.sourcePaths.length > 32) throw fail('Invalid exact source domain.');
    return { sourcePaths: scan.sourcePaths.map(captureSourcePath).sort(), invocationKind: scan.invocationKind };
  }
  return { sourcePrefix: captureSourcePath(scan.sourcePrefix.replace(/\/$/, '')), invocationKind: scan.invocationKind };
};
export const describeQuestionWorld = (store, inputScan) => {
  const scan = normalizeQuestionScan(inputScan);
  if (!store || typeof store.repoRoot !== 'string' || typeof store.cursorScope !== 'string' || !store.cursorScope.length) {
    throw fail('An admitted generation and immutable store inventory are required.');
  }
  return { repositoryNamespace: store.repoRoot, generation: { ...store.generation }, sourceSnapshotId: store.cursorScope,
    contextKey: 'all-retained-provider-contexts-v1', domainId: semanticHash('repository-question.source-domain.v1', scan),
    producerId: CURRENT_READER_QUESTION_PROFILE + ':operation-index-' + SEMANTIC_OPERATION_INDEX_VERSION };
};

/** A deliberately explicit live profile. The compiler's broader finite grammar
 * does not authorize an unimplemented physical join or projection ordering.
 */
export const admitCurrentReaderQuestion = (plan, store) => {
  const compiled = readCompiledRepositoryQuestion(plan), diagnostics = [];
  const diagnose = (path, message) => diagnostics.push({ code: 'unsupported-current-reader-profile', path, message });
  const scan = compiled.scanIndex, declarations = [], literals = [];
  compiled.request.bind.forEach((binder, index) => {
    if (binder.sort === 'Declaration') declarations.push(index);
    if (binder.sort === 'Literal') literals.push(index);
  });
  if (compiled.request.bind.length !== 3 || declarations.length !== 1 || literals.length !== 1) {
    diagnose(['bind'], 'Live execution requires one scanned Invocation, one Declaration and one Literal.');
  }
  if (compiled.select.length !== 3 || compiled.select[0] !== scan || new Set(compiled.select).size !== 3) {
    diagnose(['select'], 'Live source-order execution selects all three binders with the Invocation first.');
  }
  const target = [], operand = [], filters = [];
  compiled.atoms.forEach((atom, operatorId) => {
    const path = atom.origins[0].path;
    if (atom.predicate === 'recordedTargetCandidate') {
      target.push({ ...atom, operatorId });
      if (atom.args[0] !== scan || atom.args[1] !== declarations[0]) diagnose(path, 'Target candidates must belong to the scanned Invocation.');
    } else if (atom.predicate === 'operandAt') {
      operand.push({ ...atom, operatorId });
      if (atom.args[0] !== scan || atom.args[3] !== literals[0]) diagnose(path, 'The argument must belong to the same scanned Invocation.');
    } else {
      filters.push({ ...atom, operatorId });
      if (atom.args[0] !== (atom.predicate === 'declaredNameEquals' ? declarations[0] : literals[0])) diagnose(path, 'Filter input must be the produced declaration or literal.');
    }
  });
  if (target.length !== 1 || operand.length !== 1) diagnose(['where', 'all'], 'Live execution requires exactly one target-candidate and one syntactic-argument producer.');
  if (diagnostics.length) throw fail('Question requires a physical profile not supported by the current reader.', diagnostics);
  const expected = describeQuestionWorld(store, compiled.scan);
  if (canonicalSemanticJson(expected) !== canonicalSemanticJson(compiled.request.world)) {
    throw Object.assign(new Error('Question world differs from the admitted repository, generation, domain or reader profile. Describe the current world and compile again.'), { code: 'ERR_SEMANTIC_SCOPE_MISMATCH' });
  }
  return Object.freeze({ compiled, logicalPlanId: plan.logicalPlanId, scan, declaration: declarations[0], literal: literals[0],
    target: Object.freeze(target[0]), operand: Object.freeze(operand[0]), filters: Object.freeze(filters), world: Object.freeze(expected) });
};

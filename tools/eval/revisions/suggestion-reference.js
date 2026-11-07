import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { SUGGESTION_REVISION_OUTPUT_SCHEMA } from '../../../src/contracts/schemas/revision-suggestions.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), SUGGESTION_REVISION_OUTPUT_SCHEMA);
export const captureSuggestionRevisionOutput = value => {
  const result = captureSemanticRequest(value, SUGGESTION_REVISION_OUTPUT_SCHEMA);
  if (!validate(result)) throw new TypeError('Invalid closed test-suggestion revision output.'); return result;
};
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Independent forward all-pairs distance matrix. This imports no production
 * graph preparation, traversal, scoring, witness, normalization or cache owner.
 * Production traverses reverse imports; this reference asks each test for its
 * shortest forward route to a changed file. Supports are projected as a set. */
export const referenceSuggestionRevision = (state, { signal = null, maxReferenceWork = 4096, check = () => true } = {}) => {
  let operations = 0;
  const step = () => { throwIfAborted(signal); if (operations >= maxReferenceWork || !check()) return false; operations++; return true; };
  const unknown = () => ({ rows: null, operations, reason: 'reference-work-budget' });
  const matrix = Array.from({ length: state.nodes.length }, () => Array(state.nodes.length).fill(Infinity));
  for (let i = 0; i < state.nodes.length; i++) { if (!step()) return unknown(); matrix[i][i] = 0; }
  for (const edge of state.edges) {
    if (!step()) return unknown(); const from = state.nodes.indexOf(edge.from), to = state.nodes.indexOf(edge.to);
    matrix[from][to] = Math.min(matrix[from][to], 1);
  }
  for (let via = 0; via < matrix.length; via++) for (let from = 0; from < matrix.length; from++) for (let to = 0; to < matrix.length; to++) {
    if (!step()) return unknown(); matrix[from][to] = Math.min(matrix[from][to], matrix[from][via] + matrix[via][to]);
  }
  const rows = [];
  for (const testPath of state.testPaths) {
    if (!step()) return unknown(); const index = state.nodes.indexOf(testPath);
    const distance = Math.min(...state.changedPaths.map(path => matrix[index][state.nodes.indexOf(path)]));
    if (Number.isFinite(distance)) rows.push({ testPath, distance, score: 1 / (1 + distance) });
  }
  rows.sort((a, b) => a.distance - b.distance || compare(a.testPath, b.testPath));
  return { rows, operations, reason: null };
};
export const compareSuggestionRevision = (state, actual, reference) => {
  const expected = reference.rows;
  let reason = null;
  const changed = [...state.changedPaths].sort(compare);
  if (JSON.stringify(actual.changedPaths) !== JSON.stringify(changed)) reason = 'changed-source-identity-mismatch';
  const seen = new Set();
  for (const row of actual.graphRows) {
    const path = row.witness;
    const absentWitness = !path.length && row.witnessTarget === null && row.witnessDistance === null;
    if (seen.has(row.testPath) || !state.testPaths.includes(row.testPath) || row.score !== 1 / (1 + row.distance)) reason ||= 'invalid-graph-suggestion';
    if (!absentWitness || actual.complete) {
      if (path.length !== row.distance + 1 || row.witnessTarget !== row.testPath || row.witnessDistance !== row.distance
        || path.at(-1) !== row.testPath || !state.changedPaths.includes(path[0]) || path.some(node => !state.nodes.includes(node))
        || path.slice(1).some((node, index) => !state.edges.some(edge => edge.from === node && edge.to === path[index]))) reason ||= 'invalid-original-graph-witness';
    }
    seen.add(row.testPath);
    const required = expected?.find(item => item.testPath === row.testPath);
    if (expected && (!required || required.distance !== row.distance || required.score !== row.score)) reason ||= 'incorrect-graph-membership-distance-or-score';
  }
  if (reason) return { outcome: 'fail', reason };
  if (expected === null || !actual.complete) return { outcome: 'unknown', reason: expected === null ? reference.reason : 'candidate-incomplete' };
  const projected = actual.graphRows.map(({ testPath, distance, score }) => ({ testPath, distance, score }));
  if (JSON.stringify(projected) !== JSON.stringify(expected)) return { outcome: 'fail', reason: 'graph-suggestion-set-or-order-mismatch' };
  if (expected.length && (actual.fidelitySource !== 'graph' || actual.fidelityState !== 'complete' || !actual.graphUsed)) return { outcome: 'fail', reason: 'graph-fidelity-mismatch' };
  if (!actual.graphAvailable || actual.heuristicPaths.some(path => !state.testPaths.includes(path))
    || actual.graphRows.length && actual.heuristicPaths.length) return { outcome: 'fail', reason: 'graph-authority-or-fallback-mismatch' };
  return { outcome: 'pass', reason: null };
};

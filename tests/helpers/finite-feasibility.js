import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { FINITE_FEASIBILITY_PROFILE, FINITE_FEASIBILITY_VERSION } from '../../src/contracts/schemas/finite-feasibility.js';
import { createFiniteFeasibilityTarget, refinePredicate, resumeRefinement } from '../../src/semantic/finite-feasibility.js';

export const finiteBooleanBlock = (id, operations, terminator, phis = []) => ({ id, anchorId: 'source', phis, operations, terminator });
export const finiteBooleanFixture = () => {
  const text = 'function finite(input) { if (input) return true; return false; }\n';
  const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'finite-fixture', path: 'finite.js', language: 'javascript' });
  const request = { schemaVersion: FINITE_FEASIBILITY_VERSION, profile: FINITE_FEASIBILITY_PROFILE,
    world: { repositoryNamespace: 'finite-fixture', generation: { baseBuildId: 'authored-finite-build', semanticRevision: 0 },
      sourceSnapshotId: 'authored-finite-source-world', contextKey: 'authored-context', domainId: 'boolean-model', producerId: 'authored-translation' },
    translation: 'declared-source-mapping-not-execution-qualified', anchors: [{ id: 'source', source: { sourceUnitId: source.manifest.sourceUnitId,
      sourceHash: source.manifest.byteHash, path: source.manifest.path, span: [0, text.length], coordinateUnit: 'utf16' } }],
    inputs: ['input'], entryConditions: [], entry: 'entry', blocks: [
      finiteBooleanBlock('entry', [], { kind: 'branch', condition: 'input', onTrue: 'yes', onFalse: 'no' }),
      finiteBooleanBlock('yes', [{ id: 'trueValue', kind: 'constant', value: true }], { kind: 'return', value: 'trueValue' }),
      finiteBooleanBlock('no', [{ id: 'falseValue', kind: 'constant', value: false }], { kind: 'return', value: 'falseValue' })
    ], predicate: { kind: 'return-value', block: 'yes', value: true } };
  return { source, request, create: () => createFiniteFeasibilityTarget({ request, sourceSnapshots: [source] }) };
};
export const finishFiniteRefinement = async (target, api = { refinePredicate, resumeRefinement }) => {
  let result = await api.refinePredicate(target, { limits: { assignments: 32, workMs: 250 } }), pages = 1;
  while (result.cursor) {
    if (pages++ > 64) throw new Error('Small finite fixture failed to make bounded progress.');
    result = await api.resumeRefinement(result.cursor, { limits: { assignments: 32, workMs: 250 } });
  }
  return result;
};
